---
name: morning-brief
description: 工作看板早晨簡報。讀「工作看板」的任務與昨日紀錄，整理出今天的工作清單，寫回看板讓手機一開就看到。當使用者說「今天要做什麼」、「早晨簡報」、「整理今日清單」、「幫我排今天」、「看板簡報」時觸發；也由 Cowork 排程任務每個工作日早上自動呼叫。
---

# morning-brief：每天早上整理今日清單

## 設定

讀 `~/.claude/worklog.env`（`WORKLOG_URL`、`WORKLOG_TOKEN`）。沒有就停止並提醒「工作看板還沒設定」。

## 步驟

1. 取資料：

```bash
. ~/.claude/worklog.env
curl -sS -m 20 -L -X POST -H 'Content-Type: application/json' "$WORKLOG_URL" \
  -d '{"action":"brief","token":"'"$WORKLOG_TOKEN"'"}'
```

回傳欄位：`overdue`（逾期）、`today`（今天到期）、`doing`（進行中）、`upcoming`（接下來）、`unscheduled`（未排日期）、`yesterday`（昨日紀錄）、`logs`（今日已有紀錄）。

2. 整理成簡報，繁體中文、純文字、不超過 15 行，結構固定：

```
昨天：一到三句，昨日紀錄做了什麼（來源 Claude Code / Cowork 一起看），沒紀錄就寫「昨天沒有紀錄」。
今天必做：逾期在前、今天到期次之，同日則 A 排前面，最多 5 條，每條「標題（專案，到期日）」，有下一步就接著寫「→ 下一步」。
進行中：正在做的任務，最多 3 條。
建議：一到兩句，例如哪件事拖太久該先做、未排日期的任務要不要排、今天量太多要不要延。有「等待者」的任務卡住超過兩天就點名該去催誰。
```

判斷原則：逾期超過三天要點名；同一專案有多件到期就合併講；未排日期的任務超過 5 件才提醒；當天 A 級任務掛零要直接說出來。不要自作主張改任務的到期日或狀態，只給建議。

3. 寫回看板：

```bash
curl -sS -m 20 -L -X POST -H 'Content-Type: application/json' "$WORKLOG_URL" \
  -d "$(jq -cn --arg t "$WORKLOG_TOKEN" --arg c "$BRIEF_TEXT" '{action:"brief_save",token:$t,content:$c}')"
```

同一天再跑會覆蓋。回應 `{"ok":true,...}` 才算成功。

4. 回覆使用者：直接貼簡報內容，最後一行「已寫入工作看板」。不要解釋流程。

## 排程

在 Cowork 建一個排程任務，每週一到週五早上 07:30，內容就一句：「執行 morning-brief skill」。
