# 正式 LIFF 登入設定

目前使用 **LINE MINI App**。三個 internal channel 是同一個 MINI App 的不同環境，每一組都有自己的 LIFF ID；後端一次只設定一組，不會同時接受其他環境的登入憑證。

## 目前使用的 MINI App

| 環境 | Channel ID | LIFF ID / 狀態 |
| --- | --- | --- |
| Developing | `2012222030` | `2012222030-OFWyoaEd`，保留作開發用途，目前伺服器未使用此環境 |
| Review | `2012222032` | 尚未提供對應 LIFF ID，未啟用 |
| Published | `2012222034` | `2012222034-AVyO2nk3`，目前正式使用 |

[Published MINI App 正式入口](https://miniapp.line.me/2012222034-AVyO2nk3)。LINE Developers 的 **Web app settings** 中 Published Endpoint URL 已確認為 `https://movie-bot-03.136-67-154-252.sslip.io/tickets/`。Bot 與網頁登入都使用 Published 的 ID 配對。

目前的 MINI App 是未認證狀態。Published 為一般使用者使用的環境；認證 MINI App 的審核、標章與進階功能是另外的流程。使用者必須完成自己的 LINE 授權才能讀取私人收藏。

Developing 僅供測試者使用，保留其公開識別碼作開發紀錄。現在伺服器固定使用 Published 的 LIFF ID，因此若要另外測試 Developing，應另設測試部署並配對 Developing 的兩個 ID；不要用 Developing 入口開啟此正式部署後預期它接受不同環境的憑證。Provider 必須與 Zona Movie 一致，才能讀到既有票根。

雲端應用設定：

```dotenv
LIFF_ID=2012222034-AVyO2nk3
LINE_LOGIN_CHANNEL_ID=2012222034
LIFF_APP_TYPE=miniapp
PUBLIC_BASE_URL=https://movie-bot-03.136-67-154-252.sslip.io
```

`LINE_LOGIN_CHANNEL_ID` 沿用程式設定名稱，也適用 MINI App。這不是原 Messaging API 的 Channel ID。目前已使用 Published 那一組的 LIFF URL 與兩個 ID，並確認其 Endpoint URL。之後變更環境時仍須同時替換兩個 ID。不可只替換 Channel ID，也不可假設三組 LIFF ID 的後綴相同。

參考：[MINI App Console 指南](https://developers.line.biz/en/docs/line-mini-app/discover/console-guide/)。以下保留一般 LINE Login LIFF 的自架設定流程。

## LINE Developers

1. 登入 [LINE Developers Console](https://developers.line.biz/console/)，選擇 **Zona Movie 目前所屬的 Provider**。不同 Provider 的使用者 ID 不相同，會導致看不到原本的收藏。
2. 建立 LINE Login channel，App types 包含 Web app；補齊所要求的基本資訊、隱私與條款。若選擇 LINE MINI App，依該產品的開發及公開流程建立，仍須使用同一 Provider。
3. 在 channel 的 LIFF 新增 app，使用下表。不要把 Messaging API 的 Channel ID 當成此處的登入 Channel ID。

| 欄位 | 值 |
| --- | --- |
| LIFF app name | Zona Movie 票匣 |
| Size | Full |
| Endpoint URL | `https://movie-bot-03.136-67-154-252.sslip.io/tickets/` |
| Scopes | `openid`、`profile` |
| Bot link feature | 可依需求設定，不作為本程式驗證身分的依據 |
| Scan QR | 不需要 |
| Module mode | 不需要 |
| Privacy policy | `https://movie-bot-03.136-67-154-252.sslip.io/privacy` |
| Terms of use | `https://movie-bot-03.136-67-154-252.sslip.io/terms` |

4. 記下 **LIFF ID** 與該 **LINE Login／MINI App Channel ID**。兩者是公開識別碼；不要提供 Channel secret 或 access token。
5. 在 Secret Manager 的應用設定加入下列兩行，重跑 VM startup script 重新載入並重啟：

```dotenv
LIFF_ID=1234567890-abcdefgh
LINE_LOGIN_CHANNEL_ID=1234567890
LIFF_APP_TYPE=liff
```

上方是格式範例，不能直接使用。`PUBLIC_BASE_URL` 維持 `https://movie-bot-03.136-67-154-252.sslip.io`。

6. LINE Login channel 尚為 Developing 時先加入測試者；要讓其他使用者登入，依 LINE Console 流程發布 channel 並確認公開權限。完成後 Bot「我的票匣」按鈕會改指向正式 `https://liff.line.me/<LIFF_ID>`。

## 驗收

- 從 LINE 開啟 LIFF、同意權限後，可看到先前聊天確認儲存的票根。
- 新增心得、關閉再開仍存在；改用另一個 LINE 帳號應看不到這些資料。
- 編輯後聊天查詢讀到最新心得；刪除前有確認步驟。
- 若登入失效，回聊天室重新開啟；不要複製 ID token 或傳給其他人。

## 身分與資料

LIFF SDK 只取得 ID token；後端送交 LINE `/oauth2/v2.1/verify` 驗證，檢查 issuer、audience、到期時間與 subject，再建立一小時內的 HttpOnly session。每個查詢都使用後端 session 的 actor，前端不能指定其他使用者 ID。修改需通過 Origin 與 CSRF 檢查。

未設定 LIFF 時，Bot 只對已驗簽的一對一 LINE 事件發送一次性隨機入口，兩分鐘失效、同一使用者的新入口會取代舊入口；token 放在 URL fragment，前端立即移除並兌換 session。這仍是持有連結即可登入的入口，請勿轉傳。伺服器只在記憶體保留其雜湊，重啟即失效。

只有 `?preview=1` 是公開示範：前端獨立的虛構資料，不能略過後端身分驗證，也不會寫入正式 SQLite。

參考：[LIFF 註冊](https://developers.line.biz/en/docs/liff/registering-liff-apps/)、[安全使用使用者資料](https://developers.line.biz/en/docs/liff/using-user-profile/)、[Provider 與使用者 ID](https://developers.line.biz/en/docs/messaging-api/getting-user-ids/)。


## 登入導回頁面

LINE 的初次導回 URL 可能含 SDK 初始化使用的參數。程式必須先完成 `liff.init()`，再由 SDK 清除 LINE 憑證資訊；不得先刪掉整個 URL fragment。只有 Bot 自己的 `#entry=` 一次性入口會在兌換前移除。即使瀏覽器已有舊 session，也會重新驗證目前的 LINE 身分，避免切換 LINE 帳號後沿用另一個帳號的票匣。

參考：[LIFF 初始化與 URL 處理](https://developers.line.biz/en/docs/liff/developing-liff-apps/)。
