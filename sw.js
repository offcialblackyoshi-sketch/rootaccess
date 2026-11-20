// Service worker: lets the game load offline once it has been opened.
// Strategy: network first (so players always get the newest version when
// online), falling back to the cache when offline. Only files from this site
// are cached; Firebase traffic is never touched.
const CACHE = 'root-access-v1';
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
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
