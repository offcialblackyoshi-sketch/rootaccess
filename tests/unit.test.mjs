// Unit checks for the pure game logic. Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, caesar, b64encode, b64decode, reverse, atbash, hexEncode, hexDecode } from '../src/rng.js';
import { Shell } from '../src/commands.js';
import { setPath } from '../src/net/shared.js';
import { buildRace, pinFeedback, decryptWith, encryptWith, CIPHERS, raceHints, HINT_COST, raceStatsText } from '../src/modes/race.js';
import { buildTutorial } from '../src/modes/tutorial.js';
import { buildHeist, fillMissingRoles, heistStatsText } from '../src/modes/heist.js';
import { SNIPPETS, duelStatsText } from '../src/modes/duel.js';
import { score, startNodes, breachTime, defendStatsText } from '../src/modes/defend.js';
import { botParams, BOT_LEVELS } from '../src/bots.js';

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

test('duel snippets and defend scoring', () => {
  assert.equal(new Set(SNIPPETS).size, SNIPPETS.length, 'duplicate snippet');
  for (const s of SNIPPETS) assert.ok(s.length >= 5 && s.length <= 32, s);
  assert.equal(score({ nodes: startNodes(), loot: 0 }), 360);
  assert.equal(score({ nodes: startNodes(), loot: 40 }), 400);
  assert.equal(breachTime(0), 5000);
});
