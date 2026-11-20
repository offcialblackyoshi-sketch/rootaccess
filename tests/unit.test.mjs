// Unit checks for the pure game logic. Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, caesar, b64encode, b64decode, reverse } from '../src/rng.js';
import { Shell } from '../src/commands.js';
import { setPath } from '../src/net/shared.js';
import { buildRace, pinFeedback } from '../src/modes/race.js';
import { buildHeist, fillMissingRoles } from '../src/modes/heist.js';
import { SNIPPETS } from '../src/modes/duel.js';
import { score, startNodes, breachTime } from '../src/modes/defend.js';

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
});

test('race puzzles: same seed gives same puzzle', () => {
  assert.equal(JSON.stringify(buildRace(123)), JSON.stringify(buildRace(123)));
  assert.notEqual(JSON.stringify(buildRace(123)), JSON.stringify(buildRace(124)));
});

test('race puzzles are always solvable', () => {
  for (const seed of SEEDS) {
    const P = buildRace(seed);
    // Layer 1: current password is in auth.log, the old one in the old log.
    assert.match(P.fs.var.log['auth.log'], new RegExp(`password for ${P.target} changed to '${P.pass}'`));
    assert.match(P.fs.var.log.old['auth.log.1'], new RegExp(`password for ${P.target} changed to '${P.oldPass}'`));
    assert.notEqual(P.pass, P.oldPass, `seed ${seed}`);
    // Layer 2: decrypting with the method from the note reveals fragment A.
    const enc = P.targetHome['vault.enc'];
    const dec = P.cipherType === 'caesar' ? caesar(enc, -P.shift) : P.cipherType === 'base64' ? b64decode(enc) : reverse(enc);
    assert.ok(dec.includes(`FRAGMENT A: ${P.fragA}`), `seed ${seed}`);
    assert.ok(!enc.includes(`FRAGMENT A: ${P.fragA}`), `seed ${seed}: file is not actually scrambled`);
    if (P.cipherType === 'caesar') assert.ok(P.targetHome['note.txt'].includes(String(P.shift)));
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

test('PIN feedback', () => {
  assert.deepEqual(pinFeedback('1234', '1234'), { exact: 4, near: 0 });
  assert.deepEqual(pinFeedback('1234', '4321'), { exact: 0, near: 4 });
  assert.deepEqual(pinFeedback('1234', '1567'), { exact: 1, near: 0 });
  assert.deepEqual(pinFeedback('1234', '5612'), { exact: 0, near: 2 });
});

test('heist puzzles are always solvable from the analyst files', () => {
  for (const seed of SEEDS) {
    const P = buildHeist(seed);
    // Door: re-derive the code from the manual text the analyst sees.
    const manual = P.fs.manuals['keypads.txt'];
    const block = manual.split('MODEL ').find((b) => b.startsWith(P.model));
    const light = block.match(/If the (\w+) light/)[1];
    const parity = block.match(/ends in an (\w+) digit/)[1];
    const codes = [...block.matchAll(/code is (\d{4})/g)].map((m) => m[1]);
    const lastDigit = Number(P.serial.slice(-1));
    const expected = P.lit.includes(light) ? codes[0] : (lastDigit % 2 === 0) === (parity === 'EVEN') ? codes[1] : codes[2];
    assert.equal(P.doorCode, expected, `seed ${seed}`);
    // Login: the user's staff file has what the hint asks for.
    const file = Object.values(P.fs.staff).find((f) => f.includes(`Username: ${P.user}\n`));
    assert.ok(file, `seed ${seed}: no staff file for ${P.user}`);
    const born = file.match(/Born: (\d+)/)[1];
    const pet = file.match(/Pet: (\w+)/)[1].toLowerCase();
    const color = file.match(/Favorite color: (\w+)/)[1];
    const fromHint = { "pet's name + year of birth": pet + born, "year of birth + pet's name": born + pet, "favorite color + pet's name": color + pet }[P.loginHint];
    assert.equal(fromHint, P.password, `seed ${seed}`);
    // Only one staff member has that username.
    assert.equal(Object.values(P.fs.staff).filter((f) => f.includes(`Username: ${P.user}\n`)).length, 1);
    // Vault: night guards in the roster = dial number, which unscrambles the word.
    const nights = (P.fs.security['roster.txt'].match(/NIGHT/g) || []).length;
    assert.equal(nights, P.nightCount, `seed ${seed}`);
    assert.equal(caesar(P.display, -nights), P.word);
  }
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

test('duel snippets and defend scoring', () => {
  assert.equal(new Set(SNIPPETS).size, SNIPPETS.length, 'duplicate snippet');
  for (const s of SNIPPETS) assert.ok(s.length >= 5 && s.length <= 32, s);
  assert.equal(score({ nodes: startNodes(), loot: 0 }), 360);
  assert.equal(score({ nodes: startNodes(), loot: 40 }), 400);
  assert.equal(breachTime(0), 5000);
});
