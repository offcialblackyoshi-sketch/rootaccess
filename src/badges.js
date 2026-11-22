// Special-title badges ("👑 owner", "🧪 alpha tester") shown right after a
// player's name everywhere it appears: lobby, chat, in game, the terminal,
// results and leaderboards. Reserved names can only be used by the signed-in
// account that owns them (see myName in main.js), so the name is enough.

import { specialTitle, specialKind } from './progress.js';

// Elements that hold a player's name.
const SELECTOR = '.pname, .chat-name, .acct-name, .podium-name';

// "alice (you)", "bob:", "carol [A]" → the bare name.
export function bareName(text) {
  return String(text || '').trim().replace(/:$/, '').replace(/\s*\((you|bot)\)$/i, '').replace(/\s*\[[AB-]\]$/, '').trim();
}

export function badgeFor(name) {
  const title = specialTitle(bareName(name));
  if (!title) return null;
  const b = document.createElement('span');
  b.className = `name-badge badge-${specialKind(bareName(name))}`;
  b.textContent = title;
  return b;
}

function decorate(node) {
  if (node.dataset.badged || node.querySelector('.name-badge')) return;
  const badge = badgeFor(node.textContent);
  node.dataset.badged = '1';
  if (badge) node.append(' ', badge);
}

export function startBadges(root = document.body) {
  const scan = (el) => {
    if (el.nodeType !== 1) return;
    if (el.matches?.(SELECTOR)) decorate(el);
    el.querySelectorAll?.(SELECTOR).forEach(decorate);
  };
  scan(root);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') {
        const host = m.target.parentElement?.closest(SELECTOR);
        if (host) { delete host.dataset.badged; host.querySelector('.name-badge')?.remove(); decorate(host); }
      }
      m.addedNodes.forEach(scan);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
