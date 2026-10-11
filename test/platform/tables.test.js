const test = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('../support/world.js');

function opened(w, extra = {}) {
  const r = w.call('createTable', w.tokens.Ann, Object.assign({ gameId: 'race', title: 'Friday' }, extra), w.aid());
  assert.ok(r.ok, r.error);
  return r.table;
}

test('creating a table is retry-safe: the same action id makes one table', () => {
  const w = world();
  const id = w.aid();
  const a = w.call('createTable', w.tokens.Ann, { gameId: 'race' }, id);
  const b = w.call('createTable', w.tokens.Ann, { gameId: 'race' }, id);
  assert.equal(a.table.id, b.table.id);
  assert.equal(b.duplicate, true);
  assert.equal(w.deps.store.list('Tables').length, 1);
  assert.equal(w.call('createTable', w.tokens.Ann, { gameId: 'chess' }, w.aid()).code, 'NO_GAME');
  assert.equal(w.call('createTable', w.tokens.Ann, { gameId: 'race', options: { goal: 7 } }, w.aid()).code, 'BAD_OPTION');
});

test('seats: sit, full table, invite-only, and the host cannot walk away', () => {
  const w = world();
  ['Bob', 'Cy', 'Di'].forEach((n) => w.join(n));
  let t = opened(w);
  assert.equal(t.seats.length, 1);
  t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
  t = w.call('sit', w.tokens.Cy, t.id, w.req(t.rev)).table;
  assert.equal(w.call('sit', w.tokens.Di, t.id, w.req(t.rev)).code, 'FULL');
  assert.equal(w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).code, 'SEATED');
  assert.equal(w.call('stand', w.tokens.Ann, t.id, w.req(t.rev)).code, 'HOST');
  t = w.call('stand', w.tokens.Cy, t.id, w.req(t.rev)).table;
  assert.equal(t.seats.length, 2);
  const inv = opened(w, { inviteOnly: true });
  assert.equal(w.call('sit', w.tokens.Di, inv.id, w.req(inv.rev)).code, 'FORBIDDEN');
  const after = w.call('invite', w.tokens.Ann, inv.id, w.req(inv.rev), { members: [w.idOf('Di')] }).table;
  assert.ok(w.call('sit', w.tokens.Di, inv.id, w.req(after.rev)).ok);
});

test('two people taking the last seat: exactly one gets it', () => {
  const w = world();
  ['Bob', 'Cy', 'Di'].forEach((n) => w.join(n));
  let t = opened(w);
  t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;   // 2 of 3 seats taken
  const cy = w.call('sit', w.tokens.Cy, t.id, w.req(t.rev));
  const di = w.call('sit', w.tokens.Di, t.id, w.req(t.rev));   // both looked at the same revision
  assert.ok(cy.ok);
  assert.equal(di.ok, false);
  assert.equal(di.code, 'STALE');
  assert.equal(di.table.seats.length, 3, 'the loser sees the fresh table');
  assert.equal(w.call('sit', w.tokens.Di, t.id, w.req(di.table.rev)).code, 'FULL');
});

test('start needs the right number of players, all ready; only the host starts', () => {
  const w = world();
  w.join('Bob');
  let t = opened(w);
  t = w.call('ready', w.tokens.Ann, t.id, w.req(t.rev), true).table;
  assert.match(t.startBlock, /at least 2/);
  assert.equal(w.call('start', w.tokens.Ann, t.id, w.req(t.rev)).code, 'CANNOT_START');
  t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
  assert.match(t.startBlock, /ready/);
  t = w.call('ready', w.tokens.Bob, t.id, w.req(t.rev), true).table;
  assert.equal(t.startBlock, null);
  assert.equal(w.call('start', w.tokens.Bob, t.id, w.req(t.rev)).code, 'FORBIDDEN');
  const s = w.call('start', w.tokens.Ann, t.id, w.req(t.rev));
  assert.ok(s.ok, s.error);
  assert.equal(s.table.status, 'playing');
  assert.equal(s.table.current_match_id, t.id + '-1');
});

test('autostart is opt-in and starts when the last player is ready', () => {
  const w = world();
  w.join('Bob');
  let t = opened(w, { autostart: true });
  t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
  t = w.call('ready', w.tokens.Ann, t.id, w.req(t.rev), true).table;
  assert.equal(t.status, 'open');
  t = w.call('ready', w.tokens.Bob, t.id, w.req(t.rev), true).table;
  assert.equal(t.status, 'playing');
  const manual = opened(w);
  assert.equal(manual.options.autostart, false);
});

test('starting is retry-safe even if the table update fails after the match is created', () => {
  const w = world();
  w.join('Bob');
  let t = opened(w);
  t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
  t = w.call('ready', w.tokens.Ann, t.id, w.req(t.rev), true).table;
  t = w.call('ready', w.tokens.Bob, t.id, w.req(t.rev), true).table;
  const req = w.req(t.rev);
  w.deps.store.failNext('put', 'Tables');
  assert.throws(() => w.call('start', w.tokens.Ann, t.id, req), /injected/);
  assert.equal(w.deps.store.list('Matches').length, 1, 'the match was created');
  assert.equal(w.deps.store.get('Tables', t.id).status, 'open', 'the table update did not land');
  const again = w.call('start', w.tokens.Ann, t.id, req);
  assert.ok(again.ok, again.error);
  assert.equal(w.deps.store.list('Matches').length, 1, 'no second match');
  assert.equal(again.table.current_match_id, t.id + '-1');
  assert.equal(w.call('start', w.tokens.Ann, t.id, req).duplicate, true);
});

test('presence loss never removes a seat or moves the host', () => {
  const w = world();
  w.join('Bob');
  let t = opened(w);
  t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
  w.deps.tick(10 * 60 * 1000);                    // everyone gone quiet for 10 minutes
  w.deps.cacheMap.clear();
  w.deps.cache.put('maint:last', { at: 0 });
  GN.maintenance.run(10);
  const now = w.call('table', w.tokens.Bob, t.id).table;
  assert.equal(now.seats.length, 2);
  assert.equal(now.host_id, w.idOf('Ann'));
  assert.ok(now.seats.every((s) => s.member_id === w.idOf('Bob') || !s.here));
});

test('tables survive the match: rematch or switch game keeps seats and Meet, readiness resets', () => {
  const w = world();
  w.join('Bob');
  let t = opened(w);
  t = w.call('setMeet', w.tokens.Ann, t.id, w.req(t.rev), 'https://meet.google.com/abc-defg-hij').table;
  const { match } = (() => {
    t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
    t = w.call('ready', w.tokens.Ann, t.id, w.req(t.rev), true).table;
    t = w.call('ready', w.tokens.Bob, t.id, w.req(t.rev), true).table;
    const s = w.call('start', w.tokens.Ann, t.id, w.req(t.rev));
    return { match: w.call('match', w.tokens.Ann, s.table.current_match_id).match };
  })();
  for (let i = 0; i < 20 && w.deps.store.get('Matches', match.id).status === 'active'; i++) {
    w.act(w.actor(match.id), match.id, { type: 'step', n: 1 });
  }
  t = w.call('table', w.tokens.Ann, t.id).table;
  assert.equal(t.status, 'open');
  assert.equal(t.seats.length, 2);
  assert.equal(t.meet_url, 'https://meet.google.com/abc-defg-hij');
  assert.ok(t.seats.every((s) => !s.ready), 'readiness is asked again');
  assert.equal(t.matches.length, 1);
  assert.equal(t.matches[0].status, 'finished');
  // rematch
  t = w.call('ready', w.tokens.Ann, t.id, w.req(t.rev), true).table;
  t = w.call('ready', w.tokens.Bob, t.id, w.req(t.rev), true).table;
  const s2 = w.call('start', w.tokens.Ann, t.id, w.req(t.rev));
  assert.equal(s2.table.current_match_id, t.id + '-2');
});

test('switching game is checked against the seated players', () => {
  const w = world();
  ['Bob', 'Cy'].forEach((n) => w.join(n));
  GN.games.duel = Object.assign({}, GN.games.race, { id: 'duel', players: { min: 2, max: 2 } });
  try {
    let t = opened(w);
    t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
    t = w.call('sit', w.tokens.Cy, t.id, w.req(t.rev)).table;
    const r = w.call('configure', w.tokens.Ann, t.id, w.req(t.rev), { gameId: 'duel' });
    assert.equal(r.code, 'TOO_MANY');
    t = w.call('stand', w.tokens.Cy, t.id, w.req(t.rev)).table;
    t = w.call('ready', w.tokens.Bob, t.id, w.req(t.rev), true).table;
    const ok = w.call('configure', w.tokens.Ann, t.id, w.req(t.rev), { gameId: 'duel', themeId: 'slate' });
    assert.ok(ok.ok, ok.error);
    assert.equal(ok.table.game_id, 'duel');
    assert.equal(ok.table.theme_id, 'slate');
    assert.ok(ok.table.seats.every((s) => !s.ready), 'changing the game asks for readiness again');
    assert.equal(w.call('configure', w.tokens.Bob, t.id, w.req(ok.table.rev), { title: 'x' }).code, 'FORBIDDEN');
  } finally {
    delete GN.games.duel;
  }
});

test('Meet links: https only, Google Meet recognised, host only, clearable', () => {
  const w = world();
  w.join('Bob');
  let t = opened(w);
  assert.equal(w.call('setMeet', w.tokens.Ann, t.id, w.req(t.rev), 'javascript:alert(1)').code, 'BAD_URL');
  assert.equal(w.call('setMeet', w.tokens.Ann, t.id, w.req(t.rev), 'http://meet.google.com/x').code, 'BAD_URL');
  const g = w.call('setMeet', w.tokens.Ann, t.id, w.req(t.rev), 'https://meet.google.com/abc-defg-hij');
  assert.equal(g.result.google, true);
  t = g.table;
  t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
  assert.equal(w.call('setMeet', w.tokens.Bob, t.id, w.req(t.rev), '').code, 'FORBIDDEN');
  assert.equal(w.call('setMeet', w.tokens.Ann, t.id, w.req(t.rev), '').table.meet_url, '');
});

test('host transfer only by the host, only to a seated player', () => {
  const w = world();
  ['Bob', 'Cy'].forEach((n) => w.join(n));
  let t = opened(w);
  t = w.call('sit', w.tokens.Bob, t.id, w.req(t.rev)).table;
  assert.equal(w.call('transferHost', w.tokens.Ann, t.id, w.req(t.rev), w.idOf('Cy')).code, 'BAD_REQUEST');
  t = w.call('transferHost', w.tokens.Ann, t.id, w.req(t.rev), w.idOf('Bob')).table;
  assert.equal(t.host_id, w.idOf('Bob'));
  assert.ok(w.call('stand', w.tokens.Ann, t.id, w.req(t.rev)).ok);
});

test('invitations: email through the outbox with the table link, never a session token', () => {
  const w = world();
  w.join('Bob');
  w.call('profile', w.tokens.Bob, null, 'bob@x.test');
  let t = opened(w);
  const r = w.call('invite', w.tokens.Ann, t.id, w.req(t.rev), { members: [w.idOf('Bob')], emails: ['cy@x.test'] });
  assert.ok(r.ok, r.error);
  assert.equal(w.deps.mails.length, 2);
  const allText = JSON.stringify(w.deps.mails);
  assert.ok(allText.includes('?t=' + t.share_key));
  for (const tok of Object.values(w.tokens)) assert.ok(!allText.includes(tok), 'no session token in invitations');
  assert.ok(!allText.includes('maple owl'), 'the code is left out unless asked for');
  const withCode = w.call('invite', w.tokens.Ann, t.id, w.req(r.table.rev), { emails: ['di@x.test'], includeCode: true });
  assert.ok(withCode.ok);
  assert.ok(w.deps.mails.at(-1).html.includes('maple owl'));
  assert.equal(w.call('invite', w.tokens.Ann, t.id, w.req(withCode.table.rev), { emails: ['nope'] }).ok, false);
});

test('a table link resolves for any member; a closed table is gone', () => {
  const w = world();
  const bob = w.join('Bob');
  const t = opened(w);
  assert.equal(w.call('tableByLink', bob, t.share_key).table.id, t.id);
  const c = w.call('closeTable', w.tokens.Ann, t.id, w.req(t.rev));
  assert.ok(c.ok);
  assert.equal(w.call('tableByLink', bob, t.share_key).code, 'NOT_FOUND');
});
