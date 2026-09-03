# 測試

`Code.gs` 的純邏輯測試。用假的 SpreadsheetApp 跑，不會碰到真的試算表。

```bash
node test/board.test.js      # 看板聚合、專案總覽、產出資料庫、專案池建議順序、統計
node test/migrate.test.js    # 舊版「任務」表升級（插入下一步/等待者、高中低→A/B/C）
node test/drag.test.js       # index.html 拖曳換欄、「移到」按鈕、日曆的純函式
node test/perf.test.js       # 一次請求讀幾次試算表（介面順不順的關鍵）
```

改完 `Code.gs` 或 `index.html` 四支都要過。`migrate.test.js` 特別重要：它驗證既有資料在加欄位後不會錯位。

`perf.test.js` 數的是 `getValues()` 的次數。Apps Script 每一次讀表都是一趟慢的 API，
一個 `board` 請求本來要讀五次（任務兩次、紀錄三次），介面按一下要等兩秒就是這樣來的。
現在同一次請求內每張表只讀一次。改動 `Code.gs` 時如果這個數字跳上去，就是又寫回去了。
