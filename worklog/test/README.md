# 測試

`Code.gs` 的純邏輯測試。用假的 SpreadsheetApp 跑，不會碰到真的試算表。

```bash
node test/board.test.js      # 看板聚合、統計、優先級、任務新增與更新
node test/migrate.test.js    # 舊版「任務」表升級（插入下一步/等待者、高中低→A/B/C）
```

改完 `Code.gs` 兩支都要過。`migrate.test.js` 特別重要：它驗證既有資料在加欄位後不會錯位。
