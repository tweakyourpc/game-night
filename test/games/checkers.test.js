// Checkers (American / English draughts): rules and platform integration.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { standardChecks } = require('../support/gamecheck.js');
const { world } = require('../support/world.js');
const K = GN.checkers;
const G = GN.games.checkers;

// 'a' plays Dark (seat 0, moves up, first); 'b' plays Light (seat 1, moves down)
const fresh = () => K.setup(['a', 'b'], 0);
/** A position from [row, col, 'd'|'D'|'l'|'L'] entries; turn: 0 dark, 1 light. */
function pos(pieces, turn = 0) {
  const s = fresh();
  s.rows = s.rows.map((row) => row.map(() => null));
  for (const [r, c, t] of pieces) s.rows[r][c] = { o: t.toLowerCase() === 'd' ? 0 : 1, k: t === 'D' || t === 'L' };
  s.turn = turn;
  s.seen = { [K.key(s)]: 1 };
  return s;
}
const mv = (s, who, from, to) => K.move(s, who, from, to);
const ok = (r) => assert.equal(r.ok, true, r.error);

test('the start: 12 pieces each on dark squares, Dark moves first with 7 moves', () => {
  const s = fresh();
  let dark = 0, light = 0;
  s.rows.forEach((row, r) => row.forEach((p, c) => {
    if (!p) return;
    assert.equal((r + c) % 2, 1, 'pieces only on dark squares');
    if (p.o === 0) { dark++; assert.ok(r >= 5); } else { light++; assert.ok(r <= 2); }
  }));
  assert.deepEqual([dark, light], [12, 12]);
  assert.equal(K.legal(s, 0).length, 7);
  assert.equal(mv(s, 'b', [2, 1], [3, 0]).ok, false, 'Light waits');
});

test('men move one square diagonally forward only', () => {
  const s = pos([[5, 2, 'd'], [0, 7, 'l']]);
  assert.deepEqual(K.legal(s, 0).map((m) => m.to).sort(), [[4, 1], [4, 3]]);
  assert.equal(mv(s, 'a', [5, 2], [6, 1]).ok, false, 'not backwards');
  assert.equal(mv(s, 'a', [5, 2], [3, 0]).ok, false, 'not two squares');
  assert.equal(mv(s, 'a', [5, 2], [4, 2]).ok, false, 'not straight');
  ok(mv(s, 'a', [5, 2], [4, 3]));
  // Light men move down
  assert.deepEqual(K.legal(s, 1).map((m) => m.to), [[1, 6]]);
});

test('kings move diagonally both ways, one square', () => {
  const s = pos([[4, 3, 'D'], [0, 7, 'l']]);
  assert.deepEqual(K.legal(s, 0).map((m) => m.to.join()).sort(), ['3,2', '3,4', '5,2', '5,4']);
  assert.equal(mv(s, 'a', [4, 3], [2, 1]).ok, false, 'no flying kings');
  ok(mv(s, 'a', [4, 3], [5, 4]));
});

test('a jump captures the piece jumped over', () => {
  const s = pos([[5, 2, 'd'], [4, 3, 'l'], [0, 7, 'l']]);
  const r = mv(s, 'a', [5, 2], [3, 4]);
  ok(r);
  assert.deepEqual(r.move.captured, { at: [4, 3], king: false });
  assert.equal(s.rows[4][3], null);
  assert.equal(K.count(s.rows, 1), 1);
  assert.equal(s.turn, 1);
});

test('men capture forward only; kings capture backwards too', () => {
  let s = pos([[3, 2, 'd'], [4, 3, 'l'], [0, 7, 'l']]);
  assert.equal(K.legal(s, 0).some((m) => m.capture), false, 'a man cannot capture backwards');
  s = pos([[3, 2, 'D'], [4, 3, 'l'], [0, 7, 'l']]);
  assert.deepEqual(K.legal(s, 0).map((m) => m.to), [[5, 4]]);
});

test('capturing is compulsory', () => {
  const s = pos([[5, 2, 'd'], [4, 3, 'l'], [6, 7, 'd'], [0, 7, 'l']]);
  const r = mv(s, 'a', [6, 7], [5, 6]);
  assert.equal(r.ok, false);
  assert.match(r.error, /must capture/);
  assert.equal(G.view(s).mustCapture, true);
  assert.deepEqual(G.view(s).legal.map((m) => m.from), [[5, 2]], 'only the capturing piece is offered');
  ok(mv(s, 'a', [5, 2], [3, 4]));
});

test('any capture may be chosen, not necessarily the longest', () => {
  // the piece at (5,0) has a double jump available; (6,7) has a single one
  const s = pos([[5, 0, 'd'], [4, 1, 'l'], [2, 3, 'l'], [6, 7, 'd'], [5, 6, 'l'], [0, 7, 'l']]);
  assert.equal(K.legal(s, 0).length, 2);
  const r = mv(s, 'a', [6, 7], [4, 5]);
  ok(r);
  assert.equal(r.move.continues, false);
  assert.equal(s.turn, 1);
});

test('a multi-jump continues with the same piece, and the turn stays', () => {
  const s = pos([[5, 0, 'd'], [4, 1, 'l'], [2, 3, 'l'], [6, 7, 'd'], [0, 7, 'l']]);
  let r = mv(s, 'a', [5, 0], [3, 2]);
  ok(r);
  assert.equal(r.move.continues, true);
  assert.deepEqual(s.continuing, [3, 2]);
  assert.equal(s.turn, 0);
  assert.deepEqual(G.actors(s), ['a']);
  assert.match(mv(s, 'a', [6, 7], [5, 6]).error, /same piece/);
  assert.equal(mv(s, 'a', [3, 2], [2, 1]).ok, false, 'no plain step mid-sequence');
  assert.equal(mv(s, 'b', [0, 7], [1, 6]).ok, false, 'Light still waits');
  r = mv(s, 'a', [3, 2], [1, 4]);
  ok(r);
  assert.equal(r.move.continues, false);
  assert.equal(s.continuing, null);
  assert.equal(s.turn, 1);
  assert.equal(K.count(s.rows, 1), 1);
});

test('crowning ends the turn, even when the new king could jump again', () => {
  const s = pos([[2, 1, 'd'], [1, 2, 'l'], [1, 4, 'l'], [7, 0, 'd']]);
  const r = mv(s, 'a', [2, 1], [0, 3]);
  ok(r);
  assert.equal(r.move.crowned, true);
  assert.equal(r.move.continues, false);
  assert.equal(s.rows[0][3].k, true);
  assert.equal(s.turn, 1, "Light's turn: no jump over (1,4) this turn");
  assert.equal(s.continuing, null);
});

test('a man reaching the far row by a step is crowned (both colours)', () => {
  const s = pos([[1, 2, 'd'], [6, 5, 'l']]);
  ok(mv(s, 'a', [1, 2], [0, 1]));
  assert.equal(s.rows[0][1].k, true);
  ok(mv(s, 'b', [6, 5], [7, 4]));
  assert.equal(s.rows[7][4].k, true);
});

test('taking the last piece wins', () => {
  const s = pos([[5, 2, 'd'], [4, 3, 'l']]);
  ok(mv(s, 'a', [5, 2], [3, 4]));
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, 'a');
  assert.equal(s.reason, 'no pieces left');
});

test('a player with no legal move loses', () => {
  // Light's only man (6,7) is blocked by Dark at (7,6) and cannot jump off the board
  const s = pos([[6, 7, 'l'], [7, 6, 'd'], [5, 0, 'd']]);
  ok(mv(s, 'a', [5, 0], [4, 1]));
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, 'a');
  assert.equal(s.reason, 'no legal moves');
});

test('either player may resign at any time', () => {
  const s = fresh();
  ok(K.resign(s, 'b'));                     // not Light's turn, still allowed
  assert.equal(s.winner, 'a');
  assert.equal(s.reason, 'resignation');
  assert.equal(K.resign(s, 'a').ok, false, 'already over');
  assert.equal(K.resign(fresh(), 'x').ok, false, 'not a player');
});

test('draws happen only by agreement; an offer lapses if the opponent moves instead', () => {
  let s = fresh();
  ok(K.offerDraw(s, 'a'));
  assert.equal(K.offerDraw(s, 'a').ok, false, 'one offer at a time');
  assert.equal(K.answerDraw(s, 'a', true).ok, false, 'cannot accept your own offer');
  ok(K.answerDraw(s, 'b', false));
  assert.equal(s.drawOffer, null);
  assert.equal(s.status, 'active');
  ok(K.offerDraw(s, 'a'));
  ok(K.withdrawDraw(s, 'a'));
  assert.equal(s.drawOffer, null);
  ok(K.offerDraw(s, 'a'));
  ok(mv(s, 'a', [5, 0], [4, 1]));           // offering with a move keeps the offer
  assert.equal(s.drawOffer, 'a');
  ok(mv(s, 'b', [2, 1], [3, 0]));           // answering by moving declines it
  assert.equal(s.drawOffer, null);
  s = fresh();
  ok(K.offerDraw(s, 'b'));
  ok(K.answerDraw(s, 'a', true));
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, null);
  assert.equal(s.reason, 'draw agreed');
});

test('platform rule: the third occurrence of a position with the same side to move is a draw', () => {
  const s = pos([[4, 1, 'D'], [0, 7, 'L']]);
  const cycle = () => {
    ok(mv(s, 'a', [4, 1], [3, 2])); ok(mv(s, 'b', [0, 7], [1, 6]));
    ok(mv(s, 'a', [3, 2], [4, 1])); ok(mv(s, 'b', [1, 6], [0, 7]));
  };
  cycle();
  assert.equal(s.status, 'active', 'second occurrence');
  cycle();
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, null);
  assert.match(s.reason, /three times \(platform rule\)/);
});

test('a capture or a man\'s move restarts the repetition count', () => {
  const s = pos([[4, 1, 'D'], [0, 7, 'L'], [6, 5, 'd']]);
  ok(mv(s, 'a', [4, 1], [3, 2])); ok(mv(s, 'b', [0, 7], [1, 6]));
  ok(mv(s, 'a', [3, 2], [4, 1])); ok(mv(s, 'b', [1, 6], [0, 7]));
  ok(mv(s, 'a', [6, 5], [5, 4]));            // irreversible
  ok(mv(s, 'b', [0, 7], [1, 6]));
  ok(mv(s, 'a', [4, 1], [3, 2])); ok(mv(s, 'b', [1, 6], [0, 7]));
  ok(mv(s, 'a', [3, 2], [4, 1])); ok(mv(s, 'b', [0, 7], [1, 6]));
  assert.equal(s.status, 'active');
});

test('malformed moves and other players\' pieces are refused without changes', () => {
  const s = fresh();
  const before = JSON.stringify(s);
  for (const [f, t] of [[[5, 0], [4, 1, 0]], [[5, 0], [8, 1]], [[-1, 0], [4, 1]], ['5,0', [4, 1]], [null, null], [[5.5, 0], [4, 1]],
    [[2, 1], [3, 0]], [[4, 1], [3, 0]], [[5, 0], [5, 0]]]) {
    assert.equal(mv(s, 'a', f, t).ok, false, JSON.stringify([f, t]));
  }
  assert.equal(mv(s, 'x', [5, 0], [4, 1]).ok, false);
  assert.equal(JSON.stringify(s), before);
});

test('the platform adapter: random Dark, anytime actions, results', () => {
  const s = G.setup({ players: ['a', 'b'], options: { dark: 'random' }, rng: () => 0.8 });
  assert.deepEqual(s.players, ['b', 'a'], 'b plays Dark');
  assert.deepEqual(G.actors(s), ['b']);
  assert.deepEqual(G.anytime.sort(), ['accept-draw', 'decline-draw', 'offer-draw', 'resign', 'withdraw-draw']);
  const r = G.apply(s, 'a', { type: 'resign' }, {});
  assert.deepEqual(r.result.winners, ['b']);
  assert.deepEqual(r.events.map((e) => e.type), ['resign', 'end']);
  const t = G.setup({ players: ['a', 'b'], options: { dark: 'seat' }, rng: () => 0.8 });
  assert.equal(G.apply(t, 'a', { type: 'fly' }, {}).ok, false);
  const d = G.apply(t, 'a', { type: 'offer-draw' }, {});
  assert.equal(d.result, undefined);
  const acc = G.apply(t, 'b', { type: 'accept-draw' }, {});
  assert.deepEqual(acc.result.winners, []);
  assert.equal(acc.result.reason, 'draw agreed');
});

standardChecks({
  game: 'checkers',
  legal: (w, matchId, token, view) => { const m = view.legal[0]; return { type: 'move', from: m.from, to: m.to }; },
  finish: (w, matchId) => {
    const m = w.call('match', w.tokens.Ann, matchId).match;
    const r = w.call('act', w.tokens.Bob, matchId, { type: 'resign' }, w.req(m.rev));
    assert.equal(r.ok, true, r.error);
  },
});

test('checkers: a double jump through the platform keeps the turn; the other player can resign or offer a draw meanwhile', () => {
  const w = world();
  w.join('Bob');
  const { match } = w.play('checkers', ['Ann', 'Bob']);
  // replace the position with a double-jump setup (Ann is Dark)
  const rec = w.deps.store.get('Matches', match.id);
  const ann = w.idOf('Ann'), bob = w.idOf('Bob');
  const empty = rec.state.rows.map((row) => row.map(() => null));
  empty[5][0] = { o: 0, k: false }; empty[4][1] = { o: 1, k: false }; empty[2][3] = { o: 1, k: false }; empty[0][7] = { o: 1, k: false };
  rec.state.rows = empty;
  rec.state.seen = {};
  w.deps.store.put('Matches', rec);
  let m = w.call('match', w.tokens.Ann, match.id).match;
  assert.equal(m.view.mustCapture, true);
  let r = w.call('act', w.tokens.Ann, match.id, { type: 'move', from: [5, 0], to: [3, 2] }, w.req(m.rev));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.match.actors, [ann]);
  assert.deepEqual(r.match.view.continuing, [3, 2]);
  assert.deepEqual(r.match.view.legal.map((x) => x.to), [[1, 4]]);
  const offer = w.call('act', w.tokens.Bob, match.id, { type: 'offer-draw' }, w.req(r.match.rev));
  assert.equal(offer.ok, true, 'anytime action while Ann is mid-sequence');
  m = offer.match;
  r = w.call('act', w.tokens.Ann, match.id, { type: 'move', from: [3, 2], to: [1, 4] }, w.req(m.rev));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.match.actors, [bob]);
  assert.equal(r.match.view.drawOffer, null, 'Ann moved instead of answering, so the offer lapsed');
  const events = w.deps.store.list('Events', { where: { match_id: match.id } }).map((e) => e.type);
  assert.deepEqual(events, ['start', 'move', 'offer-draw', 'move']);
});
