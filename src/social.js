// ONLINE PLAYERS (left side): who's on right now, search, profiles with stats,
// and private chats. Safety: block players, or turn private messages off.

import { el, load, save } from './util.js';
import { convId } from './net/shared.js';

const ONLINE_STALE_MS = 120000;

export function createSocial({ getNet, profile, status, sfx }) {
  let net = null;
  let offPresence = null;
  let offInbox = null;
  let offDm = null;
  let players = {};
  let inbox = {};
  let dmWith = null; // uid of the open private chat
  let open = null; // null = follow the screen; true/false = the player's choice
  let screen = 'menu';
  let lastUnread = 0;
  let beat = null;
  const blocked = new Set(load('ra-blocked', []));
  const lastRead = load('ra-dm-read', {});
  let dmOn = load('ra-dm-on', true) !== false;

  // ---- Elements ----
  const countEl = el('span', { class: 'social-count' });
  const unreadEl = el('span', { class: 'social-unread', hidden: true });
  const tab = el('button', { class: 'social-tab', type: 'button', 'aria-label': 'Online players', title: 'Online players', onclick: () => setOpen(true) }, '👥 ', countEl, unreadEl);
  const search = el('input', { type: 'search', placeholder: 'Search players…', 'aria-label': 'Search players', maxlength: 16, oninput: () => renderList() });
  const dmToggle = el('button', { type: 'button', class: 'mini-btn', onclick: () => { dmOn = !dmOn; save('ra-dm-on', dmOn); renderToggle(); publish(); } });
  const list = el('ul', { class: 'social-list' });
  const recent = el('div', { class: 'social-recent' });
  const panel = el('div', { class: 'social-panel panel' },
    el('div', { class: 'acct-head' }, el('h2', {}, '// ONLINE ', el('span', { class: 'dim' }, countEl.cloneNode())), el('button', { type: 'button', class: 'icon-x', 'aria-label': 'Hide online players', onclick: () => setOpen(false) }, '«')),
    search,
    el('div', { class: 'social-toggle small' }, el('span', { class: 'dim' }, 'Private messages:'), dmToggle),
    recent,
    list);
  const root = el('aside', { id: 'social', class: 'social', 'aria-label': 'Online players' }, tab, panel);
  document.body.append(root);
  const headCount = panel.querySelector('h2 .dim');

  // Profile window.
  const prof = el('dialog', { class: 'profile-dialog', 'aria-label': 'Player profile' });
  prof.addEventListener('click', (e) => { if (e.target === prof) prof.close(); });
  document.body.append(prof);

  // Private chat window.
  const dmTitle = el('span', { class: 'pname' });
  const dmLog = el('div', { class: 'dm-log', role: 'log' });
  const dmInput = el('input', { type: 'text', maxlength: 300, placeholder: 'Message…', 'aria-label': 'Private message', autocomplete: 'off' });
  const dmNote = el('p', { class: 'small dim dm-note' });
  const dmBox = el('div', { class: 'dm-box panel', hidden: true },
    el('div', { class: 'acct-head' }, el('strong', {}, '💬 ', dmTitle), el('button', { type: 'button', class: 'icon-x', 'aria-label': 'Close chat', onclick: () => closeDm() }, '✕')),
    dmLog, dmNote,
    el('form', { class: 'chat-form', onsubmit: (e) => { e.preventDefault(); sendDm(); } }, dmInput));
  document.body.append(dmBox);

  // ---- Helpers ----
  const me = () => net?.uid;
  const others = () => Object.entries(players).filter(([id, p]) => id !== me() && p && (net?.now?.() ?? Date.now()) - (p.at || 0) < ONLINE_STALE_MS);
  const conv = (other) => convId(me(), other);
  const unreadFrom = (other) => {
    const m = inbox[conv(other)];
    return m && !blocked.has(other) && m.from !== me() && (m.at || 0) > (lastRead[conv(other)] || 0) ? 1 : 0;
  };
  const unreadTotal = () => Object.values(inbox).filter((m) => m && m.from !== me() && !blocked.has(m.from) && (m.at || 0) > (lastRead[conv(m.from)] || 0)).length;

  function setOpen(v) {
    open = v;
    render();
  }
  function isOpen() {
    return open ?? ((screen === 'menu' || screen === 'browse') && innerWidth >= 1100);
  }
  function renderToggle() {
    dmToggle.textContent = dmOn ? 'on' : 'off';
    dmToggle.classList.toggle('selected', dmOn);
  }

  function render() {
    root.classList.toggle('open', isOpen());
    const n = others().length;
    countEl.textContent = String(n);
    headCount.textContent = `(${n})`;
    const u = unreadTotal();
    unreadEl.hidden = !u;
    unreadEl.textContent = String(u);
    if (u > lastUnread) { sfx?.chat(); tab.classList.remove('ping'); void tab.offsetWidth; tab.classList.add('ping'); }
    lastUnread = u;
    renderToggle();
    renderList();
    renderRecent();
  }

  function renderList() {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    const rows = others().filter(([, p]) => !q || String(p.name || '').toLowerCase().includes(q))
      .sort(([a, pa], [b, pb]) => unreadFrom(b) - unreadFrom(a) || (pb.level || 0) - (pa.level || 0) || String(pa.name).localeCompare(String(pb.name)));
    if (!net) list.append(el('li', { class: 'dim small' }, 'Connecting…'));
    else if (!rows.length) list.append(el('li', { class: 'dim small social-empty' }, q ? 'No one matches.' : 'No one else is online right now.'));
    for (const [id, p] of rows) {
      const u = unreadFrom(id);
      list.append(el('li', {}, el('button', { type: 'button', class: 'social-row' + (blocked.has(id) ? ' blocked' : ''), 'data-uid': id, onclick: () => openProfile(id) },
        el('span', { class: 'dot', style: { background: p.color || '#33ff66' } }),
        el('span', { class: 'social-who' }, el('span', { class: 'pname' }, p.name), el('span', { class: 'small dim' }, `LV${p.level || 1} · ${p.status || 'online'}`)),
        u ? el('span', { class: 'social-unread' }, '1') : null)));
    }
  }

  function renderRecent() {
    recent.innerHTML = '';
    const chats = Object.values(inbox).filter((m) => m && m.from !== me() && !blocked.has(m.from) && (m.at || 0) > (lastRead[conv(m.from)] || 0));
    if (!chats.length) return;
    recent.append(el('div', { class: 'small dim' }, 'New messages'));
    for (const m of chats) {
      recent.append(el('button', { type: 'button', class: 'social-msg', onclick: () => openDm(m.from, m.name) },
        el('span', { class: 'pname', style: { color: m.color || '' } }, m.name), el('span', { class: 'small' }, ` ${String(m.text).slice(0, 40)}`)));
    }
  }

  // ---- Profile ----
  function openProfile(id) {
    const p = players[id];
    if (!p) return;
    const winRate = p.rounds ? Math.round((100 * (p.wins || 0)) / p.rounds) : 0;
    const isBlocked = blocked.has(id);
    const canDm = dmOn && !isBlocked && p.dm !== false;
    prof.innerHTML = '';
    prof.append(...[
      el('div', { class: 'acct-head' }, el('h2', {}, '// PLAYER'), el('button', { type: 'button', class: 'icon-x', 'aria-label': 'Close', onclick: () => prof.close() }, '✕')),
      el('div', { class: 'profile-top' },
        el('span', { class: 'acct-dot', style: { background: p.color || '#33ff66' } }),
        el('div', {}, el('strong', { class: 'pname profile-name' }, p.name),
          el('div', { class: 'small dim' }, `${p.title || ''}${p.signedIn ? ' · account' : ' · guest'}`))),
      el('div', { class: 'small dim' }, `Right now: ${p.status || 'online'}`),
      el('div', { class: 'profile-stats' },
        stat('Level', p.level || 1), stat('XP', p.xp || 0), stat('Rounds', p.rounds || 0),
        stat('Wins', p.wins || 0), stat('Win %', `${winRate}%`), stat('Trophies', `🏆 ${p.trophies || 0}`)),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'primary', disabled: !canDm, title: canDm ? '' : !dmOn ? 'Your private messages are off' : isBlocked ? 'Unblock them first' : 'They have private messages off', onclick: () => { prof.close(); openDm(id, p.name); } }, '💬 Message'),
        el('button', { type: 'button', onclick: () => { toggleBlock(id); openProfile(id); } }, isBlocked ? 'Unblock' : '🚫 Block')),
      !canDm && p.dm === false ? el('p', { class: 'small dim' }, `${p.name} has private messages turned off.`) : null].filter(Boolean));
    if (!prof.open) prof.showModal();
  }
  const stat = (label, value) => el('div', { class: 'profile-stat' }, el('strong', {}, String(value)), el('span', { class: 'small dim' }, label));

  function toggleBlock(id) {
    if (blocked.has(id)) blocked.delete(id);
    else {
      blocked.add(id);
      if (dmWith === id) closeDm();
    }
    save('ra-blocked', [...blocked]);
    render();
  }

  // ---- Private chat ----
  function openDm(id, name) {
    if (!net || blocked.has(id)) return;
    closeDm();
    dmWith = id;
    dmTitle.textContent = name || players[id]?.name || 'player';
    dmBox.hidden = false;
    dmLog.innerHTML = '';
    dmNote.textContent = 'Be kind. Never share passwords or personal info. Block anyone who bothers you.';
    offDm = net.dmWatch(id, (msgs) => {
      dmLog.innerHTML = '';
      const entries = Object.entries(msgs || {}).sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [, m] of entries) {
        const mine = m.from === me();
        dmLog.append(el('div', { class: 'dm-msg' + (mine ? ' mine' : '') }, mine ? null : el('span', { class: 'chat-name', style: { color: m.color || '' } }, m.name + ':'), ' ', m.text));
      }
      dmLog.scrollTop = dmLog.scrollHeight;
      markRead(id);
    });
    dmInput.focus();
    markRead(id);
  }
  function closeDm() {
    offDm?.();
    offDm = null;
    dmWith = null;
    dmBox.hidden = true;
  }
  function markRead(id) {
    lastRead[conv(id)] = Math.max((inbox[conv(id)]?.at || 0), (net?.now?.() ?? Date.now()));
    save('ra-dm-read', lastRead);
    render();
  }
  async function sendDm() {
    const text = dmInput.value.trim();
    if (!text || !dmWith) return;
    const them = players[dmWith];
    if (them && them.dm === false) { dmNote.textContent = `${them.name} turned private messages off.`; return; }
    dmInput.value = '';
    const p = profile();
    try {
      await net.dmSend(dmWith, { name: p.name, color: p.color, text: text.slice(0, 300) });
    } catch (e) {
      dmNote.textContent = `Couldn't send: ${e.message}`;
    }
  }
  dmInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDm(); });

  // ---- Presence ----
  function publish() {
    if (!net?.presenceSet) return;
    net.presenceSet({ ...profile(), status: status(), dm: dmOn }).catch(() => {});
  }

  function connect() {
    const next = getNet();
    if (!next?.presenceWatch || next === net) return;
    // Switching from local to online (or back): leave the old one.
    offPresence?.(); offInbox?.(); closeDm();
    net?.presenceClear?.();
    net = next;
    offPresence = net.presenceWatch((all) => { players = all || {}; render(); if (prof.open && dmWith === null) { /* keep profile as is */ } });
    offInbox = net.inboxWatch((box) => { inbox = box || {}; render(); });
    clearInterval(beat);
    beat = setInterval(publish, net.kind === 'local' ? 5000 : 30000);
    publish();
  }

  render();
  return {
    // Call when the screen changes, you sign in, or online play connects.
    touch() { connect(); publish(); render(); },
    setScreen(name) { screen = name; this.touch(); },
    get blocked() { return blocked; },
  };
}
