// Wordwright rules, ported from the original rule tests (same cases, same numbers).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../support/load.js');
loadServer();
const R = GN.wordwright;

const row = (r, c0, word, opts = {}) =>
  [...word].map((l, i) => ({ r, c: c0 + i, l, b: (opts.blanks || []).includes(i) }));
const col = (r0, c, word) => [...word].map((l, i) => ({ r: r0 + i, c, l }));
const place = (board, ps) => ps.forEach((p) => (board[p.r][p.c] = { l: p.l, b: !!p.b }));
const dict = new Set(['CAT', 'CATS', 'AT', 'TA', 'RETAINS', 'AX', 'XI', 'TAX']);
const seq = (n) => { let i = 0; return () => ((i++ * 0.6180339) % 1); }; // deterministic rng

test('bag has the standard distribution: 100 tiles, 2 blanks', () => {
  const bag = R.newBag(seq());
  assert.equal(bag.length, 100);
  assert.equal(bag.filter((l) => l === '?').length, 2);
  assert.equal(bag.filter((l) => l === 'E').length, 12);
});

test('premium map: the standard layout', () => {
  assert.equal(R.PREMIUM[0][0], 'TW');
  assert.equal(R.PREMIUM[7][7], 'DW');
  assert.equal(R.PREMIUM[0][3], 'DL');
  assert.equal(R.PREMIUM[1][5], 'TL');
  assert.equal(R.PREMIUM[14][11], 'DL');
  assert.equal(R.PREMIUM[13][13], 'DW');
  const count = (k) => R.PREMIUM.flat().filter((x) => x === k).length;
  assert.deepEqual([count('TW'), count('DW'), count('TL'), count('DL')], [8, 17, 12, 24]);
});

test('first move on the star doubles', () => {
  const res = R.evaluateMove(R.emptyBoard(), [...'CATXYZQ'], row(7, 6, 'CAT'), dict);
  assert.ok(res.ok, res.error);
  assert.equal(res.score, 10); // (3+1+1) x2
});

test('premiums only count under new tiles', () => {
  const b = R.emptyBoard();
  place(b, row(7, 6, 'CAT'));
  const res = R.evaluateMove(b, [...'SABCDEF'], [{ r: 7, c: 9, l: 'S' }], dict);
  assert.ok(res.ok, res.error);
  assert.deepEqual(res.words, [{ word: 'CATS', score: 6 }]);
});

test('letter premium and cross-words', () => {
  const b = R.emptyBoard();
  place(b, row(7, 6, 'CAT'));
  // X on (8,8) is a double letter; it forms TX downwards (no dictionary here)
  const res = R.evaluateMove(b, [...'XABCDEF'], [{ r: 8, c: 8, l: 'X' }], null);
  assert.ok(res.ok, res.error);
  assert.equal(res.score, 1 + 16);
  // T,A,X across row 8 under C,A,T: main word TAX plus cross-words CT, AA, TX
  const res2 = R.evaluateMove(b, [...'TAXBCDE'], row(8, 6, 'TAX'), null);
  assert.ok(res2.ok, res2.error);
  assert.deepEqual(res2.words.map((w) => w.word), ['TAX', 'CT', 'AA', 'TX']);
});

test('seven tiles earn the 50 point bingo', () => {
  const res = R.evaluateMove(R.emptyBoard(), [...'RETAINS'], row(7, 3, 'RETAINS'), dict);
  assert.ok(res.ok, res.error);
  assert.equal(res.bingo, true);
  assert.equal(res.score, (2 + 6) * 2 + 50); // R on a double letter, star doubles
});

test('blanks score zero and come from the "?" on the rack', () => {
  const res = R.evaluateMove(R.emptyBoard(), [...'C?TXYZQ'], row(7, 6, 'CAT', { blanks: [1] }), dict);
  assert.ok(res.ok, res.error);
  assert.equal(res.score, 8); // (3+0+1) x2
  const nope = R.evaluateMove(R.emptyBoard(), [...'CXTXYZQ'], row(7, 6, 'CAT', { blanks: [1] }), dict);
  assert.equal(nope.ok, false);
});

test('illegal placements are rejected with a reason', () => {
  const e = R.emptyBoard();
  const rack = [...'CATSXYZ'];
  const bad = (board, ps, re) => {
    const res = R.evaluateMove(board, rack, ps, dict);
    assert.equal(res.ok, false);
    assert.match(res.error, re);
  };
  bad(e, row(0, 0, 'CAT'), /centre star/);
  bad(e, [{ r: 7, c: 7, l: 'C' }], /two letters/);
  bad(e, [{ r: 7, c: 6, l: 'C' }, { r: 7, c: 8, l: 'T' }], /centre star|gap/);
  bad(e, [{ r: 7, c: 6, l: 'C' }, { r: 8, c: 7, l: 'A' }], /one row or one column/);
  bad(e, row(7, 6, 'QAT'), /not on your rack/);
  const b = R.emptyBoard();
  place(b, row(7, 6, 'CAT'));
  bad(b, row(0, 0, 'AT'), /connect/);
  bad(b, [{ r: 7, c: 7, l: 'A' }], /taken/);
  bad(b, row(8, 6, 'TS'), /dictionary: TS/); // TS, CT, AS are not words
  bad(b, [{ r: 6, c: 6, l: 'S' }, { r: 6, c: 8, l: 'T' }], /gap/);
});

test('a full turn: play, refill rack, next player', () => {
  const s = R.newGameState(['me', 'mom'], seq());
  s.racks.me = [...'CATXYZQ'];
  const res = R.playMove(s, 'me', row(7, 6, 'CAT'), dict);
  assert.ok(res.ok, res.error);
  assert.equal(s.scores.me, 10);
  assert.equal(s.racks.me.length, 7);
  assert.equal(s.bag.length, 100 - 14 - 3);
  assert.equal(R.playMove(s, 'me', row(8, 6, 'AT'), dict).error, "It's not your turn.");
  assert.equal(s.turn, 1);
});

test('exchange returns tiles to the bag and keeps the rack at 7', () => {
  const s = R.newGameState(['me', 'mom'], seq());
  const all = () => [...s.bag, ...s.racks.me, ...s.racks.mom].sort().join('');
  const before = all();
  const give = s.racks.me.slice(0, 3);
  assert.ok(R.exchangeTiles(s, 'me', give, seq()).ok);
  assert.equal(s.racks.me.length, 7);
  assert.equal(s.bag.length, 86);
  assert.equal(all(), before); // no tile created or lost
  assert.equal(s.turn, 1);
  assert.equal(R.exchangeTiles(s, 'mom', ['Q', 'Q', 'Q'], seq()).ok, false);
});

test('going out: unplayed tiles move from the loser to the winner', () => {
  const s = R.newGameState(['me', 'mom'], seq());
  s.bag = [];
  s.racks.me = [...'CAT'];
  s.racks.mom = [...'QZ'];
  const res = R.playMove(s, 'me', row(7, 6, 'CAT'), dict);
  assert.ok(res.ok, res.error);
  assert.equal(s.status, 'finished');
  assert.equal(s.scores.me, 10 + 20);
  assert.equal(s.scores.mom, -20);
  assert.equal(s.winner, 'me');
});

test('six scoreless turns end the game', () => {
  const s = R.newGameState(['me', 'mom'], seq());
  for (let i = 0; i < 6; i++) assert.ok(R.passTurn(s, s.players[s.turn]).ok);
  assert.equal(s.status, 'finished');
  assert.equal(R.passTurn(s, 'me').ok, false);
});

test('public view hides the bag order and the other rack', () => {
  const s = R.newGameState(['me', 'mom'], seq());
  const v = R.publicView(s, 'mom');
  assert.deepEqual(v.myRack, s.racks.mom);
  assert.equal(v.bagCount, 86);
  const text = JSON.stringify(v);
  assert.ok(!('bag' in v) && !('racks' in v));
  assert.ok(!text.includes(JSON.stringify(s.racks.me)) || s.racks.me.join() === s.racks.mom.join());
});

// ---- correctness cases
// blanks, cross-words, stacked multipliers, endgame deductions, exhausted bags.

const across = (r, c0, word, blanks = []) => [...word].map((l, i) => ({ r, c: c0 + i, l, b: blanks.includes(i) }));
const keep = () => 0.999999; // Fisher-Yates with this rng leaves the order unchanged
const clone = (x) => JSON.parse(JSON.stringify(x));

function game(players = ['a', 'b']) {
  const s = R.newGameState(players, keep);
  return s;
}

test('exchange returns the tiles and mixes the bag before drawing', () => {
  const s = game();
  s.bag = Array(10).fill('E');
  s.racks.a = [...'QABCDEF'];
  // with an order-keeping shuffle the returned Q sits on top of the bag, so drawing
  // after returning gives it straight back; the old order (draw first) would give an E
  assert.ok(R.exchangeTiles(s, 'a', ['Q'], keep).ok);
  assert.ok(s.racks.a.includes('Q'));
  assert.equal(s.racks.a.length, 7);
  assert.equal(s.bag.length, 10);
});

test('a valid zero-point play counts as a scoreless turn', () => {
  const s = game();
  s.racks.a = [...'??BCDEF'];
  const res = R.playMove(s, 'a', across(7, 7, 'AT', [0, 1]), new Set(['AT']));
  assert.ok(res.ok, res.error);
  assert.equal(res.score, 0);
  assert.equal(s.scoreless, 1);
  for (let i = 0; i < 4; i++) R.passTurn(s, s.players[s.turn]);
  assert.equal(s.status, 'active');
  R.passTurn(s, s.players[s.turn]); // sixth scoreless turn in a row
  assert.equal(s.status, 'finished');
});

test('a scoring play resets the scoreless count', () => {
  const s = game();
  s.racks.a = [...'ATBCDEF'];
  R.passTurn(s, 'a');
  R.passTurn(s, 'b');
  s.racks.a = [...'ATBCDEF'];
  assert.ok(R.playMove(s, 'a', across(7, 7, 'AT'), new Set(['AT'])).ok);
  assert.equal(s.scoreless, 0);
});

test('malformed placements are rejected without exceptions or changes', () => {
  const bad = [
    null, undefined, 'AT', 42, {}, { length: 2 }, [null], [undefined], [[7, 7, 'A']],
    [{ r: 7.5, c: 7, l: 'A' }], [{ r: '7', c: 7, l: 'A' }], [{ r: 7, c: '7', l: 'A' }],
    [{ r: NaN, c: 7, l: 'A' }], [{ r: Infinity, c: 7, l: 'A' }], [{ r: -1, c: 7, l: 'A' }],
    [{ r: 15, c: 7, l: 'A' }], [{ r: 7, c: 7, l: 'AB' }], [{ r: 7, c: 7, l: 'a' }],
    [{ r: 7, c: 7, l: {} }], [{ r: 7, c: 7, l: 'A', b: 'false' }], [{ r: 7, c: 7, l: 'A', b: 1 }],
    across(7, 4, 'ABCDEFGH'), [{ r: 7, c: 7, l: 'A', __proto__: { r: 1 } }].slice(0, 0),
  ];
  for (const ps of bad) {
    const s = game();
    s.racks.a = [...'ABCDEFG'];
    const before = clone(s);
    let res;
    assert.doesNotThrow(() => { res = R.playMove(s, 'a', ps, null); }, 'playMove threw on ' + JSON.stringify(ps));
    assert.equal(res.ok, false, 'accepted ' + JSON.stringify(ps));
    assert.deepEqual(clone(s), before, 'state changed for ' + JSON.stringify(ps));
    assert.doesNotThrow(() => R.evaluateMove(s.board, s.racks.a, ps, null));
  }
});

test('extra properties on a placement are dropped', () => {
  const s = game();
  s.racks.a = [...'ATBCDEF'];
  const ps = across(7, 7, 'AT').map((p) => ({ ...p, evil: '<script>', score: 999 }));
  assert.ok(R.playMove(s, 'a', ps, new Set(['AT'])).ok);
  assert.deepEqual(s.board[7][7], { l: 'A', b: false });
  assert.deepEqual(Object.keys(s.moves[0].tiles[0]).sort(), ['b', 'c', 'l', 'r']);
});

test('malformed exchange requests are rejected without exceptions or changes', () => {
  for (const letters of [null, undefined, 'QQ', 7, {}, [1], ['AB'], ['a'], [{}], [...'ABCDEFGH'], []]) {
    const s = game();
    const before = clone(s);
    let res;
    assert.doesNotThrow(() => { res = R.exchangeTiles(s, 'a', letters, keep); });
    assert.equal(res.ok, false, 'accepted ' + JSON.stringify(letters));
    assert.deepEqual(clone(s), before);
  }
});

test('blanks: zero points even on premium squares, but word multipliers still apply', () => {
  const b = R.emptyBoard();
  // blank as A on the centre star (double word), T next to it: (0 + 1) x 2
  const res = R.evaluateMove(b, [...'?TXXXXX'], across(7, 7, 'AT', [0]), null);
  assert.ok(res.ok, res.error);
  assert.equal(res.score, 2);
});

test('a new tile on a premium square counts in both of its words', () => {
  const b = R.emptyBoard();
  place(b, [{ r: 4, c: 5, l: 'A' }, { r: 4, c: 6, l: 'T' }, { r: 5, c: 4, l: 'O' }]);
  const res = R.evaluateMove(b, [...'CXXXXXX'], [{ r: 4, c: 4, l: 'C' }], null); // (4,4) is double word
  assert.ok(res.ok, res.error);
  assert.deepEqual(res.words, [{ word: 'CAT', score: 10 }, { word: 'CO', score: 8 }]);
  assert.equal(res.score, 18);
});

test('two double-word squares in one word multiply by four', () => {
  const b = R.emptyBoard();
  place(b, [{ r: 5, c: 7, l: 'A' }]);
  // row 4, columns 4..10: double word at both ends, D on (4,7) also makes DA downwards
  const res = R.evaluateMove(b, [...'ABCDEFG'], across(4, 4, 'ABCDEFG'), null);
  assert.ok(res.ok, res.error);
  assert.deepEqual(res.words, [{ word: 'ABCDEFG', score: 16 * 4 }, { word: 'DA', score: 3 }]);
  assert.equal(res.score, 64 + 3 + 50);
});

test('two triple-word squares in one word multiply by nine', () => {
  const b = R.emptyBoard();
  place(b, [{ r: 0, c: 4, l: 'A' }]);
  const ps = [0, 1, 2, 3, 5, 6, 7].map((c, i) => ({ r: 0, c, l: 'BCDEFGH'[i] }));
  const res = R.evaluateMove(b, [...'BCDEFGH'], ps, null);
  assert.ok(res.ok, res.error);
  // B3 C3 D2 E1x2 (double letter on (0,3)) A1 F4 G2 H4 = 21, x9, + 50
  assert.equal(res.score, 21 * 9 + 50);
});

test('going out with three players collects everyone else\'s leftovers', () => {
  const s = game(['a', 'b', 'c']);
  s.bag = [];
  s.racks = { a: [...'AT'], b: ['Q'], c: [...'ZE'] };
  assert.ok(R.playMove(s, 'a', across(7, 7, 'AT'), new Set(['AT'])).ok);
  assert.equal(s.status, 'finished');
  assert.equal(s.scores.a, 4 + 10 + 11);
  assert.equal(s.scores.b, -10);
  assert.equal(s.scores.c, -11);
  assert.equal(s.winner, 'a');
});

test('nearly empty bag: rack is not fully refilled, exchange is refused, passing works', () => {
  const s = game();
  s.bag = ['E'];
  s.racks.a = [...'CATXYZQ'];
  assert.ok(R.playMove(s, 'a', across(7, 6, 'CAT'), new Set(['CAT'])).ok);
  assert.equal(s.racks.a.length, 5);
  assert.equal(s.bag.length, 0);
  assert.equal(R.exchangeTiles(s, 'b', [s.racks.b[0]], keep).ok, false);
  assert.ok(R.passTurn(s, 'b').ok);
  assert.equal(s.status, 'active');
});

test('every tile is accounted for through a long random game', () => {
  const s = R.newGameState(['a', 'b'], Math.random);
  const total = () => s.bag.length + s.racks.a.length + s.racks.b.length + s.board.flat().filter(Boolean).length;
  assert.equal(total(), 100);
  for (let i = 0; i < 5; i++) {
    const p = s.players[s.turn];
    R.exchangeTiles(s, p, s.racks[p].slice(0, 3), Math.random);
    assert.equal(total(), 100);
  }
});
