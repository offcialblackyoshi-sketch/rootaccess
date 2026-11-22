// QUICK HACKS: easy visual mini-games played with arrow keys, Space and the
// mouse instead of typed commands. Each mini-game becomes its own mode here:
// 5 stages that get harder, the same puzzles for everyone, and a short
// lockout (never a knock-out) for each mistake.

import { makeRng } from '../rng.js';
import { el, fmtTime, bar } from '../util.js';
import { botParams, between } from '../bots.js';
import { getSettings } from '../settings.js';

export const STAGES = 5;
export const LOCK_MS = 3000;
const TIME_LIMIT = 3 * 60 * 1000;

// "5/5 stages · 2 mistakes · fastest stage 0:09"
export function quickStatsText(s = {}) {
  const parts = [`${s.stage || 0}/${STAGES} stages`, `${s.mistakes || 0} mistake${s.mistakes === 1 ? '' : 's'}`];
  if (s.fastest) parts.push(`fastest stage ${fmtTime(s.fastest)}`);
  return parts.join(' · ');
}

// The same puzzle for every player: seeded by mode, room seed and stage.
export function stageRng(modeId, seed, stage) {
  return makeRng(`${modeId}:${seed}:${stage}`);
}

export function makeQuickMode(puzzle) {
  return {
    id: puzzle.id,
    name: puzzle.name,
    min: 1,
    max: 8,
    bots: true,
    quick: true,
    timeLimit: puzzle.timeLimit || TIME_LIMIT,
    blurb: puzzle.blurb,

    setup({ players }) {
      const out = {};
      for (const p of players) out[p.id] = { stage: 0, at: 0, mistakes: 0 };
      return { players: out };
    },

    mount(ctx) {
      const { term, me } = ctx;
      const mine = ctx.myState();
      let stage = mine.stage || 0; // a reload picks up where you left off
      let mistakes = mine.mistakes || 0;
      let fastest = mine.fastest || 0;
      let stageStart = ctx.now();
      let lockUntil = 0;
      let inst = null;
      let data = null;

      // ---- Stage ----
      const stageLabel = el('strong');
      const pips = el('span', { class: 'qh-pips' });
      const lockFill = el('div', { class: 'fill danger' });
      const lockWhy = el('span', {}, 'LOCKED OUT');
      const note = el('div', { class: 'qh-note', 'aria-live': 'polite' });
      const lockEl = el('div', { class: 'qh-lock', hidden: true }, lockWhy, el('div', { class: 'track' }, lockFill));
      const area = el('div', { class: 'qh-area' });
      const howEl = el('div', { class: 'dim small qh-how' }, puzzle.howTo);
      // The puzzle for a stage: always the same one, or (Gauntlet) a different one each stage.
      const puzzleFor = (st) => (puzzle.pick ? puzzle.pick(ctx.seed, st) : puzzle);
      const box = el('div', { class: 'stage-box quick-box', tabindex: 0, 'aria-label': `${puzzle.name}. ${puzzle.howTo}` },
        el('div', { class: 'qh-head' }, stageLabel, pips, el('span', { class: 'spacer' }), el('span', { class: 'dim small' }, 'Esc = chat')),
        howEl,
        area, note, lockEl);
      ctx.stage.append(box);

      const locked = () => ctx.now() < lockUntil;
      const done = () => stage >= STAGES;

      // Clicking a button inside the game keeps keyboard focus on the game, so
      // Space and Enter go to the puzzle (not to the last button clicked).
      box.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) { e.preventDefault(); box.focus({ preventScroll: true }); }
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); ctx.focusChat?.(); return; }
        if (e.ctrlKey || e.altKey || e.metaKey || !inst || done()) return;
        if (locked()) {
          if (e.key.startsWith('Arrow') || e.key === ' ' || e.key === 'Enter') e.preventDefault();
          return;
        }
        if (inst.key(e)) e.preventDefault();
      });

      function renderHead() {
        stageLabel.textContent = done() ? 'ALL STAGES CLEARED' : `STAGE ${stage + 1}/${STAGES}${puzzle.pick ? ` · ${puzzleFor(stage).name.toUpperCase()}` : ''}`;
        pips.textContent = bar(stage / STAGES, STAGES);
      }

      function startStage() {
        inst?.destroy();
        inst = null;
        area.innerHTML = '';
        renderHead();
        if (done()) {
          area.append(el('div', { class: 'qh-done' }, '◆ ACCESS GRANTED ◆', el('div', { class: 'dim small' }, 'Waiting for the round to end…')));
          return;
        }
        const P = puzzleFor(stage);
        howEl.textContent = puzzle.pick ? `${P.name.toUpperCase()}: ${P.howTo}` : P.howTo;
        data = P.generate(stageRng(P.id, ctx.seed, stage), stage);
        stageStart = ctx.now();
        inst = P.start(area, {
          data,
          stage,
          lockMs: LOCK_MS,
          reduceMotion: getSettings().reduceMotion,
          canAct: () => !locked() && !done(),
          onSolve: solved,
          onMistake: mistake,
          onStep: () => ctx.sfx.tick(),
        });
      }

      function solved() {
        const took = ctx.now() - stageStart;
        fastest = fastest ? Math.min(fastest, took) : took;
        stage++;
        note.textContent = '';
        ctx.update({ [`players/${me}/s`]: { stage, at: ctx.now(), mistakes, fastest } });
        term.printParts([['✔ ', 'ok'], [`stage ${stage}/${STAGES} cleared in ${fmtTime(took)}`, 'ok']]);
        if (done()) {
          ctx.sfx.win();
          ctx.fx('big');
          term.print('◆ ALL STAGES CLEARED. Access granted.', 'ok');
        } else {
          ctx.sfx.ok();
          ctx.fx('win');
        }
        startStage();
      }

      // free: a gentle nudge (like submitting too early) that costs nothing.
      function mistake(why, { free = false } = {}) {
        if (free) { term.print(`! ${why}`, 'warn'); note.textContent = `! ${why}`; return; }
        mistakes++;
        lockUntil = ctx.now() + LOCK_MS;
        ctx.update({ [`players/${me}/s/mistakes`]: mistakes });
        lockWhy.textContent = `✖ ${why}. LOCKED OUT`;
        note.textContent = '';
        term.printParts([['✖ ', 'err'], [why, 'err'], [`  locked out for ${LOCK_MS / 1000} s`, 'dim']]);
        ctx.sfx.err();
        ctx.fx('hit');
      }

      // ---- Side panel ----
      function renderSide() {
        ctx.side.innerHTML = '';
        ctx.side.append(el('h2', {}, '// PROGRESS'));
        const rows = ctx.players().sort((a, b) => (b.s?.stage || 0) - (a.s?.stage || 0) || (a.s?.at || Infinity) - (b.s?.at || Infinity));
        for (const p of rows) {
          const s = p.s || {};
          ctx.side.append(el('div', { class: 'side-row' },
            el('span', { class: 'dot', style: { background: p.color } }),
            el('span', { class: 'pname', style: { color: p.color } }, p.name + (p.id === me ? ' (you)' : '')),
            el('span', { class: 'progress-text' }, `${bar((s.stage || 0) / STAGES, STAGES)} ${(s.stage || 0) >= STAGES ? 'DONE' : `${s.stage || 0}/${STAGES}`}`)));
        }
      }

      // ---- Timer, lockout bar, bots, finish ----
      const botNext = {};
      ctx.every(100, () => {
        const left = ctx.startedAt + ctx.timeLimit - ctx.now();
        ctx.setTimer(fmtTime(left), left < 30000 ? 'danger' : '');
        const lockLeft = lockUntil - ctx.now();
        lockEl.hidden = lockLeft <= 0;
        box.classList.toggle('locked', lockLeft > 0);
        if (lockLeft > 0) lockFill.style.width = `${(100 * lockLeft) / LOCK_MS}%`;
      });
      ctx.every(500, () => {
        if (!ctx.isHost()) return;
        const now = ctx.now();
        const left = ctx.startedAt + ctx.timeLimit - now;
        for (const p of ctx.players()) {
          if (!p.bot) continue;
          const s = p.s || {};
          if ((s.stage || 0) >= STAGES) continue;
          const range = botParams(ctx.room.botLevel).quickStageMs;
          botNext[p.id] ??= now + between(range);
          if (now >= botNext[p.id]) {
            botNext[p.id] = now + between(range);
            ctx.update({ [`players/${p.id}/s`]: { ...s, stage: (s.stage || 0) + 1, at: now } });
          }
        }
        if (left <= 0) finish();
      });

      function finish() {
        const rows = ctx.players().map((p) => ({ p, s: p.s || {} }))
          .sort((a, b) => (b.s.stage || 0) - (a.s.stage || 0) || (a.s.at || Infinity) - (b.s.at || Infinity));
        const results = rows.map(({ p, s }, i) => ({
          id: p.id, name: p.name, color: p.color, place: i + 1,
          stats: p.bot ? 'bot' : quickStatsText(s),
          raw: { stage: s.stage || 0, mistakes: s.mistakes || 0, ms: (s.stage || 0) >= STAGES ? s.at - ctx.startedAt : null },
          detail: (s.stage || 0) >= STAGES ? `cleared in ${fmtTime(s.at - ctx.startedAt)}` : `cleared ${s.stage || 0}/${STAGES} stages`,
        }));
        const w = rows[0];
        const summary = w && (w.s.stage || 0) >= STAGES ? `${w.p.name} cracked all ${STAGES} stages first!`
          : w && (w.s.stage || 0) > 0 ? `Time is up! ${w.p.name} got the furthest.` : 'Time is up! Nobody cleared a stage.';
        ctx.end(results, summary);
      }

      term.setPrompt('');
      term.print(`${puzzle.name.toUpperCase()}: ${puzzle.howTo}`, 'dim');
      term.print(`Clear all ${STAGES} stages first to win. A mistake locks you out for ${LOCK_MS / 1000} seconds.`, 'dim');
      term.setEnabled(false);
      startStage();
      // Test hook: solve the current stage, or read its puzzle data.
      if (window.__ra) window.__ra.quick = { solve: () => !done() && solved(), data: () => data, stage: () => stage, locked, puzzle: () => puzzleFor(stage).id };

      return {
        focus: () => box.focus({ preventScroll: true }),
        onRoom() {
          renderSide();
          if (ctx.isHost() && ctx.players().some((p) => (p.s?.stage || 0) >= STAGES)) finish();
        },
        destroy() { inst?.destroy(); },
      };
    },
  };
}
