// Records preview videos for game portals (CrazyGames: 15-20 s, no sound,
// 1080p landscape 16:9 and portrait 2:3, starting on the cover).
// Plays real practice games against bots in headless Chrome, keeps a few
// clips at real speed (cuts between them, never sped up), then turns them
// into MP4 files with Chrome's own video recorder.
//
//   1. python -m http.server 8765        (from the project folder)
//   2. node tools/covers/render.mjs      (the covers open each video)
//   3. node tools/video/record.mjs       (writes dist/video/*.mp4)
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const SITE = 'http://127.0.0.1:8765';
const W = 1920;
const H = 1080;
const OUT = resolve('dist/video');
const FRAMES = join(OUT, 'frames');
// --encode-only: skip recording and reuse the frames from the last run.
const ENCODE_ONLY = process.argv.includes('--encode-only');
if (!ENCODE_ONLY) rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ra-video-'))}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio', '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank']);
let version;
for (let i = 0; i < 50 && !version; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(200); }
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const handlers = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method) handlers.forEach((h) => h(msg));
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ready, send, on: (h) => handlers.push(h) };
}
const browser = connect(version.webSocketDebuggerUrl);
await browser.ready;

async function openTab() {
  const { result } = await browser.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const c = connect(list.find((x) => x.id === result.targetId).webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const tab = {
    ...c,
    async eval(expr) {
      const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(`${expr.slice(0, 80)}: ${r.result.exceptionDetails.exception?.description}`);
      return r.result?.result?.value;
    },
    async waitFor(expr, timeout = 15000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await tab.eval(expr)) return; } catch { /* loading */ }
        await sleep(100);
      }
      throw new Error('timed out: ' + expr);
    },
    click: (sel) => tab.eval(`document.querySelector(${JSON.stringify(sel)}).click()`),
    // Type like a person (a bit fast), then press Enter.
    async type(text, perChar = 45) {
      await tab.eval(`document.querySelector('#term input').focus()`);
      for (const ch of text) { await c.send('Input.insertText', { text: ch }); await sleep(perChar); }
    },
    enter: () => tab.eval(`document.querySelector('#term input').form.requestSubmit()`),
    async key(key, code, vk) {
      await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    },
  };
  return tab;
}

if (!ENCODE_ONLY) {
// ---- Screen recording: keep frames only inside clips ----
const G = await openTab();
let recording = null; // the clip being recorded
let last = null; // the newest frame, even outside clips
let frameNo = 0;
const clips = [];
G.on((msg) => {
  if (msg.method !== 'Page.screencastFrame') return;
  G.send('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
  last = { data: msg.params.data, at: Date.now() };
  if (recording) {
    const file = `f${String(++frameNo).padStart(5, '0')}.jpg`;
    writeFileSync(join(FRAMES, file), Buffer.from(msg.params.data, 'base64'));
    recording.frames.push({ file, at: last.at });
  }
});
await G.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

async function clip(name, fn) {
  const c = { name, start: Date.now(), frames: [] };
  // The screen as it is right now opens the clip (frames only come when something changes).
  if (last) {
    const file = `f${String(++frameNo).padStart(5, '0')}.jpg`;
    writeFileSync(join(FRAMES, file), Buffer.from(last.data, 'base64'));
    c.frames.push({ file, at: c.start });
  }
  recording = c;
  await fn();
  c.end = Date.now();
  recording = null;
  clips.push(c);
  console.log(`clip ${name}: ${((c.end - c.start) / 1000).toFixed(1)} s, ${c.frames.length} frames`);
}

// ---- The game ----
const game = (q = '') => `${SITE}/?local=1${q}`;
await G.send('Page.navigate', { url: game() });
await G.waitFor('document.readyState === "complete" && !!window.__ra');
await G.eval(`window.dispatchEvent(new Event('pointerdown')); window.confirm = () => true; document.getElementById('nameInput').value = 'neo'`);
await sleep(800);
const startPractice = async (mode, botLevel = 'easy') => {
  await G.click('#practiceBtn');
  await G.waitFor(`document.body.dataset.screen === 'lobby'`);
  if (mode !== 'race') { await G.click(`.mode-card[data-mode=${mode}]`); await G.waitFor(`window.__ra.state.room.mode === '${mode}'`); }
  await G.eval(`(() => { const { net, code } = window.__ra.state; return net.update(code, { botLevel: '${botLevel}' }); })()`);
  await sleep(300);
};
const leave = async () => {
  await G.click('#gameLeave');
  await G.waitFor(`document.body.dataset.screen === 'menu'`);
  await sleep(300);
};

// 1) Into the lobby: players, modes and chat.
await clip('lobby', async () => {
  await G.click('#practiceBtn');
  await G.waitFor(`document.body.dataset.screen === 'lobby'`);
  await sleep(1300);
});

// 2) Terminal Race: countdown, the guide, and cracking the first layer.
await G.eval(`(() => { const { net, code } = window.__ra.state; return net.update(code, { botLevel: 'easy' }); })()`);
await G.click('#startBtn');
await sleep(1600); // (cut) most of the countdown
await clip('race', async () => {
  await G.waitFor(`document.getElementById('countdown').hidden && !document.querySelector('#term input').disabled`);
  await sleep(500);
  await G.type('cat mission.txt');
  await G.enter();
  await sleep(700);
  const P = await G.eval(`import('./src/modes/race.js').then((m) => { const p = m.buildRace(window.__ra.state.room.seed); return { target: p.target, pass: p.pass }; })`);
  await G.type(`login ${P.target} ${P.pass}`);
  await G.enter();
  await G.waitFor(`document.querySelector('.race-guide .guide-title').textContent.includes('Step 2')`, 6000);
  await sleep(1100);
});
await leave();

// 3) A quick hack: Letter Lock, locking letters as they scroll past.
await startPractice('letterlock');
await G.click('#startBtn');
await G.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('countdown').hidden && !!window.__ra.quick?.data()`);
await G.send('Page.bringToFront');
await sleep(400);
await clip('letterlock', async () => {
  const end = Date.now() + 2600;
  const pw = await G.eval('window.__ra.quick.data().password');
  let locked = 0;
  while (Date.now() < end && locked < pw.length) {
    const seen = await G.eval(`new Promise((r) => { const t = performance.now(); const f = () => { const c = document.querySelector('.ll-col.active span.mid'); if (c && c.textContent === ${JSON.stringify(pw)}[${locked}]) r(true); else if (performance.now() - t > 1500) r(false); else requestAnimationFrame(f); }; f(); })`);
    if (!seen) continue;
    await G.key(' ', 'Space', 32);
    await sleep(120);
    locked = await G.eval(`document.querySelectorAll('.ll-col.locked').length`);
  }
  if (Date.now() < end) await sleep(end - Date.now());
});
await leave();

// 4) King of the Hill: crack the lock and take the hill.
await startPractice('koth');
await G.click('#startBtn');
await G.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('countdown').hidden && !document.querySelector('#term input').disabled && !!window.__ra.koth`);
await sleep(700);
await clip('koth', async () => {
  const answer = await G.eval('window.__ra.koth.answer()');
  await sleep(400);
  await G.type(answer, 90);
  await G.enter();
  await G.waitFor(`window.__ra.state.room.game?.holder === window.__ra.state.net.uid`, 5000);
  await sleep(1600);
});

// 5) Results: the podium, confetti and trophies.
await sleep(2500); // (cut) hold the hill a little longer
await G.eval(`(async () => { const { roundTime } = await import('./src/util.js'); const { MODES } = await import('./src/modes/index.js'); const { room, net, code } = window.__ra.state; await net.update(code, { startedAt: net.now() - roundTime(MODES.koth, room.roundLength) - 500 }); })()`);
await clip('results', async () => {
  await G.waitFor(`document.body.dataset.screen === 'results'`, 6000);
  await sleep(3000);
});
await G.send('Page.stopScreencast');

// ---- Timeline: how long each frame stays on screen ----
const timeline = [];
for (const c of clips) {
  c.frames.forEach((f, i) => {
    const next = c.frames[i + 1]?.at ?? c.end;
    timeline.push({ file: f.file, ms: Math.max(1, next - f.at) });
  });
}
const total = timeline.reduce((s, f) => s + f.ms, 0);
writeFileSync(join(FRAMES, 'timeline.json'), JSON.stringify({ timeline }));
console.log(`gameplay: ${(total / 1000).toFixed(1)} s in ${timeline.length} frames`);

}

// ---- Make the MP4s (cover first, then the gameplay) ----
const E = await openTab();
E.on((m) => {
  if (m.method === 'Runtime.consoleAPICalled') console.log('[encode]', m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') console.log('[encode error]', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
for (const layout of ['landscape', 'portrait']) {
  await E.send('Page.navigate', { url: `${SITE}/tools/video/encode.html?layout=${layout}` });
  await E.waitFor('document.readyState === "complete" && !!window.__encode');
  await E.send('Page.bringToFront');
  const len = await E.eval('window.__encode()');
  let b64 = '';
  for (let i = 0; i < len; i += 4_000_000) b64 += await E.eval(`window.__b64.slice(${i}, ${i + 4_000_000})`);
  const file = join(OUT, `root-access-preview-${layout}.mp4`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  const info = await E.eval('window.__info');
  console.log(`wrote ${file} (${info.w}x${info.h}, ${(info.ms / 1000).toFixed(1)} s, ${(b64.length * 0.75 / 1048576).toFixed(1)} MB)`);
}
chrome.kill();
process.exit(0);
