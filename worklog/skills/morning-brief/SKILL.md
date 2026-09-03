---
name: morning-brief
description: 工作看板早晨簡報。讀「工作看板」的任務與昨日紀錄，整理出今天的工作清單，寫回看板讓手機一開就看到。當使用者說「今天要做什麼」、「早晨簡報」、「整理今日清單」、「幫我排今天」、「看板簡報」時觸發；也由 Cowork 排程任務每個工作日早上自動呼叫。
---

# morning-brief：每天早上整理今日清單

## 設定

安裝後把下面兩行換成實際值再存檔。這兩個值就住在這個檔案裡，因為沙盒的家目錄
每次對話重開就清空，`~/.claude/worklog.env` 存不住。

```
WORKLOG_URL  = https://script.google.com/macros/s/XXXX/exec
WORKLOG_TOKEN = 你的TOKEN
```

還是 `XXXX` 就停止，回覆「工作看板還沒填 URL 和 TOKEN」。

## 一定要用瀏覽器，不要用 curl

沙盒的網路代理擋掉 `script.google.com`（403），shell 的 `curl` 一定失敗，不要重試。
改用瀏覽器開網址，Apps Script 的 `doGet` 收 query 參數，回應是純 JSON 顯示在頁面上。

## 步驟

**一、取資料。** 瀏覽器開啟：

```
<WORKLOG_URL>?action=brief&token=<WORKLOG_TOKEN>
```

回傳欄位：`overdue`（逾期）、`today`（今天到期）、`doing`（進行中）、`upcoming`（接下來）、
`unscheduled`（未排日期）、`yesterday`（昨日紀錄）、`logs`（今日已有紀錄）。

任務欄位有 title、project、due、priority、status、next（下一步）、waiting（等待者）；
紀錄欄位有 title、project、source、summary、start。
優先級是 A 優先處理（直接帶來結果）、B 推進型（讓事情往前走）、C 維護型（不做會出事）。

頁面不是 `{"ok":true,...}` 就重開一次；再失敗就回覆「工作看板連線失敗：<內容>」並結束。

**二、整理成簡報**，繁體中文、純文字、不超過 15 行，結構固定：

```
昨天：一到三句，昨日紀錄做了什麼（Claude Code 與 Cowork 一起看），沒紀錄就寫「昨天沒有紀錄」。
今天必做：逾期在前、今天到期次之，同一天則 A 排前面，最多 5 條，每條「標題（專案，到期日）」，有 next 就接著寫「→ 下一步」。
進行中：正在做的任務，最多 3 條。
建議：一到兩句，例如哪件拖太久該先做、未排日期的要不要排、今天量太多要不要延。
```

判斷原則：逾期超過三天要點名；同一專案多件到期合併講；未排日期超過 5 件才提醒；
當天 A 級（優先處理）任務掛零要直接說出來；有 waiting 的任務卡超過兩天就點名該去催誰。
只給建議，絕不修改任何任務的日期或狀態。

**三、寫回看板。** 把整篇簡報做 URL 編碼（換行編成 `%0A`），瀏覽器開啟：

```
<WORKLOG_URL>?action=brief_save&token=<WORKLOG_TOKEN>&content=<編碼後的簡報>
```

同一天再跑會覆蓋。頁面出現 `{"ok":true,...}` 才算成功。簡報控制在 15 行內，
編碼後的網址就不會超過長度限制。

**四、回覆使用者。** 直接貼出簡報全文，最後一行「已寫入工作看板」；
寫回失敗則最後一行「簡報產生了但寫回失敗：<原因>」。不要解釋流程。

## 排程

Cowork 排程任務，週一到週五早上 07:30，內容一句：「執行 morning-brief skill」。
