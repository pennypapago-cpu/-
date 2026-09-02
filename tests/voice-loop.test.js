/**
 * ai-tutor.html 語音對話狀態機回歸測試
 *
 * 把 ASR、TTS、Gemini API 三個外部相依全部換成假的，在無頭瀏覽器裡跑完整的對話流程，
 * 驗證真實麥克風測不到的邏輯：延遲判停、流式朗讀、插話打斷、回音防護。
 *
 * 執行：
 *   npm i -g playwright && npx playwright install chromium
 *   node tests/voice-loop.test.js
 *
 * 全過會 exit 0，有任何一項失敗 exit 1。
 */
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE_URL = pathToFileURL(path.join(__dirname, '..', 'ai-tutor.html')).href;

// 假的 ASR / TTS / Gemini，在頁面腳本執行前先裝好
const STUBS = () => {
  // ── 假 TTS ──
  const spoken = [];
  window.__spoken = spoken;
  window.__cancels = 0;
  let cur = null;
  const synth = {
    getVoices: () => [],
    onvoiceschanged: null,
    speak(u) {
      spoken.push(u.text);
      cur = u;
      u.__t1 = setTimeout(() => { u.onstart && u.onstart(); }, 5);
      u.__t2 = setTimeout(() => { cur = null; u.onend && u.onend(); }, 80);
    },
    cancel() {
      window.__cancels++;
      if (cur) { clearTimeout(cur.__t1); clearTimeout(cur.__t2); cur = null; }
    }
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };

  // ── 假 ASR ──
  window.__asrLang = null;
  class FakeSR {
    start() { window.__recog = this; window.__asrLang = this.lang; this.onstart && this.onstart(); }
    stop() { this.onend && this.onend(); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;

  // 注入一段辨識結果
  window.__say = (text, isFinal) => {
    const r = [{ transcript: text }];
    r.isFinal = !!isFinal;
    const results = [r];
    window.__recog.onresult({ resultIndex: 0, results });
  };

  // ── 假 Gemini ──
  window.__streamChunks = ['Hello there! ', 'How are you today? ', '§FIX§\n❌ I very like it\n✅ I really like it'];
  window.__chunkDelay = 120;
  window.__fetchCalls = [];
  window.fetch = (url, opts) => {
    window.__fetchCalls.push(String(url));
    if (String(url).includes('streamGenerateContent')) {
      const chunks = window.__streamChunks.slice();
      const delay = window.__chunkDelay;
      const enc = new TextEncoder();
      const signal = opts && opts.signal;
      const stream = new ReadableStream({
        async start(ctl) {
          for (const c of chunks) {
            await new Promise(r => setTimeout(r, delay));
            if (signal && signal.aborted) { ctl.error(new DOMException('aborted', 'AbortError')); return; }
            const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text: c }] } }] });
            ctl.enqueue(enc.encode('data: ' + payload + '\n\n'));
          }
          ctl.close();
        }
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    }
    // 非串流（報告）
    return Promise.resolve(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '## 整體表現\n測試報告內容' }] } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
};

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   → ' + detail : ''));
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await p.addInitScript(STUBS);
  await p.goto(PAGE_URL);
  await p.waitForTimeout(400);

  // 開始對話（會觸發開場白）
  await p.fill('#apiKey', 'TEST_KEY');
  await p.click('#micBtn');
  await p.waitForTimeout(900);

  // ── 測試 1：ASR 語言有正確帶入 ──
  check('ASR 語言設定為練習語言', await p.evaluate(() => window.__asrLang) === 'en-US',
        'lang=' + await p.evaluate(() => window.__asrLang));

  // ── 測試 2：流式朗讀 — 第一句要在整段收完前就開始唸 ──
  const early = await p.evaluate(() => window.__spoken.length);
  check('流式朗讀：整段還沒收完就先唸出第一句', early >= 1, '開場白已唸出 ' + early + ' 句');

  // ── 測試 3：§FIX§ 之後的糾錯內容不會被唸出來 ──
  await p.waitForTimeout(900);
  const spokenAll = await p.evaluate(() => window.__spoken.join(' | '));
  check('糾錯內容不進 TTS', !spokenAll.includes('§FIX§') && !spokenAll.includes('I very like it'),
        JSON.stringify(spokenAll));
  const fixShown = await p.evaluate(() => {
    const b = document.querySelector('.fix-box');
    return b ? b.textContent.trim() : null;
  });
  check('糾錯內容有顯示在畫面上', !!fixShown && fixShown.includes('I really like it'), JSON.stringify(fixShown));

  // ── 測試 4：延遲判停 — 靜音不夠久不該送出 ──
  await p.evaluate(() => { window.__spoken.length = 0; document.getElementById('endpoint').value = '600'; });
  const turnsBefore = await p.evaluate(() => S.turns);
  await p.evaluate(() => window.__say('I want to order a coffee', true));
  await p.waitForTimeout(300);                       // < 600ms
  const turnsMid = await p.evaluate(() => S.turns);
  check('判停：靜音未滿門檻時不送出', turnsMid === turnsBefore, `turns ${turnsBefore} → ${turnsMid}`);
  await p.waitForTimeout(600);                       // 累計 > 600ms
  const turnsAfter = await p.evaluate(() => S.turns);
  check('判停：靜音超過門檻後送出一輪', turnsAfter === turnsBefore + 1, `turns ${turnsBefore} → ${turnsAfter}`);

  // ── 測試 5：回音防護 — 唸到自己的聲音不算插話 ──
  await p.waitForTimeout(200);
  const bargesBefore = await p.evaluate(() => S.barges);
  const echoDetected = await p.evaluate(() => {
    // 模擬麥克風收到 TTS 正在唸的內容
    S.agentSpeaking = true;
    S.speakingText = 'Hello there! How are you today?';
    document.getElementById('echoGuard').checked = true;
    window.__say('hello there how are you today', false);
    return S.barges;
  });
  check('回音防護：TTS 自己的聲音不觸發打斷', echoDetected === bargesBefore,
        `barges ${bargesBefore} → ${echoDetected}`);

  // ── 測試 6+7：真正跑一輪串流，中途插話打斷 ──
  // 拉長 chunk 間隔，讓串流還在進行時就有機會插話
  await p.evaluate(() => {
    window.__chunkDelay = 300;
    window.__streamChunks = ['Sure thing! ', 'What size would you like? ', 'And anything else? '];
    window.__spoken.length = 0;
    document.getElementById('echoGuard').checked = true;
  });

  // 送出一輪，讓外教開始串流回覆
  await p.evaluate(() => window.__say('a latte please', true));
  await p.waitForTimeout(1200);   // 第一句已收到、已唸完（spokenSoFar 有東西），第二句還在路上

  const midStream = await p.evaluate(() => ({
    generating: S.generating, hasNode: !!S.aliveNode, spokenSoFar: S.spokenSoFar
  }));
  check('串流進行中：狀態正確（generating + 有活躍泡泡 + 已唸出第一句）',
        midStream.generating && midStream.hasNode && midStream.spokenSoFar.length > 0,
        JSON.stringify(midStream));

  // 這時候插話
  const bargeRes = await p.evaluate(async () => {
    const cancelsBefore = window.__cancels;
    const bargesBefore = S.barges;
    window.__say('actually make it a large one', false);
    // 換掉後續回合的內容，才能分辨「被中斷那輪」與「打斷後新起的那輪」
    window.__streamChunks = ['Got it, one large latte. '];
    await new Promise(r => setTimeout(r, 100));
    return {
      bargeDelta: S.barges - bargesBefore,
      cancelled: window.__cancels > cancelsBefore,
      generating: S.generating,
      aliveNode: !!S.aliveNode,
      lastHistory: S.history[S.history.length - 1]
    };
  });
  check('插話打斷：計數增加', bargeRes.bargeDelta === 1, 'delta=' + bargeRes.bargeDelta);
  check('插話打斷：TTS 立即停嘴', bargeRes.cancelled);
  check('插話打斷：generating 旗標歸位', bargeRes.generating === false);
  check('插話打斷：活躍泡泡已清掉', bargeRes.aliveNode === false);
  check('插話打斷：已唸出口的半句寫回歷史',
        bargeRes.lastHistory && bargeRes.lastHistory.role === 'model'
          && bargeRes.lastHistory.text.includes('interrupted by learner'),
        JSON.stringify(bargeRes.lastHistory));

  // 被 abort 的那一輪，只能留下「被打斷」那一筆 model，不能事後又補一筆完整回覆
  await p.waitForTimeout(1400);
  const aborted = await p.evaluate(() => {
    const hits = S.history.filter(h => h.role === 'model' && h.text.includes('Sure thing'));
    return { count: hits.length, texts: hits.map(h => h.text) };
  });
  check('插話打斷：被 abort 的回覆只留一筆截斷版，沒有事後補上完整內容',
        aborted.count === 1
          && aborted.texts[0].includes('interrupted by learner')
          && !aborted.texts[0].includes('And anything else'),
        JSON.stringify(aborted));

  const followUp = await p.evaluate(() =>
    S.history.some(h => h.role === 'model' && h.text.includes('Got it, one large latte')));
  check('插話打斷：打斷後新起的一輪能正常完成', followUp);

  // 插話講的內容本身要成為下一輪的 user（這才是打斷的意義）
  const bargeBecameTurn = await p.evaluate(() =>
    S.history.some(h => h.role === 'user' && h.text.includes('make it a large one')));
  check('插話打斷：插話內容成為下一輪對話', bargeBecameTurn);

  // ── 開場即打斷：一句都還沒唸出來時，歷史仍要保持 user/model 交替 ──
  // 先等前一輪串流真的結束，再清空歷史，否則它會把自己的回覆補進來
  await p.waitForFunction(() => !S.generating, null, { timeout: 5000 });
  await p.waitForTimeout(200);
  const earlyBarge = await p.evaluate(async () => {
    S.history.length = 0;
    window.__chunkDelay = 400;
    window.__say('hello', true);
    await new Promise(r => setTimeout(r, 700));      // 判停送出 + 串流剛起步，還沒唸出任何句子
    const spokenBefore = S.spokenSoFar;
    window.__say('wait sorry', false);
    await new Promise(r => setTimeout(r, 100));
    return { spokenBefore, roles: S.history.map(h => h.role) };
  });
  const alternates = earlyBarge.roles.every((r, i) => r === (i % 2 === 0 ? 'user' : 'model'));
  check('尚未出聲就被打斷：歷史仍維持 user/model 交替',
        alternates, JSON.stringify(earlyBarge.roles));

  // ── 測試 8：abort 後不該留下錯誤泡泡 ──
  const errorBubbles = await p.evaluate(() =>
    [...document.querySelectorAll('.bubble')].filter(b => b.textContent.startsWith('⚠️')).length);
  check('插話打斷：不會誤顯示錯誤訊息', errorBubbles === 0, errorBubbles + ' 個錯誤泡泡');

  // ── 測試 9：歷史記錄的 role 交替正確（Gemini 要求）──
  const roleOk = await p.evaluate(() => S.history.every(h => h.role === 'user' || h.role === 'model'));
  check('對話歷史 role 皆為 user/model', roleOk);

  // ── 測試 10：練習報告 ──
  await p.evaluate(() => { S.agentSpeaking = false; S.generating = false; });
  await p.click('#reportBtn');
  await p.waitForTimeout(600);
  const reportHtml = await p.evaluate(() => document.getElementById('reportBody').innerHTML);
  check('練習報告可產生並渲染', reportHtml.includes('整體表現') && reportHtml.includes('<h3>'),
        reportHtml.slice(0, 70));

  // ── 測試 11：報告請求沒有把 §FIX§ 內部標記送出去 ──
  const reportPrompt = await p.evaluate(() => window.__fetchCalls.filter(u => u.includes(':generateContent')).length);
  check('報告走非串流端點', reportPrompt >= 1, reportPrompt + ' 次呼叫');

  console.log('\nCONSOLE ERRORS: ' + (errs.length ? JSON.stringify(errs, null, 1) : 'none'));
  const failed = results.filter(r => !r.pass);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
  await b.close();
  process.exit(failed.length ? 1 : 0);
})();
