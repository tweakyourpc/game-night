// Four in a Row: rules and platform integration.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { standardChecks } = require('../support/gamecheck.js');
const { world } = require('../support/world.js');
const F = GN.fourinarow;
const G = GN.games.fourinarow;

const fresh = () => F.setup(['a', 'b'], 0);
/** Play columns in order, alternating a, b, ... and return the last result. */
function play(s, cols) {
  let r;
  for (const c of cols) { r = F.drop(s, s.players[s.turn], c); assert.equal(r.ok, true, r.error + ' at column ' + c); }
  return r;
}

test('discs fall to the lowest empty space', () => {
  const s = fresh();
  assert.equal(F.drop(s, 'a', 3).row, 5);
  assert.equal(F.drop(s, 'b', 3).row, 4);
  assert.equal(F.drop(s, 'a', 0).row, 5);
  assert.equal(s.rows[5][3], 'a');
  assert.equal(s.rows[4][3], 'b');
});

test('a full column and columns off the grid are refused without changes', () => {
  const s = fresh();
  play(s, [0, 0, 0, 0, 0, 0]);
  const before = JSON.stringify(s);
  for (const c of [0, -1, 7, 1.5, '3', null, undefined, NaN]) {
    const r = F.drop(s, s.players[s.turn], c);
    assert.equal(r.ok, false, 'accepted ' + c);
  }
  assert.equal(JSON.stringify(s), before);
});

test('only the player to move may drop', () => {
  const s = fresh();
  assert.equal(F.drop(s, 'b', 0).ok, false);
  assert.equal(F.drop(s, 'x', 0).ok, false);
  assert.equal(F.drop(s, 'a', 0).ok, true);
});

test('four across wins', () => {
  const s = fresh();
  const r = play(s, [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, 'a');
  assert.deepEqual(r.line, [[5, 0], [5, 1], [5, 2], [5, 3]]);
});

test('four down wins', () => {
  const s = fresh();
  play(s, [6, 0, 6, 0, 6, 0, 6]);
  assert.equal(s.winner, 'a');
  assert.deepEqual(s.line, [[2, 6], [3, 6], [4, 6], [5, 6]]);
});

test('four on a rising diagonal wins', () => {
  const s = fresh();
  // a: (5,0) (4,1) (3,2) (2,3)
  play(s, [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
  assert.equal(s.winner, 'a');
  assert.equal(s.line.length, 4);
  const set = new Set(s.line.map((x) => x.join()));
  for (const k of ['5,0', '4,1', '3,2', '2,3']) assert.ok(set.has(k), k);
});

test('four on a falling diagonal wins', () => {
  const s = fresh();
  // mirror of the rising case: a at (5,6) (4,5) (3,4) (2,3)
  play(s, [6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
  assert.equal(s.winner, 'a');
  assert.equal(s.line.length, 4);
  const set = new Set(s.line.map((x) => x.join()));
  for (const k of ['5,6', '4,5', '3,4', '2,3']) assert.ok(set.has(k), k);
});

test('five in a line also wins, and the whole line is highlighted', () => {
  const s = fresh();
  // a fills (5,0),(5,1),(5,3),(5,4) then the gap (5,2)
  play(s, [0, 0, 1, 1, 3, 3, 4, 4, 2]);
  assert.equal(s.winner, 'a');
  assert.deepEqual(s.line, [[5, 0], [5, 1], [5, 2], [5, 3], [5, 4]]);
});

test('the second player can win too', () => {
  const s = fresh();
  play(s, [6, 0, 6, 1, 5, 2, 4, 3]);
  assert.equal(s.winner, 'b');
});

/** A full grid with no four: column pattern AABBAAB, flipped on alternate rows. */
function drawOrder() {
  const f = [0, 0, 1, 1, 0, 0, 1];
  const want = (r, c) => ((f[c] ^ ((5 - r) % 2)) === 0 ? 0 : 1);   // 0 = first player
  const height = Array(7).fill(0);
  const order = [];
  (function dfs(turn) {
    if (order.length === 42) return true;
    for (let c = 0; c < 7; c++) {
      if (height[c] === 6) continue;
      const r = 5 - height[c];
      if (want(r, c) !== turn) continue;
      height[c]++; order.push(c);
      if (dfs(1 - turn)) return true;
      height[c]--; order.pop();
    }
    return false;
  })(0);
  return order;
}

test('a full grid with no line is a draw', () => {
  const s = fresh();
  const order = drawOrder();
  assert.equal(order.length, 42);
  play(s, order);
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, null);
  assert.equal(s.line, null);
  assert.equal(F.drop(s, s.players[s.turn], 0).ok, false, 'no moves after the end');
});

test('the platform adapter: result, events and view', () => {
  const s = G.setup({ players: ['a', 'b'], options: { first: 'seat' }, rng: () => 0.9 });
  assert.deepEqual(G.actors(s), ['a']);
  let r;
  for (const c of [0, 0, 1, 1, 2, 2]) { r = G.apply(s, s.players[s.turn], { type: 'drop', col: c }, {}); assert.ok(r.ok); }
  r = G.apply(s, 'a', { type: 'drop', col: 3 }, {});
  assert.deepEqual(r.result.winners, ['a']);
  assert.deepEqual(r.events.map((e) => e.type), ['drop', 'end']);
  assert.deepEqual(G.actors(s), []);
  assert.equal(G.apply(s, 'b', { type: 'drop', col: 4 }, {}).ok, false);
  assert.deepEqual(G.view(s, null).line, [[5, 0], [5, 1], [5, 2], [5, 3]]);
  assert.equal(G.apply(s, 'a', { type: 'roll' }, {}).ok, false);
  // random first player comes from the server's random source
  assert.deepEqual(G.actors(G.setup({ players: ['a', 'b'], options: { first: 'random' }, rng: () => 0.7 })), ['b']);
});

standardChecks({
  game: 'fourinarow',
  legal: (w, matchId, token, view) => ({ type: 'drop', col: 3 }),
  finish: (w, matchId) => {
    for (const c of [0, 1, 0, 1, 0, 1, 0]) {
      const m = w.call('match', w.tokens.Ann, matchId).match;
      if (m.status !== 'active') break;
      const who = ['Ann', 'Bob'].find((n) => w.idOf(n) === m.actors[0]);
      const r = w.call('act', w.tokens[who], matchId, { type: 'drop', col: c }, w.req(m.rev));
      assert.equal(r.ok, true, r.error);
    }
  },
});

test('fourinarow: a draw through the platform records no winner and frees the table', () => {
  const w = world();
  w.join('Bob');
  const { table, match } = w.play('fourinarow', ['Ann', 'Bob']);
  for (const c of drawOrder()) {
    const m = w.call('match', w.tokens.Ann, match.id).match;
    const who = ['Ann', 'Bob'].find((n) => w.idOf(n) === m.actors[0]);
    assert.equal(w.call('act', w.tokens[who], match.id, { type: 'drop', col: c }, w.req(m.rev)).ok, true);
  }
  const m = w.call('match', w.tokens.Bob, match.id).match;
  assert.equal(m.status, 'finished');
  assert.deepEqual(m.result.winners, []);
  assert.equal(w.call('lobby', w.tokens.Ann).lobby.me.stats.wins, 0);
  assert.equal(w.call('table', w.tokens.Ann, table.id).table.status, 'open');
  const late = w.call('act', w.tokens.Ann, match.id, { type: 'drop', col: 0 }, w.req(m.rev));
  assert.equal(late.code, 'OVER');
});

test('fourinarow: a third player cannot sit', () => {
  const w = world();
  w.join('Bob'); w.join('Cy');
  let t = w.call('createTable', w.tokens.Ann, { gameId: 'fourinarow' }, w.aid()).table;
  t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
  const r = w.call('sit', w.tokens.Cy, t.id, w.req(t.rev));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'FULL');
});
