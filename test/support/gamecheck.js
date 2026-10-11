// Integration checks every game must pass, run through the public API with simulated
// services: two sessions converge, a stale move is refused, a retried move happens
// once, a new sign-in sees the same game, a finished game refuses moves, and the
// finished match updates stats, frees the table and produces a replay.
//
// spec = {
//   game, names, options,
//   legal(w, matchId, token, view) -> an action the current actor may take now,
//   finish(w, matchId)              -> drive the match to its end (any legal way),
//   secret?(view) -> value that only its owner may see (checked against others' views)
// }
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('./world.js');

function standardChecks(spec) {
  const names = spec.names || ['Ann', 'Bob'];
  const setup = () => {
    const w = world();
    if (spec.services) Object.assign(w.deps.services, spec.services);
    names.slice(1).forEach((n) => w.join(n));
    const { table, match } = w.play(spec.game, names, spec.options || {});
    return { w, table, match };
  };
  const nameOf = (w, id) => names.find((n) => w.idOf(n) === id);
  const turnOf = (w, matchId) => {
    const m = w.call('match', w.tokens.Ann, matchId).match;
    const who = nameOf(w, m.actors[0]);
    return { m, who, token: w.tokens[who] };
  };
  const label = spec.game + ': ';

  test(label + 'both sessions converge after a move', () => {
    const { w, match } = setup();
    const { m, token } = turnOf(w, match.id);
    const mine = w.call('match', token, match.id).match;
    const r = w.call('act', token, match.id, spec.legal(w, match.id, token, mine.view), w.req(m.rev));
    assert.equal(r.ok, true, r.error);
    const views = names.map((n) => w.call('match', w.tokens[n], match.id).match);
    views.forEach((v) => assert.equal(v.rev, r.match.rev));
    const strip = (v) => { const o = Object.assign({}, v); if (spec.secret) delete o[spec.secretKey]; return o; };
    assert.equal(JSON.stringify(strip(views[0].view)), JSON.stringify(strip(views[1].view)), 'public parts agree');
    // a polling session sees the change through sync too
    const s = w.call('sync', w.tokens[names[1]], { match: { id: match.id, rev: m.rev } });
    assert.equal(s.match.changed, true);
    assert.equal(s.match.rev, r.match.rev);
  });

  test(label + 'a stale move is refused and changes nothing', () => {
    const { w, match } = setup();
    const { m, token } = turnOf(w, match.id);
    const mine = w.call('match', token, match.id).match;
    const action = spec.legal(w, match.id, token, mine.view);
    const r = w.call('act', token, match.id, action, w.req(m.rev + 5));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'STALE');
    assert.equal(w.call('match', token, match.id).match.rev, m.rev);
  });

  test(label + 'a retried move (same actionId) happens once', () => {
    const { w, match } = setup();
    const { m, token } = turnOf(w, match.id);
    const mine = w.call('match', token, match.id).match;
    const action = spec.legal(w, match.id, token, mine.view);
    const req = w.req(m.rev);
    const a = w.call('act', token, match.id, action, req);
    const b = w.call('act', token, match.id, action, req);
    assert.equal(a.ok, true, a.error);
    assert.equal(b.ok, true);
    assert.equal(b.duplicate, true);
    assert.deepEqual(b.response, a.response);
    assert.equal(w.call('match', token, match.id).match.rev, m.rev + 1);
    const events = w.deps.store.list('Events', { where: { match_id: match.id } });
    assert.equal(new Set(events.map((e) => e.seq)).size, events.length, 'no duplicate events');
  });

  test(label + 'out-of-turn and malformed moves are refused', () => {
    const { w, match } = setup();
    const { m, who, token } = turnOf(w, match.id);
    const mine = w.call('match', token, match.id).match;
    const action = spec.legal(w, match.id, token, mine.view);
    if (m.actors.length < names.length) {
      const other = names.find((n) => n !== who && m.actors.indexOf(w.idOf(n)) < 0);
      const r = w.call('act', w.tokens[other], match.id, action, w.req(m.rev));
      assert.equal(r.ok, false);
    }
    for (const bad of [{ type: 'nonsense' }, { type: action.type, junk: 'x'.repeat(5000) }]) {
      const r = w.call('act', token, match.id, bad, w.req(m.rev));
      assert.equal(r.ok, false);
    }
    assert.equal(w.call('match', token, match.id).match.rev, m.rev);
  });

  test(label + 'a new sign-in on another device sees the same game', () => {
    const { w, match } = setup();
    const before = w.call('match', w.tokens[names[1]], match.id).match;
    const pin = names[1] === 'Ann' ? '1234' : undefined;
    const r = GN.identity.join('maple owl', { memberId: w.idOf(names[1]), pin }, 'second device');
    assert.equal(r.ok, true, r.error);
    const after = w.call('match', r.token, match.id).match;
    assert.deepEqual(after, before);
  });

  if (spec.secret) {
    test(label + 'hidden information stays with its owner', () => {
      const { w, match } = setup();
      const views = names.map((n) => w.call('match', w.tokens[n], match.id).match.view);
      views.forEach((v) => assert.notEqual(spec.secret(v), null, 'each player sees their own'));
      // the raw secret of each player, straight from the state
      const state = w.deps.store.get('Matches', match.id).state;
      names.forEach((n, i) => {
        const own = JSON.stringify(spec.secret(views[i]));
        assert.equal(own, JSON.stringify(spec.secretOf(state, w.idOf(n))));
      });
      // spectators and replays see none of it
      w.join('Cy');
      const spec2 = w.call('match', w.tokens.Cy, match.id).match;
      assert.equal(spec2.spectator, true);
      assert.equal(spec.secret(spec2.view), null);
      const events = w.deps.store.list('Events', { where: { match_id: match.id } });
      assert.equal(spec.secret(events[0].public.snapshot), null);
    });
  }

  test(label + 'a finished game: result, stats, table freed, replay, no more moves', () => {
    const { w, table, match } = setup();
    spec.finish(w, match.id);
    const m = w.call('match', w.tokens.Ann, match.id).match;
    assert.equal(m.status, 'finished');
    assert.ok(Array.isArray(m.result.winners));
    assert.ok(Array.isArray(m.result.adjustments));
    const r = w.call('act', w.tokens.Ann, match.id, { type: 'pass' }, w.req(m.rev));
    assert.equal(r.ok, false);
    assert.equal(r.code, 'OVER');
    const t = w.call('table', w.tokens.Ann, table.id).table;
    assert.equal(t.status, 'open');
    assert.ok(t.seats.every((s) => !s.ready), 'everyone must ready again');
    const me = w.call('lobby', w.tokens.Ann).lobby.me;
    assert.equal(me.stats.played, 1);
    assert.equal(me.stats.games[spec.game].played, 1);
    const rp = w.call('replay', w.tokens.Bob, match.id).replay;
    assert.equal(rp.game.id, spec.game);
    assert.equal(rp.game.rulesVersion, GN.games[spec.game].rulesVersion);
    assert.equal(rp.events[0].type, 'start');
    rp.events.forEach((e, i) => assert.equal(e.seq, i, 'events are contiguous'));
    for (let rev = 0; rev <= m.rev; rev++) assert.ok(rp.events.some((e) => e.rev === rev), 'every revision has events');
    assert.ok(rp.events[rp.events.length - 1].public.snapshot, 'last event carries the final position');
    assert.deepEqual(rp.final.winners, m.result.winners);
    if (spec.secret) rp.events.forEach((e) => assert.equal(spec.secret(e.public.snapshot || {}), null, 'replays hold no secrets'));
  });
}

module.exports = { standardChecks };
