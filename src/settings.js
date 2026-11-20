// Display settings saved on this device (scanlines, text size, motion, contrast).
// They are applied as classes on <html>, so CSS does the rest.

import { load, save } from './util.js';

const KEY = 'ra-settings';
export const TEXT_SIZES = ['normal', 'large', 'xlarge'];

export function defaultSettings(prefersReducedMotion = false) {
  return { scanlines: !prefersReducedMotion, textSize: 'normal', reduceMotion: prefersReducedMotion, highContrast: false };
}

// Fills in anything missing or invalid, so old or broken saves can't break the page.
export function normalizeSettings(raw, prefersReducedMotion = false) {
  const d = defaultSettings(prefersReducedMotion);
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    scanlines: typeof s.scanlines === 'boolean' ? s.scanlines : d.scanlines,
    textSize: TEXT_SIZES.includes(s.textSize) ? s.textSize : d.textSize,
    reduceMotion: typeof s.reduceMotion === 'boolean' ? s.reduceMotion : d.reduceMotion,
    highContrast: typeof s.highContrast === 'boolean' ? s.highContrast : d.highContrast,
  };
}

function systemReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

let current = null;

export function getSettings() {
  if (!current) current = normalizeSettings(load(KEY, null), systemReducedMotion());
  return current;
}

export function setSettings(changes) {
  current = normalizeSettings({ ...getSettings(), ...changes }, systemReducedMotion());
  save(KEY, current);
  applySettings();
  return current;
}

export function applySettings() {
  const s = getSettings();
  const root = document.documentElement.classList;
  root.toggle('no-scanlines', !s.scanlines);
  root.toggle('reduce-motion', s.reduceMotion);
  root.toggle('high-contrast', s.highContrast);
  for (const size of TEXT_SIZES) root.toggle('text-' + size, s.textSize === size);
}

// Wire up the settings dialog in index.html.
export function initSettingsDialog() {
  const dialog = document.getElementById('settingsDialog');
  const form = dialog.querySelector('form');
  const fill = () => {
    const s = getSettings();
    form.scanlines.checked = s.scanlines;
    form.reduceMotion.checked = s.reduceMotion;
    form.highContrast.checked = s.highContrast;
    form.textSize.value = s.textSize;
  };
  form.addEventListener('change', () => {
    setSettings({
      scanlines: form.scanlines.checked,
      reduceMotion: form.reduceMotion.checked,
      highContrast: form.highContrast.checked,
      textSize: form.textSize.value,
    });
  });
  document.getElementById('settingsBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    fill();
    dialog.showModal();
  });
  document.getElementById('settingsClose').addEventListener('click', () => dialog.close());
  applySettings();
}
