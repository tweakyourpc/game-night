// Fivefold (five-dice scorecard): rules and platform integration.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { standardChecks } = require('../support/gamecheck.js');
const { world } = require('../support/world.js');
const F = GN.fivefold;
const G = GN.games.fivefold;

/** An rng that produces the given faces in order (1-6). */
const faces = (...f) => { let i = 0; return () => (f[i++ % f.length] - 1) / 6 + 0.01; };
const ok = (r) => assert.equal(r.ok, true, r.error);

test('the 13 categories score as documented', () => {
  const S = (cat, d) => F.score(cat, d);
  assert.equal(S('ones', [1, 1, 2, 3, 1]), 3);
  assert.equal(S('sixes', [6, 6, 6, 2, 6]), 24);
  assert.equal(S('threes', [1, 2, 4, 5, 6]), 0);
  assert.equal(S('threeKind', [4, 4, 4, 2, 1]), 15);
  assert.equal(S('threeKind', [4, 4, 4, 4, 1]), 17, 'four of a kind also counts as three');
  assert.equal(S('threeKind', [4, 4, 3, 2, 1]), 0);
  assert.equal(S('fourKind', [2, 2, 2, 2, 6]), 14);
  assert.equal(S('fourKind', [5, 5, 5, 5, 5]), 25);
  assert.equal(S('fourKind', [5, 5, 5, 1, 1]), 0);
  assert.equal(S('fullHouse', [3, 3, 3, 6, 6]), 25);
  assert.equal(S('fullHouse', [3, 3, 6, 6, 1]), 0);
  assert.equal(S('fullHouse', [2, 2, 2, 2, 2]), 0, 'no joker: five of a kind is not a full house');
  assert.equal(S('smallStraight', [1, 2, 3, 4, 4]), 30);
  assert.equal(S('smallStraight', [6, 3, 5, 4, 1]), 30);
  assert.equal(S('smallStraight', [1, 2, 3, 5, 6]), 0);
  assert.equal(S('largeStraight', [2, 3, 4, 5, 6]), 40);
  assert.equal(S('largeStraight', [5, 1, 4, 2, 3]), 40);
  assert.equal(S('largeStraight', [1, 2, 3, 4, 6]), 0);
  assert.equal(S('smallStraight', [2, 3, 4, 5, 6]), 30, 'a large straight is also small');
  assert.equal(S('fiveKind', [6, 6, 6, 6, 6]), 50);
  assert.equal(S('fiveKind', [6, 6, 6, 6, 5]), 0);
  assert.equal(S('chance', [6, 5, 1, 1, 2]), 15);
  assert.equal(F.CATEGORIES.length, 13);
});

test('upper bonus: 35 at 63 or more, nothing at 62', () => {
  const card = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };      // three of each = 63
  assert.deepEqual(F.totals(card), { upper: 63, bonus: 35, lower: 0, total: 98 });
  assert.equal(F.totals(Object.assign({}, card, { ones: 2 })).bonus, 0);
  assert.equal(F.totals(Object.assign({}, card, { sixes: 30 })).bonus, 35);
});

test('three rolls per turn; holds only after the first roll; held dice keep their faces', () => {
  const s = F.setup(['a', 'b']);
  assert.equal(F.roll(s, 'a', [true, false, false, false, false], faces(1)).ok, false, 'no holds before the first roll');
  ok(F.roll(s, 'a', null, faces(1, 2, 3, 4, 5)));
  assert.deepEqual(s.dice, [1, 2, 3, 4, 5]);
  assert.equal(s.rollsLeft, 2);
  ok(F.roll(s, 'a', [true, true, false, false, true], faces(6, 6)));
  assert.deepEqual(s.dice, [1, 2, 6, 6, 5]);
  assert.deepEqual(s.held, [true, true, false, false, true]);
  assert.equal(F.roll(s, 'a', [true, true, true, true, true], faces(1)).ok, false, 'rolling nothing is refused');
  ok(F.roll(s, 'a', [false, false, true, true, false], faces(6, 6, 6)));
  assert.deepEqual(s.dice, [6, 6, 6, 6, 6]);
  assert.equal(s.rollsLeft, 0);
  const r = F.roll(s, 'a', null, faces(1));
  assert.equal(r.ok, false);
  assert.match(r.error, /No rolls left/);
  assert.equal(s.rolls.length, 3, 'every roll is recorded with its dice');
  assert.deepEqual(s.rolls.map((x) => x.n), [1, 2, 3]);
});

test('malformed holds are refused without changes', () => {
  const s = F.setup(['a', 'b']);
  ok(F.roll(s, 'a', null, faces(3)));
  const before = JSON.stringify(s);
  for (const h of [[true], 'true', [1, 0, 0, 0, 0], [true, false, false, false, false, false], {}, [null, false, false, false, false]]) {
    assert.equal(F.roll(s, 'a', h, faces(1)).ok, false, JSON.stringify(h));
  }
  assert.equal(JSON.stringify(s), before);
});

test('scoring needs a roll, an empty category, and confirmation for a zero', () => {
  const s = F.setup(['a', 'b']);
  assert.match(F.take(s, 'a', 'chance').error, /Roll the dice first/);
  ok(F.roll(s, 'a', null, faces(2, 2, 3, 3, 3)));
  assert.equal(F.take(s, 'a', 'jackpot').ok, false);
  const z = F.take(s, 'a', 'sixes');
  assert.equal(z.ok, false);
  assert.equal(z.code, 'CONFIRM_ZERO');
  assert.equal(s.cards.a.sixes, null, 'nothing scored without confirmation');
  const r = F.take(s, 'a', 'fullHouse');
  ok(r);
  assert.equal(r.scored.points, 25);
  assert.equal(s.dice, null);
  assert.equal(s.rollsLeft, 3);
  assert.equal(s.players[s.turn], 'b');
  ok(F.roll(s, 'b', null, faces(1, 1, 1, 1, 2)));
  ok(F.take(s, 'b', 'sixes', true));
  assert.equal(s.cards.b.sixes, 0, 'a confirmed zero');
  ok(F.roll(s, 'a', null, faces(2, 2, 3, 3, 3)));
  assert.match(F.take(s, 'a', 'fullHouse').error, /already scored/);
});

test('scoring after the first or second roll is allowed', () => {
  const s = F.setup(['a', 'b']);
  ok(F.roll(s, 'a', null, faces(6, 6, 6, 6, 6)));
  ok(F.take(s, 'a', 'fiveKind'));
  assert.equal(s.cards.a.fiveKind, 50);
  ok(F.roll(s, 'b', null, faces(1, 2, 3, 4, 1)));
  ok(F.roll(s, 'b', [true, true, true, true, false], faces(5)));
  ok(F.take(s, 'b', 'largeStraight'));
  assert.equal(s.cards.b.largeStraight, 40);
});

test('only the player to move may roll or score; turns rotate through four players', () => {
  const s = F.setup(['a', 'b', 'c', 'd']);
  assert.equal(F.roll(s, 'b', null, faces(1)).ok, false);
  const order = [];
  for (let i = 0; i < 8; i++) {
    const p = s.players[s.turn];
    order.push(p);
    ok(F.roll(s, p, null, faces(1, 2, 3, 4, 6)));
    ok(F.take(s, p, F.CATEGORIES[Math.floor(i / 4)], true));
  }
  assert.deepEqual(order, ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd']);
  assert.equal(s.round, 3);
});

function playOut(s, rng, pick) {
  while (s.status === 'active') {
    const p = s.players[s.turn];
    ok(F.roll(s, p, null, rng));
    const cat = pick ? pick(s, p) : F.CATEGORIES.find((c) => s.cards[p][c] === null);
    ok(F.take(s, p, cat, true));
  }
}

test('the game ends after 13 rounds, with explicit bonus adjustments and the highest total winning', () => {
  const s = F.setup(['a', 'b']);
  // everyone rolls 3,3,3,6,6 every turn: same cards, so a tie
  playOut(s, faces(3, 3, 3, 6, 6));
  assert.equal(s.status, 'finished');
  assert.equal(s.scored.length, 26);
  assert.deepEqual(s.winners, ['a', 'b'], 'equal totals tie');
  assert.equal(F.roll(s, 'a', null, faces(1)).ok, false);
  // a game with a clear winner and an upper bonus
  const t = F.setup(['a', 'b']);
  let turn = 0;
  const rng = () => 0.99;                                              // always sixes
  while (t.status === 'active') {
    const p = t.players[t.turn];
    ok(F.roll(t, p, null, p === 'a' ? rng : faces(1)));
    ok(F.take(t, p, F.CATEGORIES.find((c) => t.cards[p][c] === null), true));
    turn++;
  }
  assert.deepEqual(t.winners, ['a']);
  // a: Sixes 30, three/four of a kind 30 each, Five of a Kind 50, Chance 30; no straights or full house
  assert.deepEqual(F.totals(t.cards.a), { upper: 30, bonus: 0, lower: 140, total: 170 });
  assert.deepEqual(F.totals(t.cards.b), { upper: 5, bonus: 0, lower: 65, total: 70 });
  assert.deepEqual(t.adjustments, [], 'no bonus, no adjustments');
  assert.equal(turn, 26);
});

test('an upper bonus is recorded as an explicit adjustment at the end', () => {
  const s = F.setup(['a', 'b']);
  // a scores four of each face in the upper section (4+8+12+16+20+24 = 84)
  playOut(s, faces(1), (st, p) => {
    const free = F.CATEGORIES.filter((c) => st.cards[p][c] === null);
    if (p === 'a') {
      const up = F.UPPER.find((c) => st.cards[p][c] === null);
      if (up) { const face = F.UPPER.indexOf(up) + 1; st.dice = [face, face, face, face, 1]; return up; }
    }
    return free[0];
  });
  assert.equal(s.cards.a.sixes, 24);
  // ones scored 5 (all five dice were ones), then 8 + 12 + 16 + 20 + 24
  assert.deepEqual(s.adjustments, [{ player: 'a', points: 35, reason: 'upper section 85 (63 or more)' }]);
  assert.equal(F.totals(s.cards.a).bonus, 35);
  assert.equal(F.totals(s.cards.b).bonus, 0);
});

test('the platform adapter: potential scores are shown but not committed; dice cannot be sent by the client', () => {
  const s = G.setup({ players: ['a', 'b'], options: {} });
  let r = G.apply(s, 'a', { type: 'roll', dice: [6, 6, 6, 6, 6] }, { rng: faces(1, 1, 2, 2, 2) });
  ok(r);
  assert.deepEqual(r.response.dice, [1, 1, 2, 2, 2], 'client-sent dice are ignored');
  const v = G.view(s);
  assert.equal(v.potential.fullHouse, 25);
  assert.equal(v.potential.twos, 6);
  assert.equal(v.cards.a.fullHouse, null);
  assert.equal(G.apply(s, 'a', { type: 'score', category: 'fives' }, {}).code, 'CONFIRM_ZERO');
  r = G.apply(s, 'a', { type: 'score', category: 'fullHouse' }, {});
  assert.deepEqual(r.response, { points: 25 });
  assert.equal(G.view(s).potential, null);
  assert.equal(G.apply(s, 'b', { type: 'hold' }, {}).ok, false);
});

function nextScore(view) {
  const card = view.cards[view.current];
  return { type: 'score', category: Object.keys(card).find((c) => card[c] === null), zero: true };
}

standardChecks({
  game: 'fivefold',
  legal: () => ({ type: 'roll' }),
  finish: (w, matchId) => {
    for (;;) {
      let m = w.call('match', w.tokens.Ann, matchId).match;
      if (m.status !== 'active') return;
      const who = ['Ann', 'Bob'].find((n) => w.idOf(n) === m.actors[0]);
      if (!m.view.dice) { m = w.call('act', w.tokens[who], matchId, { type: 'roll' }, w.req(m.rev)).match; }
      const r = w.call('act', w.tokens[who], matchId, nextScore(m.view), w.req(m.rev));
      assert.equal(r.ok, true, r.error);
    }
  },
});

test('fivefold: a retried roll returns the same dice; reload restores dice, holds and rolls left; replay has every roll', () => {
  const w = world();
  w.join('Bob');
  const { match } = w.play('fivefold', ['Ann', 'Bob']);
  let m = w.call('match', w.tokens.Ann, match.id).match;
  const req = w.req(m.rev);
  const a = w.call('act', w.tokens.Ann, match.id, { type: 'roll' }, req);
  ok(a);
  const b = w.call('act', w.tokens.Ann, match.id, { type: 'roll' }, req);
  assert.equal(b.duplicate, true);
  assert.deepEqual(b.response.dice, a.response.dice, 'the retry did not roll again');
  assert.equal(b.match.rev, a.match.rev);
  const hold = [true, false, true, false, false];
  const c = w.call('act', w.tokens.Ann, match.id, { type: 'roll', hold }, w.req(a.match.rev));
  ok(c);
  [0, 2].forEach((i) => assert.equal(c.response.dice[i], a.response.dice[i], 'held die kept'));
  // a fresh sign-in (another device, or after a reload) sees exactly this
  const again = GN.identity.join('maple owl', { memberId: w.idOf('Ann'), pin: '1234' }, 'reload');
  m = w.call('match', again.token, match.id).match;
  assert.deepEqual(m.view.dice, c.response.dice);
  assert.deepEqual(m.view.held, hold);
  assert.equal(m.view.rollsLeft, 1);
  assert.ok(m.view.potential);
  // Bob cannot roll on Ann's turn, and a stale roll is refused
  assert.equal(w.call('act', w.tokens.Bob, match.id, { type: 'roll' }, w.req(m.rev)).ok, false);
  assert.equal(w.call('act', w.tokens.Ann, match.id, { type: 'roll' }, w.req(a.match.rev)).code, 'STALE');
  const s = w.call('act', w.tokens.Ann, match.id, { type: 'score', category: 'chance' }, w.req(m.rev));
  ok(s);
  const rp = w.call('replay', w.tokens.Bob, match.id).replay;
  const rolls = rp.events.filter((e) => e.type === 'roll').map((e) => e.public.dice);
  assert.deepEqual(rolls, [a.response.dice, c.response.dice], 'replay holds the actual dice');
  assert.equal(rp.events.find((e) => e.type === 'score').public.points, c.response.dice.reduce((x, y) => x + y, 0));
});

test('fivefold: the display name comes from configuration', () => {
  const w = world();
  const g = w.call('lobby', w.tokens.Ann).lobby.catalog.find((x) => x.id === 'fivefold');
  assert.equal(g.name, GN.NAMES.games.fivefold);
  const saved = GN.NAMES.games.fivefold;
  GN.NAMES.games.fivefold = 'Dice Night';
  try {
    assert.equal(w.call('lobby', w.tokens.Ann).lobby.catalog.find((x) => x.id === 'fivefold').name, 'Dice Night');
  } finally { GN.NAMES.games.fivefold = saved; }
});
