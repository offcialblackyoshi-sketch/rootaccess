// TERMINAL RACE: everyone breaks into the same (seeded) fake server.
// 5 layers: password → decrypt → PIN → backdoor → root. First to root wins.

import { Shell } from '../commands.js';
import { makeRng, WORDS, FIRST, LAST, HOSTS, caesar, b64encode, b64decode, reverse, atbash, hexEncode, hexDecode } from '../rng.js';
import { el, bar, fmtTime } from '../util.js';
import { botParams, between } from '../bots.js';

const LAYERS = ['RECON', 'DECRYPT', 'CRACK', 'PIVOT', 'ROOT'];
const TIME_LIMIT = 12 * 60 * 1000;

// ---------------------------------------------------------------------------
// Puzzle builder (pure, so it can be tested and is identical for everyone)
// ---------------------------------------------------------------------------
export function buildRace(seed) {
  const r = makeRng('race:' + seed);
  const host = r.pick(['nexus', 'obsidian', 'monolith', 'helios', 'citadel', 'vanguard']);
  const target = 'svc_' + r.pick(['backup', 'deploy', 'vault', 'sync', 'ledger', 'relay']);
  const lasts = r.shuffle(LAST);
  const staff = r.shuffle(FIRST).slice(0, 4).map((f, i) => `${f[0]}.${lasts[i]}`);
  const words = r.shuffle(WORDS);
  const pass = words[0] + r.int(10, 99);
  const oldPass = words[1] + r.int(10, 99);

  // ---- Layer 1: auth logs ----
  const ip = () => `10.0.${r.int(0, 9)}.${r.int(2, 250)}`;
  const time = (h) => `${String(h).padStart(2, '0')}:${String(r.int(0, 59)).padStart(2, '0')}:${String(r.int(0, 59)).padStart(2, '0')}`;
  const noise = (day, h) => {
    const who = r.pick(staff);
    return r.pick([
      `Nov ${day} ${time(h)} ${host} sshd[${r.int(1000, 9999)}]: Accepted password for ${who} from ${ip()}`,
      `Nov ${day} ${time(h)} ${host} sshd[${r.int(1000, 9999)}]: Failed password for ${who} from ${ip()}`,
      `Nov ${day} ${time(h)} ${host} CRON[${r.int(1000, 9999)}]: session opened for user root`,
      `Nov ${day} ${time(h)} ${host} sudo: ${who} : COMMAND=/usr/bin/apt update`,
      `Nov ${day} ${time(h)} ${host} sshd[${r.int(1000, 9999)}]: Connection closed by ${ip()}`,
    ]);
  };
  const logLines = (day, special) => {
    const lines = [];
    for (let h = 0; h < 22; h++) lines.push(noise(day, h));
    for (const [at, text] of special) lines.splice(at, 0, text);
    return lines.join('\n');
  };
  // The password hides in one of three places. Each has an older, expired
  // password nearby as a trap, so players must compare dates.
  const passSpot = r.pick(['log', 'config', 'mail']);
  const decoyUser = r.pick(staff);
  const decoyPass = `${words[2]}${r.int(10, 99)}`;
  const authLog = logLines(14, [
    ...(passSpot === 'log' ? [[r.int(8, 18), `Nov 14 ${time(13)} ${host} passwd[${r.int(1000, 9999)}]: password for ${target} changed to '${pass}'`]] : []),
    [r.int(2, 6), `Nov 14 ${time(4)} ${host} passwd[${r.int(1000, 9999)}]: password for ${decoyUser} changed to '${decoyPass}'`],
  ]);
  const oldLog = logLines(7, passSpot === 'log'
    ? [[r.int(5, 15), `Nov 7 ${time(9)} ${host} passwd[${r.int(1000, 9999)}]: password for ${target} changed to '${oldPass}'`]]
    : []);
  const service = target.slice(4);
  const configDir = passSpot === 'config' ? {
    [service]: {
      'config.ini': `# ${service} service settings\n[account]\nuser = ${target}\npassword = ${pass}\nupdated = 2026-11-14\n\n[schedule]\nrun = nightly`,
      'config.ini.bak': `# ${service} service settings (BACKUP)\n[account]\nuser = ${target}\npassword = ${oldPass}\nupdated = 2026-11-07\n\n[schedule]\nrun = nightly`,
    },
  } : {};
  const mail = (to, date, subject, body) => `From: it-desk@${host}\nTo: ${to}\nDate: ${date}\nSubject: ${subject}\n\n${body}\n`;
  const mailDir = passSpot === 'mail' ? {
    mail: {
      [target]: [
        mail(target, 'Nov 7, 09:12', 'temporary password', `Hi! Your temporary password is: ${oldPass}\nIt will be replaced next week.`),
        mail(target, 'Nov 12, 16:40', 'reminder', 'Please remember to change your password before Friday.'),
        mail(target, 'Nov 14, 13:05', 'password reset', `Your password has been reset.\nNew password: ${pass}\nDelete this email!`),
      ].join('\n-----\n'),
      [decoyUser]: mail(decoyUser, 'Nov 14, 04:22', 'password reset', `Your password has been reset.\nNew password: ${decoyPass}`),
    },
  } : {};
  const passHint = {
    log: 'The logs in /var/log might help.',
    config: 'Service settings usually live in /etc.',
    mail: 'Maybe IT emailed it. Check /var/mail.',
  }[passSpot];
  const passTip = {
    log: `Try:  grep ${target} /var/log   Watch the dates: the old password won't work.`,
    config: 'Try:  grep password /etc   then cat the files it finds. One is an old backup.',
    mail: `Try:  ls /var/mail   then  cat /var/mail/${target}   and read the NEWEST email.`,
  }[passSpot];

  // ---- Layer 2: encrypted file ----
  const fragA = r.code(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
  const plain = `TRANSFER LOG -- authorized by ${target}\nFRAGMENT A: ${fragA}\nkeep this safe`;
  const cipherType = r.pick(CIPHERS);
  const shift = r.int(3, 22);
  const encrypted = encryptWith(cipherType, plain, shift);
  const note = {
    caesar: `note to self: I rotated every letter in vault.enc forward by ${shift}.\nnobody will ever figure that out.`,
    base64: `note to self: vault.enc is just base64 encoded.\nnot real encryption but who's checking?`,
    reverse: `note to self: I wrote vault.enc completely backwards.\nnobody will think to reverse it.`,
    hex: `note to self: vault.enc is written in hex (two characters per letter).\nlooks like gibberish to anyone else.`,
    atbash: `note to self: I swapped every letter in vault.enc with its mirror (A<->Z, B<->Y...).\napparently that's called "atbash". ancient and unbreakable lol.`,
  }[cipherType];

  // ---- Layer 3: PIN (4 different digits) ----
  const pin = r.shuffle('0123456789'.split('')).slice(0, 4).join('');

  // ---- Layer 4: network ----
  const hostNames = r.shuffle(HOSTS).slice(0, 4);
  const netTarget = hostNames[0];
  const honeypotHost = hostNames[1];
  const fragC = r.pick(WORDS).toUpperCase();
  const backdoor = r.int(20000, 60000);
  const honeypot = r.int(20000, 60000);
  const SERVICES = [[22, 'ssh'], [80, 'http'], [443, 'https'], [3306, 'mysql'], [25, 'smtp'], [8080, 'http-alt']];
  const hosts = {};
  hostNames.forEach((name, i) => {
    const ports = r.shuffle(SERVICES).slice(0, r.int(2, 4)).map(([port, service]) => ({ port, service }));
    if (name === netTarget) ports.push({ port: backdoor, service: 'unknown', backdoor: true });
    if (name === honeypotHost) ports.push({ port: honeypot, service: 'unknown', honeypot: true });
    ports.sort((a, b) => a.port - b.port);
    hosts[name] = { ip: `10.0.0.${10 + i * r.int(3, 9)}`, ports };
  });

  const key = `${fragA}-${pin}-${fragC}`;

  // ---- Filesystem ----
  const fs = {
    etc: {
      hosts: Object.entries(hosts).map(([n, h]) => `${h.ip}\t${n}`).join('\n') + `\n127.0.0.1\t${host}`,
      motd: `Welcome to ${host.toUpperCase()} -- authorized users only.\nAll activity is logged.`,
      ...configDir,
    },
    var: {
      log: {
        'auth.log': authLog,
        'syslog': Array.from({ length: 14 }, () => noise(14, r.int(0, 23))).join('\n'),
        old: { 'auth.log.1': oldLog },
      },
      ...mailDir,
    },
    home: {
      guest: {
        'mission.txt': `MISSION: get root on ${host}.\nTarget account: ${target}\nStart by finding its CURRENT password. ${passHint}\nThen: login ${target} <password>`,
      },
      ...Object.fromEntries(staff.map((s) => [s, { '.locked': 'permission denied' }])),
    },
  };
  const targetHome = {
    'vault.enc': encrypted,
    'note.txt': note,
    'todo.txt': `- move the backdoor off ${netTarget} before the audit!!\n- buy coffee\n- change password again??`,
  };

  return { host, target, pass, oldPass, passSpot, passHint, passTip, fs, targetHome, cipherType, shift, encrypted, fragA, pin, hosts, netTarget, backdoor, honeypotHost, honeypot, fragC, key };
}

export const CIPHERS = ['caesar', 'base64', 'reverse', 'hex', 'atbash'];
const METHOD_LIST = 'caesar N|base64|reverse|hex|atbash';
const METHOD_ALIASES = { caesar: 'caesar', rot: 'caesar', base64: 'base64', b64: 'base64', reverse: 'reverse', rev: 'reverse', hex: 'hex', atbash: 'atbash', mirror: 'atbash' };

export function encryptWith(type, text, shift = 0) {
  if (type === 'caesar') return caesar(text, shift);
  if (type === 'base64') return b64encode(text);
  if (type === 'hex') return hexEncode(text);
  if (type === 'atbash') return atbash(text);
  return reverse(text);
}

// Returns the decoded text, or null if the input isn't valid for that method.
export function decryptWith(type, text, shift = 0) {
  if (type === 'caesar') return caesar(text, -shift);
  if (type === 'base64') return b64decode(text);
  if (type === 'hex') return hexDecode(text);
  if (type === 'atbash') return atbash(text);
  if (type === 'reverse') return reverse(text);
  return null;
}

// Each extra hint on the same layer costs more time (ms).
export const HINT_COST = [0, 10000, 20000];

// Three hints per layer, from a gentle nudge to nearly the answer.
export function raceHints(P) {
  const passFile = { log: '/var/log/auth.log', config: `/etc/${P.target.slice(4)}/config.ini`, mail: `/var/mail/${P.target}` }[P.passSpot];
  const method = P.cipherType === 'caesar' ? `caesar ${P.shift}` : P.cipherType;
  return [
    [P.passHint + ' Read mission.txt again if you need to.', P.passTip, `Open ${passFile} and use the NEWEST password for ${P.target}.`],
    ['Read note.txt in your new home folder. It says how the file was scrambled.', 'Match the note to a method: caesar, base64, reverse, hex or atbash. For caesar, use the number from the note.', `Type exactly:  decrypt vault.enc ${method}`],
    ['"right spot" = correct digit in the correct place. "wrong spot" = the digit is in the PIN, but somewhere else.', 'Try 0123, then 4567, to find which digits are in the PIN. Then swap their order.', `The PIN starts with ${P.pin[0]} and ends with ${P.pin[3]}.`],
    ['Read ~/todo.txt. It names the host with the backdoor.', `Run  nmap ${P.netTarget}  and look for the port marked "unknown". Other hosts may have honeypots!`, `Type exactly:  connect ${P.netTarget} ${P.backdoor}`],
    ['Type "notes" to see the 3 fragments you collected.', 'The key is FRAGMENT A, then the PIN, then FRAGMENT C, with dashes between.', `Type exactly:  sudo ${P.key}`],
  ];
}

// "fastest: CRACK 0:31 · 2 hints" from a player's race progress.
export function raceStatsText(s) {
  const splits = s?.splits || [];
  const parts = [];
  if (splits.length) {
    const best = splits.indexOf(Math.min(...splits));
    parts.push(`fastest layer: ${LAYERS[best]} ${fmtTime(splits[best])}`);
  }
  const h = s?.hints || 0;
  parts.push(h ? `${h} hint${h === 1 ? '' : 's'}` : 'no hints');
  return parts.join(' · ');
}

// Mastermind feedback for the PIN layer.
export function pinFeedback(secret, guess) {
  let exact = 0;
  let near = 0;
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) exact++;
    else if (secret.includes(guess[i])) near++;
  }
  return { exact, near };
}

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------
export default {
  id: 'race',
  name: 'Terminal Race',
  min: 1,
  max: 8,
  bots: true,
  timeLimit: TIME_LIMIT,
  blurb: 'Everyone hacks the same server. Find passwords, decrypt files, crack the PIN. First to root wins.',

  setup({ players }) {
    const out = {};
    for (const p of players) out[p.id] = { layer: 0, at: 0 };
    return { players: out };
  },

  mount(ctx) {
    const P = buildRace(ctx.seed);
    const { term, me } = ctx;
    const sh = new Shell(term, { user: 'guest', host: P.host, fs: P.fs, cwd: '/home/guest' });
    sh.homeDir = '/home/guest';
    ctx.addCommon(sh);

    let layer = ctx.myState().layer || 0;
    const splits = [];          // time spent on each layer (ms)
    let lastSplit = ctx.startedAt;
    const frags = {};
    let lockedUntil = 0;

    const objectives = [
      `Find the CURRENT password for ${P.target} and log in:  login ${P.target} <password>`,
      `Decrypt the file in your new home folder. Read the note first. Use:  decrypt <file> <${METHOD_LIST}>`,
      'Crack the 4-digit vault PIN (all digits are different):  crack <pin>',
      'Find the hidden backdoor. Read todo.txt, scan with nmap, then:  connect <host> <port>',
      'Put your fragments together (type "notes") and take over:  sudo <A>-<B>-<C>',
    ];
    const hints = raceHints(P);
    const hintsUsed = [0, 0, 0, 0, 0];

    function showObjective() {
      if (layer >= 5) return;
      term.printParts([[`[LAYER ${layer + 1}/5 ${LAYERS[layer]}] `, 'hi'], [objectives[layer]]]);
    }

    function advance(to) {
      layer = to;
      ctx.sfx.ok();
      const now = ctx.now();
      splits.push(now - lastSplit);
      lastSplit = now;
      ctx.update({ [`players/${me}/s`]: { layer, at: now, splits, hints: hintsUsed.reduce((a, b) => a + b, 0) } });
      ctx.fx(layer >= 5 ? 'big' : 'win');
      if (layer >= 5) {
        term.print('');
        term.print('#########################################', 'banner');
        term.print('#        ROOT ACCESS GRANTED  ✔         #', 'banner');
        term.print('#########################################', 'banner');
        term.print('You own this box. Waiting for the others…', 'dim');
        sh.user = 'root';
        sh.updatePrompt();
        return;
      }
      term.print(`>> ${LAYERS[layer - 1]} complete.`, 'ok');
      showObjective();
    }

    const need = (n) => {
      if (layer < n) {
        sh.print(`access denied: finish layer ${layer + 1} (${LAYERS[layer]}) first. Type "mission".`, 'err');
        return false;
      }
      return true;
    };

    // ---- Commands ----
    sh.register('mission', { help: 'show your current objective', run: showObjective });
    sh.register('hint', {
      help: 'get a hint (each extra hint on a layer is more specific, but costs time)',
      async run() {
        const l = Math.min(layer, 4);
        const n = Math.min(hintsUsed[l], HINT_COST.length - 1);
        const isNew = hintsUsed[l] < HINT_COST.length;
        hintsUsed[l]++;
        ctx.update({ [`players/${me}/s/hints`]: hintsUsed.reduce((a, b) => a + b, 0) });
        sh.print(`hint ${n + 1}/${HINT_COST.length}: ${hints[l][n]}`, 'warn');
        if (isNew && HINT_COST[n]) {
          sh.print(`(this hint costs ${HINT_COST[n] / 1000} seconds)`, 'dim');
          await sh.progress('cooldown', HINT_COST[n], 'dim');
        } else if (n < HINT_COST.length - 1) {
          sh.print(`still stuck? type "hint" again for a more specific one (costs ${HINT_COST[n + 1] / 1000}s).`, 'dim');
        }
      },
    });
    sh.register('notes', {
      help: 'show the key fragments you have found',
      run() {
        sh.print(`FRAGMENT A: ${frags.A || '????'}`, frags.A ? 'ok' : 'dim');
        sh.print(`FRAGMENT B: ${frags.B || '????'}  (the vault PIN)`, frags.B ? 'ok' : 'dim');
        sh.print(`FRAGMENT C: ${frags.C || '????'}`, frags.C ? 'ok' : 'dim');
      },
    });

    sh.register('login', {
      help: 'log in as another user',
      usage: 'login <user> <password>',
      complete: (i, p) => (i === 0 ? [P.target] : []),
      async run(args) {
        if (args.length < 2) return sh.print('usage: login <user> <password>', 'warn');
        const [user, pw] = args;
        await sh.progress('authenticating', 700);
        if (user !== P.target) return sh.print(`login failed: ${user} is not your target (${P.target}).`, 'err');
        if (layer >= 1) return sh.print(`already logged in as ${P.target}.`, 'dim');
        if (pw === P.oldPass) {
          ctx.sfx.err();
          return sh.print('login failed: password EXPIRED. That one is old; look for a newer change.', 'err');
        }
        if (pw !== P.pass) {
          ctx.sfx.err();
          return sh.print('login failed: wrong password.', 'err');
        }
        P.fs.home[P.target] = P.targetHome;
        sh.user = P.target;
        sh.homeDir = `/home/${P.target}`;
        sh.cwd = sh.homeDir;
        sh.updatePrompt();
        sh.print(`Welcome, ${P.target}.`, 'ok');
        advance(1);
      },
    });

    sh.register('decrypt', {
      help: 'decrypt a file',
      usage: `decrypt <file> <${METHOD_LIST}>`,
      complete: (i, p) => (i === 0 ? sh.completePath(p) : i === 1 ? CIPHERS : []),
      async run(args) {
        if (!need(1)) return;
        const [file, method, n] = args;
        if (!file || !method) return sh.print(`usage: decrypt <file> <${METHOD_LIST}>`, 'warn');
        const content = sh.node(sh.resolve(file));
        if (typeof content !== 'string') return sh.print(`decrypt: ${file}: no such file`, 'err');
        const m = METHOD_ALIASES[method.toLowerCase()];
        if (!m) return sh.print(`decrypt: unknown method "${method}". Try: ${CIPHERS.join(', ')}.`, 'err');
        const k = parseInt(n, 10);
        if (m === 'caesar' && Number.isNaN(k)) return sh.print('usage: decrypt <file> caesar <number>', 'warn');
        const out = decryptWith(m, content, k);
        if (out === null) return sh.print(`decrypt: that file isn't valid ${m}.`, 'err');
        await sh.progress('decrypting', 900);
        sh.print(out);
        if (out.includes(`FRAGMENT A: ${P.fragA}`)) {
          frags.A = P.fragA;
          sh.print(`>> saved FRAGMENT A (${P.fragA}) to your notes.`, 'ok');
          if (layer === 1) advance(2);
        } else {
          sh.print('(that looks like garbage. Wrong method?)', 'dim');
        }
      },
    });

    sh.register('crack', {
      help: 'try a PIN on the vault',
      usage: 'crack <4 digits>',
      async run(args) {
        if (!need(2)) return;
        const g = args[0] || '';
        if (!/^\d{4}$/.test(g)) return sh.print('usage: crack <4 digits>, like crack 1234', 'warn');
        await sh.progress('trying ' + g, 400);
        if (g === P.pin) {
          frags.B = P.pin;
          sh.print(`VAULT UNLOCKED. FRAGMENT B: ${P.pin}`, 'ok');
          if (layer === 2) advance(3);
          return;
        }
        const { exact, near } = pinFeedback(P.pin, g);
        sh.term.printParts([['  ' + g + '  ', 'cmd'], [`${exact} right spot`, exact ? 'ok' : 'dim'], ['  ·  '], [`${near} wrong spot`, near ? 'warn' : 'dim']]);
      },
    });

    sh.register('nmap', {
      help: 'scan the network, or one host',
      usage: 'nmap [host]',
      complete: (i) => (i === 0 ? Object.keys(P.hosts) : []),
      async run(args) {
        if (!need(3)) return;
        if (!args[0]) {
          await sh.progress('scanning 10.0.0.0/24', 1000);
          for (const [n, h] of Object.entries(P.hosts)) sh.term.printParts([['  ' + h.ip.padEnd(12), 'dim'], [n, 'dir'], ['  up', 'ok']]);
          return;
        }
        const h = P.hosts[args[0]];
        if (!h) return sh.print(`nmap: unknown host "${args[0]}". Run nmap with no host to list them.`, 'err');
        await sh.progress(`scanning ${args[0]}`, 1200);
        sh.print('PORT      SERVICE', 'dim');
        for (const p of h.ports) sh.term.printParts([[String(p.port).padEnd(10), 'cmd'], [p.service, p.service === 'unknown' ? 'warn' : '']]);
      },
    });

    sh.register('connect', {
      help: 'connect to a port on a host',
      usage: 'connect <host> <port>',
      complete: (i) => (i === 0 ? Object.keys(P.hosts) : []),
      async run(args) {
        if (!need(3)) return;
        if (Date.now() < lockedUntil) return sh.print('locked out by intrusion detection. Wait a moment…', 'err');
        const [name, portStr] = args;
        const h = P.hosts[name];
        const port = parseInt(portStr, 10);
        if (!h || Number.isNaN(port)) return sh.print('usage: connect <host> <port>', 'warn');
        await sh.progress(`connecting ${name}:${port}`, 700);
        const p = h.ports.find((x) => x.port === port);
        if (!p) return sh.print('connection refused.', 'err');
        if (p.honeypot) {
          ctx.sfx.err();
          sh.print('!! HONEYPOT !! intrusion detection triggered. Locked out for 8 seconds.', 'alert');
          lockedUntil = Date.now() + 8000;
          await sh.progress('lockout', 8000, 'err');
          return;
        }
        if (p.backdoor) {
          frags.C = P.fragC;
          sh.print(`backdoor v0.3 -- welcome back.\nFRAGMENT C: ${P.fragC}`, 'ok');
          if (layer === 3) advance(4);
          return;
        }
        const msg = {
          ssh: 'ssh: permission denied (publickey).',
          http: 'HTTP/1.1 200 OK -- <h1>Under construction</h1>',
          'http-alt': 'HTTP/1.1 404 Not Found',
          https: 'TLS handshake ok. Nothing interesting here.',
          mysql: 'mysql: access denied for user guest.',
          smtp: '220 mail ready. (nothing to see here)',
        }[p.service] || 'connection closed.';
        sh.print(msg, 'dim');
      },
    });

    sh.register('sudo', {
      help: 'become root with the full key',
      usage: 'sudo <key>',
      async run(args) {
        if (!need(4)) return;
        if (!args[0]) return sh.print('usage: sudo <A>-<B>-<C>', 'warn');
        await sh.progress('verifying key', 1000);
        if (args[0].toUpperCase() !== P.key.toUpperCase()) {
          ctx.sfx.err();
          return sh.print('sudo: incorrect key. Check "notes" (format: A-B-C).', 'err');
        }
        if (layer === 4) advance(5);
      },
    });

    // ---- Intro ----
    term.print(`Connected to ${P.host.toUpperCase()}. Type "help" for commands, "hint" if you're stuck.`, 'dim');
    term.print(P.fs.etc.motd, 'warn');
    showObjective();

    // ---- Side panel ----
    function renderSide(room) {
      ctx.side.innerHTML = '';
      ctx.side.append(el('h2', {}, '// PROGRESS'));
      const rows = ctx.players().map((p) => ({ p, s: p.s || {} })).sort((a, b) => (b.s.layer || 0) - (a.s.layer || 0) || (a.s.at || 0) - (b.s.at || 0));
      for (const { p, s } of rows) {
        const l = s.layer || 0;
        ctx.side.append(el('div', { class: 'side-row' },
          el('span', { class: 'dot', style: { background: p.color } }),
          el('span', { class: 'pname', style: { color: p.color } }, p.name + (p.id === me ? ' (you)' : '')),
          el('span', { class: 'progress-text' },
            el('span', { style: { color: p.color } }, bar(l / 5, 5)), ' ', l >= 5 ? 'ROOT ✔' : LAYERS[l])));
      }
      void room;
    }

    // ---- Host: bots, timer and finish ----
    const botNext = {};
    ctx.every(500, () => {
      const left = ctx.startedAt + ctx.timeLimit - ctx.now();
      ctx.setTimer(fmtTime(left), left < 60000 ? 'danger' : '');
      if (!ctx.isHost()) return;
      const now = ctx.now();
      for (const p of ctx.players()) {
        if (!p.bot) continue;
        const l = p.s?.layer || 0;
        if (l >= 5) continue;
        const layerMs = botParams(ctx.room.botLevel).raceLayerMs;
        botNext[p.id] ??= now + between(layerMs);
        if (now >= botNext[p.id]) {
          botNext[p.id] = now + between(layerMs);
          ctx.update({ [`players/${p.id}/s`]: { layer: l + 1, at: now } });
        }
      }
      if (left <= 0) finish();
    });

    function finish() {
      const rows = ctx.players().map((p) => ({ p, s: p.s || {} }))
        .sort((a, b) => (b.s.layer || 0) - (a.s.layer || 0) || (a.s.at || Infinity) - (b.s.at || Infinity));
      const results = rows.map(({ p, s }, i) => ({
        id: p.id, name: p.name, color: p.color, place: i + 1,
        stats: p.bot ? 'bot' : raceStatsText(s),
        detail: (s.layer || 0) >= 5 ? `ROOT in ${fmtTime(s.at - ctx.startedAt)}` : `reached layer ${(s.layer || 0) + 1}/5 (${LAYERS[s.layer || 0]})`,
      }));
      const winner = rows[0];
      const summary = winner && (winner.s.layer || 0) >= 5 ? `${winner.p.name} got root first!` : 'Time is up! Nobody got root.';
      ctx.end(results, summary);
    }

    return {
      onRoom(room) {
        renderSide(room);
        if (ctx.isHost() && ctx.players().some((p) => (p.s?.layer || 0) >= 5)) finish();
      },
    };
  },
};
