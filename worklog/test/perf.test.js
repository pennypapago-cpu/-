// 一次請求該讀幾次試算表？這支測試就是釘住那個數字。
const path=require('path'),fs=require('fs'),vm=require('vm'),assert=require('assert');
const SRC=process.argv[2]||path.join(__dirname,'..','Code.gs');
const pad=n=>String(n).padStart(2,'0');
const f=(d,tz,fmt)=>fmt.includes('HH')?`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

let reads=0;                                   // 每次 getValues() 算一次
function Sheet(rows){this.rows=rows}
Sheet.prototype.appendRow=function(r){this.rows.push(r.slice())};
Sheet.prototype.getLastRow=function(){return this.rows.length};
Sheet.prototype.getLastColumn=function(){return this.rows[0]?this.rows[0].length:0};
Sheet.prototype.setFrozenRows=function(){return this};
Sheet.prototype.getRange=function(r,c,nr,nc){const s=this;return{
  getValues(){reads++;return s.rows.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc))},
  setValues(v){v.forEach((row,i)=>{const ri=r-1+i;while(s.rows.length<=ri)s.rows.push([]);
    row.forEach((val,j)=>{s.rows[ri][c-1+j]=val})});return this},
  setFontWeight(){return this}}};

const T='2026-09-03';
const TASKS=[['id','建立時間','標題','專案','到期日','優先','狀態','下一步','等待者','預估時數','備註','完成時間']];
for(let i=1;i<=20;i++)TASKS.push(['T'+i,T,'任務'+i,'專案'+(i%4),T,'ABC'[i%3],'待辦','下一步','','','','']);
const LOGS=[['id','開始時間','結束時間','來源','專案','標題','狀態','摘要','產出連結','session_id','任務id']];
for(let i=1;i<=20;i++)LOGS.push(['L'+i,T+' 09:00',T+' 10:00','Cowork','專案1','紀錄'+i,'完成','','','s'+i,'']);
const sheets={'任務':new Sheet(TASKS),'紀錄':new Sheet(LOGS),
  '簡報':new Sheet([['日期','產生時間','內容']]),'設定':new Sheet([['項目','值']])};

const ctx={Utilities:{formatDate:f,getUuid:()=>'aaaaaaaa-bbbb'},Logger:{log(){}},
  SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null})},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>'tok',setProperty(){}})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(SRC,'utf8'),ctx);

function count(action,params){reads=0;const r=ctx.handle_(action,params||{},'tok');
  assert(r.ok,action+': '+r.error);return reads}

const board=count('board',{date:T});
const pool=count('pool',{date:T});
const projects=count('projects',{range:'week',date:T});
const outputs=count('outputs',{all:'1'});
const upd=count('task_update',{id:'T1',status:'進行中'});
const updB=count('task_update',{id:'T2',status:'進行中',board:1});

console.log('board     ',board,'次');
console.log('pool      ',pool,'次');
console.log('projects  ',projects,'次');
console.log('outputs   ',outputs,'次');
console.log('task_update',upd,'次；帶 board 旗標',updB,'次');

// 每張表在一次請求裡最多讀一次；board 只碰任務、紀錄、簡報三張
assert(board<=4,'board 讀太多次試算表：'+board);
assert(pool<=4,'pool 讀太多次：'+pool);
assert(projects<=3,'projects 讀太多次：'+projects);
assert(outputs<=2,'outputs 讀太多次：'+outputs);
// 帶旗標的寫入讀表次數就等於「寫入＋看板」——省下的是一趟網路往返，不是讀表。
// 寫完要作廢快取重讀，所以這裡不該更少；真正的收穫在下面那條「看得到剛剛的改動」。
assert.strictEqual(updB,upd+board,'帶 board 的寫入＝寫入＋一份新鮮的看板');

// 寫入後快取要作廢，回傳的看板必須看得到剛剛的改動
const r=ctx.handle_('task_update',{id:'T3',title:'改過了',board:1},'tok');
const all=r.board.running.concat(r.board.today,r.board.tomorrow,r.board.unscheduled);
assert(all.some(t=>t.id==='T3'&&t.title==='改過了'),'回傳的看板要是寫入後的狀態');

// 這幾個數字就是當初卡兩秒的原因：board 本來要讀五次（任務兩次、紀錄三次）
assert(board<=2,'board 應該只讀任務與紀錄各一次：'+board);

console.log('\nPERF PASS');
