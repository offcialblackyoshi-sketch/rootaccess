// Owner tools: the announcement banner everyone sees, the owner's tools
// window (announcements + bans), and small helpers for bans and pop-up notices.
// Who is the owner is decided by the database (roles/<account id> = "owner"),
// so these tools only work for that account; the rules refuse everyone else.

import { el, load, save } from './util.js';

// ---- Bans ----
export const BAN_LENGTHS = { '1h': 60 * 60 * 1000, '1d': 24 * 60 * 60 * 1000, forever: null };
export const FOREVER = 9e15; // "until" for permanent bans

export function banUntil(length, now = Date.now()) {
  return BAN_LENGTHS[length] === null ? FOREVER : now + (BAN_LENGTHS[length] || BAN_LENGTHS['1h']);
}

// The active ban (if any) on any of these ids.
export function activeBan(bans, ids, now = Date.now()) {
  for (const id of ids.filter(Boolean)) {
    const b = bans?.[id];
    if (b && (b.until || 0) > now) return { id, ...b };
  }
  return null;
}

export function describeBan(ban, now = Date.now()) {
  if (!ban) return '';
  if (ban.until >= FOREVER) return 'permanently';
  const mins = Math.ceil((ban.until - now) / 60000);
  if (mins < 60) return `for ${mins} more minute${mins === 1 ? '' : 's'}`;
  const hours = Math.ceil(mins / 60);
  return `for ${hours} more hour${hours === 1 ? '' : 's'}`;
}

// ---- Pop-up notices ----
let toastBox = null;
export function toast(text, kind = 'info', ms = 3500) {
  if (!toastBox) {
    toastBox = el('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const t = el('div', { class: `toast ${kind}` }, text);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 500);
  return t;
}

// ---- Banner + owner window ----
// ownerName(): the name shown on announcements ("brisky2swifty: ...").
// Why a player was reported (the keys are checked by the database rules).
export const REPORT_REASONS = {
  mean: 'Mean or bullying',
  words: 'Bad words',
  personal: 'Asking for personal info',
  cheating: 'Cheating',
  name: 'Rude name',
  other: 'Something else',
};

// "3 min ago" style ages for the reports list.
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - (at || 0)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function createOwnerTools({ isOwner, sfx, ownerName = () => '' }) {
  let net = null;
  let offReports = null;
  let reports = {};
  let reportsSeen = -1;
  let offAnnounce = null;
  let offBans = null;
  let announcement = null;
  let bans = {};
  const listeners = new Set();

  // Announcement banner (top of every screen). ✕ hides it until the next one.
  const bannerMsg = el('span', { class: 'banner-text' });
  let bannerBy = el('span', { class: 'pname banner-by' });
  const bannerText = el('span');
  bannerMsg.append(bannerBy, bannerText);
  const banner = el('div', { class: 'announce', role: 'status', hidden: true },
    el('span', { class: 'banner-icon', 'aria-hidden': 'true' }, '📢'), bannerMsg,
    el('button', { type: 'button', class: 'icon-x', 'aria-label': 'Hide announcement', onclick: () => { save('ra-announce-seen', announcement?.at || 0); renderBanner(); } }, '✕'));
  document.body.append(banner);

  function renderBanner() {
    const show = !!announcement?.text && load('ra-announce-seen', 0) !== announcement.at;
    banner.hidden = !show;
    // Who posted it. The name gets the owner's crown and gold glow from badges.js.
    const by = String(announcement?.by || '').slice(0, 16);
    if (bannerBy.dataset.name !== by) {
      // A fresh element, so badges.js sees a new name and adds the crown.
      const fresh = el('span', { class: 'pname banner-by', 'data-name': by }, by);
      bannerBy.replaceWith(fresh);
      bannerBy = fresh;
    }
    bannerBy.hidden = !by;
    bannerText.textContent = (by ? ': ' : '') + (announcement?.text || '');
  }

  // Owner window.
  const annInput = el('textarea', { maxlength: 200, rows: 3, placeholder: 'Message for everyone, e.g. "New mode out!"', 'aria-label': 'Announcement' });
  const annMsg = el('p', { class: 'small dim' });
  const banList = el('ul', { class: 'ban-list' });
  const reportList = el('ul', { class: 'report-list' });
  const reportCount = el('span', { class: 'small dim' });
  const dialog = el('dialog', { class: 'owner-dialog', 'aria-label': 'Owner tools' },
    el('div', { class: 'acct-head' }, el('h2', {}, '// 👑 OWNER TOOLS'), el('button', { type: 'button', class: 'icon-x', 'aria-label': 'Close', onclick: () => dialog.close() }, '✕')),
    el('h3', {}, 'Announcement'),
    el('p', { class: 'small dim' }, 'Shows as a banner at the top of everyone\'s screen.'),
    annInput,
    el('div', { class: 'actions' },
      el('button', { type: 'button', class: 'primary', id: 'announcePost', onclick: () => post(annInput.value.trim()) }, '📢 Post'),
      el('button', { type: 'button', id: 'announceClear', onclick: () => post(null) }, 'Clear banner')),
    annMsg,
    el('h3', {}, 'Bans'),
    el('p', { class: 'small dim' }, 'Banned players can\'t use lobby chat, private messages, or join and list public rooms. Ban someone from their profile in the 👥 online players list.'),
    banList,
    el('h3', {}, 'Reports ', reportCount),
    el('p', { class: 'small dim' }, 'Players can report someone from their profile. Only you see reports.'),
    reportList,
    el('p', { class: 'small dim' }, 'Tip: as owner you can delete lobby chat messages (🗑), close public rooms, and kick anyone from a room you\'re in.'));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);

  async function post(text) {
    if (!isOwner()) return;
    try {
      await net.mod.announce(text, ownerName());
      annMsg.className = 'small ok';
      annMsg.textContent = text ? 'Posted! Everyone online sees it now.' : 'Banner cleared.';
      if (text) annInput.value = '';
      sfx?.ok();
    } catch (e) {
      annMsg.className = 'small err';
      annMsg.textContent = `Couldn't post: ${e.message}`;
    }
  }

  function renderBans() {
    banList.innerHTML = '';
    const now = Date.now();
    const rows = Object.entries(bans).filter(([, b]) => (b.until || 0) > now);
    if (!rows.length) banList.append(el('li', { class: 'dim small' }, 'Nobody is banned.'));
    for (const [id, b] of rows) {
      banList.append(el('li', {},
        el('span', { class: 'pname' }, b.name || id.slice(0, 8)),
        el('span', { class: 'small dim' }, ` ${describeBan(b, now)}`),
        el('button', { type: 'button', class: 'mini-btn', onclick: () => tools.unban([id]) }, 'Unban')));
    }
  }

  // Reports, newest first, with ban and dismiss buttons.
  function renderReports() {
    const rows = Object.entries(reports).sort(([, a], [, b]) => (b.at || 0) - (a.at || 0));
    reportCount.textContent = rows.length ? `(${rows.length})` : '';
    const btn = document.getElementById('ownerBtn');
    if (btn) {
      let badge = btn.querySelector('.owner-count');
      if (!badge) { badge = el('span', { class: 'owner-count' }); btn.append(badge); }
      badge.hidden = !rows.length;
      badge.textContent = String(rows.length);
    }
    // A new report while you're online: let the owner know.
    if (reportsSeen >= 0 && rows.length > reportsSeen) { toast(`🚩 New report about ${rows[0][1].targetName || 'a player'}.`); sfx?.chat?.(); }
    reportsSeen = rows.length;
    reportList.innerHTML = '';
    if (!rows.length) reportList.append(el('li', { class: 'dim small' }, 'No reports. 🎉'));
    for (const [id, r] of rows) {
      const ids = [r.target, r.targetAcct].filter(Boolean);
      const banned = activeBan(bans, ids);
      reportList.append(el('li', { class: 'report', 'data-report': id },
        el('div', {}, '🚩 ', el('span', { class: 'pname' }, r.targetName || '?'), el('span', { class: 'small' }, ` · ${REPORT_REASONS[r.reason] || r.reason}`)),
        el('div', { class: 'small dim' }, `reported by ${r.byName || '?'} · ${ago(r.at)}${banned ? ` · banned ${describeBan(banned)}` : ''}`),
        r.note ? el('div', { class: 'small report-note' }, `"${r.note}"`) : null,
        r.context ? el('pre', { class: 'small report-context' }, r.context) : null,
        el('div', { class: 'actions' },
          banned ? null : el('button', { type: 'button', class: 'mini-btn danger', 'data-report-ban': id, onclick: () => tools.ban(ids, '1d', r.targetName || 'player').catch((e) => toast(e.message, 'err')) }, 'Ban 1 day'),
          el('button', { type: 'button', class: 'mini-btn', 'data-report-dismiss': id, onclick: () => net.reports.remove(id).catch((e) => toast(e.message, 'err')) }, banned ? 'Done' : 'Dismiss'))));
    }
  }

  // Only the owner watches reports (the rules refuse everyone else).
  function syncReports() {
    const want = isOwner() && !!net?.reports;
    if (want && !offReports) offReports = net.reports.watch((r) => { reports = r || {}; renderReports(); });
    if (!want && offReports) { offReports(); offReports = null; reports = {}; reportsSeen = -1; renderReports(); }
  }

  const tools = {
    // Watch the current connection (local or online).
    attach(n) {
      if (n?.mod && n !== net) {
        offAnnounce?.();
        offBans?.();
        offReports?.();
        offReports = null;
        reportsSeen = -1;
        net = n;
        offAnnounce = n.mod.announceWatch((a) => { announcement = a; renderBanner(); });
        offBans = n.mod.bansWatch((b) => { bans = b || {}; renderBans(); if (offReports) renderReports(); for (const cb of listeners) cb(bans); });
      }
      syncReports();
    },
    onBans(cb) { listeners.add(cb); },
    bans: () => bans,
    banOf: (ids) => activeBan(bans, ids),
    open() {
      if (!isOwner()) return;
      annMsg.textContent = '';
      renderBans();
      syncReports();
      renderReports();
      dialog.showModal();
    },
    async ban(ids, length, name) {
      await net.mod.ban(ids.filter(Boolean), banUntil(length), name);
      toast(`🚫 ${name} is banned ${length === 'forever' ? 'permanently' : length === '1h' ? 'for 1 hour' : 'for 1 day'}.`, 'ok');
    },
    async unban(ids) {
      await net.mod.unban(ids.filter(Boolean));
      toast('Ban lifted.', 'ok');
    },
    deleteLobbyMsg: (key) => net.mod.deleteLobbyMsg(key),
    closeRoom: (code) => net.mod.closeRoom(code),
  };
  return tools;
}
