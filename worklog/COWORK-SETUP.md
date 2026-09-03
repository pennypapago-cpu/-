# 給 Cowork 的安裝指令

把下面整段貼進 Cowork（桌面版），它會在你的電腦上完成工作看板的安裝與設定。
只需要跑一次。跑完看板、自動記錄、早晨簡報就全部生效。

---

請幫我安裝「工作看板」系統。程式碼在 GitHub：
https://github.com/pennypapago-cpu/-/tree/master/worklog

我的 Google 試算表「工作看板」：
https://docs.google.com/spreadsheets/d/136z3S0ADQHRda3q8O_B_GFBlBlBuE-oEg0mxIeT0FVc/edit

依序做以下六件事，每做完一件跟我說結果。任何一步失敗就停下來告訴我，不要跳過。

**一、取得程式碼**

從 GitHub 下載這四個檔案到暫存資料夾（用 raw.githubusercontent.com 的原始檔網址）：

- `worklog/Code.gs`
- `worklog/index.html`
- `worklog/skills/work-log/SKILL.md`
- `worklog/skills/morning-brief/SKILL.md`

**二、更新 Apps Script**

用 gas-inject-and-run skill，把 `Code.gs` 的內容注入我的試算表的 Apps Script 專案，取代原本 `程式碼.gs` 的全部內容，然後執行 `setup` 函式。

如果 Apps Script 專案裡還沒有名為 `index` 的 HTML 檔，先建立它；把 `index.html` 的內容貼進去。

`setup` 執行完會在試算表建立「紀錄」「任務」「簡報」「設定」四個工作表，並在執行紀錄印出 TOKEN。把 TOKEN 記下來。

**三、部署網頁應用程式**

在 Apps Script 編輯器：

- 如果從來沒部署過：部署 → 新增部署作業 → 類型選「網頁應用程式」→ 執行身分「我」→ 存取權「所有人」→ 部署。
- 如果已經部署過：部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選「新版本」→ 部署。

複製 `/exec` 結尾的網址記下來。

**四、驗證連線**

用瀏覽器（不要用 shell 的 curl，沙盒的代理會擋掉 script.google.com）開啟：

```
<那個 /exec 網址>?action=ping&token=<那個 TOKEN>
```

頁面要顯示 `{"ok":true,...}` 才算成功。失敗就停下來告訴我看到什麼。

**五、安裝兩個 skill**

把 `work-log` 和 `morning-brief` 兩個資料夾（各含一個 SKILL.md）放到我放其他 skill 的地方，也就是 `auto-file-organizer` 所在的同一層資料夾。

放進去之前，把每個 SKILL.md「設定」段落裡的 `WORKLOG_URL` 和 `WORKLOG_TOKEN` 兩行換成第二、三步拿到的實際值。設定放在 skill 檔裡是刻意的——沙盒的家目錄每次對話重開就清空，存不住 `~/.claude/worklog.env`。

放好後確認 skill 清單裡看得到它們。

**六、建立排程**

建一個 Cowork 排程任務：

- 名稱：工作看板早晨簡報
- 時間：週一到週五 早上 07:30
- 內容：`執行 morning-brief skill`

**最後**

跑一次 morning-brief skill 當作測試，然後把「TOKEN」和「/exec 網址」列給我看，我要拿去設定手機和 claude.ai 的排程。

---

## 這段指令做完之後

Cowork 會給你 TOKEN 和 `/exec` 網址，接著自己做兩件事：

**手機看板**：用瀏覽器開那個 `/exec` 網址，貼一次 TOKEN，加到主畫面。

**claude.ai 早晨推播**（可選，要手機收到通知才需要）：到 claude.ai 的環境設定，選「Default」環境，網路政策加入允許 `script.google.com` 和 `script.googleusercontent.com`，環境變數加 `WORKLOG_URL` 和 `WORKLOG_TOKEN`。設定說明在 https://code.claude.com/docs/en/claude-code-on-the-web
