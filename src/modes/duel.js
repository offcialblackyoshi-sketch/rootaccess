// TYPING DUEL: type the command shown, exactly, to fire a packet at your
// target's firewall. Streaks hit harder. Last firewall standing wins.

import { makeRng } from '../rng.js';
import { el, fmtTime } from '../util.js';
import { botParams, between } from '../bots.js';

const MAX_HP = 100;
const TIME_LIMIT = 4 * 60 * 1000;

export const SNIPPETS = [
  'nmap -sS 10.0.0.0/24', 'ssh root@10.0.0.1', 'cat /etc/shadow', 'grep -r password /var/www',
  'chmod +x exploit.sh', './exploit.sh --target gateway', 'ping -c 4 10.0.0.12', 'tar -xzf payload.tar.gz',
  'curl -X POST /api/login', 'python3 crack.py --fast', 'netstat -tulpn', 'kill -9 1337',
  "echo 'pwned' > index.html", 'base64 -d secret.txt', 'iptables -A INPUT -j DROP', 'hashcat -m 0 hashes.txt',
  'ls -la /root', 'dig +short corp.local', 'traceroute 10.0.0.12', 'john --wordlist=words.txt',
  'mount /dev/sdb1 /mnt', 'scp loot.zip me@home:~', 'whoami && id', 'sudo su -',
  'ssh -p 2222 admin@atlas', 'crontab -l', 'history -c', "find / -name '*.key'",
  'chown root:root /vault', 'systemctl stop firewall', 'nc -lvp 4444', 'tail -f /var/log/auth.log',
  'ssh-keygen -t ed25519', 'uname -a', 'rsync -av ./ backup:/', 'decrypt --key 0xDEADBEEF',
  'inject --port 8080 --stealth', 'spoof --mac 00:1A:2B:3C:4D', 'upload rootkit.bin --silent', 'git clone ops/tools.git',
  'openssl rand -hex 16', 'sqlmap -u site.local?id=1', 'arp -a', 'wget 10.0.0.66/x.sh',
  'export PATH=$PATH:/opt/bin', 'ps aux | grep sshd', 'sudo rm -rf /tmp/cache', 'nslookup vault.corp',
];

export default {
  id: 'duel',
  name: 'Typing Duel',
  min: 2,
  max: 8,
  bots: true,
  blurb: 'Type hacker commands fast and exactly to blast other players\' firewalls. Last one standing wins.',

  setup({ players }) {
    const out = {};
    for (const p of players) out[p.id] = { hp: MAX_HP, out: false };
    return { players: out };
  },

  mount(ctx) {
    const { term, me } = ctx;
    const rng = makeRng(`duel:${ctx.seed}:${me}`);
    let snippet = '';
    let streak = 0;
    let target = null;
    let shots = 0;
    let misses = 0;
    const processed = new Set();
    const hpLocal = {}; // for players this browser controls

    // ---- Stage ----
    const snippetEl = el('div', { class: 'snippet', 'aria-live': 'polite' });
    const targetEl = el('span');
    const streakEl = el('span');
    const hpFill = el('div', { class: 'fill' });
    const hpText = el('span');
    ctx.stage.append(el('div', { class: 'stage-box' },
      el('div', { class: 'dim' }, 'TYPE THIS, THEN PRESS ENTER:'),
      snippetEl,
      el('div', { class: 'duel-meta' }, targetEl, streakEl, el('span', { class: 'dim' }, 'Tab = switch target')),
      el('div', { class: 'meter', style: { marginTop: '8px' } }, el('span', {}, 'YOUR FIREWALL'), el('div', { class: 'track' }, hpFill), hpText)));

    const alive = () => ctx.players().filter((p) => !p.s?.out);
    const isOut = (id) => !!ctx.player(id)?.s?.out;

    function nextSnippet() {
      let s;
      do s = rng.pick(SNIPPETS); while (s === snippet);
      snippet = s;
      renderSnippet();
    }

    function renderSnippet() {
      const typed = term.input.value;
      let ok = 0;
      while (ok < typed.length && typed[ok] === snippet[ok]) ok++;
      const wrongLen = Math.min(typed.length - ok, snippet.length - ok);
      snippetEl.innerHTML = '';
      snippetEl.append(
        el('span', { class: 'typed' }, snippet.slice(0, ok)),
        el('span', { class: 'wrong' }, snippet.slice(ok, ok + Math.max(0, wrongLen))),
        el('span', { class: 'rest' }, snippet.slice(ok + Math.max(0, wrongLen))));
    }

    function pickTarget(step = 0) {
      const opponents = alive().filter((p) => p.id !== me);
      if (!opponents.length) { target = null; return; }
      let i = opponents.findIndex((p) => p.id === target);
      if (i < 0) i = 0;
      else i = (i + step + opponents.length) % opponents.length;
      target = opponents[i].id;
    }

    function renderMeta() {
      const t = target && ctx.player(target);
      targetEl.innerHTML = '';
      targetEl.append('TARGET: ', t ? el('strong', { style: { color: t.color } }, t.name) : el('span', { class: 'dim' }, 'none'));
      streakEl.textContent = `STREAK: ${streak}${streak >= 3 ? ' 🔥' : ''}`;
      const hp = Math.max(0, ctx.myState().hp ?? MAX_HP);
      hpFill.style.width = hp + '%';
      hpFill.className = 'fill' + (hp <= 25 ? ' danger' : hp <= 50 ? ' warn' : '');
      hpText.textContent = `${hp}/${MAX_HP}`;
    }

    // ---- Input ----
    term.setPrompt('>');
    term.echo = false;
    term.input.addEventListener('input', renderSnippet);
    term.complete = () => {
      pickTarget(1);
      renderMeta();
      renderSide();
      return [];
    };
    term.onCommand = (line) => {
      if (isOut(me)) return;
      if (!target || isOut(target)) pickTarget();
      if (line === snippet) {
        if (!target) return;
        const dmg = 6 + Math.min(streak, 6);
        streak++;
        shots++;
        ctx.push('actions', { type: 'hit', from: me, to: target, dmg, at: ctx.now() });
        const t = ctx.player(target);
        term.printParts([['► ', 'ok'], [snippet, 'cmd'], ['  →  ', 'dim'], [t?.name || '?', ''], [`  -${dmg}`, 'warn'], [streak >= 3 ? `  (streak ${streak})` : '', 'dim']]);
        ctx.sfx.fire();
      } else {
        streak = 0;
        misses++;
        term.printParts([['✖ ', 'err'], [line || '(empty)', 'err'], ['  packet dropped (typo). Streak lost.', 'dim']]);
        ctx.sfx.err();
      }
      nextSnippet();
      renderMeta();
    };

    // ---- Apply hits to players this browser controls ----
    function processHits() {
      const controlled = new Set(ctx.controlled());
      const changes = {};
      const now = ctx.now();
      for (const [key, a] of Object.entries(ctx.room.actions || {})) {
        if (a.type !== 'hit' || !controlled.has(a.to) || processed.has(key)) continue;
        processed.add(key);
        changes[`actions/${key}`] = null;
        const victim = ctx.player(a.to);
        if (!victim || victim.s?.out) continue;
        hpLocal[a.to] ??= victim.s?.hp ?? MAX_HP;
        hpLocal[a.to] = Math.max(0, hpLocal[a.to] - a.dmg);
        changes[`players/${a.to}/s/hp`] = hpLocal[a.to];
        if (hpLocal[a.to] <= 0) {
          changes[`players/${a.to}/s/out`] = true;
          changes[`players/${a.to}/s/outAt`] = now;
        }
        if (a.to === me) {
          const from = ctx.player(a.from);
          term.printParts([['◄ ', 'err'], [from?.name || '?', ''], [` hit your firewall  -${a.dmg}`, 'err']]);
          ctx.sfx.hit();
          if (hpLocal[me] <= 0) {
            term.print('');
            term.print('XXXX  FIREWALL DOWN. You are out. Spectating…  XXXX', 'alert');
            term.setEnabled(false);
          }
        }
      }
      if (Object.keys(changes).length) ctx.update(changes);
    }

    // ---- Side panel ----
    function renderSide() {
      ctx.side.innerHTML = '';
      ctx.side.append(el('h2', {}, '// FIREWALLS'));
      const rows = ctx.players().sort((a, b) => (b.s?.hp ?? 0) - (a.s?.hp ?? 0));
      for (const p of rows) {
        const hp = Math.max(0, p.s?.hp ?? MAX_HP);
        const canTarget = p.id !== me && !p.s?.out && !isOut(me);
        ctx.side.append(el('div', { class: 'side-row' + (p.s?.out ? ' out' : '') + (p.id === target ? ' target' : '') },
          el('span', { class: 'dot', style: { background: p.color } }),
          el('span', { class: 'pname', style: { color: p.color } }, p.name + (p.id === me ? ' (you)' : '')),
          el('span', { class: 'progress-text' }, p.s?.out ? 'DOWN' : `${hp} HP`),
          canTarget ? el('button', { onclick: () => { target = p.id; renderMeta(); renderSide(); term.focus(); } }, 'aim') : null));
      }
    }

    // ---- Host: bots, timer, finish ----
    const bots = {};
    ctx.every(250, () => {
      const left = ctx.startedAt + TIME_LIMIT - ctx.now();
      ctx.setTimer(fmtTime(left), left < 30000 ? 'danger' : '');
      processHits();
      if (!ctx.isHost()) return;
      const now = ctx.now();
      for (const p of ctx.players()) {
        if (!p.bot || p.s?.out) continue;
        const level = botParams(ctx.room.botLevel);
        const b = (bots[p.id] ??= { wpm: between(level.duelWpm), next: now + 3000, streak: 0 });
        if (now < b.next) continue;
        const len = 14 + Math.random() * 14;
        b.next = now + (len / ((b.wpm * 5) / 60)) * 1000;
        if (Math.random() < level.duelMiss) { b.streak = 0; continue; }
        const opponents = alive().filter((o) => o.id !== p.id);
        if (!opponents.length) continue;
        const t = opponents[Math.floor(Math.random() * opponents.length)];
        ctx.push('actions', { type: 'hit', from: p.id, to: t.id, dmg: 6 + Math.min(b.streak, 6), at: now });
        b.streak++;
      }
      const stillIn = alive();
      if (stillIn.length <= 1 || left <= 0) finish();
    });

    function finish() {
      const rows = ctx.players().sort((a, b) =>
        (a.s?.out ? 1 : 0) - (b.s?.out ? 1 : 0) || (b.s?.hp ?? 0) - (a.s?.hp ?? 0) || (b.s?.outAt || 0) - (a.s?.outAt || 0));
      const results = rows.map((p, i) => ({
        id: p.id, name: p.name, color: p.color, place: i + 1,
        detail: p.s?.out ? `firewall down at ${fmtTime((p.s.outAt || ctx.now()) - ctx.startedAt)}` : `${p.s?.hp ?? MAX_HP} HP left`,
      }));
      ctx.end(results, `${rows[0]?.name || 'Nobody'} wins the duel!`);
    }

    term.print('DUEL STARTED. Type the command shown above exactly, then press Enter.', 'dim');
    term.print('Correct = hit your target. A typo = packet dropped. Streaks do more damage.', 'dim');
    pickTarget();
    nextSnippet();
    renderMeta();

    return {
      onRoom() {
        if (!target || isOut(target)) pickTarget();
        processHits();
        renderMeta();
        renderSide();
      },
      destroy() {
        term.input.removeEventListener('input', renderSnippet);
      },
    };
  },
};
