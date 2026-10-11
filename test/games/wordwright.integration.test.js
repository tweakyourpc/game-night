// Wordwright on the platform: standard game checks plus its own integration cases
// (dictionary, score preview, end-of-game adjustments, hidden racks).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { standardChecks } = require('../support/gamecheck.js');
const { world } = require('../support/world.js');

const WORDS = new Set(['CAT', 'CATS', 'AT', 'TA', 'TAX', 'ACT']);

/** Two rack tiles across the centre star (fine with the dictionary off). */
function opening(rack) {
  return rack.slice(0, 2).map((l, i) => ({ r: 7, c: 7 + i, l: l === '?' ? 'E' : l, b: l === '?' }));
}

function passAll(w, matchId) {
  for (let i = 0; i < 6; i++) {
    const m = w.call('match', w.tokens.Ann, matchId).match;
    const who = ['Ann', 'Bob'].find((n) => w.idOf(n) === m.actors[0]);
    const r = w.call('act', w.tokens[who], matchId, { type: 'pass' }, w.req(m.rev));
    assert.equal(r.ok, true, r.error);
  }
}

standardChecks({
  game: 'wordwright',
  options: { dictionary: false },
  legal: (w, matchId, token, view) => ({ type: 'play', placements: opening(view.myRack) }),
  finish: passAll,
  secret: (view) => (view.myRack === undefined ? null : view.myRack),
  secretKey: 'myRack',
  secretOf: (state, id) => state.racks[id],
});

function started(options) {
  const w = world();
  w.deps.services.dict = () => WORDS;
  w.join('Bob');
  const { match } = w.play('wordwright', ['Ann', 'Bob'], options || {});
  return { w, match };
}
function setRack(w, matchId, name, letters) {
  const m = w.deps.store.get('Matches', matchId);
  m.state.racks[w.idOf(name)] = [...letters];
  w.deps.store.put('Matches', m);
}
const across = (r, c0, word) => [...word].map((l, i) => ({ r, c: c0 + i, l }));

test('wordwright: words are checked against the word list by default', () => {
  const { w, match } = started();
  setRack(w, match.id, 'Ann', 'CATXQZE');
  const bad = w.call('act', w.tokens.Ann, match.id, { type: 'play', placements: across(7, 6, 'TAC') }, w.req(0));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /dictionary: TAC/);
  const good = w.call('act', w.tokens.Ann, match.id, { type: 'play', placements: across(7, 6, 'CAT') }, w.req(0));
  assert.equal(good.ok, true, good.error);
  assert.deepEqual(good.response, { score: 10, words: [{ word: 'CAT', score: 10 }], bingo: false });
  assert.equal(good.match.view.board[7][7].l, 'A');
});

test('wordwright: a missing word list is a clear, retryable error', () => {
  const { w, match } = started();
  w.deps.services.dict = () => null;
  setRack(w, match.id, 'Ann', 'CATXQZE');
  const r = w.call('act', w.tokens.Ann, match.id, { type: 'play', placements: across(7, 6, 'CAT') }, w.req(0));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'DICT');
  assert.equal(w.call('match', w.tokens.Ann, match.id).match.rev, 0);
});

test('wordwright: score preview evaluates without playing', () => {
  const { w, match } = started();
  setRack(w, match.id, 'Ann', 'CATXQZE');
  const q = w.call('query', w.tokens.Ann, match.id, { type: 'preview', placements: across(7, 6, 'CAT') });
  assert.equal(q.ok, true);
  assert.equal(q.score, 10);
  assert.equal(q.checked, true);
  const bad = w.call('query', w.tokens.Ann, match.id, { type: 'preview', placements: across(0, 0, 'CAT') });
  assert.equal(bad.valid, false);
  assert.match(bad.error, /centre star/);
  assert.equal(w.call('match', w.tokens.Ann, match.id).match.rev, 0);
  // a spectator cannot ask
  w.join('Cy');
  assert.equal(w.call('query', w.tokens.Cy, match.id, { type: 'preview', placements: across(7, 6, 'CAT') }).ok, false);
});

test('wordwright: going out records explicit adjustments in the result and the replay', () => {
  const { w, match } = started();
  const m = w.deps.store.get('Matches', match.id);
  m.state.bag = [];
  m.state.racks[w.idOf('Ann')] = [...'CAT'];
  m.state.racks[w.idOf('Bob')] = [...'QZ'];
  w.deps.store.put('Matches', m);
  const r = w.call('act', w.tokens.Ann, match.id, { type: 'play', placements: across(7, 6, 'CAT') }, w.req(0));
  assert.equal(r.ok, true, r.error);
  const done = r.match;
  assert.equal(done.status, 'finished');
  assert.deepEqual(done.result.winners, [w.idOf('Ann')]);
  assert.equal(done.result.scores[w.idOf('Ann')], 30);
  assert.equal(done.result.scores[w.idOf('Bob')], -20);
  assert.deepEqual(done.result.adjustments, [
    { player: w.idOf('Bob'), points: -20, reason: 'unplayed tiles QZ' },
    { player: w.idOf('Ann'), points: 20, reason: "went out: everyone else's unplayed tiles" },
  ]);
  const rp = w.call('replay', w.tokens.Bob, match.id).replay;
  assert.deepEqual(rp.events.map((e) => e.type), ['start', 'play', 'end']);
  assert.deepEqual(rp.final.adjustments, done.result.adjustments);
  assert.equal(rp.players.find((p) => p.id === w.idOf('Ann')).name, 'Ann');
});

test('wordwright: exchange keeps the hidden bag hidden and returns only a count', () => {
  const { w, match } = started();
  const rack = w.call('match', w.tokens.Ann, match.id).match.view.myRack;
  const r = w.call('act', w.tokens.Ann, match.id, { type: 'exchange', letters: rack.slice(0, 3) }, w.req(0));
  assert.equal(r.ok, true, r.error);
  const ev = w.deps.store.list('Events', { where: { match_id: match.id } }).find((e) => e.type === 'exchange');
  assert.deepEqual(Object.keys(ev.public).sort(), ['count', 'player', 'snapshot']);
  assert.equal(ev.public.count, 3);
  assert.ok(!JSON.stringify(ev.public).includes('"bag"'));
});

test('wordwright: three and four players take turns in seat order', () => {
  const w = world();
  w.deps.services.dict = () => WORDS;
  ['Bob', 'Cy', 'Dee'].forEach((n) => w.join(n));
  const { match } = w.play('wordwright', ['Ann', 'Bob', 'Cy', 'Dee'], { dictionary: false });
  const order = [];
  for (let i = 0; i < 4; i++) {
    const m = w.call('match', w.tokens.Ann, match.id).match;
    const who = ['Ann', 'Bob', 'Cy', 'Dee'].find((n) => w.idOf(n) === m.actors[0]);
    order.push(who);
    assert.equal(w.call('act', w.tokens[who], match.id, { type: 'pass' }, w.req(m.rev)).ok, true);
  }
  assert.deepEqual(order, ['Ann', 'Bob', 'Cy', 'Dee']);
});
