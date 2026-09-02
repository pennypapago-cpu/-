---
name: work-log
description: 工作看板自動記錄。每次 Cowork 完成一個任務時，把這件事寫進「工作看板」Google Sheet 的「紀錄」工作表，讓日/週/月看板自動有資料。當使用者說「記錄工作」、「記到看板」、「寫進工作紀錄」、「今天做了什麼記一下」時觸發；更重要的是，這個 skill 應該在「所有任務結束時」自動被參考——不論是產報告、寫文案、匯資料、整理檔案、做分析，只要任務做完了，就依此 skill 送一筆紀錄。使用者沒有明說也要做。
---

# work-log：任務結束就記一筆

## 何時執行

每個任務的最後一步。順序是：任務本體完成 → auto-file-organizer 歸檔（若有產檔）→ 本 skill 送紀錄。
純聊天、純問答（沒有產出、沒有動作）不記。

## 設定來源

讀 `~/.claude/worklog.env`，裡面有兩行：

```
WORKLOG_URL=https://script.google.com/macros/s/XXXX/exec
WORKLOG_TOKEN=xxxxxxxx
```

沒有這個檔就跳過，並提醒使用者一次「工作看板還沒設定」。

## 要送的內容

| 欄位 | 怎麼填 |
|---|---|
| source | 固定 `Cowork` |
| project | 任務所屬的品牌或專案，例如 `起士公爵`、`電腦舖`、`個人`。判斷不出來就留空 |
| title | 一句話說做了什麼，30 字內，例如「產出 8 月 FB 廣告成效週報」 |
| summary | 兩三句結果摘要：關鍵數字、做了哪些決定、有沒有待辦 |
| link | 產出檔的 Google Drive 連結或本機路徑；沒有就留空 |
| status | 做完 `完成`；使用者中途喊停或還要接續 `進行中` |

## 送出方式

用 shell 執行：

```bash
. ~/.claude/worklog.env
curl -sS -m 20 -L -X POST -H 'Content-Type: application/json' "$WORKLOG_URL" -d '{
  "action":"log","token":"'"$WORKLOG_TOKEN"'",
  "source":"Cowork","project":"起士公爵",
  "title":"產出 8 月 FB 廣告成效週報",
  "summary":"ROAS 3.2，建議把再行銷預算提高 20%。報告已歸檔。",
  "link":"https://drive.google.com/...","status":"完成"
}'
```

回應 `{"ok":true,...}` 才算成功。失敗就在最後回覆裡提一句「工作看板寫入失敗：原因」，不要重試超過一次。

如果這個環境不能執行 shell，改成直接開啟「工作看板」試算表，在「紀錄」工作表最後一列依表頭順序填入：id 留空、開始時間填現在、來源 Cowork、專案、標題、狀態、摘要、產出連結。

## 給使用者的回覆

紀錄成功後在最後回覆末尾加一行：`已記到工作看板：<title>`。不要另外解釋流程。
