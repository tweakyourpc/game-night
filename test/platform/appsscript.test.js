// The Apps Script layer (src/appsscript/Server.js) and the real spreadsheet store, run
// against simulated services (test/support/fakegas.js): first-time setup, setup twice,
// copying a used spreadsheet, a full game through real sheet rows, and cell safety.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { template, copyProject } = require('../support/fakegas.js');

const RACE = path.join(__dirname, '..', 'support', 'racegame.js');
const aid = () => crypto.randomBytes(9).toString('hex');

function setUp(p, answers) {
  p.answer(...(answers || ['Test Group', 'maple owl', 'Ann', '1234']));
  p.run('gnSetup');
}
const rpc = (p, method, ...args) => p.run('call', method, args);
function signIn(p, name, pin) {
  const pick = rpc(p, 'join', 'maple owl');
  assert.equal(pick.ok, true, pick.error);
  const m = pick.members.find((x) => x.name === name);
  const r = m ? rpc(p, 'join', 'maple owl', { memberId: m.id, pin }) : rpc(p, 'join', 'maple owl', { name, pin });
  assert.equal(r.ok, true, r.error);
  return r.token;
}

test('fresh template: menu, not ready until set up, then ready', () => {
  const p = template({ extra: [RACE] });
  p.run('onOpen');
  assert.equal(p.ui.menu.title, 'Game Night');
  assert.ok(p.ui.menu.items.some(([, fn]) => fn === 'gnSetup'));
  assert.equal(rpc(p, 'join', 'maple owl').code, 'NOT_SET_UP');
  assert.equal(p.run('doGet').template.ready, false);

  setUp(p);
  assert.match(p.ui.alerts.at(-1).msg, /publish the web app/);
  assert.equal(p.props.get('SHEET_ID'), p.ss.getId());
  assert.ok(p.props.get('INSTALL_ID'));
  assert.equal(p.run('doGet').template.ready, true);
  const tabs = p.ss.getSheets().map((s) => s.getName());
  for (const t of ['Settings', 'Members', 'Sessions', 'Tables', 'Matches', 'Events', 'Outbox']) assert.ok(tabs.includes(t), t);
  assert.deepEqual(p.ss.getSheetByName('Members').getRange(1, 1, 1, 3).getValues()[0], ['id', 'name', 'email']);

  const token = signIn(p, 'Ann', '1234');
  const lobby = rpc(p, 'lobby', token);
  assert.equal(lobby.ok, true);
  assert.equal(lobby.lobby.group, 'Test Group');
  assert.equal(lobby.lobby.me.role, 'admin');
});

test('setup validates answers and can be cancelled without changing anything', () => {
  const p = template();
  p.answer('G', 'abc', 'abcd', null);              // code too short, then Cancel at the name
  p.run('gnSetup');
  assert.ok(p.ui.alerts.some((a) => /at least 4/.test(a.msg)));
  assert.equal(p.props.get('SHEET_ID'), undefined);
  assert.equal(rpc(p, 'join', 'abcd').code, 'NOT_SET_UP');

  p.answer('G', 'abcd', 'Ann', '12', '12345');      // PIN too short, then fixed
  p.run('gnSetup');
  assert.ok(p.ui.alerts.some((a) => /4 to 8 digits/.test(a.msg)));
  assert.equal(rpc(p, 'join', 'abcd').ok, true);
});

test('running setup twice keeps the installation', () => {
  const p = template();
  setUp(p);
  const install = p.props.get('INSTALL_ID');
  const token = signIn(p, 'Ann', '1234');
  setUp(p, ['Other', 'other code', 'Zed', '9999']);
  assert.match(p.ui.alerts.at(-1).msg, /already set up/);
  assert.equal(p.props.get('INSTALL_ID'), install);
  assert.equal(rpc(p, 'lobby', token).ok, true);
  assert.equal(rpc(p, 'join', 'other code').code, 'BAD_CODE');
});

for (const copyProperties of [false, true]) {
  test('a copy of a used spreadsheet inherits nothing (properties copied: ' + copyProperties + ')', () => {
    const a = template({ extra: [RACE] });
    setUp(a);
    const annToken = signIn(a, 'Ann', '1234');
    signIn(a, 'Bob', '');
    a.run('gnInstallTrigger');
    const before = JSON.stringify(a.ss.getSheets().map((s) => s.rows));

    const b = copyProject(a, { copyProperties, extra: [RACE] });
    // not usable until its owner sets it up, even though the rows came along
    assert.equal(rpc(b, 'join', 'maple owl').code, 'NOT_SET_UP');
    assert.equal(rpc(b, 'lobby', annToken).code, 'NOT_SET_UP');

    b.confirm('NO');
    b.run('gnSetup');
    assert.equal(b.ui.prompts.length, 0, 'declining asks nothing else');
    assert.match(b.ui.alerts.find((x) => x.title === 'Start fresh?').msg, /another Game Night installation/);
    assert.equal(rpc(b, 'join', 'maple owl').code, 'NOT_SET_UP', 'declining changes nothing');

    b.confirm('YES');
    setUp(b, ['Copy Group', 'river stone', 'Cat', '4321']);
    assert.notEqual(b.props.get('INSTALL_ID'), a.props.get('INSTALL_ID'));
    assert.equal(b.props.get('SHEET_ID'), b.ss.getId());
    assert.equal(b.triggers.length, 0, 'inherited triggers removed');
    assert.equal(rpc(b, 'join', 'maple owl').code, 'BAD_CODE', 'old code gone');
    assert.equal(rpc(b, 'lobby', annToken).ok, false, 'old sessions gone');
    const members = rpc(b, 'join', 'river stone').members.map((m) => m.name);
    assert.equal(JSON.stringify(members), '["Cat"]');
    const settings = b.ss.getSheetByName('Settings').getRange(2, 1, 20, 2).getValues().filter((r) => r[0]);
    assert.ok(!JSON.stringify(settings).includes('maple owl'));

    // the original is untouched
    assert.equal(JSON.stringify(a.ss.getSheets().map((s) => s.rows)), before);
    assert.equal(rpc(a, 'lobby', annToken).ok, true);
  });
}

test('a whole game through real sheet rows, then a fresh execution reads it back', () => {
  const p = template({ extra: [RACE], url: 'https://script.example/exec' });
  setUp(p);
  const ann = signIn(p, 'Ann', '1234');
  const bob = signIn(p, 'Bob', '');
  let t = rpc(p, 'createTable', ann, { gameId: 'race', options: { goal: 10 } }, aid()).table;
  t = rpc(p, 'sit', bob, t.id, { expectedRevision: t.rev, actionId: aid() }).table;
  t = rpc(p, 'ready', ann, t.id, { expectedRevision: t.rev, actionId: aid() }, true).table;
  t = rpc(p, 'ready', bob, t.id, { expectedRevision: t.rev, actionId: aid() }, true).table;
  const s = rpc(p, 'start', ann, t.id, { expectedRevision: t.rev, actionId: aid() });
  assert.equal(s.ok, true, s.error);
  const matchId = s.table.current_match_id;
  let m = rpc(p, 'match', ann, matchId).match;
  const tok = { [m.players[0].id]: ann, [m.players[1].id]: bob };
  let moves = 0;
  while (m.status === 'active' && moves < 40) {
    const who = tok[m.actors[0]];
    const id = aid();
    const r = rpc(p, 'act', who, matchId, { type: 'step', n: 1 }, { expectedRevision: m.rev, actionId: id });
    assert.equal(r.ok, true, r.error);
    // a retry of the same action returns the same result and changes nothing
    const again = rpc(p, 'act', who, matchId, { type: 'step', n: 1 }, { expectedRevision: m.rev, actionId: id });
    assert.equal(again.duplicate, true);
    assert.equal(again.match.rev, r.match.rev);
    m = r.match;
    moves++;
  }
  assert.equal(m.status, 'finished');
  const reread = rpc(p, 'match', bob, matchId);
  assert.equal(reread.ok, true);
  assert.equal(reread.match.rev, m.rev);
  const replay = rpc(p, 'replay', bob, matchId);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay.events.length, moves + 1);
  // every cell stays below the Sheets limit, and the Matches row keeps no event copies
  const row = p.ss.getSheetByName('Matches').getRange(2, 1, 1, 18).getValues()[0];
  const actions = JSON.parse(row[17]);
  assert.ok(actions.every((x) => !x.events), 'events moved to the Events tab');
  // stats derived from the finished game
  const lobby = rpc(p, 'lobby', ann).lobby;
  const me = lobby.members.find((x) => x.name === 'Ann');
  assert.equal(me.stats.played, 1);
});

test('formula-looking and apostrophe text stays text', () => {
  const p = template();
  setUp(p);
  const names = ['=IMPORTXML("x")', "'quoted", '+1 cat', '@home', '-dash'];
  for (const n of names) signIn(p, n, '');
  const listed = rpc(p, 'join', 'maple owl').members.map((m) => m.name);
  for (const n of names) assert.ok(listed.includes(n), n);
  const cells = p.ss.getSheetByName('Members').getRange(2, 2, 10, 1).getValues().flat().join('|');
  assert.ok(!cells.includes('#ERROR'), cells);
});

test('keys that differ only by letter case are different rows', () => {
  const p = template();
  setUp(p);
  p.run('gnInitDeps_', p.ss);
  const store = p.context.GN.deps.store;
  store.put('Settings', { key: 'Abc', value: 'upper' });
  store.put('Settings', { key: 'abc', value: 'lower' });
  store.refresh();
  assert.equal(store.get('Settings', 'Abc').value, 'upper');
  assert.equal(store.get('Settings', 'abc').value, 'lower');
  assert.equal(store.insert('Settings', { key: 'ABC', value: 'x' }), true);
  assert.equal(store.insert('Settings', { key: 'ABC', value: 'y' }), false);
  store.remove('Settings', 'abc');
  store.refresh();
  assert.equal(store.get('Settings', 'abc'), null);
  assert.equal(store.get('Settings', 'Abc').value, 'upper');
});

test('a lock timeout becomes a retryable answer, not a crash', () => {
  const p = template({ extra: [RACE] });
  setUp(p);
  const ann = signIn(p, 'Ann', '1234');
  p.state.lockFail = 1;
  const actionId = aid();
  const r = rpc(p, 'createTable', ann, { gameId: 'race' }, actionId);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'BUSY');
  assert.equal(r.retry, true);
  const again = rpc(p, 'createTable', ann, { gameId: 'race' }, actionId);
  assert.equal(again.ok, true);
  const third = rpc(p, 'createTable', ann, { gameId: 'race' }, actionId);
  assert.equal(third.table.id, again.table.id, 'the retry did not create a second table');
  assert.ok(p.log.some((l) => /"rpc":"createTable".*"ms"/.test(l)), 'response times are logged');
});

test('a newer release migrates an older sheet on the next request', () => {
  const p = template();
  setUp(p);
  p.context.GN.SCHEMA_VERSION = 2;                 // as if the code were upgraded
  assert.equal(rpc(p, 'join', 'maple owl').ok, true);
  p.run('gnInitDeps_', p.ss);
  assert.equal(p.context.GN.deps.store.setting('schema_version'), '2');
});

test('maintenance trigger is optional and installed once', () => {
  const p = template();
  setUp(p);
  p.run('gnInstallTrigger');
  p.run('gnInstallTrigger');
  assert.equal(p.triggers.length, 1);
  p.run('gnMaintain');
  assert.ok(p.log.some((l) => l.includes('"job":"maintain"')));
});

test('web execution uses only a binding owned by the current script; copied administration fails closed', () => {
  const a = template(); setUp(a);
  const token = signIn(a, 'Ann', '1234');
  a.state.web = true;
  assert.equal(rpc(a, 'lobby', token).ok, true);
  assert.deepEqual(a.state.opened, [a.ss.getId()]);
  const b = copyProject(a, { copyProperties: true }); b.state.web = true;
  for (const fn of ['doGet', 'gnMaintain', 'gnRepairNow', 'gnInstallTrigger']) b.run(fn);
  for (const method of ['lobby', 'adminSetting', 'saveReplay', 'uploadChunk']) assert.equal(rpc(b, method, token).code, 'NOT_SET_UP');
  assert.equal(b.state.opened, undefined, 'never opens the original id');
  assert.equal(b.triggers.length, 0);
  b.state.web = false; b.confirm('YES'); setUp(b, ['Copy', 'copy code', 'Cat', '4321']);
  b.state.web = true;
  assert.equal(rpc(b, 'join', 'copy code').ok, true);
  assert.equal(rpc(b, 'lobby', token).code, 'AUTH');
  assert.ok(b.state.opened.every(id => id === b.ss.getId()));
});
