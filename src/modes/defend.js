// HACK & DEFEND: everyone owns 3 servers. Breach other players to weaken
// firewalls and steal data; trace and kill attacks on your own servers.
// Most data (servers + stolen loot) when time runs out wins.

import { Shell } from '../commands.js';
import { el, fmtTime } from '../util.js';
import { botParams } from '../bots.js';

const TIME_LIMIT = 5 * 60 * 1000;
const MAX_CPU = 10;
const CPU_REGEN_MS = 1500;
const MAX_FW = 6;
const STEAL = 40;
const MAX_ACTIVE = 2;
const COST = { scan: 1, breach: 3, kill: 2, patch: 4 };
const NODES = ['web', 'db', 'mail'];

export function startNodes() {
  return { web: { fw: 2, data: 100 }, db: { fw: 3, data: 200 }, mail: { fw: 1, data: 60 } };
}

export function score(s) {
  if (!s?.nodes) return 0;
  return NODES.reduce((sum, n) => sum + (s.nodes[n]?.data || 0), 0) + (s.loot || 0);
}

export function breachTime(fw) {
  return 5000 + 2000 * fw;
}

const tag = () => Math.random().toString(36).slice(2, 5);

export default {
  id: 'defend',
  name: 'Hack & Defend',
  min: 2,
  max: 6,
  bots: true,
  blurb: 'Guard your 3 servers while breaching everyone else\'s. Steal the most data in 5 minutes.',

  setup({ players }) {
    const out = {};
    for (const p of players) out[p.id] = { nodes: startNodes(), loot: 0 };
    return { players: out };
  },

  mount(ctx) {
    const { term, me } = ctx;
    const sh = new Shell(term, { user: ctx.player(me)?.name || 'op', host: 'ops' });
    ctx.addCommon(sh);

    // State for players this browser controls (you, plus bots if host).
    const local = {}; // id -> { nodes, loot, cpu, lastRegen }
    const processed = new Set();
    const alerted = new Set();

    function L(id) {
      if (!local[id]) {
        const s = ctx.player(id)?.s || {};
        local[id] = {
          nodes: JSON.parse(JSON.stringify(s.nodes || startNodes())),
          loot: s.loot || 0,
          cpu: id === me ? 6 : 4,
          lastRegen: ctx.now(),
        };
      }
      return local[id];
    }

    const others = (id) => ctx.players().filter((p) => p.id !== id);
    const findPlayer = (name) => ctx.players().find((p) => p.name.toLowerCase() === String(name || '').toLowerCase());
    const actions = () => Object.entries(ctx.room.actions || {});
    const activeBreachesFrom = (id) => actions().filter(([, a]) => a.type === 'breach' && a.from === id && ctx.now() < a.end + 5000 && ctx.player(a.to));
    const spend = (id, cost) => {
      const l = L(id);
      if (l.cpu < cost) return false;
      l.cpu -= cost;
      return true;
    };
    const needCpu = (cost) => {
      if (spend(me, cost)) return true;
      sh.print(`not enough CPU (need ${cost}, have ${L(me).cpu}). It refills over time.`, 'err');
      ctx.sfx.err();
      return false;
    };

    function startBreach(from, to, node) {
      const victim = ctx.player(to);
      const fw = victim?.s?.nodes?.[node]?.fw ?? 0;
      const now = ctx.now();
      const t = tag();
      ctx.push('actions', { type: 'breach', from, to, node, start: now, end: now + breachTime(fw), tag: t });
      return { t, secs: Math.round(breachTime(fw) / 1000) };
    }

    // ---- Commands ----
    const playerComplete = (i, p) => (i === 0 ? others(me).map((x) => x.name) : i === 1 ? NODES : []);

    sh.register('status', {
      help: 'show your servers, CPU and score',
      run() {
        const l = L(me);
        sh.print(`CPU ${l.cpu}/${MAX_CPU}   stolen loot: ${l.loot}   score: ${score(l)}`, 'hi');
        for (const n of NODES) sh.term.printParts([['  ' + n.padEnd(6), 'dir'], [`firewall ${'▮'.repeat(l.nodes[n].fw)}${'▯'.repeat(MAX_FW - l.nodes[n].fw)} ${l.nodes[n].fw}`.padEnd(24)], [`data ${l.nodes[n].data}`, 'warn']]);
      },
    });

    sh.register('scan', {
      help: `look at a player's servers (${COST.scan} CPU)`,
      usage: 'scan <player>',
      complete: playerComplete,
      async run(args) {
        const p = findPlayer(args[0]);
        if (!p || p.id === me) return sh.print('usage: scan <player>   (type "players" to see names)', 'warn');
        if (!needCpu(COST.scan)) return;
        await sh.progress(`scanning ${p.name}`, 800);
        const nodes = ctx.player(p.id)?.s?.nodes || {};
        for (const n of NODES) sh.term.printParts([['  ' + n.padEnd(6), 'dir'], [`firewall ${nodes[n]?.fw ?? '?'}`.padEnd(14)], [`data ${nodes[n]?.data ?? '?'}`, 'warn']]);
      },
    });

    sh.register('breach', {
      help: `attack a server: weakens its firewall, or steals data once it's at 0 (${COST.breach} CPU)`,
      usage: 'breach <player> <web|db|mail>',
      complete: playerComplete,
      run(args) {
        const p = findPlayer(args[0]);
        const node = (args[1] || '').toLowerCase();
        if (!p || p.id === me || !NODES.includes(node)) return sh.print('usage: breach <player> <web|db|mail>', 'warn');
        if (activeBreachesFrom(me).length >= MAX_ACTIVE) return sh.print(`you can only run ${MAX_ACTIVE} breaches at once.`, 'err');
        if (!needCpu(COST.breach)) return;
        const { t, secs } = startBreach(me, p.id, node);
        sh.term.printParts([['» breach ', 'ok'], [`#${t}`, 'warn'], [` started on ${p.name}/${node}. ETA ${secs}s. They might notice…`, 'dim']]);
        ctx.sfx.fire();
      },
    });

    sh.register('trace', {
      help: 'show attacks happening to your servers right now',
      run() {
        const incoming = actions().filter(([, a]) => a.type === 'breach' && a.to === me);
        if (!incoming.length) return sh.print('no active intrusions. All quiet.', 'ok');
        for (const [, a] of incoming) {
          sh.term.printParts([['  #' + a.tag, 'warn'], [`  ${ctx.player(a.from)?.name || '?'} → ${a.node}`], [`  ${Math.max(0, Math.ceil((a.end - ctx.now()) / 1000))}s left`, 'err']]);
        }
        sh.print('stop one with:  kill <id>', 'dim');
      },
    });

    sh.register('kill', {
      help: `stop an attack on your servers (${COST.kill} CPU)`,
      usage: 'kill <id>',
      complete: (i) => (i === 0 ? actions().filter(([, a]) => a.type === 'breach' && a.to === me).map(([, a]) => a.tag) : []),
      run(args) {
        const id = (args[0] || '').replace('#', '');
        const found = actions().find(([, a]) => a.type === 'breach' && a.to === me && a.tag === id);
        if (!found) return sh.print(`kill: no attack with id "${id}". Use "trace".`, 'err');
        if (!needCpu(COST.kill)) return;
        killBreach(found[0], found[1]);
        sh.print(`killed #${id}. ${ctx.player(found[1].from)?.name || '?'} is locked out.`, 'ok');
        ctx.sfx.ok();
      },
    });

    sh.register('patch', {
      help: `upgrade one of your firewalls (${COST.patch} CPU)`,
      usage: 'patch <web|db|mail>',
      complete: (i) => (i === 0 ? NODES : []),
      async run(args) {
        const node = (args[0] || '').toLowerCase();
        if (!NODES.includes(node)) return sh.print('usage: patch <web|db|mail>', 'warn');
        if (L(me).nodes[node].fw >= MAX_FW) return sh.print(`${node} firewall is already maxed.`, 'dim');
        if (!needCpu(COST.patch)) return;
        await sh.progress(`patching ${node}`, 1500);
        patchNode(me, node);
        sh.print(`${node} firewall is now ${L(me).nodes[node].fw}.`, 'ok');
      },
    });

    function writeState(id) {
      const l = L(id);
      ctx.update({ [`players/${id}/s`]: { nodes: l.nodes, loot: l.loot } });
    }

    function patchNode(id, node) {
      const l = L(id);
      l.nodes[node].fw = Math.min(MAX_FW, l.nodes[node].fw + 1);
      writeState(id);
    }

    function killBreach(key, a) {
      processed.add(key);
      ctx.update({ [`actions/${key}`]: null });
      ctx.push('actions', { type: 'report', to: a.from, victim: a.to, node: a.node, tag: a.tag, outcome: 'killed' });
    }

    // ---- Process actions for everyone this browser controls ----
    function processActions() {
      const controlled = new Set(ctx.controlled());
      const now = ctx.now();
      for (const [key, a] of actions()) {
        if (!controlled.has(a.to) || processed.has(key)) continue;

        if (a.type === 'breach') {
          if (a.to === me && !alerted.has(key)) {
            alerted.add(key);
            term.printParts([[' INCOMING ', 'alert'], [` #${a.tag} `, 'warn'], [`${ctx.player(a.from)?.name || '?'} is breaching your ${a.node} (ETA ${Math.ceil((a.end - now) / 1000)}s)  →  `], [`kill ${a.tag}`, 'cmd']]);
            ctx.sfx.alert();
          }
          if (now < a.end) continue;
          processed.add(key);
          const l = L(a.to);
          const n = l.nodes[a.node];
          let outcome;
          let amt = 0;
          if (n.fw > 0) {
            n.fw -= 1;
            outcome = 'weakened';
          } else if (n.data > 0) {
            amt = Math.min(STEAL, n.data);
            n.data -= amt;
            outcome = 'stolen';
          } else {
            outcome = 'empty';
          }
          ctx.update({ [`actions/${key}`]: null, [`players/${a.to}/s`]: { nodes: l.nodes, loot: l.loot } });
          ctx.push('actions', { type: 'report', to: a.from, victim: a.to, node: a.node, tag: a.tag, outcome, amt, fw: n.fw });
          if (a.to === me) {
            const who = ctx.player(a.from)?.name || '?';
            if (outcome === 'weakened') term.print(`[!] ${who} weakened your ${a.node} firewall (now ${n.fw}). patch it!`, 'err');
            else if (outcome === 'stolen') term.print(`[!] ${who} stole ${amt} data from your ${a.node}!`, 'err');
            ctx.sfx.hit();
          }
        } else if (a.type === 'report') {
          processed.add(key);
          ctx.update({ [`actions/${key}`]: null });
          const l = L(a.to);
          if (a.outcome === 'stolen') {
            l.loot += a.amt;
            writeState(a.to);
          }
          if (a.to === me) {
            const victim = ctx.player(a.victim)?.name || '?';
            const msg = {
              weakened: [`✔ #${a.tag}: ${victim}/${a.node} firewall down to ${a.fw}.`, 'ok'],
              stolen: [`✔ #${a.tag}: stole ${a.amt} data from ${victim}/${a.node}!`, 'ok'],
              empty: [`#${a.tag}: ${victim}/${a.node} has no data left.`, 'dim'],
              killed: [`✖ #${a.tag}: ${victim} traced and killed your breach.`, 'err'],
            }[a.outcome];
            if (msg) term.print(...msg);
            if (a.outcome === 'stolen') ctx.sfx.ok();
            if (a.outcome === 'killed') ctx.sfx.err();
          }
        }
      }
    }

    // ---- Bots (run by the host) ----
    function runBots() {
      const level = botParams(ctx.room.botLevel);
      for (const p of ctx.players()) {
        if (!p.bot) continue;
        const l = L(p.id);
        for (const [key, a] of actions()) {
          if (a.type !== 'breach' || a.to !== p.id || alerted.has(key)) continue;
          alerted.add(key);
          if (Math.random() < level.defendKill && spend(p.id, COST.kill)) killBreach(key, a);
        }
        const weak = NODES.find((n) => l.nodes[n].fw <= 1 && l.nodes[n].data > 0);
        if (weak && Math.random() < level.defendPatch && spend(p.id, COST.patch)) patchNode(p.id, weak);
        if (l.cpu >= COST.breach && activeBreachesFrom(p.id).length < MAX_ACTIVE && Math.random() < level.defendBreach) {
          const victims = others(p.id);
          if (!victims.length) continue;
          // Hard bots go after whoever is winning.
          const v = level.defendTargetsLeader
            ? victims.sort((x, y) => score(y.s) - score(x.s))[0]
            : victims[Math.floor(Math.random() * victims.length)];
          const nodes = v.s?.nodes || {};
          const node = NODES.filter((n) => (nodes[n]?.data ?? 1) > 0).sort((x, y) => (nodes[x]?.fw ?? 0) - (nodes[y]?.fw ?? 0))[0] || 'web';
          spend(p.id, COST.breach);
          startBreach(p.id, v.id, node);
        }
      }
    }

    // ---- Stage: CPU meter ----
    const cpuFill = el('div', { class: 'fill' });
    const cpuText = el('span');
    const nodesText = el('span', { class: 'dim' });
    ctx.stage.append(el('div', { class: 'stage-box' },
      el('div', { class: 'meter' }, el('span', {}, 'CPU'), el('div', { class: 'track' }, cpuFill), cpuText),
      el('div', { style: { marginTop: '6px', fontSize: '13px' } }, nodesText)));

    function renderStage() {
      const l = L(me);
      cpuFill.style.width = (l.cpu / MAX_CPU) * 100 + '%';
      cpuText.textContent = `${l.cpu}/${MAX_CPU}`;
      nodesText.textContent = NODES.map((n) => `${n}: fw ${l.nodes[n].fw} · ${l.nodes[n].data} data`).join('   |   ') + `   |   loot ${l.loot}`;
    }

    function renderSide() {
      ctx.side.innerHTML = '';
      ctx.side.append(el('h2', {}, '// SCOREBOARD'));
      const rows = ctx.players().sort((a, b) => score(b.s) - score(a.s));
      for (const p of rows) {
        const nodes = p.s?.nodes || {};
        ctx.side.append(el('div', { class: 'side-row' },
          el('span', { class: 'dot', style: { background: p.color } }),
          el('span', { class: 'pname', style: { color: p.color } }, p.name + (p.id === me ? ' (you)' : '')),
          el('span', { class: 'progress-text', title: 'firewall levels: web/db/mail' }, `fw ${NODES.map((n) => nodes[n]?.fw ?? '?').join('/')}`),
          el('strong', {}, String(score(p.s)))));
      }
    }

    // ---- Main loop ----
    let botTick = 0;
    ctx.every(250, () => {
      const now = ctx.now();
      for (const id of ctx.controlled()) {
        const l = L(id);
        while (now - l.lastRegen >= CPU_REGEN_MS) {
          l.lastRegen += CPU_REGEN_MS;
          l.cpu = Math.min(MAX_CPU, l.cpu + 1);
        }
      }
      processActions();
      if (ctx.isHost() && ++botTick % 4 === 0) runBots();
      renderStage();
      const left = ctx.startedAt + TIME_LIMIT - now;
      ctx.setTimer(fmtTime(left), left < 30000 ? 'danger' : '');
      const alone = ctx.players().length < 2;
      if ((left <= 0 || alone) && ctx.isHost()) {
        const rows = ctx.players().sort((a, b) => score(b.s) - score(a.s));
        ctx.end(rows.map((p, i) => ({ id: p.id, name: p.name, color: p.color, place: i + 1, detail: `${score(p.s)} data (${p.s?.loot || 0} stolen)` })),
          alone ? `Everyone else disconnected. ${rows[0]?.name || 'Nobody'} wins by default!` : `${rows[0]?.name || 'Nobody'} controls the most data!`);
      }
    });

    term.print('HACK & DEFEND. Protect your servers, steal everyone else\'s data.', 'hi');
    term.print('Start with:  status   then   scan <player>   then   breach <player> <node>', 'dim');
    term.print('When you see INCOMING, use  trace  and  kill <id>.  Type "help" for everything.', 'dim');

    return {
      onRoom() {
        processActions();
        renderSide();
        renderStage();
      },
    };
  },
};
