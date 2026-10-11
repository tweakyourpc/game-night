const test = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('../support/world.js');

test('wrong group code is refused slowly and reveals nobody', () => {
  const w = world();
  for (const bad of ['maple', '', null, 42, {}, 'x'.repeat(200)]) {
    const r = w.call('join', bad);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BAD_CODE');
    assert.equal(r.members, undefined);
  }
  assert.ok(w.deps.slept >= 6 * 1500);
});

test('the right code (any capitals and spacing) lists members, never their keys', () => {
  const w = world();
  w.join('Bob');
  const r = w.call('join', '  MAPLE   owl ');
  assert.ok(r.ok, r.error);
  assert.deepEqual(r.members.map((m) => m.name).sort(), ['Ann', 'Bob']);
  assert.ok(!/token|pin_hash|hash/.test(JSON.stringify(r)));
});

test('trusted mode: tap a name to get a new device session; names are unique', () => {
  const w = world();
  w.join('Bob');
  const bob = w.idOf('Bob');
  const r = w.call('join', 'maple owl', { memberId: bob }, 'phone');
  assert.ok(r.ok, r.error);
  assert.notEqual(r.token, w.tokens.Bob, 'a second device gets its own session');
  assert.equal(w.call('lobby', r.token).lobby.me.name, 'Bob');
  assert.equal(w.call('join', 'maple owl', { name: 'bob' }).code, 'NAME_TAKEN');
});

test('admins always need their PIN, even in trusted mode', () => {
  const w = world();
  const ann = w.idOf('Ann');
  assert.equal(w.call('join', 'maple owl', { memberId: ann }).code, 'BAD_PIN');
  assert.equal(w.call('join', 'maple owl', { memberId: ann, pin: '9999' }).code, 'BAD_PIN');
  assert.ok(w.call('join', 'maple owl', { memberId: ann, pin: '1234' }).ok);
});

test('repeated wrong PINs lock that name for a while', () => {
  const w = world();
  const ann = w.idOf('Ann');
  for (let i = 0; i < 5; i++) w.call('join', 'maple owl', { memberId: ann, pin: '0000' });
  assert.equal(w.call('join', 'maple owl', { memberId: ann, pin: '1234' }).code, 'PIN_LOCKED');
});

test('pin mode: new members choose a PIN and need it on a new device', () => {
  const w = world({ mode: 'pin' });
  assert.equal(w.call('join', 'maple owl', { name: 'Bob' }).code, 'BAD_PIN');
  const b = w.call('join', 'maple owl', { name: 'Bob', pin: '4321' });
  assert.ok(b.ok, b.error);
  const bob = w.idOf('Bob');
  assert.equal(w.call('join', 'maple owl', { memberId: bob }).code, 'BAD_PIN');
  assert.ok(w.call('join', 'maple owl', { memberId: bob, pin: '4321' }).ok);
});

test('session tokens are stored only as hashes', () => {
  const w = world();
  const t = w.join('Bob');
  const rows = [...w.deps.store.tables.Sessions.values()];
  assert.ok(rows.length >= 2);
  assert.ok(!JSON.stringify(rows).includes(t));
  assert.ok(rows.some((r) => r.token_hash === w.deps.hash(t)));
});

test('signing out or being removed ends the session', () => {
  const w = world();
  const t = w.join('Bob');
  assert.ok(w.call('lobby', t).ok);
  w.call('signOut', t);
  assert.equal(w.call('lobby', t).code, 'AUTH');
  const t2 = w.join('Cy');
  assert.ok(w.call('adminMember', w.tokens.Ann, w.idOf('Cy'), { removed: true }).ok);
  assert.equal(w.call('lobby', t2).code, 'AUTH');
  assert.equal(w.call('join', 'maple owl').members.some((m) => m.name === 'Cy'), false);
});

test('only admins change settings; changing the code locks out the old one', () => {
  const w = world();
  const bob = w.join('Bob');
  assert.equal(w.call('adminSet', bob, 'entry_code', 'cedar lantern').code, 'FORBIDDEN');
  assert.ok(w.call('adminSet', w.tokens.Ann, 'entry_code', 'cedar lantern').ok);
  assert.equal(w.call('join', 'maple owl').code, 'BAD_CODE');
  assert.ok(w.call('join', 'Cedar Lantern').ok);
  assert.ok(w.call('lobby', bob).ok, 'signed-in devices stay signed in');
  assert.equal(w.call('adminSet', w.tokens.Ann, 'entry_code', 'ab').ok, false);
  assert.equal(w.call('adminSet', w.tokens.Ann, 'nonsense', 'x').ok, false);
});

test('profile: rename (unique) and optional email', () => {
  const w = world();
  const bob = w.join('Bob');
  assert.equal(w.call('profile', bob, 'ann').code, 'NAME_TAKEN');
  assert.ok(w.call('profile', bob, 'Robert', 'rob@x.test').ok);
  assert.equal(w.call('lobby', bob).lobby.me.name, 'Robert');
  assert.equal(w.call('profile', bob, null, 'not an email').ok, false);
});

test('only listed methods are reachable, with bounded arguments', () => {
  const w = world();
  for (const m of ['initialize', 'wipe', 'run', 'followups', '__proto__', 'constructor', 42]) {
    assert.equal(w.call(m, w.tokens.Ann).code, 'BAD_REQUEST', String(m));
  }
  assert.equal(GN.api.handle('lobby', 'nope').code, 'BAD_REQUEST');
  assert.equal(w.call('lobby', w.tokens.Ann, 1, 2).code, 'BAD_REQUEST');
});
