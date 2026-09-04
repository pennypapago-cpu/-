const path=require('path');
const SRC=process.argv[2]||path.join(__dirname,'..','index.html');
// 用假的 DOM 驗證拖曳的決策邏輯：哪一欄可以放、放下去要送什麼欄位
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(SRC,'utf8');
const js=src.split('<script>')[1].split('</script>')[0];

let sent=null,loaded=0,toasts=[];
function El(cls,drop){this.className=cls;this.dataset=drop?{drop:drop}:{};this.classList={
  _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
  toggle(c){this._s.has(c)?this._s.delete(c):this._s.add(c)}, contains(c){return this._s.has(c)}}}
const cols={run:new El('col c-run','run'),today:new El('col c-today','today'),tmr:new El('col c-tmr','tmr')};

function mkStub(){return{className:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},
  addEventListener(){},appendChild(){},remove(){},cloneNode(){return this},
  getBoundingClientRect(){return{left:0,top:0,width:100}},focus(){},querySelectorAll(){return[]},
  closest(){return null},value:'',innerHTML:'',textContent:'',disabled:false}}
const stub=mkStub();
// 每個 id 給自己的節點，才驗得出「編輯紀錄時 seg 藏起來、標題換成編輯紀錄」這種跨節點的狀態
const els={};
const ctx={
  document:{addEventListener(){},getElementById(i){return els[i]||(els[i]=mkStub())},querySelectorAll(){return[]},
    documentElement:{style:{setProperty(){},fontSize:''}},
    elementFromPoint(){return null},body:{classList:{add(){},remove(){}},appendChild(){}},createElement(){return stub}},
  window:{},localStorage:{getItem(){return 'tok'},setItem(){},removeItem(){}},
  setTimeout(f,ms){return 0},clearTimeout(){},location:{reload(){}},
  google:{script:{run:{withSuccessHandler(f){this._s=f;return this},
    withFailureHandler(f){return this},
    uiCall(tok,action,params){sent={action,params};this._s({ok:true})}}}}};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(js.replace(/^boot\(\);$/m,''),ctx);
ctx.load=function(){loaded++};ctx.toast=function(m){toasts.push(m)};

const T=ctx.today();
const tomorrow=(()=>{const d=new Date();d.setDate(d.getDate()+1);return ctx.ymd(d)})();

// vm 裡建的物件跟外面不同 realm，deepStrictEqual 會失敗，改比 JSON
function move(id,to,from){sent=null;ctx.toCol(id,to,from);return sent?JSON.stringify(sent):null}
// 看板頁的寫入會多帶 board:1，請伺服器把新看板一起回來，省一趟請求
function want0(o){o.params.board=1;return JSON.stringify(o)}
function want(o){return JSON.stringify(o)}

// 移到執行中：只改狀態，不動日期
assert.strictEqual(move('T1','run','today'),want0({action:'task_update',params:{id:'T1',status:'進行中'}}));
// 移到今日：設今天，狀態不動（本來就是待辦）
assert.strictEqual(move('T2','today','tmr'),want0({action:'task_update',params:{id:'T2',due:T}}));
// 移到明日：設明天
assert.strictEqual(move('T3','tmr','today'),want0({action:'task_update',params:{id:'T3',due:tomorrow}}));
// 從執行中拖出來：改日期並退回待辦
assert.strictEqual(move('T4','today','run'),want0({action:'task_update',params:{id:'T4',due:T,status:'待辦'}}));
assert.strictEqual(move('T5','tmr','run'),want0({action:'task_update',params:{id:'T5',due:tomorrow,status:'待辦'}}));
// 丟回原欄：什麼都不做
assert.strictEqual(move('T6','today','today'),null,'同一欄不送 API');
assert.strictEqual(move('T7','run','run'),null);

// 只有看板頁才需要順便回看板；其他頁的寫入不該帶這個旗標
ctx.VIEW='pool';
assert.strictEqual(move('T9','run','today'),want({action:'task_update',params:{id:'T9',status:'進行中'}}),
  '非看板頁不帶 board 旗標');
ctx.VIEW='board';

// 動作列按鈕：目前所在那一欄不該出現自己的「移到」按鈕
const t={id:'X',title:'t',priority:'A',status:'待辦',due:T,project:'',next:'',waiting:''};
assert(!ctx.taskCard(t,'today').includes('移到今日'),'今日欄不出現「移到今日」');
assert(ctx.taskCard(t,'today').includes('移到明日'));
assert(ctx.taskCard(t,'tmr').includes('移到今日'));
assert(!ctx.taskCard(t,'tmr').includes('移到明日'));
assert(ctx.taskCard(t,'run').includes('移到今日')&&ctx.taskCard(t,'run').includes('移到明日'));
// 執行中的卡不該再出現「開始」
assert(!ctx.taskCard(Object.assign({},t,{status:'進行中'}),'run').includes('>開始<'));
// 卡片要帶 data-id 才拖得動；紀錄卡不帶
assert(ctx.taskCard(t,'today').includes('data-id="X"'));
// 卡片上不再出現專案與優先標籤，改成左側色帶＋下一步那行的小字
const card=ctx.taskCard({id:'Y',title:'標',priority:'A',status:'待辦',due:T,project:'起士公爵',next:'先寫',waiting:''},'today');
assert(card.includes('class="t pA"'),'優先級改用左側色帶：'+card.slice(0,90));
assert(!/class="tag /.test(card),'卡片不該再有 tag 標籤');
assert(card.includes('<em>起士公爵</em>'),'專案縮成小字');
assert(card.includes('title="A 優先處理"'),'色帶滑過去要看得到是什麼等級');
assert(!ctx.logCard({title:'l',source:'Cowork',start:'2026-09-03 10:00',project:'',summary:''}).includes('data-id'));
// 欄位要有 data-drop
assert(ctx.col('c-today','📅','今日工作',[],'空').includes('data-drop="today"'));
assert(ctx.col('c-run','⏰','AI','',[]).includes('data-drop="run"'));


// ---- 日曆的純函式 ----
assert.strictEqual(ctx.tmin('2026-09-03 09:30'),570,'09:30 = 570 分');
assert.strictEqual(ctx.tmin('2026-09-03'),null,'沒有時間就是 null');
assert.strictEqual(ctx.tmin(''),null);
assert.strictEqual(ctx.days('2026-08-31','2026-09-06').length,7,'一週七天');
assert.strictEqual(ctx.days('2026-09-03','2026-09-03').join(''),'2026-09-03','單日一格');
assert.strictEqual(ctx.days('2026-08-31','2026-09-06')[6],'2026-09-06','跨月接得起來');
assert.strictEqual(ctx.srcCls('Claude Code'),'cc');
assert.strictEqual(ctx.srcCls('Cowork'),'cw2');
assert.strictEqual(ctx.srcCls('手動'),'mn');
assert.strictEqual(ctx.logHours([{start:'2026-09-03 09:00',end:'2026-09-03 10:30'},
                                 {start:'2026-09-03 11:00',end:''}]),1.5,'沒結束時間的不算時數');

// 時間重疊的紀錄要並排，不是互相蓋住
const L=(a,b,t)=>({start:'2026-09-03 '+a,end:b?'2026-09-03 '+b:'',source:'Cowork',title:t,project:''});
const two=ctx.lay([L('09:00','11:00','甲'),L('10:00','12:00','乙')],8*60,19*60,44);
assert.strictEqual((two.match(/class="ev /g)||[]).length,2);
assert((two.match(/width:calc\(50% - 4px\)/g)||[]).length===2,'兩個重疊各佔一半：'+two.slice(0,160));
const apart=ctx.lay([L('09:00','10:00','甲'),L('11:00','12:00','乙')],8*60,19*60,44);
assert((apart.match(/width:calc\(100% - 4px\)/g)||[]).length===2,'不重疊就各自佔滿');
assert(/top:44.0px/.test(apart),'09:00 從 8 點起算是第 44px');
// 還在跑的沒有結束時間，畫成虛線且有最小高度
const live=ctx.lay([L('09:00','','跑'),],8*60,19*60,44);
assert(/ev cw2 run/.test(live),'執行中要標虛線');
assert(/height:2[0-9.]+px/.test(live),'執行中畫 30 分鐘高');
// 超出時間軸範圍的不畫
assert.strictEqual(ctx.lay([L('03:00','04:00','早')],8*60,19*60,44),'','範圍外不畫');

// ---- 刪除：軟刪除成「取消」，不是真的移除那一列 ----
ctx.EDIT='T9';sent=null;ctx.doDel();
assert.strictEqual(JSON.stringify(sent),
  want0({action:'task_update',params:{id:'T9',status:'取消'}}),'刪除＝把狀態設成取消');
ctx.EDIT=null;sent=null;ctx.doDel();
assert.strictEqual(sent,null,'沒在編輯任何任務時，刪除不做事');

// ---- 資料區：就地編輯 ----
// 第一行當標題，整段存進 body
assert.strictEqual(ctx.head1('官網商品\n備註第二行'),'官網商品');
assert.strictEqual(ctx.head1('\n\n  前面空白  \n第二行'),'前面空白','跳過空行、去頭尾空白');
assert.strictEqual(ctx.head1('x'.repeat(80)).length,60,'標題截到 60 字');
assert.strictEqual(ctx.head1(''),'');

// 卡片不再用 onclick，改走委派，才吃得到拖曳後的保護
const nc=ctx.noteCard({id:'D1',title:'官網商品',body:'官網商品\n第二行'});
assert(!/onclick="editItem/.test(nc),'卡片不該再掛 onclick');
assert(nc.includes('data-item="D1"'));
assert(nc.includes('第二行'),'第一行是標題，其餘顯示在下面');
assert(!/<div class="b">官網商品/.test(nc),'標題不要重複顯示一次');
assert(nc.includes('delItem'),'卡片要有刪除鈕');
// 單行網址顯示成連結
const link=ctx.noteCard({id:'D2',title:'https://qrcd.org/8rKu',body:'https://qrcd.org/8rKu'});
assert(link.includes('<a class="u" href="https://qrcd.org/8rKu"'),'網址要能點');
assert(!/class="b"/.test(link),'網址卡片不再重複顯示一次內容');
// 介面不該再有瀏覽器的 prompt
assert(!/\bprompt\(/.test(src),'不要再用 prompt 輸入');

// ---- 每個側欄項目都要有對應的渲染函式 ----
// 這條是補課：先前把 goals() 連同一整段程式碼刪掉，但 paint() 裡的呼叫還留著，
// 「目標追蹤」那頁點下去就是空白，沒有任何測試發現。
ctx.VIEWS.forEach(v=>assert.strictEqual(typeof ctx[v.v],'function',
  '側欄有「'+v.n+'」但找不到 '+v.v+'() 這個渲染函式'));
const painted=src.split('function paint()')[1].split('\n\n')[0];
ctx.VIEWS.forEach(v=>assert(painted.includes("VIEW==='"+v.v+"'"),
  'paint() 沒有處理「'+v.n+'」'));
console.log('側欄      '+ctx.VIEWS.map(v=>v.n).join(' / ')+' 都有渲染函式');

// ---- 統計列開關 ----
// 預設收起來；早晨簡報改放頂部橫幅，所以不會跟著一起消失
assert.strictEqual(ctx.STATS,0,'統計列預設不顯示');
const R={running:[],today:[],tomorrow:[],unscheduled:[],liveLogs:[],note:'今天必做：甲',
  stats:{doneToday:0,totalToday:3,highValuePct:33,focusHours:0,focusHoursPrev:0,weekDone:0,weekTotal:4,overdue:0}};
assert(!ctx.board(R,'').includes('優先任務占比'),'關掉時看板不含統計列');
ctx.toggleStats();
assert.strictEqual(ctx.STATS,1);
assert(ctx.board(R,'').includes('優先任務占比'),'打開就回來');
ctx.toggleStats();
assert.strictEqual(ctx.STATS,0,'可以再關掉');

// ---- 字級縮放 ----
assert.strictEqual(ctx.Z,2,'預設放大到兩倍');
ctx.zoom(1);assert.strictEqual(ctx.Z,2.1,'A＋ 每次加一成');
ctx.zoom(-1);ctx.zoom(-1);assert.strictEqual(ctx.Z,1.9);
for(let i=0;i<20;i++)ctx.zoom(1);
assert.strictEqual(ctx.Z,2.6,'有上限，不會無限放大');
for(let i=0;i<30;i++)ctx.zoom(-1);
assert.strictEqual(ctx.Z,1,'也有下限');
ctx.Z=2;ctx.applyZ();

// 字級都用 rem，沒有漏掉的 px 字級；縮放靠 html 的 font-size
const cssZ=src.split('<style>')[1].split('</style>')[0];
assert(/html\{font-size:calc\(16px \* var\(--z,2\)\)\}/.test(cssZ),'縮放的根');
const leftover=(cssZ.match(/font-size:[\d.]+px/g)||[]);
assert.deepStrictEqual(leftover,[],'還有寫死 px 的字級：'+leftover.join(' '));
assert((cssZ.match(/font-size:[\d.]+rem/g)||[]).length>60,'字級都轉成 rem 了');

// ---- CSS 類別撞名 ----
// 「今天到期」的卡片日期是 class="dd now"，日曆的現在時間線本來也叫 .now，
// 結果那條 position:absolute;left:0;right:0 的紅線套到卡片上，橫貫整個畫面。
// 這裡不只釘那一個，而是通則：會脫離文件流的裸類別，不能跟卡片用的修飾類別同名。
const css=src.split('<style>')[1].split('</style>')[0];
const emitted=new Set();
[ctx.taskCard({id:'a',title:'t',priority:'A',status:'待辦',due:T,project:'p',next:'n',waiting:''},'today'),
 ctx.taskCard({id:'b',title:'t',priority:'C',status:'進行中',due:'2020-01-01',project:'',next:'',waiting:'W'},'run'),
 ctx.logCard({title:'l',source:'Cowork',start:'2026-09-03 10:00',project:'p',summary:'s'}),
 ctx.outRow({title:'o',source:'Claude Code',start:'2026-09-03 10:00',end:'2026-09-03 11:00',
             status:'完成',project:'p',summary:'s',link:'https://x'})
].forEach(h=>{(h.match(/class="([^"]+)"/g)||[]).forEach(m=>
  m.slice(7,-1).split(/\s+/).forEach(c=>c&&emitted.add(c)))});

const floating=new Set();
css.replace(/(^|\})\s*\.([a-z][\w-]*)\s*(::[\w-]+)?\s*\{([^}]*)\}/gi,(m,_,cls,pseudo,body)=>{
  if(/position:\s*(absolute|fixed)/.test(body))floating.add(cls);return m});

const clash=[...emitted].filter(c=>floating.has(c));
assert.deepStrictEqual(clash,[],
  '卡片用的類別跟會脫離文件流的裸 CSS 規則撞名了：'+clash.join(', ')+
  '\n（卡片用到：'+[...emitted].join(' ')+'）');
assert(floating.has('nowline'),'現在時間線本身還是絕對定位');
assert(emitted.has('now'),'今天到期的卡片仍帶 now 修飾類別');
console.log('CSS 類別  卡片用 '+emitted.size+' 個，絕對定位的裸類別 '+floating.size+' 個，沒有撞名');

console.log('toasts   ',toasts.join(' / '));
console.log('DROP     ',JSON.stringify(ctx.DROP));
console.log('\nDRAG PASS');

// ---- 日曆的時間區塊點下去要能編輯那筆紀錄 ----
// 這些區塊是 hook 自動寫進來的，標題常常只是當下的 prompt，得能事後補。
const evHtml=ctx.lay([{id:'L1',start:'2026-09-03 15:00',end:'2026-09-03 16:00',
  title:'工作看板更新到第 5 版',source:'Claude Code',project:'個人'}],540,1200,40);
assert(evHtml.includes('data-log="L1"'),'時間區塊要帶紀錄 id 才點得動');

const clickH=src.split("$('view').addEventListener('click'")[1].split('});')[0];
assert(clickH.includes('edit(card.dataset.id)'),'點卡片就直接開編輯');
assert(!/toggle\('open'\)/.test(src),'不要再用展開動作列那套');
assert(clickH.includes('editLog(ev.dataset.log)'),'點時間區塊就開編輯紀錄');
assert(!/id="fL"/.test(src),'手動紀錄不要連結欄位');
assert(/id="fS"[^>]*class="big"|class="big"[^>]*id="fS"/.test(src),'摘要要用放大的那格');

ctx.paint=function(){};
ctx.RAW={logs:[{id:'L1',title:'工作看板更新到第 5 版',project:'個人',summary:''}]};
ctx.editLog('L1');
assert.strictEqual(ctx.$('fT').value,'工作看板更新到第 5 版','標題帶進表單');
assert.strictEqual(ctx.$('shTitle').textContent,'編輯紀錄');
// 這是使用者遇到的那個 bug：視窗寫「編輯任務」卻停在「手動紀錄」那張表單
assert.strictEqual(ctx.$('seg').style.display,'none','編輯時不給切換表單');

ctx.$('fS').value='補一句摘要';
sent=null;ctx.submit();
assert.strictEqual(sent.action,'log_update','改的是既有那筆，不是又新增一筆');
assert.strictEqual(sent.params.id,'L1');
assert.strictEqual(sent.params.summary,'補一句摘要');
assert.strictEqual(ctx.RAW.logs[0].summary,'補一句摘要','就地更新，日曆不用等重抓');

ctx.closeAdd();ctx.openAdd('task');
assert.strictEqual(ctx.$('seg').style.display,'flex','新增時切換鈕要回來');
assert.strictEqual(ctx.$('shTitle').textContent,'新增任務');
console.log('編輯      點卡片＝編輯任務，點時間區塊＝編輯紀錄');

// ---- 生意數字列 ----
// 看板連不到 Shopline / FB，數字是 Cowork 寫進「指標」表的，這裡只負責顯示。
ctx.mx({has:true,revenue:48200,orders:31,spend:12500,clicks:1840,carts:96,
  roas:3.86,cpc:6.79,cpaCart:130.21,updated:T+' 14:30'});
let mh=ctx.$('mx').innerHTML;
assert(mh.includes('$48,200'),'營業額要有千分位');
assert(mh.includes('31 筆訂單'));
assert(mh.includes('3.86x'),'ROAS');
assert(mh.includes('一次 $6.79'),'流量成本');
assert(mh.includes('一次 $130.21'),'加購成本');
assert(mh.includes('14:30 更新'),'看得出數字是什麼時候抓的');
assert.strictEqual(ctx.$('mx').style.display,'');

// 缺數字時顯示「—」，不能出現 NaN / Infinity
ctx.mx({has:true,revenue:1000,orders:null,spend:null,clicks:null,carts:null,
  roas:null,cpc:null,cpaCart:null,updated:''});
mh=ctx.$('mx').innerHTML;
assert(!/NaN|Infinity/.test(mh),'缺數字不要噴 NaN：'+mh);
assert(mh.includes('—'),'缺的欄位顯示破折號');

// 還沒抓過就講清楚怎麼抓
ctx.mx({has:false});
assert(ctx.$('mx').innerHTML.includes('更新今日數據'),'要告訴使用者怎麼補數字');
// 不是每日看板就整條收掉
ctx.mx(null);
assert.strictEqual(ctx.$('mx').style.display,'none');

// ---- 早晨簡報可以收起來 ----
ctx.header=function(){};
ctx.RAW={note:'昨天：做了事。\n今天必做：那件。'};
ctx.BOPEN=true;ctx.brief(ctx.RAW.note);
assert.strictEqual(ctx.$('brief').style.display,'');
assert(ctx.$('brief').innerHTML.includes('toggleBrief'),'要有收起來的鈕');
ctx.toggleBrief();
assert.strictEqual(ctx.BOPEN,false);
assert.strictEqual(ctx.$('brief').style.display,'none','收起來就不佔位子');
ctx.toggleBrief();
assert.strictEqual(ctx.$('brief').style.display,'','再按一次叫回來');
// 收起來之後要有路徑叫回來，不然就永遠不見了
assert(/onclick="toggleBrief\(\)">早晨簡報/.test(src),'標題列那顆鈕要能把簡報叫回來');
console.log('數字列    營業額 / 廣告花費 / ROAS / 流量 / 加購，簡報可收合');

// ---- 昨天執行的內容：預設只留標題 ----
// 一天十幾筆紀錄全攤開要捲很久，改成點標題才展開。
const LG={id:'L9',title:'工作看板更新到第 9 版',source:'Cowork',project:'個人',
  start:T+' 17:53',end:T+' 17:53',status:'完成',
  summary:'Code.gs 31611→31723。setup 執行完畢，六張工作表核對齊全。',
  link:'https://drive.google.com/file/d/x/view'};

ctx.LOPEN={};
let row=ctx.logRow(LG);
assert(row.includes('工作看板更新到第 9 版'),'標題一定看得到');
assert(row.includes('17:53–17:53'),'時間跟標題同一行');
assert(/<div class="lgb" hidden>/.test(row),'內容預設收起來');
assert(row.includes('Code.gs 31611'),'內容有畫出來，只是藏著——展開才不用重抓');
assert(row.includes('data-lg="L9"'));
assert(!/class="lg open"/.test(row));

ctx.LOPEN={L9:1};
row=ctx.logRow(LG);
assert(/class="lg open"/.test(row),'展開過的重畫之後還是展開的');
assert(!/<div class="lgb" hidden>/.test(row));

// 點下去直接動 DOM，不重畫整頁
let repaints=0;const oldPaint=ctx.paint;ctx.paint=function(){repaints++};
const fakeRow={_cls:{},classList:{toggle(c,on){this._on=on}},_hidden:null,_aria:null,
  querySelector(sel){const r=this;return sel==='.lgb'?{set hidden(v){r._hidden=v}}
    :{setAttribute(k,v){r._aria=v}}}};
ctx.document.querySelector=function(){return fakeRow};
ctx.LOPEN={};
ctx.toggleLog('L9');
assert.strictEqual(ctx.LOPEN.L9,true,'記住展開了');
assert.strictEqual(fakeRow._hidden,false,'內容顯示出來');
assert.strictEqual(fakeRow._aria,true);
ctx.toggleLog('L9');
assert.strictEqual(ctx.LOPEN.L9,false,'再點一次收起來');
assert.strictEqual(fakeRow._hidden,true);
assert.strictEqual(repaints,0,'展開不該重畫整頁');
ctx.paint=oldPaint;
console.log('昨天紀錄  只留標題，點了才展開');

// ---- 同名函式守門員 ----
// daysBetween 本來叫 days，跟日曆的 days(from,to) 撞名被默默蓋掉，taskCard 就拿到日期陣列。
// JS 不會報錯，所以這裡自己檢查一遍。
{
  const names={},dup=[];
  (js.match(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)||[]).forEach(m=>{
    const n=m.replace(/^function /,'').replace(/\s*\($/,'');
    if(names[n])dup.push(n);names[n]=1});
  assert.strictEqual(dup.length,0,'有同名函式，後面那個會默默蓋掉前面那個：'+dup.join('、'));
  console.log('函式名稱  '+Object.keys(names).length+' 個，沒有撞名');
}

// ---- 昨天沒做完的，今天照樣出現，但看得出本來哪天要交 ----
// 到期日刻意不改寫：改掉就再也看不出這件原本什麼時候該完成。
const yday=(()=>{const d=new Date();d.setDate(d.getDate()-1);return ctx.ymd(d)})();
const d3=(()=>{const d=new Date();d.setDate(d.getDate()-3);return ctx.ymd(d)})();
assert.strictEqual(ctx.daysBetween(yday,T),1);
assert.strictEqual(ctx.daysBetween(d3,T),3);
const late=ctx.taskCard({id:'T9',title:'合約等 PN 回覆',project:'行銷構圖',
  due:d3,priority:'A',status:'待辦',next:'',waiting:''},'today');
assert(late.includes('順延 3 天'),'看得出拖了幾天：'+late);
assert(late.includes('需完成 '+ctx.md(d3)),'看得出原訂哪天要交');
assert(!late.includes('逾期 '),'不再只寫「逾期」');
// 今天到期的還是寫「今天」，不要被順延那條吃掉
assert(ctx.taskCard({id:'TA',title:'今天的',due:T,priority:'B',status:'待辦'},'today').includes('今天'));

// ---- 看板總覽 ----
// 跟時間表共用同一個 action，畫法不同：這裡只管任務排在哪天、做完沒。
const OV={range:'week',from:'2026-08-31',to:'2026-09-06',
  tasks:[{id:'T1',title:'週一的事',due:'2026-08-31',priority:'A',status:'待辦'},
         {id:'T2',title:'週四的事',due:'2026-09-03',priority:'B',status:'完成',done_at:'2026-09-03 11:00'},
         {id:'T3',title:'沒排日期但做完了',due:'',priority:'C',status:'完成',done_at:'2026-09-02 09:00'}],
  logs:[],unscheduled:[{id:'T4',title:'還沒排',due:'',priority:'B',status:'待辦'}]};
const ov=ctx.overview(OV,'');
assert.strictEqual((ov.match(/class="mc/g)||[]).length,7,'一週剛好七格');
assert(ov.includes('mgrid wk'),'週用週格');
assert(ov.includes('週一的事')&&ov.includes('週四的事'));
assert(ov.includes('沒排日期但做完了'),'沒到期日就照完成日放格子');
assert(/chip2 B dn2/.test(ov),'做完的畫成刪除線');
assert(ov.includes('2 / 3 完成'),'三件裡兩件完成');
assert(ov.includes('還沒排'),'未排日期的列在下面');
// 搜尋要吃得到
assert(!ctx.overview(OV,'週一').includes('週四的事'));
// 月改用月曆格
const ovm=ctx.overview(Object.assign({},OV,{range:'month',from:'2026-09-01',to:'2026-09-30'}),'');
assert(ovm.includes('<div class="mgrid">')&&!ovm.includes('mgrid wk'),'月用月曆格');

// 上下一段：週跳七天、月跳一個月
ctx.VIEW='overview';ctx.OVRANGE='week';ctx.OVDATE='2026-09-03';
ctx.shift(1);assert.strictEqual(ctx.OVDATE,'2026-09-10','下一週');
ctx.shift(-1);assert.strictEqual(ctx.OVDATE,'2026-09-03','上一週');
ctx.OVRANGE='month';ctx.OVDATE='2026-09-15';
ctx.shift(1);assert.strictEqual(ctx.OVDATE,'2026-10-15','下個月');
ctx.shift(-1);assert.strictEqual(ctx.OVDATE,'2026-09-15','上個月');
// 每個區間各自快取，切週切月不會拿到上一段的資料
ctx.OVRANGE='week';assert.strictEqual(ctx.vkey(),'overview:week:2026-09-15');
ctx.OVRANGE='month';assert.strictEqual(ctx.vkey(),'overview:month:2026-09-15');
ctx.goToday();assert.strictEqual(ctx.OVDATE,null,'回到本期');
ctx.VIEW='board';
console.log('看板總覽  週七格 / 月曆格，‹ › 切上下一段');
