// Team duels (1v1, 2v2, 3v3, 4v4): two teams, A and B.

export const TEAM_SIZES = [0, 1, 2, 3, 4]; // 0 = free-for-all
export const TEAMS = ['A', 'B'];
export const TEAM_COLORS = { A: '#4dd9ff', B: '#ff6b4d' };
export const teamLabel = (size) => (size ? `${size}v${size}` : 'Free-for-all');

const onTeam = (players, t) => players.filter((p) => p.team === t);

// What stops the round from starting ('' when the teams are good to go).
export function teamProblem(players, size) {
  if (!size) return '';
  const none = players.filter((p) => !TEAMS.includes(p.team)).length;
  if (none) return `${none} player${none === 1 ? ' has' : 's have'}n't picked a team.`;
  const [a, b] = TEAMS.map((t) => onTeam(players, t).length);
  if (a !== size || b !== size) return `${teamLabel(size)} needs ${size} on each team (now ${a} vs ${b}).`;
  return '';
}

// Even teams: humans are spread out first, then bots fill in.
// Returns { playerId: 'A' | 'B' }. Players beyond 2 x size get no team.
export function balanceTeams(players, size, random = Math.random) {
  const shuffle = (list) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const order = [...shuffle(players.filter((p) => !p.bot)), ...shuffle(players.filter((p) => p.bot))];
  const out = {};
  const count = { A: 0, B: 0 };
  for (const p of order) {
    const t = count.A <= count.B ? 'A' : 'B';
    if (count[t] >= size) { out[p.id] = null; continue; }
    out[p.id] = t;
    count[t]++;
  }
  return out;
}

// The team with players still standing when the other team is all down, else null.
export function teamWinner(players) {
  const standing = TEAMS.filter((t) => onTeam(players, t).some((p) => !p.out));
  return standing.length === 1 ? standing[0] : null;
}

// Which team is ahead on total firewall HP (for when time runs out).
export function teamLeader(players) {
  const hp = (t) => onTeam(players, t).reduce((n, p) => n + (p.out ? 0 : Math.max(0, p.hp ?? 0)), 0);
  const [a, b] = TEAMS.map(hp);
  return a === b ? null : a > b ? 'A' : 'B';
}
