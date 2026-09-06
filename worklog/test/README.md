# 測試

`Code.gs` 的純邏輯測試。用假的 SpreadsheetApp 跑，不會碰到真的試算表。

```bash
node test/board.test.js      # 看板聚合、專案總覽、產出資料庫、專案池建議順序、統計
node test/migrate.test.js    # 舊版「任務」表升級（插入下一步/等待者、高中低→A/B/C）
node test/drag.test.js       # index.html 拖曳換欄、「移到」按鈕、日曆純函式、CSS 類別撞名
node test/perf.test.js       # 一次請求讀幾次試算表（介面順不順的關鍵）
node test/sync.test.js       # 前端就地分欄與後端 board_ 是否一致
node test/cache.test.js      # 切一次頁面要打幾次伺服器（快取保鮮期、背景預抓）
node test/line.test.js       # LINE webhook：誰可以寫進來、一則訊息怎麼變成一件任務
```

改完 `Code.gs` 或 `index.html` 七支都要過。`migrate.test.js` 特別重要：它驗證既有資料在加欄位後不會錯位。

`perf.test.js` 數的是 `getValues()` 的次數。Apps Script 每一次讀表都是一趟慢的 API，
一個 `board` 請求本來要讀五次（任務兩次、紀錄三次），介面按一下要等兩秒就是這樣來的。
現在同一次請求內每張表只讀一次。改動 `Code.gs` 時如果這個數字跳上去，就是又寫回去了。

`drag.test.js` 最後一段掃 CSS：卡片會輸出的修飾類別（`now`、`over`、`live`…）不可以跟
任何「裸類別且 position 是 absolute/fixed」的規則同名。曾經出過的狀況是日曆的現在時間線
叫 `.now`，而今天到期的卡片日期是 `class="dd now"`，那條 `left:0;right:0` 的紅線就套到
卡片上，橫貫整個畫面。

`sync.test.js` 是唯一同時載入 `Code.gs` 與 `index.html` 的測試。前端為了「按下去即時反應」
自己算了一次分欄（`applyTask`），後端 `board_` 也算一次；兩邊走鐘畫面就會跟伺服器對不上。
它拿同一批資料餵兩邊比對分欄與排序。曾經抓到的問題：到期日與優先級都相同時，兩邊的
平手順序不一樣，導致伺服器回應一到畫面就跳一下——後來兩邊都補上以 id 定序。

`cache.test.js` 數的是「切一次頁面打了幾次伺服器」。Apps Script 一趟一兩秒，
使用者感覺到的慢全部在那裡，不在畫面渲染。它釘住四件事：看過的頁面一分鐘內零請求、
背景預抓過的頁面切過去零請求、寫入之後別頁的快取要作廢、沒有時間戳的快取視同過期。

第二條特別容易壞得很安靜：預抓存的鍵必須跟頁面實際會讀的鍵一模一樣，否則抓了也讀不到，
畫面照樣會動、使用者照樣要等，而且沒有任何錯誤訊息。所以預抓和真正切頁共用同一組
`vkey()` / `fetchView()`。

`line.test.js` 最在意的是「誰可以寫進來」。Apps Script 讀不到 request header，
LINE 的簽章驗不了，擋人的只剩網址上那段字串和 userId 兩道，所以兩道都各有一條
測試釘住——把任何一道拿掉都會有測試紅掉。另外釘住「壞掉也要回 200」：
回非 200 會被 LINE 重送，同一句話就變成好幾張卡片。
