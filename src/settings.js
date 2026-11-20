// Display settings saved on this device (scanlines, text size, motion, contrast).
// They are applied as classes on <html>, so CSS does the rest.

import { load, save } from './util.js';

const KEY = 'ra-settings';
export const TEXT_SIZES = ['normal', 'large', 'xlarge'];
export const STYLES = ['green', 'cyber', 'amber'];

export function defaultSettings(prefersReducedMotion = false) {
  return { scanlines: !prefersReducedMotion, textSize: 'normal', reduceMotion: prefersReducedMotion, highContrast: false, volume: 0.7, keyClicks: false, matrixRain: !prefersReducedMotion, rainbowRain: false, style: 'green' };
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
    volume: typeof s.volume === 'number' && Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : d.volume,
    keyClicks: typeof s.keyClicks === 'boolean' ? s.keyClicks : d.keyClicks,
    matrixRain: typeof s.matrixRain === 'boolean' ? s.matrixRain : d.matrixRain,
    rainbowRain: typeof s.rainbowRain === 'boolean' ? s.rainbowRain : d.rainbowRain,
    style: STYLES.includes(s.style) ? s.style : d.style,
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
  document.documentElement.dataset.style = s.style;
}

// Wire up the settings dialog in index.html.
export function initSettingsDialog({ onChange } = {}) {
  const dialog = document.getElementById('settingsDialog');
  const form = dialog.querySelector('form');
  const fill = () => {
    const s = getSettings();
    form.scanlines.checked = s.scanlines;
    form.reduceMotion.checked = s.reduceMotion;
    form.highContrast.checked = s.highContrast;
    form.textSize.value = s.textSize;
    form.volume.value = Math.round(s.volume * 100);
    form.keyClicks.checked = s.keyClicks;
    form.matrixRain.checked = s.matrixRain;
    form.rainbowRain.checked = s.rainbowRain;
    form.elements.style.value = s.style;
  };
  form.addEventListener('change', () => {
    setSettings({
      scanlines: form.scanlines.checked,
      reduceMotion: form.reduceMotion.checked,
      highContrast: form.highContrast.checked,
      textSize: form.textSize.value,
      volume: Number(form.volume.value) / 100,
      keyClicks: form.keyClicks.checked,
      matrixRain: form.matrixRain.checked,
      rainbowRain: form.rainbowRain.checked,
      style: form.elements.style.value,
    });
    onChange?.();
  });
  form.volume.addEventListener('input', () => form.dispatchEvent(new Event('change')));
  document.getElementById('settingsBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    fill();
    dialog.showModal();
  });
  document.getElementById('settingsClose').addEventListener('click', () => dialog.close());
  applySettings();
}
