// Dots and Boxes: rules and platform integration.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { standardChecks } = require('../support/gamecheck.js');
const { world } = require('../support/world.js');
const D = GN.dots;
const G = GN.games.dots;

const H = (r, c) => ({ o: 'h', r, c });
const V = (r, c) => ({ o: 'v', r, c });
const mover = (s) => s.players[s.turn];
function allEdges(s) {
  const out = [];
  for (let r = 0; r <= s.rows; r++) for (let c = 0; c < s.cols; c++) out.push(H(r, c));
  for (let r = 0; r < s.rows; r++) for (let c = 0; c <= s.cols; c++) out.push(V(r, c));
  return out;
}
const drawn = (s, e) => (e.o === 'h' ? s.h : s.v)[e.r][e.c];

test('grid sizes are labelled by box count; medium is the default', () => {
  const opt = G.options[0];
  assert.equal(opt.default, 'medium');
  assert.deepEqual(opt.choices.map((c) => c.label), ['Small: 9 boxes (3 × 3)', 'Medium: 16 boxes (4 × 4)', 'Large: 36 boxes (6 × 6)']);
  const s = D.setup(['a', 'b'], 'large');
  assert.equal(s.left, 36);
  assert.equal(allEdges(s).length, 2 * 6 * 7);
  assert.equal(D.setup(['a', 'b'], 'nonsense').size, 'medium');
});

test('a line that closes nothing passes the turn', () => {
  const s = D.setup(['a', 'b'], 'small');
  const r = D.draw(s, 'a', H(0, 0));
  assert.equal(r.ok, true);
  assert.equal(r.again, false);
  assert.equal(mover(s), 'b');
});

test('the same line cannot be drawn twice', () => {
  const s = D.setup(['a', 'b'], 'small');
  D.draw(s, 'a', H(0, 0));
  const before = JSON.stringify(s);
  const r = D.draw(s, 'b', H(0, 0));
  assert.equal(r.ok, false);
  assert.match(r.error, /already drawn/);
  assert.equal(JSON.stringify(s), before);
});

test('lines outside the grid or malformed are refused without changes', () => {
  const s = D.setup(['a', 'b'], 'small');                   // 3 x 3 boxes
  const before = JSON.stringify(s);
  const bad = [H(4, 0), H(0, 3), H(-1, 0), V(3, 0), V(0, 4), V(0, -1), { o: 'd', r: 0, c: 0 }, { o: 'h', r: '0', c: 0 },
    { o: 'h', r: 0.5, c: 0 }, null, undefined, [], 'h00', { o: 'h', r: 0 }, { o: 'v', r: NaN, c: 0 }];
  for (const e of bad) assert.equal(D.draw(s, 'a', e).ok, false, 'accepted ' + JSON.stringify(e));
  assert.equal(JSON.stringify(s), before);
  // the outermost legal lines are fine
  for (const e of [H(3, 2), V(2, 3), H(0, 2), V(0, 0)]) assert.equal(D.cleanEdge(s, e) !== null, true, JSON.stringify(e));
});

test('closing a box claims it and the same player draws again', () => {
  const s = D.setup(['a', 'b'], 'small');
  D.draw(s, 'a', H(0, 0)); D.draw(s, 'b', V(0, 0)); D.draw(s, 'a', V(0, 1));
  assert.equal(mover(s), 'b');
  const r = D.draw(s, 'b', H(1, 0));
  assert.deepEqual(r.boxes, [[0, 0]]);
  assert.equal(r.again, true);
  assert.equal(s.boxes[0][0], 'b');
  assert.equal(s.scores.b, 1);
  assert.equal(mover(s), 'b', 'extra turn');
  assert.equal(D.draw(s, 'a', H(3, 0)).ok, false, 'not a\'s turn');
});

test('one line can close two boxes at once, still one extra turn', () => {
  const s = D.setup(['a', 'b'], 'small');
  // boxes (0,0) and (0,1) need only their shared side V(0,1)
  for (const e of [H(0, 0), H(1, 0), V(0, 0), H(0, 1), H(1, 1), V(0, 2)]) D.draw(s, mover(s), e);
  const who = mover(s);
  const r = D.draw(s, who, V(0, 1));
  assert.deepEqual(r.boxes, [[0, 0], [0, 1]]);
  assert.equal(s.scores[who], 2);
  assert.equal(mover(s), who);
  assert.equal(s.left, 7);
});

test('turns rotate through three and four players in seat order', () => {
  for (const players of [['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
    const s = D.setup(players, 'large');
    const order = [];
    for (const e of [H(0, 0), H(0, 2), H(0, 4), H(6, 0), H(6, 2), H(6, 4), H(3, 0), H(3, 2)]) {
      order.push(mover(s));
      assert.equal(D.draw(s, mover(s), e).again, false);
    }
    assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7].map((i) => players[i % players.length]));
  }
});

test('the game ends when every box is claimed', () => {
  const s = D.setup(['a', 'b'], 'small');
  let n = 0;
  for (const e of allEdges(s)) { assert.equal(D.draw(s, mover(s), e).ok, true); n++; }
  assert.equal(n, 24);
  assert.equal(s.status, 'finished');
  assert.equal(s.left, 0);
  assert.equal(s.scores.a + s.scores.b, 9);
  assert.equal(s.winners.length, 1);
  assert.equal(s.scores[s.winners[0]], Math.max(s.scores.a, s.scores.b));
  assert.equal(D.draw(s, mover(s), H(0, 0)).ok, false);
});

/** Everything drawn and claimed except box (R-1, C-1), whose bottom side is missing. */
function nearlyDone(players, size, owners) {
  const s = D.setup(players, size);
  for (const e of allEdges(s)) if (!(e.o === 'h' && e.r === s.rows && e.c === s.cols - 1)) (e.o === 'h' ? s.h : s.v)[e.r][e.c] = players[0];
  let k = 0;
  for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
    if (r === s.rows - 1 && c === s.cols - 1) continue;
    s.boxes[r][c] = owners[k++];
    s.scores[s.boxes[r][c]]++;
  }
  s.left = 1;
  return s;
}

test('ties: equal top counts share the win (two and three players)', () => {
  // 3 players on 9 boxes: a 3, b 3, c 2 before c takes the last box
  let s = nearlyDone(['a', 'b', 'c'], 'small', ['a', 'a', 'a', 'b', 'b', 'b', 'c', 'c']);
  s.turn = 2;
  const r = D.draw(s, 'c', H(3, 2));
  assert.deepEqual(r.boxes, [[2, 2]]);
  assert.equal(s.status, 'finished');
  assert.deepEqual(s.winners, ['a', 'b', 'c']);
  // 2 players on 16 boxes: 8 each
  s = nearlyDone(['a', 'b'], 'medium', [...'aaaaaaaabbbbbbb']);
  s.turn = 1;
  D.draw(s, 'b', H(4, 3));
  assert.deepEqual(s.winners, ['a', 'b']);
  // and a clear winner when the last box breaks the tie
  s = nearlyDone(['a', 'b'], 'medium', [...'aaaaaaaabbbbbbb']);
  s.turn = 0;
  D.draw(s, 'a', H(4, 3));
  assert.deepEqual(s.winners, ['a']);
});

test('the platform adapter keeps the turn after a box and reports ties', () => {
  const s = G.setup({ players: ['a', 'b'], options: { size: 'small' } });
  for (const e of [H(0, 0), V(0, 0), V(0, 1)]) assert.ok(G.apply(s, G.actors(s)[0], { type: 'line', edge: e }, {}).ok);
  const r = G.apply(s, 'b', { type: 'line', edge: H(1, 0) }, {});
  assert.deepEqual(r.response, { boxes: 1, again: true });
  assert.deepEqual(r.events[0].public.boxes, [[0, 0]]);
  assert.deepEqual(G.actors(s), ['b']);
  assert.equal(G.apply(s, 'b', { type: 'line', edge: H(1, 0) }, {}).ok, false);
  assert.equal(G.apply(s, 'b', { type: 'drop', col: 1 }, {}).ok, false);
  const t = nearlyDone(['a', 'b'], 'medium', [...'aaaaaaaabbbbbbb']);
  t.turn = 1;
  const end = G.apply(t, 'b', { type: 'line', edge: H(4, 3) }, {});
  assert.deepEqual(end.result.winners, ['a', 'b']);
  assert.equal(end.result.reason, 'tied for the most boxes');
  assert.deepEqual(end.events.map((e) => e.type), ['line', 'end']);
});

function nextEdge(view) {
  for (let r = 0; r <= view.rows; r++) for (let c = 0; c < view.cols; c++) if (!view.h[r][c]) return H(r, c);
  for (let r = 0; r < view.rows; r++) for (let c = 0; c <= view.cols; c++) if (!view.v[r][c]) return V(r, c);
  return null;
}

standardChecks({
  game: 'dots',
  options: { size: 'small' },
  legal: (w, matchId, token, view) => ({ type: 'line', edge: nextEdge(view) }),
  finish: (w, matchId) => {
    for (;;) {
      const m = w.call('match', w.tokens.Ann, matchId).match;
      if (m.status !== 'active') return;
      const who = ['Ann', 'Bob'].find((n) => w.idOf(n) === m.actors[0]);
      const r = w.call('act', w.tokens[who], matchId, { type: 'line', edge: nextEdge(m.view) }, w.req(m.rev));
      assert.equal(r.ok, true, r.error);
    }
  },
});

test('dots: four players, an extra turn through the platform, and a stale second line', () => {
  const w = world();
  ['Bob', 'Cy', 'Dee'].forEach((n) => w.join(n));
  const { match } = w.play('dots', ['Ann', 'Bob', 'Cy', 'Dee'], { size: 'small' });
  const names = ['Ann', 'Bob', 'Cy', 'Dee'];
  const turn = () => { const m = w.call('match', w.tokens.Ann, match.id).match; return { m, who: names.find((n) => w.idOf(n) === m.actors[0]) }; };
  for (const e of [H(0, 0), V(0, 0), V(0, 1)]) { const { m, who } = turn(); w.call('act', w.tokens[who], match.id, { type: 'line', edge: e }, w.req(m.rev)); }
  const { m, who } = turn();
  assert.equal(who, 'Dee');
  const r = w.call('act', w.tokens.Dee, match.id, { type: 'line', edge: H(1, 0) }, w.req(m.rev));
  assert.equal(r.ok, true);
  assert.deepEqual(r.match.actors, [w.idOf('Dee')], 'Dee draws again');
  // a second tap sent with the old revision is refused, not applied twice
  const again = w.call('act', w.tokens.Dee, match.id, { type: 'line', edge: H(2, 0) }, w.req(m.rev));
  assert.equal(again.code, 'STALE');
  assert.equal(w.call('match', w.tokens.Dee, match.id).match.view.scores[w.idOf('Dee')], 1);
});
