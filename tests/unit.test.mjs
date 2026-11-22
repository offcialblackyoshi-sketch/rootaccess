// Unit checks for the pure game logic. Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { makeRng, caesar, b64encode, b64decode, reverse, atbash, hexEncode, hexDecode } from '../src/rng.js';
import { Shell } from '../src/commands.js';
import { setPath } from '../src/net/shared.js';
import { buildRace, pinFeedback, decryptWith, encryptWith, CIPHERS, raceHints, HINT_COST, raceStatsText } from '../src/modes/race.js';
import { buildTutorial } from '../src/modes/tutorial.js';
import { buildHeist, fillMissingRoles, heistStatsText } from '../src/modes/heist.js';
import { SNIPPETS, duelStatsText, BONUS_SNIPPETS, pickPowerup } from '../src/modes/duel.js';
import { score, startNodes, breachTime, defendStatsText } from '../src/modes/defend.js';
import { botParams, BOT_LEVELS } from '../src/bots.js';
import { normalizeSettings, defaultSettings } from '../src/settings.js';
import { secondsCrossed } from '../src/sfx.js';
import { columnCount, rainbowColor } from '../src/matrix.js';
import { roundTime, fmtTime } from '../src/util.js';
import { MODES, MODE_ORDER, PUZZLES, gauntletOrder, GAUNTLET } from '../src/modes/index.js';
import { quickStatsText, stageRng, STAGES } from '../src/modes/quickhack.js';
import * as letterlock from '../src/modes/minigames/letterlock.js';
import * as printmatch from '../src/modes/minigames/printmatch.js';
import * as signaltune from '../src/modes/minigames/signaltune.js';
import * as circuit from '../src/modes/minigames/circuit.js';
import * as memory from '../src/modes/minigames/memory.js';
import * as wirecut from '../src/modes/minigames/wirecut.js';
import * as portsweep from '../src/modes/minigames/portsweep.js';
import * as bitflip from '../src/modes/minigames/bitflip.js';

const SEEDS = Array.from({ length: 300 }, (_, i) => i * 7919 + 13);

function fakeTerm() {
  const lines = [];
  return {
    lines,
    print: (t) => lines.push(...String(t).split('\n')),
    printParts: (parts) => lines.push(parts.map((p) => p[0]).join('')),
    setPrompt() {},
    clear: () => (lines.length = 0),
  };
}

// Every game file must parse as a JavaScript module. (The plain "node --check"
// misses some errors in browser modules, such as a line break inside a string.)
test('every source file is valid module JavaScript', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readdirSync } = await import('node:fs');
  const root = new URL('../src/', import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter((p) => String(p).endsWith('.js'));
  assert.ok(files.length > 10);
  for (const file of [...files.map((p) => new URL(String(p).replaceAll('\\', '/'), root)), new URL('../sw.js', import.meta.url), new URL('../firebase-config.js', import.meta.url)]) {
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(file) });
    assert.equal(r.status, 0, `${file.pathname}: ${String(r.stderr).split('\n').slice(0, 4).join(' ')}`);
  }
});

test('rng is deterministic per seed', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const seqA = Array.from({ length: 5 }, a.next);
  assert.deepEqual(seqA, Array.from({ length: 5 }, b.next));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, c.next));
});

test('ciphers round-trip', () => {
  const s = 'FRAGMENT A: QXZT\nhello world';
  for (let k = 0; k < 26; k++) assert.equal(caesar(caesar(s, k), -k), s);
  assert.equal(b64decode(b64encode(s)), s);
  assert.equal(reverse(reverse(s)), s);
  assert.equal(b64decode('%%%not base64'), null);
  assert.equal(atbash(atbash(s)), s);
  assert.equal(atbash('ABC xyz'), 'ZYX cba');
  assert.equal(hexDecode(hexEncode(s)), s);
  assert.equal(hexDecode('zz'), null);
  for (const c of CIPHERS) assert.equal(decryptWith(c, encryptWith(c, s, 7), 7), s, c);
});

test('race puzzles: same seed gives same puzzle', () => {
  assert.equal(JSON.stringify(buildRace(123)), JSON.stringify(buildRace(123)));
  assert.notEqual(JSON.stringify(buildRace(123)), JSON.stringify(buildRace(124)));
});

test('race puzzles are always solvable', () => {
  for (const seed of SEEDS) {
    const P = buildRace(seed);
    // Layer 1: the current password AND an older trap password are where the
    // mission hint points, and the newer one is clearly dated later.
    assert.notEqual(P.pass, P.oldPass, `seed ${seed}`);
    assert.ok(P.fs.home.guest['mission.txt'].includes(P.passHint));
    if (P.passSpot === 'log') {
      assert.match(P.fs.var.log['auth.log'], new RegExp(`Nov 14 .*password for ${P.target} changed to '${P.pass}'`));
      assert.match(P.fs.var.log.old['auth.log.1'], new RegExp(`Nov 7 .*password for ${P.target} changed to '${P.oldPass}'`));
    } else if (P.passSpot === 'config') {
      const dir = P.fs.etc[P.target.slice(4)];
      assert.match(dir['config.ini'], new RegExp(`password = ${P.pass}\nupdated = 2026-11-14`));
      assert.match(dir['config.ini.bak'], new RegExp(`password = ${P.oldPass}\nupdated = 2026-11-07`));
      assert.ok(!P.fs.var.log['auth.log'].includes(P.pass), 'password should only be in the config');
    } else {
      const box = P.fs.var.mail[P.target];
      assert.ok(box.indexOf(P.oldPass) < box.indexOf(P.pass), 'newest email comes last');
      assert.match(box, new RegExp(`Nov 14.*\nSubject: password reset\n\nYour password has been reset.\nNew password: ${P.pass}`));
    }
    // Layer 2: decrypting with the method from the note reveals fragment A.
    const enc = P.targetHome['vault.enc'];
    const dec = decryptWith(P.cipherType, enc, P.shift);
    assert.ok(dec.includes(`FRAGMENT A: ${P.fragA}`), `seed ${seed}`);
    assert.ok(!enc.includes(`FRAGMENT A: ${P.fragA}`), `seed ${seed}: file is not actually scrambled`);
    if (P.cipherType === 'caesar') assert.ok(P.targetHome['note.txt'].includes(String(P.shift)));
    // Wrong methods never accidentally reveal the fragment.
    for (const other of CIPHERS.filter((c) => c !== P.cipherType)) {
      const wrong = decryptWith(other, enc, other === 'caesar' ? (P.shift + 1) % 26 : 0);
      assert.ok(!wrong || !wrong.includes(`FRAGMENT A: ${P.fragA}`), `seed ${seed}: ${other} also works`);
    }
    // Layer 3: 4 different digits.
    assert.match(P.pin, /^\d{4}$/);
    assert.equal(new Set(P.pin).size, 4);
    // Layer 4: exactly one backdoor, on the host named in todo.txt.
    const backdoors = Object.entries(P.hosts).flatMap(([h, x]) => x.ports.filter((p) => p.backdoor).map(() => h));
    assert.deepEqual(backdoors, [P.netTarget]);
    assert.ok(P.targetHome['todo.txt'].includes(P.netTarget));
    assert.ok(P.fs.etc.hosts.includes(P.netTarget));
    // Layer 5: key is A-PIN-C.
    assert.equal(P.key, `${P.fragA}-${P.pin}-${P.fragC}`);
  }
});

test('race puzzles use every hiding place and cipher', () => {
  const spots = new Set(SEEDS.map((s) => buildRace(s).passSpot));
  const ciphers = new Set(SEEDS.map((s) => buildRace(s).cipherType));
  assert.deepEqual([...spots].sort(), ['config', 'log', 'mail']);
  assert.deepEqual([...ciphers].sort(), [...CIPHERS].sort());
});

test('race hints get more specific and the last one nearly solves the layer', () => {
  for (const seed of SEEDS.slice(0, 100)) {
    const P = buildRace(seed);
    const H = raceHints(P);
    assert.equal(H.length, 5);
    for (const layer of H) assert.equal(layer.length, HINT_COST.length);
    // Layer 1: the named file really holds the current password.
    const path = H[0][2].match(/Open (\S+)/)[1].split('/').filter(Boolean);
    const file = path.reduce((n, p) => n?.[p], P.fs);
    assert.ok(typeof file === 'string' && file.includes(P.pass), `seed ${seed}: ${path.join('/')}`);
    // Layer 2: the exact command decrypts the vault.
    const [, method, n] = H[1][2].match(/decrypt vault\.enc (\w+)(?: (\d+))?/);
    assert.ok(decryptWith(method, P.targetHome['vault.enc'], Number(n)).includes(P.fragA));
    assert.ok(H[2][2].includes(P.pin[0]) && H[2][2].includes(P.pin[3]));
    assert.ok(H[3][2].includes(`connect ${P.netTarget} ${P.backdoor}`));
    assert.ok(H[4][2].includes(P.key));
  }
  assert.deepEqual(HINT_COST, [...HINT_COST].sort((a, b) => a - b), 'hints cost more each time');
});

test('tutorial: the grep step finds the unlock code', () => {
  const T = buildTutorial(7);
  assert.ok(T.fs.home.you.logs['today.log'].includes(`secret door code is ${T.code}`));
  assert.equal(T.steps.length, 10);
  // Walk the steps with the commands a player would type.
  const term = fakeTerm();
  const sh = new Shell(term, { fs: T.fs, cwd: '/home/you' });
  sh.homeDir = '/home/you';
  const play = [['help'], ['ls'], ['cat', 'start-here.txt'], ['cd', 'docs'], ['cat', 'welcome.txt'], ['cd', '..'], ['grep', 'secret'], ['unlock', T.code], ['unlock', T.code, 'repeat'], ['say', 'hello']];
  play.forEach(([cmd, arg, repeat], i) => {
    if (cmd !== 'unlock' && cmd !== 'say') sh.exec(`${cmd} ${arg || ''}`);
    const info = { cmd, args: arg ? [arg] : [], file: arg ? sh.resolve(arg) : null, cwd: sh.cwd, repeat: !!repeat };
    assert.ok(T.steps[i].check(info), `step ${i + 1} should pass with "${cmd} ${arg || ''}"`);
  });
});

test('PIN feedback', () => {
  assert.deepEqual(pinFeedback('1234', '1234'), { exact: 4, near: 0 });
  assert.deepEqual(pinFeedback('1234', '4321'), { exact: 0, near: 4 });
  assert.deepEqual(pinFeedback('1234', '1567'), { exact: 1, near: 0 });
  assert.deepEqual(pinFeedback('1234', '5612'), { exact: 0, near: 2 });
});

test('heist puzzles are always solvable from the analyst files', () => {
  for (const seed of SEEDS) {
    const P = buildHeist(seed);
    // Door: re-derive the code by reading the manual like a player would.
    const manual = P.fs.manuals['keypads.txt'];
    const block = manual.split('MODEL ').find((b) => b.startsWith(P.model));
    const light = block.match(/If the (\w+) light/)[1];
    const cond = block.match(/2\. Otherwise, if (.*), the code/)[1];
    const codes = [...block.matchAll(/code is (\d{4})/g)].map((m) => m[1]);
    const lastDigit = Number(P.serial.slice(-1));
    const rule2 = cond.includes('EVEN') ? lastDigit % 2 === 0
      : cond.includes('ODD') ? lastDigit % 2 === 1
        : cond.includes('vowel') ? /[AEIOU]/.test(P.serial)
          : cond.includes('two or more lights') ? P.lit.length >= 2
            : assert.fail(`unknown rule: ${cond}`);
    const expected = P.lit.includes(light) ? codes[0] : rule2 ? codes[1] : codes[2];
    assert.equal(P.doorCode, expected, `seed ${seed}`);
    // Login: the user's staff file has what the hint asks for.
    const file = Object.values(P.fs.staff).find((f) => f.includes(`Username: ${P.user}\n`));
    assert.ok(file, `seed ${seed}: no staff file for ${P.user}`);
    const born = file.match(/Born: (\d+)/)[1];
    const pet = file.match(/Pet: (\w+)/)[1].toLowerCase();
    const color = file.match(/Favorite color: (\w+)/)[1];
    const dept = file.match(/Dept: (\w+)/)[1].toLowerCase();
    const fromHint = {
      "pet's name + year of birth": pet + born,
      "year of birth + pet's name": born + pet,
      "favorite color + pet's name": color + pet,
      'department + year of birth': dept + born,
      "pet's name + favorite color": pet + color,
    }[P.loginHint];
    assert.equal(fromHint, P.password, `seed ${seed}: ${P.loginHint}`);
    // Only one staff member has that username.
    assert.equal(Object.values(P.fs.staff).filter((f) => f.includes(`Username: ${P.user}\n`)).length, 1);
    // Vault: count what the procedure says to count; that unscrambles the word.
    const proc = P.fs.security['vault.txt'];
    const count = proc.includes('NIGHT shift') ? (P.fs.security['roster.txt'].match(/ NIGHT/g) || []).length
      : proc.includes('DAY shift') ? (P.fs.security['roster.txt'].match(/ DAY/g) || []).length
        : (P.fs.security['cameras.txt'].match(/OFFLINE/g) || []).length;
    assert.equal(count, P.dial, `seed ${seed}: ${P.vaultSource}`);
    assert.equal(caesar(P.display, -count), P.word);
    assert.notEqual(P.display, P.word, 'display is scrambled');
  }
});

test('heist puzzles use every variant', () => {
  const all = SEEDS.map(buildHeist);
  assert.deepEqual([...new Set(all.map((p) => p.doorRule))].sort(), ['even', 'odd', 'twoLights', 'vowel']);
  assert.equal(new Set(all.map((p) => p.hintType)).size, 5);
  assert.deepEqual([...new Set(all.map((p) => p.vaultSource))].sort(), ['cameras', 'day', 'night']);
});

test('heist: a lookout fills in when a key role leaves', () => {
  const p = (id, role) => ({ id, s: { role } });
  // Full crew: nothing to change.
  assert.deepEqual(fillMissingRoles([p('a', 'infiltrator'), p('b', 'analyst'), p('c', 'lookout')]), {});
  // Infiltrator left: the lookout steps in.
  assert.deepEqual(fillMissingRoles([p('b', 'analyst'), p('c', 'lookout')]), { 'players/c/s/role': 'infiltrator' });
  // Analyst left with two lookouts: the latest-joined lookout takes it.
  assert.deepEqual(fillMissingRoles([p('a', 'infiltrator'), p('c', 'lookout'), p('d', 'lookout')]), { 'players/d/s/role': 'analyst' });
  // Both key roles gone: two lookouts cover both.
  assert.deepEqual(fillMissingRoles([p('c', 'lookout'), p('d', 'lookout')]), { 'players/d/s/role': 'infiltrator', 'players/c/s/role': 'analyst' });
});

test('shell: ls, cd, cat, grep and tab completion', () => {
  const term = fakeTerm();
  const sh = new Shell(term, { fs: { home: { me: { 'a.txt': 'hello\nsecret=42' } }, etc: { motd: 'hi' } }, cwd: '/home/me' });
  sh.exec('ls');
  assert.equal(term.lines.pop().trim(), 'a.txt');
  sh.exec('cat a.txt');
  assert.deepEqual(term.lines.splice(0), ['hello', 'secret=42']);
  sh.exec('cd ../..');
  assert.equal(sh.cwd, '/');
  sh.exec('grep secret');
  assert.ok(term.lines.pop().includes('/home/me/a.txt:2: secret=42'));
  sh.exec('cat nope');
  assert.match(term.lines.pop(), /no such file/);
  sh.exec('frobnicate');
  assert.match(term.lines.pop(), /command not found/);
  assert.deepEqual(sh.complete(['cat', 'ho']), ['home/']);
  assert.deepEqual(sh.complete(['gr']), ['grep']);
});

test('setPath mimics Firebase paths', () => {
  const o = {};
  setPath(o, 'players/a/s/hp', 50);
  assert.deepEqual(o, { players: { a: { s: { hp: 50 } } } });
  setPath(o, 'players/a/s/hp', null);
  assert.deepEqual(o, {});
  setPath(o, 'x', { y: 1 });
  setPath(o, 'nothing/here', null);
  assert.deepEqual(o, { x: { y: 1 } });
});

test('bot levels get harder in every mode', () => {
  const [easy, normal, hard] = BOT_LEVELS.map(botParams);
  for (const [a, b] of [[easy, normal], [normal, hard]]) {
    assert.ok(a.raceLayerMs[0] > b.raceLayerMs[0] && a.raceLayerMs[1] > b.raceLayerMs[1], 'race bots get faster');
    assert.ok(a.duelWpm[1] <= b.duelWpm[0] + 2 && a.duelMiss > b.duelMiss, 'duel bots type faster and miss less');
    assert.ok(a.defendBreach < b.defendBreach && a.defendKill < b.defendKill, 'defend bots act more');
    assert.ok(a.quickStageMs[0] > b.quickStageMs[0] && a.quickStageMs[1] > b.quickStageMs[1], 'quick-hack bots get faster');
  }
  assert.equal(botParams(undefined), normal, 'missing level falls back to normal');
});

test('results stats text', () => {
  // 50 correct characters in 1 minute = 10 WPM; 9 hits of 10 shots = 90%.
  assert.equal(duelStatsText({ hits: 9, misses: 1, chars: 50 }, 60000), '10 WPM · 90% accuracy · 9 hits');
  assert.equal(duelStatsText(undefined, 60000), 'no shots fired');
  assert.equal(raceStatsText({ splits: [62000, 31000, 45000], hints: 1 }), 'fastest layer: DECRYPT 0:31 · 1 hint');
  assert.equal(raceStatsText({}), 'no hints');
  assert.equal(defendStatsText({ loot: 80, stats: { breaches: 6, kills: 2 } }), '80 stolen · 6 breaches · 2 attacks stopped');
  assert.equal(heistStatsText({ mistakes: 1, loops: 3 }), '1 mistake · 3 cameras looped');
  assert.equal(heistStatsText(undefined), '0 mistakes · 0 cameras looped');
});

test('display settings: bad saves fall back to defaults', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  assert.deepEqual(normalizeSettings('garbage'), defaultSettings());
  assert.deepEqual(normalizeSettings({ textSize: 'huge', scanlines: 'no' }), defaultSettings());
  assert.deepEqual(normalizeSettings({ textSize: 'large', scanlines: false }), { ...defaultSettings(), textSize: 'large', scanlines: false });
  assert.equal(normalizeSettings({ volume: 5 }).volume, 1, 'volume is clamped');
  assert.equal(normalizeSettings({ volume: 'loud' }).volume, defaultSettings().volume);
  assert.equal(normalizeSettings({ keyClicks: true }).keyClicks, true);
  // The system's reduced-motion preference turns off motion and scanlines by default.
  assert.deepEqual(defaultSettings(true), { scanlines: false, textSize: 'normal', reduceMotion: true, highContrast: false, volume: 0.7, keyClicks: false, matrixRain: false, rainbowRain: false, style: 'green' });
  assert.equal(defaultSettings(false).matrixRain, true, 'rain is on by default');
});

test('round length scales each mode timer to whole half-minutes', () => {
  const t = (mode, len) => fmtTime(roundTime(MODES[mode], len));
  assert.deepEqual(['short', 'normal', 'long'].map((l) => t('race', l)), ['7:00', '12:00', '19:00']);
  assert.deepEqual(['short', 'normal', 'long'].map((l) => t('defend', l)), ['3:00', '5:00', '8:00']);
  assert.equal(t('duel', undefined), '4:00', 'missing setting = normal');
  assert.equal(roundTime(MODES.tutorial, 'long'), 0, 'tutorial has no timer');
});

test('countdown beeps: one per whole second shown', () => {
  // The display shows ceil(seconds left); a beep plays when it changes.
  assert.deepEqual(secondsCrossed(3500, 2900, 3), [3]);
  assert.deepEqual(secondsCrossed(3000, -100, 3), [2, 1]);
  assert.deepEqual(secondsCrossed(10100, 10050, 10), []);
  assert.deepEqual(secondsCrossed(10500, 9500, 10), [10]);
  assert.deepEqual(secondsCrossed(30000, 20000, 10), [], 'nothing before the last 10 seconds');
});

test('duel power-ups: never early, about 1 in 4 after that', () => {
  const rng = makeRng(99);
  for (let since = 0; since < 4; since++) {
    for (let i = 0; i < 200; i++) assert.equal(pickPowerup(rng, since), null);
  }
  const picks = Array.from({ length: 4000 }, () => pickPowerup(rng, 4));
  const rate = picks.filter(Boolean).length / picks.length;
  assert.ok(rate > 0.2 && rate < 0.3, `bonus rate ${rate}`);
  assert.ok(picks.includes('repair') && picks.includes('shield'));
  const all = [...BONUS_SNIPPETS.repair, ...BONUS_SNIPPETS.shield];
  assert.equal(new Set(all).size, all.length);
  for (const s of all) assert.ok(!SNIPPETS.includes(s), 'bonus snippets are distinct');
  for (const s of BONUS_SNIPPETS.shield) assert.ok(!/patch|rebuild|rollback/.test(s), 'shield commands read like shields');
});

test('display settings: style falls back to green', () => {
  assert.equal(normalizeSettings({ style: 'cyber' }).style, 'cyber');
  assert.equal(normalizeSettings({ style: 'amber' }).style, 'amber');
  assert.equal(normalizeSettings({ style: 'vaporwave' }).style, 'green');
});

// Reads each style's color tokens from style.css and checks readability
// (WCAG AA: at least 4.5:1 for normal text).
test('every style keeps text readable (WCAG AA contrast)', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const block = (selector) => {
    const start = css.indexOf(selector + ' {');
    assert.ok(start >= 0, 'missing ' + selector);
    return css.slice(start, css.indexOf('}', start));
  };
  const hex = (b, name) => {
    const m = b.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
    return m && m[1];
  };
  const lum = (h) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const styles = { green: block(':root'), cyber: block('html[data-style="cyber"]'), amber: block('html[data-style="amber"]') };
  for (const [name, b] of Object.entries(styles)) {
    const bg = hex(b, 'bg');
    const panel = hex(b, 'panel-solid');
    for (const text of ['fg', 'dim', 'accent', 'accent2', 'amber', 'red']) {
      const color = hex(b, text);
      assert.ok(color, `${name}: --${text} should be a hex color`);
      for (const [where, back] of [['background', bg], ['panel', panel]]) {
        const ratio = contrast(color, back);
        assert.ok(ratio >= 4.5, `${name}: --${text} on ${where} is only ${ratio.toFixed(2)}:1`);
      }
    }
    const btn = contrast(hex(b, 'accent-ink'), hex(b, 'accent'));
    assert.ok(btn >= 4.5, `${name}: primary button text is only ${btn.toFixed(2)}:1`);
  }
});

test('matrix rain helpers', () => {
  assert.equal(columnCount(1366), 86);
  assert.equal(columnCount(0), 1);
  assert.equal(rainbowColor(0), 'hsl(0, 100%, 60%)');
  assert.notEqual(rainbowColor(0), rainbowColor(4000), 'rainbow changes over time');
});

test('duel snippets and defend scoring', () => {
  assert.equal(new Set(SNIPPETS).size, SNIPPETS.length, 'duplicate snippet');
  for (const s of SNIPPETS) assert.ok(s.length >= 5 && s.length <= 32, s);
  assert.equal(score({ nodes: startNodes(), loot: 0 }), 360);
  assert.equal(score({ nodes: startNodes(), loot: 40 }), 400);
  assert.equal(breachTime(0), 5000);
});

// ---------------------------------------------------------------------------
// Quick hacks
// ---------------------------------------------------------------------------
const QUICK = { letterlock, printmatch, signaltune, circuit, memory, wirecut, portsweep, bitflip };
const QSEEDS = SEEDS.slice(0, 200);

test('quick hacks: every mini-game is its own easy mode, listed after the classic modes', () => {
  assert.deepEqual(MODE_ORDER.slice(0, 4), ['race', 'duel', 'defend', 'heist'], 'classic modes keep their lobby slots');
  for (const id of Object.keys(QUICK)) {
    const m = MODES[id];
    assert.ok(m && m.quick && m.bots && m.min === 1 && m.max === 8, `${id} is a 1-8 player quick mode`);
    assert.ok(MODE_ORDER.includes(id));
    assert.equal(fmtTime(roundTime(m, 'normal')), '3:00');
    assert.ok(PUZZLES[id].howTo && PUZZLES[id].blurb);
  }
});

test('quick hacks: same seed and stage gives the same puzzle for everyone', () => {
  for (const [id, mod] of Object.entries(QUICK)) {
    for (let st = 0; st < STAGES; st++) {
      const a = mod.generate(stageRng(id, 42, st), st);
      const b = mod.generate(stageRng(id, 42, st), st);
      assert.deepEqual(a, b, `${id} stage ${st}`);
    }
    assert.notDeepEqual(mod.generate(stageRng(id, 1, 0), 0), mod.generate(stageRng(id, 2, 0), 0), `${id} differs per seed`);
  }
});

test('letter lock: every password letter appears exactly once in its column, and it gets harder', () => {
  for (const seed of QSEEDS) {
    let prevLen = 0, prevSpeed = 0;
    for (let st = 0; st < STAGES; st++) {
      const d = letterlock.generate(stageRng('letterlock', seed, st), st);
      assert.ok(d.password.length > prevLen);
      d.strips.forEach((s, i) => assert.equal(s.letters.filter((c) => c === d.password[i]).length, 1));
      const avg = d.strips.reduce((n, s) => n + s.speed, 0) / d.strips.length;
      assert.ok(avg >= prevSpeed - 0.4);
      prevLen = d.password.length;
      prevSpeed = avg;
    }
  }
  // The highlighted letter cycles through the whole strip over time.
  const strip = { letters: [...'ABCDEFGHIJ'], speed: 2, dir: -1, offset: 3 };
  const seen = new Set();
  for (let ms = 0; ms < 6000; ms += 100) seen.add(letterlock.letterAt(strip, ms));
  assert.equal(seen.size, 10);
});

test('print match: the real parts are in the grid and no look-alike is an exact copy', () => {
  for (const seed of QSEEDS) {
    for (let st = 0; st < STAGES; st++) {
      const d = printmatch.generate(stageRng('printmatch', seed, st), st);
      const real = d.options.filter((o) => o.real);
      assert.equal(real.length, d.parts.length);
      assert.equal(d.options.length, d.cols * 2);
      for (const o of d.options) {
        if (o.real) assert.ok(d.parts.some((p) => printmatch.distance(p, o.bits) === 0));
        else assert.ok(d.parts.every((p) => printmatch.distance(p, o.bits) > 0), 'decoy is not a real part');
      }
    }
  }
});

test('signal tune: the target is within reach and the start never already matches', () => {
  for (const seed of QSEEDS) {
    for (let st = 0; st < STAGES; st++) {
      const d = signaltune.generate(stageRng('signaltune', seed, st), st);
      assert.deepEqual(d.knobs, signaltune.STAGE_KNOBS[st]);
      for (const [k, K] of Object.entries(signaltune.KNOBS)) {
        assert.ok(d.target[k] >= K.min && d.target[k] <= K.max);
        if (d.knobs.includes(k)) assert.ok(Math.abs(d.start[k] - d.target[k]) >= 2, 'used knobs start off target');
        else assert.equal(d.start[k], d.target[k], 'unused knobs already match');
      }
    }
  }
});

test('circuit path: every maze has a route to the exit, and mazes grow', () => {
  for (const seed of QSEEDS) {
    let prev = 0;
    for (let st = 0; st < STAGES; st++) {
      const m = circuit.generate(stageRng('circuit', seed, st), st);
      assert.ok(m.size > prev);
      prev = m.size;
      const path = circuit.solvePath(m);
      assert.ok(path && path.length >= 2 * (m.size - 1), 'reachable');
      // Walls are two-sided: if you can go east from A, you can go west from B.
      for (let y = 0; y < m.size; y++) for (let x = 0; x + 1 < m.size; x++) {
        assert.equal(circuit.canMove(m, [x, y], circuit.E), circuit.canMove(m, [x + 1, y], circuit.W));
      }
      // Walking the route ends on the exit.
      let pos = [...m.start];
      const step = { [circuit.N]: [0, -1], [circuit.E]: [1, 0], [circuit.S]: [0, 1], [circuit.W]: [-1, 0] };
      for (const d of path) { assert.ok(circuit.canMove(m, pos, d)); pos = [pos[0] + step[d][0], pos[1] + step[d][1]]; }
      assert.deepEqual(pos, m.exit);
    }
  }
});

test('code memory: one cell per column, decoys never match the real code, harder each stage', () => {
  for (const seed of QSEEDS) {
    let prev = { cols: 0, rows: 0, n: 0 };
    for (let st = 0; st < STAGES; st++) {
      const d = memory.generate(stageRng('memory', seed, st), st);
      assert.equal(d.answer.length, d.cols);
      d.answer.forEach((r) => assert.ok(r >= 0 && r < d.rows));
      for (const dec of d.decoys) {
        assert.equal(dec.length, d.cols);
        dec.forEach((r) => assert.ok(r >= 0 && r < d.rows));
        assert.ok(dec.some((r, c) => r !== d.answer[c]), 'decoy differs from the code');
      }
      assert.ok(d.cols >= prev.cols && d.rows >= prev.rows && d.decoys.length > prev.n);
      prev = { cols: d.cols, rows: d.rows, n: d.decoys.length };
    }
  }
  assert.equal(memory.REAL_FLASHES, 3);
});

test('quick hack stats text', () => {
  assert.equal(quickStatsText({ stage: 5, mistakes: 2, fastest: 9000 }), '5/5 stages · 2 mistakes · fastest stage 0:09');
  assert.equal(quickStatsText({ stage: 1, mistakes: 1 }), '1/5 stages · 1 mistake');
  assert.equal(quickStatsText(), '0/5 stages · 0 mistakes');
});

test('wire cut: exactly one rule applies, and it names real, distinct wires in order', () => {
  for (const seed of QSEEDS) {
    for (let st = 0; st < STAGES; st++) {
      const d = wirecut.generate(stageRng('wirecut', seed, st), st);
      assert.equal(new Set(d.order).size, d.order.length);
      d.order.forEach((i) => assert.ok(i >= 0 && i < d.wires.length));
      const real = d.rules.findIndex((r) => r.real);
      assert.ok(real >= 0, 'has a real rule');
      // Re-solve from the card text: every rule before the real one must be false.
      for (const r of d.rules.slice(0, real)) assert.ok(!ruleTrue(r.text, d.wires), `decoy is false: ${r.text} / ${d.wires}`);
      if (!d.rules[real].text.startsWith('Otherwise')) assert.ok(ruleTrue(d.rules[real].text, d.wires), d.rules[real].text);
      const cuts = d.rules[real].text.split(/: cut |, then /).slice(1).map((t) => findWire(t.replace(/\.$/, ''), d.wires));
      assert.deepEqual(cuts, d.order, d.rules[real].text);
    }
  }
  function ruleTrue(text, w) {
    const cond = text.match(/^If (.*): cut/)[1];
    const n = (c) => w.filter((x) => x === c).length;
    let m;
    if ((m = cond.match(/more than (\d+) (\w+) wires?/))) return m[2] === 'wires' ? w.length > Number(m[1]) : n(m[2]) > Number(m[1]);
    if ((m = cond.match(/no (\w+) wires/))) return n(m[1]) === 0;
    if ((m = cond.match(/last wire is (\w+)/))) return w[w.length - 1] === m[1];
    if ((m = cond.match(/first wire is (\w+)/))) return w[0] === m[1];
    if ((m = cond.match(/an (odd|even) number/))) return (w.length % 2 ? 'odd' : 'even') === m[1];
    if (cond === 'there is at least 1 wire') return true;
    throw new Error('unknown rule ' + cond);
  }
  function findWire(t, w) {
    let m;
    if ((m = t.match(/^the first (\w+) wire$/))) return w.indexOf(m[1]);
    if ((m = t.match(/^the last (\w+) wire$/))) return w.lastIndexOf(m[1]);
    if ((m = t.match(/^wire (\d+)$/))) return Number(m[1]) - 1;
    throw new Error('unknown wire ' + t);
  }
});

test('port sweep: harder each stage, and the open order never repeats a port back to back', () => {
  let prev = { need: 0, openMs: Infinity };
  for (let st = 0; st < STAGES; st++) {
    const d = portsweep.generate(stageRng('portsweep', 7, st), st);
    assert.ok(d.need > prev.need && d.openMs < prev.openMs);
    // Enough ports open in a 3-minute round to clear the stage many times over.
    assert.ok(180000 / (d.openMs * 0.6 + d.gapMs) > d.need * 5);
    const seq = portsweep.openSequence(d, 100);
    seq.forEach((p, i) => { assert.ok(p >= 0 && p < d.size * d.size); if (i) assert.notEqual(p, seq[i - 1]); });
    assert.deepEqual(seq, portsweep.openSequence(d, 100), 'same order for everyone');
    prev = d;
  }
});

test('bit flip: the target is always reachable with the switches', () => {
  for (const seed of QSEEDS) {
    for (let st = 0; st < STAGES; st++) {
      const d = bitflip.generate(stageRng('bitflip', seed, st), st);
      assert.ok(d.target >= 1 && d.target <= d.values.reduce((a, b) => a + b, 0));
      // Greedy from the biggest switch always reaches it (values are powers of two).
      let left = d.target;
      for (const v of d.values) if (v <= left) left -= v;
      assert.equal(left, 0);
      assert.equal(d.hex, st >= 3);
    }
  }
  assert.equal(bitflip.show(171, true), '0xAB');
});

test('hack gauntlet: a different real mini-game every stage, the same for everyone', () => {
  assert.equal(MODE_ORDER[4], 'gauntlet');
  assert.ok(MODES.gauntlet.quick && MODES.gauntlet.bots);
  assert.equal(fmtTime(roundTime(MODES.gauntlet, 'normal')), '4:00');
  const kinds = new Set();
  for (const seed of QSEEDS) {
    const order = gauntletOrder(seed);
    assert.equal(order.length, STAGES);
    assert.equal(new Set(order).size, STAGES, 'no repeats');
    assert.deepEqual(order, gauntletOrder(seed));
    order.forEach((id, st) => { assert.ok(PUZZLES[id]); assert.equal(GAUNTLET.pick(seed, st).id, id); kinds.add(id); });
  }
  assert.equal(kinds.size, Object.keys(PUZZLES).length, 'every mini-game shows up');
});

test('teams: balancing, start checks, and who wins', async () => {
  const { balanceTeams, teamProblem, teamWinner, teamLeader } = await import('../src/teams.js');
  const ppl = (h, b) => [...Array.from({ length: h }, (_, i) => ({ id: 'h' + i })), ...Array.from({ length: b }, (_, i) => ({ id: 'b' + i, bot: true }))];
  for (let size = 1; size <= 4; size++) {
    for (let humans = 1; humans <= size * 2; humans++) {
      const list = ppl(humans, size * 2 - humans);
      const t = balanceTeams(list, size);
      const withTeams = list.map((p) => ({ ...p, team: t[p.id] }));
      assert.equal(teamProblem(withTeams, size), '', `${size}v${size} with ${humans} humans is ready`);
      const hA = withTeams.filter((p) => !p.bot && p.team === 'A').length;
      assert.ok(Math.abs(hA - (humans - hA)) <= 1, 'humans are spread across teams');
    }
  }
  // Too many players: the extras get no team, so the round can't start.
  const extra = ppl(3, 0);
  const t = balanceTeams(extra, 1);
  assert.equal(Object.values(t).filter((x) => x === null).length, 1);
  assert.match(teamProblem(extra.map((p) => ({ ...p, team: t[p.id] })), 1), /picked a team/);
  assert.match(teamProblem([{ team: 'A' }, { team: 'A' }], 1), /1v1 needs 1 on each team \(now 2 vs 0\)/);
  assert.equal(teamProblem([{ team: 'A' }], 0), '', 'free-for-all never blocks');
  // A team only loses once everyone on it is down.
  const state = [{ team: 'A', out: true, hp: 0 }, { team: 'A', out: false, hp: 10 }, { team: 'B', out: false, hp: 90 }];
  assert.equal(teamWinner(state), null);
  state[1].out = true;
  assert.equal(teamWinner(state), 'B');
  assert.equal(teamLeader([{ team: 'A', hp: 60 }, { team: 'B', hp: 40 }, { team: 'B', hp: 30 }]), 'B');
  assert.equal(teamLeader([{ team: 'A', hp: 50 }, { team: 'B', hp: 50 }]), null);
});

test('letter lock: a press just past the line still counts, a far one does not', () => {
  const strip = { letters: [...'ABCDEFGHIJ'], speed: 1, dir: 1, offset: 0 };
  assert.equal(letterlock.lockable(strip, 0, 'A'), 0, 'dead center');
  assert.equal(letterlock.lockable(strip, 600, 'A'), 0, 'B is nearer, but A is still within reach');
  assert.equal(letterlock.lockable(strip, 600, 'B'), 1);
  assert.equal(letterlock.lockable(strip, 900, 'A'), -1, 'too late');
  assert.equal(letterlock.lockable(strip, 0, 'E'), -1, 'far away');
});

test('xp: levels cost a bit more each time, and better results earn more', async () => {
  const { levelFor, levelCost, xpForRound, TITLES, UNLOCK_COLORS, titlesFor } = await import('../src/progress.js');
  assert.deepEqual(levelFor(0), { level: 1, into: 0, need: 100 });
  assert.equal(levelFor(99).level, 1);
  assert.equal(levelFor(100).level, 2);
  assert.equal(levelFor(250).level, 3);
  let prev = 0;
  for (let xp = 0; xp < 20000; xp += 37) { const l = levelFor(xp).level; assert.ok(l >= prev); prev = l; }
  for (let l = 1; l < 30; l++) assert.ok(levelCost(l + 1) > levelCost(l));
  // More players beaten = more XP; winning adds a bonus; everyone gets something.
  assert.equal(xpForRound({ place: 1, players: 1, won: true }), 45);
  assert.ok(xpForRound({ place: 1, players: 4, won: true }) > xpForRound({ place: 2, players: 4 }));
  assert.ok(xpForRound({ place: 2, players: 4 }) > xpForRound({ place: 4, players: 4 }));
  assert.equal(xpForRound({ place: 4, players: 4 }), 20);
  assert.equal(xpForRound({ modeId: 'tutorial' }), 50);
  for (let i = 1; i < TITLES.length; i++) assert.ok(TITLES[i][0] > TITLES[i - 1][0], 'titles unlock in order');
  for (let i = 1; i < UNLOCK_COLORS.length; i++) assert.ok(UNLOCK_COLORS[i][0] > UNLOCK_COLORS[i - 1][0]);
  assert.deepEqual(titlesFor(1), ['script kiddie']);
  assert.equal(titlesFor(99).length, TITLES.length);
});

test('daily challenge: one seed per day, and mistakes add time', async () => {
  const { dailySeed, dailyScore, todayKey, PENALTY_MS } = await import('../src/daily.js');
  assert.equal(dailySeed('2026-11-22'), dailySeed('2026-11-22'));
  assert.notEqual(dailySeed('2026-11-22'), dailySeed('2026-11-23'));
  assert.ok(Number.isInteger(dailySeed('2026-11-22')) && dailySeed('2026-11-22') >= 0);
  assert.equal(todayKey(new Date('2026-11-22T23:59:00Z')), '2026-11-22');
  assert.equal(dailyScore({ ms: 61234.4, mistakes: 2 }), 61234 + 2 * PENALTY_MS);
  assert.equal(dailyScore({ ms: 40000, mistakes: 0 }), 40000);
  // The day's seed picks the same gauntlet for everyone.
  assert.deepEqual(gauntletOrder(dailySeed('2026-11-22')), gauntletOrder(dailySeed('2026-11-22')));
});

test('database rules: the daily board is valid JSON with a checked score', () => {
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url)));
  const d = rules.rules.daily;
  assert.ok(d['.read'] && d.$date['.indexOn'].includes('score'));
  assert.match(d.$date.$uid['.write'], /auth\.uid === \$uid/);
  assert.match(d.$date.$uid['.validate'], /\* 5000/);
});

test('global leaderboard: your row comes from your progress, and the rules protect it', async () => {
  const { myStats, winRate } = await import('../src/stats.js');
  const s = myStats({ xp: 260, rounds: 4, wins: 3, title: '' });
  assert.equal(s.level, 3);
  assert.equal(s.title, 'packet pusher');
  assert.equal(s.wins, 3);
  assert.equal(winRate(s), 75);
  assert.equal(winRate({ rounds: 0, wins: 0 }), 0);
  assert.equal(myStats({ xp: 0, rounds: 1, wins: 5, title: '' }).wins, 1, 'wins never exceed rounds');
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url))).rules.stats;
  assert.ok(rules['.read'] && rules['.indexOn'].includes('xp'));
  assert.match(rules.$uid['.write'], /auth\.uid === \$uid/);
  assert.match(rules.$uid['.validate'], /\+ 500/);
});

test('google accounts: handles, and progress after signing in', async () => {
  const { validHandle, suggestHandle, mergeProgress } = await import('../src/account.js');
  for (const h of ['ab', 'n3m0', 'Zero_Day.99', 'a-b']) assert.ok(validHandle(h), h);
  for (const h of ['a', 'way_too_long_handle', 'has space', 'émoji', '']) assert.ok(!validHandle(h), h);
  assert.ok(validHandle(suggestHandle('Jane Doe!')));
  assert.equal(suggestHandle('Jane Doe!'), 'JaneDoe');
  assert.ok(validHandle(suggestHandle('x')));
  // First sign-in: this device's progress goes up to the account.
  const local = { xp: 300, rounds: 5, wins: 2, title: '' };
  assert.deepEqual(mergeProgress(local, null), { progress: local, upload: true });
  // Later: the account's progress wins (it may have been played elsewhere).
  const m = mergeProgress(local, { xp: 900, rounds: 20, wins: 9, handle: 'n3m0' });
  assert.equal(m.upload, false);
  assert.equal(m.progress.xp, 900);
  assert.equal(m.progress.rounds, 20);
  // The rules only let signed-in Google accounts post, under their own handle.
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url))).rules;
  for (const w of [rules.stats.$uid['.write'], rules.daily.$date.$uid['.write']]) {
    assert.match(w, /email_verified === true/);
    assert.match(w, /child\('handle'\)/);
  }
});

test('password accounts: logins, messages, and rules', async () => {
  const { loginAddress, loginEmailFor, isEmail, authMessage, LOGIN_DOMAIN } = await import('../src/account.js');
  assert.equal(loginEmailFor('Zero_Day'), `zero_day@${LOGIN_DOMAIN}`);
  assert.equal(loginAddress('  n3m0 '), `n3m0@${LOGIN_DOMAIN}`, 'a username logs in with its made-up address');
  assert.equal(loginAddress('me@school.org'), 'me@school.org', 'an email logs in as itself');
  assert.ok(isEmail('a@b.co') && !isEmail('nope') && !isEmail('a@b'));
  assert.match(authMessage({ code: 'auth/invalid-credential' }), /Wrong username\/email or password/);
  assert.match(authMessage({ code: 'auth/operation-not-allowed' }), /Enable Email\/Password/);
  // Google (verified) and password accounts can both save progress and post scores.
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url))).rules;
  for (const w of [rules.users.$uid['.write'], rules.handles.$name['.write'], rules.stats.$uid['.write'], rules.daily.$date.$uid['.write']]) {
    assert.match(w, /sign_in_provider === 'password'/);
    assert.match(w, /email_verified === true/);
  }
});

test('special titles: only the named account gets one', async () => {
  const { specialTitle } = await import('../src/progress.js');
  const { myStats } = await import('../src/stats.js');
  assert.equal(specialTitle('brisky2swifty'), '👑 owner');
  assert.equal(specialTitle('Brisky2Swifty'), '👑 owner', 'any capitalization');
  assert.equal(specialTitle('someone'), null);
  assert.equal(myStats({ xp: 0, rounds: 0, wins: 0, title: '' }, { name: 'brisky2swifty' }).title, '👑 owner');
  assert.equal(myStats({ xp: 0, rounds: 0, wins: 0, title: '' }, { name: 'n3m0' }).title, 'script kiddie');
});

test('trophies: 50+ unique trophies, a new weekly one each week, and unlocking works', async () => {
  const T = await import('../src/trophies.js');
  assert.ok(T.TROPHIES.length >= 50, `${T.TROPHIES.length} trophies`);
  assert.equal(new Set(T.TROPHIES.map((t) => t.id)).size, T.TROPHIES.length, 'ids are unique');
  for (const t of T.TROPHIES) assert.ok(t.name && t.desc && t.icon && /^[a-z0-9-]+$/.test(t.id), t.id);
  // Weeks: Monday to Sunday share a key, the next Monday is a new week.
  assert.equal(T.weekKey(new Date('2026-11-23T00:00:00Z')), T.weekKey(new Date('2026-11-29T23:59:00Z')));
  assert.notEqual(T.weekKey(new Date('2026-11-29T23:59:00Z')), T.weekKey(new Date('2026-11-30T00:00:00Z')));
  assert.equal(T.weekEndsAt(new Date('2026-11-25T12:00:00Z')), Date.UTC(2026, 10, 30));
  // The weekly trophy is the same for everyone that week, and changes over the weeks.
  const weeks = Array.from({ length: 20 }, (_, i) => T.weekKey(new Date(Date.UTC(2026, 0, 5 + 7 * i))));
  assert.equal(new Set(weeks).size, 20);
  const kinds = new Set(weeks.map((w) => T.weeklyFor(w).name));
  assert.ok(kinds.size >= 6, 'weekly challenges vary');
  assert.deepEqual(T.weeklyFor(weeks[0]).name, T.weeklyFor(weeks[0]).name);
  for (const w of weeks) { const wk = T.weeklyFor(w); assert.ok(wk.id === `weekly-${w}` && wk.target >= 1 && typeof wk.match === 'function'); }
  // Playing rounds unlocks trophies.
  const ev = { mode: 'gauntlet', won: true, players: 3, humans: 1, host: true, online: false, daily: false, botLevel: 'hard', teamSize: 0, clear: true, mistakes: 0, ms: 45000, hour: 23, day: 6, date: '2026-11-28', week: '2026-W48' };
  let { state, unlocked } = T.applyRound(T.emptyState(), ev, 1);
  const ids = unlocked.map((t) => t.id);
  for (const id of ['rounds-1', 'wins-1', 'beat-hard', 'win-gauntlet', 'quickclears-1', 'flawless-1', 'speedrun', 'night-owl', 'weekend']) assert.ok(ids.includes(id), id);
  // Nothing unlocks twice.
  ({ unlocked } = T.applyRound(state, ev, 1));
  assert.ok(!unlocked.some((t) => ids.includes(t.id)));
  // Merging two devices keeps everything.
  const merged = T.mergeTrophies(state, { unlocked: { 'level-3': 1 }, c: { rounds: 7, modeWins: { race: 2 } } });
  assert.ok(merged.unlocked['level-3'] && merged.unlocked['wins-1']);
  assert.equal(merged.c.rounds, 7);
  assert.equal(merged.c.modeWins.race, 2);
  assert.equal(merged.c.modeWins.gauntlet, 1);
});

test('multiplayer lobby rules: listings belong to the host, chat is append-only', () => {
  const lobby = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url))).rules.lobby;
  assert.equal(lobby['.read'], 'auth != null');
  assert.match(lobby.rooms.$code['.write'], /hostId'\)\.val\(\) === auth\.uid/);
  assert.match(lobby.rooms.$code['.validate'], /child\('host'\)\.val\(\) === auth\.uid/);
  assert.match(lobby.chat.$msg['.write'], /!data\.exists\(\)/, 'messages cannot be edited or deleted by others');
  assert.match(lobby.chat.$msg['.validate'], /length <= 200/);
});

test('special-title badges: names are matched however they are shown', async () => {
  const { bareName } = await import('../src/badges.js');
  const { specialTitle, specialKind, OWNERS, ALPHA_TESTERS } = await import('../src/progress.js');
  for (const shown of ['brisky2swifty', 'brisky2swifty (you)', 'brisky2swifty:', 'brisky2swifty [A]', '  brisky2swifty  ']) {
    assert.equal(bareName(shown), 'brisky2swifty', shown);
    assert.equal(specialTitle(bareName(shown)), '👑 owner');
  }
  assert.equal(specialKind('BRISKY2SWIFTY'), 'owner');
  assert.equal(specialKind('n3m0'), null);
  for (const n of [...OWNERS, ...ALPHA_TESTERS]) assert.equal(n, n.toLowerCase(), 'lists are lowercase');
});

test('online players and private chats: only the two people in a chat can read or write it', async () => {
  const { convId } = await import('../src/net/shared.js');
  assert.equal(convId('bob', 'alice'), convId('alice', 'bob'), 'same chat from either side');
  const R = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url))).rules;
  assert.match(R.presence.$uid['.write'], /auth\.uid === \$uid/);
  assert.match(R.dms.$conv['.read'], /beginsWith\(auth\.uid \+ '_'\)/);
  assert.match(R.dms.$conv.$msg['.write'], /!data\.exists\(\)/);
  assert.match(R.inbox.$uid['.read'], /auth\.uid === \$uid/);
  assert.match(R.inbox.$uid.$conv['.write'], /child\('dm'\)\.val\(\) !== false/, 'people with messages off cannot be messaged');
});
