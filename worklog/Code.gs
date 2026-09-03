/**
 * 工作看板 — Google Apps Script 後端
 *
 * 綁定在「工作看板」試算表上。提供：
 *   - setup()      建立工作表、表頭、產生 TOKEN（只需執行一次）
 *   - doGet/doPost HTTP API（Claude Code hook、Cowork skill、curl 都走這裡）
 *   - uiCall()     手機/桌面網頁介面透過 google.script.run 呼叫
 *
 * 所有呼叫都要帶 token（設定工作表或 Script Properties 裡的 TOKEN）。
 */

var SHEET_LOG = '紀錄';
var SHEET_TASK = '任務';
var SHEET_CFG = '設定';
var SHEET_BRIEF = '簡報';
var SHEET_SECT = '分區';
var SHEET_DATA = '資料';
var TZ = 'Asia/Taipei';
var BRIEF_HEADERS = ['日期', '產生時間', '內容'];
// 資料區：分區是使用者自己開的欄位，資料是欄位裡的卡片
var SECT_HEADERS = ['id', '名稱', '顏色', '順序'];
var SECT_KEYS    = ['id', 'name', 'color', 'order'];
var DATA_HEADERS = ['id', '分區', '標題', '內容', '順序', '建立時間'];
var DATA_KEYS    = ['id', 'section', 'title', 'body', 'order', 'created'];
var SECT_COLORS  = ['acc', 'a', 'b', 'c', 'ok', 'tmr'];

// 表頭（中文，給人看）與欄位鍵（英文，給 API 用）一一對應
var LOG_HEADERS = ['id', '開始時間', '結束時間', '來源', '專案', '標題', '狀態', '摘要', '產出連結', 'session_id', '任務id', '檔案位置'];
var LOG_KEYS    = ['id', 'start',    'end',     'source', 'project', 'title', 'status', 'summary', 'link', 'session_id', 'task_id', 'path'];
var TASK_HEADERS = ['id', '建立時間', '標題', '專案', '到期日', '優先', '狀態', '下一步', '等待者', '預估時數', '備註', '完成時間'];
var TASK_KEYS    = ['id', 'created', 'title', 'project', 'due', 'priority', 'status', 'next', 'waiting', 'estimate', 'note', 'done_at'];

var TASK_OPEN = ['待辦', '進行中'];
var DATE_ONLY_KEYS = { due: true };

// 優先級：A 優先處理（帶來結果）、B 推進型（讓事情前進）、C 維護型（不做會出事）
var PRIORITY_RANK = { A: 0, B: 1, C: 2 };
var PRIORITY_LEGACY = { 高: 'A', 中: 'B', 低: 'C' };
var TASK_EDITABLE = ['title', 'project', 'due', 'priority', 'status', 'next', 'waiting', 'estimate', 'note'];

// 紀錄可以在看板上手改的欄位。時間、來源、session_id 由 hook 寫，不給改。
var LOG_EDITABLE = ['title', 'project', 'summary', 'link', 'status', 'path'];

// 同一次請求內的工作表快取。一個 board 請求本來會讀任務兩次、紀錄三次，
// 每次 getValues() 都是一趟慢的試算表 API，是介面卡頓的主因。
var CACHE_ = null;

// ---------------------------------------------------------------- setup

function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, SHEET_LOG, LOG_HEADERS);
  migrateTask_(ss);
  ensureSheet_(ss, SHEET_TASK, TASK_HEADERS);
  ensureSheet_(ss, SHEET_BRIEF, BRIEF_HEADERS);
  ensureSheet_(ss, SHEET_SECT, SECT_HEADERS);
  ensureSheet_(ss, SHEET_DATA, DATA_HEADERS);
  var cfg = ensureSheet_(ss, SHEET_CFG, ['項目', '值']);

  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('TOKEN', token);
  }
  cfg.getRange(2, 1, 1, 2).setValues([['TOKEN', token]]);
  cfg.getRange(3, 1, 1, 2).setValues([['說明', 'TOKEN 是 API 與手機介面的金鑰，外洩就到 Apps Script 的 Script Properties 改掉再重跑 setup']]);
  cfg.autoResizeColumns(1, 2);

  var defaultSheet = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 6) ss.deleteSheet(defaultSheet);

  Logger.log('TOKEN = ' + token);
  return token;
}

/**
 * 舊版「任務」表沒有「下一步」「等待者」兩欄，而它們排在「狀態」之後、
 * 「預估時數」之前，直接改表頭會讓既有資料整列錯位。這裡在正確位置插入
 * 空白欄，並把舊的 高/中/低 優先級換成 A/B/C。已是新版的表不會被動到。
 */
function migrateTask_(ss) {
  var sh = ss.getSheetByName(SHEET_TASK);
  if (!sh || sh.getLastRow() === 0) return;
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (headers.indexOf('下一步') < 0) {
    var at = headers.indexOf('狀態');
    if (at < 0) return;                 // 表頭不認得，交給人處理，不要亂動
    sh.insertColumnsAfter(at + 1, 2);
    sh.getRange(1, at + 2, 1, 2).setValues([['下一步', '等待者']]).setFontWeight('bold');
  }
  var col = index_(TASK_KEYS).priority + 1;
  var last = sh.getLastRow();
  if (last < 2) return;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  var changed = false;
  for (var i = 0; i < vals.length; i++) {
    var mapped = PRIORITY_LEGACY[String(vals[i][0]).trim()];
    if (mapped) { vals[i][0] = mapped; changed = true; }
  }
  if (changed) sh.getRange(2, col, last - 1, 1).setValues(vals);
}

/** 建立工作表；已存在但表頭比預期短時，把新欄位補到後面（不動既有資料） */
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  var cur = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (cur.length < headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sh;
}

// ---------------------------------------------------------------- entry points

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return json_(handle_(p.action, p, p.token));
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('工作看板')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'body 不是合法 JSON' });
  }
  var p = Object.assign({}, (e && e.parameter) || {}, body);
  return json_(handle_(p.action, p, p.token));
}

/** 網頁介面用：google.script.run.uiCall(token, action, params) */
function uiCall(token, action, params) {
  return handle_(action, params || {}, token);
}

function handle_(action, p, token) {
  CACHE_ = {};
  try {
    checkToken_(token);
    switch (action) {
      case 'ping':        return { ok: true, time: now_() };
      case 'log':         return withBoard_({ ok: true, row: upsertLog_(p) }, p);
      case 'log_update':  return withBoard_({ ok: true, row: updateLog_(p) }, p);
      case 'logs':        return { ok: true, rows: readLogs_(p.range || 'day', p.date) };
      case 'tasks':       return { ok: true, rows: readTasks_(p.status) };
      case 'task_add':    return withBoard_({ ok: true, row: addTask_(p) }, p);
      case 'task_update': return withBoard_({ ok: true, row: updateTask_(p) }, p);
      case 'board':       return Object.assign({ ok: true }, board_(p.date));
      case 'projects':    return Object.assign({ ok: true }, projects_(p.range, p.date));
      case 'outputs':     return Object.assign({ ok: true }, outputs_(p.source, p.all));
      case 'pool':        return Object.assign({ ok: true }, pool_(p.date));
      case 'done':        return Object.assign({ ok: true }, done_(p.range, p.date));
      case 'data':        return Object.assign({ ok: true }, data_());
      case 'sect_save':   return { ok: true, row: sectSave_(p), data: data_() };
      case 'sect_del':    return { ok: true, moved: sectDel_(p), data: data_() };
      case 'item_save':   return { ok: true, row: itemSave_(p), data: data_() };
      case 'item_del':    return { ok: true, removed: itemDel_(p), data: data_() };
      case 'brief':       return Object.assign({ ok: true }, brief_(p.date));
      case 'brief_save':  return { ok: true, row: saveBrief_(p) };
      default:            return { ok: false, error: '不認識的 action: ' + action };
    }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    CACHE_ = null;
  }
}

/** 帶 board=1 的寫入，回應裡直接附上更新後的看板，省掉前端的第二趟請求 */
function withBoard_(res, p) {
  if (p.board) res.board = board_(p.date);   // 寫入點已經用 dirty_ 作廢過快取
  return res;
}

function checkToken_(token) {
  var real = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!real) throw new Error('尚未執行 setup()');
  if (!token || String(token) !== real) throw new Error('token 錯誤');
}

// ---------------------------------------------------------------- 紀錄

/**
 * 新增或更新一筆紀錄。
 * 有 session_id 且已存在 → 更新該列（Claude Code 一個 session 只佔一列）。
 * 可接受的欄位：source, project, title, status, summary, link, task_id, session_id, prompt
 * prompt 只在標題還是預設值（＝專案名）或空白時，拿來當標題。
 */
function upsertLog_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_LOG);
    var col = index_(LOG_KEYS);
    var rowNum = p.session_id ? findRow_(sh, col.session_id, p.session_id) : 0;
    var row;

    if (!rowNum) {
      row = [];
      row[col.id] = 'L' + Utilities.getUuid().slice(0, 8);
      row[col.start] = p.start || now_();
      row[col.end] = p.status === '完成' ? now_() : '';
      row[col.source] = p.source || '手動';
      row[col.project] = p.project || '';
      row[col.title] = p.title || (p.prompt ? clip_(p.prompt, 80) : (p.project || '(未命名)'));
      row[col.status] = p.status || '完成';
      row[col.summary] = p.summary || '';
      row[col.link] = p.link || '';
      row[col.session_id] = p.session_id || '';
      row[col.task_id] = p.task_id || '';
      row[col.path] = p.path || '';
      sh.appendRow(fill_(row, LOG_KEYS.length));
      dirty_(SHEET_LOG);
      return toObj_(LOG_KEYS, row);
    }

    row = sh.getRange(rowNum, 1, 1, LOG_KEYS.length).getValues()[0];
    ['project', 'status', 'summary', 'link', 'task_id', 'path'].forEach(function (k) {
      if (p[k] !== undefined && p[k] !== '') row[col[k]] = p[k];
    });
    if (p.title) row[col.title] = p.title;
    else if (p.prompt) {
      var cur = String(row[col.title] || '');
      if (!cur || cur === String(row[col.project] || '')) row[col.title] = clip_(p.prompt, 80);
    }
    if (p.status === '完成') row[col.end] = now_();
    sh.getRange(rowNum, 1, 1, LOG_KEYS.length).setValues([row]);
    dirty_(SHEET_LOG);
    return toObj_(LOG_KEYS, row);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 改一筆既有紀錄。日曆上點時間區塊就是走這裡——hook 自動寫進來的標題常常
 * 只是當下的 prompt，事後補個像樣的標題和摘要才找得回來。
 * 跟 upsertLog_ 不同：這裡空字串是「清掉」，不是「略過」。
 */
function updateLog_(p) {
  if (!p.id) throw new Error('id 必填');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_LOG);
    var col = index_(LOG_KEYS);
    var rowNum = findRow_(sh, col.id, p.id);
    if (!rowNum) throw new Error('找不到紀錄 ' + p.id);
    var row = sh.getRange(rowNum, 1, 1, LOG_KEYS.length).getValues()[0];
    LOG_EDITABLE.forEach(function (k) {
      if (p[k] !== undefined) row[col[k]] = p[k];
    });
    if (p.status === '完成' && !row[col.end]) row[col.end] = now_();
    sh.getRange(rowNum, 1, 1, LOG_KEYS.length).setValues([row]);
    dirty_(SHEET_LOG);
    return toObj_(LOG_KEYS, row);
  } finally {
    lock.releaseLock();
  }
}

/** range: day | week | month ；date: yyyy-MM-dd（預設今天） */
function readLogs_(range, date) {
  var span = span_(range, date);
  return readLogsBetween_(fmtDate_(span.from), fmtDate_(shiftDays_(span.to, -1)), true);
}

/** 起始日在 [from, to] 之間的紀錄。desc=true 新的在前（清單用），否則舊的在前（日曆用）。 */
function readLogsBetween_(from, to, desc) {
  var rows = readAll_(SHEET_LOG, LOG_KEYS).filter(function (r) {
    var d = String(r.start).slice(0, 10);
    return d >= from && d <= to;
  });
  return rows.sort(function (a, b) {
    var c = String(a.start).localeCompare(String(b.start));
    return desc ? -c : c;
  });
}

// ---------------------------------------------------------------- 任務

function readTasks_(status) {
  var rows = readAll_(SHEET_TASK, TASK_KEYS);
  if (status === 'open') rows = rows.filter(function (r) { return TASK_OPEN.indexOf(r.status) >= 0; });
  else if (status) rows = rows.filter(function (r) { return r.status === status; });
  else rows = rows.slice();            // 不要就地排序快取那一份
  return sortTasks_(rows);
}

function addTask_(p) {
  if (!p.title) throw new Error('title 必填');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_TASK);
    var col = index_(TASK_KEYS);
    var row = [];
    row[col.id] = 'T' + Utilities.getUuid().slice(0, 8);
    row[col.created] = now_();
    row[col.title] = p.title;
    row[col.project] = p.project || '';
    row[col.due] = p.due || '';
    row[col.priority] = normPriority_(p.priority);
    row[col.status] = p.status || '待辦';
    row[col.next] = p.next || '';
    row[col.waiting] = p.waiting || '';
    row[col.estimate] = p.estimate || '';
    row[col.note] = p.note || '';
    row[col.done_at] = '';
    sh.appendRow(fill_(row, TASK_KEYS.length));
    dirty_(SHEET_TASK);
    return toObj_(TASK_KEYS, row);
  } finally {
    lock.releaseLock();
  }
}

function updateTask_(p) {
  if (!p.id) throw new Error('id 必填');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_TASK);
    var col = index_(TASK_KEYS);
    var rowNum = findRow_(sh, col.id, p.id);
    if (!rowNum) throw new Error('找不到任務 ' + p.id);
    var row = sh.getRange(rowNum, 1, 1, TASK_KEYS.length).getValues()[0];
    TASK_EDITABLE.forEach(function (k) {
      if (p[k] !== undefined) row[col[k]] = k === 'priority' ? normPriority_(p[k]) : p[k];
    });
    if (p.status === '完成' && !row[col.done_at]) row[col.done_at] = now_();
    if (p.status && p.status !== '完成') row[col.done_at] = '';
    sh.getRange(rowNum, 1, 1, TASK_KEYS.length).setValues([row]);
    dirty_(SHEET_TASK);
    return toObj_(TASK_KEYS, row);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- 看板

/**
 * 看板一次要的全部資料，讓手機只打一次 API。
 *   running  正在跑的：狀態為「進行中」的任務，加上 Claude Code / Cowork 還沒結束的紀錄
 *   today    今天到期或已逾期、還沒做完的任務（不含已在 running 的）
 *   tomorrow 明天到期的任務
 *   projects 專案池：每個專案最近的下一步與最近的截止日
 *   stats    底部five個數字
 */
function board_(date) {
  var today = date ? fmtDate_(parseDate_(date)) : fmtDate_(new Date());
  var tomorrow = fmtDate_(shiftDays_(parseDate_(today), 1));
  var open = readTasks_('open');

  var runningTasks = open.filter(function (t) { return t.status === '進行中'; });
  var logsToday = readLogs_('day', today);
  var runningLogs = logsToday.filter(function (l) { return l.status === '進行中'; });
  var week = span_('week', today);

  return {
    date: today,
    running: runningTasks,
    liveLogs: runningLogs,
    today: open.filter(function (t) { return t.status !== '進行中' && t.due && t.due <= today; }),
    tomorrow: open.filter(function (t) { return t.status !== '進行中' && t.due === tomorrow; }),
    unscheduled: open.filter(function (t) { return t.status !== '進行中' && !t.due; }),
    projects: projectPool_(open, today),
    stats: stats_(today, week, open, logsToday),
    note: readBrief_(today),
    logs: logsToday
  };
}

/** 每個專案聚合成一列：最急的下一步、最近的截止日、還有幾件 */
function projectPool_(open, today) {
  var byName = {}, order = [];
  open.forEach(function (t) {
    var name = t.project || '未分類';
    if (!byName[name]) { byName[name] = { name: name, count: 0, next: '', due: '', priority: 'C', overdue: 0 }; order.push(name); }
    var p = byName[name];
    p.count++;
    if (PRIORITY_RANK[t.priority] < PRIORITY_RANK[p.priority]) p.priority = t.priority;
    if (t.due && t.due < today) p.overdue++;
    // readTasks_ 已依到期日、優先級排序，所以第一個看到的就是最急的
    if (!p.next && t.next) p.next = t.next;
    if (!p.due && t.due) p.due = t.due;
  });
  return order.map(function (n) { return byName[n]; }).sort(function (a, b) {
    if (!!b.overdue !== !!a.overdue) return b.overdue - a.overdue;
    return (a.due || '9999-99-99') < (b.due || '9999-99-99') ? -1 : 1;
  });
}

function stats_(today, week, open, logsToday) {
  var all = readAll_(SHEET_TASK, TASK_KEYS);   // readAll_ 已把優先級正規化成 A/B/C
  var doneToday = all.filter(function (t) { return String(t.done_at).slice(0, 10) === today; }).length;
  var dueToday = open.filter(function (t) { return t.due && t.due <= today; });
  var scope = dueToday.concat(open.filter(function (t) { return t.status === '進行中' && !(t.due && t.due <= today); }));
  var high = scope.filter(function (t) { return t.priority === 'A'; }).length;

  var weekFrom = fmtDate_(week.from), weekTo = fmtDate_(shiftDays_(week.to, -1));
  var inWeek = all.filter(function (t) {
    var d = t.due || String(t.done_at).slice(0, 10);
    return d >= weekFrom && d <= weekTo && t.status !== '取消';
  });

  var yesterday = fmtDate_(shiftDays_(parseDate_(today), -1));

  return {
    doneToday: doneToday,
    totalToday: doneToday + scope.length,
    highValuePct: scope.length ? Math.round(high * 100 / scope.length) : 0,
    focusHours: focusHours_(logsToday),
    focusHoursPrev: focusHours_(readLogs_('day', yesterday)),
    overdue: open.filter(function (t) { return t.due && t.due < today; }).length,
    weekDone: inWeek.filter(function (t) { return t.status === '完成'; }).length,
    weekTotal: inWeek.length
  };
}

/**
 * 專案總覽：某一天／週／月裡各專案有哪些任務。含已完成的，才看得出那段時間做了多少。
 * 沒排日期的另外裝一袋，不然它們會從所有區間裡消失。
 */
function projects_(range, date) {
  var r = ['day', 'week', 'month'].indexOf(String(range)) >= 0 ? String(range) : 'week';
  var span = span_(r, date);
  var from = fmtDate_(span.from), to = fmtDate_(shiftDays_(span.to, -1));
  var all = readAll_(SHEET_TASK, TASK_KEYS).filter(function (t) { return t.status !== '取消'; });

  var inRange = all.filter(function (t) {
    var d = t.due || String(t.done_at).slice(0, 10);
    return d && d >= from && d <= to;
  });
  sortTasks_(inRange);

  var byName = {}, order = [];
  inRange.forEach(function (t) {
    var n = t.project || '未分類';
    if (!byName[n]) { byName[n] = { name: n, tasks: [], done: 0, overdue: 0, priority: 'C' }; order.push(n); }
    var p = byName[n];
    p.tasks.push(t);
    if (t.status === '完成') p.done++;
    if (t.due && t.due < from) p.overdue++;   // 這區間內、但已經過了開始日還沒做完
    if (t.status !== '完成' && PRIORITY_RANK[t.priority] < PRIORITY_RANK[p.priority]) p.priority = t.priority;
  });
  var projects = order.map(function (n) {
    var p = byName[n];
    p.count = p.tasks.length;
    return p;
  }).sort(function (a, b) {
    if ((a.count - a.done) !== (b.count - b.done)) return (b.count - b.done) - (a.count - a.done);
    return a.name < b.name ? -1 : 1;
  });

  return {
    range: r, from: from, to: to,
    tasks: inRange,                       // 扁平一份，日曆用
    logs: readLogsBetween_(from, to),     // 實際做了什麼，放到時間軸上
    projects: projects,
    unscheduled: sortTasks_(all.filter(function (t) {
      return !t.due && TASK_OPEN.indexOf(t.status) >= 0;
    })),
    total: inRange.length,
    done: inRange.filter(function (t) { return t.status === '完成'; }).length
  };
}

/**
 * 產出資料庫：Claude Code / Cowork / 手動 做出來的東西的網址。
 * 預設只列有產出連結的，因為那才是「做出了什麼」；all=1 才連沒連結的一起列。
 */
function outputs_(source, all) {
  var withoutLink = String(all) === '1' || String(all) === 'true';
  var rows = readAll_(SHEET_LOG, LOG_KEYS).filter(function (l) { return withoutLink || l.link; });
  var bySource = {};
  rows.forEach(function (l) { bySource[l.source] = (bySource[l.source] || 0) + 1; });
  if (source) rows = rows.filter(function (l) { return l.source === source; });
  rows.sort(function (a, b) { return String(b.start).localeCompare(String(a.start)); });
  return {
    source: source || '',
    all: withoutLink,
    bySource: bySource,
    linked: readAll_(SHEET_LOG, LOG_KEYS).filter(function (l) { return l.link; }).length,
    rows: rows.slice(0, 200)
  };
}

/**
 * AI 專案池：每個專案還有什麼沒做，建議先做哪幾件，昨天實際做了什麼。
 * 建議順序不是照優先級硬排——逾期最急，已經開工的次之，再來才是 A/B/C。
 */
function pool_(date) {
  var today = date ? fmtDate_(parseDate_(date)) : fmtDate_(new Date());
  var yesterday = fmtDate_(shiftDays_(parseDate_(today), -1));
  var open = readTasks_('open');

  var byName = {};
  open.forEach(function (t) { (byName[t.project || '未分類'] = byName[t.project || '未分類'] || []).push(t); });
  var projects = projectPool_(open, today);
  projects.forEach(function (p) { p.tasks = byName[p.name] || []; });

  var yLogs = readLogs_('day', yesterday);
  var ranked = open.map(function (t) {
    return { task: t, score: urgency_(t, today), reason: whyNow_(t, today) };
  }).sort(function (a, b) { return a.score - b.score; });

  return {
    date: today,
    projects: projects,
    order: ranked.slice(0, 10),
    yesterday: yLogs,
    yesterdayHours: focusHours_(yLogs),
    backlog: open.length,
    overdue: open.filter(function (t) { return t.due && t.due < today; }).length
  };
}

/** 越小越該先做 */
function urgency_(t, today) {
  var s;
  if (t.due && t.due < today) s = -daysBetween_(t.due, today) * 10;   // 逾期越久越前面
  else if (t.due === today) s = 100;
  else if (t.due) s = 200 + daysBetween_(today, t.due);
  else s = 400;                                                       // 沒排日期的排最後
  if (t.status === '進行中') s -= 60;                                 // 已經開工的先收掉
  s += PRIORITY_RANK[t.priority] * 12;
  if (t.waiting) s += 40;                                             // 卡在別人身上，自己動不了
  return s;
}

function whyNow_(t, today) {
  if (t.waiting) return '等 ' + t.waiting + '，先去催';
  if (t.due && t.due < today) return '逾期 ' + daysBetween_(t.due, today) + ' 天';
  if (t.status === '進行中') return '已經在做，收掉它';
  if (t.due === today) return '今天到期';
  if (t.priority === 'A') return 'A 優先處理';
  if (!t.due) return '還沒排日期';
  return t.due + ' 到期';
}

function daysBetween_(a, b) {
  var x = parseDate_(a), y = parseDate_(b);
  return (!x || !y) ? 0 : Math.round((y - x) / 86400000);
}

/** 依到期日、再依優先級排序，就地改動並回傳同一個陣列 */
function sortTasks_(rows) {
  return rows.sort(function (a, b) {
    var da = a.due || '9999-99-99', db = b.due || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);   // 平手時用 id 定序，前端才排得出一樣的結果
  });
}

/**
 * 完成項目：那段期間實際做完了什麼，附產出連結與檔案位置。
 * 兩個來源合在一起：狀態為完成的「任務」，以及 Claude Code / Cowork 送進來的「紀錄」。
 * 紀錄若掛在某個任務底下（task_id），就不重複列那個任務，以紀錄為準——它有連結。
 */
function done_(range, date) {
  var r = ['day', 'week', 'month', 'all'].indexOf(String(range)) >= 0 ? String(range) : 'week';
  var from, to;
  if (r === 'all') { from = '0000-00-00'; to = '9999-99-99'; }
  else {
    var span = span_(r, date);
    from = fmtDate_(span.from);
    to = fmtDate_(shiftDays_(span.to, -1));
  }

  var logs = readAll_(SHEET_LOG, LOG_KEYS).filter(function (l) {
    if (l.status !== '完成') return false;
    var d = String(l.end || l.start).slice(0, 10);
    return d >= from && d <= to;
  });
  var covered = {};
  logs.forEach(function (l) { if (l.task_id) covered[l.task_id] = true; });

  var items = logs.map(function (l) {
    return {
      kind: 'log', id: l.id, title: l.title, project: l.project, source: l.source,
      at: String(l.end || l.start), summary: l.summary, link: l.link, path: l.path, priority: ''
    };
  });

  readAll_(SHEET_TASK, TASK_KEYS).forEach(function (t) {
    if (t.status !== '完成' || covered[t.id]) return;
    var d = String(t.done_at || t.due).slice(0, 10);
    if (!d || d < from || d > to) return;
    items.push({
      kind: 'task', id: t.id, title: t.title, project: t.project, source: '任務',
      at: String(t.done_at || t.due), summary: t.note, link: '', path: '', priority: t.priority
    });
  });

  items.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

  var bySource = {};
  items.forEach(function (x) { bySource[x.source] = (bySource[x.source] || 0) + 1; });
  return {
    range: r, from: from, to: to,
    items: items.slice(0, 300),
    total: items.length,
    withLink: items.filter(function (x) { return x.link || x.path; }).length,
    hours: focusHours_(logs),
    bySource: bySource
  };
}

/** 一組紀錄累計的專注時數，取一位小數 */
function focusHours_(logs) {
  var minutes = 0;
  logs.forEach(function (l) {
    var a = parseDate_(l.start), b = parseDate_(l.end);
    if (a && b && b > a) minutes += (b - a) / 60000;
  });
  return Math.round(minutes / 6) / 10;
}

function normPriority_(v) {
  var s = String(v === undefined || v === null ? '' : v).trim().toUpperCase().charAt(0);
  if (PRIORITY_RANK[s] !== undefined) return s;
  return PRIORITY_LEGACY[String(v).trim()] || 'B';
}

function shiftDays_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// ---------------------------------------------------------------- 資料區

/**
 * 資料區：自己開欄位、自己放卡片，用來存日常會回頭查的東西——連結、片段、參考。
 * 跟任務與紀錄是不同性質的資料，所以獨立兩張表。
 * 卡片的分區若對不到任何一個分區（例如分區被刪了），前端會歸到「未分類」。
 */
function data_() {
  return {
    sections: byOrder_(readAll_(SHEET_SECT, SECT_KEYS)),
    items: byOrder_(readAll_(SHEET_DATA, DATA_KEYS))
  };
}

function byOrder_(rows) {
  return rows.sort(function (a, b) { return (+a.order || 0) - (+b.order || 0); });
}

/** 下一個順序值：接在最後面 */
function nextOrder_(rows) {
  var m = 0;
  rows.forEach(function (r) { m = Math.max(m, +r.order || 0); });
  return m + 1;
}

/** 有 id 就更新，沒有就新增 */
function sectSave_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = ensureSheet_(SpreadsheetApp.getActive(), SHEET_SECT, SECT_HEADERS);
    var col = index_(SECT_KEYS);
    if (p.id) {
      var rowNum = findRow_(sh, col.id, p.id);
      if (!rowNum) throw new Error('找不到分區 ' + p.id);
      var row = sh.getRange(rowNum, 1, 1, SECT_KEYS.length).getValues()[0];
      ['name', 'color', 'order'].forEach(function (k) {
        if (p[k] !== undefined && p[k] !== '') row[col[k]] = p[k];
      });
      sh.getRange(rowNum, 1, 1, SECT_KEYS.length).setValues([row]);
      dirty_(SHEET_SECT);
      return toObj_(SECT_KEYS, row);
    }
    if (!p.name) throw new Error('name 必填');
    var all = readAll_(SHEET_SECT, SECT_KEYS);
    var fresh = [];
    fresh[col.id] = 'S' + Utilities.getUuid().slice(0, 8);
    fresh[col.name] = p.name;
    fresh[col.color] = p.color || SECT_COLORS[all.length % SECT_COLORS.length];
    fresh[col.order] = p.order || nextOrder_(all);
    sh.appendRow(fill_(fresh, SECT_KEYS.length));
    dirty_(SHEET_SECT);
    return toObj_(SECT_KEYS, fresh);
  } finally {
    lock.releaseLock();
  }
}

/** 刪分區。裡面的卡片不刪，留著讓前端歸到「未分類」，免得誤刪一整欄的東西。 */
function sectDel_(p) {
  if (!p.id) throw new Error('id 必填');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_SECT);
    var rowNum = findRow_(sh, index_(SECT_KEYS).id, p.id);
    if (!rowNum) throw new Error('找不到分區 ' + p.id);
    sh.deleteRow(rowNum);
    dirty_(SHEET_SECT);
    return readAll_(SHEET_DATA, DATA_KEYS).filter(function (i) { return i.section === p.id; }).length;
  } finally {
    lock.releaseLock();
  }
}

function itemSave_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = ensureSheet_(SpreadsheetApp.getActive(), SHEET_DATA, DATA_HEADERS);
    var col = index_(DATA_KEYS);
    if (p.id) {
      var rowNum = findRow_(sh, col.id, p.id);
      if (!rowNum) throw new Error('找不到卡片 ' + p.id);
      var row = sh.getRange(rowNum, 1, 1, DATA_KEYS.length).getValues()[0];
      ['section', 'title', 'body', 'order'].forEach(function (k) {
        if (p[k] !== undefined) row[col[k]] = p[k];
      });
      sh.getRange(rowNum, 1, 1, DATA_KEYS.length).setValues([row]);
      dirty_(SHEET_DATA);
      return toObj_(DATA_KEYS, row);
    }
    if (!p.title && !p.body) throw new Error('標題或內容至少要有一個');
    var all = readAll_(SHEET_DATA, DATA_KEYS);
    var fresh = [];
    fresh[col.id] = 'D' + Utilities.getUuid().slice(0, 8);
    fresh[col.section] = p.section || '';
    fresh[col.title] = p.title || clip_(p.body, 60);
    fresh[col.body] = p.body || '';
    fresh[col.order] = nextOrder_(all);
    fresh[col.created] = now_();
    sh.appendRow(fill_(fresh, DATA_KEYS.length));
    dirty_(SHEET_DATA);
    return toObj_(DATA_KEYS, fresh);
  } finally {
    lock.releaseLock();
  }
}

function itemDel_(p) {
  if (!p.id) throw new Error('id 必填');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_DATA);
    var rowNum = findRow_(sh, index_(DATA_KEYS).id, p.id);
    if (!rowNum) throw new Error('找不到卡片 ' + p.id);
    sh.deleteRow(rowNum);
    dirty_(SHEET_DATA);
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- 今日簡報

function brief_(date) {
  var today = fmtDate_(date ? parseDate_(date) : new Date());
  var tasks = readTasks_('open');
  return {
    date: today,
    overdue: tasks.filter(function (t) { return t.due && t.due < today; }),
    today: tasks.filter(function (t) { return t.due === today; }),
    doing: tasks.filter(function (t) { return t.status === '進行中' && t.due !== today && !(t.due && t.due < today); }),
    upcoming: tasks.filter(function (t) { return t.due && t.due > today; }).slice(0, 10),
    unscheduled: tasks.filter(function (t) { return !t.due && t.status !== '進行中'; }).slice(0, 10),
    logs: readLogs_('day', today),
    yesterday: readLogs_('day', fmtDate_(new Date(parseDate_(today).getTime() - 86400000))),
    note: readBrief_(today)
  };
}

/** 早晨簡報：一天一列，同日期覆蓋 */
function saveBrief_(p) {
  if (!p.content) throw new Error('content 必填');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActive();
    var sh = ensureSheet_(ss, SHEET_BRIEF, BRIEF_HEADERS);
    var date = p.date || fmtDate_(new Date());
    var rowNum = findRow_(sh, 0, date);
    var row = [date, now_(), String(p.content)];
    if (rowNum) sh.getRange(rowNum, 1, 1, 3).setValues([row]);
    else sh.appendRow(row);
    dirty_(SHEET_BRIEF);
    return { date: date, time: row[1], content: row[2] };
  } finally {
    lock.releaseLock();
  }
}

function readBrief_(date) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_BRIEF);
  if (!sh) return '';
  var rows = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  for (var i = 0; i < rows.length; i++) {
    var d = rows[i][0];
    if (Object.prototype.toString.call(d) === '[object Date]') d = fmtDate_(d);
    if (String(d) === date) return String(rows[i][2] || '');
  }
  return '';
}

// ---------------------------------------------------------------- helpers

function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('找不到工作表「' + name + '」，請先執行 setup()');
  return sh;
}

function index_(keys) {
  var m = {};
  keys.forEach(function (k, i) { m[k] = i; });
  return m;
}

function fill_(row, n) {
  for (var i = 0; i < n; i++) if (row[i] === undefined) row[i] = '';
  return row;
}

function findRow_(sh, colIdx, value) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(2, colIdx + 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(value)) return i + 2;
  return 0;
}

/** 寫過某張表就把它的快取丟掉，不然同一次請求裡接著讀會拿到舊資料 */
function dirty_(name) {
  if (CACHE_) delete CACHE_[name];
}

function readAll_(name, keys) {
  if (CACHE_ && CACHE_[name]) return CACHE_[name];
  var rows = readSheet_(name, keys);
  if (CACHE_) CACHE_[name] = rows;
  return rows;
}

function readSheet_(name, keys) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, keys.length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) {
      var o = toObj_(keys, r);
      if (o.priority !== undefined) o.priority = normPriority_(o.priority);
      return o;
    });
}

/** 轉成純字串物件（google.script.run 不能回傳 Date） */
function toObj_(keys, row) {
  var o = {};
  keys.forEach(function (k, i) {
    var v = row[i];
    if (Object.prototype.toString.call(v) === '[object Date]') v = DATE_ONLY_KEYS[k] ? fmtDate_(v) : fmtDateTime_(v);
    o[k] = v === undefined || v === null ? '' : String(v);
  });
  return o;
}

function now_() { return fmtDateTime_(new Date()); }
function fmtDateTime_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm'); }
function fmtDate_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }

/** 把 Date 或 'yyyy-MM-dd[ HH:mm]' 字串轉成 Date（以指令碼時區為準） */
function parseDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var m = String(v).match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

/** 回傳 {from, to}，to 為開區間 */
function span_(range, date) {
  var d = date ? parseDate_(date) : new Date();
  var from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var to;
  if (range === 'week') {
    var dow = (from.getDay() + 6) % 7; // 週一為一週開始
    from = new Date(from.getFullYear(), from.getMonth(), from.getDate() - dow);
    to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  } else if (range === 'month') {
    from = new Date(from.getFullYear(), from.getMonth(), 1);
    to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  } else {
    to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  }
  return { from: from, to: to };
}

function clip_(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
