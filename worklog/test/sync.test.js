// 前端為了「按下去即時反應」自己算了一次分欄（applyTask），後端 board_ 也算一次。
// 兩邊只要走鐘，畫面就會跟伺服器對不上。這支測試拿同一批資料餵兩邊，比對分欄結果。
const path=require('path'),fs=require('fs'),vm=require('vm'),assert=require('assert');
const GS=process.argv[2]||path.join(__dirname,'..','Code.gs');
const HTML=process.argv[3]||path.join(__dirname,'..','index.html');
const pad=n=>String(n).padStart(2,'0');
let UUID=0;
const fmt=(d,tz,f)=>f.includes('HH')
  ?`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  :`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

const T='2026-09-03', TM='2026-09-04', Y='2026-09-02';

// ---- 後端 ----
function Sheet(rows){this.rows=rows}
Sheet.prototype.appendRow=function(r){this.rows.push(r.slice())};
Sheet.prototype.deleteRow=function(n){this.rows.splice(n-1,1)};
Sheet.prototype.getLastRow=function(){return this.rows.length};
Sheet.prototype.getLastColumn=function(){return this.rows[0]?this.rows[0].length:0};
Sheet.prototype.setFrozenRows=function(){return this};
Sheet.prototype.getRange=function(r,c,nr,nc){const s=this;return{
  getValues(){return s.rows.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc))},
  setValues(v){v.forEach((row,i)=>{const ri=r-1+i;while(s.rows.length<=ri)s.rows.push([]);
    row.forEach((val,j)=>{s.rows[ri][c-1+j]=val})});return this},
  setFontWeight(){return this}}};

const TASKS=[['id','建立時間','標題','專案','到期日','優先','狀態','下一步','等待者','預估時數','備註','完成時間']];
const add=(id,title,due,pri,st)=>TASKS.push([id,T,title,'專案',due,pri,st,'','','','','']);
add('T1','進行中的','2026-09-10','B','進行中');
add('T2','今天A',T,'A','待辦');
add('T3','今天B',T,'B','待辦');
add('T4','明天C',TM,'C','待辦');
add('T5','逾期A','2026-08-20','A','待辦');
add('T6','沒排日期','','B','待辦');
add('T7','下週','2026-09-09','A','待辦');

const sheets={'任務':new Sheet(TASKS),
  '紀錄':new Sheet([['id','開始時間','結束時間','來源','專案','標題','狀態','摘要','產出連結','session_id','任務id','檔案位置']]),
  '簡報':new Sheet([['日期','產生時間','內容']]),'設定':new Sheet([['項目','值']]),
  '分區':new Sheet([['id','名稱','顏色','順序']]),
  '資料':new Sheet([['id','分區','標題','內容','順序','建立時間']])};
const srv={Utilities:{formatDate:fmt,getUuid:()=>'u'+(++UUID)},Logger:{log(){}},
  SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null})},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>'tok',setProperty(){}})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}};
vm.createContext(srv);vm.runInContext(fs.readFileSync(GS,'utf8'),srv);

// ---- 前端 ----
const src=fs.readFileSync(HTML,'utf8');
const stub={className:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},
  addEventListener(){},appendChild(){},remove(){},cloneNode(){return this},insertBefore(){},
  getBoundingClientRect(){return{left:0,top:0,width:100}},focus(){},setSelectionRange(){},
  querySelectorAll(){return[]},querySelector(){return null},closest(){return null},
  value:'',innerHTML:'',textContent:'',disabled:false};
const cli={document:{addEventListener(){},getElementById(){return stub},querySelector(){return stub},
    querySelectorAll(){return[]},elementFromPoint(){return null},createElement(){return stub},
    documentElement:{style:{setProperty(){}}},body:{classList:{add(){},remove(){}},appendChild(){}}},
  localStorage:{getItem(){return null},setItem(){},removeItem(){}},
  setTimeout(){return 0},clearTimeout(){},location:{reload(){}},navigator:{},
  google:{script:{run:{withSuccessHandler(){return this},withFailureHandler(){return this},uiCall(){}}}}};
cli.window=cli;vm.createContext(cli);
vm.runInContext(src.split('<script>')[1].split('</script>')[0].replace(/^boot\(\);$/m,''),cli);

// ---- 比對 ----
const buckets=b=>['running','today','tomorrow','unscheduled']
  .map(k=>k+'='+b[k].map(x=>x.id).join(',')).join(' | ');

function check(label,id,patch,apiPatch){
  const before=srv.handle_('board',{date:T},'tok');
  assert(before.ok,before.error);
  const mine=JSON.parse(JSON.stringify(before));
  assert.strictEqual(cli.applyTask(mine,id,patch),true,label+'：前端找不到這筆任務');
  const after=srv.handle_('task_update',Object.assign({id:id},apiPatch||patch),'tok');
  assert(after.ok,label+'：'+after.error);
  const theirs=srv.handle_('board',{date:T},'tok');
  assert.strictEqual(buckets(mine),buckets(theirs),
    label+'\n  前端 '+buckets(mine)+'\n  後端 '+buckets(theirs));
  console.log('  ✓',label.padEnd(18),buckets(theirs));
}

console.log('前後端分欄一致性：');
check('明天→今天','T4',{due:T},{due:T});
check('今天→進行中','T2',{status:'進行中'},{status:'進行中'});
check('進行中→明天','T1',{due:TM,status:'待辦'},{due:TM,status:'待辦'});
check('沒排日期→今天','T6',{due:T},{due:T});
check('刪掉（取消）','T5',{status:'取消'},{status:'取消'});
check('今天→明天','T3',{due:TM},{due:TM});

// 找不到的任務要回 false，不能默默改壞資料
const b=srv.handle_('board',{date:T},'tok');
assert.strictEqual(cli.applyTask(b,'不存在',{due:T}),false);
// T7 下週到期，四個欄位都不含它——不在畫面上的任務不能就地改，要等伺服器回來
assert(!b.running.concat(b.today,b.tomorrow,b.unscheduled).some(x=>x.id==='T7'),
  'T7 本來就不該出現在看板上');
assert.strictEqual(cli.applyTask(b,'T7',{due:T}),false,'不在畫面上的任務回 false，交給伺服器');
assert.strictEqual(cli.applyTask(null,'T2',{due:T}),false,'沒有資料時不該爆掉');
// undefined 的欄位不要覆蓋掉原值
const b2=srv.handle_('board',{date:T},'tok');
const t3=b2.today.concat(b2.tomorrow,b2.running,b2.unscheduled).filter(x=>x.id==='T3')[0];
const due0=t3.due;
cli.applyTask(b2,'T3',{status:undefined,due:undefined});
const t3b=b2.today.concat(b2.tomorrow,b2.running,b2.unscheduled).filter(x=>x.id==='T3')[0];
assert.strictEqual(t3b.due,due0,'undefined 不該蓋掉原值');

console.log('\nSYNC PASS');
