// Small line icons (24x24, drawn with the current text color).
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // Modes
  race: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  duel: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  defend: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  koth: svg('<path d="m2 20 7-11 4 6 2-3 7 8z"/><path d="M9 9V3l5 2-5 2"/>'),
  heist: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 8v1M12 15v1M8 12h1M15 12h1"/>'),
  letterlock: svg('<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/><path d="M2 12h20"/>'),
  printmatch: svg('<path d="M7 20c-1.5-2-2-4.5-2-8a7 7 0 0 1 14 0"/><path d="M9 20c-.8-2-1-4-1-8a4 4 0 0 1 8 0c0 3 .3 5 1 8"/><path d="M12 12c0 3 .5 5.5 1.5 8"/>'),
  signaltune: svg('<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/><path d="M2 20h20"/>'),
  circuit: svg('<path d="M4 4h6v6h6v6h4"/><circle cx="4" cy="4" r="1.5"/><circle cx="20" cy="16" r="1.5"/><path d="M4 14v6h8"/>'),
  memory: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M6.5 6.5h.01M17.5 17.5h.01"/>'),
  gauntlet: svg('<path d="M4 20 20 4"/><path d="M14 4h6v6"/><path d="M4 14v6h6"/><circle cx="12" cy="12" r="2"/>'),
  wirecut: svg('<path d="M3 6c5 0 5 4 9 4s4-4 9-4"/><path d="M3 18c5 0 5-4 9-4s4 4 9 4"/><path d="m10 2 4 4M14 2l-4 4"/>'),
  portsweep: svg('<rect x="3" y="3" width="5" height="5"/><rect x="10" y="3" width="5" height="5"/><rect x="17" y="3" width="4" height="5"/><rect x="3" y="10" width="5" height="5"/><rect x="10" y="10" width="5" height="5" fill="currentColor"/><rect x="17" y="10" width="4" height="5"/><rect x="3" y="17" width="5" height="4"/><rect x="10" y="17" width="5" height="4"/><rect x="17" y="17" width="4" height="4"/>'),
  bitflip: svg('<rect x="3" y="8" width="7" height="12" rx="2"/><rect x="14" y="8" width="7" height="12" rx="2"/><circle cx="6.5" cy="12" r="1.5"/><circle cx="17.5" cy="16" r="1.5"/><path d="M6 4h1M17 4h1"/>'),
  // Menu
  play: svg('<path d="M7 4v16l13-8z"/>'),
  join: svg('<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M8 7h8M8 11h6"/>'),
  bot: svg('<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 13h.01M15 13h.01M9 17h6"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>'),
  trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 6h3a3 3 0 0 1-3 4M7 6H4a3 3 0 0 0 3 4"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  crown: svg('<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/><path d="M5 21h14"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17h.01"/>'),
};

export function iconEl(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = ICONS[name] || '';
  return span;
}
