// LINE 官方帳號傳一句話進來 → 今日工作多一件。
// 這支測試最在意的是「誰可以寫進來」：Apps Script 讀不到 request header，
// LINE 的簽章驗不了，所以擋人的只剩網址上那段字串和 userId 兩道，不能有破口。
const path=require('path'),fs=require('fs'),vm=require('vm'),assert=require('assert');
const SRC=process.argv[2]||path.join(__dirname,'..','Code.gs');
const pad=n=>String(n).padStart(2,'0');
const fmt=(d,tz,f)=>f.includes('HH')
  ?`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  :`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

const TASK_H=['id','建立時間','標題','專案','到期日','優先','狀態','下一步','等待者','預估時數','備註','完成時間','執行者','重複'];
function Sheet(rows){this.rows=rows}
Sheet.prototype.appendRow=function(r){this.rows.push(r.slice())};
Sheet.prototype.getLastRow=function(){return this.rows.length};
Sheet.prototype.getLastColumn=function(){return this.rows[0]?this.rows[0].length:0};
Sheet.prototype.setFrozenRows=function(){return this};
Sheet.prototype.getRange=function(r,c,nr,nc){const s=this;return{
  getValues(){return s.rows.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc))},
  setValues(v){v.forEach((row,i)=>{const ri=r-1+i;while(s.rows.length<=ri)s.rows.push([]);
    row.forEach((val,j)=>{s.rows[ri][c-1+j]=val})});return this},
  setFontWeight(){return this}}};

let sheets, props, sent, logged;
function reset(p){
  sheets={'任務':new Sheet([TASK_H.slice()])};
  props=Object.assign({TOKEN:'tok'},p||{});
  sent=[];logged=[];
}
const ctx={
  Utilities:{formatDate:fmt,getUuid:()=>'aaaaaaaa-bbbb'},
  Logger:{log(){}},console:{error(m){logged.push(m)},log(){}},
  SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty(k,v){props[k]=v}})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  ContentService:{createTextOutput:t=>({_t:t,setMimeType(){return this}}),MimeType:{JSON:'json'}},
  UrlFetchApp:{fetch(url,opt){sent.push({url:url,body:JSON.parse(opt.payload),
    auth:(opt.headers||{}).Authorization});return{getResponseCode:()=>200}}},
  CacheService:{getScriptCache:()=>({get(){return null},put(){}})}
};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(SRC,'utf8'),ctx);

const today=fmt(new Date(),'','yyyy-MM-dd');
const post=(qs,body)=>ctx.doPost({parameter:qs,postData:{contents:JSON.stringify(body)}});
const msg=(text,uid)=>({events:[{type:'message',replyToken:'RT',
  source:{type:'user',userId:uid||'U-penny'},message:{type:'text',text:text}}]});
const tasks=()=>sheets['任務'].rows.slice(1);
const reply=()=>sent.length?sent[sent.length-1].body.messages[0].text:'';

// ---- 誰可以寫進來 ----
reset({LINE_SECRET:'s3cret',LINE_TOKEN:'ch-tok',LINE_USER:'U-penny'});
post({line:'s3cret'},msg('買中秋禮盒的紙箱'));
assert.strictEqual(tasks().length,1,'網址對、人也對，要記下來');

reset({LINE_SECRET:'s3cret',LINE_TOKEN:'ch-tok',LINE_USER:'U-penny'});
post({line:'猜的'},msg('假裝是我'));
assert.strictEqual(tasks().length,0,'網址那段字串不對就不收');
assert.strictEqual(sent.length,0,'也不要回話，回了等於告訴對方網址存在');

reset({LINE_SECRET:'s3cret',LINE_TOKEN:'ch-tok',LINE_USER:'U-penny'});
post({line:'s3cret'},msg('我是路人',	'U-someone'));
assert.strictEqual(tasks().length,0,'網址外流也沒用，不是本人就無視');
assert.strictEqual(sent.length,0,'不是本人不回話');

// 沒設定 LINE_SECRET 時一律不收——預設開放等於把新增任務的權限送給知道網址的人
reset({LINE_TOKEN:'ch-tok',LINE_USER:'U-penny'});
post({line:''},msg('沒設定也想寫'));
post({line:'undefined'},msg('沒設定也想寫'));
assert.strictEqual(tasks().length,0,'沒設 LINE_SECRET 就整個關起來');

// ---- 第一次設定：先把 userId 回給使用者 ----
// 不傳訊息拿不到 userId，沒 userId 又不能設定，所以要有這條路
reset({LINE_SECRET:'s3cret',LINE_TOKEN:'ch-tok'});
post({line:'s3cret'},msg('第一次'));
assert(reply().includes('U-penny'),'把 userId 回給使用者：'+reply());
assert(reply().includes('LINE_USER'),'順便講要填到哪');
assert.strictEqual(tasks().length,0,'還沒鎖定之前不要記任務');

// ---- 一則訊息變成一件任務 ----
reset({LINE_SECRET:'s3cret',LINE_TOKEN:'ch-tok',LINE_USER:'U-penny'});
post({line:'s3cret'},msg('跟 PN 確認合約\n他說這週會回\n記得追'));
const t=tasks()[0],col=i=>t[TASK_H.indexOf(i)];
assert.strictEqual(col('標題'),'跟 PN 確認合約','第一行當標題');
assert.strictEqual(col('備註'),'他說這週會回\n記得追','其餘放備註，不要把卡片撐爆');
assert.strictEqual(col('到期日'),today,'到期日今天——這樣才會出現在今日工作');
assert.strictEqual(col('狀態'),'待辦');
assert.strictEqual(col('執行者'),'我','從 LINE 丟進來的是自己要做的事');
assert.strictEqual(col('優先'),'B');
assert.strictEqual(col('專案'),'LINE','看得出這筆是從哪裡進來的');
assert(reply().includes('已加到今日工作：跟 PN 確認合約'),'回一句確認：'+reply());
assert.strictEqual(sent[0].auth,'Bearer ch-tok','回話要帶 channel access token');
assert.strictEqual(sent[0].body.replyToken,'RT');

// 空訊息不要生出一張空卡片
reset({LINE_SECRET:'s3cret',LINE_TOKEN:'ch-tok',LINE_USER:'U-penny'});
post({line:'s3cret'},msg('   \n  '));
assert.strictEqual(tasks().length,0,'空訊息不記');
assert(reply().includes('空的'),'要講一聲，不然使用者以為記進去了');

// 貼圖、圖片：講清楚只認文字，不要安靜地吃掉
reset({LINE_SECRET:'s3cret',LINE_TOKEN:'ch-tok',LINE_USER:'U-penny'});
ctx.doPost({parameter:{line:'s3cret'},postData:{contents:JSON.stringify({events:[
  {type:'message',replyToken:'RT',source:{userId:'U-penny'},message:{type:'sticker'}}]})}});
assert.strictEqual(tasks().length,0);
assert(reply().includes('只認文字訊息'));

// ---- 壞掉的時候不要讓 LINE 一直重送 ----
// 回非 200 會被重送，同一句話就變成好幾張卡片
reset({LINE_SECRET:'s3cret',LINE_TOKEN:'ch-tok',LINE_USER:'U-penny'});
const bad=ctx.doPost({parameter:{line:'s3cret'},postData:{contents:'{壞掉的 JSON'}});
assert(bad&&bad._t==='ok','壞掉的 body 也要回 200');
assert.strictEqual(logged.length,1,'錯誤留在紀錄裡');

// 沒設 LINE_TOKEN 就不回話，但任務照記——回不了話不該連記都不記
reset({LINE_SECRET:'s3cret',LINE_USER:'U-penny'});
post({line:'s3cret'},msg('沒有 token 也要記'));
assert.strictEqual(tasks().length,1,'記得下來');
assert.strictEqual(sent.length,0,'沒 token 就安靜');

// ---- 一般 API 不受影響 ----
reset({LINE_SECRET:'s3cret',LINE_TOKEN:'ch-tok',LINE_USER:'U-penny'});
const r=ctx.doPost({parameter:{},postData:{contents:JSON.stringify(
  {action:'task_add',token:'tok',title:'照原本的路進來'})}});
assert(JSON.parse(r._t).ok,'沒帶 line 參數就走原本的 token 那條路');
assert.strictEqual(tasks().length,1);

console.log('LINE      網址＋userId 兩道關卡，第一行當標題其餘進備註，到期日今天');
console.log('');
console.log('LINE PASS');
