/**
 * Fivefold (display name configurable in src/config/names.js): a five-dice scorecard
 * game for 2 to 4 players.
 *
 *  - On your turn roll five dice up to three times. After the first roll you may hold
 *    any dice; the rest are rolled again. You may score after any roll.
 *  - Score exactly one empty category per turn; 13 categories, so 13 rounds.
 *      Ones..Sixes      sum of the dice showing that face
 *      Three of a Kind  sum of all dice, if at least three show the same face
 *      Four of a Kind   sum of all dice, if at least four show the same face
 *      Full House       25, for three of one face and two of another
 *      Small Straight   30, for four faces in sequence
 *      Large Straight   40, for five faces in sequence
 *      Five of a Kind   50, for all five the same
 *      Chance           sum of all dice
 *  - Upper bonus: 35 when Ones..Sixes total 63 or more.
 *  - A category may be scored as 0 (for example to keep a better one free); the player
 *    must confirm it.
 *  - SIMPLIFICATION: there are no extra bonuses for further Five of a Kind rolls and no
 *    "joker" rules. Five of a kind scores 0 as a Full House or a straight.
 *
 * Dice are rolled by the server only. Every roll is stored in the match (and in its
 * events), so retries return the same dice and replays show the actual rolls.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.fivefold = (function () {
  var UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
  var LOWER = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'fiveKind', 'chance'];
  var CATEGORIES = UPPER.concat(LOWER);
  var LABELS = { ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
    threeKind: 'Three of a Kind', fourKind: 'Four of a Kind', fullHouse: 'Full House', smallStraight: 'Small Straight',
    largeStraight: 'Large Straight', fiveKind: 'Five of a Kind', chance: 'Chance' };
  var BONUS = 35, BONUS_AT = 63, ROLLS = 3;

  function counts(d) { var n = [0, 0, 0, 0, 0, 0, 0]; d.forEach(function (x) { n[x]++; }); return n; }
  function sum(d) { return d.reduce(function (a, b) { return a + b; }, 0); }
  function run(d) {
    var have = counts(d), best = 0, cur = 0;
    for (var f = 1; f <= 6; f++) { cur = have[f] ? cur + 1 : 0; if (cur > best) best = cur; }
    return best;
  }

  /** Points the dice would score in a category (no bonuses). */
  function score(cat, d) {
    var n = counts(d), most = Math.max.apply(null, n);
    var i = UPPER.indexOf(cat);
    if (i >= 0) return n[i + 1] * (i + 1);
    switch (cat) {
      case 'threeKind': return most >= 3 ? sum(d) : 0;
      case 'fourKind': return most >= 4 ? sum(d) : 0;
      case 'fullHouse': return n.indexOf(3) >= 0 && n.indexOf(2) >= 0 ? 25 : 0;
      case 'smallStraight': return run(d) >= 4 ? 30 : 0;
      case 'largeStraight': return run(d) === 5 ? 40 : 0;
      case 'fiveKind': return most === 5 ? 50 : 0;
      case 'chance': return sum(d);
    }
    return 0;
  }

  function upperTotal(card) { return UPPER.reduce(function (a, c) { return a + (card[c] || 0); }, 0); }
  function totals(card) {
    var up = upperTotal(card), bonus = up >= BONUS_AT ? BONUS : 0;
    var low = LOWER.reduce(function (a, c) { return a + (card[c] || 0); }, 0);
    return { upper: up, bonus: bonus, lower: low, total: up + bonus + low };
  }

  function emptyCard() { var c = {}; CATEGORIES.forEach(function (k) { c[k] = null; }); return c; }

  function setup(players) {
    var cards = {};
    players.forEach(function (p) { cards[p] = emptyCard(); });
    return { players: players.slice(), cards: cards, turn: 0, round: 1, dice: null, held: [false, false, false, false, false],
      rollsLeft: ROLLS, status: 'active', winners: [], rolls: [], scored: [], adjustments: [] };
  }

  function die(rng) { return 1 + Math.floor(rng() * 6); }

  function roll(s, player, hold, rng) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (s.players[s.turn] !== player) return { ok: false, error: "It's not your turn." };
    if (s.rollsLeft <= 0) return { ok: false, error: 'No rolls left: choose a category to score.' };
    var h = [false, false, false, false, false];
    if (hold !== undefined && hold !== null) {
      if (!Array.isArray(hold) || hold.length !== 5 || hold.some(function (x) { return typeof x !== 'boolean'; })) {
        return { ok: false, error: 'Choose which dice to hold.' };
      }
      h = hold.slice();
    }
    if (!s.dice) {
      if (h.some(Boolean)) return { ok: false, error: 'Roll first; you can hold dice after the first roll.' };
    } else if (h.every(Boolean)) {
      return { ok: false, error: 'Release at least one die to roll again, or score now.' };
    }
    var dice = s.dice ? s.dice.slice() : [0, 0, 0, 0, 0];
    for (var i = 0; i < 5; i++) if (!h[i]) dice[i] = die(rng);
    s.dice = dice;
    s.held = h;
    s.rollsLeft--;
    var rec = { player: player, round: s.round, n: ROLLS - s.rollsLeft, dice: dice.slice(), held: h.slice() };
    s.rolls.push(rec);
    return { ok: true, roll: rec };
  }

  function take(s, player, cat, zeroOk) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (s.players[s.turn] !== player) return { ok: false, error: "It's not your turn." };
    if (!s.dice) return { ok: false, error: 'Roll the dice first.' };
    if (CATEGORIES.indexOf(cat) < 0) return { ok: false, error: 'Choose a category on your scorecard.' };
    var card = s.cards[player];
    if (card[cat] !== null) return { ok: false, error: LABELS[cat] + ' is already scored.' };
    var pts = score(cat, s.dice);
    if (pts === 0 && zeroOk !== true) return { ok: false, code: 'CONFIRM_ZERO', error: LABELS[cat] + ' would score 0. Confirm to take the zero.' };
    card[cat] = pts;
    var rec = { player: player, round: s.round, category: cat, points: pts, dice: s.dice.slice() };
    s.scored.push(rec);
    s.dice = null; s.held = [false, false, false, false, false]; s.rollsLeft = ROLLS;
    s.turn = (s.turn + 1) % s.players.length;
    if (s.turn === 0) s.round++;
    if (s.round > CATEGORIES.length) finish(s);
    return { ok: true, scored: rec };
  }

  function finish(s) {
    s.status = 'finished';
    s.adjustments = [];
    var best = -1;
    s.players.forEach(function (p) {
      var t = totals(s.cards[p]);
      if (t.bonus) s.adjustments.push({ player: p, points: t.bonus, reason: 'upper section ' + t.upper + ' (63 or more)' });
      if (t.total > best) best = t.total;
    });
    s.winners = s.players.filter(function (p) { return totals(s.cards[p]).total === best; });
  }

  return { UPPER: UPPER, LOWER: LOWER, CATEGORIES: CATEGORIES, LABELS: LABELS, BONUS: BONUS, BONUS_AT: BONUS_AT, ROLLS: ROLLS,
    score: score, totals: totals, setup: setup, roll: roll, take: take };
})();

GN.games.fivefold = (function () {
  var F = GN.fivefold;
  return {
    id: 'fivefold', name: 'Fivefold', version: '1.0.0', rulesVersion: 1, minutes: 30,
    description: 'Roll five dice up to three times a turn and fill a 13-line scorecard. Straights, full houses and five of a kind score big.',
    players: { min: 2, max: 4 },
    options: [],
    anytime: [],

    setup: function (ctx) { return F.setup(ctx.players); },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action, ctx) {
      var r, events;
      if (action.type === 'roll') {
        r = F.roll(s, player, action.hold, ctx.rng);
        if (!r.ok) return r;
        events = [{ type: 'roll', public: r.roll }];
        return { ok: true, state: s, events: events, response: { dice: r.roll.dice, held: r.roll.held, rollsLeft: s.rollsLeft } };
      }
      if (action.type === 'score') {
        r = F.take(s, player, action.category, action.zero);
        if (!r.ok) return r;
        events = [{ type: 'score', public: r.scored }];
        var out = { ok: true, state: s, events: events, response: { points: r.scored.points } };
        if (s.status === 'finished') {
          var scores = {};
          s.players.forEach(function (p) { scores[p] = F.totals(s.cards[p]).total; });
          out.result = { status: 'finished', winners: s.winners.slice(), scores: scores, adjustments: GN.util.clone(s.adjustments),
            reason: s.winners.length > 1 ? 'tied for the highest total' : 'highest total' };
          events.push({ type: 'end', public: { winners: out.result.winners, scores: scores, adjustments: s.adjustments } });
        }
        return out;
      }
      return { ok: false, error: 'Unknown move.' };
    },

    view: function (s) {
      var totals = {}, potential = null;
      s.players.forEach(function (p) { totals[p] = F.totals(s.cards[p]); });
      if (s.status === 'active' && s.dice) {
        potential = {};
        var card = s.cards[s.players[s.turn]];
        F.CATEGORIES.forEach(function (c) { if (card[c] === null) potential[c] = F.score(c, s.dice); });
      }
      return { players: s.players, cards: s.cards, totals: totals, turn: s.turn, current: s.status === 'active' ? s.players[s.turn] : null,
        round: Math.min(s.round, F.CATEGORIES.length), rounds: F.CATEGORIES.length, dice: s.dice, held: s.held, rollsLeft: s.rollsLeft,
        potential: potential, status: s.status, winners: s.winners, adjustments: s.status === 'active' ? [] : s.adjustments,
        lastRoll: s.rolls[s.rolls.length - 1] || null, lastScore: s.scored[s.scored.length - 1] || null };
    },

    summary: function (s, players) {
      return players.map(function (p) { return p.name + ' ' + F.totals(s.cards[p.id]).total; }).join(' · ') +
        (s.status === 'active' ? ' · round ' + s.round + ' of 13' : '');
    },
  };
})();
