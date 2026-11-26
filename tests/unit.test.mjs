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
import { banUntil, activeBan, describeBan, FOREVER } from '../src/owner.js';
import { OWNERS } from '../src/progress.js';
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
  assert.equal(normalizeSettings({ music: -2 }).music, 0, 'music volume is clamped');
  assert.equal(normalizeSettings({ music: 'loud' }).music, defaultSettings().music);
  assert.equal(normalizeSettings({ keyClicks: true }).keyClicks, true);
  // The system's reduced-motion preference turns off motion and scanlines by default.
  assert.deepEqual(defaultSettings(true), { scanlines: false, textSize: 'normal', reduceMotion: true, highContrast: false, volume: 0.7, music: 0.3, keyClicks: false, matrixRain: false, rainbowRain: false, style: 'green' });
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
  const styles = { green: block(':root'), cyber: block('html[data-style="cyber"]'), amber: block('html[data-style="amber"]'), gold: block('html[data-style="gold"]') };
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
  assert.equal(MODE_ORDER[MODE_ORDER.indexOf('koth') + 1], 'gauntlet', 'the gauntlet leads the quick hacks');
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

test('saved account chats: rules keep them between the two signed-in accounts', () => {
  const R = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url))).rules;
  for (const w of [R.adms.$conv['.read'], R.adms.$conv.$msg['.write'], R.ainbox.$uid.$conv['.write']]) {
    assert.match(w, /sign_in_provider === 'password'/, 'accounts only');
    assert.match(w, /beginsWith\(auth\.uid \+ '_'\)/, 'only people in the chat');
  }
  assert.match(R.ainbox.$uid['.read'], /auth\.uid === \$uid/);
  assert.match(R.ainbox.$uid.$conv['.write'], /child\('dm'\)\.val\(\) !== false/, 'respects private messages off');
});

test('effects: scramble settles on the real text, confetti falls and fades', async () => {
  const { scrambleFrame } = await import('../src/fx/scramble.js');
  assert.equal(scrambleFrame('// MISSION REPORT', 1), '// MISSION REPORT');
  const mid = scrambleFrame('HELLO WORLD', 0.5, () => 0);
  assert.equal(mid.length, 11);
  assert.ok(mid.startsWith('HELLO'), 'settled from the left');
  assert.equal(mid[5], ' ', 'spaces stay put');
  const { makePiece, stepPiece } = await import('../src/fx/confetti.js');
  const p = makePiece(100, 500, () => 0.5);
  assert.ok(p.vy < 0, 'shoots upward first');
  let frames = 0;
  while (stepPiece(p, 600) && frames < 2000) frames++;
  assert.ok(frames > 20 && frames < 2000, `lands or fades (${frames} frames)`);
});

test('avatars: the same name always looks the same, mirrored, never blank', async () => {
  const { avatarCells } = await import('../src/avatar.js');
  const a = avatarCells('brisky2swifty');
  assert.deepEqual(a, avatarCells('Brisky2Swifty'), 'case does not matter');
  assert.notDeepEqual(a, avatarCells('n3m0'), 'different names differ');
  for (const name of ['a', 'bob', 'zero_day', 'x'.repeat(14), '']) {
    const c = avatarCells(name);
    assert.equal(c.length, 25);
    assert.ok(c.some(Boolean), 'never blank');
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) assert.equal(c[y * 5 + x], c[y * 5 + (4 - x)], 'mirrored');
  }
});

// ---------------------------------------------------------------------------
// Owner tools
// ---------------------------------------------------------------------------
test('owner: ban lengths and active bans', () => {
  const now = 1_000_000;
  assert.equal(banUntil('1h', now), now + 3600000);
  assert.equal(banUntil('1d', now), now + 86400000);
  assert.equal(banUntil('forever', now), FOREVER);
  const bans = { tab1: { until: now + 60000, name: 'x' }, old: { until: now - 1 }, acct9: { until: FOREVER } };
  assert.equal(activeBan(bans, ['nobody'], now), null);
  assert.equal(activeBan(bans, ['old'], now), null, 'expired bans do not count');
  assert.equal(activeBan(bans, [null, 'tab1'], now).id, 'tab1');
  assert.equal(activeBan(bans, ['acct9'], now).id, 'acct9', 'an account ban covers every tab');
  assert.equal(describeBan(bans.tab1, now), 'for 1 more minute');
  assert.equal(describeBan({ until: now + 3 * 3600000 }, now), 'for 3 more hours');
  assert.equal(describeBan(bans.acct9, now), 'permanently');
});

test('owner: gold style is a valid setting (only applied for the owner)', () => {
  assert.equal(normalizeSettings({ style: 'gold' }).style, 'gold');
});

// The database rules are what really protect the owner's name and powers.
test('owner: database rules protect the owner name and owner powers', () => {
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  const owner = OWNERS[0];
  const reserved = `contains('${owner}')`;
  // Every place a player name is stored refuses the owner's name for anyone else.
  const namePaths = [
    rules.rooms.$code.players.$uid.name['.validate'],
    rules.rooms.$code.chat.$msg.name['.validate'],
    rules.rooms.$code.results.$i.name['.validate'],
    rules.lobby.chat.$msg['.validate'],
    rules.lobby.rooms.$code['.validate'],
    rules.presence.$uid['.validate'],
    rules.dms.$conv.$msg['.validate'],
    rules.inbox.$uid.$conv['.validate'],
    rules.adms.$conv.$msg['.validate'],
    rules.ainbox.$uid.$conv['.validate'],
  ];
  for (const r of namePaths) {
    assert.ok(r.includes(reserved), 'missing owner-name check: ' + r.slice(0, 80));
    assert.ok(r.includes("root.child('roles')"), 'owner check must come from roles/');
  }
  assert.ok(rules.handles.$name['.write'].includes(`$name !== '${owner}'`), 'only the owner may claim the owner handle');
  // Nobody can make themselves owner from the game.
  assert.equal(rules.roles['.write'], false);
  // Only the owner account can ban or announce.
  for (const w of [rules.bans.$id['.write'], rules.announce['.write']]) assert.equal(w, "auth != null && root.child('roles').child(auth.uid).val() === 'owner'");
  // Banned players are refused in lobby chat, public rooms, joining rooms and private messages.
  for (const w of [rules.lobby.chat.$msg['.write'], rules.lobby.rooms.$code['.write'], rules.rooms.$code.players.$uid['.write'], rules.dms.$conv.$msg['.write']]) {
    assert.ok(w.includes("root.child('bans').child(auth.uid)"), 'missing ban check: ' + w.slice(0, 80));
  }
  // A tab only counts as the owner when it's linked from both sides.
  assert.equal(rules.sessions.$tab['.write'], 'auth != null && auth.uid === $tab');
  assert.equal(rules.acctSessions.$acct['.write'], 'auth != null && auth.uid === $acct');
  // Players can delete their own leaderboard rows (Delete my account).
  assert.ok(rules.stats.$uid['.write'].startsWith('(auth != null && auth.uid === $uid && !newData.exists())'));
});

// "Correct name and password but it won't log in": an account made with an
// email can't log in with its username, so the message has to say that.
test('login: failed logins explain username vs email and Caps Lock', async () => {
  const { loginFailMessage } = await import('../src/account.js');
  const wrong = { code: 'auth/invalid-credential' };
  const byName = loginFailMessage(wrong, 'brisky2swifty');
  assert.match(byName, /signed up with an email, log in with your email/);
  assert.match(byName, /Caps Lock/);
  const byEmail = loginFailMessage(wrong, 'me@school.org');
  assert.ok(!/signed up with an email/.test(byEmail), 'no email hint when they used their email');
  assert.match(byEmail, /case-sensitive/);
  assert.match(loginFailMessage({ code: 'auth/too-many-requests' }, 'x'), /Too many tries/);
  assert.match(loginFailMessage({ code: 'auth/network-request-failed' }, 'x'), /No connection/);
});

// ---------------------------------------------------------------------------
// More trophies (overnight #1)
// ---------------------------------------------------------------------------
test('trophies: 130+ in total, unique, with secret ones', async () => {
  const { TROPHIES } = await import('../src/trophies.js');
  assert.ok(TROPHIES.length >= 130, `only ${TROPHIES.length}`);
  const ids = TROPHIES.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate trophy id');
  for (const tr of TROPHIES) assert.ok(tr.icon && tr.name && tr.desc && tr.cat && typeof tr.test === 'function', tr.id);
  assert.ok(TROPHIES.filter((x) => x.secret).length >= 8, 'secret trophies');
});

test('trophies: skill trophies unlock from real round stats', async () => {
  const { applyRound, roundEvent, emptyState } = await import('../src/trophies.js');
  const play = (state, room, mine, won, now = new Date('2026-03-10T12:00:00Z'), withOwner = false) =>
    applyRound(state, roundEvent({ room, mine, won, now, withOwner }), 1).state;
  const ids = (s) => Object.keys(s.unlocked);
  let s = emptyState();
  // Race: root in 100 s with no hints.
  s = play(s, { mode: 'race', startedAt: 0, endedAt: 100000, players: { me: { s: { layer: 5, at: 100000, hints: 0 } } }, results: [{ id: 'me', place: 1 }] }, { id: 'me', place: 1 }, true);
  for (const id of ['race-nohint', 'race-3min', 'race-2min']) assert.ok(ids(s).includes(id), id);
  // Duel: 500 correct chars in 1 minute = 100 WPM, 12 hits, no typos, full HP.
  s = play(s, { mode: 'duel', startedAt: 0, endedAt: 60000, players: { me: { s: { hp: 100, stats: { hits: 12, misses: 0, chars: 500 } } } }, results: [{ id: 'me', place: 1 }] }, { id: 'me', place: 1 }, true);
  for (const id of ['duel-60', 'duel-90', 'duel-perfect', 'duel-untouched']) assert.ok(ids(s).includes(id), id);
  // Defend: 320 stolen, 5 attacks stopped, every firewall standing.
  const nodes = { web: { fw: 1, data: 100 }, db: { fw: 2, data: 200 }, mail: { fw: 1, data: 60 } };
  s = play(s, { mode: 'defend', startedAt: 0, endedAt: 1, players: { me: { s: { loot: 320, nodes, stats: { kills: 5 } } } } }, { id: 'me', place: 1 }, true);
  for (const id of ['defend-thief', 'defend-wall', 'defend-fortress']) assert.ok(ids(s).includes(id), id);
  // Heist: nobody slipped up, alarm low, 5 cameras looped.
  s = play(s, { mode: 'heist', game: { alarm: 20 }, players: { me: { s: { stats: { mistakes: 0, loops: 5 } } }, b: { s: { stats: { mistakes: 0 } } } } }, { id: 'me', place: 0 }, true);
  for (const id of ['heist-clean', 'heist-quiet', 'heist-lookout']) assert.ok(ids(s).includes(id), id);
  // A sloppy heist doesn't count as clean.
  let s2 = play(emptyState(), { mode: 'heist', game: { alarm: 90 }, players: { me: { s: { stats: { mistakes: 2 } } } } }, { id: 'me' }, true);
  assert.ok(!ids(s2).includes('heist-clean') && !ids(s2).includes('heist-quiet'));
});

test('trophies: secret trophies (owner, comeback, dates) and day streaks', async () => {
  const { applyRound, roundEvent, emptyState, runEnding } = await import('../src/trophies.js');
  const room = { mode: 'race', players: { me: { s: {} } } };
  const play = (s, won, date, withOwner = false) => applyRound(s, roundEvent({ room, mine: { id: 'me' }, won, now: new Date(date), withOwner }), 1).state;
  let s = emptyState();
  s = play(s, false, '2026-10-29T12:00:00Z');
  s = play(s, false, '2026-10-30T12:00:00Z');
  s = play(s, false, '2026-10-31T12:00:00Z', true);
  s = play(s, true, '2026-10-31T13:00:00Z');
  const got = Object.keys(s.unlocked);
  for (const id of ['comeback', 'royal', 'halloween', 'three-in-a-row'.replace('three-in-a-row', 'bestdaystreak-3')]) assert.ok(got.includes(id), id);
  assert.equal(runEnding(['2026-01-01', '2026-01-02', '2026-01-04'], '2026-01-02'), 2);
  assert.equal(runEnding(['2026-01-01'], '2026-01-03'), 0);
});

test('group chats: names are tidied, inboxes sort into invites and groups, unread counts', async () => {
  const { cleanGroupName, sortGroupInbox, invitable, GROUP_NAME_MAX } = await import('../src/groups.js');
  assert.equal(cleanGroupName('  Byte   Squad  '), 'Byte Squad');
  assert.equal(cleanGroupName('x'.repeat(40)).length, GROUP_NAME_MAX);
  assert.equal(cleanGroupName('   '), '');
  const box = {
    g1: { name: 'Squad', text: 'hi', by: 'Neo', from: 'B', at: 50 },
    g2: { name: 'Mine', text: 'yo', by: 'Me', from: 'A', at: 60 },
    g3: { name: 'Invite', by: 'Trin', from: 'C', invite: true, at: 70 },
    g4: { name: 'Blocked invite', by: 'Pest', from: 'X', invite: true, at: 80 },
    g5: { name: 'Read', text: 'old', by: 'Neo', from: 'B', at: 10 },
  };
  const s = sortGroupInbox(box, 'A', { g5: 20 }, (id) => id === 'X');
  assert.deepEqual(s.invites.map((g) => g.gid), ['g3'], 'invites from blocked players are hidden');
  assert.deepEqual(s.groups.map((g) => g.gid), ['g2', 'g1', 'g5'], 'newest first');
  assert.deepEqual(s.groups.filter((g) => g.unread).map((g) => g.gid), ['g1'], 'your own and already-read messages are not unread');
  assert.equal(s.unread, 2);
  const online = [['tabB', { name: 'Neo', acct: 'accB' }], ['tabC', { name: 'Trin' }], ['tabD', { name: 'Quiet', dm: false }], ['tabE', { name: 'Pest' }], ['tabB2', { name: 'Neo', acct: 'accB' }]];
  const who = invitable(online, { members: { tabC: { name: 'Trin' } } }, (id) => id === 'tabE');
  assert.deepEqual(who.map((p) => p.id), ['accB'], 'signed-in players are invited as their account, once; members, DMs-off and blocked are left out');
});

test('database rules: group chats only let members in, and invites need a yes', async () => {
  const { createRulesSim } = await import('./rules-sim.mjs');
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url)));
  const db = createRulesSim(rules);
  const t = db.now - 5;
  const group = (owner, members) => ({ name: 'Squad', owner, at: t, members: Object.fromEntries(members.map((m) => [m, { name: m, at: t }])) });
  const msg = (from, text = 'hi') => ({ from, name: from, color: '#33ff66', text, at: t });
  const invite = (from) => ({ name: 'Squad', by: from, from, invite: true, text: '', at: t });

  // Making a group: only with yourself as the owner and only member.
  assert.equal(db.set('A', 'groups/gAAAAAA1', group('A', ['A', 'B'])), false, 'cannot put others in a new group');
  assert.equal(db.set('A', 'groups/gAAAAAA1', group('B', ['B'])), false, 'cannot make a group for someone else');
  assert.equal(db.set('A', 'groups/x', group('A', ['A'])), false, 'odd group ids are refused');
  assert.equal(db.set('A', 'groups/gAAAAAA1', { ...group('A', ['A']), name: 'Brisky2Swifty fans' }), false, 'the owner name is reserved');
  assert.equal(db.set('A', 'groups/gAAAAAA1', group('A', ['A'])), true);
  assert.equal(db.set(null, 'groups/gAAAAAA2', group('A', ['A'])), false, 'must be signed in');

  // Reading: members only.
  assert.equal(db.canRead('A', 'groups/gAAAAAA1'), true);
  assert.equal(db.canRead('B', 'groups/gAAAAAA1'), false);
  assert.equal(db.canRead('B', 'groupMsgs/gAAAAAA1'), false);
  assert.equal(db.canRead('B', 'ginbox/A'), false, 'your group list is private');

  // Joining needs an invite from a member, and the invitee's own yes.
  assert.equal(db.set('B', 'groups/gAAAAAA1/members/B', { name: 'B', at: t }), false, 'cannot join without an invite');
  assert.equal(db.set('B', 'ginbox/B/gAAAAAA1', invite('B')), false, 'cannot invite yourself');
  assert.equal(db.set('C', 'ginbox/B/gAAAAAA1', invite('C')), false, 'non-members cannot invite');
  assert.equal(db.set('A', 'groups/gAAAAAA1/members/B', { name: 'B', at: t }), false, 'members cannot add people directly');
  assert.equal(db.set('A', 'ginbox/B/gAAAAAA1', invite('A')), true, 'a member invites B');
  assert.equal(db.set('B', 'groups/gAAAAAA1/members/B', { name: 'B', at: t, extra: 1 }), false, 'no extra fields');
  assert.equal(db.set('B', 'groups/gAAAAAA1/members/B', { name: 'B', at: t }), true, 'B says yes');
  assert.equal(db.set('B', 'ginbox/B/gAAAAAA1', { name: 'Squad', text: '', by: '', from: 'B', at: t }), true);
  assert.equal(db.set('A', 'ginbox/B/gAAAAAA1', invite('A')), false, 'members cannot be re-invited (no fake invites)');

  // Messages: members only, as themselves, not banned, sensible lengths.
  assert.equal(db.set('B', 'groupMsgs/gAAAAAA1/m1', msg('B')), true);
  assert.equal(db.set('B', 'groupMsgs/gAAAAAA1/m1', msg('B', 'edit')), false, 'messages cannot be changed');
  assert.equal(db.set('B', 'groupMsgs/gAAAAAA1/m2', msg('A')), false, 'cannot post as someone else');
  assert.equal(db.set('C', 'groupMsgs/gAAAAAA1/m3', msg('C')), false, 'non-members cannot post');
  assert.equal(db.set('B', 'groupMsgs/gAAAAAA1/m4', msg('B', 'x'.repeat(301))), false, 'too long');
  assert.equal(db.set('B', 'ginbox/A/gAAAAAA1', { name: 'Squad', text: 'hi', by: 'B', from: 'B', at: t }), true, 'members tell each other about new messages');
  assert.equal(db.set('C', 'ginbox/A/gAAAAAA1', { name: 'Squad', text: 'spam', by: 'C', from: 'C', at: t }), false, 'others cannot');
  db.seed('bans/B', { until: db.now + 1000, name: 'B', at: t });
  assert.equal(db.set('B', 'groupMsgs/gAAAAAA1/m5', msg('B')), false, 'banned players cannot post');
  db.seed('bans/B', null);

  // Only the group's owner can remove people or delete it; anyone can leave.
  assert.equal(db.set('B', 'groups/gAAAAAA1/members/A', null), false, 'B cannot remove the owner');
  assert.equal(db.set('B', 'groups/gAAAAAA1', null), false, 'B cannot delete the group');
  assert.equal(db.set('B', 'groups/gAAAAAA1/owner', 'B'), false, 'B cannot take it over');
  assert.equal(db.set('A', 'ginbox/B/gAAAAAA1', null), true);
  assert.equal(db.set('A', 'groups/gAAAAAA1/members/B', null), true, 'the owner removes B');
  assert.equal(db.canRead('B', 'groupMsgs/gAAAAAA1'), false, 'removed players cannot read any more');

  // (The 12-member limit is kept by the game: Firebase rules can't count children.)
  // A group can't be made with someone else already in it, even with an invite trick.
  db.seed('ginbox/Y/gTRICK001', invite('A'));
  assert.equal(db.set('A', 'groups/gTRICK001', group('A', ['A', 'Y'])), false, 'new groups start with just their maker');

  // Deleting: the owner clears messages, then the group.
  assert.equal(db.set('B', 'groupMsgs/gAAAAAA1', null), false);
  assert.equal(db.set('A', 'groupMsgs/gAAAAAA1', null), true);
  assert.equal(db.set('A', 'groups/gAAAAAA1', null), true);
  // A leftover invite to a deleted group cannot bring it back.
  db.seed('ginbox/Q/gAAAAAA1', invite('A'));
  assert.equal(db.set('Q', 'groups/gAAAAAA1/members/Q', { name: 'Q', at: t }), false);
});

test('rules simulator agrees with the existing private-chat rules', async () => {
  const { createRulesSim } = await import('./rules-sim.mjs');
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url)));
  const db = createRulesSim(rules);
  const m = { from: 'A', name: 'Neo', text: 'hi', at: db.now - 1 };
  assert.equal(db.set('A', 'dms/A_B/m1', m), true);
  assert.equal(db.set('C', 'dms/A_B/m2', { ...m, from: 'C' }), false, 'outsiders cannot write into a chat');
  assert.equal(db.canRead('B', 'dms/A_B'), true);
  assert.equal(db.canRead('C', 'dms/A_B'), false);
});

test('friends: names are tidied, online friends come first, room invites expire', async () => {
  const { cleanHandle, friendRows, liveInvites, INVITE_MS } = await import('../src/friends.js');
  assert.equal(cleanHandle('  @neo_1 '), 'neo_1');
  assert.equal(cleanHandle('x'.repeat(30)).length, 16);
  const friends = { accA: { name: 'Zed' }, accB: { name: 'Amy' }, tabC: { name: 'Cal' }, accX: { name: 'Pest' } };
  const online = [['tab1', { name: 'Zed2', acct: 'accA', status: 'in a lobby' }], ['tabC', { name: 'Cal', status: 'on the menu' }], ['tab9', { name: 'Stranger' }]];
  const rows = friendRows(friends, online, (id) => id === 'accX');
  assert.deepEqual(rows.map((r) => [r.id, r.online, r.tabId]), [['tabC', true, 'tabC'], ['accA', true, 'tab1'], ['accB', false, null]], 'online first, matched by account or tab; blocked hidden');
  assert.equal(rows[1].name, 'Zed2', 'shows their current name when online');
  assert.equal(rows[2].status, 'offline');
  const now = 1_000_000;
  const box = { accA: { name: 'Zed', code: 'QXFT', at: now - 1000 }, accB: { name: 'Amy', code: 'ABCD', at: now - INVITE_MS - 1 }, stranger: { name: 'S', code: 'ZZZZ', at: now } };
  assert.deepEqual(liveInvites(box, now, friends).map((i) => i.from), ['accA'], 'old invites and invites from non-friends are ignored');
});

test('database rules: friend requests need a yes, and only friends can send room invites', async () => {
  const { createRulesSim } = await import('./rules-sim.mjs');
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url)));
  const db = createRulesSim(rules);
  const t = db.now - 5;
  for (const id of ['A', 'B', 'C']) db.seed(`users/${id}`, { handle: id.toLowerCase() });
  const req = (name) => ({ name, at: t });

  // Requests: only as yourself, only real accounts, not to yourself.
  assert.equal(db.set('A', 'friendReqs/B/C', req('C')), false, 'cannot send a request as someone else');
  assert.equal(db.set('A', 'friendReqs/A/A', req('A')), false, 'cannot friend yourself');
  assert.equal(db.set('guestTab', 'friendReqs/B/guestTab', req('guest')), false, 'guests (no account) cannot send requests');
  assert.equal(db.set('A', 'friendReqs/B/A', { ...req('A'), extra: 1 }), false, 'no extra fields');
  assert.equal(db.set('A', 'friendReqs/B/A', req('brisky2swifty')), false, 'the owner name is reserved');
  assert.equal(db.set('A', 'friendReqs/B/A', req('A')), true, 'A asks B');
  assert.equal(db.canRead('B', 'friendReqs/B'), true);
  assert.equal(db.canRead('C', 'friendReqs/B'), false, 'requests are private');

  // Friends lists: nobody can add themselves to someone's list without a request.
  assert.equal(db.set('C', 'friends/B/C', req('C')), false, 'C has no request, so cannot add themselves to B');
  assert.equal(db.set('C', 'friends/C/B', req('B')), false, 'C cannot just add B either');
  assert.equal(db.set('A', 'friends/A/B', req('B')), false, 'A cannot accept on B\'s behalf');
  assert.equal(db.set('B', 'friends/A/B', req('B')), true, 'B says yes: B goes on A\'s list');
  assert.equal(db.set('B', 'friends/B/A', req('A')), true, 'and A on B\'s list');
  assert.equal(db.set('B', 'friendReqs/B/A', null), true, 'B clears the request');
  assert.equal(db.set('A', 'friendReqs/B/A', req('A')), false, 'no new requests to someone who is already a friend');
  assert.equal(db.canRead('C', 'friends/A'), false, 'friends lists are private');

  // Room invites: friends only, real room codes.
  const inv = (code = 'QXFT') => ({ name: 'A', code, mode: 'Race', at: t });
  assert.equal(db.set('A', 'finvites/B/A', inv()), true, 'A invites friend B');
  assert.equal(db.set('C', 'finvites/B/C', inv()), false, 'C is not B\'s friend');
  assert.equal(db.set('A', 'finvites/C/A', inv()), false, 'A is not C\'s friend');
  assert.equal(db.set('A', 'finvites/B/A', inv('nope')), false, 'room codes are 4 capital letters');
  assert.equal(db.set('B', 'finvites/B/A', null), true, 'B dismisses it');
  db.seed('bans/A', { until: db.now + 1000, name: 'A', at: t });
  assert.equal(db.set('A', 'finvites/B/A', inv()), false, 'banned players cannot invite');
  db.seed('bans/A', null);

  // Unfriending works from either side, on both lists; then invites stop.
  assert.equal(db.set('C', 'friends/A/B', null), false, 'outsiders cannot unfriend people');
  assert.equal(db.set('B', 'friends/B/A', null), true);
  assert.equal(db.set('B', 'friends/A/B', null), true);
  assert.equal(db.set('A', 'finvites/B/A', inv()), false, 'no invites after unfriending');
});

test('chat filter: hides rude words and personal info, leaves normal words alone', async () => {
  const { cleanText, hasBadWords } = await import('../src/filter.js');
  const rude = Buffer.from('c2hpdA==', 'base64').toString(); // a rude word (encoded here too)
  const stars = (n) => '*'.repeat(n);
  assert.equal(cleanText(`oh ${rude}`), `oh ${stars(4)}`);
  assert.equal(cleanText(`oh ${rude.toUpperCase()}`), `oh ${stars(4)}`, 'any capitals');
  assert.equal(cleanText(`oh ${rude.replace('i', '1')}`), `oh ${stars(4)}`, 'look-alike numbers');
  assert.equal(cleanText(`oh ${rude.replace('h', 'hhhh')}`), `oh ${stars(7)}`, 'stretched letters');
  assert.equal(cleanText(`oh ${rude.split('').join(' ')}`), `oh ${'* * * *'}`, 'spaced out');
  assert.equal(cleanText(`${rude}ty game`), `${stars(5)}y game`, "inside longer words (stretched letters included)");
  for (const ok of ['class', 'cocktail', 'assembly', 'Dickens', 'the night is dark', 'pass the exam', 'grape', 'hello world', 'gg ez 🎉', 'room QXFT, score 1234']) {
    assert.equal(cleanText(ok), ok, `left alone: ${ok}`);
  }
  assert.equal(cleanText('call me 555-123-4567 ok'), 'call me [number hidden] ok');
  assert.equal(cleanText('text +1 (555) 123 4567'), 'text [number hidden]');
  assert.equal(cleanText('mail kid.name+x@example.co.uk now'), 'mail [email hidden] now');
  assert.equal(cleanText('kill yourself'), '**** ********', 'mean phrases');
  assert.equal(cleanText(null), '');
  assert.equal(hasBadWords('neo'), false);
  assert.equal(hasBadWords(`x${rude}x`), true);
  // The source keeps the lists encoded, so no rude words show in the code.
  const src = fs.readFileSync(new URL('../src/filter.js', import.meta.url), 'utf8');
  assert.ok(!src.toLowerCase().includes(rude), 'word list is encoded');
});

test('database rules: reports go to the owner only, one every 30 seconds', async () => {
  const { createRulesSim } = await import('./rules-sim.mjs');
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url)));
  const db = createRulesSim(rules);
  db.seed('roles/OWNER', 'owner');
  const report = (by, extra = {}) => ({ by, byName: by, target: 'T', targetAcct: 'TA', targetName: 'pest', reason: 'mean', note: 'was mean in chat', at: db.now, ...extra });
  const file = (by, id, extra) => db.update(by, { [`reports/${id}`]: report(by, extra), [`reportsBy/${by}`]: db.now });

  assert.equal(db.set('A', 'reports/r1', report('A')), false, 'a report must come with your report time (rate limit)');
  assert.equal(file('A', 'r1'), true, 'A reports someone');
  assert.equal(file('A', 'r2'), false, 'not again within 30 seconds');
  db.tick(31000);
  assert.equal(file('A', 'r2'), true, 'fine after 30 seconds');
  assert.equal(db.update('A', { 'reports/r3': report('B'), 'reportsBy/A': db.now }), false, 'cannot report as someone else');
  db.tick(31000);
  assert.equal(file('A', 'r4', { reason: 'whatever' }), false, 'reason must be one of the choices');
  assert.equal(file('A', 'r4', { note: 'x'.repeat(201) }), false, 'note max 200');
  assert.equal(file('A', 'r4', { extra: 1 }), false, 'no extra fields');
  assert.equal(file('A', 'r1', {}), false, 'cannot overwrite a report');
  db.seed('bans/A', { until: db.now + 1000, name: 'A', at: 1 });
  assert.equal(file('A', 'r5'), false, 'banned players cannot report');
  db.seed('bans/A', null);

  assert.equal(db.canRead('A', 'reports'), false, 'players cannot read reports');
  assert.equal(db.canRead('OWNER', 'reports'), true, 'the owner can');
  assert.equal(db.set('A', 'reports/r1', null), false, 'players cannot delete reports');
  assert.equal(db.set('OWNER', 'reports/r1', null), true, 'the owner dismisses one');
});

test('chat commands, smileys and quick-chat', async () => {
  const { parseCommand, messageView, emojify, quickChats, EMOJI, COMMANDS } = await import('../src/emotes.js');
  assert.deepEqual(parseCommand('hello'), { text: 'hello' });
  assert.deepEqual(parseCommand('/me waves'), { text: '/me waves' });
  assert.ok(parseCommand('/me').local, '/me needs an action');
  assert.equal(parseCommand('/shrug').text, '¯\\_(ツ)_/¯');
  assert.equal(parseCommand('/shrug oh well').text, 'oh well ¯\\_(ツ)_/¯');
  assert.match(parseCommand('/GG').text, /GG/);
  assert.equal(parseCommand('/roll', () => 0).text, '🎲 rolled 1 (1-100)');
  assert.equal(parseCommand('/roll', () => 0.999).text, '🎲 rolled 100 (1-100)');
  assert.equal(parseCommand('/flip', () => 0.1).text, '🪙 flipped heads');
  assert.equal(parseCommand('/flip', () => 0.9).text, '🪙 flipped tails');
  assert.ok(COMMANDS.every(([c]) => parseCommand('/help').local.includes(c.split(' ')[0])), '/help lists every command');
  assert.match(parseCommand('/nope').local, /Unknown command \/nope/);
  assert.deepEqual(messageView('/me dances'), { action: true, text: 'dances' });
  assert.deepEqual(messageView('/meow'), { action: false, text: '/meow' }, 'only "/me " is an action');
  assert.equal(emojify('hi :) <3'), 'hi 🙂 ❤️');
  assert.equal(emojify(':D'), '😄');
  for (const keep of ['http://site.com', 'a:)b', 'f(x):)', 'room QXFT']) assert.equal(emojify(keep), keep, `left alone: ${keep}`);
  assert.ok(EMOJI.length >= 16 && new Set(EMOJI).size === EMOJI.length);
  const heist = quickChats('heist');
  assert.ok(heist.includes('Code is …') && heist.includes('What do you see?'));
  assert.ok(quickChats('letterlock', 'quick').includes('Which stage?'), 'quick hacks share a list');
  assert.deepEqual(quickChats('mystery'), ['gl hf!', 'gg', 'nice! 👏', 'brb', 'ready! 👍']);
  for (const m of ['race', 'duel', 'defend', 'heist', 'gauntlet']) assert.ok(quickChats(m, m === 'gauntlet' ? 'quick' : '').length <= 6);
});

test('spectating: watchers are left out of the game, and the scoreboard shows progress', async () => {
  const { playerList } = await import('../src/util.js');
  const { progressOf, spectateRows, spectators } = await import('../src/spectate.js');
  const room = {
    mode: 'race',
    players: {
      a: { name: 'amy', joinedAt: 1, s: { layer: 2 } },
      b: { name: 'ben', joinedAt: 2, s: { layer: 4 } },
      w: { name: 'wes', joinedAt: 3, spectator: true },
    },
  };
  assert.deepEqual(playerList(room).map((p) => p.id), ['a', 'b'], 'spectators are not players');
  assert.deepEqual(spectators(room).map((p) => p.id), ['w']);
  assert.deepEqual(spectateRows(room).map((r) => [r.p.id, r.label]), [['b', 'layer 5/5'], ['a', 'layer 3/5']], 'furthest first');
  assert.deepEqual(progressOf('race', { layer: 5 }), { value: 1, label: 'ROOTED ✓' });
  assert.deepEqual(progressOf('duel', { hp: 40 }), { value: 0.4, label: 'firewall 40' });
  assert.deepEqual(progressOf('duel', { out: true, hp: 0 }), { value: 0, label: 'OUT' });
  assert.equal(progressOf('letterlock', { stage: 2 }).label, 'stage 3/5');
  assert.equal(progressOf('gauntlet', { stage: 5 }).label, 'ALL CLEAR ✓');
  assert.equal(progressOf('heist', { role: 'analyst' }).label, 'analyst');
  const defend = { mode: 'defend', players: { a: { name: 'amy', s: { nodes: {}, loot: 30 } }, b: { name: 'ben', s: { nodes: {}, loot: 60 } } } };
  assert.deepEqual(spectateRows(defend).map((r) => [r.p.id, r.value]), [['b', 1], ['a', 0.5]], 'defend scores scale to the leader');
});

test('database rules: you can join a running game only as a spectator', async () => {
  const { createRulesSim } = await import('./rules-sim.mjs');
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url)));
  const db = createRulesSim(rules);
  db.seed('rooms/QXFT', { hostId: 'H', mode: 'race', status: 'playing', round: 1, players: { H: { name: 'host', color: '#33ff66' } } });
  const me = { name: 'wes', color: '#4dd9ff' };
  assert.equal(db.set('W', 'rooms/QXFT/players/W', me), false, 'not as a player once it started');
  assert.equal(db.set('W', 'rooms/QXFT/players/W', { ...me, spectator: true }), true, 'as a spectator');
  db.seed('rooms/QXFT/status', 'lobby');
  assert.equal(db.set('W', 'rooms/QXFT/players/W/spectator', null), true, 'back in the lobby, they become a player');
  db.seed('rooms/QXFT/kicked/K', true);
  db.seed('rooms/QXFT/status', 'playing');
  assert.equal(db.set('K', 'rooms/QXFT/players/K', { name: 'kim', color: '#ffb000', spectator: true }), false, 'kicked players cannot watch either');
});

test('music: three tracks in A minor, faster when tense, right track for the moment', async () => {
  const { TRACKS, patternFor, triad, midiToFreq, trackFor } = await import('../src/music.js');
  assert.ok(TRACKS.menu.bpm < TRACKS.game.bpm && TRACKS.game.bpm < TRACKS.tense.bpm, 'calm menu, faster game, fastest at the end');
  assert.equal(Math.round(midiToFreq(69)), 440);
  assert.deepEqual(triad(57), [57, 60, 64], 'A minor');
  assert.deepEqual(triad(53), [53, 57, 60], 'F major');
  assert.deepEqual(triad(52), [52, 56, 59], 'E major');
  // Every pitched note fits A harmonic minor (A B C D E F G#) or the chord's own notes.
  const scale = new Set([9, 11, 0, 2, 4, 5, 7, 8]);
  for (const name of Object.keys(TRACKS)) {
    for (let bar = 0; bar < 8; bar++) {
      const notes = patternFor(name, bar);
      assert.deepEqual(notes, patternFor(name, bar), 'the same every time');
      for (const n of notes) {
        assert.ok(n.beat >= 0 && n.beat < 4 && n.dur > 0, `${name} timing`);
        if (n.midi) assert.ok(scale.has(n.midi % 12), `${name} bar ${bar}: note ${n.midi} in key`);
        assert.ok(TRACKS[name].voices.includes(n.voice), `${name} uses its own instruments`);
      }
    }
  }
  assert.ok(!patternFor('menu', 0).some((n) => n.voice === 'kick'), 'no drums on the menu');
  assert.ok(patternFor('tense', 0).filter((n) => n.voice === 'kick').length > patternFor('game', 0).filter((n) => n.voice === 'kick').length, 'more drums when tense');
  assert.deepEqual(patternFor('nope', 0), []);
  assert.equal(trackFor('menu'), 'menu');
  assert.equal(trackFor('lobby'), 'menu');
  assert.equal(trackFor('game', 120000), 'game');
  assert.equal(trackFor('game', 25000), 'tense');
  assert.equal(trackFor('game', Infinity), 'game', 'modes without a time limit');
});

test('king of the hill: locks are fair and solvable, the host picks the first capture', async () => {
  const { lockFor, checkAnswer, resolveAction, heldMs, LOCK_KINDS, SHIELD_MS, FORTIFY_COOLDOWN } = await import('../src/modes/koth.js');
  const { caesar, reverse } = await import('../src/rng.js');
  // Same lock for everyone, every kind shows up, and each one can be solved from its prompt.
  const kinds = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    for (let n = 0; n < 8; n++) {
      const l = lockFor(seed, n);
      assert.deepEqual(l, lockFor(seed, n));
      kinds.add(l.kind);
      assert.ok(checkAnswer(l, l.answer) && checkAnswer(l, `  ${l.answer.toUpperCase()} `), 'answers ignore case and spaces');
      const shown = l.prompt.split(': ').pop();
      if (l.kind === 'math') {
        const [, a, op, b] = l.prompt.match(/(\d+) ([+-]) (\d+)/);
        assert.equal(String(op === '+' ? +a + +b : a - b), l.answer);
        assert.ok(+l.answer > 0);
      } else if (l.kind === 'reverse') assert.equal(reverse(shown), l.answer);
      else if (l.kind === 'caesar') assert.equal(caesar(shown, -Number(l.prompt.match(/\+(\d)/)[1])), l.answer);
      else {
        assert.equal([...shown].sort().join(''), [...l.answer].sort().join(''), 'scramble uses the same letters');
        assert.notEqual(shown, l.answer, 'never already solved');
      }
    }
  }
  assert.deepEqual([...kinds].sort(), [...LOCK_KINDS].sort());
  assert.notDeepEqual(lockFor(1, 0), lockFor(1, 1), 'each capture brings a new lock');

  // The host's decisions.
  const seed = 7;
  const now = 100000;
  const players = { a: { s: { held: 0, caps: 0 } }, b: { s: { held: 5000, caps: 1 } } };
  const hill = { lock: 3, holder: 'b', since: now - 4000, shieldUntil: 0 };
  const right = lockFor(seed, 3).answer;
  const cap = (from, lock = 3, answer = right, h = hill) => resolveAction({ type: 'capture', from, lock, answer }, { hill: h, seed, players, now });
  const won = cap('a');
  assert.deepEqual(won.game, { lock: 4, holder: 'a', since: now, shieldUntil: 0 }, 'a takes the hill and a new lock goes on');
  assert.equal(won['players/b/s/held'], 9000, 'b gets credit for the 4 seconds they held it');
  assert.equal(won['players/a/s/caps'], 1);
  assert.equal(cap('a', 2), null, 'too late: that lock was already cracked');
  assert.equal(cap('a', 3, 'nope'), null, 'wrong answers never capture');
  assert.equal(cap('b'), null, 'you cannot capture your own hill');
  assert.equal(cap('a', 3, right, { ...hill, shieldUntil: now + 1 }), null, 'fortified hills cannot be captured');
  const fort = resolveAction({ type: 'fortify', from: 'b' }, { hill, seed, players, now });
  assert.deepEqual(fort, { 'game/shieldUntil': now + SHIELD_MS, 'players/b/s/fortAt': now });
  assert.equal(resolveAction({ type: 'fortify', from: 'a' }, { hill, seed, players, now }), null, 'only the holder can fortify');
  const recharging = { ...players, b: { s: { fortAt: now - FORTIFY_COOLDOWN + 1 } } };
  assert.equal(resolveAction({ type: 'fortify', from: 'b' }, { hill, seed, players: recharging, now }), null, 'fortify has a cooldown');
  // Time held counts the current holder's time.
  assert.equal(heldMs({ id: 'b', s: { held: 5000 } }, hill, now), 9000);
  assert.equal(heldMs({ id: 'a', s: { held: 2000 } }, hill, now), 2000);
});

test('how to play: every mode in the lobby has a kid-friendly guide', async () => {
  const { guideFor } = await import('../src/howto.js');
  const { hasBadWords } = await import('../src/filter.js');
  for (const id of MODE_ORDER) {
    const g = guideFor(id);
    assert.ok(g, `${id} has a guide`);
    assert.ok(g.goal && g.controls && g.tip && g.steps.length >= 3, `${id} guide is complete`);
    for (const line of [g.goal, g.controls, g.tip, ...g.steps]) {
      assert.ok(typeof line === 'string' && line.length > 5 && line.length < 200, `${id}: short, readable lines`);
      assert.ok(!hasBadWords(line), `${id}: kid-safe text`);
    }
  }
  assert.equal(guideFor('nope'), null);
  assert.match(guideFor('koth').steps.join(' '), /fortify/);
  assert.match(guideFor('letterlock').steps[0], /Space|Enter/, 'mini-games reuse their own instructions');
});

test('trophy progress: locked count trophies show how close you are', async () => {
  const { TROPHIES, trophyProgress } = await import('../src/trophies.js');
  const find = (id) => TROPHIES.find((t) => t.id === id);
  assert.deepEqual(trophyProgress(find('rounds-100'), { rounds: 34 }), { have: 34, need: 100, pct: 34 });
  assert.deepEqual(trophyProgress(find('rounds-100'), { rounds: 340 }), { have: 100, need: 100, pct: 100 }, 'never over 100%');
  assert.deepEqual(trophyProgress(find('rounds-100'), {}), { have: 0, need: 100, pct: 0 });
  assert.deepEqual(trophyProgress(find('level-25'), {}, 12), { have: 12, need: 25, pct: 48 });
  assert.equal(trophyProgress(find('play10-koth'), { modePlays: { koth: 3 } }).have, 3);
  assert.equal(trophyProgress(find('all-modes'), { modePlays: { race: 1, duel: 2 } }).have, 2);
  assert.equal(trophyProgress(find('chat'), { chatSent: true }), null, 'yes/no trophies have no bar');
  assert.ok(TROPHIES.filter((t) => t.goal).length >= 60, 'most trophies have a goal');
  // Progress agrees with unlocking: 100% exactly when the trophy's test passes.
  for (const tr of TROPHIES.filter((t) => t.goal)) {
    for (const n of [0, 1, 9, 10, 49, 50, 100, 1000]) {
      const c = { rounds: n, wins: n, quickClears: n, modePlays: { race: n, koth: n }, modeWins: { race: n, koth: n } };
      const p = trophyProgress(tr, c, n);
      if (tr.test(c, {}, n)) assert.equal(p.pct, 100, `${tr.id} at ${n}`);
    }
  }
});

test('connection banner: says what is wrong and what still works', async () => {
  const { connectionMessage } = await import('../src/connection.js');
  assert.equal(connectionMessage({ online: true, serverUp: true, inOnlineRoom: true }), null);
  assert.equal(connectionMessage({ online: true, serverUp: null, inOnlineRoom: false }), null, 'local play: nothing to say');
  assert.equal(connectionMessage({ online: true, serverUp: false, inOnlineRoom: false }), null, 'no banner on the menu for a server blip');
  assert.match(connectionMessage({ online: true, serverUp: false, inOnlineRoom: true }).text, /Reconnecting/);
  assert.match(connectionMessage({ online: false, serverUp: true, inOnlineRoom: true }).text, /catch up/);
  assert.match(connectionMessage({ online: false, serverUp: null, inOnlineRoom: false }).text, /Practice/);
});

test('database rules only use methods Firebase supports', () => {
  // Firebase rule expressions have a small, fixed set of methods (no numChildren, for example).
  const ALLOWED = new Set(['child', 'parent', 'hasChild', 'hasChildren', 'exists', 'getPriority', 'isNumber', 'isString', 'isBoolean', 'val',
    'contains', 'beginsWith', 'endsWith', 'replace', 'toLowerCase', 'toUpperCase', 'matches']);
  const rules = JSON.parse(fs.readFileSync(new URL('../database.rules.json', import.meta.url)));
  const bad = [];
  const walk = (node, path) => {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && k.startsWith('.')) {
        for (const [, name] of v.matchAll(/\.(\w+)\(/g)) if (!ALLOWED.has(name)) bad.push(`${path}/${k}: ${name}()`);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${path}/${k}`);
    }
  };
  walk(rules.rules, '');
  assert.deepEqual(bad, [], 'unsupported methods in the rules');
});
