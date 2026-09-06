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

// ---- 開頭寫日期就照著排 ----
// Cowork 實測抓到的：訊息寫「明天」，到期日卻被設成今天
{
  const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return fmt(d,'','yyyy-MM-dd')};
  const add=t=>{reset({LINE_SECRET:'s',LINE_TOKEN:'k',LINE_USER:'U-penny'});
    post({line:'s'},msg(t));const r=tasks()[0];
    return r?{due:r[TASK_H.indexOf('到期日')],title:r[TASK_H.indexOf('標題')]}:null};

  let r=add('明天 交報告');
  assert.strictEqual(r.due,day(1),'「明天」就是明天');
  assert.strictEqual(r.title,'交報告','日期那幾個字要從標題拿掉');
  assert(reply().includes('已加到明日工作'),'回話要講排到哪天，不然看不出有沒有解析到：'+reply());

  assert.strictEqual(add('今天 回信').due,day(0));
  assert.strictEqual(add('後天 出貨').due,day(2));
  assert.strictEqual(add('大後天 結帳').due,day(3));
  assert.strictEqual(add('明日 開會').title,'開會','明日跟明天一樣');

  // 沒寫日期就是今天——從 LINE 丟進來的多半是現在想到、今天要處理的事
  r=add('買紙箱');
  assert.strictEqual(r.due,day(0));
  assert.strictEqual(r.title,'買紙箱');

  // 只認開頭。「明天要問的事」是標題，不是日期——硬解會把使用者的字吃掉
  r=add('明天要問的事');
  assert.strictEqual(r.title,'明天要問的事','中間的日期字不能亂吃');
  assert.strictEqual(r.due,day(0));

  // 週三：下一個週三；今天就是週三的話算下週
  {
    const wd=new Date().getDay();
    const gap=(3-wd+7)%7||7;
    assert.strictEqual(add('週三 盤點').due,day(gap),'週三＝下一個週三');
    assert.strictEqual(add('下週三 盤點').due,day(gap+7),'下週三再加一週');
    assert.strictEqual(add('星期三 盤點').due,day(gap),'星期三同義');
    assert.strictEqual(add('禮拜三 盤點').due,day(gap),'禮拜三同義');
  }

  // 明確日期
  assert.strictEqual(add('2026-12-25 尾牙場地').due,'2026-12-25');
  assert.strictEqual(add('2026-12-25 尾牙場地').title,'尾牙場地');
  {
    const t=new Date(),y=t.getFullYear();
    const mmdd=(m,d)=>y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const soon=new Date(t);soon.setDate(t.getDate()+20);
    const M=soon.getMonth()+1,D=soon.getDate();
    assert.strictEqual(add(M+'/'+D+' 對帳').due,fmt(soon,'','yyyy-MM-dd'),'M/D 認今年');
    // 已經過的日期當明年——待辦寫日期指的都是還沒到的那一天
    const past=new Date(t);past.setDate(t.getDate()-20);
    const pm=past.getMonth()+1,pd=past.getDate();
    const want=past.getFullYear()===y?mmdd(pm,pd).replace(String(y),String(y+1)):fmt(past,'','yyyy-MM-dd');
    if(past.getFullYear()===y)
      assert.strictEqual(add(pm+'/'+pd+' 補件').due,want,'過去的日期滾到明年');
  }
  // 日期後面沒有斷開就不算日期。「明天要問的事」整句都是標題
  assert.strictEqual(add('明天要問的事').title,'明天要問的事');
  assert.strictEqual(add('9/15對帳').title,'9/15對帳','數字也一樣');
  assert.strictEqual(add('週三盤點').title,'週三盤點');
  // 標點也算斷開
  assert.strictEqual(add('明天，交報告').title,'交報告');
  assert.strictEqual(add('明天：交報告').title,'交報告');

  // 只有日期沒有內容就不記，不要生出一張沒有標題的卡
  reset({LINE_SECRET:'s',LINE_TOKEN:'k',LINE_USER:'U-penny'});
  post({line:'s'},msg('明天'));
  assert.strictEqual(tasks().length,0,'只有日期沒有事情就不記');
}

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

console.log('LINE      網址＋userId 兩道關卡，開頭寫日期就照著排，沒寫就今天');
console.log('');
console.log('LINE PASS');
