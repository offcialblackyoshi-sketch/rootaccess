// Picks the multiplayer backend.
//   online: Firebase (when firebase-config.js is filled in and we're online)
//   local:  rooms shared between tabs on this computer (always available)

import { firebaseConfig } from '../../firebase-config.js';
import { createLocalNet } from './local.js';

let localNet = null;
let onlinePromise = null;

export function getLocalNet() {
  if (!localNet) localNet = createLocalNet();
  return localNet;
}

// Adding ?local=1 to the address forces same-computer mode. The automated
// tests use this so they never write to the real online database.
const forceLocal = typeof location !== 'undefined' && new URLSearchParams(location.search).has('local');

export function onlineConfigured() {
  return !forceLocal && !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.databaseURL);
}

// Resolves to { net } or { error: 'message' }.
export function getOnlineNet() {
  if (!onlineConfigured()) return Promise.resolve({ error: 'not-configured' });
  if (!onlinePromise) {
    onlinePromise = (async () => {
      try {
        const { createFirebaseNet } = await import('./firebase.js');
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out connecting')), 10000));
        const net = await Promise.race([createFirebaseNet(firebaseConfig), timeout]);
        return { net };
      } catch (e) {
        onlinePromise = null; // allow a retry later
        return { error: e.message || String(e) };
      }
    })();
  }
  return onlinePromise;
}
