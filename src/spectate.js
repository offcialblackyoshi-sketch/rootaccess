// SPECTATING: joining a room whose game already started lets you watch it.
// You see a live scoreboard for the mode, the round timer and the chat, and
// you join in as a normal player when the room goes back to the lobby.

import { el, playerList, roundTime, fmtTime } from './util.js';
import { avatarEl } from './avatar.js';
import { score as defendScore } from './modes/defend.js';
import { MODES, PUZZLES } from './modes/index.js';

const HEIST_STAGES = ['DOOR', 'LOGIN', 'VAULT'];

// How far along a player is, for the scoreboard: { value 0..1, label }.
// best: the top score among players (for modes without a fixed maximum).
export function progressOf(modeId, s = {}, best = 1) {
  if (modeId === 'race') {
    const layer = Math.min(s.layer || 0, 5);
    return { value: layer / 5, label: layer >= 5 ? 'ROOTED ✓' : `layer ${layer + 1}/5` };
  }
  if (modeId === 'duel') {
    if (s.out) return { value: 0, label: 'OUT' };
    const hp = Math.max(0, Math.min(100, s.hp ?? 100));
    return { value: hp / 100, label: `firewall ${hp}` };
  }
  if (modeId === 'defend') {
    const sc = defendScore(s);
    return { value: best > 0 ? sc / best : 0, label: `${sc} data` };
  }
  if (modeId === 'heist') return { value: 0, label: s.role ? s.role : 'crew' };
  if (PUZZLES[modeId] || modeId === 'gauntlet') {
    const st = Math.min(s.stage || 0, 5);
    return { value: st / 5, label: st >= 5 ? 'ALL CLEAR ✓' : `stage ${st + 1}/5` };
  }
  return { value: 0, label: '' };
}

// Players in the order a viewer cares about: furthest along first.
export function spectateRows(room) {
  const players = playerList(room);
  const best = Math.max(1, ...players.map((p) => (room.mode === 'defend' ? defendScore(p.s) : 0)));
  return players
    .map((p) => ({ p, ...progressOf(room.mode, p.s || {}, best) }))
    .sort((a, b) => b.value - a.value || String(a.p.name).localeCompare(String(b.p.name)));
}

// Who's watching (not playing) in a room.
export const spectators = (room) => Object.entries(room?.players || {}).filter(([, p]) => p?.spectator).map(([id, p]) => ({ id, ...p }));

export function createSpectate({ now }) {
  let timer = null;
  let latest = null;

  function tick() {
    if (!latest) return;
    const mode = MODES[latest.mode];
    const limit = roundTime(mode, latest.roundLength); // ms (0 = no time limit)
    const left = Math.max(0, (latest.startedAt || 0) + limit - now());
    const t = document.getElementById('gameTimer');
    if (t) { t.textContent = limit ? fmtTime(left) : ''; t.className = limit && left < 30000 ? 'warn' : ''; }
  }

  return {
    // Draw the spectator view into the game screen.
    render(room) {
      latest = room;
      const mode = MODES[room.mode] || { name: room.mode };
      document.getElementById('gameMode').textContent = mode.name;
      document.getElementById('gameRoom').textContent = '👀 SPECTATING';
      const stage = document.getElementById('stage');
      const side = document.getElementById('side');
      document.getElementById('screen-game').classList.remove('quick-mode');
      document.getElementById('gameAbort').hidden = true;
      stage.innerHTML = '';
      side.innerHTML = '';
      const rows = spectateRows(room);
      const g = room.game || {};
      stage.append(el('div', { class: 'spectate' },
        el('div', { class: 'spectate-head' },
          el('h2', {}, '👀 You\'re watching'),
          el('p', { class: 'small dim' }, 'This game started before you joined. You\'ll play in the next round. Chat is on the right.')),
        room.mode === 'heist' ? el('div', { class: 'spectate-heist' },
          `Crew progress: ${HEIST_STAGES[Math.min(g.stage || 0, 2)]} (${Math.min((g.stage || 0) + 1, 3)}/3) · alarm ${Math.round(g.alarm ?? 10)}%`) : null,
        el('ul', { class: 'spectate-list' }, rows.map(({ p, value, label }) => el('li', { class: 'spectate-row', 'data-player': p.id },
          avatarEl(p.name, p.color || '#33ff66', 28),
          el('span', { class: 'pname', style: { color: p.color || '' } }, p.name),
          el('span', { class: 'spectate-bar', 'aria-hidden': 'true' }, el('span', { style: { width: `${Math.round(value * 100)}%`, background: p.color || '' } })),
          el('span', { class: 'small spectate-label' }, label))))));
      const watching = spectators(room);
      side.append(el('div', { class: 'spectate-side' },
        el('h3', {}, `// WATCHING (${watching.length})`),
        el('ul', { class: 'small' }, watching.map((w) => el('li', {}, el('span', { class: 'pname' }, w.name))))));
      tick();
      if (!timer) timer = setInterval(tick, 500);
    },
    stop() {
      clearInterval(timer);
      timer = null;
      latest = null;
    },
  };
}
