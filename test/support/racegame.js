// A tiny game used only by platform tests. It exercises what real games need:
// a player keeping the turn, server-side randomness, hidden per-player state,
// scores, and a final result with an explicit adjustment.
//   step {n: 1|2}  advance; reaching the goal wins. n=2 keeps the turn (an "extra move").
//   roll           server rolls a die (1-6), adds it, ends the turn.
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.games.race = {
  id: 'race', name: 'Race', version: '1.0.0', rulesVersion: 1,
  description: 'Test game.',
  players: { min: 2, max: 3 },
  options: [{ id: 'goal', label: 'Goal', type: 'choice', default: 10, choices: [{ value: 10, label: '10' }, { value: 20, label: '20' }] }],
  anytime: [],
  setup: function (ctx) {
    var pos = {}, secret = {};
    ctx.players.forEach(function (p) { pos[p] = 0; secret[p] = 'secret-' + p; });
    return { players: ctx.players.slice(), turn: 0, pos: pos, secret: secret, goal: ctx.options.goal, rolls: [] };
  },
  actors: function (s) { return s.over ? [] : [s.players[s.turn]]; },
  apply: function (s, p, a, ctx) {
    var events;
    if (a.type === 'step') {
      if (a.n !== 1 && a.n !== 2) return { ok: false, error: 'Step 1 or 2.' };
      s.pos[p] += a.n;
      events = [{ type: 'step', public: { n: a.n } }];
      if (a.n === 1) s.turn = (s.turn + 1) % s.players.length;
    } else if (a.type === 'roll') {
      var d = 1 + Math.floor(ctx.rng() * 6);
      s.pos[p] += d;
      s.rolls.push(d);
      events = [{ type: 'roll', public: { die: d } }];
      s.turn = (s.turn + 1) % s.players.length;
    } else {
      return { ok: false, error: 'Unknown action.' };
    }
    var res = { ok: true, state: s, events: events, response: a.type === 'roll' ? { die: s.rolls[s.rolls.length - 1] } : {} };
    if (s.pos[p] >= s.goal) {
      s.over = true;
      var scores = {};
      s.players.forEach(function (x) { scores[x] = s.pos[x]; });
      res.result = { status: 'finished', winners: [p], scores: scores,
        adjustments: [{ player: p, points: 0, reason: 'none needed' }] };
    }
    return res;
  },
  view: function (s, viewer) {
    return { players: s.players, turn: s.turn, pos: s.pos, goal: s.goal, rolls: s.rolls,
      mySecret: viewer ? s.secret[viewer] : null };
  },
  summary: function (s, players) {
    return players.map(function (p) { return p.name + ' ' + s.pos[p.id]; }).join(' · ');
  },
};
