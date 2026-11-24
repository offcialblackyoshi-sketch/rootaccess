// Service worker: lets the game load offline once it has been opened.
// Strategy: network first (so players always get the newest version when
// online), falling back to the cache when offline. Only files from this site
// are cached; Firebase traffic is never touched.
const CACHE = 'root-access-v18';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './firebase-config.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './src/main.js',
  './src/util.js',
  './src/sfx.js',
  './src/bots.js',
  './src/progress.js',
  './src/daily.js',
  './src/stats.js',
  './src/account.js',
  './src/trophies.js',
  './src/badges.js',
  './src/owner.js',
  './src/social.js',
  './src/fx/confetti.js',
  './src/fx/scramble.js',
  './src/avatar.js',
  './src/teams.js',
  './src/settings.js',
  './src/matrix.js',
  './src/icons.js',
  './src/rng.js',
  './src/terminal.js',
  './src/commands.js',
  './src/chat.js',
  './src/lobby.js',
  './src/game.js',
  './src/net/index.js',
  './src/net/local.js',
  './src/net/shared.js',
  './src/net/firebase.js',
  './src/modes/index.js',
  './src/modes/race.js',
  './src/modes/duel.js',
  './src/modes/defend.js',
  './src/modes/heist.js',
  './src/modes/quickhack.js',
  './src/modes/minigames/letterlock.js',
  './src/modes/minigames/printmatch.js',
  './src/modes/minigames/signaltune.js',
  './src/modes/minigames/circuit.js',
  './src/modes/minigames/memory.js',
  './src/modes/minigames/wirecut.js',
  './src/modes/minigames/portsweep.js',
  './src/modes/minigames/bitflip.js',
  './src/modes/tutorial.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Google Fonts never change once published, so serve them from the cache
// first (this is what keeps the styles' fonts working offline).
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Always check with the server for the newest version (cache: 'no-cache'),
  // so an update never mixes old and new files. Offline, use the saved copy.
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
