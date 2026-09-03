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
function want(o){return JSON.stringify(o)}

// 移到執行中：只改狀態，不動日期
assert.strictEqual(move('T1','run','today'),want({action:'task_update',params:{id:'T1',status:'進行中'}}));
// 移到今日：設今天，狀態不動（本來就是待辦）
assert.strictEqual(move('T2','today','tmr'),want({action:'task_update',params:{id:'T2',due:T}}));
// 移到明日：設明天
assert.strictEqual(move('T3','tmr','today'),want({action:'task_update',params:{id:'T3',due:tomorrow}}));
// 從執行中拖出來：改日期並退回待辦
assert.strictEqual(move('T4','today','run'),want({action:'task_update',params:{id:'T4',due:T,status:'待辦'}}));
assert.strictEqual(move('T5','tmr','run'),want({action:'task_update',params:{id:'T5',due:tomorrow,status:'待辦'}}));
// 丟回原欄：什麼都不做
assert.strictEqual(move('T6','today','today'),null,'同一欄不送 API');
assert.strictEqual(move('T7','run','run'),null);

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
assert(!ctx.logCard({title:'l',source:'Cowork',start:'2026-09-03 10:00',project:'',summary:''}).includes('data-id'));
// 欄位要有 data-drop
assert(ctx.col('c-today','📅','今日工作',[],'空').includes('data-drop="today"'));
assert(ctx.col('c-run','⏰','AI','',[]).includes('data-drop="run"'));

console.log('toasts   ',toasts.join(' / '));
console.log('DROP     ',JSON.stringify(ctx.DROP));
console.log('\nDRAG PASS');
