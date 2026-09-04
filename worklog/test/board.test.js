const path=require('path');
const SRC=process.argv[2]||path.join(__dirname,'..','Code.gs');
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let UUID=0;
const pad=n=>String(n).padStart(2,'0');
const f=(d,tz,fmt)=>fmt.includes('HH')
  ?`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  :`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

// --- fake sheet ---
function Sheet(name,rows){this.name=name;this.rows=rows}
Sheet.prototype.appendRow=function(r){this.rows.push(r.slice())};
Sheet.prototype.deleteRow=function(n){this.rows.splice(n-1,1)};
Sheet.prototype.setFrozenRows=function(){return this};
Sheet.prototype.deleteRow=function(n){this.rows.splice(n-1,1)};
Sheet.prototype.setFrozenRows=function(){return this};
Sheet.prototype.getLastRow=function(){return this.rows.length};
Sheet.prototype.getLastColumn=function(){return this.rows[0]?this.rows[0].length:0};
Sheet.prototype.getRange=function(r,c,nr,nc){const s=this;return{
  getValues(){return s.rows.slice(r-1,r-1+nr).map(x=>x.slice(c-1,c-1+nc))},
  setValues(v){v.forEach((row,i)=>{row.forEach((val,j)=>{s.rows[r-1+i][c-1+j]=val})});return this},
  setFontWeight(){return this}}};

const TASKS=[['id','建立時間','標題','專案','到期日','優先','狀態','下一步','等待者','預估時數','備註','完成時間','執行者']];
const LOGS=[['id','開始時間','結束時間','來源','專案','標題','狀態','摘要','產出連結','session_id','任務id']];
const T='2026-09-03', Y='2026-09-02', TM='2026-09-04';
function task(id,title,pj,due,pri,st,next,wait,done,owner){TASKS.push([id,T,title,pj,due,pri,st,next||'',wait||'','','',done||'',owner||''])}
function log(id,s,e,src,pj,title,st,sum,link){LOGS.push([id,s,e,src,pj,title,st,sum||'',link||'','sid'+id,''])}

task('T1','Claude SEO 優化','Claude SEO','2026-09-10','B','進行中','優化內頁標題','','','AI');
task('T2','吳若樺貼文完成定稿','行銷構圖',T,'A','待辦','審核發佈');
task('T3','中秋禮盒控單程式確認','食品開發 AI',T,'A','待辦','程式驗證');
task('T4','合約等 PN 回覆','行銷構圖',TM,'C','待辦','','PN');
task('T5','測試訂單完成','Shopline',TM,'A','待辦');
task('T6','早就該做的事','行銷構圖','2026-08-20','A','待辦','補做','','','AI');   // 逾期
task('T7','已完成的','Shopline',T,'A','完成','','', T+' 11:15');
task('T8','沒排日期','食品開發 AI','','B','待辦','等排程','','','一起');
log('L1',T+' 09:00',T+' 10:30','Claude Code','工作看板','建立 board API','完成','加了 board_','https://drive.google.com/file/d/abc/view');
log('L2',T+' 10:40','','Cowork','起士公爵','FB 廣告週報','進行中','抓數據中');
log('L3',Y+' 14:00',Y+' 15:00','Cowork','起士公爵','昨天的事','完成');

const METRICS=[['日期','營業額','訂單數','廣告花費','流量','加入購物車','更新時間'],
  [T,48200,31,12500,1840,96,T+' 14:30']];
const sheets={'指標':new Sheet('指標',METRICS),'任務':new Sheet('任務',TASKS),'紀錄':new Sheet('紀錄',LOGS),'簡報':new Sheet('簡報',[['日期','產生時間','內容'],[T,T+' 07:30','昨天：完成 board API。\n今天必做：吳若樺貼文定稿。\n建議：先清逾期那件。']])};
const ctx={Utilities:{formatDate:f,getUuid:()=>'u'+String(++UUID).padStart(7,'0')+'-'+UUID},Logger:{log(){}},
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

// ---- 專案總覽：日/週/月 ----
const wk=ctx.handle_('projects',{range:'week',date:T},'tok');
assert(wk.ok,'projects: '+wk.error);
assert.strictEqual(wk.from+'~'+wk.to,'2026-08-31~2026-09-06','週區間');
assert.strictEqual(wk.total,5,'本週五件（含已完成；8/20 那件與未排日期的都不在區間）');
assert.strictEqual(wk.done,1);
const day=ctx.handle_('projects',{range:'day',date:T},'tok');
assert.strictEqual(day.from,day.to,'單日區間頭尾同一天');
assert.strictEqual(day.total,3,'9/3 三件');
const mo=ctx.handle_('projects',{range:'month',date:T},'tok');
assert.strictEqual(mo.from+'~'+mo.to,'2026-09-01~2026-09-30','月區間');
assert(mo.total>wk.total,'月比週多');
assert.strictEqual(ctx.handle_('projects',{range:'亂寫',date:T},'tok').range,'week','區間亂給就當週');
assert(wk.unscheduled.every(t=>!t.due),'未排日期另外裝一袋');
assert(wk.unscheduled.some(t=>t.title==='沒排日期'));
assert(!wk.projects.some(p=>p.tasks.some(t=>t.status==='取消')),'取消的不算');
assert.strictEqual(wk.projects[0].name,'行銷構圖','未完成最多的排最前');
assert.strictEqual(wk.tasks.length,wk.total,'日曆用的扁平任務數＝區間總數');
assert(wk.tasks.every(t=>t.due>=wk.from&&t.due<=wk.to||t.done_at),'扁平任務都落在區間內');
assert.strictEqual(wk.logs.length,3,'本週三筆紀錄，日曆時間軸要用');
assert.strictEqual(wk.logs[0].start<wk.logs[2].start,true,'日曆用的紀錄由舊到新');
assert.strictEqual(ctx.handle_('projects',{range:'day',date:T},'tok').logs.length,2,'單日兩筆');
assert.strictEqual(ctx.handle_('logs',{range:'week',date:T},'tok').rows[0].start>
                   ctx.handle_('logs',{range:'week',date:T},'tok').rows[2].start,true,'清單用的仍是新的在前');

// ---- 產出資料庫 ----
const out=ctx.handle_('outputs',{},'tok');
assert(out.ok,'outputs: '+out.error);
assert.strictEqual(out.rows.length,1,'預設只列有產出連結的');
assert.strictEqual(out.rows[0].title,'建立 board API');
assert.strictEqual(out.linked,1);
assert.strictEqual(ctx.handle_('outputs',{all:'1'},'tok').rows.length,3,'all=1 連沒連結的一起列');
assert.strictEqual(ctx.handle_('outputs',{source:'Cowork',all:'1'},'tok').rows.length,2,'依來源過濾');
assert.strictEqual(ctx.handle_('outputs',{source:'沒這個',all:'1'},'tok').rows.length,0);
const cnt=ctx.handle_('outputs',{all:'1'},'tok').bySource;
assert.strictEqual(cnt['Claude Code']+cnt['Cowork'],3,'來源統計不受過濾影響');
assert(out.rows.length===0||out.rows.every(r=>r.link),'列出來的都有連結');

// ---- AI 專案池 ----
const pl=ctx.handle_('pool',{date:T},'tok');
assert(pl.ok,'pool: '+pl.error);
// 這頁只收交給 AI 的（含「一起」）；自己要做的不進來，那是每日看板的事
assert.strictEqual(pl.backlog,3,'T1(AI)、T6(AI)、T8(一起)');
assert.strictEqual(pl.mine,5,'自己要做的還有幾件，空畫面才說得出話');
assert.strictEqual(pl.overdue,1);
const poolTitles=pl.order.map(o=>o.task.title);
assert(!poolTitles.includes('吳若樺貼文完成定稿'),'沒標執行者＝自己做，不該出現');
assert(!poolTitles.includes('中秋禮盒控單程式確認'));
assert(poolTitles.includes('Claude SEO 優化')&&poolTitles.includes('沒排日期'),'AI 與一起都要收');
assert(pl.projects.every(p=>p.tasks.every(t=>t.owner!=='我')),'各專案剩什麼也只列 AI 的');
assert.strictEqual(pl.yesterday.length,1,'昨天一筆紀錄');
assert.strictEqual(pl.yesterdayHours,1);
assert.strictEqual(pl.order[0].task.title,'早就該做的事','逾期最急');
assert(/逾期 14 天/.test(pl.order[0].reason),'理由要講逾期幾天：'+pl.order[0].reason);
// 建議理由與排序直接驗那兩支函式——不必為了測理由，把「合約等 PN 回覆」硬說成 AI 的事
// 兩件只差在「已開工」和「卡在別人身上」，其他條件一樣，才比得出那兩個加權
const doingT={status:'進行中',due:TM,priority:'B',waiting:''};
const waitingT={status:'待辦',due:TM,priority:'B',waiting:'PN'};
assert.strictEqual(ctx.whyNow_(doingT,T),'已經在做，收掉它');
assert.strictEqual(ctx.whyNow_(waitingT,T),'等 PN，先去催');
assert.strictEqual(ctx.whyNow_({status:'待辦',due:'',priority:'A',waiting:''},T),'A 優先處理');
assert(ctx.urgency_(waitingT,T)>ctx.urgency_(doingT,T),'卡在別人身上的往後排');
assert(pl.projects.every(p=>Array.isArray(p.tasks)),'每個專案帶著自己的任務');
assert.strictEqual(pl.order.length,3,'池子裡就這三件');

// ---- AI 跑過的任務自動標成 AI ----
// Claude Code / Cowork 對某個任務寫了紀錄，就代表那件事實際上是 AI 在做。
{
  const before=ctx.handle_('tasks',{},'tok').rows.filter(t=>t.id==='T2')[0];
  assert.strictEqual(ctx.normOwner_(before.owner),'我','原本是自己做');
  ctx.handle_('log',{source:'Cowork',title:'幫你把貼文定稿了',task_id:'T2',status:'完成',
    session_id:'auto1'},'tok');
  assert.strictEqual(ctx.handle_('tasks',{},'tok').rows.filter(t=>t.id==='T2')[0].owner,'AI',
    'AI 跑過就自動補標記');
  // 手動紀錄不算——那是自己做的
  ctx.handle_('log',{source:'手動',title:'我自己做的',task_id:'T3',status:'完成',
    session_id:'auto2'},'tok');
  assert.strictEqual(ctx.normOwner_(ctx.handle_('tasks',{},'tok').rows.filter(t=>t.id==='T3')[0].owner),
    '我','手動紀錄不該把任務標成 AI');
  // 已經標「一起」的是刻意的，不要被蓋成 AI
  ctx.handle_('log',{source:'Claude Code',title:'跑了一段',task_id:'T8',status:'完成',
    session_id:'auto3'},'tok');
  assert.strictEqual(ctx.handle_('tasks',{},'tok').rows.filter(t=>t.id==='T8')[0].owner,'一起',
    '「一起」是刻意標的，不要蓋掉');
  console.log('自動標記   Cowork 跑過 T2 → 執行者變 AI');
}

// ---- 從別的工具匯入之後的補齊 ----
// 貼進來的列沒有 id，看板認不出那張卡片，按「開始」「完成」都會失敗。
{
  const sh=sheets['任務'];
  const before=sh.rows.length;
  // 模擬從 Notion 貼進來的四列：沒有 id、沒有建立時間、優先與狀態是別人的寫法
  sh.rows.push(['','','Notion 來的甲','中秋禮盒','September 3, 2026','High','In progress','','','','']);
  sh.rows.push(['','','Notion 來的乙','Shopline','2026/9/5','P3','Done','','','','']);
  sh.rows.push(['','','Notion 來的丙','','下週三','Critical','Backlog','','','','原本的備註']);
  sh.rows.push(['','','Notion 來的丁','','','','','','','','']);
  const bf=ctx.handle_('backfill',{},'tok');
  assert(bf.ok,'backfill: '+bf.error);
  assert.strictEqual(bf.id,4,'四筆都補了 id');
  assert.strictEqual(bf.created,4,'四筆都補了建立時間');
  assert.strictEqual(bf.dueBad,1,'「下週三」看不懂');
  assert.strictEqual(bf.samples[0],'下週三','會回報看不懂的原文');

  const got=ctx.handle_('tasks',{},'tok').rows;
  const g=n=>got.filter(t=>t.title===n)[0];
  assert(/^T/.test(g('Notion 來的甲').id),'id 補成 T 開頭');
  assert.strictEqual(g('Notion 來的甲').due,'2026-09-03','September 3, 2026');
  assert.strictEqual(g('Notion 來的甲').priority,'A','High → A');
  assert.strictEqual(g('Notion 來的甲').status,'進行中','In progress → 進行中');
  assert.strictEqual(g('Notion 來的乙').due,'2026-09-05','2026/9/5 補零');
  assert.strictEqual(g('Notion 來的乙').priority,'C','P3 → C');
  assert.strictEqual(g('Notion 來的乙').status,'完成','Done → 完成');
  assert.strictEqual(g('Notion 來的乙').done_at,'','不編一個完成時間出來');
  // Critical 開頭是 C，但它的意思是最急——完整字串要先比，不能只看第一個字母
  assert.strictEqual(g('Notion 來的丙').priority,'A','Critical → A 而不是 C');
  assert.strictEqual(g('Notion 來的丙').status,'待辦','Backlog → 待辦');
  assert.strictEqual(g('Notion 來的丙').due,'','看不懂的日期清空，不亂猜');
  assert(g('Notion 來的丙').note.includes('原到期日：下週三'),'原文留在備註');
  assert(g('Notion 來的丙').note.includes('原本的備註'),'原有的備註不被蓋掉');
  assert.strictEqual(g('Notion 來的丁').priority,'B','沒填優先就當 B');
  assert.strictEqual(g('Notion 來的丁').status,'待辦','沒填狀態就當待辦');

  // 補過的卡片要真的動得了——這才是補齊的目的
  const id=g('Notion 來的甲').id;
  assert(ctx.handle_('task_update',{id:id,status:'完成'},'tok').ok,'補完就改得動了');

  // 重複跑不該再動任何東西
  const again=ctx.handle_('backfill',{},'tok');
  assert.strictEqual(again.id,0,'第二次沒有要補的 id');
  assert.strictEqual(again.due,0,'第二次沒有要改的日期');
  assert.strictEqual(again.priority,0,'第二次沒有要改的優先');
  assert.strictEqual(again.dueBad,0,'已經清空的日期不會再被報一次');
  assert.strictEqual(sh.rows.length,before+4,'不會多長出列來');
  console.log('匯入補齊   '+bf.rows+' 筆，看不懂的日期 '+bf.dueBad+' 筆移到備註');
}

// ---- 生意數字 ----
// 看板連不到 Shopline 和 FB 廣告管理員，數字由 Cowork 寫進「指標」表，這裡只換算。
const mt=ctx.handle_('metrics',{date:T},'tok').metrics;
assert(mt.has,'今天有數字');
assert.strictEqual(mt.revenue,48200);
assert.strictEqual(mt.roas,3.86,'ROAS＝營業額÷廣告花費');
assert.strictEqual(mt.cpc,6.79,'流量成本＝廣告花費÷流量');
assert.strictEqual(mt.cpaCart,130.21,'加購成本＝廣告花費÷加入購物車');
assert.strictEqual(b.metrics.revenue,48200,'看板一次就把數字帶回來，不用再打一次 API');

// 沒有數字的日子不能噴 Infinity/NaN，要給 null 讓前端顯示「—」
const none=ctx.handle_('metrics',{date:'2026-01-01'},'tok').metrics;
assert.strictEqual(none.has,false);
assert.strictEqual(none.roas,null);
assert.strictEqual(none.revenue,null);

// 寫入：只覆蓋這次帶到的欄位，其他保留
const ms=ctx.handle_('metrics_save',{date:T,spend:20000},'tok').metrics;
assert.strictEqual(ms.spend,20000,'花費更新了');
assert.strictEqual(ms.revenue,48200,'沒帶的營業額原封不動');
assert.strictEqual(ms.roas,2.41,'比率跟著重算');
assert(ms.updated,'記更新時間');
// Cowork 是用網址送的，數字會是字串，還可能帶千分位和錢字號
const mstr=ctx.handle_('metrics_save',{date:T,revenue:'$52,300',clicks:'2000'},'tok').metrics;
assert.strictEqual(mstr.revenue,52300,'字串帶符號也要吃得下');
assert.strictEqual(mstr.clicks,2000);
assert(!ctx.handle_('metrics_save',{date:T},'tok').ok,'一個數字都沒帶就要報錯');
// 新的一天沒有那一列，要自己長出來
const mnew=ctx.handle_('metrics_save',{date:'2026-09-04',revenue:100,spend:50},'tok').metrics;
assert.strictEqual(mnew.roas,2);
console.log('生意數字   營業額 '+mstr.revenue+' / 花費 '+mstr.spend+' / ROAS '+mstr.roas);

// ---- 手改紀錄 ----
// 日曆上點時間區塊改的就是這個。hook 寫進來的標題常常只是當下的 prompt。
const someLog=ctx.handle_('logs',{range:'all'},'tok').rows[0]
  ||ctx.handle_('outputs',{all:'1'},'tok').rows[0];
const lu=ctx.handle_('log_update',
  {id:someLog.id,title:'改過的標題',summary:'補上的摘要',project:'個人'},'tok');
assert(lu.ok,'log_update: '+lu.error);
assert.strictEqual(lu.row.title,'改過的標題');
assert.strictEqual(lu.row.summary,'補上的摘要');
assert.strictEqual(lu.row.start,someLog.start,'時間不能被改掉');
assert.strictEqual(lu.row.source,someLog.source,'來源不能被改掉');
// 空字串是「清掉」，不是「略過」——不然改錯了就再也刪不掉
assert.strictEqual(ctx.handle_('log_update',{id:someLog.id,summary:''},'tok').row.summary,'');
assert(!ctx.handle_('log_update',{id:'沒這筆',title:'x'},'tok').ok,'找不到就要報錯');
assert(!ctx.handle_('log_update',{title:'x'},'tok').ok,'沒給 id 就要報錯');
console.log('改紀錄     '+lu.row.id+' → '+lu.row.title);

// ---- 完成項目 ----
const dn=ctx.handle_('done',{range:'week',date:T},'tok');
assert(dn.ok,'done: '+dn.error);
assert.strictEqual(dn.range,'week');
assert.strictEqual(dn.items.length,dn.total);
assert(dn.items.every(x=>x.at),'每項都有完成時間');
assert(dn.items.every((x,i,a)=>i===0||a[i-1].at>=x.at),'新的排前面');
// 指名抓那一筆——別的測試會再寫進紀錄，「第一筆」不是穩定的錨
const lg=dn.items.find(x=>x.kind==='log'&&x.title==='建立 board API');
assert.strictEqual(lg.link,'https://drive.google.com/file/d/abc/view','紀錄帶產出連結');
assert.strictEqual(dn.withLink,1,'有產出的項數');
assert(dn.items.some(x=>x.kind==='task'&&x.title==='已完成的'),'完成的任務也要列進來');
assert(!dn.items.some(x=>x.source==='任務'&&x.priority===''),'任務項要帶優先級');
assert(dn.items.every(x=>x.source!=='Cowork'||x.at.slice(0,10)>=dn.from),'區間外的不列');
assert.strictEqual(ctx.handle_('done',{range:'day',date:'2026-08-20'},'tok').items.length,0,'那天沒有完成項目');
const all=ctx.handle_('done',{range:'all'},'tok');
assert(all.items.length>=dn.items.length,'全部區間至少不會比本週少');
assert.strictEqual(all.from,'0000-00-00','全部就是不設限');
assert.strictEqual(ctx.handle_('done',{range:'亂寫'},'tok').range,'week','區間亂給就當週');

// 掛在任務底下的紀錄，不重複列那個任務
ctx.handle_('log',{source:'Cowork',title:'替 T2 做的',status:'完成',task_id:'T2',
  link:'https://x/y',path:'/Users/penny/報告'},'tok');
const dn2=ctx.handle_('done',{range:'week',date:T},'tok');
assert(dn2.items.some(x=>x.title==='替 T2 做的'&&x.path==='/Users/penny/報告'),'檔案位置存得進去');

// ---- 資料區 ----
sheets['分區']=new Sheet('分區',[['id','名稱','顏色','順序']]);
sheets['資料']=new Sheet('資料',[['id','分區','標題','內容','順序','建立時間']]);
const d0=ctx.handle_('data',{},'tok');
assert(d0.ok,'data: '+d0.error);
assert.deepStrictEqual([d0.sections.length,d0.items.length],[0,0],'一開始是空的');

const s1=ctx.handle_('sect_save',{name:'渠道'},'tok');
assert(s1.ok,'sect_save: '+s1.error);
assert.strictEqual(s1.row.name,'渠道');
assert.strictEqual(+s1.row.order,1,'第一個分區順序為 1');
const s2=ctx.handle_('sect_save',{name:'素材'},'tok');
assert.strictEqual(+s2.row.order,2,'新分區接在最後面');
assert.notStrictEqual(s1.row.color,s2.row.color,'預設顏色會輪替');
assert.strictEqual(s2.data.sections.length,2,'回應直接帶新的資料，前端不用再要一次');

const rn=ctx.handle_('sect_save',{id:s1.row.id,name:'投放渠道'},'tok');
assert.strictEqual(rn.row.name,'投放渠道','分區可以改名');
assert.strictEqual(rn.row.color,s1.row.color,'改名不動顏色');

const i1=ctx.handle_('item_save',{section:s1.row.id,body:'https://qrcd.org/8rKu'},'tok');
assert(i1.ok,'item_save: '+i1.error);
assert.strictEqual(i1.row.title,'https://qrcd.org/8rKu','沒給標題就拿內容當標題');
const i2=ctx.handle_('item_save',{section:s1.row.id,title:'官網商品',body:'備註'},'tok');
assert.strictEqual(+i2.row.order,2);
assert.strictEqual(ctx.handle_('item_save',{},'tok').ok,false,'標題與內容都空要擋下來');

const mv=ctx.handle_('item_save',{id:i1.row.id,section:s2.row.id},'tok');
assert.strictEqual(mv.row.section,s2.row.id,'卡片可以換分區');
assert.strictEqual(mv.row.title,'https://qrcd.org/8rKu','換分區不動內容');

// 刪分區：卡片留著，前端歸「未分類」，免得誤刪一整欄
const del=ctx.handle_('sect_del',{id:s2.row.id},'tok');
assert(del.ok,'sect_del: '+del.error);
assert.strictEqual(del.moved,1,'回報有幾張卡片被留下');
assert.strictEqual(del.data.sections.length,1,'分區少一個');
assert.strictEqual(del.data.items.length,2,'卡片一張都沒少');
assert(del.data.items.some(x=>x.section===s2.row.id),'孤兒卡片的分區還指著已刪的 id');

assert.strictEqual(ctx.handle_('item_del',{id:i2.row.id},'tok').data.items.length,1);
assert.strictEqual(ctx.handle_('item_del',{id:'不存在'},'tok').ok,false);
assert.strictEqual(ctx.handle_('sect_del',{},'tok').ok,false,'沒帶 id 要擋');

console.log('資料區    分區 '+del.data.sections.map(x=>x.name).join(' ')+
  ' · 卡片 '+ctx.handle_('data',{},'tok').items.length+' 張');
console.log('週專案    ', wk.projects.map(p=>`${p.name}:${p.done}/${p.count}`).join(' '));
console.log('建議順序  ', pl.order.slice(0,4).map((o,i)=>`${i+1}.${o.task.title}(${o.reason})`).join(' '));
console.log('產出      ', out.rows.map(r=>r.title+'→'+r.link).join(' '));

console.log('\nALL PASS');
