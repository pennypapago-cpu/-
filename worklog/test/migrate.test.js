const path=require('path');
const SRC=process.argv[2]||path.join(__dirname,'..','Code.gs');
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const pad=n=>String(n).padStart(2,'0');
const f=(d,tz,fmt)=>fmt.includes('HH')?`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function Sheet(rows){this.rows=rows}
Sheet.prototype.appendRow=function(r){this.rows.push(r.slice())};
Sheet.prototype.getLastRow=function(){return this.rows.length};
Sheet.prototype.getLastColumn=function(){return this.rows[0]?this.rows[0].length:0};
Sheet.prototype.setFrozenRows=function(){return this};
Sheet.prototype.autoResizeColumns=function(){return this};
Sheet.prototype.insertColumnsAfter=function(after,n){
  this.rows.forEach(r=>{const add=new Array(n).fill('');r.splice(after,0,...add)})};
Sheet.prototype.getRange=function(r,c,nr,nc){const s=this;return{
  getValues(){return s.rows.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc))},
  setValues(v){v.forEach((row,i)=>{
    const ri=r-1+i; while(s.rows.length<=ri)s.rows.push([]);
    row.forEach((val,j)=>{s.rows[ri][c-1+j]=val})});return this},
  setFontWeight(){return this}}};

// 舊版表：沒有「下一步」「等待者」，優先級是 高/中/低
const old=new Sheet([
 ['id','建立時間','標題','專案','到期日','優先','狀態','預估時數','備註','完成時間'],
 ['T1','2026-09-01','舊任務甲','起士公爵','2026-09-05','高','待辦','2','備註甲',''],
 ['T2','2026-09-01','舊任務乙','電腦舖','2026-09-06','低','完成','1','備註乙','2026-09-02 10:00'],
]);
const sheets={'任務':old,'紀錄':new Sheet([['id','開始時間','結束時間','來源','專案','標題','狀態','摘要','產出連結','session_id','任務id']]),'簡報':new Sheet([['日期','產生時間','內容']]),'設定':new Sheet([['項目','值']])};
const ctx={Utilities:{formatDate:f,getUuid:()=>'aaaaaaaa'},Logger:{log(){}},
 SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null,insertSheet(n){sheets[n]=new Sheet([]);return sheets[n]},getSheets:()=>Object.values(sheets)})},
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>'tok',setProperty(){}})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(SRC,'utf8'),ctx);

ctx.setup();
console.log('表頭 ',old.rows[0].join('|'));
console.log('第一列',old.rows[1].join('|'));
console.log('第二列',old.rows[2].join('|'));
assert.strictEqual(old.rows[0].join('|'),Array.from(ctx.TASK_HEADERS).join('|'),'表頭升級');
const r=ctx.handle_('tasks',{},'tok').rows;
const t1=r.find(x=>x.id==='T1'),t2=r.find(x=>x.id==='T2');
assert.strictEqual(t1.priority,'A','高→A');
assert.strictEqual(t2.priority,'C','低→C');
assert.strictEqual(t1.estimate,'2','預估時數沒有錯位');
assert.strictEqual(t1.note,'備註甲','備註沒有錯位');
assert.strictEqual(t2.done_at,'2026-09-02 10:00','完成時間沒有錯位');
assert.strictEqual(t1.next,'','新欄位是空的');

// 再跑一次 setup 不應該重複插欄
const before=old.rows[0].length;ctx.setup();
assert.strictEqual(old.rows[0].length,before,'setup 可重複執行');
console.log('\nMIGRATION PASS');
