// ONLINE PLAYERS (left side): who's on right now, search, profiles with stats,
// and private chats. Chats between two signed-in players are saved to their
// accounts (history, offline messages); guest chats last while both are online.
// Safety: block players, or turn private messages off.

import { el, load, save } from './util.js';
import { convId } from './net/shared.js';

const ONLINE_STALE_MS = 120000;

export function createSocial({ getNet, profile, status, sfx }) {
  let net = null;
  let offPresence = null;
  let offInbox = null;
  let offAcctInbox = null;
  let offDm = null;
  let acctId = null; // my account uid when signed in
  let players = {};
  let inbox = {}; // guest chats (this tab)
  let acctInbox = {}; // saved chats (my account)
  let chat = null; // the open chat: { kind: 'acct' | 'tab', id, name }
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
  const search = el('input', { type: 'search', placeholder: 'Search players…', 'aria-label': 'Search players', maxlength: 16, oninput: () => { renderList(); renderChats(); } });
  const dmToggle = el('button', { type: 'button', class: 'mini-btn', onclick: () => toggleDms() });
  const headCount = el('span', { class: 'dim' });
  const chatsEl = el('div', { class: 'social-chats' });
  const list = el('ul', { class: 'social-list' });
  const panel = el('div', { class: 'social-panel panel' },
    el('div', { class: 'acct-head' }, el('h2', {}, '// ONLINE ', headCount), el('button', { type: 'button', class: 'icon-x', 'aria-label': 'Hide online players', onclick: () => setOpen(false) }, '«')),
    search,
    el('div', { class: 'social-toggle small' }, el('span', { class: 'dim' }, 'Private messages:'), dmToggle),
    chatsEl,
    list);
  const root = el('aside', { id: 'social', class: 'social', 'aria-label': 'Online players' }, tab, panel);
  document.body.append(root);

  // Profile window.
  const prof = el('dialog', { class: 'profile-dialog', 'aria-label': 'Player profile' });
  prof.addEventListener('click', (e) => { if (e.target === prof) prof.close(); });
  document.body.append(prof);

  // Private chat window.
  const dmTitle = el('span', { class: 'pname' });
  const dmKind = el('span', { class: 'small dim' });
  const dmLog = el('div', { class: 'dm-log', role: 'log' });
  const dmInput = el('input', { type: 'text', maxlength: 300, placeholder: 'Message…', 'aria-label': 'Private message', autocomplete: 'off' });
  const dmNote = el('p', { class: 'small dim dm-note' });
  const dmBox = el('div', { class: 'dm-box panel', hidden: true },
    el('div', { class: 'acct-head' }, el('div', {}, el('strong', {}, '💬 ', dmTitle), el('div', {}, dmKind)), el('button', { type: 'button', class: 'icon-x', 'aria-label': 'Close chat', onclick: () => closeDm() }, '✕')),
    dmLog, dmNote,
    el('form', { class: 'chat-form', onsubmit: (e) => { e.preventDefault(); sendDm(); } }, dmInput));
  document.body.append(dmBox);

  // ---- Helpers ----
  const me = () => net?.uid;
  const now = () => net?.now?.() ?? Date.now();
  const others = () => Object.entries(players).filter(([id, p]) => id !== me() && p && (!acctId || p.acct !== acctId) && now() - (p.at || 0) < ONLINE_STALE_MS);
  const isBlocked = (p, id) => blocked.has(id) || (p?.acct && blocked.has(p.acct));
  // Saved account chat when both are signed in; otherwise a guest chat.
  const targetFor = (id, p) => (acctId && p?.acct && net?.acctChat ? { kind: 'acct', id: p.acct, name: p.name } : { kind: 'tab', id, name: p?.name || 'player' });
  const readKey = (t) => `${t.kind}:${t.kind === 'acct' ? convId(acctId, t.id) : convId(me(), t.id)}`;

  // Every conversation with something unread, as { target, name, color, text, at }.
  function unreadChats() {
    const out = [];
    for (const m of Object.values(inbox)) {
      if (!m || m.from === me() || blocked.has(m.from)) continue;
      const t = { kind: 'tab', id: m.from, name: m.name };
      if ((m.at || 0) > (lastRead[readKey(t)] || 0)) out.push({ target: t, ...m });
    }
    for (const m of Object.values(acctInbox)) {
      if (!m || m.from === acctId || blocked.has(m.with)) continue;
      const t = { kind: 'acct', id: m.with, name: m.withName };
      if ((m.at || 0) > Math.max(m.readAt || 0, lastRead[readKey(t)] || 0)) out.push({ target: t, ...m, name: m.withName });
    }
    return out;
  }
  const unreadFrom = (id, p) => unreadChats().some((c) => (c.target.kind === 'tab' ? c.target.id === id : c.target.id === p?.acct));

  function setOpen(v) {
    open = v;
    render();
  }
  const isOpen = () => open ?? ((screen === 'menu' || screen === 'browse') && innerWidth >= 1100);
  function renderToggle() {
    dmToggle.textContent = dmOn ? 'on' : 'off';
    dmToggle.classList.toggle('selected', dmOn);
  }
  function toggleDms() {
    dmOn = !dmOn;
    save('ra-dm-on', dmOn);
    // Signed in: remember it on the account, so saved chats respect it too.
    if (acctId) net?.account?.saveProfile({ dm: dmOn }).catch(() => {});
    renderToggle();
    publish();
  }

  function render() {
    root.classList.toggle('open', isOpen());
    const n = others().length;
    countEl.textContent = String(n);
    headCount.textContent = `(${n})`;
    const u = unreadChats().length;
    unreadEl.hidden = !u;
    unreadEl.textContent = String(u);
    if (u > lastUnread) { sfx?.chat(); tab.classList.remove('ping'); void tab.offsetWidth; tab.classList.add('ping'); }
    lastUnread = u;
    renderToggle();
    renderChats();
    renderList();
  }

  function renderList() {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    const rows = others().filter(([, p]) => !q || String(p.name || '').toLowerCase().includes(q))
      .sort(([a, pa], [b, pb]) => unreadFrom(b, pb) - unreadFrom(a, pa) || (pb.level || 0) - (pa.level || 0) || String(pa.name).localeCompare(String(pb.name)));
    if (!net) list.append(el('li', { class: 'dim small' }, 'Connecting…'));
    else if (!rows.length) list.append(el('li', { class: 'dim small social-empty' }, q ? 'No one online matches.' : 'No one else is online right now.'));
    for (const [id, p] of rows) {
      list.append(el('li', {}, el('button', { type: 'button', class: 'social-row' + (isBlocked(p, id) ? ' blocked' : ''), 'data-uid': id, onclick: () => openProfile(id) },
        el('span', { class: 'dot', style: { background: p.color || '#33ff66' } }),
        el('span', { class: 'social-who' }, el('span', { class: 'pname' }, p.name), el('span', { class: 'small dim' }, `LV${p.level || 1} · ${p.status || 'online'}`)),
        unreadFrom(id, p) ? el('span', { class: 'social-unread' }, '1') : null)));
    }
  }

  // Your conversations: unread guest chats, plus all saved account chats.
  function renderChats() {
    chatsEl.innerHTML = '';
    const q = search.value.trim().toLowerCase();
    const unread = unreadChats();
    const rows = new Map();
    for (const c of unread) rows.set(readKey(c.target), { ...c, unread: true });
    for (const m of Object.values(acctInbox)) {
      if (!m || blocked.has(m.with)) continue;
      const t = { kind: 'acct', id: m.with, name: m.withName };
      if (!rows.has(readKey(t))) rows.set(readKey(t), { target: t, ...m, name: m.withName, unread: false });
    }
    const shown = [...rows.values()].filter((c) => !q || String(c.name).toLowerCase().includes(q)).sort((a, b) => (b.unread - a.unread) || (b.at || 0) - (a.at || 0)).slice(0, 8);
    if (!shown.length) return;
    chatsEl.append(el('div', { class: 'small dim' }, acctId ? 'Chats' : 'New messages'));
    for (const c of shown) {
      chatsEl.append(el('button', { type: 'button', class: 'social-msg' + (c.unread ? ' unread' : ''), onclick: () => openDm(c.target) },
        el('span', { class: 'pname' }, c.name),
        el('span', { class: 'small dim' }, ` ${c.from === acctId ? 'you: ' : ''}${String(c.text).slice(0, 34)}`)));
    }
  }

  // ---- Profile ----
  function openProfile(id) {
    const p = players[id];
    if (!p) return;
    const winRate = p.rounds ? Math.round((100 * (p.wins || 0)) / p.rounds) : 0;
    const blockedNow = isBlocked(p, id);
    const canDm = dmOn && !blockedNow && p.dm !== false;
    const t = targetFor(id, p);
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
        el('button', { type: 'button', class: 'primary', disabled: !canDm, title: canDm ? '' : !dmOn ? 'Your private messages are off' : blockedNow ? 'Unblock them first' : 'They have private messages off', onclick: () => { prof.close(); openDm(t); } }, '💬 Message'),
        el('button', { type: 'button', onclick: () => { toggleBlock(id, p); openProfile(id); } }, blockedNow ? 'Unblock' : '🚫 Block')),
      canDm ? el('p', { class: 'small dim' }, t.kind === 'acct' ? 'You\'re both signed in, so this chat is saved.' : 'Guest chat: it lasts while you\'re both online. Sign in (both of you) to save chats.') : null,
      !canDm && p.dm === false ? el('p', { class: 'small dim' }, `${p.name} has private messages turned off.`) : null].filter(Boolean));
    if (!prof.open) prof.showModal();
  }
  const stat = (label, value) => el('div', { class: 'profile-stat' }, el('strong', {}, String(value)), el('span', { class: 'small dim' }, label));

  function toggleBlock(id, p) {
    const ids = [id, p?.acct].filter(Boolean);
    if (ids.some((x) => blocked.has(x))) ids.forEach((x) => blocked.delete(x));
    else {
      ids.forEach((x) => blocked.add(x));
      if (chat && ids.includes(chat.id)) closeDm();
    }
    save('ra-blocked', [...blocked]);
    render();
  }

  // ---- Private chat ----
  function openDm(t) {
    if (!net || blocked.has(t.id)) return;
    closeDm();
    chat = t;
    dmTitle.textContent = t.name || 'player';
    dmKind.textContent = t.kind === 'acct' ? 'saved chat' : 'guest chat (not saved)';
    dmBox.hidden = false;
    dmLog.innerHTML = '';
    dmNote.textContent = 'Be kind. Never share passwords or personal info. Block anyone who bothers you.';
    const mine = (m) => m.from === (t.kind === 'acct' ? acctId : me());
    const onMsgs = (msgs) => {
      dmLog.innerHTML = '';
      const entries = Object.entries(msgs || {}).sort(([a], [b]) => (a < b ? -1 : 1));
      if (!entries.length) dmLog.append(el('p', { class: 'small dim' }, 'Say hi!'));
      for (const [, m] of entries) {
        dmLog.append(el('div', { class: 'dm-msg' + (mine(m) ? ' mine' : '') }, mine(m) ? null : el('span', { class: 'chat-name', style: { color: m.color || '' } }, m.name + ':'), ' ', m.text));
      }
      dmLog.scrollTop = dmLog.scrollHeight;
      markRead(t);
    };
    offDm = t.kind === 'acct' ? net.acctChat.watch(t.id, onMsgs) : net.dmWatch(t.id, onMsgs);
    dmInput.focus();
    markRead(t);
  }
  function closeDm() {
    offDm?.();
    offDm = null;
    chat = null;
    dmBox.hidden = true;
  }
  function markRead(t) {
    lastRead[readKey(t)] = now();
    save('ra-dm-read', lastRead);
    if (t.kind === 'acct') net?.acctChat?.markRead(t.id);
    render();
  }
  async function sendDm() {
    const text = dmInput.value.trim();
    if (!text || !chat) return;
    const online = Object.values(players).find((p) => (chat.kind === 'acct' ? p.acct === chat.id : false)) || players[chat.id];
    if (online && online.dm === false) { dmNote.textContent = `${chat.name} turned private messages off.`; return; }
    dmInput.value = '';
    const p = profile();
    const msg = { name: p.name, color: p.color, text: text.slice(0, 300) };
    try {
      if (chat.kind === 'acct') await net.acctChat.send(chat.id, chat.name, msg);
      else await net.dmSend(chat.id, msg);
    } catch (e) {
      dmNote.textContent = /permission/i.test(e.message) ? `${chat.name} isn't accepting private messages right now.` : `Couldn't send: ${e.message}`;
    }
  }
  dmInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDm(); });

  // ---- Presence ----
  function publish() {
    if (!net?.presenceSet) return;
    net.presenceSet({ ...profile(), status: status(), dm: dmOn, acct: acctId || null }).catch(() => {});
  }

  function connect() {
    const next = getNet();
    if (next?.presenceWatch && next !== net) {
      // Switching from local to online (or back): leave the old one.
      offPresence?.(); offInbox?.(); offAcctInbox?.(); offAcctInbox = null; acctId = null; closeDm();
      net?.presenceClear?.();
      net = next;
      offPresence = net.presenceWatch((all) => { players = all || {}; render(); });
      offInbox = net.inboxWatch((box) => { inbox = box || {}; render(); });
      clearInterval(beat);
      beat = setInterval(publish, net.kind === 'local' ? 5000 : 30000);
    }
    // Signed in or out since last time: follow your saved chats.
    const nowAcct = net?.accountUid?.() || null;
    if (nowAcct !== acctId) {
      offAcctInbox?.();
      offAcctInbox = null;
      acctInbox = {};
      if (chat?.kind === 'acct') closeDm();
      acctId = nowAcct;
      dmOn = load('ra-dm-on', true) !== false; // signing in may bring your saved setting
      if (acctId && net.acctChat) offAcctInbox = net.acctChat.inbox((box) => { acctInbox = box || {}; render(); });
    }
  }

  render();
  return {
    // Call when the screen changes, you sign in or out, or online play connects.
    touch() { connect(); publish(); render(); },
    setScreen(name) { screen = name; this.touch(); },
    get blocked() { return blocked; },
  };
}
