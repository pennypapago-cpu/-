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

const stub={className:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},
  addEventListener(){},appendChild(){},remove(){},cloneNode(){return this},
  getBoundingClientRect(){return{left:0,top:0,width:100}},focus(){},querySelectorAll(){return[]},
  closest(){return null},value:'',innerHTML:'',textContent:'',disabled:false};
const ctx={
  document:{addEventListener(){},getElementById(){return stub},querySelectorAll(){return[]},
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

console.log('toasts   ',toasts.join(' / '));
console.log('DROP     ',JSON.stringify(ctx.DROP));
console.log('\nDRAG PASS');
