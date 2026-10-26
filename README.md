# 票匣 · Movie Companion Bot 04 LIFF

把看過的電影、一起看的人，以及散場後的心情，收進 LINE 裡的私人票匣。

本版延續 [Bot 03](https://github.com/zonawang/movie-companion-bot-03) 的 Google ADK、附近影院與電影場次功能，新增行動版票匣網頁；聊天室與網頁共用 SQLite，不需搬移既有票根。

## 可以做什麼

- 在 Zona Movie 輸入「我的票匣」，開啟私人收藏。
- 以片名、心得、影院或同伴搜尋，依年份篩選並分頁查看完整收藏。
- 新增電影與觀影日期、影院、同伴及心得；也能編輯或刪除。
- 搜尋 TMDB 電影並選擇海報，或手動填寫片名。心得原文保留，這些操作不呼叫 Gemini。
- 舊版聊天確認儲存的票根會直接顯示；網頁修改後，聊天查詢也會讀到最新內容。

## 線上入口

- [票匣](https://movie-bot-03.136-67-154-252.sslip.io/tickets/)：私人內容需登入。
- [示範票匣](https://movie-bot-03.136-67-154-252.sslip.io/tickets/?preview=1)：虛構電影，資料只在當前頁面記憶體，重新整理即還原。
- [Zona Movie LINE 聊天室](https://line.me/R/ti/p/@796qcwyz)

目前尚未建立 LIFF channel，因此先使用已驗證 LINE webhook 發出的兩分鐘、單次專屬入口。請勿轉傳此入口。登入有效一小時，服務重啟後需重新開啟。

正式 LIFF 登入程式已實作，需在 **Zona Movie 所屬的同一個 Provider** 建立 LINE Login channel／LIFF app，再設定 `LIFF_ID` 與 `LINE_LOGIN_CHANNEL_ID`。尚未填入前，不會假裝已完成 LIFF 註冊。[完整設定](docs/liff-setup.md)

## 本機執行

需要 Node.js 24.13 以上、npm 11.8 以上。

```bash
npm ci --ignore-scripts
npm run preview
```

開啟 `http://127.0.0.1:3104/tickets/?preview=1` 即可操作示範票匣，不需要金鑰。這個 preview server 不連真實 Bot、不保存資料。

啟動正式 Bot：複製 `.env.example` 為 `.env`，填入既有 Gemini、LINE、TMDB 設定；`PUBLIC_BASE_URL` 填對外 HTTPS origin，`SQLITE_PATH` 指向既有資料庫，然後：

```bash
npm start
```

`PUBLIC_BASE_URL` 不包含 `/tickets/`；不可從請求 Host 標頭推導登入來源。正式環境透過 HTTPS 取得 Secure、HttpOnly、SameSite=Lax cookie。本機 loopback 可用 HTTP。

## 驗證

```bash
npm test
npx playwright install chromium
npm run test:browser
```

測試涵蓋既有 ADK／地圖／場次，以及票匣身分驗證、使用者隔離、CSRF、日期、重複儲存、多頁收藏、舊票根相容與編輯衝突。瀏覽器測試檢查桌面與手機版、新增／編輯／刪除、篩選、心得原文與 XSS；GitHub Actions 會保留畫面截圖。

## 程式入口

| 路徑 | 用途 |
| --- | --- |
| `public/` | 不需要打包的票匣 HTML、CSS、JavaScript |
| `src/shelf.mjs` | 私人票匣 API、欄位驗證與靜態檔案 |
| `src/shelf-auth.mjs` | LINE ID token 驗證、短效入口、session 與 CSRF |
| `src/shelf-catalog.mjs` | TMDB 搜尋及伺服器確認電影資料 |
| `src/store.mjs` | 既有 SQLite、收藏分頁、版本衝突及重試去重 |
| `src/app.mjs` | LINE webhook 與票匣共用 HTTP server |

[LIFF 設定](docs/liff-setup.md) · [部署](docs/deployment.md) · [隱私](docs/privacy.md) · [使用條款](docs/terms.md) · [資料來源](docs/credits.md)
