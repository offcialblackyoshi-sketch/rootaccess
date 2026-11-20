// End-to-end test: drives 3+ headless Chrome windows through every mode using
// the local (same-computer) multiplayer backend.
//
//   1. Serve the folder:   python -m http.server 8765
//   2. Run:                node tests/e2e.mjs [screenshot-folder]
//
// Set CHROME=/path/to/chrome if Chrome isn't in the default Windows location.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL_BASE = process.env.URL || 'http://localhost:8765/';
const OUT = process.argv[2] || mkdtempSync(join(tmpdir(), 'ra-e2e-'));
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ra-prof-'))}`,
  '--window-size=1366,768', '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank']);

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
  return { ws, ready, send, on: (h) => handlers.push(h) };
}

const browser = connect(version.webSocketDebuggerUrl);
await browser.ready;

async function openTab(name) {
  const { result } = await browser.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const t = list.find((x) => x.id === result.targetId);
  const c = connect(t.webSocketDebuggerUrl);
  await c.ready;
  const errors = [];
  c.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const tab = {
    name, errors, targetId: result.targetId, send: c.send,
    async eval(expr) {
      const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(`[${name}] ${expr.slice(0, 80)}: ${r.result.exceptionDetails.exception?.description}`);
      return r.result?.result?.value;
    },
    async waitFor(expr, timeout = 10000, label = expr) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await tab.eval(expr)) return true; } catch { /* page may be loading */ }
        await sleep(150);
      }
      throw new Error(`[${name}] timed out waiting for: ${label}`);
    },
    async goto(url) {
      await c.send('Page.navigate', { url });
      await tab.waitFor('document.readyState === "complete" && !!window.__ra', 10000, 'page load');
    },
    click: (sel) => tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ${sel}'); e.click(); return true; })()`),
    // Type a command into the game terminal.
    cmd: (line) => tab.eval(`(() => { const i = document.querySelector('#term input'); i.value = ${JSON.stringify(line)}; i.dispatchEvent(new Event('input')); i.form.requestSubmit(); return true; })()`),
    termText: () => tab.eval(`document.querySelector('#term .term-out').innerText`),
    room: () => tab.eval('JSON.parse(JSON.stringify(window.__ra.state.room))'),
    screen: () => tab.eval('document.body.dataset.screen'),
    async shot(file) {
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, file), Buffer.from(r.result.data, 'base64'));
    },
    close: () => browser.send('Target.closeTarget', { targetId: result.targetId }),
  };
  return tab;
}

async function step(name, fn) {
  try { await fn(); } catch (e) { check(name, false, e.message); }
}

// Waits for a terminal line containing text, after the most recent command.
async function waitTerm(tab, text, timeout = 10000) {
  await tab.waitFor(`document.querySelector('#term .term-out').innerText.includes(${JSON.stringify(text)})`, timeout, `terminal text "${text}"`);
}

const A = await openTab('A');
const B = await openTab('B');
const C = await openTab('C');

// ---------------------------------------------------------------------------
await step('menu loads', async () => {
  for (const t of [A, B, C]) await t.goto(URL_BASE);
  check('menu loads', (await A.screen()) === 'menu' && (await A.eval(`document.getElementById('netStatus').innerText`)).includes('LOCAL'));
  await A.shot('01-menu.png');
});

let code;
await step('create and join room', async () => {
  await A.eval(`document.getElementById('nameInput').value = 'alice'`);
  await B.eval(`document.getElementById('nameInput').value = 'bob'`);
  await C.eval(`document.getElementById('nameInput').value = 'carol'`);
  await A.click('#createBtn');
  await A.waitFor(`document.body.dataset.screen === 'lobby'`);
  code = await A.eval('window.__ra.state.code');
  for (const t of [B, C]) {
    await t.eval(`document.getElementById('codeInput').value = '${code}'`);
    await t.click('#joinBtn');
    await t.waitFor(`document.body.dataset.screen === 'lobby'`);
    await sleep(300);
  }
  for (const t of [A, B, C]) await t.waitFor(`Object.keys(window.__ra.state.room.players).length === 3`, 5000, '3 players');
  const names = await C.eval(`[...document.querySelectorAll('#lobbyPlayers .pname')].map(e => e.textContent).join(',')`);
  check('create and join room', names === 'alice,bob,carol', `code=${code} players=${names}`);
  const colors = Object.values((await A.room()).players).map((p) => p.color);
  check('players get different colors', new Set(colors).size === 3, colors.join(' '));
});

await step('bad room code rejected', async () => {
  const D = await openTab('D');
  await D.goto(URL_BASE);
  await D.eval(`document.getElementById('codeInput').value = 'ZZZZ'`);
  await D.click('#joinBtn');
  await D.waitFor(`document.getElementById('menuMsg').innerText.includes('No room')`);
  check('bad room code rejected', (await D.screen()) === 'menu');
  await D.close();
});

await step('chat', async () => {
  await B.eval(`(() => { const f = document.querySelector('.chat-form'); f.querySelector('input').value = 'hello from bob'; f.requestSubmit(); })()`);
  await A.waitFor(`document.querySelector('#lobbyChat .chat-log').innerText.includes('hello from bob')`);
  await C.waitFor(`document.querySelector('#lobbyChat .chat-log').innerText.includes('hello from bob')`);
  check('chat reaches everyone', true);
});

async function readyAndStart() {
  for (const t of [B, C]) {
    await t.waitFor(`!!document.getElementById('readyBtn')`);
    if ((await t.eval(`document.getElementById('readyBtn').textContent`)).includes('Ready') && !(await t.eval(`document.getElementById('readyBtn').textContent`)).includes('Not')) await t.click('#readyBtn');
  }
  await A.waitFor(`!!document.getElementById('startBtn') && !document.getElementById('startBtn').disabled`, 5000, 'start enabled');
  await A.click('#startBtn');
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'game'`, 5000, 'game screen');
  // Countdown
  for (const t of [A, B, C]) await t.waitFor(`document.getElementById('countdown').hidden && !document.querySelector('#term input').disabled`, 8000, 'countdown finished');
}

async function backToLobby() {
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'results'`, 15000, 'results screen');
  await A.click('#againBtn');
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'lobby'`, 5000, 'back in lobby');
}

// ---------------------------------------------------------------------------
await step('race', async () => {
  await A.waitFor(`!!document.getElementById('readyBtn') || !!document.getElementById('startBtn')`);
  await A.shot('02-lobby.png');
  await readyAndStart();
  const P = await A.eval(`import('./src/modes/race.js').then(m => { const p = m.buildRace(window.__ra.state.room.seed); return { target: p.target, pass: p.pass, oldPass: p.oldPass, cipherType: p.cipherType, shift: p.shift, pin: p.pin, netTarget: p.netTarget, backdoor: p.backdoor, key: p.key, honeypotHost: p.honeypotHost, honeypot: p.honeypot } })`);

  // B tries things out of order and makes mistakes.
  await B.cmd('crack 1234');
  await waitTerm(B, 'access denied');
  await B.cmd(`login ${P.target} ${P.oldPass}`);
  await waitTerm(B, 'EXPIRED');
  check('race: old password is rejected', true);

  await A.cmd(`grep ${P.target} /var/log`);
  await waitTerm(A, `changed to '${P.pass}'`);
  await A.cmd(`login ${P.target} ${P.pass}`);
  await waitTerm(A, 'LAYER 2/5');
  await A.cmd('cat note.txt');
  const method = P.cipherType === 'caesar' ? `caesar ${P.shift}` : P.cipherType;
  await A.cmd(`decrypt vault.enc ${method}`);
  await waitTerm(A, 'LAYER 3/5');
  // Wrong guesses give feedback, then the right PIN.
  const wrong = P.pin.split('').reverse().join('');
  await A.cmd(`crack ${wrong}`);
  await waitTerm(A, 'right spot');
  await A.cmd(`crack ${P.pin}`);
  await waitTerm(A, 'LAYER 4/5');
  await A.cmd(`nmap ${P.netTarget}`);
  await waitTerm(A, String(P.backdoor));
  await A.shot('03-race.png');
  await A.cmd(`connect ${P.netTarget} ${P.backdoor}`);
  await waitTerm(A, 'LAYER 5/5');
  await A.cmd('notes');
  await A.cmd(`sudo ${P.key.toLowerCase()}`);
  await waitTerm(A, 'ROOT ACCESS GRANTED');
  await backToLobby().catch(async (e) => { await A.shot('race-fail.png'); throw e; });
  check('race: solved all 5 layers and won', true);
});

await step('race results', async () => {
  // (results were shown before going back; check the stored round data instead)
  const r = await B.room();
  check('race: everyone returned to lobby', r.status === 'lobby');
});

// ---------------------------------------------------------------------------
await step('duel', async () => {
  await A.click('.mode-card:nth-child(2)');
  await B.waitFor(`window.__ra.state.room.mode === 'duel'`);
  await readyAndStart();
  await A.shot('04-duel.png');
  let done = false;
  for (let i = 0; i < 200 && !done; i++) {
    for (const t of [A, B, C]) {
      const st = await t.screen();
      if (st === 'results') { done = true; break; }
      const out = await t.eval(`window.__ra.state.room.players[window.__ra.state.net.uid]?.s?.out || false`);
      if (out) continue;
      const snip = await t.eval(`document.querySelector('.snippet')?.textContent || ''`);
      if (snip) await t.cmd(i % 9 === 4 ? snip + 'x' : snip);
    }
    await sleep(60);
  }
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'results'`, 15000, 'duel results');
  const winners = await Promise.all([A, B, C].map((t) => t.eval(`document.querySelector('#resultsList li .pname').textContent.replace(' (you)', '')`)));
  await B.shot('05-duel-results.png');
  check('duel: played to the end, same winner everywhere', new Set(winners).size === 1, `winner=${winners[0]}`);
  await A.click('#againBtn');
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'lobby'`);
});

// ---------------------------------------------------------------------------
await step('defend', async () => {
  await A.click('.mode-card:nth-child(3)');
  await B.waitFor(`window.__ra.state.room.mode === 'defend'`);
  await readyAndStart();
  await A.cmd('status');
  await waitTerm(A, 'score: 360');
  await A.cmd('scan bob');
  await waitTerm(A, 'firewall 3');
  await A.cmd('breach bob web');
  await waitTerm(A, 'started on bob/web');
  await waitTerm(B, 'INCOMING');
  check('defend: breach raises an INCOMING alert on the victim', true);
  const tagId = await B.eval(`Object.values(window.__ra.state.room.actions).find(a => a.type === 'breach' && a.to === window.__ra.state.net.uid).tag`);
  await B.cmd('trace');
  await waitTerm(B, '#' + tagId);
  await B.cmd(`kill ${tagId}`);
  await waitTerm(B, `killed #${tagId}`);
  await waitTerm(A, 'traced and killed');
  check('defend: trace + kill stops the attack and tells the attacker', true);
  // Carol breaches alice's mail (fw 1) and lets it finish → fw 0.
  await C.cmd('breach alice mail');
  await A.waitFor(`window.__ra.state.room.players[window.__ra.state.net.uid].s.nodes.mail.fw === 0`, 15000, 'mail firewall drops');
  await waitTerm(C, 'firewall down to 0');
  await A.shot('06-defend.png');
  check('defend: unstopped breach weakens the firewall', true);
  // Not enough CPU after spending.
  for (let i = 0; i < 6 && !(await C.termText()).includes('not enough CPU'); i++) {
    await C.cmd(['patch web', 'patch db', 'patch mail'][i % 3]);
    await sleep(1700);
  }
  await waitTerm(C, 'not enough CPU');
  check('defend: CPU limits actions', true);
  // Host ends the round early.
  await A.eval(`window.confirm = () => true`);
  await A.click('#gameAbort');
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'lobby'`);
  check('defend: host can end the round', true);
});

// ---------------------------------------------------------------------------
await step('heist', async () => {
  await A.click('.mode-card:nth-child(4)');
  await B.waitFor(`window.__ra.state.room.mode === 'heist'`);
  await readyAndStart();
  const tabs = { A, B, C };
  const roles = {};
  for (const [k, t] of Object.entries(tabs)) roles[await t.eval(`window.__ra.state.room.players[window.__ra.state.net.uid].s.role`)] = t;
  check('heist: roles assigned', !!roles.infiltrator && !!roles.analyst && !!roles.lookout, Object.keys(roles).join(','));
  const H = await A.eval(`import('./src/modes/heist.js').then(m => { const p = m.buildHeist(window.__ra.state.room.seed); return { doorCode: p.doorCode, password: p.password, nightCount: p.nightCount, word: p.word, model: p.model } })`);
  const I = roles.infiltrator, N = roles.analyst, L = roles.lookout;

  // Infiltrator can't read files; analyst can.
  await I.cmd('cat /manuals/keypads.txt');
  await waitTerm(I, 'command not found');
  await N.cmd('cat manuals/keypads.txt');
  await waitTerm(N, `MODEL ${H.model}`);
  await I.cmd('inspect door');
  await waitTerm(I, 'Keypad model');
  await I.shot('07-heist-infiltrator.png');
  await N.shot('08-heist-analyst.png');

  const alarmBefore = await A.eval(`window.__ra.state.room.game.alarm`);
  await I.cmd('enter 0000');
  await waitTerm(I, 'Wrong code');
  await A.waitFor(`window.__ra.state.room.game.alarm >= ${alarmBefore + 10}`, 5000, 'alarm rises after mistake');
  check('heist: a mistake raises the alarm', true);

  // Lookout loops a camera.
  await waitTerm(L, 'GUARD', 15000);
  const loopCode = await L.eval(`document.querySelector('#stage code')?.textContent.split(' ')[1]`);
  const alarmPre = await A.eval(`window.__ra.state.room.game.alarm`);
  await L.cmd(`loop ${loopCode}`);
  await waitTerm(L, 'looped');
  await A.waitFor(`window.__ra.state.room.game.alarm < ${alarmPre}`, 5000, 'alarm drops after loop');
  await L.shot('09-heist-lookout.png');
  check('heist: lookout lowers the alarm', true);

  await N.eval(`(() => { const f = document.querySelector('#gameChat .chat-form'); f.querySelector('input').value = 'code is ${H.doorCode}'; f.requestSubmit(); })()`);
  await I.waitFor(`document.querySelector('#gameChat .chat-log').innerText.includes('code is ${H.doorCode}')`);
  await I.cmd(`enter ${H.doorCode}`);
  await I.waitFor(`window.__ra.state.room.game.stage === 1`, 5000, 'stage 1');
  await I.cmd('inspect terminal');
  await waitTerm(I, 'Password hint');
  await I.cmd(`login ${H.password}`);
  await I.waitFor(`window.__ra.state.room.game.stage === 2`, 5000, 'stage 2');
  await I.cmd(`dial ${H.nightCount}`);
  await waitTerm(I, H.word);
  await I.cmd(`open ${H.word.toLowerCase()}`);
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'results'`, 8000, 'heist results');
  const summary = await B.eval(`document.getElementById('resultsSummary').innerText`);
  await B.shot('10-heist-results.png');
  check('heist: crew cracks the vault together', summary.includes('HEIST COMPLETE'), summary);
  await A.click('#againBtn');
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'lobby'`);
});

// ---------------------------------------------------------------------------
await step('host leaves mid-heist', async () => {
  // Alice is host AND infiltrator. She leaves in the middle of a heist.
  await readyAndStart();
  const myRole = `window.__ra.state.room.players[window.__ra.state.net.uid].s.role`;
  check('host leaves: alice starts as infiltrator', (await A.eval(myRole)) === 'infiltrator');
  const hostBefore = (await B.room()).hostId;
  await A.close();
  await B.waitFor(`Object.keys(window.__ra.state.room.players).length === 2`, 15000, 'alice removed');
  await B.waitFor(`window.__ra.state.room.hostId === window.__ra.state.net.uid`, 5000, 'bob becomes host');
  check('host leaves: player removed and next player becomes host', hostBefore !== (await B.room()).hostId);
  check('host leaves: game keeps going', (await B.room()).status === 'playing');
  // Carol (lookout) takes over as infiltrator; Bob (analyst) picks up lookout duty.
  await C.waitFor(`${myRole} === 'infiltrator'`, 5000, 'carol becomes infiltrator');
  await waitTerm(C, 'CREW CHANGE');
  await C.cmd('inspect door');
  await waitTerm(C, 'Keypad model');
  await waitTerm(B, 'lookout duty');
  await B.cmd('cams');
  await waitTerm(B, 'CAM 6');
  await C.shot('10b-heist-role-change.png');
  check('host leaves: roles are reassigned so the heist can continue', true);
  await B.eval(`window.confirm = () => true`);
  await B.click('#gameAbort');
  for (const t of [B, C]) await t.waitFor(`document.body.dataset.screen === 'lobby'`);
  await B.waitFor(`!!document.getElementById('startBtn')`);
});

await step('solo survivor', async () => {
  // Hack & Defend ends when only one player is left.
  await B.click('.mode-card:nth-child(3)');
  await C.waitFor(`window.__ra.state.room.mode === 'defend'`);
  await C.click('#readyBtn');
  await B.waitFor(`!document.getElementById('startBtn').disabled`);
  await B.click('#startBtn');
  await C.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('countdown').hidden`, 8000);
  await C.eval(`window.confirm = () => true`);
  await C.click('#gameLeave');
  await B.waitFor(`document.body.dataset.screen === 'results'`, 10000, 'results after everyone else left');
  const summary = await B.eval(`document.getElementById('resultsSummary').innerText`);
  check('solo survivor: game ends when everyone else leaves', summary.includes('wins by default'), summary);
});

// ---------------------------------------------------------------------------
const D = await openTab('D');
await step('practice', async () => {
  await D.goto(URL_BASE);
  await D.click('#practiceBtn');
  await D.waitFor(`document.body.dataset.screen === 'lobby'`);
  const n = await D.eval(`Object.keys(window.__ra.state.room.players).length`);
  await D.click('.mode-card:nth-child(2)');
  await D.waitFor(`window.__ra.state.room.mode === 'duel'`);
  await D.click('#startBtn');
  await D.waitFor(`document.getElementById('countdown').hidden && document.body.dataset.screen === 'game'`, 8000);
  await D.waitFor(`(window.__ra.state.room.players[window.__ra.state.net.uid].s.hp ?? 100) < 100`, 30000, 'bots attack');
  check('practice: bots play duel against you', n === 3);
  await D.shot('11-practice-duel.png');
});

// ---------------------------------------------------------------------------
await step('pwa', async () => {
  const sw = await D.eval(`navigator.serviceWorker.ready.then(r => !!r.active)`);
  check('pwa: service worker active', sw === true);
  await sleep(500);
  const cached = await D.eval(`caches.open('root-access-v1').then(c => c.keys()).then(k => k.length)`);
  check('pwa: all files cached', cached >= 26, `(${cached})`);
  const inst = await D.send('Page.getInstallabilityErrors');
  const errs = inst.result?.installabilityErrors ?? [];
  check('pwa: installable', errs.length === 0, JSON.stringify(errs));
  await D.send('Network.enable');
  await D.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await D.goto(URL_BASE);
  const status = await D.eval(`document.getElementById('netStatus').innerText`);
  await D.click('#practiceBtn');
  await D.waitFor(`document.body.dataset.screen === 'lobby'`);
  check('pwa: loads and practice works offline', true, status);
  await D.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

// ---------------------------------------------------------------------------
await step('small screen', async () => {
  await B.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false });
  await B.shot('12-small-lobby.png');
  const overflow = await B.eval(`document.documentElement.scrollWidth > window.innerWidth`);
  check('small screen: no sideways scrolling', !overflow);
});

const allErrors = [A, B, C, D].flatMap((t) => t.errors.map((e) => `[${t.name}] ${e}`))
  .filter((e) => !e.includes('net::ERR_INTERNET_DISCONNECTED') && !e.includes('Failed to fetch'));
check('no page errors', allErrors.length === 0, allErrors.join('\n'));

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed. Screenshots: ${OUT}`);
chrome.kill();
process.exit(results.every((r) => r.ok) ? 0 : 1);
