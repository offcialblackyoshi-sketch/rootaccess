// GROUP CHATS (in the online players panel): make a group, invite people who
// are online, and chat together. Invites must be accepted, so nobody is put
// into a group without saying yes. Signed-in players keep their groups;
// guest groups last while the tab is open.

import { el, load, save } from './util.js';
import { toast } from './owner.js';
import { cleanText, hasBadWords } from './filter.js';
import { chatBody } from './chat.js';
import { parseCommand, messageView } from './emotes.js';

export const GROUP_MAX = 12;
export const GROUP_NAME_MAX = 24;

// Tidies a typed group name: trims, squashes spaces, max length. '' if empty.
export function cleanGroupName(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, GROUP_NAME_MAX);
}

// Splits a ginbox into pending invites and groups you're in (newest first),
// and counts what's unread. readAt: { [gid]: time you last looked }.
export function sortGroupInbox(box, me, readAt = {}, isBlocked = () => false) {
  const invites = [];
  const groups = [];
  for (const [gid, g] of Object.entries(box || {})) {
    if (!g) continue;
    if (g.invite) {
      if (!isBlocked(g.from)) invites.push({ gid, ...g });
      continue;
    }
    const unread = !!g.text && g.from !== me && !isBlocked(g.from) && (g.at || 0) > (readAt[gid] || 0);
    groups.push({ gid, ...g, unread });
  }
  groups.sort((a, b) => (b.at || 0) - (a.at || 0));
  invites.sort((a, b) => (b.at || 0) - (a.at || 0));
  return { invites, groups, unread: invites.length + groups.filter((g) => g.unread).length };
}

// Who you could invite: online, not already in (or invited to) the group,
// accepting private messages, and not blocked.
export function invitable(online, group, isBlocked = () => false) {
  const members = group?.members || {};
  return online
    .map(([id, p]) => ({ id: p.acct || id, name: p.name, color: p.color, dm: p.dm }))
    .filter((p) => !members[p.id] && p.dm !== false && !isBlocked(p.id))
    .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
}

// online(): [[tabId, presence]] of other players; isBlocked(id); flag(name): trophy flags.
export function createGroups({ profile, online, isBlocked, onChange, onOpen, flag = () => {} }) {
  let net = null;
  let key = '';
  let offInbox = null;
  let box = {};
  let current = null; // { gid, group, msgs, offG, offM }
  let creating = false;
  let showMembers = false;
  let invited = new Set();
  // When you last looked at each group, per player id (tabs and accounts can share a computer).
  const allRead = load('ra-group-read', {});
  const readAt = () => (allRead[me()] ||= {});
  const saveRead = () => save('ra-group-read', { ...load('ra-group-read', {}), [me()]: readAt() });

  const api = () => net?.groups;
  const me = () => api()?.me();
  const state = () => sortGroupInbox(box, me(), readAt(), isBlocked);

  // ---- Panel section ----
  const section = el('div', { class: 'social-groups' });

  function renderSection() {
    section.innerHTML = '';
    if (!api()) return;
    const { invites, groups } = state();
    const head = el('div', { class: 'groups-head' },
      el('span', { class: 'small dim' }, 'Groups'),
      el('button', { type: 'button', class: 'mini-btn', 'data-group-new': '1', onclick: () => { creating = !creating; renderSection(); } }, creating ? 'cancel' : '+ new'));
    section.append(head);
    if (creating) {
      const input = el('input', { type: 'text', maxlength: GROUP_NAME_MAX, placeholder: 'Group name', 'aria-label': 'Group name', class: 'group-name-input' });
      section.append(el('form', { class: 'group-new', onsubmit: (e) => { e.preventDefault(); create(input.value); } },
        input, el('button', { type: 'submit', class: 'mini-btn selected' }, 'Create')));
      queueMicrotask(() => input.focus());
    }
    for (const inv of invites) {
      section.append(el('div', { class: 'group-invite', 'data-invite': inv.gid },
        el('span', { class: 'small' }, '📨 ', el('span', { class: 'pname' }, inv.by || 'Someone'), ' invited you to ', el('strong', {}, cleanText(inv.name))),
        el('span', { class: 'actions' },
          el('button', { type: 'button', class: 'mini-btn selected', 'data-accept': inv.gid, onclick: () => accept(inv) }, 'Join'),
          el('button', { type: 'button', class: 'mini-btn', 'data-decline': inv.gid, onclick: () => api().dismiss(inv.gid).catch(() => {}) }, 'No thanks'))));
    }
    for (const g of groups.slice(0, 10)) {
      section.append(el('button', { type: 'button', class: 'social-msg group-row' + (g.unread ? ' unread' : ''), 'data-group': g.gid, onclick: () => openGroup(g.gid, g.name) },
        el('span', { class: 'pname' }, '👥 ', cleanText(g.name)),
        el('span', { class: 'small dim' }, g.text ? ` ${g.from === me() ? 'you' : cleanText(g.by)}: ${cleanText(g.text).slice(0, 30)}` : ' new group')));
    }
    if (!groups.length && !invites.length && !creating) section.append(el('div', { class: 'small dim' }, net?.accountUid?.() || document.documentElement.classList.contains('on-crazygames') ? 'Make a group to chat with a few friends at once.' : 'Make a group to chat with a few friends at once. Guest groups end when you close this tab.'));
  }

  async function create(text) {
    const name = cleanGroupName(text);
    if (!name) return;
    if (hasBadWords(name)) { toast('Please pick a kinder group name.', 'err'); return; }
    try {
      const gid = await api().create(name, profile().name);
      creating = false;
      flag('groupMade');
      openGroup(gid, name);
      showMembers = true;
      renderWindow();
    } catch (e) {
      toast(/banned/i.test(e.message) ? 'You can\'t make groups while you\'re banned.' : `Couldn't make the group: ${e.message}`, 'err');
    }
  }

  async function accept(inv) {
    try {
      await api().accept(inv.gid, inv, profile().name);
      flag('groupJoined');
      openGroup(inv.gid, inv.name);
    } catch {
      toast('That group is gone or full.', 'err');
      api().dismiss(inv.gid).catch(() => {});
    }
  }

  // ---- Chat window ----
  const title = el('span', { class: 'pname' });
  const sub = el('span', { class: 'small dim' });
  const membersBtn = el('button', { type: 'button', class: 'mini-btn', 'data-members': '1', onclick: () => { showMembers = !showMembers; renderWindow(); } }, 'members');
  const membersEl = el('div', { class: 'group-members' });
  const log = el('div', { class: 'dm-log', role: 'log' });
  const input = el('input', { type: 'text', maxlength: 300, placeholder: 'Message the group…', 'aria-label': 'Group message', autocomplete: 'off' });
  const note = el('p', { class: 'small dim dm-note' });
  const win = el('div', { class: 'dm-box group-box panel', hidden: true },
    el('div', { class: 'acct-head' },
      el('div', {}, el('strong', {}, '👥 ', title), el('div', {}, sub)),
      el('span', { class: 'actions' }, membersBtn, el('button', { type: 'button', class: 'icon-x', 'aria-label': 'Close group chat', onclick: () => close() }, '✕'))),
    membersEl, log, note,
    el('form', { class: 'chat-form', onsubmit: (e) => { e.preventDefault(); send(); } }, input));
  document.body.append(win);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  function openGroup(gid, name) {
    if (!api()) return;
    close();
    onOpen?.();
    invited = new Set();
    current = { gid, group: { name, members: {} }, msgs: {} };
    note.textContent = 'Be kind. Never share passwords or personal info.';
    win.hidden = false;
    current.offG = api().watch(gid, (g) => {
      if (!current || current.gid !== gid) return;
      if (!g) {
        toast(`You're no longer in "${current.group.name}".`);
        api().dismiss(gid).catch(() => {});
        close();
        return;
      }
      current.group = g;
      renderWindow();
    });
    current.offM = api().msgs(gid, (m) => {
      if (!current || current.gid !== gid) return;
      current.msgs = m || {};
      renderLog();
      markRead(gid);
    });
    renderWindow();
    markRead(gid);
    input.focus();
  }

  function close() {
    current?.offG?.();
    current?.offM?.();
    current = null;
    showMembers = false;
    win.hidden = true;
  }

  function renderWindow() {
    if (!current) return;
    const g = current.group;
    const ids = Object.keys(g.members || {});
    title.textContent = cleanText(g.name || 'group');
    sub.textContent = `${ids.length} member${ids.length === 1 ? '' : 's'}`;
    membersBtn.classList.toggle('selected', showMembers);
    membersEl.hidden = !showMembers;
    membersEl.innerHTML = '';
    if (!showMembers) return;
    const iOwn = g.owner === me();
    const list = el('ul', { class: 'group-member-list' });
    for (const id of ids) {
      const m = g.members[id];
      list.append(el('li', {},
        el('span', { class: 'pname' }, m.name), id === g.owner ? el('span', { class: 'small dim' }, ' (made it)') : null, id === me() ? el('span', { class: 'small dim' }, ' (you)') : null,
        iOwn && id !== me() ? el('button', { type: 'button', class: 'mini-btn danger', 'data-kick': id, onclick: () => api().kick(current.gid, id).catch((e) => toast(e.message, 'err')) }, 'remove') : null));
    }
    membersEl.append(list);
    const who = invitable(online(), g, isBlocked);
    if (ids.length < GROUP_MAX) {
      membersEl.append(el('div', { class: 'small dim' }, who.length ? 'Invite someone online:' : 'No one else online to invite right now.'));
      const row = el('div', { class: 'group-invites' });
      for (const p of who.slice(0, 12)) {
        const done = invited.has(p.id);
        row.append(el('button', { type: 'button', class: 'mini-btn' + (done ? ' selected' : ''), 'data-invite-id': p.id, disabled: done, onclick: () => invite(p) }, done ? `✓ ${p.name}` : `+ ${p.name}`));
      }
      membersEl.append(row);
    } else membersEl.append(el('div', { class: 'small dim' }, `This group is full (${GROUP_MAX}).`));
    let sure = false;
    const leaveBtn = el('button', { type: 'button', class: 'mini-btn danger', 'data-leave': '1' }, iOwn ? 'Delete group' : 'Leave group');
    leaveBtn.onclick = async () => {
      if (!sure) { sure = true; leaveBtn.textContent = iOwn ? 'Really delete?' : 'Really leave?'; return; }
      const { gid, group } = current;
      close();
      try {
        if (iOwn) await api().remove(gid, group);
        else await api().leave(gid);
      } catch (e) {
        toast(`Couldn't do that: ${e.message}`, 'err');
      }
    };
    membersEl.append(el('div', { class: 'actions' }, leaveBtn));
  }

  async function invite(p) {
    if (!current) return;
    try {
      await api().invite(current.gid, current.group.name, p.id, profile().name);
      invited.add(p.id);
      note.textContent = `Invited ${p.name}. They'll join if they say yes.`;
    } catch (e) {
      note.textContent = /banned/i.test(e.message) ? 'You can\'t invite people while you\'re banned.' : `Couldn't invite ${p.name}.`;
    }
    renderWindow();
  }

  function renderLog() {
    if (!current) return;
    log.innerHTML = '';
    const entries = Object.entries(current.msgs).sort(([a], [b]) => (a < b ? -1 : 1));
    if (!entries.length) log.append(el('p', { class: 'small dim' }, 'Say hi to the group!'));
    for (const [, m] of entries) {
      if (isBlocked(m.from)) continue;
      const mine = m.from === me();
      const action = messageView(m.text).action;
      log.append(el('div', { class: 'dm-msg' + (mine && !action ? ' mine' : '') }, ...(mine && !action ? [messageView(cleanText(m.text)).text] : chatBody(m))));
    }
    log.scrollTop = log.scrollHeight;
  }

  async function send() {
    const typed = parseCommand(input.value.trim());
    if (typed.local) { note.textContent = typed.local; input.value = ''; return; }
    const text = typed.text;
    if (!text || !current) return;
    input.value = '';
    const p = profile();
    try {
      await api().send(current.gid, current.group, { name: p.name, color: p.color, text: text.slice(0, 300) });
      flag('groupChat');
      flag('chatSent');
    } catch (e) {
      note.textContent = /banned/i.test(e.message) ? 'You can\'t chat while you\'re banned.' : `Couldn't send: ${e.message}`;
    }
  }

  function markRead(gid) {
    // Read up to the newest message you've seen (server times, so later ones still count as new).
    const seen = Math.max(0, ...Object.values(current?.gid === gid ? current.msgs : {}).map((m) => m?.at || 0), box[gid]?.at || 0);
    if (seen <= (readAt()[gid] || 0)) return renderAll();
    readAt()[gid] = seen;
    saveRead();
    renderAll();
  }

  // (The panel plays the chat sound when the total unread count goes up.)
  function renderAll() {
    // The open group counts as read.
    if (current && box[current.gid] && (box[current.gid].at || 0) > (readAt()[current.gid] || 0)) {
      readAt()[current.gid] = box[current.gid].at;
      saveRead();
    }
    renderSection();
    onChange?.();
  }

  return {
    section,
    // Follow the current connection and identity (signing in switches to your account's groups).
    attach(next) {
      const k = next?.groups ? `${next.kind}:${next.groups.me()}` : '';
      if (k === key) return;
      key = k;
      offInbox?.();
      offInbox = null;
      close();
      box = {};
      net = next;
      if (net?.groups) offInbox = net.groups.inbox((b) => { box = b || {}; renderAll(); });
      renderAll();
    },
    unread: () => state().unread,
    refresh() { if (current && showMembers) renderWindow(); },
    close,
    isOpen: () => !!current,
  };
}
