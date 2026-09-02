#!/usr/bin/env bash
# Claude Code hook → 工作看板
# 用法（由 settings.json 的 hooks 呼叫，stdin 是 Claude Code 給的 JSON）：
#   claude-code-worklog.sh start    # SessionStart：新增一列「進行中」
#   claude-code-worklog.sh prompt   # UserPromptSubmit：把第一句提示當標題
#   claude-code-worklog.sh stop     # Stop：標記「完成」並寫入最後回覆摘要
#
# 設定檔 ~/.claude/worklog.env：
#   WORKLOG_URL=https://script.google.com/macros/s/XXXX/exec
#   WORKLOG_TOKEN=xxxxxxxx
#
# 任何失敗都靜默結束（exit 0），絕不擋住 Claude Code。
set -u

CFG="${WORKLOG_CONFIG:-$HOME/.claude/worklog.env}"
[ -f "$CFG" ] && . "$CFG"
[ -z "${WORKLOG_URL:-}" ] || [ -z "${WORKLOG_TOKEN:-}" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

EVENT="${1:-}"
INPUT="$(cat)"
SID="$(jq -r '.session_id // empty' <<<"$INPUT")"
CWD="$(jq -r '.cwd // empty' <<<"$INPUT")"
PROJECT="$(basename "${CWD:-unknown}")"
[ -z "$SID" ] && exit 0

case "$EVENT" in
  start)
    PAYLOAD="$(jq -cn --arg t "$WORKLOG_TOKEN" --arg s "$SID" --arg p "$PROJECT" \
      '{action:"log", token:$t, session_id:$s, source:"Claude Code", project:$p, title:$p, status:"進行中"}')"
    ;;
  prompt)
    PROMPT="$(jq -r '.prompt // empty' <<<"$INPUT" | head -c 300)"
    PAYLOAD="$(jq -cn --arg t "$WORKLOG_TOKEN" --arg s "$SID" --arg p "$PROJECT" --arg q "$PROMPT" \
      '{action:"log", token:$t, session_id:$s, source:"Claude Code", project:$p, status:"進行中", prompt:$q}')"
    ;;
  stop)
    TP="$(jq -r '.transcript_path // empty' <<<"$INPUT")"
    SUMMARY=""
    if [ -n "$TP" ] && [ -f "$TP" ]; then
      # 取最後一則 assistant 文字回覆的最後 300 字
      SUMMARY="$(jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' "$TP" 2>/dev/null \
        | tail -n 12 | tr '\n' ' ' | sed 's/  */ /g' | tail -c 300)"
    fi
    PAYLOAD="$(jq -cn --arg t "$WORKLOG_TOKEN" --arg s "$SID" --arg p "$PROJECT" --arg m "$SUMMARY" \
      '{action:"log", token:$t, session_id:$s, source:"Claude Code", project:$p, status:"完成", summary:$m}')"
    ;;
  *)
    exit 0
    ;;
esac

# 背景送出，不讓 Claude Code 等網路
( curl -sS -m 20 -L -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$WORKLOG_URL" >/dev/null 2>&1 ) &
exit 0
