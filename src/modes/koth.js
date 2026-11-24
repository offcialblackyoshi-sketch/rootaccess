// KING OF THE HILL: one server in the middle, "THE HILL", sealed by a lock.
// Everyone sees the same lock; the first to solve it captures the hill.
// While you hold it you earn a point every second, and you can `fortify` to
// block captures for a few seconds. Each capture puts a brand-new lock on.
// The host decides who was first (by the order the captures arrived), and
// the most seconds held at the end wins. All hacking here is pretend.

import { makeRng, caesar, reverse } from '../rng.js';
import { el, fmtTime } from '../util.js';
import { botParams, between } from '../bots.js';

const TIME_LIMIT = 4 * 60 * 1000;
export const SHIELD_MS = 10000;     // fortify blocks captures this long
export const FORTIFY_COOLDOWN = 30000;
export const WRONG_COOLDOWN = 2000; // after a wrong answer (no guessing sprees)

const WORDS = ['matrix', 'cipher', 'router', 'kernel', 'packet', 'socket', 'binary', 'pixel', 'vector', 'beacon',
  'falcon', 'nebula', 'turbo', 'zenith', 'orbit', 'vortex', 'photon', 'signal', 'rocket', 'comet', 'galaxy', 'laser',
  'robot', 'portal', 'shield', 'circuit', 'quasar', 'gadget', 'puzzle', 'radar'];

export const LOCK_KINDS = ['math', 'reverse', 'caesar', 'scramble'];

// The lock for capture number n of a round: the same for every player.
// { kind, prompt, hint, answer }
export function lockFor(seed, n) {
  const rng = makeRng(`koth:${seed}:${n}`);
  const kind = LOCK_KINDS[(n + rng.int(0, LOCK_KINDS.length - 1)) % LOCK_KINDS.length];
  const word = rng.pick(WORDS);
  if (kind === 'math') {
    const a = rng.int(12, 89);
    const b = rng.int(11, 59);
    const minus = rng.chance(0.4) && a > b;
    return { kind, prompt: `PIN = ${a} ${minus ? '-' : '+'} ${b}`, hint: 'work out the number', answer: String(minus ? a - b : a + b) };
  }
  if (kind === 'reverse') return { kind, prompt: `reversed: ${reverse(word)}`, hint: 'read it backwards', answer: word };
  if (kind === 'caesar') {
    const shift = rng.int(1, 2);
    return { kind, prompt: `shifted +${shift}: ${caesar(word, shift)}`, hint: `move each letter ${shift} back (b→a)`, answer: word };
  }
  // scramble: shuffled letters (never the word itself)
  let mixed = word;
  for (let i = 0; i < 6 && mixed === word; i++) mixed = rng.shuffle([...word]).join('');
  if (mixed === word) mixed = reverse(word);
  return { kind: 'scramble', prompt: `scrambled: ${mixed}`, hint: 'unscramble the letters', answer: word };
}

export const checkAnswer = (lock, text) => String(text || '').trim().toLowerCase() === lock.answer;

// Seconds held so far, counting the current holder's time.
export function heldMs(p, hill, now) {
  return (p?.s?.held || 0) + (hill?.holder === p?.id ? Math.max(0, now - (hill.since || now)) : 0);
}

// The host's decision for one action. Returns the room changes (or null to ignore it).
// Captures for an old lock, by the holder, during a fortify, or with a wrong answer are ignored.
export function resolveAction(a, { hill, seed, players, now }) {
  if (a.type === 'capture') {
    if (a.lock !== hill.lock || a.from === hill.holder || now < (hill.shieldUntil || 0)) return null;
    if (!checkAnswer(lockFor(seed, a.lock), a.answer)) return null;
    const changes = { game: { lock: hill.lock + 1, holder: a.from, since: now, shieldUntil: 0 } };
    const old = hill.holder && players[hill.holder];
    if (old) changes[`players/${hill.holder}/s/held`] = (old.s?.held || 0) + Math.max(0, now - (hill.since || now));
    changes[`players/${a.from}/s/caps`] = (players[a.from]?.s?.caps || 0) + 1;
    return changes;
  }
  if (a.type === 'fortify') {
    const p = players[a.from];
    if (a.from !== hill.holder || !p || now - (p.s?.fortAt || 0) < FORTIFY_COOLDOWN) return null;
    return { 'game/shieldUntil': now + SHIELD_MS, [`players/${a.from}/s/fortAt`]: now };
  }
  return null;
}

export default {
  id: 'koth',
  name: 'King of the Hill',
  min: 2,
  max: 8,
  bots: true,
  timeLimit: TIME_LIMIT,
  blurb: 'Crack the lock on THE HILL to capture it. Hold it to score every second, fortify to block attacks. Most time on top wins.',

  setup({ players }) {
    const out = {};
    for (const p of players) out[p.id] = { held: 0, caps: 0 };
    return { players: out, game: { lock: 0, holder: null, since: 0, shieldUntil: 0 } };
  },

  mount(ctx) {
    const { term, me } = ctx;
    const hill = () => ctx.room.game || { lock: 0, holder: null };
    const lock = () => lockFor(ctx.seed, hill().lock);
    let wrongUntil = 0;
    let shownLock = -1;
    let lastHolder = null;
    let pending = -1; // lock number you just answered (waiting for the host)

    // ---- Stage ----
    const holderEl = el('div', { class: 'koth-holder' });
    const lockEl = el('div', { class: 'koth-lock', 'aria-live': 'polite' });
    const hintEl = el('div', { class: 'dim small' });
    const shieldEl = el('div', { class: 'koth-shield', hidden: true });
    ctx.stage.append(el('div', { class: 'stage-box koth' },
      el('div', { class: 'koth-title' }, '⛰️ THE HILL'),
      holderEl, shieldEl,
      el('div', { class: 'dim' }, 'LOCK:'), lockEl, hintEl,
      el('div', { class: 'dim small' }, 'Type the answer and press Enter. Holding the hill? Type fortify to block attacks.')));

    const nameOf = (id) => ctx.player(id)?.name || '?';

    function renderStage() {
      const h = hill();
      const now = ctx.now();
      const l = lock();
      const mine = h.holder === me;
      holderEl.innerHTML = '';
      holderEl.append(h.holder
        ? el('span', {}, '👑 ', el('span', { class: 'pname', style: { color: ctx.player(h.holder)?.color || '' } }, nameOf(h.holder)), mine ? ' (you!)' : '', ` for ${Math.floor((now - (h.since || now)) / 1000)}s`)
        : el('span', { class: 'dim' }, 'Nobody holds the hill yet. Crack the lock!'));
      const shielded = (h.shieldUntil || 0) > now;
      shieldEl.hidden = !shielded;
      shieldEl.textContent = shielded ? `🛡 FORTIFIED for ${Math.ceil((h.shieldUntil - now) / 1000)}s: captures are blocked` : '';
      lockEl.textContent = mine ? '(you hold it: defend with fortify)' : l.prompt;
      lockEl.classList.toggle('mine', mine);
      hintEl.textContent = mine ? '' : `hint: ${l.hint}`;
      ctx.stage.querySelector('.koth')?.classList.toggle('held-by-me', mine);
    }

    // Tell the player what changed on the hill.
    function announce() {
      const h = hill();
      if (h.holder !== lastHolder) {
        if (h.holder === me) {
          term.print('👑 YOU CAPTURED THE HILL! Hold it to score. Type fortify to block attacks.', 'ok');
          ctx.sfx.win();
          ctx.fx('win');
        } else if (h.holder) {
          term.printParts([['⚑ ', 'warn'], [nameOf(h.holder), 'pname'], [lastHolder === me ? ' took the hill from you!' : ' captured the hill.', 'warn']]);
          if (lastHolder === me) { ctx.sfx.hit(); ctx.fx('hit'); } else ctx.sfx.alert();
        }
        lastHolder = h.holder;
      }
      if (h.lock !== shownLock) {
        shownLock = h.lock;
        pending = -1;
        if (h.holder !== me) term.printParts([['NEW LOCK: ', 'hi'], [lock().prompt, 'cmd']]);
      }
    }

    function sendFortify() {
      const h = hill();
      if (h.holder !== me) return term.print('You can only fortify while you hold the hill.', 'warn');
      const left = (ctx.myState().fortAt || 0) + FORTIFY_COOLDOWN - ctx.now();
      if (left > 0) return term.print(`Fortify is recharging: ${Math.ceil(left / 1000)}s.`, 'warn');
      ctx.push('actions', { type: 'fortify', from: me, at: ctx.now() });
      term.print(`🛡 FORTIFIED! Captures are blocked for ${SHIELD_MS / 1000}s.`, 'ok');
      ctx.sfx.ok();
    }

    term.onCommand = (raw) => {
      const line = raw.trim();
      const [cmd, ...args] = line.split(/\s+/);
      const word = (cmd || '').toLowerCase();
      if (!line) return;
      if (word === 'help') {
        term.print('Commands: <answer> (or capture <answer>), fortify, hill, players, say <msg>, clear', 'dim');
        return;
      }
      if (word === 'clear') return term.clear();
      if (word === 'hill' || word === 'look') {
        const l = lock();
        return term.printParts([['LOCK: ', 'hi'], [l.prompt, 'cmd'], [`   (hint: ${l.hint})`, 'dim']]);
      }
      if (word === 'players') {
        for (const p of ctx.players()) term.printParts([['  ● ', 'dim'], [p.name, 'pname'], [`  ${Math.floor(heldMs(p, hill(), ctx.now()) / 1000)}s held`, 'dim']]);
        return;
      }
      if (word === 'say') return args.length ? ctx.say(args.join(' ')) : term.print('usage: say <message>', 'warn');
      if (word === 'fortify') return sendFortify();
      const answer = word === 'capture' ? args.join(' ') : line;
      const h = hill();
      if (h.holder === me) return term.print('You already hold the hill. Type fortify to defend it.', 'dim');
      if ((h.shieldUntil || 0) > ctx.now()) return term.print('The hill is fortified right now. Get your answer ready!', 'warn');
      if (ctx.now() < wrongUntil) return term.print('Lock jammed. Wait a moment…', 'warn');
      if (pending === h.lock) return term.print('Answer sent. Waiting to see who was first…', 'dim');
      if (!checkAnswer(lock(), answer)) {
        wrongUntil = ctx.now() + WRONG_COOLDOWN;
        term.printParts([['✖ ', 'err'], [answer || '(empty)', 'err'], ['  wrong answer, lock jammed for 2s.', 'dim']]);
        ctx.sfx.err();
        return;
      }
      pending = h.lock;
      ctx.push('actions', { type: 'capture', from: me, lock: h.lock, answer: answer.trim().toLowerCase(), at: ctx.now() });
      term.print('✔ Lock cracked! Capturing…', 'ok');
      ctx.sfx.fire();
    };
    term.complete = () => ['fortify', 'hill', 'players', 'help', 'capture'];

    // ---- Side panel: time held ----
    function renderSide() {
      ctx.side.innerHTML = '';
      ctx.side.append(el('h2', {}, '// TIME ON TOP'));
      const now = ctx.now();
      const h = hill();
      const rows = ctx.players().sort((a, b) => heldMs(b, h, now) - heldMs(a, h, now));
      for (const p of rows) {
        ctx.side.append(el('div', { class: 'side-row' + (p.id === h.holder ? ' target' : '') },
          el('span', { class: 'dot', style: { background: p.color } }),
          el('span', { class: 'pname', style: { color: p.color } }, (p.id === h.holder ? '👑 ' : '') + p.name + (p.id === me ? ' (you)' : '')),
          el('span', { class: 'progress-text' }, `${Math.floor(heldMs(p, h, now) / 1000)}s`)));
      }
    }

    // ---- Host: decide captures, run bots, finish ----
    const done = new Set();
    const bots = {};
    // The host is the only one who writes the hill and the scores, so it
    // trusts its own latest copy (the room can lag a moment behind online).
    let hostHill = null;
    const hostS = {}; // player id -> { held, caps, fortAt } written by the host
    function hostTick() {
      const now = ctx.now();
      const room = ctx.room;
      let h = hostHill || hill();
      // Captures and fortifies, in the order they arrived.
      const entries = Object.entries(room.actions || {}).sort(([a], [b]) => (a < b ? -1 : 1));
      const changes = {};
      const players = Object.fromEntries(Object.entries(room.players || {}).map(([id, p]) => [id, { ...p, s: { ...(p.s || {}), ...(hostS[id] || {}) } }]));
      for (const [key, a] of entries) {
        if (done.has(key)) continue;
        done.add(key);
        changes[`actions/${key}`] = null;
        const res = resolveAction(a, { hill: h, seed: ctx.seed, players, now });
        if (!res) continue;
        Object.assign(changes, res);
        if (res.game) h = res.game;
        if (res['game/shieldUntil']) h = { ...h, shieldUntil: res['game/shieldUntil'] };
        for (const [k, v] of Object.entries(res)) {
          const m = k.match(/^players\/([^/]+)\/s\/(\w+)$/);
          if (m) players[m[1]] = { ...players[m[1]], s: { ...(players[m[1]]?.s || {}), [m[2]]: v } };
        }
      }
      // Bots: solve each new lock after a while; fortify now and then.
      const level = botParams(room.botLevel);
      for (const p of ctx.players()) {
        if (!p.bot) continue;
        const b = (bots[p.id] ??= { lock: -1, at: 0 });
        if (b.lock !== h.lock) { b.lock = h.lock; b.at = now + between(level.kothSolveMs); }
        if (p.id === h.holder) {
          if (now - (players[p.id]?.s?.fortAt || 0) > FORTIFY_COOLDOWN && Math.random() < 0.04) {
            const res = resolveAction({ type: 'fortify', from: p.id }, { hill: h, seed: ctx.seed, players, now });
            if (res) { Object.assign(changes, res); h = { ...h, shieldUntil: res['game/shieldUntil'] }; }
          }
          continue;
        }
        if (now >= b.at) {
          const res = resolveAction({ type: 'capture', from: p.id, lock: h.lock, answer: lockFor(ctx.seed, h.lock).answer }, { hill: h, seed: ctx.seed, players, now });
          if (res) {
            Object.assign(changes, res);
            h = res.game;
            for (const [k, v] of Object.entries(res)) {
              const m = k.match(/^players\/([^/]+)\/s\/(\w+)$/);
              if (m) players[m[1]] = { ...players[m[1]], s: { ...(players[m[1]]?.s || {}), [m[2]]: v } };
            }
          } else b.at = now + 1500; // fortified: try again soon
        }
      }
      if (Object.keys(changes).length) {
        // Write the whole hill at once (an update can't set "game" and "game/x" together).
        const hillChanged = Object.keys(changes).some((k) => k === 'game' || k.startsWith('game/'));
        for (const k of Object.keys(changes)) if (k.startsWith('game/')) delete changes[k];
        if (hillChanged) changes.game = { lock: h.lock, holder: h.holder ?? null, since: h.since || 0, shieldUntil: h.shieldUntil || 0 };
        hostHill = h;
        for (const k of Object.keys(changes)) {
          const m = k.match(/^players\/([^/]+)\/s\/(\w+)$/);
          if (m) hostS[m[1]] = { ...(hostS[m[1]] || {}), [m[2]]: changes[k] };
        }
        ctx.update(changes);
      }
      if (now >= ctx.startedAt + ctx.timeLimit) finish(h, players);
    }

    function finish(h, players) {
      const now = ctx.now();
      const rows = ctx.players().map((p) => ({ ...p, s: players[p.id]?.s || p.s }))
        .sort((a, b) => heldMs(b, h, now) - heldMs(a, h, now) || (b.s?.caps || 0) - (a.s?.caps || 0));
      const results = rows.map((p, i) => ({
        id: p.id, name: p.name, color: p.color, place: i + 1,
        stats: `${p.s?.caps || 0} capture${p.s?.caps === 1 ? '' : 's'}`,
        detail: `held the hill ${fmtTime(heldMs(p, h, now))}`,
      }));
      const top = rows[0];
      ctx.end(results, top && heldMs(top, h, now) > 0 ? `${top.name} is King of the Hill!` : 'Nobody captured the hill!');
    }

    ctx.every(250, () => {
      const left = ctx.startedAt + ctx.timeLimit - ctx.now();
      ctx.setTimer(fmtTime(left), left < 30000 ? 'danger' : '');
      renderStage();
      if (ctx.isHost()) hostTick();
    });
    ctx.every(1000, renderSide);

    term.print('KING OF THE HILL. Crack the lock to capture THE HILL, then hold it as long as you can.', 'dim');
    term.print('Type the answer and press Enter. While you hold it, type fortify to block captures for 10s.', 'dim');
    announce();
    renderStage();
    renderSide();
    // Test hook: the current lock's answer.
    if (window.__ra) window.__ra.koth = { answer: () => lock().answer, lock: () => hill().lock };

    return {
      onRoom() {
        announce();
        renderStage();
        renderSide();
      },
    };
  },
};
