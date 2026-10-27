import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { ShelfAuth } from '../src/shelf-auth.mjs';
import { TicketShelf } from '../src/shelf.mjs';
import { createWebhookServer } from '../src/app.mjs';
import { ShelfCatalog } from '../src/shelf-catalog.mjs';
import { config } from '../src/config.mjs';

const input = { movieTitle: '測試電影', watchedOn: '2025-10-01', cinema: '小影院', companions: '朋友', note: '  我的原話\n<script>不應執行</script>  ', movieId: null };
const catalog = { details: async id => ({ id, title: '伺服器確認的片名', posterPath: '/poster.jpg' }), search: async () => ({ available: true, movies: [] }) };
async function setup(t) {
  const store = new Store();
  const auth = new ShelfAuth({ baseUrl: 'http://127.0.0.1', secureCookies: false });
  const shelf = new TicketShelf({ store, auth, catalog });
  const replies = [];
  const server = createWebhookServer({ secret: 'test-secret', store, shelf, bot: { respond: () => { throw new Error('入口不應呼叫 AI'); } }, reply: async (token, messages) => replies.push(messages) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`; auth.origin = base;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const call = (path, options = {}) => fetch(base + path, options);
  const login = async actor => {
    const token = new URL(auth.createEntry(actor)).hash.slice('#entry='.length);
    const response = await call('/api/auth/entry', { method: 'POST', headers: { Origin: base }, body: JSON.stringify({ token }) });
    const value = await response.json(); return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: value.csrfToken, token };
  };
  const write = (user, method, path, value, headers = {}) => call(path, { method, headers: { Origin: base, Cookie: user.cookie, 'X-CSRF-Token': user.csrf, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  return { store, auth, shelf, call, login, write, replies, base };
}

test('private entry is short lived, one use, owner-bound, and sessions require origin and CSRF', async t => {
  const { call, login, write, base } = await setup(t);
  assert.equal((await call('/api/tickets')).status, 401);
  const user = await login('user-A');
  assert.ok(user.csrf);
  assert.equal((await call('/api/auth/entry', { method: 'POST', headers: { Origin: base }, body: JSON.stringify({ token: user.token }) })).status, 401);
  assert.equal((await write(user, 'POST', '/api/tickets', input, { Origin: 'https://evil.example', 'Idempotency-Key': randomUUID() })).status, 403);
  assert.equal((await write(user, 'POST', '/api/tickets', input, { 'X-CSRF-Token': 'é'.repeat(43), 'Idempotency-Key': randomUUID() })).status, 403);
  const response = await write(user, 'POST', '/api/tickets', input, { 'Idempotency-Key': randomUUID() }); assert.equal(response.status, 201);
  const ticket = (await response.json()).ticket;
  assert.equal(ticket.note, input.note); assert.equal('actor' in ticket, false);
  const other = await login('user-B');
  assert.equal((await call('/api/tickets/' + ticket.id, { headers: { Cookie: other.cookie } })).status, 404);
  assert.equal((await write(other, 'PATCH', '/api/tickets/' + ticket.id, { ...input, revision: 1 })).status, 404);
  assert.equal((await write(other, 'DELETE', '/api/tickets/' + ticket.id, { revision: 1 })).status, 404);
  assert.equal((await write(user, 'POST', '/api/logout', {})).status, 200);
  assert.equal((await call('/api/tickets', { headers: { Cookie: user.cookie } })).status, 401);
});

test('create retries, revision conflicts and delete tombstones protect data', async t => {
  const { call, login, write } = await setup(t); const user = await login('A'); const key = randomUUID();
  const create = async () => write(user, 'POST', '/api/tickets', input, { 'Idempotency-Key': key });
  const first = await create(); const ticket = (await first.json()).ticket; assert.equal(first.status, 201);
  const again = await create(); assert.equal(again.status, 200); assert.equal((await again.json()).ticket.id, ticket.id);
  assert.equal((await write(user, 'POST', '/api/tickets', { ...input, note: '重試改變內容' }, { 'Idempotency-Key': key })).status, 409);
  const edit = await write(user, 'PATCH', '/api/tickets/' + ticket.id, { ...input, note: '逐字保留新心得\n第二行', revision: 1 }); assert.equal(edit.status, 200);
  assert.equal((await edit.json()).ticket.revision, 2);
  assert.equal((await write(user, 'PATCH', '/api/tickets/' + ticket.id, { ...input, revision: 1 })).status, 409);
  assert.equal((await write(user, 'DELETE', '/api/tickets/' + ticket.id, { revision: 1 })).status, 409);
  assert.equal((await write(user, 'DELETE', '/api/tickets/' + ticket.id, { revision: 2 })).status, 200);
  assert.equal((await call('/api/tickets/' + ticket.id, { headers: { Cookie: user.cookie } })).status, 404);
  assert.equal((await create()).status, 409);
});

test('API validates dates, unknown actor fields, upstream movie and body limits', async t => {
  const { login, write } = await setup(t); const user = await login('A');
  const create = value => write(user, 'POST', '/api/tickets', value, { 'Idempotency-Key': randomUUID() });
  for (const value of [{ ...input, actor: 'B' }, { ...input, posterPath: 'https://evil.invalid/x' }, { ...input, watchedOn: '2025-02-30' }, { ...input, watchedOn: '2999-01-01' }, { ...input, note: 'x'.repeat(1501) }]) assert.equal((await create(value)).status, 400);
  assert.equal((await create({ ...input, note: 'x'.repeat(25000) })).status, 413);
  const response = await create({ ...input, movieId: 123, movieTitle: '偽造標題' }); assert.equal(response.status, 201);
  const ticket = (await response.json()).ticket; assert.equal(ticket.movieTitle, '伺服器確認的片名'); assert.equal(ticket.posterPath, '/poster.jpg');
});

test('legacy tickets remain visible beyond 200, searchable and editable; deleted drafts stay deleted', () => {
  const store = new Store();
  try {
    for (let i = 0; i < 205; i++) store.db.prepare('INSERT INTO tickets VALUES(?,?,?,?)').run(randomUUID(), 'A', JSON.stringify({ ...input, movieTitle: '第' + i + '部' }), i);
    assert.equal(store.shelfList('A').total, 205); assert.equal(store.shelfList('A', { page: 11 }).tickets.length, 5);
    assert.equal(store.shelfList('A', { query: '第0部' }).total, 1);
    assert.equal(store.shelfList('B').total, 0);
    const draftInput = { ...input }; delete draftInput.movieId;
    const draft = store.prepare('A', 'chat-request', draftInput, [input.note]); store.decide('A', draft.id, 'confirm');
    const legacy = store.shelfTicket('A', draft.id); assert.equal(legacy.revision, 1); assert.equal('originalMessages' in legacy, false);
    assert.equal(store.shelfUpdate('A', draft.id, 1, { ...input, note: '更新' }).status, 'ok');
    assert.equal(store.list('A', '更新')[0].note, '更新');
    assert.equal(store.shelfDelete('A', draft.id, 2).status, 'ok'); assert.equal(store.decide('A', draft.id, 'confirm').status, 'not_found');
  } finally { store.close(); }
});

test('LINE ID token is verified server-side; expired, foreign audience and forged identity rejected', async () => {
  let now = Date.now(); let profile = { iss: 'https://access.line.me', aud: '123', sub: 'U' + 'a'.repeat(32), exp: Math.floor(now / 1000) + 1800, name: '旅人' }; let verifyBody;
  const auth = new ShelfAuth({ channelId: '123', baseUrl: 'https://example.com', now: () => now, fetcher: async (url, options) => { assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify'); verifyBody = options.body; return { ok: true, json: async () => profile }; } });
  const req = { headers: {}, socket: {} }; let cookie; const res = { setHeader: (key, value) => { cookie = value; } };
  const session = await auth.loginLine(req, res, 'token'.repeat(10)); assert.equal(verifyBody.get('client_id'), '123'); assert.equal(session.user.displayName, '旅人'); assert.match(cookie, /HttpOnly.*Secure/);
  profile.aud = '999'; await assert.rejects(auth.loginLine(req, res, 'token'.repeat(10)), { status: 401 });
  profile.aud = '123'; profile.exp = 0; await assert.rejects(auth.loginLine(req, res, 'token'.repeat(10)), { status: 401 });
  const link = auth.createEntry('A'); now += 120001; assert.throws(() => auth.redeemEntry(req, res, new URL(link).hash.slice(7)), { status: 401 });
});

test('signed LINE shelf command issues a URI entry without AI calls; unsigned rejected', async t => {
  const { call, replies } = await setup(t);
  const raw = JSON.stringify({ events: [{ type: 'message', webhookEventId: randomUUID(), replyToken: 'reply', source: { type: 'user', userId: 'signed-user' }, message: { type: 'text', text: '我的票匣' } }] });
  assert.equal((await call('/webhook', { method: 'POST', body: raw })).status, 401);
  const signature = createHmac('sha256', 'test-secret').update(raw).digest('base64');
  assert.equal((await call('/webhook', { method: 'POST', headers: { 'x-line-signature': signature }, body: raw })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(replies.length, 1); assert.match(replies[0][0].quickReply.items[0].action.uri, /\/tickets\/#entry=/);
});

test('static shell has restricted CSP and demo never exposes server data', async t => {
  const { call, shelf } = await setup(t); const response = await call('/tickets/?preview=1'); assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /object-src 'none'/);
  let status;
  assert.equal(await shelf.handle({ url: 'http://%' }, { writeHead: value => { status = value; }, end: () => {} }), true);
  assert.equal(status, 400);
  assert.equal((await call('/tickets/../src/store.mjs')).status, 404); assert.equal((await call('/api/tickets?preview=1')).status, 401);
  const config = await (await call('/api/config')).json(); assert.deepEqual(config, { liffId: '', lineLoginReady: false });
});

test('TMDB catalog validates poster paths and provides manual-entry fallback', async () => {
  assert.deepEqual(await new ShelfCatalog().search('電影'), { available: false, movies: [] });
  const source = new ShelfCatalog({ token: 'server-token', fetcher: async (url, options) => { assert.equal(options.headers.Authorization, 'Bearer server-token'); return { ok: true, json: async () => ({ results: [{ id: 1, title: '電影', poster_path: '//evil.example/x.jpg' }, { id: 2, title: '成人', adult: true }] }) }; } });
  const result = await source.search('電影'); assert.equal(result.movies.length, 1); assert.equal(result.movies[0].posterPath, null);
});

test('MINI App uses canonical link with matching channel configuration', () => {
  const env = { GEMINI_API_KEY: 'fixture', LIFF_ID: '2012222030-OFWyoaEd', LINE_LOGIN_CHANNEL_ID: '2012222030', LIFF_APP_TYPE: 'miniapp' };
  const settings = config(env);
  const auth = new ShelfAuth({ channelId: settings.loginChannelId, baseUrl: 'https://example.com' });
  const shelf = new TicketShelf({ auth, liffId: settings.liffId, liffAppType: settings.liffAppType });
  assert.equal(shelf.entry('A').actions[0].uri, 'https://miniapp.line.me/2012222030-OFWyoaEd');
  assert.equal(auth.entries.size, 0);
  assert.throws(() => config({ ...env, LINE_LOGIN_CHANNEL_ID: '2012222034' }), /同一個環境/);
  assert.throws(() => config({ ...env, LIFF_APP_TYPE: 'https://evil.invalid' }), /LIFF_APP_TYPE/);
  assert.throws(() => config({ ...env, LIFF_ID: '' }), /成對設定/);
});
