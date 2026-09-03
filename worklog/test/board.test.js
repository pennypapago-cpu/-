const path=require('path');
const SRC=process.argv[2]||path.join(__dirname,'..','Code.gs');
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const pad=n=>String(n).padStart(2,'0');
const f=(d,tz,fmt)=>fmt.includes('HH')
  ?`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  :`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// --- fake sheet ---
function Sheet(name,rows){this.name=name;this.rows=rows}
Sheet.prototype.appendRow=function(r){this.rows.push(r.slice())};
Sheet.prototype.getLastRow=function(){return this.rows.length};
Sheet.prototype.getLastColumn=function(){return this.rows[0]?this.rows[0].length:0};
Sheet.prototype.getRange=function(r,c,nr,nc){const s=this;return{
  getValues(){return s.rows.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc))},
  setValues(v){v.forEach((row,i)=>{row.forEach((val,j)=>{s.rows[r-1+i][c-1+j]=val})});return this},
  setFontWeight(){return this}}};

const TASKS=[['id','建立時間','標題','專案','到期日','優先','狀態','下一步','等待者','預估時數','備註','完成時間']];
const LOGS=[['id','開始時間','結束時間','來源','專案','標題','狀態','摘要','產出連結','session_id','任務id']];
const T='2026-09-03', Y='2026-09-02', TM='2026-09-04';
function task(id,title,pj,due,pri,st,next,wait,done){TASKS.push([id,T,title,pj,due,pri,st,next||'',wait||'','','',done||''])}
function log(id,s,e,src,pj,title,st,sum){LOGS.push([id,s,e,src,pj,title,st,sum||'','','sid'+id,''])}

task('T1','Claude SEO 優化','Claude SEO','2026-09-10','B','進行中','優化內頁標題');
task('T2','吳若樺貼文完成定稿','行銷構圖',T,'A','待辦','審核發佈');
task('T3','中秋禮盒控單程式確認','食品開發 AI',T,'A','待辦','程式驗證');
task('T4','合約等 PN 回覆','行銷構圖',TM,'C','待辦','','PN');
task('T5','測試訂單完成','Shopline',TM,'A','待辦');
task('T6','早就該做的事','行銷構圖','2026-08-20','A','待辦','補做');   // 逾期
task('T7','已完成的','Shopline',T,'A','完成','','', T+' 11:15');
task('T8','沒排日期','食品開發 AI','','B','待辦','等排程');
log('L1',T+' 09:00',T+' 10:30','Claude Code','工作看板','建立 board API','完成','加了 board_');
log('L2',T+' 10:40','','Cowork','起士公爵','FB 廣告週報','進行中','抓數據中');
log('L3',Y+' 14:00',Y+' 15:00','Cowork','起士公爵','昨天的事','完成');

const sheets={'任務':new Sheet('任務',TASKS),'紀錄':new Sheet('紀錄',LOGS),'簡報':new Sheet('簡報',[['日期','產生時間','內容'],[T,T+' 07:30','昨天：完成 board API。\n今天必做：吳若樺貼文定稿。\n建議：先清逾期那件。']])};
const ctx={Utilities:{formatDate:f,getUuid:()=>'aaaaaaaa-bbbb'},Logger:{log(){}},
  SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null})},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>'tok',setProperty(){}})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(SRC,'utf8'),ctx);

const b=ctx.handle_('board',{date:T},'tok');
assert(b.ok,'board failed: '+b.error);
const names=a=>a.map(x=>x.title);
console.log('running   ', names(b.running));
console.log('liveLogs  ', names(b.liveLogs));
console.log('today     ', names(b.today));
console.log('tomorrow  ', names(b.tomorrow));
console.log('unsched   ', names(b.unscheduled));
console.log('projects  ', b.projects.map(p=>`${p.name}[${p.priority}] next=${p.next||'-'} due=${p.due||'-'} n=${p.count} od=${p.overdue}`));
console.log('stats     ', b.stats);
console.log('note?     ', !!b.note);

assert.deepStrictEqual(names(b.running),['Claude SEO 優化']);
assert.deepStrictEqual(names(b.liveLogs),['FB 廣告週報']);
assert.deepStrictEqual(names(b.today).sort(),['中秋禮盒控單程式確認','吳若樺貼文完成定稿','早就該做的事'].sort());
assert.deepStrictEqual(names(b.tomorrow).sort(),['合約等 PN 回覆','測試訂單完成'].sort());
assert.deepStrictEqual(names(b.unscheduled),['沒排日期']);
assert.strictEqual(b.stats.doneToday,1,'doneToday');
assert.strictEqual(b.stats.totalToday,1+3+1,'totalToday = done + today3 + running1');
assert.strictEqual(b.stats.focusHours,1.5,'focusHours 09:00-10:30');
assert.strictEqual(b.stats.highValuePct,75,'A 三件 / 範圍四件（今日三件＋進行中一件）');
assert.strictEqual(b.projects[0].overdue,1,'逾期專案排最前');
assert.strictEqual(b.projects[0].name,'行銷構圖');

// legacy priority + 等待者
const legacy=ctx.handle_('tasks',{status:'open'},'tok').rows;
assert(legacy.every(t=>['A','B','C'].includes(t.priority)),'priority normalised');
assert.strictEqual(legacy.find(t=>t.id==='T4').waiting,'PN','waiting kept');

// task_add 預設 B、可帶 next/waiting
const addRes=ctx.handle_('task_add',{title:'新的',next:'先寫規格',waiting:'老闆'},'tok');
assert(addRes.ok,'task_add: '+addRes.error);const added=addRes.row;
assert.strictEqual(added.priority,'B');assert.strictEqual(added.next,'先寫規格');assert.strictEqual(added.waiting,'老闆');
// task_update 改優先級用中文也行
const upRes=ctx.handle_('task_update',{id:'T5',priority:'高',next:'確認金流'},'tok');
assert(upRes.ok,'task_update: '+upRes.error);const up=upRes.row;
assert.strictEqual(up.priority,'A');assert.strictEqual(up.next,'確認金流');

// ---- 專注時間要跟昨天比 ----
const b2=ctx.handle_('board',{date:T},'tok');
assert.strictEqual(b2.stats.focusHoursPrev,1,'昨天 14:00-15:00 = 1 小時');
assert.strictEqual(b2.stats.overdue,1,'鈴鐺數＝逾期任務數');

// ---- 任務日曆 ----
const cal=ctx.handle_('calendar',{month:'2026-09'},'tok');
assert(cal.ok,'calendar: '+cal.error);
assert.strictEqual(cal.month,'2026-09');
assert.strictEqual(cal.days[T].length,3,'9/3 當天三件：兩件待辦＋一件已完成');
assert.strictEqual(cal.days[T][0].priority,'A','同一天 A 排最前');
assert(!cal.days['2026-08-20'],'不是這個月的不會出現');
const calAug=ctx.handle_('calendar',{month:'2026-08'},'tok');
assert.strictEqual(calAug.days['2026-08-20'].length,1,'切到上個月看得到逾期那件');
assert.strictEqual(ctx.handle_('calendar',{},'tok').month,ctx.fmtDate_(new Date()).slice(0,7),'沒帶月份就用當月');

// ---- 目標追蹤 ----
const g=ctx.handle_('goals',{date:T},'tok');
assert(g.ok,'goals: '+g.error);
assert.strictEqual(g.weeks.length,6,'六週');
assert.strictEqual(g.weeks[5].from,'2026-08-31','最後一週是本週');
assert.strictEqual(g.weeks[5].focusHours,2.5,'本週專注時間＝今天 1.5h＋昨天 1h');
assert.strictEqual(g.weeks[5].done,1,'本週完成一件');
assert.strictEqual(g.weeks[5].highDone,1,'那件是 A 級');
assert.strictEqual(g.overdue,1);
assert.strictEqual(g.byPriority.map(x=>x.priority+':'+x.open).join(' '),'A:4 B:3 C:1');
assert.strictEqual(g.backlog,8,'未完成任務數');
console.log('calendar  ', Object.keys(cal.days).sort().join(' '));
console.log('goals wk  ', g.weeks.map(w=>`${w.from}:${w.done}/${w.total}@${w.focusHours}h`).join(' '));
console.log('byPriority', g.byPriority.map(x=>x.priority+':'+x.open).join(' '));

console.log('\nALL PASS');
