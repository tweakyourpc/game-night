const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../support/load');
const GN = loadServer();

function game() { return GN.games.tictactoe; }
function ctx() { return { players: ['a', 'b'], options: { first: 'seat' }, rng: () => 0.9 }; }
function move(s, player, cell) { return game().apply(s, player, { type: 'mark', cell }); }

test('tictactoe rejects illegal moves and detects a horizontal win', () => {
  const s = game().setup(ctx());
  assert.equal(move(s, 'b', 0).ok, false);
  assert.equal(move(s, 'a', 0).ok, true);
  assert.equal(move(s, 'b', 0).ok, false);
  move(s, 'b', 3); move(s, 'a', 1); move(s, 'b', 4);
  const result = move(s, 'a', 2);
  assert.equal(result.ok, true);
  assert.deepEqual(s.line, [0, 1, 2]);
  assert.deepEqual(result.result.winners, ['a']);
});

test('tictactoe reports a draw when the board fills', () => {
  const s = game().setup(ctx());
  [[0, 'a'], [1, 'b'], [2, 'a'], [4, 'b'], [3, 'a'], [5, 'b'], [7, 'a'], [6, 'b'], [8, 'a']].forEach(([cell, player]) => move(s, player, cell));
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, null);
});
