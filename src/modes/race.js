// TERMINAL RACE: everyone breaks into the same (seeded) fake server.
// 5 layers: password → decrypt → PIN → backdoor → root. First to root wins.

import { Shell } from '../commands.js';
import { makeRng, WORDS, FIRST, LAST, HOSTS, caesar, b64encode, b64decode, reverse } from '../rng.js';
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
  const decoyUser = r.pick(staff);
  const authLog = logLines(14, [
    [r.int(8, 18), `Nov 14 ${time(13)} ${host} passwd[${r.int(1000, 9999)}]: password for ${target} changed to '${pass}'`],
    [r.int(2, 6), `Nov 14 ${time(4)} ${host} passwd[${r.int(1000, 9999)}]: password for ${decoyUser} changed to '${words[2]}${r.int(10, 99)}'`],
  ]);
  const oldLog = logLines(7, [
    [r.int(5, 15), `Nov 7 ${time(9)} ${host} passwd[${r.int(1000, 9999)}]: password for ${target} changed to '${oldPass}'`],
  ]);

  // ---- Layer 2: encrypted file ----
  const fragA = r.code(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
  const plain = `TRANSFER LOG -- authorized by ${target}\nFRAGMENT A: ${fragA}\nkeep this safe`;
  const cipherType = r.pick(['caesar', 'base64', 'reverse']);
  const shift = r.int(3, 22);
  const encrypted = cipherType === 'caesar' ? caesar(plain, shift) : cipherType === 'base64' ? b64encode(plain) : reverse(plain);
  const note = {
    caesar: `note to self: I rotated every letter in vault.enc forward by ${shift}.\nnobody will ever figure that out.`,
    base64: `note to self: vault.enc is just base64 encoded.\nnot real encryption but who's checking?`,
    reverse: `note to self: I wrote vault.enc completely backwards.\nnobody will think to reverse it.`,
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
    },
    var: {
      log: {
        'auth.log': authLog,
        'syslog': Array.from({ length: 14 }, () => noise(14, r.int(0, 23))).join('\n'),
        old: { 'auth.log.1': oldLog },
      },
    },
    home: {
      guest: {
        'mission.txt': `MISSION: get root on ${host}.\nTarget account: ${target}\nStart by finding its CURRENT password. The logs in /var/log might help.\nThen: login ${target} <password>`,
      },
      ...Object.fromEntries(staff.map((s) => [s, { '.locked': 'permission denied' }])),
    },
  };
  const targetHome = {
    'vault.enc': encrypted,
    'note.txt': note,
    'todo.txt': `- move the backdoor off ${netTarget} before the audit!!\n- buy coffee\n- change password again??`,
  };

  return { host, target, pass, oldPass, fs, targetHome, cipherType, shift, encrypted, fragA, pin, hosts, netTarget, backdoor, honeypotHost, honeypot, fragC, key };
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
    const frags = {};
    let lockedUntil = 0;

    const objectives = [
      `Find the CURRENT password for ${P.target} and log in:  login ${P.target} <password>`,
      'Decrypt the file in your new home folder. Read the note first. Use:  decrypt <file> <caesar N | base64 | reverse>',
      'Crack the 4-digit vault PIN (all digits are different):  crack <pin>',
      'Find the hidden backdoor. Read todo.txt, scan with nmap, then:  connect <host> <port>',
      'Put your fragments together (type "notes") and take over:  sudo <A>-<B>-<C>',
    ];
    const hints = [
      `Try:  grep ${P.target} /var/log   Watch the dates: the old password won't work.`,
      'cat note.txt tells you which method to use. For caesar, use the same number.',
      '"right spot" = correct digit in the correct place. "wrong spot" = digit is in the PIN somewhere else. Change one digit at a time.',
      `cat ~/todo.txt, then nmap ${P.netTarget}. Look for the port that isn't a normal service. Beware of honeypots on other hosts!`,
      'Type "notes" to see your fragments, then sudo FRAGA-PIN-FRAGC (dashes between).',
    ];

    function showObjective() {
      if (layer >= 5) return;
      term.printParts([[`[LAYER ${layer + 1}/5 ${LAYERS[layer]}] `, 'hi'], [objectives[layer]]]);
    }

    function advance(to) {
      layer = to;
      ctx.sfx.ok();
      ctx.update({ [`players/${me}/s`]: { layer, at: ctx.now() } });
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
    sh.register('hint', { help: 'get a hint for the current layer', run: () => sh.print('hint: ' + hints[Math.min(layer, 4)], 'warn') });
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
      usage: 'decrypt <file> <caesar N|base64|reverse>',
      complete: (i, p) => (i === 0 ? sh.completePath(p) : i === 1 ? ['caesar', 'base64', 'reverse'] : []),
      async run(args) {
        if (!need(1)) return;
        const [file, method, n] = args;
        if (!file || !method) return sh.print('usage: decrypt <file> <caesar N|base64|reverse>', 'warn');
        const content = sh.node(sh.resolve(file));
        if (typeof content !== 'string') return sh.print(`decrypt: ${file}: no such file`, 'err');
        let out = null;
        const m = method.toLowerCase();
        if (m === 'caesar' || m === 'rot') {
          const k = parseInt(n, 10);
          if (Number.isNaN(k)) return sh.print('usage: decrypt <file> caesar <number>', 'warn');
          out = caesar(content, -k);
        } else if (m === 'base64' || m === 'b64') {
          out = b64decode(content);
          if (out === null) return sh.print('decrypt: that is not valid base64.', 'err');
        } else if (m === 'reverse' || m === 'rev') {
          out = reverse(content);
        } else {
          return sh.print(`decrypt: unknown method "${method}". Try caesar, base64 or reverse.`, 'err');
        }
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
      const left = ctx.startedAt + TIME_LIMIT - ctx.now();
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
