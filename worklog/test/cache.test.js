// 切頁面到底要等幾趟 Apps Script？這支測試就是釘住那個數字。
// 一趟一兩秒，使用者感覺到的「慢」全部在那裡，不在畫面渲染。
const path=require('path'),fs=require('fs'),vm=require('vm'),assert=require('assert');
const SRC=process.argv[2]||path.join(__dirname,'..','index.html');
const js=fs.readFileSync(SRC,'utf8').split('<script>')[1].split('</script>')[0];

// 假 DOM：只要撐得住 load()/settle()/busy() 走完，畫面本身交給 drag.test.js 驗
function stub(){return{style:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},
  dataset:{},value:'',innerHTML:'',textContent:'',disabled:false,
  addEventListener(){},appendChild(){},remove(){},focus(){},
  querySelectorAll(){return[]},querySelector(){return stub()},closest(){return null},
  getBoundingClientRect(){return{left:0,top:0,width:100}}}}

let hits=[];
const els={};
const ctx={
  document:{addEventListener(){},getElementById(i){return els[i]||(els[i]=stub())},
    querySelectorAll(){return[]},documentElement:{style:{setProperty(){}}},
    elementFromPoint(){return null},body:{classList:{add(){},remove(){}},appendChild(){}},
    createElement(){return stub()}},
  window:{},localStorage:{getItem(){return 'tok'},setItem(){},removeItem(){}},
  setTimeout(f,ms){return 0},clearTimeout(){},location:{reload(){}},
  google:{script:{run:{
    withSuccessHandler(f){this._s=f;return this},
    withFailureHandler(f){this._f=f;return this},
    uiCall(tok,action,params){hits.push(action);this._s({ok:true})}}}}};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(js.replace(/^boot\(\);$/m,''),ctx);
ctx.paint=function(){};          // 這支只算抓幾次，不驗畫面

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
const clear=()=>{ctx.VC={};ctx.VCT={};hits=[]};
// 預抓中間刻意留空檔，測試裡讓它立刻跑完
const nowait=async fn=>{const st=ctx.setTimeout;ctx.setTimeout=f=>{f();return 0};
  fn();await flush();ctx.setTimeout=st};

(async()=>{
  // 1. 沒看過的頁面：抓一次
  clear();ctx.go('pool');await flush();
  assert.deepStrictEqual(hits,['pool'],'第一次進去要抓');

  // 2. 一分鐘內切回來：一次都不用抓
  ctx.go('board');await flush();
  hits=[];ctx.go('pool');await flush();
  assert.deepStrictEqual(hits,[],'剛看過的頁面直接用快取，不再問伺服器');

  // 3. 過了保鮮期就重抓，不然畫面會一直停在舊資料
  ctx.VCT[ctx.vkey()]=Date.now()-ctx.FRESH-1;
  hits=[];ctx.go('pool');await flush();
  assert.deepStrictEqual(hits,['pool'],'超過一分鐘要重抓');

  // 4. 背景預抓：使用者還在看目前這頁時，其他頁先抓好放著
  clear();ctx.VIEW='board';
  await nowait(()=>ctx.prefetch());
  const others=ctx.VIEWS.filter(v=>!v.hide&&v.v!=='settings'&&v.v!=='board');
  others.forEach(v=>{
    const k=ctx.asView(v.v,ctx.vkey);
    assert(ctx.VC[k],'預抓應該暖好「'+v.n+'」（鍵 '+k+'）')});
  // 預抓存的鍵要跟頁面實際會讀的鍵一模一樣，不然抓了也讀不到，
  // 而且完全看不出來哪裡壞了——照樣會動，只是照樣要等
  hits=[];ctx.go('pool');await flush();
  assert.deepStrictEqual(hits,[],'預抓過的頁面切過去是零請求');
  hits=[];ctx.go('done');await flush();
  assert.deepStrictEqual(hits,[],'完成項目也一樣');

  // 5. 寫入之後別頁的快取要丟掉——改一件任務，專案池和完成項目都會跟著變
  clear();ctx.VIEW='board';
  await nowait(()=>ctx.prefetch());
  const poolKey=ctx.asView('pool',ctx.vkey);
  assert(ctx.VC[poolKey],'先確定專案池有暖到');
  ctx.mutate('task_update',{id:'T1',status:'完成'},null);
  await flush();
  assert(!ctx.VC[poolKey],'寫入後別頁的快取要作廢，不然會讀到改之前的樣子');

  // 6. 時間戳一定要跟資料一起動，不然會「資料換了但時間戳還很新」
  clear();ctx.VC.notes={ok:true};        // 只塞資料、不塞時間戳＝當作過期
  ctx.VIEW='notes';ctx.go('notes');await flush();
  assert.deepStrictEqual(hits,['data'],'沒有時間戳的快取視同過期，要重抓');

  console.log('切頁面    看過的一分鐘內零請求，沒看過的背景先暖好，寫入後別頁作廢');
  console.log('');
  console.log('CACHE PASS');
})();
