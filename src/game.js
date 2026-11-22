// Runs one round of a game mode: sets up the game screen, the terminal,
// the countdown, and gives the mode a "ctx" object with everything it needs.

import { Terminal } from './terminal.js';
import { MODES } from './modes/index.js';
import { playerList, roundTime } from './util.js';
import { secondsCrossed } from './sfx.js';
import { getSettings } from './settings.js';

export function startSession({ net, code, room, sfx, sendChat, focusChat }) {
  const mode = MODES[room.mode];
  const me = net.uid;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const side = $('side');
  const timerEl = $('gameTimer');
  const overlay = $('countdown');

  stage.innerHTML = '';
  side.innerHTML = '';
  timerEl.textContent = '';
  $('gameMode').textContent = mode.name;
  $('gameRoom').textContent = room.practice ? 'PRACTICE' : `ROOM ${code}`;
  // Quick-hack mini-games are played on the stage, not by typing.
  $('screen-game').classList.toggle('quick-mode', !!mode.quick);

  const term = new Terminal($('term'));
  term.onEscape = focusChat; // Esc jumps to chat, Esc again comes back
  term.input.addEventListener('keydown', (e) => {
    if (e.key.length === 1 && !e.ctrlKey && getSettings().keyClicks) sfx.key();
  });
  let latest = room;
  let mounted = null;
  let ended = false;
  let destroyed = false;
  const intervals = [];
  const timeouts = [];

  const ctx = {
    net, code, me, mode, term, stage, side, sfx,
    get room() { return latest; },
    get seed() { return latest.seed; },
    get startedAt() { return latest.startedAt; },
    get destroyed() { return destroyed; },
    timeLimit: roundTime(mode, room.roundLength),
    players: () => playerList(latest),
    player: (id) => latest.players?.[id],
    myState: () => latest.players?.[me]?.s || {},
    isHost: () => latest.hostId === me,
    now: () => net.now(),
    // The players this browser acts for: you, plus bots if you're the host.
    controlled() {
      const ids = [me];
      if (ctx.isHost()) for (const p of ctx.players()) if (p.bot) ids.push(p.id);
      return ids;
    },
    update: (changes) => net.update(code, changes).catch((e) => term.print('network error: ' + e.message, 'err')),
    push: (list, value) => net.push(code, list, value),
    say: (text) => sendChat(text),
    focusChat,
    setTimer(text, cls = '') {
      timerEl.textContent = text;
      timerEl.className = cls;
    },
    every(ms, fn) {
      const run = () => {
        if (destroyed) return;
        try { fn(); } catch (e) { console.error(e); }
      };
      const id = setInterval(run, ms);
      intervals.push(id);
      timeouts.push(setTimeout(run, 0));
      return id;
    },
    later(ms, fn) {
      const id = setTimeout(() => { if (!destroyed) fn(); }, ms);
      timeouts.push(id);
      return id;
    },
    // Host only: finish the round and show everyone the results.
    end(results, summary = '', summaryWin = null) {
      if (ended || !ctx.isHost()) return;
      ended = true;
      net.update(code, { status: 'done', results, summary, summaryWin, endedAt: net.now() });
    },
    // Visual effects: 'hit' (red flash + shake), 'win' (glow), 'big' (glow + rain burst).
    fx(type) {
      const screen = document.getElementById('screen-game');
      const cls = type === 'hit' ? 'fx-hit' : 'fx-win';
      screen.classList.remove(cls);
      void screen.offsetWidth;
      screen.classList.add(cls);
      setTimeout(() => screen.classList.remove(cls), 1200);
      if (type === 'big') window.dispatchEvent(new CustomEvent('ra-fx', { detail: { burst: true } }));
    },
    // Commands every mode's shell gets.
    addCommon(shell) {
      shell.register('say', {
        help: 'send a chat message to the room',
        usage: 'say <message>',
        run: (args) => {
          if (!args.length) return shell.print('usage: say <message>', 'warn');
          sendChat(args.join(' '));
        },
      });
      shell.register('players', {
        help: 'list everyone in the game',
        run: () => {
          for (const p of ctx.players()) {
            shell.term.printParts([['  ● ', 'dim'], [p.name, 'pname'], [p.bot ? '  (bot)' : p.id === me ? '  (you)' : '', 'dim']]);
          }
        },
      });
    },
  };

  // Color player names in terminal output.
  term.root.style.setProperty('--me', latest.players?.[me]?.color || '#33ff66');

  // A short typed "boot sequence" while the countdown runs.
  term.typeOut([
    `> establishing secure link to ${mode.name.toLowerCase()} grid...`,
    '> routing through 7 proxies... OK',
    '> operator authenticated. Stand by.',
  ].join('\n'), 'boot-line', 900);

  let lastCountdown = Infinity;
  function tryMount() {
    if (destroyed || mounted) return;
    const left = latest.startedAt - net.now();
    if (lastCountdown !== Infinity && secondsCrossed(lastCountdown, left, 3).length) sfx.tick();
    lastCountdown = left;
    if (left > 0) {
      overlay.hidden = false;
      const shown = String(Math.ceil(left / 1000));
      if (overlay.textContent !== shown) {
        // Pop each new number in.
        overlay.textContent = shown;
        overlay.classList.remove('tick');
        void overlay.offsetWidth;
        overlay.classList.add('tick');
      }
      term.setEnabled(false);
      setTimeout(tryMount, Math.min(200, left));
      return;
    }
    overlay.hidden = true;
    term.setEnabled(true);
    sfx.go();
    // Tick during the last 10 seconds of the round.
    let lastLeft = Infinity;
    ctx.every(250, () => {
      if (!ctx.timeLimit) return;
      const left = latest.startedAt + ctx.timeLimit - net.now();
      if (lastLeft !== Infinity && secondsCrossed(lastLeft, left, 10).length) sfx.tick();
      lastLeft = left;
    });
    // Host housekeeping: drop actions aimed at players who have left.
    ctx.every(2000, () => {
      if (!ctx.isHost()) return;
      const changes = {};
      for (const [key, a] of Object.entries(latest.actions || {})) {
        if (a.to && !latest.players?.[a.to]) changes[`actions/${key}`] = null;
      }
      if (Object.keys(changes).length) ctx.update(changes);
    });
    mounted = mode.mount(ctx) || {};
    mounted.onRoom?.(latest);
    if (mounted.focus) mounted.focus();
    else term.focus();
  }
  tryMount();

  return {
    round: room.round,
    update(r) {
      latest = r;
      if (mounted && !destroyed) {
        try { mounted.onRoom?.(r); } catch (e) { console.error(e); }
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      intervals.forEach(clearInterval);
      timeouts.forEach(clearTimeout);
      overlay.hidden = true;
      $('screen-game').classList.remove('quick-mode');
      try { mounted?.destroy?.(); } catch (e) { console.error(e); }
    },
  };
}
