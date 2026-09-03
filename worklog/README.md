# 工作看板

個人每日／每週／每月工作看板。資料放在 Google Sheet，Claude Code 與 Cowork 做完的事自動寫進去，手機和桌面都能看、能排任務。

- 試算表：<https://docs.google.com/spreadsheets/d/136z3S0ADQHRda3q8O_B_GFBlBlBuE-oEg0mxIeT0FVc/edit>
- 後端＋介面：Apps Script（本資料夾的 `Code.gs`、`index.html`、`appsscript.json`）
- 自動記錄：`hooks/`（Claude Code）、`skills/work-log/`（Cowork）

## 安裝

最快的方式：把 `COWORK-SETUP.md` 的指令貼進 Cowork，它會在你的電腦上完成全部安裝。手動步驟見下方各節。

## 資料結構

「紀錄」一列一件事，「任務」一列一個待辦。日／週／月看板是從「紀錄」依時間範圍聚合出來的，不用另外維護。

| 工作表 | 欄位 |
|---|---|
| 紀錄 | id, 開始時間, 結束時間, 來源(Claude Code / Cowork / 手動), 專案, 標題, 狀態, 摘要, 產出連結, session_id, 任務id, 檔案位置 |
| 任務 | id, 建立時間, 標題, 專案, 到期日, 優先(A/B/C), 狀態(待辦/進行中/完成/取消), 下一步, 等待者, 預估時數, 備註, 完成時間 |
| 簡報 | 日期, 產生時間, 內容（早晨簡報，一天一列） |
| 設定 | TOKEN |

## 部署（做一次）

1. 開試算表 → 擴充功能 → Apps Script。
2. 把 `Code.gs` 內容貼進預設的 `程式碼.gs`；新增「HTML」檔命名 `index`，貼上 `index.html`。
   專案設定 → 勾「在編輯器中顯示 appsscript.json」，把 `appsscript.json` 貼上（時區與存取設定）。
   （在 Cowork 也可以用 `gas-inject-and-run` skill 注入。）
3. 在編輯器選 `setup` 執行一次，授權。執行紀錄會印出 `TOKEN`，「設定」工作表也會有。
4. 部署 → 新增部署作業 → 類型「網頁應用程式」→ 執行身分「我」、存取權「所有人」→ 部署。複製 `/exec` 網址。
5. 手機瀏覽器開 `/exec` 網址，貼一次 TOKEN，加到主畫面。

存取權設「所有人」是為了讓 curl（Claude Code hook）能打得進來；網頁與 API 都靠 TOKEN 擋。TOKEN 外洩就到 Apps Script「專案設定 → 指令碼屬性」改 `TOKEN`，重跑 `setup`，手機重新貼一次。

## 各頁在做什麼

| 頁面 | 內容 |
|---|---|
| 每日看板 | 三欄：AI 正執行、今日、明日。在哪一欄按「＋ 新增任務」，日期就跟著那一欄；正執行欄新增的直接標進行中 |
| 專案總覽 | 日曆式的日／週／月，可往前往後翻。上方全天列是排定的任務，時間軸是實際跑過的紀錄 |
| AI 專案池 | 每個專案還剩什麼、建議先做哪十件（附理由）、昨天實際執行的紀錄 |
| 資料庫 | Claude Code、Cowork、手動做出來的東西的網址，可依來源過濾 |
| 完成項目 | 那段期間實際做完了什麼，附產出連結（可點）與檔案位置（點一下複製）。可切本週／本月／全部 |
| 設定 | 試算表連結、TOKEN、自動記錄的來源 |

建議順序的排法：逾期最急（越久越前面），已經開工的往前拉，再看 A/B/C；卡在別人身上（有等待者）的往後排，因為自己動不了。

## 專案總覽的日曆

參考 Google 日曆的排法。日與週是時間軸：上方全天列放當天到期的任務（依 A/B/C 上色，完成的畫刪除線），下方依實際起訖時間鋪出「紀錄」——也就是 Claude Code 與 Cowork 真的跑了什麼、跑了多久。計畫與實際疊在同一張圖上。

時間軸範圍預設 8 點到 19 點，會自動往外擴到蓋住當天最早與最晚的紀錄。同一時段重疊的紀錄並排不互蓋。還沒結束的紀錄畫成虛線框，今天那欄有一條紅色的現在時間線。

月是格子，每格最多顯示三件任務，其餘收成「還有 N 件」，並標當天有幾筆紀錄。

## 統計列與早晨簡報

底部那條統計列（已完成任務、優先任務占比、專注時間、本週進度）預設不顯示，
要看到右上角「＋ 新增任務」旁邊的 ▾ 選單裡按「顯示統計列」。開關記在這台裝置。
那些數字在「目標追蹤」頁有更完整的版本。

早晨簡報原本住在那條列子的最左格，統計列收起來後改放在日期列下面一行——不然
每天跑的 morning-brief 就沒地方顯示了。

## 完成項目

把兩個來源合在一起：狀態為完成的「任務」，以及 Claude Code / Cowork 送進來的「紀錄」。
紀錄如果掛在某個任務底下（`task_id`），就不重複列那個任務，以紀錄為準——它才有連結。

每一項顯示產出連結（可點開）與檔案位置（本機路徑點不開，做成點一下複製）。這兩欄由
`work-log` skill 在任務結束時寫入；沒填的話，那筆事後就只剩一行標題。

## 字級

標題列有 A− / A＋，每按一次加減一成，範圍 100%–260%，預設 200%。設定頁也有一組，
手機標題列擠的時候用那邊。設定存在這台裝置，手機和桌機可以各自設不同大小。

做法是所有字級都用 `rem`，縮放只改 `html` 的 `font-size`（`--z`）。跟文字綁在一起的
尺寸——頭像、圖示鈕、進度環、日期圓底、側欄寬度、日曆一小時的高度——也一起換算，
不然字放大會被容器切掉。`drag.test.js` 會檢查沒有漏掉的 px 字級。

## 卡片長相

卡片上不放專案與優先級的標籤，太佔空間。優先級改成左側一條色帶（A 紅、B 橘、C 藍，滑過去有提示），專案縮成「下一步」那行前面的小字。資訊都在，但一張卡從四行變三行。

## 刪除任務

點卡片的「編輯」，視窗左下有「刪除」，要再確認一次。刪除是把狀態設成「取消」——
任務會從每個頁面消失，但試算表裡那一列留著，翻歷史還找得到。真的想清掉就直接在
試算表刪那一列。

刪除刻意不放在卡片的動作列上，那排按鈕在手機是常駐顯示的，誤按的代價太大。

## 卡片移動

桌機直接把卡片拖到別欄：丟進「AI 正執行工作」＝狀態改進行中，丟進「今日」「明日」＝改到期日；從執行中拖出來會一併退回待辦。

手機三欄是上下堆疊的，垂直拖曳會跟頁面捲動打架，所以那邊改點卡片展開動作列，用「移到今日」「移到明日」按鈕，走的是同一段邏輯。

## 優先級

A 優先處理（直接帶來結果）、B 推進型（讓事情往前走）、C 維護型（不做會出事）。
舊資料的 高/中/低 由 `setup()` 自動換成 A/B/C，寫入時也接受中文。

## API

全部以 JSON 為主，`token` 必帶。POST body 或 GET query 都可以。

| action | 參數 | 說明 |
|---|---|---|
| `ping` | | 測 token |
| `log` | source, project, title, status, summary, link, path, task_id, session_id, prompt | 新增紀錄；帶 `session_id` 且已存在則更新那一列 |
| `logs` | range=day/week/month, date=yyyy-MM-dd | 讀紀錄 |
| `tasks` | status=open/待辦/進行中/完成 | 讀任務 |
| `task_add` | title, project, due, priority, next, waiting, estimate, note | 新增任務 |
| `task_update` | id + 任一欄位 | 更新任務；status=完成 會填完成時間 |
| `board` | date | 看板一次要的全部資料：進行中、今日、明日、未排程、專案池、統計、當日簡報 |
| `projects` | range=day/week/month, date | 專案總覽：該區間的任務（扁平一份供日曆用、一份依專案分組）、紀錄、未排日期的 |
| `outputs` | source, all=1 | 產出資料庫：帶產出連結的紀錄；`all=1` 才連沒連結的一起列 |
| `pool` | date | AI 專案池：各專案剩什麼、建議順序（附理由）、昨天執行的內容 |
| `done` | range=day/week/month/all, date | 完成項目：完成的紀錄與任務合併，附產出連結與檔案位置 |
| `brief` | date | 今日資料：逾期、今天到期、進行中、接下來、未排程、今日與昨日紀錄、當日簡報文字 |
| `brief_save` | date, content | 寫入早晨簡報，同日期覆蓋；看板「今日」分頁最上方會顯示 |

驗證：

```bash
curl -sS -L -X POST -H 'Content-Type: application/json' "$WORKLOG_URL" \
  -d '{"action":"ping","token":"'"$WORKLOG_TOKEN"'"}'
```

## Claude Code 自動記錄

在你自己的機器上（不是沙盒）：

```bash
mkdir -p ~/.claude/hooks
cp hooks/claude-code-worklog.sh ~/.claude/hooks/ && chmod +x ~/.claude/hooks/claude-code-worklog.sh
cat > ~/.claude/worklog.env <<'EOF'
WORKLOG_URL=https://script.google.com/macros/s/XXXX/exec
WORKLOG_TOKEN=xxxx
EOF
```

把 `hooks/settings.example.json` 的 `hooks` 區塊合併進 `~/.claude/settings.json`。需要 `jq` 和 `curl`，以及連得到 `script.google.com` 的網路（見下方限制一節）。

一個 session 佔一列：SessionStart 建列（進行中）、第一句提示變成標題、每次回覆結束更新為完成並帶最後回覆摘要。

## Cowork 自動記錄

把 `skills/work-log/` 整個資料夾放進 Cowork 的 skills 目錄，並在 `SKILL.md` 裡把 `WORKLOG_URL` 與 `WORKLOG_TOKEN` 換成實際值。它的觸發方式和 `auto-file-organizer` 一樣：每個任務結束時自動參考，送一筆紀錄到看板。

## 沙盒與網路限制

Cowork 的沙盒有兩個限制，決定了兩個 skill 的寫法：

- **家目錄不留存。** `~` 是每次對話重開就清空的暫存區，所以設定不能放 `~/.claude/worklog.env`，改成寫在各自的 `SKILL.md` 裡（skill 檔本身會留存）。
- **代理擋掉 `script.google.com`（403）。** shell 的 `curl` 一定失敗，所以 skill 全部改用瀏覽器開網址呼叫 API：`doGet` 收 query 參數，回應是純 JSON 顯示在頁面上。瀏覽器不受這個限制，實測可通。

副作用是 TOKEN 會出現在網址與瀏覽器紀錄裡。這是個人工具、單人使用，可以接受；不放心就定期到 Apps Script「專案設定 → 指令碼屬性」換掉 `TOKEN`，重跑 `setup`，再更新兩個 skill 和手機。

同一個 403 也套用在 claude.ai 的遠端環境。Claude Code 若跑在你自己的機器上則不受限，hook 用 curl 沒問題；跑在雲端 session 時 hook 會靜默失敗（設計上就是 `exit 0`，不會擋住 Claude Code），那次工作就不會進看板。

## 早晨簡報

`skills/morning-brief/` 也放進 Cowork 的 skills 目錄，再建一個 Cowork 排程任務：週一到週五 07:30，內容「執行 morning-brief skill」。它會讀任務與昨日紀錄，整理今日清單，寫進「簡報」工作表，手機看板「今日」最上方就會顯示。

另外 claude.ai 上也建了一個同名 Routine（Default 環境，週一至週五 07:30，完成會推播手機）。它要能跑，得先在該環境的網路政策放行 `script.google.com` 與 `script.googleusercontent.com`，並加上 `WORKLOG_URL`、`WORKLOG_TOKEN` 兩個環境變數；未設定前它只會回報環境變數缺漏。兩邊同一天各寫一次簡報時，後寫的覆蓋前面的，不會重複。

## 測試

```bash
node test/board.test.js && node test/migrate.test.js && node test/drag.test.js && node test/perf.test.js
```

改 `Code.gs` 之前先看 `test/README.md`。

## 效能

Apps Script 每讀一次試算表都是一趟慢的 API 呼叫，所以：

- 同一次請求內每張表只讀一次（`CACHE_`）。`board` 原本要讀五次——任務兩次、紀錄三次——現在兩次。
- 寫入時帶 `board=1`，回應直接附上更新後的看板，前端不用再送第二趟。按一個動作從兩趟網路變一趟。

`test/perf.test.js` 把讀表次數釘住，改壞了會被抓到。

## 之後

- 週／月統計圖表。
