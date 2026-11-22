// How strong the bots are. The host picks a level in the lobby.

export const BOT_LEVELS = ['easy', 'normal', 'hard'];

const PARAMS = {
  easy: {
    raceLayerMs: [60000, 100000], // time a bot spends on each race layer
    duelWpm: [16, 26],
    duelMiss: 0.2,
    defendBreach: 0.25,           // chance per second to start a breach (if CPU allows)
    defendKill: 0.15,             // chance to kill an incoming breach
    defendPatch: 0.15,
    defendTargetsLeader: false,
    quickStageMs: [40000, 70000], // time a bot spends on each quick-hack stage
  },
  normal: {
    raceLayerMs: [30000, 65000],
    duelWpm: [28, 48],
    duelMiss: 0.12,
    defendBreach: 0.5,
    defendKill: 0.35,
    defendPatch: 0.25,
    defendTargetsLeader: false,
    quickStageMs: [22000, 40000],
  },
  hard: {
    raceLayerMs: [18000, 35000],
    duelWpm: [48, 66],
    duelMiss: 0.05,
    defendBreach: 0.75,
    defendKill: 0.6,
    defendPatch: 0.4,
    defendTargetsLeader: true,
    quickStageMs: [12000, 22000],
  },
};

export function botParams(level) {
  return PARAMS[level] || PARAMS.normal;
}

export function between([min, max]) {
  return min + Math.random() * (max - min);
}
