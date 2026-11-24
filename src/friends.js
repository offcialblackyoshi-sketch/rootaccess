// FRIENDS (in the online players panel): add friends by name, see which
// friends are online, and invite them to your room. Friend requests must be
// accepted. Online, friends need an account (guests change every visit).

import { el } from './util.js';
import { toast } from './owner.js';

export const INVITE_MS = 120000; // room invites expire after 2 minutes

// Tidies a typed name: trims, drops a leading @, max 16 characters.
export function cleanHandle(text) {
  return String(text || '').trim().replace(/^@+/, '').slice(0, 16);
}

// Friends with who's online: [{ id, name, online, tabId, status }], online first.
// online: [[tabId, presence]] of other players.
export function friendRows(friends, online, isBlocked = () => false) {
  return Object.entries(friends || {})
    .filter(([id]) => !isBlocked(id))
    .map(([id, f]) => {
      const hit = online.find(([tab, p]) => tab === id || p?.acct === id);
      return { id, name: hit?.[1]?.name || f?.name || 'friend', online: !!hit, tabId: hit?.[0] || null, status: hit ? hit[1].status || 'online' : 'offline' };
    })
    .sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
}

// Room invites still worth showing: from current friends, not blocked, under 2 minutes old. Newest first.
export function liveInvites(box, now, friends, isBlocked = () => false) {
  return Object.entries(box || {})
    .filter(([from, v]) => v && friends?.[from] && !isBlocked(from) && now - (v.at || 0) < INVITE_MS)
    .map(([from, v]) => ({ from, ...v }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

// roomInfo(): { code, mode } when you're in a room lobby friends could join, else null.
// onJoin(code): join that room. openProfile(tabId): show an online player's profile.
export function createFriends({ profile, online, isBlocked, roomInfo, onJoin, openProfile, onChange, flag = () => {} }) {
  let net = null;
  let key = '';
  let offs = [];
  let friends = {};
  let requests = {};
  let invites = {};
  let adding = false;
  let addNote = '';
  let confirmRemove = null;
  const invited = new Map(); // friend id -> room code you invited them to

  const api = () => net?.friends;
  const now = () => net?.now?.() ?? Date.now();
  const rows = () => friendRows(friends, online(), isBlocked);
  const reqList = () => Object.entries(requests).filter(([id]) => !isBlocked(id) && !friends[id]);
  const live = () => liveInvites(invites, now(), friends, isBlocked);

  const section = el('div', { class: 'social-friends' });
  const pop = el('div', { class: 'friend-pop panel', hidden: true, role: 'alert' });
  document.body.append(pop);

  function render() {
    renderSection();
    renderPop();
    onChange?.();
  }

  function renderSection() {
    section.innerHTML = '';
    if (!api()) return;
    const list = rows();
    const on = list.filter((f) => f.online).length;
    section.append(el('div', { class: 'groups-head' },
      el('span', { class: 'small dim' }, `Friends${list.length ? ` (${on} online)` : ''}`),
      api().available() ? el('button', { type: 'button', class: 'mini-btn', 'data-friend-add': '1', onclick: () => { adding = !adding; addNote = ''; renderSection(); } }, adding ? 'cancel' : '+ add') : null));
    if (!api().available()) {
      section.append(el('div', { class: 'small dim' }, 'Sign in to add friends and invite them to games.'));
      return;
    }
    if (adding) {
      const input = el('input', { type: 'text', maxlength: 16, placeholder: 'Their player name', 'aria-label': 'Friend\'s player name', class: 'friend-name-input' });
      section.append(el('form', { class: 'group-new', onsubmit: (e) => { e.preventDefault(); add(input.value); } },
        input, el('button', { type: 'submit', class: 'mini-btn selected' }, 'Send')));
      if (addNote) section.append(el('div', { class: 'small dim friend-note' }, addNote));
      queueMicrotask(() => { if (!addNote) input.focus(); });
    }
    for (const [id, r] of reqList()) {
      section.append(el('div', { class: 'group-invite', 'data-freq': id },
        el('span', { class: 'small' }, '🤝 ', el('span', { class: 'pname' }, r.name), ' wants to be friends'),
        el('span', { class: 'actions' },
          el('button', { type: 'button', class: 'mini-btn selected', 'data-faccept': id, onclick: () => accept(id, r.name) }, 'Accept'),
          el('button', { type: 'button', class: 'mini-btn', 'data-fdecline': id, onclick: () => api().decline(id).catch(() => {}) }, 'No thanks'))));
    }
    const room = roomInfo();
    for (const f of list) {
      const sent = room && invited.get(f.id) === room.code;
      section.append(el('div', { class: 'friend-row' + (f.online ? ' online' : ''), 'data-friend': f.id },
        el('span', { class: 'friend-dot', 'aria-hidden': 'true' }),
        el('button', { type: 'button', class: 'friend-who', disabled: !f.online, title: f.online ? 'See profile' : 'Offline', onclick: () => f.tabId && openProfile(f.tabId) },
          el('span', { class: 'pname' }, f.name), el('span', { class: 'small dim' }, ` ${f.status}`)),
        f.online && room ? el('button', { type: 'button', class: 'mini-btn' + (sent ? ' selected' : ''), 'data-finvite': f.id, disabled: sent, onclick: () => invite(f) }, sent ? '✓ invited' : 'invite') : null,
        el('button', { type: 'button', class: 'mini-btn danger friend-x', 'data-funfriend': f.id, title: 'Remove friend', onclick: () => unfriend(f) }, confirmRemove === f.id ? 'sure?' : '✕')));
    }
    if (!list.length && !reqList().length && !adding) section.append(el('div', { class: 'small dim' }, 'Add friends to see when they\'re online and invite them to games.'));
  }

  async function add(text) {
    const name = cleanHandle(text);
    if (!name) return;
    const me = profile().name;
    if (name.toLowerCase() === String(me).toLowerCase()) { addNote = 'That\'s you!'; return renderSection(); }
    try {
      const found = await api().lookup(name);
      if (!found) addNote = `No player called "${name}".${net.kind === 'online' ? ' Friends need an account, so check their account name.' : ' They need to be online.'}`;
      else if (friends[found.id]) addNote = `${found.name} is already your friend.`;
      else if (isBlocked(found.id)) addNote = `You blocked ${found.name}. Unblock them first.`;
      else if (requests[found.id]) { await accept(found.id, found.name); return; }
      else {
        await api().request(found.id, me);
        addNote = `Friend request sent to ${found.name}.`;
      }
    } catch (e) {
      addNote = /banned/i.test(e.message) ? 'You can\'t add friends while you\'re banned.' : `Couldn't send that: ${e.message}`;
    }
    renderSection();
  }

  async function accept(id, name) {
    try {
      await api().accept(id, name, profile().name);
      toast(`You and ${name} are now friends.`);
    } catch (e) {
      toast(`Couldn't accept: ${e.message}`, 'err');
    }
  }

  async function unfriend(f) {
    if (confirmRemove !== f.id) { confirmRemove = f.id; renderSection(); return; }
    confirmRemove = null;
    await api().remove(f.id).catch((e) => toast(`Couldn't remove: ${e.message}`, 'err'));
  }

  async function invite(f) {
    const room = roomInfo();
    if (!room) return;
    try {
      await api().invite(f.id, { name: profile().name, code: room.code, mode: room.mode || '' });
      invited.set(f.id, room.code);
      flag('friendInvite');
      toast(`Invited ${f.name} to your room.`);
    } catch (e) {
      toast(/banned/i.test(e.message) ? 'You can\'t invite while you\'re banned.' : `Couldn't invite: ${e.message}`, 'err');
    }
    renderSection();
  }

  // The newest room invite pops up with Join.
  function renderPop() {
    const inv = live()[0];
    const room = roomInfo();
    if (!inv || (room && room.code === inv.code)) { pop.hidden = true; return; }
    pop.hidden = false;
    pop.innerHTML = '';
    pop.append(
      el('div', {}, '🎮 ', el('span', { class: 'pname' }, inv.name), ` invited you to play${inv.mode ? ` ${inv.mode}` : ''}!`),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'primary mini-btn', 'data-fjoin': inv.from, onclick: async () => {
          api().clearInvite(inv.from);
          try { await onJoin(inv.code); } catch (e) { toast(`Couldn't join: ${e.message}`, 'err'); }
        } }, `Join ${inv.code}`),
        el('button', { type: 'button', class: 'mini-btn', 'data-fdismiss': inv.from, onclick: () => api().clearInvite(inv.from) }, 'Not now')));
  }
  setInterval(() => { if (!pop.hidden) renderPop(); }, 10000);

  return {
    section,
    attach(next) {
      const k = next?.friends ? `${next.kind}:${next.friends.me()}` : '';
      if (k === key) return;
      key = k;
      offs.forEach((off) => off());
      offs = [];
      friends = {}; requests = {}; invites = {};
      net = next;
      const f = api();
      if (f?.available()) {
        offs = [
          f.list((v) => { friends = v || {}; if (Object.keys(friends).length) flag('friendMade'); render(); }),
          f.requests((v) => { requests = v || {}; render(); }),
          f.invites((v) => { invites = v || {}; render(); }),
        ];
      }
      render();
    },
    // Requests and room invites waiting for you (for the panel badge).
    unread: () => (api()?.available() ? reqList().length + live().length : 0),
    refresh: () => { renderSection(); renderPop(); },
  };
}
