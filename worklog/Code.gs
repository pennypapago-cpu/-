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
var TZ = 'Asia/Taipei';
var BRIEF_HEADERS = ['日期', '產生時間', '內容'];

// 表頭（中文，給人看）與欄位鍵（英文，給 API 用）一一對應
var LOG_HEADERS = ['id', '開始時間', '結束時間', '來源', '專案', '標題', '狀態', '摘要', '產出連結', 'session_id', '任務id'];
var LOG_KEYS    = ['id', 'start',    'end',     'source', 'project', 'title', 'status', 'summary', 'link', 'session_id', 'task_id'];
var TASK_HEADERS = ['id', '建立時間', '標題', '專案', '到期日', '優先', '狀態', '預估時數', '備註', '完成時間'];
var TASK_KEYS    = ['id', 'created', 'title', 'project', 'due', 'priority', 'status', 'estimate', 'note', 'done_at'];

var TASK_OPEN = ['待辦', '進行中'];
var DATE_ONLY_KEYS = { due: true };

// ---------------------------------------------------------------- setup

function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureSheet_(ss, SHEET_LOG, LOG_HEADERS);
  ensureSheet_(ss, SHEET_TASK, TASK_HEADERS);
  ensureSheet_(ss, SHEET_BRIEF, BRIEF_HEADERS);
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
  if (defaultSheet && ss.getSheets().length > 4) ss.deleteSheet(defaultSheet);

  Logger.log('TOKEN = ' + token);
  return token;
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
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
  try {
    checkToken_(token);
    switch (action) {
      case 'ping':        return { ok: true, time: now_() };
      case 'log':         return { ok: true, row: upsertLog_(p) };
      case 'logs':        return { ok: true, rows: readLogs_(p.range || 'day', p.date) };
      case 'tasks':       return { ok: true, rows: readTasks_(p.status) };
      case 'task_add':    return { ok: true, row: addTask_(p) };
      case 'task_update': return { ok: true, row: updateTask_(p) };
      case 'brief':       return Object.assign({ ok: true }, brief_(p.date));
      case 'brief_save':  return { ok: true, row: saveBrief_(p) };
      default:            return { ok: false, error: '不認識的 action: ' + action };
    }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
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
      sh.appendRow(fill_(row, LOG_KEYS.length));
      return toObj_(LOG_KEYS, row);
    }

    row = sh.getRange(rowNum, 1, 1, LOG_KEYS.length).getValues()[0];
    ['project', 'status', 'summary', 'link', 'task_id'].forEach(function (k) {
      if (p[k] !== undefined && p[k] !== '') row[col[k]] = p[k];
    });
    if (p.title) row[col.title] = p.title;
    else if (p.prompt) {
      var cur = String(row[col.title] || '');
      if (!cur || cur === String(row[col.project] || '')) row[col.title] = clip_(p.prompt, 80);
    }
    if (p.status === '完成') row[col.end] = now_();
    sh.getRange(rowNum, 1, 1, LOG_KEYS.length).setValues([row]);
    return toObj_(LOG_KEYS, row);
  } finally {
    lock.releaseLock();
  }
}

/** range: day | week | month ；date: yyyy-MM-dd（預設今天） */
function readLogs_(range, date) {
  var span = span_(range, date);
  var col = index_(LOG_KEYS);
  var rows = readAll_(SHEET_LOG, LOG_KEYS).filter(function (r) {
    var t = parseDate_(r.start);
    return t && t >= span.from && t < span.to;
  });
  rows.sort(function (a, b) { return String(b.start).localeCompare(String(a.start)); });
  return rows;
}

// ---------------------------------------------------------------- 任務

function readTasks_(status) {
  var rows = readAll_(SHEET_TASK, TASK_KEYS);
  if (status === 'open') rows = rows.filter(function (r) { return TASK_OPEN.indexOf(r.status) >= 0; });
  else if (status) rows = rows.filter(function (r) { return r.status === status; });
  var rank = { 高: 0, 中: 1, 低: 2 };
  rows.sort(function (a, b) {
    var da = a.due || '9999', db = b.due || '9999';
    if (da !== db) return da < db ? -1 : 1;
    return (rank[a.priority] === undefined ? 1 : rank[a.priority]) - (rank[b.priority] === undefined ? 1 : rank[b.priority]);
  });
  return rows;
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
    row[col.priority] = p.priority || '中';
    row[col.status] = p.status || '待辦';
    row[col.estimate] = p.estimate || '';
    row[col.note] = p.note || '';
    row[col.done_at] = '';
    sh.appendRow(fill_(row, TASK_KEYS.length));
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
    ['title', 'project', 'due', 'priority', 'status', 'estimate', 'note'].forEach(function (k) {
      if (p[k] !== undefined) row[col[k]] = p[k];
    });
    if (p.status === '完成' && !row[col.done_at]) row[col.done_at] = now_();
    if (p.status && p.status !== '完成') row[col.done_at] = '';
    sh.getRange(rowNum, 1, 1, TASK_KEYS.length).setValues([row]);
    return toObj_(TASK_KEYS, row);
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

function readAll_(name, keys) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, keys.length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) { return toObj_(keys, r); });
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
