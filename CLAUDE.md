# 給下一個 Claude 的交接

在這個 repo 開的 Claude Code session 會自動讀到這一份。**不是**在 repo 裡工作的 AI
（Cowork、ChatGPT、Gemini…），請它先讀這兩個檔就接得上：

- `CLAUDE.md`（這一份）：規矩與禁忌，先讀
- `worklog/README.md`：每個功能怎麼運作、當初為什麼這樣決定

repo 是 **公開的**，任何人不用登入都讀得到。所以下面第三條（憑證不進 repo）不是潔癖，
是這個 repo 的前提。

Penny 的個人工作看板。程式全都在 `worklog/`：`Code.gs`（Apps Script 後端）、
`index.html`（整個介面，單一檔案）、`test/`（七支測試）、`skills/`（Cowork 用）、
`hooks/`（Claude Code 用）。細節看 `worklog/README.md`，那份一直跟著程式更新。

回話用繁體中文。程式註解也是中文，而且寫「為什麼」不寫「做了什麼」。

## 動手之前要知道的三件事

**1. 這個沙盒碰不到試算表。** 代理擋掉 `script.google.com` 與 `docs.google.com`（403），
所以你不能部署、不能寫資料、不能實測 API。需要動試算表的事，寫成可以直接貼給 Cowork
的指令交給她，不要自己硬試。

**2. 合併不等於上線。** master 綠了以後，看板還是舊的，要 Penny 請 Cowork 跑
`update-worklog` 才會把新的 `Code.gs` / `index.html` 推上 Apps Script。
每次 merge 完都要提醒她這一步，不然她會以為改好了卻看不到。

**3. 憑證絕對不進 repo。** TOKEN、`/exec` 網址、LINE 的 secret 與 access token，
文件裡一律寫 `XXXX`、`你的TOKEN` 這種佔位字。這個 repo 有 Cloudflare Pages 自動部署，
推上去等於多一個外洩面。

## 改東西的規矩

- **七支測試都要過**：`for f in worklog/test/*.test.js; do node "$f" || break; done`
- **每個修好的 bug 都要留一條守門**，而且要先確認它會在修好之前的版本上失敗
  （測試都吃 `process.argv[2]` 當來源檔，可以直接跑舊版）。沒驗過就不算守門。
- **守門要寫成通則**，不要只釘住這一次的症狀。過去抓到的：CSS 類別撞名、重複的
  函式名、寫死 px 的字級與 flex 基準寬度、兩個側欄項目共用同一個圖示。
- **動到畫面就用真的瀏覽器看**。Playwright 在 `/opt/pw-browsers/chromium`：
  `chromium.launch({executablePath:'/opt/pw-browsers/chromium',
  args:['--headless=new','--no-sandbox'],ignoreDefaultArgs:['--headless=old']})`。
  字級 100% 與 200%（她的預設）都要看，並且用程式檢查有沒有元素溢出容器。
- **README 跟程式同一個 PR 改**。它記的是決策和原因，不是功能列表。

## 送出去的流程

在 `claude/personal-work-dashboard-majkc0` 上開發 → 推上去 → 開草稿 PR →
等 Cloudflare Pages 綠燈 → 轉正式 → squash merge → 提醒 Penny 跑 `update-worklog`。

## 每年要記得

`Code.gs` 的 `HOLIDAYS` 是照抄的國定假日表，目前只到 2027。年底要補下一年，
順手更新 `HOLIDAY_YEARS`。沒補的話畫面會自己說「XXXX 年的假日還沒更新」。
