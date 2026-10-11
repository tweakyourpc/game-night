const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { world } = require('../support/world.js');
const { serverFiles, SRC } = require('../support/load.js');

function started(players = ['Ann', 'Bob'], goal) {
  const w = world();
  players.slice(1).forEach((n) => w.join(n));
  const { table, match } = w.play('race', players, goal ? { goal } : undefined);
  return { w, table, match };
}

/** Play until the race is over, all steps of 1. */
function finish(w, matchId) {
  for (let i = 0; i < 40 && w.deps.store.get('Matches', matchId).status === 'active'; i++) {
    const r = w.act(w.actor(matchId), matchId, { type: 'step', n: 1 });
    if (!r.ok) throw new Error(r.error);
  }
}

test('stale, duplicate, out-of-turn and finished-game actions', () => {
  const { w, match } = started();
  const who = w.actor(match.id);
  const other = Object.values(w.tokens).find((t) => t !== who);
  assert.equal(w.act(other, match.id, { type: 'step', n: 1 }).code, 'NOT_YOUR_TURN');
  const req = w.req(0);
  const a = w.call('act', who, match.id, { type: 'roll' }, req);
  assert.ok(a.ok);
  const b = w.call('act', who, match.id, { type: 'roll' }, req);
  assert.equal(b.duplicate, true);
  assert.deepEqual(b.response, a.response, 'a retried roll returns the same die, not a new one');
  assert.equal(w.deps.store.get('Matches', match.id).rev, 1);
  const stale = w.call('act', w.actor(match.id), match.id, { type: 'step', n: 1 }, w.req(0));
  assert.equal(stale.code, 'STALE');
  assert.equal(stale.match.rev, 1);
  for (const bad of [null, 'step', [], { type: 5 }, { type: 'x'.repeat(5000) }]) {
    assert.equal(w.call('act', who, match.id, bad, w.req(1)).code, 'BAD_REQUEST');
  }
  assert.equal(w.call('act', who, match.id, { type: 'step', n: 1 }, { expectedRevision: 1 }).code, 'BAD_REQUEST');
  finish(w, match.id);
  assert.equal(w.act(w.tokens.Ann, match.id, { type: 'step', n: 1 }).code, 'OVER');
});

test('an action that keeps the turn does not rotate players', () => {
  const { w, match } = started();
  const who = w.actor(match.id);
  w.act(who, match.id, { type: 'step', n: 2 });
  assert.equal(w.actor(match.id), who);
  w.act(who, match.id, { type: 'step', n: 1 });
  assert.notEqual(w.actor(match.id), who);
});

test('two sessions converge on the same committed state', () => {
  const { w, match } = started();
  w.act(w.actor(match.id), match.id, { type: 'roll' });
  w.act(w.actor(match.id), match.id, { type: 'step', n: 2 });
  const a = w.call('match', w.tokens.Ann, match.id).match;
  const b = w.call('match', w.tokens.Bob, match.id).match;
  assert.deepEqual(a.view.pos, b.view.pos);
  assert.equal(a.rev, b.rev);
  assert.notEqual(a.view.mySecret, b.view.mySecret, 'each sees only their own secret');
});

test('hidden state never reaches other players, spectators or replays', () => {
  const { w, match } = started();
  w.join('Cy');
  w.act(w.actor(match.id), match.id, { type: 'roll' });
  const spectator = w.call('match', w.tokens.Cy, match.id).match;
  assert.equal(spectator.spectator, true);
  assert.equal(spectator.view.mySecret, null);
  const bobView = JSON.stringify(w.call('match', w.tokens.Bob, match.id));
  assert.ok(!bobView.includes('secret-' + w.idOf('Ann')));
  const replay = JSON.stringify(w.call('replay', w.tokens.Bob, match.id));
  assert.ok(!replay.includes('secret-'));
  const lobby = JSON.stringify(w.call('lobby', w.tokens.Cy));
  assert.ok(!lobby.includes('secret-'));
});

test('ending a match early: any player, no winner, no stats, table freed', () => {
  const { w, match, table } = started();
  const r = w.call('abandon', w.tokens.Bob, match.id, w.req(0));
  assert.ok(r.ok, r.error);
  assert.equal(r.match.status, 'abandoned');
  assert.equal(w.call('table', w.tokens.Ann, table.id).table.status, 'open');
  assert.equal(w.call('lobby', w.tokens.Ann).lobby.me.stats.played || 0, 0, 'an ended game is not counted');
  assert.equal(w.call('abandon', w.tokens.Ann, match.id, w.req(1)).code, 'OVER');
});

// ---------------------------------------------------------------- fault injection

function finishWithFault(op, table) {
  const { w, match } = started();
  // play to one step before the end, then fail one follow-up on the winning step
  // the player about to move must be one step from the goal, so their step wins
  const winning = () => {
    const m = w.deps.store.get('Matches', match.id);
    return m.state.pos[GN.games.race.actors(m.state)[0]] >= m.state.goal - 1;
  };
  while (!winning()) w.act(w.actor(match.id), match.id, { type: 'step', n: 1 });
  const who = w.actor(match.id);
  const req = w.req(w.deps.store.get('Matches', match.id).rev);
  w.deps.store.failNext(op, table);
  const r = w.call('act', who, match.id, { type: 'step', n: 1 }, req);
  return { w, match, r, who, req };
}

function assertRepaired(w, matchId, label) {
  const m = w.deps.store.get('Matches', matchId);
  assert.equal(m.done_rev, m.rev, label + ': follow-ups complete');
  const ev = w.deps.store.list('Events', { where: { match_id: matchId } });
  const seqs = ev.map((e) => e.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, [...new Set(seqs)], label + ': one event row per seq');
  assert.equal(seqs.length, seqs[seqs.length - 1] + 1, label + ': no gaps');
  const stats = ['Ann', 'Bob'].map((n) => w.deps.store.get('Members', w.idOf(n)).stats);
  stats.forEach((s) => assert.equal(s.played, 1, label + ': counted once'));
  assert.equal(stats.reduce((a, s) => a + s.wins, 0), 1, label + ': one winner');
  assert.equal(w.deps.store.get('Tables', m.table_id).status, 'open', label + ': table released');
}

test('fault: statistics write fails after the commit; the retry repairs it exactly once', () => {
  const { w, match, r, who, req } = finishWithFault('put', 'Members');
  assert.ok(r.ok, 'the move itself is committed and reported');
  assert.ok(w.deps.store.get('Matches', match.id).done_rev < w.deps.store.get('Matches', match.id).rev);
  const again = w.call('act', who, match.id, { type: 'step', n: 1 }, req);
  assert.equal(again.duplicate, true);
  assertRepaired(w, match.id, 'stats');
  w.call('act', who, match.id, { type: 'step', n: 1 }, req);       // more retries change nothing
  assertRepaired(w, match.id, 'stats after extra retry');
});

test('fault: event logging fails after the commit; maintenance repairs it', () => {
  const { w, match, r } = finishWithFault('insert', 'Events');
  assert.ok(r.ok);
  assert.ok(w.deps.store.get('Matches', match.id).done_rev < w.deps.store.get('Matches', match.id).rev);
  const fixed = GN.maintenance.run(10);
  assert.equal(fixed.matches, 1);
  assertRepaired(w, match.id, 'events');
  assert.equal(GN.maintenance.run(10).matches, 0, 'nothing left to repair');
  assertRepaired(w, match.id, 'events after a second maintenance run');
});

test('fault: table release fails; retry or maintenance frees the table once', () => {
  const { w, match } = finishWithFault('put', 'Tables');
  GN.maintenance.run(10);
  assertRepaired(w, match.id, 'table');
  const t = w.deps.store.get('Tables', w.deps.store.get('Matches', match.id).table_id);
  assert.equal(t.status, 'open');
});

test('fault: revision-cache publication fails; polls still see the move', () => {
  const { w, match } = started();
  const before = w.call('sync', w.tokens.Bob, { match: { id: match.id, rev: 0 } });
  assert.equal(before.match.changed, false);
  w.deps.failNext('cache.put', 5);
  const r = w.act(w.actor(match.id), match.id, { type: 'roll' });
  assert.ok(r.ok);
  const after = w.call('sync', w.tokens.Bob, { match: { id: match.id, rev: 0 } });
  assert.equal(after.match.changed, true, 'the stale hint was removed before the commit');
  assert.equal(after.match.match.rev, 1);
});

test('fault: email fails; the move stands and the outbox delivers it later, once', () => {
  const { w, match } = started();
  w.deps.store.setSetting('turn_emails', 'yes');
  w.call('profile', w.tokens.Bob, null, 'bob@x.test');
  w.call('profile', w.tokens.Ann, null, 'ann@x.test');
  w.deps.failNext('mail', 1);
  const r = w.act(w.actor(match.id), match.id, { type: 'step', n: 1 });
  assert.ok(r.ok);
  assert.equal(w.deps.mails.length, 0);
  w.deps.tick(5 * 60 * 1000);
  GN.outbox.flush(10);
  assert.equal(w.deps.mails.length, 1);
  w.deps.tick(60 * 60 * 1000);
  GN.outbox.flush(10);
  assert.equal(w.deps.mails.length, 1, 'never sent twice');
});

test('turn emails are off by default; start emails go to players with an address', () => {
  const w = world();
  w.join('Bob');
  w.call('profile', w.tokens.Bob, null, 'bob@x.test');
  const { match } = w.play('race', ['Ann', 'Bob']);
  assert.equal(w.deps.mails.length, 1);
  assert.match(w.deps.mails[0].subject, /has started/);
  w.act(w.actor(match.id), match.id, { type: 'step', n: 1 });
  assert.equal(w.deps.mails.length, 1);
});

// ---------------------------------------------------------------- polling and replays

test('an idle poll reads no spreadsheet rows', () => {
  const { w, match, table } = started();
  w.call('sync', w.tokens.Bob, { lobby: '', table: { id: table.id, rev: -1 }, match: { id: match.id, rev: -1 } });
  const v = w.call('lobby', w.tokens.Bob).v;
  const t = w.call('table', w.tokens.Bob, table.id).table;
  const ann = w.idOf('Ann'), bob = w.idOf('Bob');        // looked up before measuring
  const counts = { ...w.deps.store.counts };
  const r = w.call('sync', w.tokens.Bob, { lobby: v, table: { id: table.id, rev: t.rev, seats: [ann, bob] },
    match: { id: match.id, rev: 0, players: [ann, bob] } });
  assert.equal(r.lobby.changed, false);
  assert.equal(r.table.changed, false);
  assert.equal(r.match.changed, false);
  const reads = Object.keys(w.deps.store.counts).filter((k) => /^(get|list):/.test(k))
    .reduce((n, k) => n + w.deps.store.counts[k] - (counts[k] || 0), 0);
  assert.equal(reads, 0);
});

test('replay: versioned, stable ids and name snapshots, the actual rolls, explicit final', () => {
  const { w, match } = started();
  w.act(w.actor(match.id), match.id, { type: 'roll' });
  const rolled = w.deps.store.get('Matches', match.id).state.rolls[0];
  finish(w, match.id);
  w.call('profile', w.tokens.Bob, 'Robert');                 // a later rename doesn't change history
  const rp = w.call('replay', w.tokens.Ann, match.id).replay;
  assert.equal(rp.format, 'game-night-replay');
  assert.equal(rp.version, 1);
  assert.equal(rp.game.id, 'race');
  assert.equal(rp.game.rulesVersion, 1);
  assert.deepEqual(rp.players.map((p) => p.name).sort(), ['Ann', 'Bob']);
  assert.equal(rp.events[0].type, 'start');
  assert.equal(rp.events.find((e) => e.type === 'roll').public.die, rolled);
  assert.ok(rp.events.every((e) => e.public.snapshot), 'every step has the public position');
  assert.equal(rp.final.status, 'finished');
  assert.equal(rp.final.winners.length, 1);
  assert.ok(Array.isArray(rp.final.adjustments));
});

test('server files load in any order (Apps Script gives no ordering promise)', () => {
  const ctx = vm.createContext({ console, JSON, Math, Date, Number, String, Array, Object });
  for (const f of serverFiles().slice().reverse()) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  assert.ok(ctx.GN.matches && ctx.GN.tables && ctx.GN.api && ctx.GN.identity);
});
