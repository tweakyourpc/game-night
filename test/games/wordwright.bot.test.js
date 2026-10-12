'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('../support/world.js');

function started(words = ['CAT', 'CATS', 'AT', 'TA']) {
  const w = world();
  w.deps.services.dict = () => new Set(words);
  const made = w.call('createTable', w.tokens.Ann, { gameId: 'wordwright', computer: true }, w.aid());
  assert.equal(made.ok, true, made.error);
  const match = w.call('match', w.tokens.Ann, made.table.current_match_id).match;
  return { w, table: made.table, match, bot: match.players[1].id };
}

function botState(w, matchId, rack, board, bag) {
  const m = w.deps.store.get('Matches', matchId);
  m.state.turn = 1;
  m.state.racks[m.players[1].id] = [...rack];
  if (board) m.state.board = board;
  if (bag) m.state.bag = bag;
  w.deps.store.put('Matches', m);
}

test('computer table starts privately with human first and no member or session', () => {
  const { w, table, match, bot } = started();
  assert.equal(table.status, 'playing');
  assert.equal(table.options.inviteOnly, true);
  assert.equal(table.options.game.dictionary, true);
  assert.deepEqual(match.actors, [w.idOf('Ann')]);
  assert.equal(match.players[1].bot, true);
  assert.equal(match.players[1].name, 'Computer');
  assert.equal(w.deps.store.get('Members', bot), null);
  assert.equal(w.deps.store.list('Sessions').length, 1);
  assert.equal(w.call('botTurn', w.tokens.Ann, match.id, 0).code, 'NOT_YOUR_TURN');
  assert.equal(w.call('act', w.tokens.Ann, match.id, { type: 'pass' }, { expectedRevision: 0, actionId: 'bot_0' }).code, 'BAD_REQUEST');
  assert.equal(w.call('transferHost', w.tokens.Ann, table.id, w.req(table.rev), bot).ok, false);
});

test('bot finds an extension, records replay, and does not reveal its rack', () => {
  const { w, match, bot } = started(['CAT', 'CATS']);
  const board = w.GN.wordwright.emptyBoard();
  'CAT'.split('').forEach((l, i) => { board[7][6 + i] = { l }; });
  botState(w, match.id, 'SZZZZZZ', board);
  const first = w.call('botTurn', w.tokens.Ann, match.id, 0);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.match.view.board[7][9].l, 'S');
  assert.equal(first.match.view.myRack === null || Array.isArray(first.match.view.myRack), true);
  assert.equal(JSON.stringify(first.match).includes('SZZZZZZ'), false);
  const retry = w.call('botTurn', w.tokens.Ann, match.id, 0);
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.match.rev, 1);
  const replay = w.call('replay', w.tokens.Ann, match.id).replay;
  assert.equal(replay.events[1].actor, bot);
  assert.equal(replay.events[1].type, 'play');
  assert.equal(JSON.stringify(replay).includes('SZZZZZZ'), false);
});

test('bot makes opening and crossing moves including a blank', () => {
  const { w, match, bot } = started(['CAT', 'AT', 'TA']);
  botState(w, match.id, 'C?TZZZZ');
  const opening = w.call('botTurn', w.tokens.Ann, match.id, 0);
  assert.equal(opening.ok, true, opening.error);
  assert.equal(opening.match.view.moves.at(-1).type, 'play');
  assert.equal(opening.match.view.moves.at(-1).tiles.some((p) => p.b), true);

  const board = w.GN.wordwright.emptyBoard();
  board[7][7] = { l: 'C' }; board[7][8] = { l: 'A' }; board[7][9] = { l: 'T' };
  const m = w.deps.store.get('Matches', match.id);
  m.state.board = board; m.state.turn = 1; m.state.racks[bot] = [...'ATZZZZZ'];
  w.deps.store.put('Matches', m);
  const crossing = w.call('botTurn', w.tokens.Ann, match.id, 1);
  assert.equal(crossing.ok, true, crossing.error);
  assert.equal(crossing.match.view.moves.at(-1).type, 'play');
  assert.equal(crossing.match.view.moves.at(-1).tiles.some((p) => p.r !== 7), true);
});

test('bot exchanges or passes, handles stale calls, and retries word list errors', () => {
  const { w, match } = started(['CAT']);
  botState(w, match.id, 'ZZZZZZZ');
  assert.equal(w.call('botTurn', w.tokens.Ann, match.id, 3).code, 'STALE');
  w.deps.services.dict = () => null;
  assert.equal(w.call('botTurn', w.tokens.Ann, match.id, 0).code, 'DICT');
  w.deps.services.dict = () => { throw Error('Drive temporarily unavailable'); };
  assert.equal(w.call('botTurn', w.tokens.Ann, match.id, 0).code, 'DICT');
  assert.equal(w.call('match', w.tokens.Ann, match.id).match.rev, 0);
  w.deps.services.dict = () => new Set(['CAT']);
  const exchange = w.call('botTurn', w.tokens.Ann, match.id, 0);
  assert.equal(exchange.ok, true, exchange.error);
  assert.equal(exchange.match.view.moves.at(-1).type, 'exchange');
  const m = w.deps.store.get('Matches', match.id);
  m.state.turn = 1; m.state.racks[m.players[1].id] = [...'ZZ']; m.state.bag = [];
  w.deps.store.put('Matches', m);
  const pass = w.call('botTurn', w.tokens.Ann, match.id, 1);
  assert.equal(pass.ok, true, pass.error);
  assert.equal(pass.match.view.moves.at(-1).type, 'pass');
});

test('bot table rematches stay Wordwright with dictionary enabled', () => {
  const { w, table, match } = started();
  w.join('Bob');
  const ended = w.call('abandon', w.tokens.Ann, match.id, w.req(0));
  assert.equal(ended.ok, true);
  let t = w.call('table', w.tokens.Ann, table.id).table;
  assert.equal(w.call('configure', w.tokens.Ann, t.id, w.req(t.rev), { gameId: 'checkers' }).ok, false);
  t = w.call('configure', w.tokens.Ann, t.id, w.req(t.rev), { options: { dictionary: false }, inviteOnly: false }).table;
  assert.equal(t.options.game.dictionary, true);
  assert.equal(t.options.inviteOnly, true);
  assert.equal(w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).ok, false);
  assert.equal(w.call('invite', w.tokens.Ann, t.id, w.req(t.rev), { members: [w.idOf('Bob')] }).ok, false);
  t = w.call('ready', w.tokens.Ann, t.id, w.req(t.rev), true).table;
  const next = w.call('start', w.tokens.Ann, t.id, w.req(t.rev));
  assert.equal(next.ok, true, next.error);
  assert.equal(next.table.current_match_id.endsWith('-2'), true);
  assert.equal(w.call('match', w.tokens.Ann, next.table.current_match_id).match.players[1].bot, true);
});

test('search caps at 50,000 attempts', () => {
  const { w, match, bot } = started();
  const board = w.GN.wordwright.emptyBoard();
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) board[r][c] = { l: 'ABCDEFG'[(r * 15 + c) % 7] };
  botState(w, match.id, 'ABCDEFG', board);
  const words = new Set();
  for (let i = 0; i < 60000; i++) {
    let n = i, word = 'A';
    for (let j = 0; j < 7; j++) { word += 'ABCDEFG'[n % 7]; n = Math.floor(n / 7); }
    words.add(word);
  }
  w.deps.services.dict = () => words;
  const begin = Date.now();
  const r = w.call('botTurn', w.tokens.Ann, match.id, 0);
  assert.equal(r.ok, true, r.error);
  assert.ok(Date.now() - begin < 4000);
});
