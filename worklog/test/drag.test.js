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

function mkStub(){return{className:'',dataset:{},style:{},classList:{
  _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
  toggle(c,on){on===undefined?(this._s.has(c)?this._s.delete(c):this._s.add(c)):(on?this._s.add(c):this._s.delete(c))},
  contains(c){return this._s.has(c)}},
  addEventListener(){},appendChild(){},remove(){},cloneNode(){return this},
  getBoundingClientRect(){return{left:0,top:0,width:100}},focus(){},querySelectorAll(){return[]},
  closest(){return null},value:'',innerHTML:'',textContent:'',disabled:false,
  _kids:{},querySelector(sel){return this._kids[sel]||(this._kids[sel]=mkStub())}}}
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
    withFailureHandler(f){this._f=f;return this},
    uiCall(tok,action,params){sent={action,params};
      FAIL?this._f(new Error('伺服器掛了')):this._s({ok:true})}}}}};
let FAIL=0;
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

// ---- 側欄圖示與分組 ----
// 原本七個項目裡有四個都是 ▦▥▤▤ 這種方塊，掃過去分不出誰是誰，等於沒有圖示。
{
  const shown=ctx.VIEWS.filter(v=>!v.hide);
  ctx.VIEWS.forEach(v=>assert(ctx.ICON[v.i],'側欄「'+v.n+'」沒有圖示，會畫出一個空框'));
  const seen={};
  ctx.VIEWS.forEach(v=>{
    const d=ctx.ICON[v.i];
    assert(!seen[d],'「'+v.n+'」跟「'+seen[d]+'」用同一個圖示，掃過去分不出來');
    seen[d]=v.n});
  assert(/^<svg class="ic" viewBox="0 0 24 24"/.test(ctx.icon('board')),'圖示是線稿 svg');
  assert(/stroke="currentColor"/.test(ctx.icon('board')),'描邊跟著文字顏色，選到才會一起變藍');
  assert(ctx.icon('沒這個 key').includes('<svg'),'沒有的 key 回一個空 svg 就好，不要噴錯');
  // 每個看得到的項目都要屬於某一組，不然它會落在標題外面變孤兒
  shown.forEach(v=>assert(v.g,'側欄「'+v.n+'」沒有分組'));
  const boot=src.split('function boot()')[1].split('function ')[0];
  assert(boot.includes('class="ngrp"'),'側欄要有分組標題');
  assert(boot.includes('icon(x.i)'),'側欄項目要畫圖示');
  assert(boot.includes('data-v="'),'項目要留 data-v，go() 靠它標目前這頁');
  console.log('側欄圖示  '+shown.map(v=>v.g+'/'+v.n).join(' ')+'，七個圖示都不一樣');
}

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
// 跟著字一起變大的尺寸也不能寫死 px。營運數字那五格的 flex 基準寬度就踩過：
// 寫 150px 的話字級 200% 時五格還是硬擠一排，$71,325 被切掉一半。
{
  const px=(cssZ.match(/flex:[^;}]*?\b\d[\d.]*px/g)||[]);
  assert.deepStrictEqual(px,[],'flex 基準寬度寫死 px，放大字級會擠爆：'+px.join(' '));
}

// ---- 立體感 ----
// 深色介面靠三件事看出厚度：上緣亮邊、往下落的影子、由上而下略暗的表面。
// 只要有人把其中一層拔掉，卡片就會塌回貼紙，所以這裡釘住。
{
  ['--face','--face2','--rim','--sh1','--sh2','--sh3'].forEach(function(v){
    assert(cssZ.includes(v+':'),'少了 '+v+' 這個立體感的 token')});
  [['.col{','--sh2'],['.t{','--sh1'],['.mx .m{','--sh1'],['.panelbox{','--sh2'],['.sheet{','--sh3']]
    .forEach(function(pair){
      const i=cssZ.indexOf(pair[0]);
      assert(i>=0,'找不到規則 '+pair[0]);
      const rule=cssZ.slice(i,cssZ.indexOf('}',i));
      assert(rule.includes('box-shadow')&&rule.includes(pair[1]),
        pair[0]+' 要有影子（'+pair[1]+'）：'+rule.replace(/\s+/g,' ').slice(0,90))});
  // 滑過去要浮起來，按下去要壓回原位——沒有這一下，立體感只是靜態的圖
  assert(/\.t:hover\{[^}]*translateY\(-/.test(cssZ),'卡片滑過去要浮起來');
  assert(/\.t:active\{[^}]*translateY\(0\)/.test(cssZ),'按下去要壓回去');
  // 拖曳中底下的卡片不能跟著跳，不然瞄不準要放哪
  assert(/body\.dragging \.t:hover[^{]*\{[^}]*transform:none/.test(cssZ),'拖曳中要關掉浮起');
}

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
  roas:3.86,adPct:25.9,cpc:6.79,cpaCart:130.21,updated:T+' 14:30'});
let mh=ctx.$('mx').innerHTML;
assert(mh.includes('$48,200'),'營業額要有千分位');
assert(mh.includes('31 筆訂單'));
// 那一格從「總 ROAS」改成「廣告佔比」：營業額裡有幾成付給廣告
assert(mh.includes('廣告佔比')&&mh.includes('25.9%'),'廣告佔比');
assert(!/ROAS/.test(mh),'不要再出現 ROAS，兩種講法並存只會搞混：'+mh.slice(0,120));
assert(mh.includes('廣告費 ÷ 營業額'),'算式寫在格子裡');
assert(mh.includes('愈低愈好'),'成本型指標要講方向，不然會看成愈高愈好');
assert(mh.includes('別跟 FB 後台的數字對'),'把口徑寫在提示裡');
assert(mh.includes('連結點擊，不是全站流量'));
assert(mh.includes('不要拿來算轉換率'),'加購與點擊的歸因基準不同');
assert(mh.includes('一次 $6.79'),'流量成本');
assert(mh.includes('一次 $130.21'),'加購成本');
assert.strictEqual(ctx.$('mxWhen').textContent,'14:30 更新','更新時間搬到分段標題右邊');
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

// 成本型指標，好壞顏色跟其他格子相反：低＝good、高＝bad
{
  const base={has:true,revenue:1000,orders:1,spend:100,clicks:10,carts:1,
    roas:null,cpc:null,cpaCart:null,updated:''};
  const paint=p=>{ctx.mx(Object.assign({},base,p));
    return ctx.$('mx').innerHTML.match(/<div class="m([^"]*)"[^>]*>\s*<u>廣告佔比/)[1]};
  assert(/good/.test(paint({adPct:20})),'20% 是好的');
  assert(/good/.test(paint({adPct:33.3})),'33.3%（＝ROAS 3）還算好');
  assert(!/good|bad/.test(paint({adPct:50})),'中間就不上色');
  assert(/bad/.test(paint({adPct:70})),'70%（＞ROAS 1.5）要示警');
  assert(/na/.test(paint({adPct:null})),'算不出來就是灰的');
}

// ---- 早晨簡報可以收起來 ----
ctx.header=function(){};
ctx.RAW={note:'昨天：做了事。\n今天必做：那件。'};
ctx.BOPEN=true;ctx.brief(ctx.RAW.note);
assert.strictEqual(ctx.$('brief').style.display,'');
assert(!ctx.$('brief').innerHTML.includes('早晨簡報'),'標題交給分段標題，不要重複寫一次');
assert.strictEqual(ctx.$('briefHead').style.display,'flex','分段標題跟著顯示');
ctx.toggleBrief();
assert.strictEqual(ctx.BOPEN,false);
assert.strictEqual(ctx.$('brief').style.display,'none','收起來就不佔位子');
ctx.toggleBrief();
assert.strictEqual(ctx.$('brief').style.display,'','再按一次叫回來');
// 收起來之後要有路徑叫回來，不然就永遠不見了
assert(src.includes("sw('早晨簡報',BOPEN,'toggleBrief()')"),'標題列那顆鈕要能把簡報叫回來');
// 三條橫幅的開關要並排在同一處，不要有的在日期列、有的藏在 ▾ 選單
assert(src.includes("sw('營運數字',MXOPEN,'toggleMx()')"));
assert(src.includes("sw('統計列',!!STATS,'toggleStats()')"));
assert(!/id="mStats"/.test(src),'統計列開關從 ▾ 選單搬走了');
assert(ctx.sw('早晨簡報',true,'x()').includes('chip on')&&ctx.sw('早晨簡報',true,'x()').includes('▴'));
assert(!ctx.sw('早晨簡報',false,'x()').includes('chip on')&&ctx.sw('早晨簡報',false,'x()').includes('▾'));
console.log('數字列    營業額 / 廣告花費 / 廣告佔比 / 流量 / 加購，簡報可收合');

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
assert(ov.includes('mgrid mweek'),'週用週格');
assert(ov.includes('週一的事')&&ov.includes('週四的事'));
assert(ov.includes('沒排日期但做完了'),'沒到期日就照完成日放格子');
assert(/chip2 B dn2/.test(ov),'做完的畫成刪除線');
assert(ov.includes('2 / 3 完成'),'三件裡兩件完成');
assert(ov.includes('還沒排'),'未排日期的列在下面');
// 週格改成七張卡：每天有自己的抬頭、件數、內容區，不再是表格的儲存格
assert.strictEqual((ov.match(/class="dh"/g)||[]).length,7,'每天一個抬頭');
assert.strictEqual((ov.match(/class="lst"/g)||[]).length,7,'每天一個內容區');
assert.strictEqual((ov.match(/class="cnt2"/g)||[]).length,3,'只有真的有事的那三天標件數');
assert(/class="cnt2">1</.test(ov),'件數是那天的任務數');
assert((ov.match(/class="mc pst"/g)||[]).length>=1,'過去的日子標 pst，會壓暗');
assert.strictEqual((ov.match(/class="non"/g)||[]).length,4,'剩下四天放一個淡淡的破折號');
// 搜尋要吃得到
assert(!ctx.overview(OV,'週一').includes('週四的事'));
// 月改用月曆格
const ovm=ctx.overview(Object.assign({},OV,{range:'month',from:'2026-09-01',to:'2026-09-30'}),'');
assert(ovm.includes('<div class="mgrid">')&&!ovm.includes('mgrid mweek'),'月用月曆格');

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

// ---- 早晨簡報改成分段條列 ----
// 以前四段串成一行，逾期哪幾件、進行中哪幾件全糊在一起。
const NOTE=['昨天：工作看板系統從安裝一路迭代到第 9 版，Code.gs 與 index.html 反覆更新。',
  '今天必做：1.中秋禮盒控單程式確認（中秋禮盒，昨天到期） 2. Shopline 每週任務檢查（Shopline，昨天到期） 3. 合約等 PN 回覆（行銷構圖，今天到期）',
  '進行中：1. Claude SEO 優化（Claude SEO，9/10 到期）',
  '建議：今天只有三件，先把昨天逾期的中秋禮盒做掉。'].join('\n');

ctx.BOPEN=true;ctx.brief(NOTE);
const bh=ctx.$('brief').innerHTML;
assert.strictEqual((bh.match(/class="bs"/g)||[]).length,4,'四段各自一列');
assert(bh.includes('<u>昨天</u>')&&bh.includes('<u>今天必做</u>')&&
  bh.includes('<u>進行中</u>')&&bh.includes('<u>建議</u>'),'標籤獨立出來');
assert.strictEqual((bh.match(/<li>/g)||[]).length,4,'今天必做三件＋進行中一件');
assert(bh.includes('<li>中秋禮盒控單程式確認（中秋禮盒，昨天到期）</li>'),'編號拆乾淨');
assert(!/<li>1\./.test(bh),'數字編號交給 <ol> 畫，不要重複');
assert(bh.includes('class="todo"'),'今天必做那段標起來');
assert(/<u>昨天<\/u><div><p>/.test(bh),'沒編號的段落不要硬做成條列');
assert(!bh.includes('早晨簡報'),'標題不重複——分段標題已經寫了，收合走日期列那顆鈕');

// 不照格式寫也不能掉字
const messy=ctx.$('brief');
ctx.brief('隨手寫的一句話，沒有冒號');
assert(messy.innerHTML.includes('隨手寫的一句話'),'認不出標籤就原樣顯示');
ctx.brief('昨天：第一行\n接續的第二行沒有標籤');
assert(messy.innerHTML.includes('第一行 接續的第二行沒有標籤'),'續行接在上一段後面，不會被吃掉');

// 版本號、日期、小數不能被當成編號拆開
assert.strictEqual(ctx.briefItems('迭代到第 9 版，Code.gs 更新於 2026.09.04，轉換率 3.5%'),null);
assert.strictEqual(ctx.briefItems('1. 甲 2. 乙').length,2);
// 只有一件事的那幾天也要當條列，編號不能留在文字裡
assert.strictEqual(ctx.briefItems('1. Claude SEO 優化')[0],'Claude SEO 優化');
assert(/<u>進行中<\/u><div><ol>/.test(bh),'只有一件也畫成條列');
assert(!/<p>1\. /.test(bh),'編號不該留在段落文字裡');
console.log('早晨簡報  四段分列，必做的拆成條列');

// ---- 側邊欄 ----
// 資料庫平常不常翻，從設定進去就好；側邊欄的專案池整塊拿掉。
assert(!ctx.VIEWS.some(v=>v.v==='outputs'&&!v.hide),'資料庫不該再出現在側邊欄');
assert(ctx.VIEWS.some(v=>v.v==='outputs'),'但頁面本身還在');
assert(ctx.settings().includes("go('outputs')"),'設定頁要有進資料庫的入口');
assert(!/id="pool"/.test(src),'側邊欄的專案池已移除');
assert(!src.includes('.pj.pA'),'連帶的樣式也清掉（.tag.pj 是別的東西，留著）');
ctx.renderPjs([{name:'起士公爵'},{name:'電腦舖'}]);
assert(ctx.$('pjs').innerHTML.includes('起士公爵'),'「專案」欄位的自動完成還要留著');

// 上一版的漏網之魚：看板總覽的日期列被藏起來，‹ › 和週/月切換全都點不到
ctx.go('overview');
assert.strictEqual(ctx.$('dates').style.display,'','看板總覽要看得到日期列');
ctx.go('board');assert.strictEqual(ctx.$('dates').style.display,'');
ctx.go('pool');assert.strictEqual(ctx.$('dates').style.display,'none','專案池沒有區間可切');
ctx.VIEW='pool';

// ---- AI 專案池 ----
const POOL={backlog:4,overdue:2,yesterdayHours:3.5,
  order:[{task:{id:'T1',title:'中秋禮盒控單程式確認',project:'中秋禮盒',priority:'A',status:'待辦',due:'2026-09-03'},reason:'逾期 1 天'}],
  yesterday:[
    {id:'L1',title:'工作看板更新到第 9 版',source:'Cowork',start:'2026-09-03 17:53',end:'2026-09-03 18:00',status:'完成'},
    {id:'L2',title:'建立 update-worklog skill',source:'Cowork',start:'2026-09-03 16:10',end:'2026-09-03 16:40',status:'完成'},
    {id:'L3',title:'修好拖曳的 bug',source:'Claude Code',start:'2026-09-03 10:00',end:'2026-09-03 11:00',status:'完成'},
    {id:'L4',title:'手動補的一筆',source:'手動',start:'2026-09-03 09:00',end:'2026-09-03 09:10',status:'完成'}],
  projects:[
    {name:'中秋禮盒',priority:'A',overdue:1,tasks:[
      {id:'T1',title:'中秋禮盒控單程式確認',project:'中秋禮盒',priority:'A',status:'待辦',due:'2026-09-03'}]},
    {name:'Shopline',priority:'B',overdue:1,tasks:[
      {id:'T2',title:'Shopline 每週任務檢查',project:'Shopline',priority:'B',status:'待辦',due:'2026-09-03'}]},
    {name:'行銷構圖',priority:'C',overdue:0,tasks:[
      {id:'T3',title:'合約等 PN 回覆',project:'行銷構圖',priority:'C',status:'待辦',due:T}]}]};
const pv=ctx.pool(POOL,'');

// 昨天：兩個 AI 各自一欄，看得出誰在做事、誰整天沒動靜
assert(pv.includes('class="srcs"'),'昨天的紀錄分欄');
assert.strictEqual((pv.match(/class="srcc"/g)||[]).length,3,'Cowork、Claude Code，加上手動那欄');
// 用 section 切，不要用「Cowork」切——那個字在欄位裡出現不只一次
const srcCols=pv.match(/<section class="srcc">[\s\S]*?<\/section>/g);
const cw=srcCols[0];
assert(cw.includes('工作看板更新到第 9 版')&&cw.includes('建立 update-worklog skill'),'Cowork 那欄放 Cowork 的');
assert(!cw.includes('修好拖曳的 bug'),'Claude Code 的不要混進來');
assert(pv.includes('修好拖曳的 bug'),'Claude Code 那欄有東西');
assert(pv.includes('手動補的一筆'),'其他來源不能整個消失');
// 一邊掛零時要說清楚為什麼，不然看起來像壞掉
const none=ctx.pool(Object.assign({},POOL,{yesterday:[POOL.yesterday[0]]}),'');
assert(none.includes('得在自己的電腦裝好 hook'),'Claude Code 沒紀錄要講原因');

// 還剩什麼：依 A/B/C 分三塊，不再依專案
assert(pv.includes('還剩什麼'));
assert(!pv.includes('各專案還剩什麼'));
assert(pv.includes('優先處理')&&pv.includes('推進型')&&pv.includes('維護型'),'三塊都在');
assert(pv.indexOf('優先處理')<pv.indexOf('推進型'),'A 排在 B 前面');
assert(pv.indexOf('推進型')<pv.indexOf('維護型'),'B 排在 C 前面');
assert(pv.includes('中秋禮盒控單程式確認')&&pv.includes('Shopline 每週任務檢查')&&pv.includes('合約等 PN 回覆'));
// A 級掛零要直說，那通常代表今天沒有真正推進結果的工作
const noA=ctx.pool(Object.assign({},POOL,{projects:POOL.projects.slice(1)}),'');
assert(noA.includes('沒有交給 AI 的 A 級工作'),'A 掛零要點出來');
// A/B/C 要並排成三欄。上下堆疊的話一次只看得到一級，A 以外的要捲很久才看到
{
  const tail=pv.slice(pv.indexOf('還剩什麼'));
  const grid=tail.match(/<div class="cols">[\s\S]*$/);
  assert(grid,'還剩什麼要放進 .cols（跟每日看板同一種三欄網格）');
  assert.strictEqual((grid[0].match(/class="col c-p[ABC]"/g)||[]).length,3,'A/B/C 各一欄');
  assert(!tail.includes('panelbox'),'不要再用上下堆疊的區塊');
}
console.log('專案池    昨天分 Cowork / Claude Code 兩欄，還剩什麼並排成 A/B/C 三欄');

// ---- 國定假日 ----
{
  const HOL={holidays:[{date:'2026-09-25',name:'中秋節'}],
             nextHolidays:[{date:'2026-09-28',name:'教師節'}],holidayGap:[]};
  const W=Object.assign({},OV,{range:'week',from:'2026-09-21',to:'2026-09-27',
    tasks:[{id:'H1',title:'節前盤點',due:'2026-09-24',priority:'A',status:'待辦'}]},HOL);
  const wv=ctx.overview(W,'');
  // 那一格要標成假日，而且寫出名字——只有變色的話看不出是什麼節
  assert(/class="mc[^"]*hol"/.test(wv),'假日那格要有 hol');
  assert(wv.includes('<span class="hn">中秋節</span>'),'格子上要寫出節日名稱');
  assert.strictEqual((wv.match(/class="hn"/g)||[]).length,1,'只有那一天是假日');
  // 前一週就要看得到下一週的假，還要看得出是星期幾——不然排不了事
  assert(wv.includes('下週有假'),'週檢視提醒下一週');
  assert(wv.includes('9/28（一）教師節'),'日期、星期、名稱三個都要有：'+wv.slice(wv.indexOf('hnote'),wv.indexOf('hnote')+160));
  // 月檢視提醒的是下個月
  const mv=ctx.overview(Object.assign({},W,{range:'month',from:'2026-09-01',to:'2026-09-30'}),'');
  assert(mv.includes('下個月有假')&&!mv.includes('下週有假'),'月檢視講下個月');
  // 沒建資料的年份要講出來，不然「沒標假日」跟「沒建資料」長得一模一樣
  const gap=ctx.overview(Object.assign({},W,{nextHolidays:[],holidayGap:['2029']}),'');
  assert(gap.includes('2029 年的假日還沒更新'),'缺資料要直說');
  assert(!gap.includes('下週有假'),'沒有假就不要硬擠一條提醒');
  // 舊版後端沒有這些欄位，不能整頁掛掉
  const old=ctx.overview(OV,'');
  assert(old.indexOf('mgrid mweek')>=0&&!/hnote/.test(old),'沒有假日資料就當作沒有');
  console.log('假日      格子標紅寫名字，前一週提醒下一週，缺資料會直說');
}

// ---- CSS 撞名守門員（第二版）----
// 第一版只比對「絕對定位」的裸類別，抓不到這次的 bug：
// weekGrid 用 class="mgrid wk"，但 .wk 早就是統計列的週長條圖（display:flex），
// 同權重又寫在後面，直接把 .mgrid 的 display:grid 蓋掉，七格擠成一排。
// 這裡改成通用檢查：同一個元素上的兩個類別，如果各自都有「單一類別」的規則
// 且宣告了同一個排版屬性，就是撞名。只看會把版面弄壞的那幾個屬性。
{
  const BREAKS=['display','position','grid-template-columns','flex-direction'];
  const css=src.split('<style>')[1].split('</style>')[0];
  const bare={};                       // .foo -> Set(屬性)
  let m,re=/([^{}]+)\{([^{}]*)\}/g;
  while((m=re.exec(css))){
    const sel=m[1].trim(), decls=m[2];
    sel.split(',').map(x=>x.trim()).forEach(one=>{
      if(!/^\.[A-Za-z][\w-]*$/.test(one))return;    // 只看「單一裸類別」
      const set=bare[one]||(bare[one]=new Set());
      BREAKS.forEach(p=>{
        if(new RegExp('(^|;)\\s*'+p+'\\s*:','i').test(decls))set.add(p)});
    });
  }

  // 用真的畫出來的 HTML 收集類別組合，不要用猜的
  const html=[
    ctx.overview(OV,''), ctx.pool(POOL,''), ctx.logRow(LG),
    ctx.taskCard({id:'X',title:'t',project:'p',due:T,priority:'A',status:'待辦'},'today'),
    ctx.noteCard({id:'D1',title:'n',body:'n'}), ctx.settings(),
  ].join(' ');

  const clashes=[];
  (html.match(/class="[^"]+"/g)||[]).forEach(a=>{
    const cls=a.slice(7,-1).trim().split(/\s+/).filter(Boolean);
    for(let i=0;i<cls.length;i++)for(let j=i+1;j<cls.length;j++){
      const A=bare['.'+cls[i]],B=bare['.'+cls[j]];
      if(!A||!B)continue;
      BREAKS.forEach(p=>{if(A.has(p)&&B.has(p))
        clashes.push('.'+cls[i]+' 和 .'+cls[j]+' 都宣告了 '+p+'（同時掛在一個元素上）')});
    }
  });
  assert.strictEqual([...new Set(clashes)].join('；'),'','類別撞名：後面那條會蓋掉前面那條');
  console.log('CSS 撞名  檢查 '+Object.keys(bare).length+' 個裸類別，元素上沒有互相蓋掉的排版屬性');
}

// weekGrid 的修飾詞不能再叫 wk
assert(ctx.overview(OV,'').includes('mgrid mweek'),'週格用 mweek，不要用被佔走的 wk');
// 欄寬下限要用 rem。放大的是字不是視窗，media query 管不到——
// 寫死七欄的話字級 200% 時七欄各剩 65px，一行只放得下一個字。
{
  const i=cssZ.indexOf('.mgrid.mweek{');
  assert(i>=0,'找不到 .mgrid.mweek 的規則');
  const rule=cssZ.slice(i,cssZ.indexOf('}',i));
  assert(/grid-template-columns:repeat\(auto-fit,minmax\([\d.]+rem/.test(rule),
    '週格欄寬要 auto-fit + rem 下限：'+rule.replace(/\s+/g,' '));
}
assert(!/class="mgrid wk"/.test(src),'wk 是統計列長條圖的類別');

// ---- AI 工作時間表只畫紀錄，不畫任務 ----
// 任務排在哪一天是「看板總覽」的事；13 筆行政任務匯進來之後，
// 全天那列被塞爆，兩頁又互相重複。
const PJ={range:'week',from:'2026-08-31',to:'2026-09-06',done:1,total:7,
  tasks:[{id:'T1',title:'中秋禮盒控單程式確認',project:'中秋禮盒',due:'2026-09-03',priority:'A',status:'待辦'},
         {id:'T2',title:'6布(愛心款) 10',project:'行政',due:'2026-09-04',priority:'B',status:'待辦'}],
  logs:[{id:'L1',title:'工作看板更新到第 9 版',source:'Cowork',project:'個人',
         start:'2026-09-03 15:00',end:'2026-09-03 16:20',status:'完成'},
        {id:'L2',title:'修好週檢視的 CSS 撞名',source:'Claude Code',project:'工作看板',
         start:'2026-09-04 10:00',end:'2026-09-04 11:30',status:'完成'}],
  unscheduled:[{id:'T9',title:'沒排日期',project:'行政',due:'',priority:'B',status:'待辦'}],
  projects:[]};

const pj=ctx.projects(PJ,'');
assert(!pj.includes('allday'),'全天那列整個拿掉');
assert(!pj.includes('chip2'),'任務不該再出現在時間表上');
assert(!pj.includes('中秋禮盒控單程式確認')&&!pj.includes('6布'),'任務標題也不該出現');
assert(!pj.includes('沒排日期'),'未排日期的任務清單也移走');
assert(pj.includes('工作看板更新到第 9 版')&&pj.includes('修好週檢視的 CSS 撞名'),'紀錄還是要畫');
assert.strictEqual((pj.match(/class="ev /g)||[]).length,2,'兩筆紀錄都在時間軸上');
// 頂端數字也跟著換成紀錄導向
assert(!pj.includes('完成</div>')||!/任務<\/div>/.test(pj),'不要再談任務完成數');
assert(pj.includes('Claude Code')&&pj.includes('Cowork'),'改成兩個 AI 各跑幾筆');
assert.strictEqual(ctx.cntSrc(PJ.logs,'Cowork'),1);
assert.strictEqual(ctx.cntSrc(PJ.logs,'Claude Code'),1);
assert.strictEqual(ctx.cntSrc(PJ.logs,'手動'),0);
// 月也一樣不畫任務
const pjm=ctx.projects(Object.assign({},PJ,{range:'month',from:'2026-09-01',to:'2026-09-30'}),'');
assert(!pjm.includes('chip2'),'月檢視也不畫任務');

// 但「看板總覽」的月檢視要照常畫任務——別把它一起改壞了
const ovm2=ctx.overview(Object.assign({},OV,{range:'month',from:'2026-09-01',to:'2026-09-30'}),'');
assert(ovm2.includes('chip2'),'看板總覽的月還是要看得到任務');
console.log('時間表    只畫紀錄，任務留給看板總覽');

// ---- 誰做：我 / AI / 一起 ----
// 系統猜不出來，所以是欄位不是推論；空白一律當「我」，
// 免得沒標記過的事被誤放進 AI 區。
assert.strictEqual(ctx.ownerMark(''),'','自己做的不加記號，不然滿版都是圖示');
assert.strictEqual(ctx.ownerMark('我'),'');
assert(ctx.ownerMark('AI').includes('🤖'));
assert(ctx.ownerMark('一起').includes('🤝'));
assert(ctx.taskCard({id:'X',title:'交給 AI 的事',project:'p',due:T,priority:'B',status:'待辦',owner:'AI'},'today')
  .includes('🤖'),'卡片上看得出這件不用自己動手');
assert(!ctx.taskCard({id:'Y',title:'自己做的事',project:'p',due:T,priority:'B',status:'待辦'},'today')
  .includes('🤖'));

// 表單：預設「我」，編輯時帶出既有值，送出時一起送
ctx.paint=function(){};
ctx.RAW={running:[{id:'Z1',title:'交給 AI 的',project:'p',due:T,priority:'B',status:'進行中',
  next:'',waiting:'',owner:'AI'}],today:[],tomorrow:[],unscheduled:[],date:T};
ctx.closeAdd();
assert.strictEqual(ctx.OWNER,'我','關掉之後回到預設');
assert.strictEqual(ctx.$('ow1').classList._s?undefined:undefined,undefined);
ctx.edit('Z1');
assert.strictEqual(ctx.OWNER,'AI','編輯既有任務要帶出它的執行者');
ctx.$('fT').value='交給 AI 的';
sent=null;ctx.submit();
assert.strictEqual(sent.params.owner,'AI','送出時帶上執行者');
ctx.closeAdd();ctx.openAdd('task');
assert.strictEqual(ctx.OWNER,'我','新增預設是自己做');
ctx.owner('一起');
ctx.$('fT').value='AI 產初稿我潤稿';
sent=null;ctx.submit();
assert.strictEqual(sent.params.owner,'一起');
ctx.closeAdd();

// 專案池空的時候要說得出話，而不是只寫「沒有待辦」
const empty=ctx.pool(Object.assign({},POOL,{order:[],projects:[],mine:5}),'');
assert(empty.includes('自己手上還有 5 件'),'空畫面要指路');
assert(empty.includes('把「誰做」改成 AI'));
assert(ctx.pool(Object.assign({},POOL,{mine:5}),'').includes('自己要做'),'頂端也看得到自己還有幾件');
console.log('誰做      我／AI／一起，預設我，只有 AI 那兩種進專案池');

// ---- 週格子裡的任務可以拖到別天 ----
// 拖曳原本只認兩種東西（看板卡片換欄、資料區卡片換分區），現在多一種：
// 看板總覽週格子裡的任務換日期。三種共用同一套流程，用 DKIND 描述差別。
assert.deepStrictEqual(Object.keys(ctx.DKIND).sort(),['chip','nc','t']);
assert.strictEqual(ctx.DKIND.chip.key,'date','放到哪一格＝哪一天');
assert.strictEqual(ctx.DKIND.chip.col,'.mc[data-date]');
const ovw=ctx.overview(OV,'');
assert(/data-date="2026-09-0[1-6]"/.test(ovw),'每一格要帶日期，才知道拖到哪天');
assert(ovw.includes('data-id="T1"'),'任務要帶 id 才拖得動');
assert(!/chip2[^>]*onclick=/.test(ovw),'不要掛 onclick——拖完那一下會誤觸發編輯');
const clickH2=src.split("$('view').addEventListener('click'")[1].split('});')[0];
assert(clickH2.includes(".chip2[data-id]"),'改走委派，才吃得到拖曳後的保護');
assert(clickH2.indexOf('chip2')<clickH2.indexOf("closest('button')"),
  'chip2 本身是按鈕，要排在「按鈕不處理」那道防線前面');

// 放下去要改到期日，而且就地更新
ctx.paint=function(){};
ctx.RAW={tasks:[{id:'T1',title:'那件事',due:'2026-09-03',priority:'A',status:'待辦'}]};
sent=null;ctx.toDay('T1','2026-09-06');
assert.strictEqual(sent.action,'task_update');
assert.strictEqual(sent.params.due,'2026-09-06');
assert.strictEqual(ctx.RAW.tasks[0].due,'2026-09-06','就地更新，不用整頁重抓');
assert.strictEqual(ctx.applyDue('沒這筆','2026-09-06'),false);

// 原本兩種不能被改壞（前面的測試改過 VIEW，這裡要轉回看板才會帶 board 旗標）
ctx.VIEW='board';
assert.strictEqual(move('T1','run','today'),want0({action:'task_update',params:{id:'T1',status:'進行中'}}));
assert.strictEqual(ctx.DKIND.t.key,'drop');
assert.strictEqual(ctx.DKIND.nc.key,'sect');

// ---- 箭頭直接寫上下一個什麼 ----
assert(src.includes("'上一'+unit"),'‹ › 光是箭頭看不出會跳多遠');
assert(src.includes("{week:'週',month:'個月'}[OVRANGE]"));
console.log('週格拖曳  任務可以拖到別天，箭頭寫明上一週／下一週');

// ---- 資料區的卡片點進去是一整頁 ----
// 原本在卡片上長一個三行的 textarea，寫長一點就看不到自己在打什麼。
ctx.paint=function(){};
ctx.RAW={sections:[{id:'S1',name:'test 1'},{id:'S2',name:'test 2'}],
  items:[{id:'D1',section:'S1',title:'生命',body:'生命\n這是舊資料，第一行就是標題',created:'2026-09-03 10:00'}]};
ctx.openItem('D1');
assert.strictEqual(ctx.PAGE,'D1');
assert.strictEqual(ctx.$('pgT').value,'生命','標題獨立一格');
assert.strictEqual(ctx.$('pgB').value,'生命\n這是舊資料，第一行就是標題','內文原封不動');
assert(ctx.$('pgS').innerHTML.includes('test 2'),'分區可以直接在頁面上換');
assert(ctx.$('pgS').innerHTML.includes('未分類'));

ctx.$('pgT').value='生命';ctx.$('pgB').value='生命\n改過的內文';ctx.$('pgS').value='S2';
sent=null;ctx.savePage();
assert.strictEqual(sent.action,'item_save');
assert.strictEqual(sent.params.title,'生命');
assert.strictEqual(sent.params.body,'生命\n改過的內文');
assert.strictEqual(sent.params.section,'S2');
assert.strictEqual(ctx.PAGE,null,'存完就關掉');
// 標題留空時退回用第一行，跟以前的行為一致
ctx.RAW.items[0].title='';ctx.openItem('D1');
ctx.$('pgT').value='';ctx.$('pgB').value='沒有標題的第一行\n第二行';
sent=null;ctx.savePage();
assert.strictEqual(sent.params.title,'沒有標題的第一行');
// 兩個都空就不送
ctx.openItem('D1');ctx.$('pgT').value='';ctx.$('pgB').value='   ';
sent=null;ctx.savePage();
assert.strictEqual(sent,null,'標題和內容都空就不要送');
ctx.closePage();

// 卡片點下去走 openItem，不再就地長 textarea
const clickH3=src.split("$('view').addEventListener('click'")[1].split('});')[0];
assert(clickH3.includes('openItem(nc.dataset.item)'));
assert(!/function editItem/.test(src),'內嵌編輯那套拿掉了');

// 卡片預覽：舊資料第一行等於標題要去掉，新資料不能亂砍
assert.strictEqual(ctx.bodyPreview({title:'生命',body:'生命\n第二行'}),'第二行');
assert.strictEqual(ctx.bodyPreview({title:'另一個標題',body:'第一行\n第二行'}),'第一行\n第二行',
  '獨立標題之後第一行是真的內容，不能砍');
assert.strictEqual(ctx.bodyPreview({title:'只有標題',body:'只有標題'}),'');

// ---- blur 裡不能直接改 DOM ----
// Chrome 會丟 The node to be removed is no longer a child of this node。
const inlineSrc=src.split('function inline(')[1].split('\nfunction ')[0];
assert(/blur[\s\S]*setTimeout/.test(inlineSrc),'blur 要挪到事件之後再存檔');
console.log('資料區    卡片點進去開整頁，blur 不再同步改 DOM');

// ---- 重複任務的介面 ----
assert.strictEqual(ctx.repeatMark(''),'','不重複的不加記號');
assert(ctx.repeatMark('每週').includes('🔁'));
assert(ctx.taskCard({id:'R1',title:'每週檢查',project:'Shopline',due:T,priority:'B',
  status:'待辦',repeat:'每週'},'today').includes('🔁'),'卡片看得出這件做完還會再來');
assert(src.includes('<option value="每兩週">'),'表單要有重複的選項');

// 表單：帶得出既有值、送得出去、關掉會清乾淨
ctx.paint=function(){};
ctx.RAW={running:[],today:[{id:'R1',title:'每週檢查',project:'Shopline',due:T,priority:'B',
  status:'待辦',next:'',waiting:'',owner:'我',repeat:'每週'}],tomorrow:[],unscheduled:[],date:T};
ctx.edit('R1');
assert.strictEqual(ctx.$('fR').value,'每週','編輯時帶出原本的重複設定');
sent=null;ctx.submit();
assert.strictEqual(sent.params.repeat,'每週','送出時帶上');
ctx.closeAdd();
assert.strictEqual(ctx.$('fR').value,'','關掉要清乾淨，不然下一筆會沿用');

// 完成之後要告訴使用者下一次是哪天
assert.strictEqual(ctx.nextToast({spawned:{due:'2026-09-14'}}),'已完成，下一次 9/14');
assert.strictEqual(ctx.nextToast({}),'已完成');
assert.strictEqual(ctx.nextToast(null),'已完成');
console.log('重複      表單、卡片記號、完成後的提示都在');

// ---- 儲存就關窗、日期欄位點了就開日曆 ----
// Apps Script 一趟要一兩秒。視窗如果等回應才關，使用者會以為沒存到又按一次
{
  const V=ctx.$('veil');
  ctx.EDIT=null;ctx.EDITL=null;ctx.KIND='task';
  ctx.openAdd('task');
  assert(V.classList.contains('on'),'開窗');
  ctx.$('fT').value='新任務';
  sent=null;ctx.submit();
  assert(sent,'儲存要真的送出去');
  assert(!V.classList.contains('on'),'按下儲存的當下就關窗，不等伺服器');
}

// 桌機點日期欄位只會跳到那段數字，日曆得點右邊那顆圖示；改成點哪裡都叫得出來
{
  const fld=src.match(/<input id="fD"[^>]*>/)[0];
  assert(/onclick="pickDate\(this\)"/.test(fld),'到期日欄位要能點開日曆：'+fld);
  let opened=0;
  ctx.pickDate({showPicker(){opened++}});
  assert.strictEqual(opened,1,'pickDate 要叫原生日曆');
  ctx.pickDate({});                                    // 舊 Safari 沒有 showPicker
  ctx.pickDate({showPicker(){throw new Error('not allowed')}});  // 不算手勢會丟例外
}

// 失敗時不能在錯誤訊息後面再蓋一句「已儲存」——那會讓人以為存好了
(async()=>{
  // 先把前面那些送出的 mutation 都跑完，不然它們的 toast 會混進來
  for(let i=0;i<20;i++)await Promise.resolve();
  FAIL=1;toasts=[];
  ctx.openAdd('task');ctx.$('fT').value='會失敗的';
  ctx.submit();
  for(let i=0;i<20;i++)await Promise.resolve();
  FAIL=0;
  assert(!toasts.includes('已儲存'),'失敗了就別說已儲存：'+toasts.join('/'));
  console.log('存檔      按下就關窗，日期點得開日曆，失敗不會謊報已儲存');
})();

