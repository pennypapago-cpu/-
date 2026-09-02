# 專案內容

兩個獨立的單一 HTML 檔，都不需要建置工具，直接用瀏覽器開或丟上 GitHub Pages 就能跑。

## `index.html` — 京站門巿營運儀表板

門市營運數據儀表板，含 KPI 卡片、日期區間篩選與 Gemini AI 分析助理。

## `ai-tutor.html` — AI 口語陪練外教

可客製人設、課程與聲音的語音對話練習 App。

### 怎麼用

1. 用 **Chrome 或 Edge** 開啟（語音辨識需要 Web Speech API）。
2. 左側貼上 [Gemini API Key](https://aistudio.google.com/apikey)。Key 只存在瀏覽器的 `sessionStorage`，關掉分頁就清除。
3. 選語言、程度、情境、人設、音色。
4. 按麥克風，直接開口說話。

用網址開啟時需要 **HTTPS 或 localhost**，瀏覽器才會給麥克風權限。用 `file://` 直接開檔也可以。

### 架構

| 模組 | 技術 | 費用 |
|---|---|---|
| 耳朵 ASR | Web Speech API（瀏覽器原生） | 免費 |
| 大腦 LLM | Gemini `streamGenerateContent`（SSE 流式） | 依 API 計費 |
| 嘴巴 TTS | `speechSynthesis`（瀏覽器原生） | 免費 |

三個模組本身不難，難的是讓對話「絲滑」：

- **流式響應** — 不等 LLM 生成完整段。邊收字邊切句，湊滿一個完整句子就立刻丟給 TTS 排隊唸。
- **延遲判停（endpointing）** — 用靜音計時器判斷一輪講完了沒。太短會插使用者的話，太長顯得遲鈍，預設 900ms，可調。
- **插話打斷（barge-in）** — 朗讀時麥克風不關，偵測到使用者開口就同時 `speechSynthesis.cancel()` 停嘴、`AbortController.abort()` 中斷生成，並把已唸出口的半句寫回對話歷史。
- **回音防護** — 外放時麥克風會收到 TTS 自己的聲音而誤判成插話。用文字重疊比對過濾掉；戴耳機可關閉，打斷會更靈敏。

### 功能

- 8 種語言、CEFR A1–C1 程度、9 種情境課程（可自訂）
- 3 種外教人設（可自訂）、音色／語速／音調可調
- 三段糾錯模式：即時糾錯／溫和引導／完全不糾錯
- 免持連續模式與按住說話（PTT，支援空白鍵）
- 即時延遲指標：首字延遲、首次出聲、打斷次數
- 練習結束產出繁中報告（文法問題、用詞升級、流利度觀察、下次建議），可複製或下載 `.md`
- 不支援語音的瀏覽器可改用打字輸入，外教一樣會說話
- 設定存 `localStorage`，下次開啟自動帶回

### 測試

`tests/voice-loop.test.js` 把 ASR、TTS、Gemini API 三個外部相依換成假的，在無頭瀏覽器裡跑完整對話流程，驗證真實麥克風測不到的邏輯（判停、流式朗讀、插話打斷、回音防護）。日常使用不需要跑，改到對話狀態機時才需要：

```bash
npm i -g playwright && npx playwright install chromium
node tests/voice-loop.test.js
```
