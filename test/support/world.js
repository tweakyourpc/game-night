// A ready-made group for tests: the server code loaded, simulated services, an admin,
// and helpers to join players, open tables and play.
'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { loadServer } = require('./load.js');
const { makeDeps } = require('./memstore.js');

loadServer([path.join(__dirname, 'racegame.js')]);

const aid = () => crypto.randomBytes(9).toString('hex');

function world(opts = {}) {
  const deps = makeDeps(opts);
  GN.deps = deps;
  // keep opportunistic maintenance out of the way unless a test asks for it
  deps.cache.put('maint:last', { at: 0 });
  GN.install.initialize({ groupName: 'The Testers', code: 'maple owl', adminName: 'Ann', adminPin: '1234',
    identityMode: opts.mode || 'trusted' });
  const tokens = {};
  const join = (name, pin) => {
    const r = GN.identity.join('maple owl', { name, pin }, 'test');
    if (!r.ok) throw new Error(r.error);
    tokens[name] = r.token;
    return r.token;
  };
  const ann = GN.identity.join('maple owl', { memberId: GN.identity.members()[0].id, pin: '1234' }, 'test');
  tokens.Ann = ann.token;
  const idOf = (name) => GN.identity.members().find((m) => m.name === name).id;
  const req = (rev) => ({ expectedRevision: rev, actionId: aid() });
  // call through the public API, as the browser does (errors come back as {ok:false})
  const call = (method, ...args) => GN.api.handle(method, args);
  /** Open a table for `game` with the given players seated and ready; returns the started match. */
  function play(game, names, options) {
    const host = tokens[names[0]];
    let t = call('createTable', host, { gameId: game, options: options || {} }, aid()).table;
    for (const n of names.slice(1)) t = call('sit', tokens[n], t.id, req(t.rev)).table;
    for (const n of names) t = call('ready', tokens[n], t.id, req(t.rev), true).table;
    const s = call('start', host, t.id, req(t.rev));
    if (!s.ok) throw new Error(s.error);
    const m = call('match', host, s.table.current_match_id).match;
    return { table: s.table, match: m };
  }
  /** The token of whoever must act now in match id. */
  const actor = (matchId) => {
    const m = GN.deps.store.get('Matches', matchId);
    const who = GN.games[m.game_id].actors(m.state)[0];
    return Object.keys(tokens).map((n) => [n, tokens[n]]).find(([n]) => idOf(n) === who)[1];
  };
  const act = (token, matchId, action) => {
    const m = GN.deps.store.get('Matches', matchId);
    return call('act', token, matchId, action, req(m.rev));
  };
  return { deps, GN: globalThis.GN, tokens, join, idOf, req, call, play, actor, act, aid };
}

module.exports = { world, aid };
