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

const URL_BASE = process.env.URL || 'http://localhost:8765/?local=1'; // ?local=1: never touch the real online database
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
    // Press a real key (modifiers: 2 = Ctrl).
    async press(key, code, vk, modifiers = 0) {
      await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
    },
    focused: () => tab.eval('document.activeElement?.closest(".chat") ? "chat" : document.activeElement?.closest("#term") ? "term" : (document.activeElement?.tagName || "none")'),
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

// ONLY=owner,login runs just the steps whose names contain those words
// (only for steps that don't depend on earlier ones).
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
async function step(name, fn) {
  if (ONLY && !ONLY.some((o) => name.includes(o))) return;
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
  check('boot intro: plays on the first visit', (await A.eval(`localStorage.getItem('ra-booted')`)) === 'true');
  await A.waitFor(`document.getElementById('boot').hidden`, 6000, 'boot intro finishes');
  await sleep(1200);
  // The rain canvas is visible and has drawn something (not just black).
  const rainLit = await A.eval(`(() => {
    const c = document.getElementById('matrixBg');
    if (c.hidden || !window.__ra.rain.running) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 1; i < d.length; i += 4 * 97) if (d[i] > 60) return true;
    return false;
  })()`);
  check('matrix rain: background is animating behind the menu', rainLit);
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

await step('kick', async () => {
  const E = await openTab('E');
  await E.goto(URL_BASE);
  await E.eval(`document.getElementById('nameInput').value = 'mallory'`);
  await E.eval(`document.getElementById('codeInput').value = '${code}'`);
  await E.click('#joinBtn');
  await A.waitFor(`Object.keys(window.__ra.state.room.players).length === 4`, 5000, 'mallory joined');
  await A.eval(`window.confirm = () => true`);
  const id = await E.eval('window.__ra.state.net.uid');
  await A.click(`#lobbyPlayers li:nth-child(4) .kick`);
  await E.waitFor(`document.body.dataset.screen === 'menu'`, 5000, 'mallory sent to menu');
  const msg = await E.eval(`document.getElementById('menuMsg').innerText`);
  await E.click('#joinBtn');
  await E.waitFor(`document.getElementById('menuMsg').innerText.includes('removed you from that room')`, 5000, 'rejoin blocked');
  check('kick: host removes a player, who is told and cannot rejoin', msg.includes('removed you') && !(await A.room()).players[id], msg);
  await E.close();
  await A.waitFor(`Object.keys(window.__ra.state.room.players).length === 3`);
});

await step('reload keeps your seat', async () => {
  const uid = await B.eval('window.__ra.state.net.uid');
  await B.goto(URL_BASE);
  await B.waitFor(`document.body.dataset.screen === 'lobby'`, 8000, 'bob back in the lobby');
  const room = await B.room();
  check('reload keeps your seat: same player, same room, nobody duplicated',
    (await B.eval('window.__ra.state.net.uid')) === uid && room.players[uid]?.name === 'bob' && Object.keys(room.players).length === 3);
  // Leaving on purpose forgets the seat, so a reload goes to the menu.
  await C.eval(`document.getElementById('leaveBtn').click()`);
  await C.waitFor(`document.body.dataset.screen === 'menu'`);
  await C.goto(URL_BASE);
  await sleep(800);
  check('reload after leaving goes to the menu', (await C.screen()) === 'menu');
  await C.eval(`document.getElementById('codeInput').value = '${code}'`);
  await C.click('#joinBtn');
  await C.waitFor(`document.body.dataset.screen === 'lobby'`);
  await A.waitFor(`Object.keys(window.__ra.state.room.players).length === 3`);
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
  await B.cmd('hint');
  await waitTerm(B, 'hint 1/3');
  await B.cmd('hint');
  await waitTerm(B, 'hint 2/3');
  await waitTerm(B, 'costs 10 seconds');
  check('race: asking again gives a more specific hint that costs time', true);

  await A.cmd('cat mission.txt');
  await waitTerm(A, 'CURRENT password');
  await A.cmd(`grep ${P.pass} /`);
  await waitTerm(A, P.pass);
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
  await B.waitFor(`document.body.dataset.screen === 'results'`, 10000, 'race results');
  const raceResults = await B.eval(`document.getElementById('resultsList').innerText`);
  await sleep(1500); // let the podium and rows finish animating
  await B.shot('03b-race-results.png');
  check('race results: show fastest layer and hints used', raceResults.includes('fastest layer') && raceResults.includes('2 hints'), raceResults.replace(/\n/g, ' | '));
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

  // Power-ups: Bob hits Alice, Alice repairs, then shields and blocks a hit.
  const snip = (t) => t.eval(`document.querySelector('.snippet').textContent`);
  const aliceHp = () => A.eval(`window.__ra.state.room.players[window.__ra.state.net.uid].s.hp`);
  for (let i = 0; i < 2; i++) { await B.cmd(await snip(B)); await sleep(150); }
  await A.waitFor(`window.__ra.state.room.players[window.__ra.state.net.uid].s.hp < 100`, 5000, 'alice damaged');
  const hurt = await aliceHp();
  await A.eval(`window.__ra.duel.force('repair')`);
  check('duel power-up: bonus snippet is labeled', (await A.eval(`document.querySelector('.bonus-label').textContent`)).includes('REPAIR'));
  await A.shot('04b-duel-bonus.png');
  await A.cmd(await snip(A));
  await A.waitFor(`window.__ra.state.room.players[window.__ra.state.net.uid].s.hp === ${Math.min(100, hurt + 15)}`, 5000, 'repair applied');
  check('duel power-up: REPAIR restores 15 HP', true, `${hurt} → ${await aliceHp()}`);
  await A.eval(`window.__ra.duel.force('shield')`);
  await A.cmd(await snip(A));
  await waitTerm(A, 'SHIELD UP');
  const shieldedHp = await aliceHp();
  await B.cmd(await snip(B));
  await waitTerm(A, 'shield absorbed');
  check('duel power-up: SHIELD blocks a hit', (await aliceHp()) === shieldedHp);
  await sleep(8200); // let the shield wear off before the free-for-all

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
  if (process.env.DEBUG_DUEL) {
    for (const t of [A, B, C]) {
      const players = Object.values((await t.room()).players).map((p) => [p.name, p.s?.hp, p.s?.out]);
      console.log(t.name, await t.screen(), JSON.stringify(players), (await t.termText()).split('\n').slice(-4).join(' | '));
    }
  }
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'results'`, 15000, 'duel results');
  const duelResults = await B.eval(`document.getElementById('resultsList').innerText`);
  check('duel results: show WPM and accuracy', /\d+ WPM · \d+% accuracy/.test(duelResults), duelResults.replace(/\n/g, ' | '));
  const winners = await Promise.all([A, B, C].map((t) => t.eval(`document.querySelector('#resultsList li .pname').textContent.replace(' (you)', '')`)));
  await sleep(1500);
  await B.shot('05-duel-results.png');
  check('duel: played to the end, same winner everywhere', new Set(winners).size === 1, `winner=${winners[0]}`);
  await A.click('#againBtn');
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'lobby'`);
});

// ---------------------------------------------------------------------------
await step('defend', async () => {
  await A.click('.mode-card:nth-child(3)');
  await B.waitFor(`window.__ra.state.room.mode === 'defend'`);
  await A.click('[data-length="short"]');
  await B.waitFor(`window.__ra.state.room.roundLength === 'short' && document.querySelector('[data-length].selected').dataset.length === 'short'`, 5000, 'short round selected');
  await A.shot('05b-lobby-round-length.png');
  await readyAndStart();
  const timer = await A.eval(`document.getElementById('gameTimer').textContent`);
  check('round length: short makes Hack & Defend 3 minutes', /^(3:00|2:5d)$/.test(timer), timer);
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
  const H = await A.eval(`import('./src/modes/heist.js').then(m => { const p = m.buildHeist(window.__ra.state.room.seed); return { doorCode: p.doorCode, password: p.password, dial: p.dial, word: p.word, model: p.model } })`);
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
  await I.cmd(`dial ${H.dial}`);
  await waitTerm(I, H.word);
  await I.cmd(`open ${H.word.toLowerCase()}`);
  for (const t of [A, B, C]) await t.waitFor(`document.body.dataset.screen === 'results'`, 8000, 'heist results');
  const summary = await B.eval(`document.getElementById('resultsSummary').innerText`);
  await sleep(1500);
  await B.shot('10-heist-results.png');
  const heistResults = await B.eval(`document.getElementById('resultsList').innerText`);
  check('heist results: show mistakes and camera loops', heistResults.includes('1 mistake ·') && heistResults.includes('1 camera looped'), heistResults.replace(/\n/g, ' | '));
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
await step('tutorial', async () => {
  await D.goto(URL_BASE);
  check('tutorial: menu points first-timers to it', !(await D.eval(`document.getElementById('tutorialBadge').hidden`)));
  await D.click('#tutorialBtn');
  await D.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('countdown').hidden`, 8000, 'tutorial started');
  const T = await D.eval(`import('./src/modes/tutorial.js').then(m => m.buildTutorial(window.__ra.state.room.seed).code)`);
  const cmds = ['help', 'ls', 'cat start-here.txt', 'cd docs', 'ls', 'cat welcome.txt', 'cd ..', 'grep secret', `unlock ${T}`, `unlock ${T}`, 'say hello'];
  for (const c of cmds) { await D.cmd(c); await sleep(120); }
  await waitTerm(D, 'STEP 10/10');
  await D.shot('11-tutorial.png');
  await D.waitFor(`document.body.dataset.screen === 'results'`, 8000, 'tutorial results');
  const summary = await D.eval(`document.getElementById('resultsSummary').innerText`);
  await D.click('#resultsActions button:last-child');
  await D.waitFor(`document.body.dataset.screen === 'menu'`);
  check('tutorial: completes and is remembered', summary.includes('TUTORIAL COMPLETE') && (await D.eval(`document.getElementById('tutorialBadge').hidden`)), summary);
});
await step('practice', async () => {
  await D.goto(URL_BASE);
  await D.click('#practiceBtn');
  await D.waitFor(`document.body.dataset.screen === 'lobby'`);
  const n = await D.eval(`Object.keys(window.__ra.state.room.players).length`);
  const pColors = Object.values((await D.room()).players).map((p) => p.color);
  check('practice: bots never share your color', new Set(pColors).size === pColors.length, pColors.join(' '));
  check('practice: bots start on easy', (await D.eval(`window.__ra.state.room.botLevel`)) === 'easy');
  await D.click('[data-level="hard"]');
  await D.waitFor(`window.__ra.state.room.botLevel === 'hard' && document.querySelector('[data-level].selected').dataset.level === 'hard'`, 5000, 'hard selected');
  await D.shot('11a-practice-lobby.png');
  check('practice: host can switch bots to hard', true);
  check('practice: heist (humans only) is disabled', await D.eval(`document.querySelector('.mode-card:nth-child(4)').disabled`));
  await D.click('.mode-card:nth-child(2)');
  await D.waitFor(`window.__ra.state.room.mode === 'duel'`);
  await D.click('#startBtn');
  await D.waitFor(`document.getElementById('countdown').hidden && document.body.dataset.screen === 'game'`, 8000);
  const played = await D.eval('({ ...window.__ra.sfx.played })');
  check('sound: countdown beeps then a "go" sound', (played.tick || 0) >= 2 && played.go >= 1, JSON.stringify(played));
  await D.waitFor(`(window.__ra.state.room.players[window.__ra.state.net.uid].s.hp ?? 100) < 100`, 30000, 'bots attack');
  check('practice: bots play duel against you', n === 3);
  await D.shot('11-practice-duel.png');
});

// ---------------------------------------------------------------------------
await step('keyboard', async () => {
  // D is still in a practice duel.
  await D.eval(`document.querySelector('#term input').focus()`);
  await D.press('Escape', 'Escape', 27);
  const inChat = (await D.focused()) === 'chat';
  await D.press('Escape', 'Escape', 27);
  check('keyboard: Esc jumps to chat and back', inChat && (await D.focused()) === 'term');
  await D.eval(`(() => { const i = document.querySelector('#term input'); i.value = 'half typed'; })()`);
  await D.press('c', 'KeyC', 67, 2);
  check('keyboard: Ctrl+C cancels the line', (await D.eval(`document.querySelector('#term input').value`)) === '');
  await D.press('l', 'KeyL', 76, 2);
  check('keyboard: Ctrl+L clears the screen', (await D.eval(`document.querySelector('#term .term-out').childElementCount`)) === 0);
  await D.shot('11c-keys-hint.png');
  // Turn on key click sounds in settings, then type.
  await D.click('#settingsBtn');
  await D.click('#settingsDialog input[name=keyClicks]');
  await D.shot('13b-settings-sound.png');
  await D.click('#settingsClose');
  await D.eval(`document.querySelector('#term input').focus()`);
  const before = await D.eval('window.__ra.sfx.played.key || 0');
  await D.press('a', 'KeyA', 65);
  await D.press('b', 'KeyB', 66);
  check('sound: key clicks play when turned on', (await D.eval('window.__ra.sfx.played.key || 0')) >= before + 2);
  await D.eval(`localStorage.removeItem('ra-settings')`);
});

// ---------------------------------------------------------------------------
await step('pwa', async () => {
  const sw = await D.eval(`navigator.serviceWorker.ready.then(r => !!r.active)`);
  check('pwa: service worker active', sw === true);
  await sleep(500);
  const cached = await D.eval(`caches.keys().then((ks) => caches.open(ks.find((k) => k.startsWith('root-access')))).then(c => c.keys()).then(k => k.length)`);
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
  const fontOk = await D.eval(`document.fonts.ready.then(() => document.fonts.check('15px "JetBrains Mono"'))`);
  check('pwa: style fonts load offline (from the cache)', fontOk === true);
  await D.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

// ---------------------------------------------------------------------------
await step('settings', async () => {
  await D.goto(URL_BASE);
  check('settings: scanlines on by default', !(await D.eval(`document.documentElement.classList.contains('no-scanlines')`)));
  await D.click('#settingsBtn');
  await D.waitFor(`document.getElementById('settingsDialog').open`);
  await D.click('#settingsDialog input[name=scanlines]');
  await D.click('#settingsDialog input[value=xlarge]');
  await D.click('#settingsDialog input[name=highContrast]');
  await D.shot('13-settings.png');
  await D.click('#settingsClose');
  await D.goto(URL_BASE);
  const cls = await D.eval('document.documentElement.className');
  await D.shot('14-menu-xlarge.png');
  check('settings: changes apply and survive a reload', /no-scanlines/.test(cls) && /text-xlarge/.test(cls) && /high-contrast/.test(cls), cls);
  const overflow = await D.eval(`document.documentElement.scrollWidth > window.innerWidth`);
  check('settings: extra-large text has no sideways scrolling', !overflow);
  await D.click('#settingsBtn');
  await D.click('#settingsDialog input[name=reduceMotion]');
  await D.click('#settingsClose');
  const still = await D.eval(`getComputedStyle(document.querySelector('.logo-text'), '::before').animationName === 'none' && !window.__ra.rain.running`);
  check('settings: reduce motion stops animations and the rain', still);
  await D.eval(`localStorage.removeItem('ra-settings')`);
});

// ---------------------------------------------------------------------------
await step('quick hacks', async () => {
  // Fresh practice room. Each quick-hack mode: play part of stage 1 with real
  // keys, check a mistake locks you out, then clear the rest and see results.
  const backToMenu = async () => {
    await D.eval('window.confirm = () => true');
    const screen = await D.screen();
    if (screen === 'lobby') await D.click('#leaveBtn');
    if (screen === 'game') await D.click('#gameLeave');
    if (screen === 'results') await D.click('#resultsActions button:last-child');
    await D.waitFor(`document.body.dataset.screen === 'menu'`, 5000, 'back to menu');
  };
  const KEYS = { ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], ' ': ['Space', 32], Enter: ['Enter', 13], e: ['KeyE', 69], q: ['KeyQ', 81] };
  const key = (k) => D.press(k, KEYS[k][0], KEYS[k][1]);
  const ids = ['letterlock', 'printmatch', 'signaltune', 'circuit', 'memory', 'wirecut', 'portsweep', 'bitflip', 'gauntlet'];
  await backToMenu();
  await D.click('#practiceBtn');
  await D.waitFor(`document.body.dataset.screen === 'lobby'`);
  check('quick hacks: lobby shows a QUICK HACKS group with 9 modes',
    (await D.eval(`document.querySelector('.mode-group')?.innerText || ''`)).includes('QUICK HACKS') && (await D.eval(`document.querySelectorAll('.mode-card').length`)) === 13);
  await D.shot('30-quick-lobby.png');
  for (const [i, id] of ids.entries()) {
    if (i) {
      await D.click('#resultsActions button:first-child'); // back to the lobby
      await D.waitFor(`document.body.dataset.screen === 'lobby'`, 5000, 'lobby again');
    }
    await D.click(`.mode-card[data-mode=${id}]`);
    await D.waitFor(`window.__ra.state.room.mode === '${id}'`);
    await D.click('#startBtn');
    await D.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('countdown').hidden && !!window.__ra.quick?.data()`, 8000, `${id} starts`);
    await sleep(300);
    // Background tabs animate at a few frames a second; timing games need the front.
    await D.send('Page.bringToFront');
    // Frames per second right now (helps explain a failed timing check).
    const fps = await D.eval('new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 500) requestAnimationFrame(f); else r(n * 2); }; requestAnimationFrame(f); })');
    const focused = await D.eval(`document.activeElement?.classList.contains('quick-box')`);
    const data = await D.eval('window.__ra.quick.data()');
    let played = false;
    if (id === 'circuit') {
      // Walk the whole maze with arrow keys.
      const path = await D.eval(`import('./src/modes/minigames/circuit.js').then((m) => m.solvePath(window.__ra.quick.data()).map((d) => m.DIR_KEY[d]))`);
      for (const k of path) await key(k);
      played = await D.waitFor('window.__ra.quick.stage() === 1', 3000, 'maze solved').catch(() => false);
    } else if (id === 'signaltune') {
      const d = data;
      const turns = d.target.freq - d.start.freq;
      for (let n = 0; n < Math.abs(turns); n++) await key(turns > 0 ? 'ArrowRight' : 'ArrowLeft');
      await key('Enter');
      played = await D.waitFor('window.__ra.quick.stage() === 1', 3000, 'wave tuned').catch(() => false);
    } else if (id === 'memory') {
      await D.waitFor(`document.querySelector('.mm-status').innerText.includes('YOUR TURN')`, 12000, 'code shown');
      // One cell per column: move down from the top row to the code's row, then Space.
      for (const r of data.answer) {
        for (let y = 0; y < r; y++) await key('ArrowDown');
        await key(' ');
      }
      played = await D.waitFor('window.__ra.quick.stage() === 1', 3000, 'sequence repeated').catch(() => false);
    } else if (id === 'wirecut') {
      for (const w of data.order) await D.press(String(w + 1), `Digit${w + 1}`, 49 + w);
      played = await D.waitFor('window.__ra.quick.stage() === 1', 3000, 'wires cut').catch(() => false);
    } else if (id === 'portsweep') {
      const end = Date.now() + 25000;
      while ((await D.eval('window.__ra.quick.stage()')) === 0 && Date.now() < end) {
        const open = await D.eval(`[...document.querySelectorAll('.ps-port')].findIndex((c) => c.classList.contains('open'))`);
        if (open >= 0) { await D.press(String(open + 1), `Digit${open + 1}`, 49 + open); await sleep(60); } else await sleep(40);
      }
      played = (await D.eval('window.__ra.quick.stage()')) === 1;
    } else if (id === 'bitflip') {
      for (const [b, v] of data.values.entries()) if (data.target & v) await D.press(String(b + 1), `Digit${b + 1}`, 49 + b);
      await key('Enter');
      played = await D.waitFor('window.__ra.quick.stage() === 1', 3000, 'bits flipped').catch(() => false);
    } else if (id === 'gauntlet') {
      const seen = new Set();
      for (let st = 0; st < 5; st++) { seen.add(await D.eval('window.__ra.quick.puzzle()')); if (st < 4) { await D.eval('window.__ra.quick.solve()'); await sleep(150); } }
      check('quick hacks: gauntlet runs 5 different mini-games', seen.size === 5, [...seen].join(','));
      played = true;
    } else if (id === 'printmatch') {
      for (const [j, o] of data.options.entries()) if (o.real) await D.click(`.pm-option:nth-child(${j + 1})`);
      await key('Enter');
      played = await D.waitFor('window.__ra.quick.stage() === 1', 3000, 'print matched').catch(() => false);
    } else {
      // Letter Lock: press Space when the right letter reaches the middle row.
      // The page watches every frame for the letter (polling from here can
      // miss it on a busy machine), and each lock is confirmed before moving on.
      const end = Date.now() + 30000;
      let locked = 0;
      while (locked < data.password.length && Date.now() < end) {
        const seen = await D.eval(`new Promise((r) => { const t = performance.now(); const f = () => { const c = document.querySelector('.ll-col.active span.mid'); if (c && c.textContent === ${JSON.stringify(data.password)}[${locked}]) r(true); else if (performance.now() - t > 4000) r(false); else requestAnimationFrame(f); }; f(); })`);
        if (!seen) continue;
        await key(' ');
        await sleep(100);
        locked = await D.eval(`document.querySelectorAll('.ll-col.locked').length + (window.__ra.quick.stage() > 0 ? 99 : 0)`);
        if (!(await D.eval('window.__ra.quick.locked()'))) continue;
        await D.waitFor('!window.__ra.quick.locked()', 5000, 'lockout ends'); // a miss: wait out the lockout and retry
      }
      played = await D.waitFor('window.__ra.quick.stage() === 1', 3000, 'password locked').catch(() => false);
    }
    check(`quick hacks: ${id} has keyboard focus and stage 1 is playable with real keys`, focused && played === true, `focused=${focused} played=${played} fps=${fps} active=${await D.eval("document.activeElement?.className || document.activeElement?.tagName")} stage=${await D.eval('window.__ra.quick.stage()')} mistakes=${(await D.room()).players[await D.eval('window.__ra.state.net.uid')].s.mistakes}`);
    await D.shot(`31-quick-${id}.png`);
    if (id === 'signaltune') {
      // Stage 2 starts off target, so Enter right away is a mistake.
      await key('Enter');
      check('quick hacks: a mistake locks you out', await D.waitFor('window.__ra.quick.locked() && !document.querySelector(".qh-lock").hidden', 2000).catch(() => false));
      await D.shot('32-quick-lockout.png');
    }
    for (let st = (await D.eval('window.__ra.quick.stage()')); st < 5; st++) await D.eval('window.__ra.quick.solve()');
    await D.waitFor(`document.body.dataset.screen === 'results'`, 8000, `${id} results`);
    const summary = await D.eval(`document.getElementById('resultsSummary').innerText`);
    const stats = await D.eval(`document.querySelector('#resultsList .stats')?.innerText || ''`);
    check(`quick hacks: ${id} ends when you clear all 5 stages`, summary.includes('all 5 stages') && stats.includes('5/5 stages'), `${summary} | ${stats}`);
  }
  await D.shot('33-quick-results.png');
  await backToMenu();
});

// ---------------------------------------------------------------------------
await step('team duel', async () => {
  await D.eval('window.confirm = () => true');
  if ((await D.screen()) !== 'menu') {
    if ((await D.screen()) === 'results') await D.click('#resultsActions button:last-child');
    else await D.click((await D.screen()) === 'game' ? '#gameLeave' : '#leaveBtn');
    await D.waitFor(`document.body.dataset.screen === 'menu'`, 5000);
  }
  await D.click('#practiceBtn');
  await D.waitFor(`document.body.dataset.screen === 'lobby'`);
  await D.click('.mode-card[data-mode=duel]');
  await D.waitFor(`window.__ra.state.room.mode === 'duel'`);
  await D.click('[data-teams="2"]');
  await D.waitFor(`window.__ra.state.room.teamSize === 2`);
  check('team duel: 2v2 with 3 players cannot start', await D.eval(`document.getElementById('startBtn').disabled`));
  await D.click('#fillBtn');
  await D.waitFor(`Object.keys(window.__ra.state.room.players).length === 4 && !document.getElementById('startBtn').disabled`, 5000, 'teams filled');
  await D.shot('40-team-lobby.png');
  await D.click('#startBtn');
  await D.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('countdown').hidden`, 8000);
  const me = await D.eval('window.__ra.state.net.uid');
  let friendly = 0;
  for (let i = 0; i < 80 && (await D.screen()) === 'game'; i++) {
    const r = await D.room();
    const tgt = await D.eval(`document.querySelector('.duel-meta strong')?.innerText || ''`);
    const t = Object.values(r.players).find((x) => x.name === tgt);
    if (t && t.s.team === r.players[me].s.team) friendly++;
    if (r.players[me].s.out) break;
    await D.cmd(await D.eval(`document.querySelector('.snippet').innerText`));
    await sleep(120);
  }
  check('team duel: you never target a teammate', friendly === 0, `${friendly}`);
  await D.shot('41-team-duel.png');
  await D.waitFor(`document.body.dataset.screen === 'results'`, 120000, 'team duel ends');
  const res = (await D.room()).results;
  const winners = res.filter((r) => r.won);
  check('team duel: a whole team wins together', winners.length === 2 && winners.every((r) => r.place === 1) && /Team [AB] wins/.test(await D.eval(`document.getElementById('resultsSummary').innerText`)), JSON.stringify(res.map((r) => [r.name, r.place, r.won])));
  await D.click('#resultsActions button:first-child');
  await D.waitFor(`document.body.dataset.screen === 'lobby'`);
  await D.click('[data-teams="0"]');
  await D.waitFor(`window.__ra.state.room.teamSize === 0`);
});

// ---------------------------------------------------------------------------
await step('daily challenge and xp', async () => {
  await D.eval('window.confirm = () => true');
  const screen = await D.screen();
  if (screen !== 'menu') {
    if (screen === 'results') await D.click('#resultsActions button:last-child');
    else await D.click(screen === 'game' ? '#gameLeave' : '#leaveBtn');
    await D.waitFor(`document.body.dataset.screen === 'menu'`, 5000);
  }
  const xp0 = await D.eval(`JSON.parse(localStorage.getItem('ra-progress') || '{"xp":0}').xp`);
  check('xp: earlier rounds earned XP, shown on the menu', xp0 > 0 && (await D.eval(`document.getElementById('levelXp').innerText`)).includes('XP'), `${xp0}`);
  await D.click('#dailyBtn');
  await D.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('countdown').hidden && !!window.__ra.quick?.data()`, 10000, 'daily starts');
  const r = await D.room();
  check('daily: solo gauntlet with the day\'s seed', r.mode === 'gauntlet' && Object.keys(r.players).length === 1 && r.seed === r.fixedSeed && !!r.daily);
  const first = await D.eval('window.__ra.quick.puzzle()');
  for (let st = 0; st < 5; st++) await D.eval('window.__ra.quick.solve()');
  await D.waitFor(`document.body.dataset.screen === 'results' && !document.getElementById('dailyList').innerText.includes('Loading')`, 8000, 'daily results');
  const board = await D.eval(`document.getElementById('dailyList').innerText`);
  const name = await D.eval(`window.__ra.state.room.players[window.__ra.state.net.uid].name`);
  check('daily: your run is on today\'s board', board.includes(name) && (await D.eval(`!document.getElementById('dailyResults').hidden`)), board.replace(/\s+/g, ' '));
  const xp1 = await D.eval(`JSON.parse(localStorage.getItem('ra-progress')).xp`);
  const gain = await D.eval(`document.getElementById('xpGain').innerText`);
  check('xp: a round awards XP once and shows it', xp1 > xp0 && /\+\d+ XP/.test(gain) && !gain.includes('null'), `${xp0} → ${xp1}: ${gain}`);
  await D.shot('50-daily-results.png');
  await D.click('#dailyAgainBtn');
  await D.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('countdown').hidden && !!window.__ra.quick?.data()`, 10000, 'daily retry');
  check('daily: Try again replays the same puzzles', (await D.eval('window.__ra.quick.puzzle()')) === first);
  await D.click('#gameLeave');
  await D.waitFor(`document.body.dataset.screen === 'menu'`, 5000);
  await D.click('#boardBtn');
  await D.waitFor(`document.getElementById('statsList').innerText.includes(${JSON.stringify(name)}) && !!document.querySelector('#statsList li.me')`, 5000, 'all-time board');
  const statsRow = await D.eval(`document.querySelector('#statsList li.me').innerText`);
  check('leaderboard: All-time shows your level, XP and wins', /LV\d+/.test(statsRow) && statsRow.includes(String(xp1 > 0 ? '' : '0')), statsRow.replace(/\s+/g, ' '));
  await D.shot('52-leaderboard.png');
  await D.click('#tabToday');
  await D.waitFor(`!document.getElementById('paneToday').hidden && document.getElementById('boardList').innerText.includes(${JSON.stringify(name)})`, 5000, 'today tab');
  await D.shot('51-board.png');
  await D.click('#boardClose');
  check('leaderboard: Today tab shows the daily board', true);
});

// ---------------------------------------------------------------------------
await step('styles', async () => {
  const toMenu = async () => {
    const screen = await D.screen();
    await D.eval('window.confirm = () => true');
    if (screen === 'lobby') await D.click('#leaveBtn');
    if (screen === 'game') await D.click('#gameLeave');
    await D.waitFor(`document.body.dataset.screen === 'menu'`, 5000, 'back to menu');
  };
  for (const style of ['green', 'cyber', 'amber']) {
    await D.goto(URL_BASE);
    await toMenu();
    await D.click('#settingsBtn');
    await D.click(`#settingsDialog input[value=${style}]`);
    if (style === 'cyber') await D.shot('19-settings-styles.png');
    await D.click('#settingsClose');
    await D.goto(URL_BASE);
    await toMenu();
    const applied = await D.eval('document.documentElement.dataset.style');
    const font = { green: 'JetBrains Mono', cyber: 'Orbitron', amber: 'VT323' }[style];
    const fontLoaded = await D.eval(`document.fonts.load('20px "${font}"').then(() => document.fonts.check('20px "${font}"'))`);
    check(`style ${style}: applied after a reload, with its font`, applied === style && fontLoaded === true, `${applied} / ${font}: ${fontLoaded}`);
    await sleep(1500);
    await D.shot(`20-${style}-menu.png`);
    await D.click('#practiceBtn');
    await D.waitFor(`document.body.dataset.screen === 'lobby'`);
    await D.click('.mode-card:nth-child(2)');
    await D.waitFor(`window.__ra.state.room.mode === 'duel'`);
    await sleep(500);
    await D.shot(`21-${style}-lobby.png`);
    await D.click('#startBtn');
    await D.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('countdown').hidden`, 8000);
    await sleep(2500);
    await D.shot(`22-${style}-game.png`);
  }
  await toMenu();
  await D.eval(`localStorage.removeItem('ra-settings')`);
});

// ---------------------------------------------------------------------------
// Owner tools, previewed on this computer with ?owner=1 (online, the owner
// is decided by roles/ in the database and checked by the rules).
await step('owner tools', async () => {
  const O = await openTab('O');
  const P = await openTab('P');
  const Q = await openTab('Q');
  await O.goto(URL_BASE + '&owner=1');
  await P.goto(URL_BASE);
  await Q.goto(URL_BASE);
  await O.eval(`document.getElementById('nameInput').value = 'brisky2swifty'`);
  await P.eval(`document.getElementById('nameInput').value = 'pat'`);
  await Q.eval(`document.getElementById('nameInput').value = 'quinn'`);
  const ownerOnlyShown = (t) => t.eval(`getComputedStyle(document.querySelector('.style-pick .owner-only')).display !== 'none'`);
  check('owner: tools button and gold style only for the owner',
    !(await O.eval(`document.getElementById('ownerBtn').hidden`)) && (await P.eval(`document.getElementById('ownerBtn').hidden`))
    && (await ownerOnlyShown(O)) && !(await ownerOnlyShown(P)));

  // Announcement banner.
  await O.click('#ownerBtn');
  await O.eval(`document.querySelector('.owner-dialog textarea').value = 'New mode out tonight!'`);
  await O.shot('30-owner-tools.png');
  await O.click('#announcePost');
  await P.waitFor(`!document.querySelector('.announce').hidden && document.querySelector('.announce').innerText.includes('New mode out tonight!')`, 5000, 'banner shows');
  const by = await P.eval(`(() => { const n = document.querySelector('.announce .banner-by'); return !!n && n.textContent.includes('brisky2swifty') && n.classList.contains('owner-name'); })()`);
  check('owner: announcement shows the owner name with the crown', by);
  await P.shot('31-announcement.png');
  await P.click('.announce .icon-x');
  await P.waitFor(`document.querySelector('.announce').hidden`);
  check('owner: announcement reaches everyone and can be dismissed', true);
  await O.click('#announceClear');
  await O.eval(`document.querySelector('.owner-dialog').close()`);

  // Lobby chat: only the owner can delete messages.
  for (const t of [O, P]) { await t.click('#browseBtn'); await t.waitFor(`document.body.dataset.screen === 'browse'`); }
  const sayInLobby = (t, text) => t.eval(`(() => { const f = document.querySelector('#browseChat .chat-form'); f.querySelector('input').value = ${JSON.stringify(text)}; f.requestSubmit(); })()`);
  await sayInLobby(P, 'hello lobby');
  await O.waitFor(`[...document.querySelectorAll('#browseChat .chat-msg')].some((m) => m.innerText.includes('hello lobby') && m.querySelector('.chat-del'))`, 5000, 'owner sees delete');
  const pCanDelete = await P.eval(`!!document.querySelector('#browseChat .chat-del')`);
  await O.eval(`[...document.querySelectorAll('#browseChat .chat-msg')].find((m) => m.innerText.includes('hello lobby')).querySelector('.chat-del').click()`);
  await P.waitFor(`!document.querySelector('#browseChat .chat-log').innerText.includes('hello lobby')`, 5000, 'message gone');
  check('owner: deletes lobby chat messages (others can\'t)', !pCanDelete);

  // Ban from a profile in the online players list, then unban.
  const pUid = await P.eval(`sessionStorage.getItem('ra-local-uid')`);
  await O.waitFor(`!!document.querySelector('.social-row[data-uid="${pUid}"]')`, 10000, 'pat in online list');
  await O.click(`.social-row[data-uid="${pUid}"]`);
  await O.waitFor(`!!document.querySelector('.profile-dialog [data-ban="1h"]')`);
  await O.shot('32-owner-profile.png');
  await O.click('.profile-dialog [data-ban="1h"]');
  await O.waitFor(`!!document.querySelector('.profile-dialog [data-unban]')`, 5000, 'ban applied');
  await sayInLobby(P, 'can you hear me');
  await P.waitFor(`[...document.querySelectorAll('.toast.err')].some((t) => t.innerText.includes('banned'))`, 5000, 'banned message');
  const leaked = await O.eval(`document.querySelector('#browseChat .chat-log').innerText.includes('can you hear me')`);
  check('owner: a banned player can\'t use lobby chat, and is told why', !leaked);
  await O.click('.profile-dialog [data-unban]');
  await O.waitFor(`!!document.querySelector('.profile-dialog [data-ban="1h"]')`);
  await O.eval(`document.querySelector('.profile-dialog').close()`);
  await sayInLobby(P, 'back again');
  await O.waitFor(`document.querySelector('#browseChat .chat-log').innerText.includes('back again')`, 5000, 'unbanned chat');
  check('owner: unban restores chat', true);

  // Owner's entrance, flair and kick in someone else's room.
  await P.click('#browseCreate');
  await P.waitFor(`document.body.dataset.screen === 'lobby'`);
  const code = await P.eval('window.__ra.state.code');
  await Q.eval(`document.getElementById('codeInput').value = '${code}'`);
  await Q.click('#joinBtn');
  await Q.waitFor(`document.body.dataset.screen === 'lobby'`);
  await O.eval(`document.getElementById('codeInput').value = '${code}'`);
  await O.click('#browseBack');
  await O.click('#joinBtn');
  await O.waitFor(`document.body.dataset.screen === 'lobby'`);
  await P.waitFor(`[...document.querySelectorAll('.toast.owner')].some((t) => t.innerText.includes('owner'))`, 5000, 'entrance toast');
  const flair = await P.eval(`(() => { const n = [...document.querySelectorAll('#lobbyPlayers .pname')].find((x) => x.textContent.includes('brisky2swifty')); return !!n && n.classList.contains('owner-name') && !!n.querySelector('.badge-owner'); })()`);
  await P.shot('33-owner-entrance.png');
  check('owner: entrance celebration, gold glowing name and crown badge', flair);
  await O.eval('window.confirm = () => true');
  await O.eval(`[...document.querySelectorAll('#lobbyPlayers li')].find((li) => li.innerText.includes('quinn')).querySelector('.kick').click()`);
  await Q.waitFor(`document.body.dataset.screen === 'menu'`, 5000, 'quinn kicked');
  check('owner: kicks a player from a room they don\'t host', true);

  // Close the room for everyone from the multiplayer lobby.
  await O.click('#leaveBtn');
  await O.waitFor(`document.body.dataset.screen === 'menu'`);
  await O.click('#browseBtn');
  await O.waitFor(`!!document.querySelector('[data-close="${code}"]')`, 10000, 'room listed');
  await O.click(`[data-close="${code}"]`);
  await P.waitFor(`document.body.dataset.screen === 'menu' && document.getElementById('menuMsg').innerText.includes('closed')`, 5000, 'room closed');
  check('owner: closes a public room for everyone in it', true);

  // Owner gold style applies only for the owner.
  await O.eval(`localStorage.setItem('ra-settings', JSON.stringify({ style: 'gold' }))`);
  await O.goto(URL_BASE + '&owner=1');
  await P.goto(URL_BASE);
  check('owner: gold style applies for the owner, not for others', (await O.eval('document.documentElement.dataset.style')) === 'gold' && (await P.eval('document.documentElement.dataset.style')) === 'green');
  await O.shot('34-owner-gold.png');
  await O.eval(`localStorage.removeItem('ra-settings')`);
  for (const t of [O, P, Q]) await t.close();
});

await step('trophy case', async () => {
  const T = await openTab('T');
  await T.goto(URL_BASE);
  // Start fresh: earlier steps share this browser's trophies and settings.
  await T.eval(`localStorage.removeItem('ra-trophies'); localStorage.removeItem('ra-settings')`);
  await T.goto(URL_BASE);
  await T.click('#trophyBtn');
  await T.waitFor(`document.getElementById('trophyDialog').open`);
  const info = await T.eval(`({ count: document.getElementById('trophyCount').innerText, secrets: [...document.querySelectorAll('.trophy.secret strong')].filter((x) => x.textContent === '???').length })`);
  await T.shot('40-trophy-case.png');
  const total = Number((info.count.match(/\/(\d+) trophies/) || [])[1] || 0);
  check('trophies: the case lists 125+ trophies with hidden secret ones', total >= 125 && info.secrets >= 8, JSON.stringify(info));
  await T.eval(`document.getElementById('trophyDialog').close()`);
  // Try all three styles: the secret "Fashion Hacker" trophy pops up.
  for (const style of ['cyber', 'amber', 'green']) {
    await T.click('#settingsBtn');
    await T.click(`#settingsDialog input[value=${style}]`);
    await T.click('#settingsClose');
  }
  await T.waitFor(`[...document.querySelectorAll('.toast')].some((t) => t.innerText.includes('Fashion Hacker'))`, 5000, 'secret trophy notice');
  check('trophies: a secret trophy unlocks with a notice', true);
  await T.eval(`localStorage.removeItem('ra-settings'); localStorage.removeItem('ra-trophies')`);
  await T.close();
});

await step('group chats', async () => {
  const G = await openTab('G');
  const H = await openTab('H');
  const K = await openTab('K');
  for (const [t, n] of [[G, 'gina'], [H, 'hank'], [K, 'kim']]) {
    await t.goto(URL_BASE);
    await t.eval(`window.dispatchEvent(new Event('pointerdown'))`); // skip the first-visit intro
    await t.eval(`document.getElementById('nameInput').value = '${n}'; document.getElementById('nameInput').dispatchEvent(new Event('input'))`);
  }
  const uid = (t) => t.eval(`sessionStorage.getItem('ra-local-uid')`);
  const [hUid, kUid] = [await uid(H), await uid(K)];
  const groupBox = '.group-box';
  const sayInGroup = (t, text) => t.eval(`(() => { const f = document.querySelector('.group-box .chat-form'); f.querySelector('input').value = ${JSON.stringify(text)}; f.requestSubmit(); })()`);
  const logText = (t) => t.eval(`document.querySelector('.group-box .dm-log').innerText`);

  // Gina makes a group; the members list opens with people to invite.
  await G.eval(`document.getElementById('social').classList.add('open')`);
  await G.click('[data-group-new]');
  await G.eval(`(() => { const f = document.querySelector('.group-new'); f.querySelector('input').value = '  Byte   Squad '; f.requestSubmit(); })()`);
  await G.waitFor(`!document.querySelector('${groupBox}').hidden`, 5000, 'group window opens');
  await G.waitFor(`!!document.querySelector('[data-invite-id="${hUid}"]') && !!document.querySelector('[data-invite-id="${kUid}"]')`, 15000, 'hank and kim can be invited');
  check('groups: making a group opens it, with online players to invite', (await G.eval(`document.querySelector('.group-box .pname').textContent`)) === 'Byte Squad');
  await G.click(`[data-invite-id="${hUid}"]`);
  await G.click(`[data-invite-id="${kUid}"]`);
  await G.waitFor(`document.querySelector('[data-invite-id="${kUid}"]').disabled`);
  await G.waitFor(`!document.getElementById('boot') || document.getElementById('boot').hidden || getComputedStyle(document.getElementById('boot')).display === 'none'`, 5000, 'intro gone');
  await G.shot('60-group-invite.png');

  // Hank says yes, Kim says no thanks.
  await H.eval(`document.getElementById('social').classList.add('open')`);
  await H.waitFor(`!!document.querySelector('.group-invite [data-accept]')`, 5000, 'hank gets the invite');
  const inviteText = await H.eval(`document.querySelector('.group-invite').innerText`);
  await H.shot('61-group-invited.png');
  await K.waitFor(`!!document.querySelector('.group-invite [data-decline]')`, 5000, 'kim gets the invite');
  await K.click('.group-invite [data-decline]');
  await K.waitFor(`!document.querySelector('.group-invite') && !document.querySelector('.group-row')`, 5000, 'kim declined');
  check('groups: invites name who sent them and can be turned down', /gina/.test(inviteText) && /Byte Squad/.test(inviteText));
  await H.click('.group-invite [data-accept]');
  await H.waitFor(`!document.querySelector('${groupBox}').hidden && document.querySelector('.group-box .small.dim').textContent.includes('2 members')`, 5000, 'hank joined');
  check('groups: accepting joins the group', true);

  // Chat both ways.
  await sayInGroup(G, 'hello squad');
  await H.waitFor(`document.querySelector('.group-box .dm-log').innerText.includes('hello squad')`, 5000, 'hank sees message');
  await sayInGroup(H, 'hi gina');
  await G.waitFor(`document.querySelector('.group-box .dm-log').innerText.includes('hi gina')`, 5000, 'gina sees reply');
  const kimSees = await K.eval(`document.body.innerText.includes('hello squad')`);
  check('groups: members chat together, and people who said no see nothing', !kimSees && (await logText(H)).includes('gina:'));
  await H.shot('62-group-chat.png');

  // Unread: Gina closes the window, Hank writes, Gina gets a dot and the badge.
  await G.click('.group-box .icon-x');
  await sayInGroup(H, 'ping');
  await G.waitFor(`!!document.querySelector('.group-row.unread') && !document.querySelector('.social-tab .social-unread').hidden`, 5000, 'unread shows');
  await G.click('.group-row');
  await G.waitFor(`!document.querySelector('.group-row.unread') && document.querySelector('.group-box .dm-log').innerText.includes('ping')`, 5000, 'opening clears unread');
  check('groups: new messages show as unread until you open the group', true);

  // Trophies for making, joining and chatting in a group.
  const tr = await G.eval(`JSON.parse(localStorage.getItem('ra-trophies') || '{}').unlocked || {}`);
  check('groups: group trophies unlock', !!(tr['group-made'] && tr['group-joined'] && tr['group-chat']), Object.keys(tr).filter((k) => k.startsWith('group')).join(','));

  // Gina (who made it) removes Hank; then deletes the group.
  if (await G.eval(`document.querySelector('.group-members').hidden`)) await G.click('[data-members]');
  await G.waitFor(`!!document.querySelector('[data-kick="${hUid}"]')`, 5000, 'remove button');
  const hankCanKick = await H.eval(`!!document.querySelector('[data-kick]')`);
  await G.click(`[data-kick="${hUid}"]`);
  await H.waitFor(`document.querySelector('${groupBox}').hidden && !document.querySelector('.group-row')`, 5000, 'hank removed');
  check('groups: only the group maker can remove people, and removed players lose the group', !hankCanKick);
  await G.click('[data-leave]');
  await G.click('[data-leave]');
  await G.waitFor(`document.querySelector('${groupBox}').hidden && !document.querySelector('.group-row')`, 5000, 'group deleted');
  const left = await G.eval(`Object.keys(JSON.parse(localStorage.getItem('ra-groups') || '{}')).length`);
  check('groups: deleting the group asks twice and removes it', left === 0, `groups left: ${left}`);
  const errs = [...G.errors, ...H.errors, ...K.errors];
  check('groups: no errors', errs.length === 0, errs.join(' | '));
  for (const t of [G, H, K]) await t.close();
});

await step('friends', async () => {
  const F1 = await openTab('F1');
  const F2 = await openTab('F2');
  const F3 = await openTab('F3');
  for (const [t, n] of [[F1, 'fay'], [F2, 'finn'], [F3, 'fox']]) {
    await t.goto(URL_BASE);
    await t.eval(`window.dispatchEvent(new Event('pointerdown'))`); // skip the first-visit intro
    await t.eval(`document.getElementById('nameInput').value = '${n}'`);
    await t.eval(`document.getElementById('social').classList.add('open')`);
  }
  const uid = (t) => t.eval(`sessionStorage.getItem('ra-local-uid')`);
  const [f1, f2] = [await uid(F1), await uid(F2)];
  const addFriend = async (t, name) => {
    if (!(await t.eval(`!!document.querySelector('.social-friends .group-new')`))) await t.click('[data-friend-add]');
    await t.eval(`(() => { const f = document.querySelector('.social-friends .group-new'); f.querySelector('input').value = ${JSON.stringify(name)}; f.requestSubmit(); })()`);
  };
  const note = (t) => t.eval(`document.querySelector('.social-friends .friend-note')?.textContent || ''`);
  await F1.waitFor(`Object.values(JSON.parse(localStorage.getItem('ra-presence') || '{}')).some((p) => p.name === 'finn')`, 15000, 'finn online with their name');

  // Asking by name: unknown names get a clear message, real ones get a request.
  await addFriend(F1, 'nobody-here');
  await F1.waitFor(`(document.querySelector('.social-friends .friend-note')?.textContent || '').includes('No player called')`, 5000, 'unknown name note');
  await addFriend(F1, '@Finn');
  await F1.waitFor(`(document.querySelector('.social-friends .friend-note')?.textContent || '').includes('request sent')`, 5000, 'request sent');
  check('friends: add by name (unknown names explained, @ and capitals ignored)', /finn/i.test(await note(F1)));

  // Finn gets the request and accepts; Fox gets nothing.
  await F2.waitFor(`!!document.querySelector('[data-faccept="${f1}"]')`, 5000, 'finn sees the request');
  const badge = await F2.eval(`document.querySelector('.social-tab .social-unread').textContent`);
  await F2.shot('63-friend-request.png');
  await F2.click(`[data-faccept="${f1}"]`);
  await F1.waitFor(`!!document.querySelector('.friend-row.online[data-friend="${f2}"]')`, 5000, 'fay sees finn as an online friend');
  await F2.waitFor(`!!document.querySelector('.friend-row.online[data-friend="${f1}"]')`, 5000, 'finn sees fay');
  const foxSees = await F3.eval(`!!document.querySelector('[data-faccept], .friend-row')`);
  check('friends: requests need a yes, then both see each other online', !foxSees && Number(badge) >= 1, `badge ${badge}`);

  // Inviting a friend to your room: they get a popup and join with one click.
  await F1.click('#createBtn');
  await F1.waitFor(`document.body.dataset.screen === 'lobby'`);
  const code = await F1.eval('window.__ra.state.code');
  await F1.eval(`document.getElementById('social').classList.add('open')`);
  await F1.waitFor(`!!document.querySelector('[data-finvite="${f2}"]')`, 5000, 'invite button in the lobby');
  await F1.click(`[data-finvite="${f2}"]`);
  await F1.waitFor(`document.querySelector('[data-finvite="${f2}"]').disabled`);
  await F2.waitFor(`!document.querySelector('.friend-pop').hidden && document.querySelector('.friend-pop').innerText.includes('${code}')`, 5000, 'invite popup');
  const popText = await F2.eval(`document.querySelector('.friend-pop').innerText`);
  await F2.shot('64-friend-invite.png');
  await F2.click(`[data-fjoin="${f1}"]`);
  await F2.waitFor(`document.body.dataset.screen === 'lobby' && window.__ra.state.code === '${code}'`, 8000, 'finn joined the room');
  await F2.waitFor(`document.querySelector('.friend-pop').hidden`, 3000, 'popup gone');
  check('friends: invite a friend to your room, and they join from the popup', /fay/.test(popText));
  await F1.shot('65-friend-lobby.png');

  const tr = await F1.eval(`JSON.parse(localStorage.getItem('ra-trophies') || '{}').unlocked || {}`);
  check('friends: friend trophies unlock', !!(tr['friend-made'] && tr['friend-invite']));

  // Unfriending asks twice and removes the friend on both sides.
  await F1.click(`[data-funfriend="${f2}"]`);
  const sure = await F1.eval(`document.querySelector('[data-funfriend="${f2}"]').textContent`);
  await F1.click(`[data-funfriend="${f2}"]`);
  await F1.waitFor(`!document.querySelector('[data-friend="${f2}"]')`, 5000, 'gone for fay');
  await F2.waitFor(`!document.querySelector('[data-friend="${f1}"]')`, 5000, 'gone for finn');
  check('friends: unfriending asks first and removes both sides', sure === 'sure?');
  const errs = [...F1.errors, ...F2.errors, ...F3.errors];
  check('friends: no errors', errs.length === 0, errs.join(' | '));
  for (const t of [F1, F2, F3]) await t.close();
});

await step('kid safety', async () => {
  const S1 = await openTab('S1');
  const S2 = await openTab('S2');
  const S3 = await openTab('S3');
  const rude = Buffer.from('c2hpdA==', 'base64').toString(); // a rude word, encoded so the test file stays clean
  await S1.goto(URL_BASE + '&owner=1');
  await S2.goto(URL_BASE);
  await S3.goto(URL_BASE);
  for (const [t, n] of [[S1, 'brisky2swifty'], [S2, 'sam'], [S3, 'tess']]) {
    await t.eval(`window.dispatchEvent(new Event('pointerdown'))`); // skip the first-visit intro
    await t.eval(`document.getElementById('nameInput').value = '${n}'`);
  }
  const uid = (t) => t.eval(`sessionStorage.getItem('ra-local-uid')`);
  const s3 = await uid(S3);

  // Lobby chat: rude words and phone numbers are hidden for everyone.
  for (const t of [S2, S3]) { await t.click('#browseBtn'); await t.waitFor(`document.body.dataset.screen === 'browse'`); }
  await S3.eval(`(() => { const f = document.querySelector('#browseChat .chat-form'); f.querySelector('input').value = 'oh ${rude} call me 555-123-4567'; f.requestSubmit(); })()`);
  await S2.waitFor(`document.querySelector('#browseChat .chat-log').innerText.includes('[number hidden]')`, 5000, 'filtered message arrives');
  const seen = await S2.eval(`document.querySelector('#browseChat .chat-log').innerText`);
  check('safety: chat hides rude words and phone numbers', !seen.toLowerCase().includes(rude) && seen.includes('oh ****') && !seen.includes('4567'), seen.split('\n').pop());
  for (const t of [S2, S3]) { await t.click('#browseBack'); await t.waitFor(`document.body.dataset.screen === 'menu'`).catch(() => {}); }

  // A rude name is never shown: others see "player".
  await S3.eval(`document.getElementById('nameInput').value = 'x${rude}x'`);
  await S2.eval(`document.getElementById('social').classList.add('open')`);
  await S2.waitFor(`document.querySelector('.social-row[data-uid="${s3}"] .pname')?.textContent === 'player'`, 15000, 'rude name replaced');
  const warn = await S3.eval(`document.getElementById('menuMsg').textContent`);
  check('safety: a rude name is swapped for "player" and the player is told why', /kinder name/.test(warn), warn);
  await S3.eval(`document.getElementById('nameInput').value = 'tess'`);
  await S2.waitFor(`document.querySelector('.social-row[data-uid="${s3}"] .pname')?.textContent === 'tess'`, 15000, 'name back');

  // Reporting from a profile.
  await S2.click(`.social-row[data-uid="${s3}"]`);
  await S2.waitFor(`!!document.querySelector('[data-report-open]')`);
  await S2.click('[data-report-open]');
  await S2.eval(`document.querySelector('input[name="report-reason"][value="words"]').checked = true; document.querySelector('.report-form textarea').value = 'said bad words in lobby chat'`);
  await S2.shot('66-report-form.png');
  await S2.click('[data-report-send]');
  await S2.waitFor(`document.querySelector('.profile-dialog').innerText.includes('Thanks for telling us')`, 5000, 'report sent');
  check('safety: players can report someone from their profile', true);
  // A second report straight away is refused (one every 30 seconds).
  await S2.eval(`document.querySelector('.profile-dialog').close()`);
  await S2.click(`.social-row[data-uid="${s3}"]`);
  await S2.waitFor(`!!document.querySelector('[data-report-open]')`);
  await S2.click('[data-report-open]');
  await S2.click('[data-report-send]');
  await S2.waitFor(`/wait a little/.test(document.querySelector('.report-form .err')?.textContent || '')`, 5000, 'too soon');
  check('safety: reports are limited to one every 30 seconds', true);
  await S2.eval(`document.querySelector('.profile-dialog').close()`);

  // The owner gets a badge and sees the report; others don't have the inbox.
  await S1.waitFor(`document.querySelector('#ownerBtn .owner-count')?.textContent === '1' && !document.querySelector('#ownerBtn .owner-count').hidden`, 5000, 'owner badge');
  await S1.click('#ownerBtn');
  await S1.waitFor(`!!document.querySelector('.report-list [data-report]')`);
  const rep = await S1.eval(`document.querySelector('.report-list [data-report]').innerText`);
  check('safety: the owner sees the report with who, why and the note', /tess/.test(rep) && /Bad words/.test(rep) && /said bad words/.test(rep) && /sam/.test(rep), rep.replace(/\n/g, ' | '));
  await S1.shot('67-owner-reports.png');
  check('safety: only the owner has the reports inbox', !(await S2.eval(`!!document.querySelector('#ownerBtn .owner-count:not([hidden])')`)));
  // Ban from the report, then mark it done.
  await S1.click('[data-report-ban]');
  await S1.waitFor(`/banned/.test(document.querySelector('.report-list [data-report]')?.innerText || '')`, 5000, 'banned from report');
  await S1.click('[data-report-dismiss]');
  await S1.waitFor(`!document.querySelector('.report-list [data-report]') && document.querySelector('#ownerBtn .owner-count').hidden`, 5000, 'report cleared');
  const s3Banned = await S3.eval(`(JSON.parse(localStorage.getItem('ra-bans') || '{}')['${s3}']?.until || 0) > Date.now()`);
  check('safety: the owner can ban straight from a report, then clear it', s3Banned);
  await S1.eval(`document.querySelector('.owner-dialog').close()`);
  await S1.eval(`localStorage.removeItem('ra-bans'); localStorage.removeItem('ra-reports'); localStorage.removeItem('ra-reports-by')`);
  const errs = [...S1.errors, ...S2.errors, ...S3.errors];
  check('safety: no errors', errs.length === 0, errs.join(' | '));
  for (const t of [S1, S2, S3]) await t.close();
});

await step('chat fun', async () => {
  const E1 = await openTab('E1');
  const E2 = await openTab('E2');
  for (const [t, n] of [[E1, 'emma'], [E2, 'eli']]) {
    await t.goto(URL_BASE);
    await t.eval(`window.dispatchEvent(new Event('pointerdown'))`); // skip the first-visit intro
    await t.eval(`document.getElementById('nameInput').value = '${n}'`);
  }
  await E1.click('#createBtn');
  await E1.waitFor(`document.body.dataset.screen === 'lobby'`);
  const code = await E1.eval('window.__ra.state.code');
  await E2.eval(`document.getElementById('codeInput').value = '${code}'`);
  await E2.click('#joinBtn');
  await E2.waitFor(`document.body.dataset.screen === 'lobby'`);
  const say = (t, text) => t.eval(`(() => { const f = document.querySelector('#lobbyChat .chat-form'); f.querySelector('input').value = ${JSON.stringify(text)}; f.requestSubmit(); })()`);
  const log = (t) => t.eval(`document.querySelector('#lobbyChat .chat-log').innerText`);

  // Slash commands.
  await say(E1, '/me waves hello');
  await E2.waitFor(`[...document.querySelectorAll('#lobbyChat .chat-action')].some((a) => a.innerText.includes('emma waves hello'))`, 5000, '/me action');
  await say(E1, '/roll');
  await E2.waitFor(`document.querySelector('#lobbyChat .chat-log').innerText.includes('rolled')`, 5000, '/roll');
  await say(E1, '/help');
  await E1.waitFor(`!!document.querySelector('#lobbyChat .chat-local')`, 3000, '/help shows locally');
  const help = await E1.eval(`document.querySelector('#lobbyChat .chat-local').innerText`);
  check('chat: /me, /roll and /help work, and /help is only shown to you', /\/me/.test(help) && !(await log(E2)).includes('Chat commands'));

  // Emoji picker and smileys.
  await E1.click('#lobbyChat .emoji-toggle');
  await E1.waitFor(`!document.querySelector('#lobbyChat .emoji-picker').hidden`);
  await E1.shot('68-emoji-picker.png');
  await E1.click('#lobbyChat [data-emoji="🔥"]');
  const typed = await E1.eval(`document.querySelector('#lobbyChat .chat-form input').value`);
  await E1.eval(`(() => { const f = document.querySelector('#lobbyChat .chat-form'); f.querySelector('input').value += ' so cool :)'; f.requestSubmit(); })()`);
  await E2.waitFor(`document.querySelector('#lobbyChat .chat-log').innerText.includes('🔥 so cool 🙂')`, 5000, 'emoji and smiley');
  check('chat: emoji picker inserts emoji, and :) becomes 🙂', typed === '🔥' && (await E1.eval(`document.querySelector('#lobbyChat .emoji-picker').hidden`)));

  // Quick-chat follows the mode: Race has its own, Heist has "Code is …" to finish yourself.
  const chips = (t) => t.eval(`[...document.querySelectorAll('#lobbyChat .quick-chip')].map((b) => b.dataset.quick)`);
  const raceChips = await chips(E2);
  await E1.click('.mode-card[data-mode=heist]');
  await E2.waitFor(`[...document.querySelectorAll('#lobbyChat .quick-chip')].some((b) => b.dataset.quick === 'Code is …')`, 5000, 'heist chips');
  await E2.click('#lobbyChat [data-quick="Code is …"]');
  const filled = await E2.eval(`document.querySelector('#lobbyChat .chat-form input').value`);
  await E2.eval(`document.querySelector('#lobbyChat .chat-form input').value = ''`);
  await E2.click('#lobbyChat [data-quick="gl hf!"]');
  await E1.waitFor(`document.querySelector('#lobbyChat .chat-log').innerText.includes('eli: gl hf!')`, 5000, 'quick chat sent');
  check('chat: quick-chat buttons change with the mode and send in one click', raceChips.includes('Which layer are you on?') && filled === 'Code is ', `${raceChips.join(',')} / "${filled}"`);
  await E1.shot('69-chat-fun.png');
  const errs = [...E1.errors, ...E2.errors];
  check('chat: no errors', errs.length === 0, errs.join(' | '));
  await E2.eval('window.confirm = () => true');
  for (const t of [E1, E2]) await t.close();
});

await step('spectate', async () => {
  const V1 = await openTab('V1');
  const V2 = await openTab('V2');
  const V3 = await openTab('V3');
  for (const [t, n] of [[V1, 'vic'], [V2, 'val'], [V3, 'wes']]) {
    await t.goto(URL_BASE);
    await t.eval(`window.dispatchEvent(new Event('pointerdown'))`); // skip the first-visit intro
    await t.eval(`document.getElementById('nameInput').value = '${n}'; window.confirm = () => true`);
  }
  await V1.click('#createBtn');
  await V1.waitFor(`document.body.dataset.screen === 'lobby'`);
  const code = await V1.eval('window.__ra.state.code');
  await V2.eval(`document.getElementById('codeInput').value = '${code}'`);
  await V2.click('#joinBtn');
  await V2.waitFor(`document.body.dataset.screen === 'lobby'`);
  await V2.click('#readyBtn');
  await V1.waitFor(`!!document.getElementById('startBtn') && !document.getElementById('startBtn').disabled`, 5000, 'start enabled');
  await V1.click('#startBtn');
  for (const t of [V1, V2]) await t.waitFor(`document.body.dataset.screen === 'game'`, 5000, 'game started');

  // Wes joins mid-game: he watches instead of being turned away.
  await V3.eval(`document.getElementById('codeInput').value = '${code}'`);
  await V3.click('#joinBtn');
  await V3.waitFor(`document.body.dataset.screen === 'game' && document.getElementById('screen-game').classList.contains('spectating')`, 8000, 'spectating');
  await V3.waitFor(`document.querySelectorAll('.spectate-row').length === 2`, 5000, 'scoreboard rows');
  const board = await V3.eval(`document.querySelector('.spectate').innerText`);
  const label = await V3.eval(`document.getElementById('gameRoom').textContent`);
  const termHidden = await V3.eval(`getComputedStyle(document.getElementById('term')).display === 'none'`);
  check('spectate: joining a running game lets you watch, with a live scoreboard', /vic/.test(board) && /val/.test(board) && !/wes/.test(board) && /SPECTATING/.test(label) && termHidden, board.replace(/\n/g, ' | '));
  await V3.shot('70-spectate.png');
  const inGame = await V1.eval(`window.__ra.state.room.players && Object.values(window.__ra.state.room.players).filter((p) => !p.spectator).length`);
  check('spectate: the players\' game ignores the spectator', inGame === 2 && !(await V1.eval(`document.getElementById('side').innerText.includes('wes')`)));

  // The spectator can chat with the players.
  await V3.eval(`(() => { const f = document.querySelector('#gameChat .chat-form'); f.querySelector('input').value = 'go vic!'; f.requestSubmit(); })()`);
  await V1.waitFor(`document.querySelector('#gameChat .chat-log').innerText.includes('go vic!')`, 5000, 'spectator chat');
  check('spectate: spectators can cheer in the chat', true);

  // Round ends (Val roots the server): the spectator sees results (without XP), then plays next round.
  await V2.eval(`(() => { const { net, code } = window.__ra.state; return net.update(code, { ['players/' + net.uid + '/s/layer']: 5, ['players/' + net.uid + '/s/at']: net.now() }); })()`);
  for (const t of [V1, V2, V3]) await t.waitFor(`document.body.dataset.screen === 'results'`, 8000, 'results');
  const resText = await V3.eval(`document.getElementById('resultsList').innerText`);
  check('spectate: spectators see the results but aren\'t in them', !/wes/.test(resText) && (await V3.eval(`document.getElementById('xpGain').hidden`)), resText.replace(/\n/g, ' | '));
  await V1.click('#againBtn');
  await V3.waitFor(`document.body.dataset.screen === 'lobby'`, 5000, 'lobby');
  const wesId = await V3.eval(`window.__ra.state.net.uid`);
  await V1.waitFor(`!!window.__ra.state.room.players['${wesId}'] && !window.__ra.state.room.players['${wesId}'].spectator && document.getElementById('lobbyPlayers').innerText.includes('wes')`, 5000, 'wes is a player now');
  check('spectate: back in the lobby, spectators become players', true);
  const errs = [...V1.errors, ...V2.errors, ...V3.errors];
  check('spectate: no errors', errs.length === 0, errs.join(' | '));
  for (const t of [V1, V2, V3]) await t.close();
});

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
