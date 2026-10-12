/**
 * Matches: one game's authoritative state, driven by the game's rules object.
 *
 * Commit rule for every action:
 *   lock -> reload -> authenticate -> duplicate? (same actionId: return the stored
 *   result and re-run follow-ups) -> stale? (revision differs: refuse, change nothing)
 *   -> rules apply on a copy -> invalidate cache hint -> save the row (THE COMMIT)
 *   -> follow-ups.
 *
 * Follow-ups are idempotent and tracked by done_rev, so a failure in any of them is
 * repaired by the next retry or by maintenance, without doubling anything:
 *   events (keyed match:seq), derived stats (recomputed, not incremented),
 *   table release (only if still pointing at this match), emails (keyed),
 *   cache hints, then done_rev = rev.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.matches = (function () {
  var KEEP = 60;          // committed actions remembered per match (duplicates + event backlog)
  var MAX_ACTION = 4000;  // characters of JSON an action may have

  function store() { return GN.deps.store; }
  function now() { return GN.deps.now(); }

  function load(id) {
    if (!GN.util.isId(id)) GN.fail('Game not found.', 'NOT_FOUND');
    var m = store().get('Matches', id);
    if (!m) GN.fail('Game not found.', 'NOT_FOUND');
    return m;
  }

  function nameOf(id) {
    var mem = store().get('Members', id);
    return mem ? mem.name : '(unknown)';
  }

  function ctxFor(m) {
    return { rng: GN.deps.rng, now: now(), services: GN.deps.services, options: m.options,
      players: m.players.map(function (p) { return p.id; }) };
  }

  function isPlayer(m, memberId) {
    return m.players.some(function (p) { return p.id === memberId; });
  }

  function nextSeq(m) {
    var max = -1;
    (m.actions || []).forEach(function (a) {
      if (a.lastSeq > max) max = a.lastSeq;
      (a.events || []).forEach(function (e) { if (e.seq > max) max = e.seq; });
    });
    return max + 1;
  }

  /** What one viewer may see. Spectators (non-players) get the game's public view. */
  function viewFor(m, member) {
    var g = GN.catalog.game(m.game_id);
    var viewer = member && isPlayer(m, member.id) ? member.id : null;
    return {
      id: m.id, table_id: m.table_id, game_id: m.game_id, game_version: m.game_version,
      rules_version: m.rules_version, theme_id: m.theme_id, options: m.options, players: m.players,
      status: m.status, rev: m.rev, result: m.result, summary: m.summary,
      actors: m.status === 'active' ? g.actors(m.state) : [],
      me: member ? member.id : null, spectator: !viewer,
      view: g.view(m.state, viewer),
    };
  }

  // ------------------------------------------------------------------ creation

  /**
   * Create a table's next match. The id is deterministic (<table>-<n>), so if the
   * table update after this fails, the retry finds this match instead of making
   * another. Lock must be held.
   */
  function createForTable(table, matchId) {
    var existing = store().get('Matches', matchId);
    if (existing) return existing;
    var g = GN.catalog.game(table.game_id);
    var players = table.seats.map(function (s) { return { id: s.member_id, name: s.bot ? 'Computer' : nameOf(s.member_id), bot: !!s.bot }; });
    var opts = GN.catalog.options(g, table.options && table.options.game);
    var ctx = { rng: GN.deps.rng, now: now(), services: GN.deps.services, options: opts,
      players: players.map(function (p) { return p.id; }) };
    var state = g.setup(ctx);
    var m = {
      id: matchId, table_id: table.id, game_id: g.id, game_version: g.version, rules_version: g.rulesVersion,
      schema_version: GN.SCHEMA_VERSION, theme_id: table.theme_id, options: opts, players: players,
      status: 'active', rev: 0, done_rev: -1, summary: g.summary(state, players), result: null,
      created: now(), updated: now(), state: state,
      actions: [{ id: 'start', player: table.host_id, rev: 0, at: now(), response: {},
        events: [{ seq: 0, type: 'start', actor: table.host_id, public: { snapshot: g.view(state, null) } }] }],
    };
    store().put('Matches', m);
    return m;
  }

  // ------------------------------------------------------------------ follow-ups

  /** Idempotent post-commit work. Lock must be held. Throws on failure (done_rev stays behind). */
  function followups(m) {
    if (m.done_rev >= m.rev) return false;
    (m.actions || []).filter(function (a) { return a.rev > m.done_rev; }).forEach(function (a) {
      (a.events || []).forEach(function (e) {
        store().insert('Events', { key: m.id + ':' + e.seq, match_id: m.id, seq: e.seq, rev: a.rev,
          actor: e.actor || a.player, type: e.type, public: e.public || {}, at: a.at || m.updated });
      });
    });
    if (m.status !== 'active') {
      GN.stats.recompute(m.players.filter(function (p) { return !p.bot; }).map(function (p) { return p.id; }));
      GN.tables.release(m);
    }
    GN.notify.afterMatch(m);
    GN.sync.publish('m:' + m.id, { rev: m.rev, status: m.status });
    GN.sync.touch('lobby');
    // events now live in the Events tab; keep only their last seq (a sheet cell holds 50,000 characters)
    (m.actions || []).forEach(function (a) {
      if (!a.events) return;
      a.lastSeq = a.events.reduce(function (x, e) { return Math.max(x, e.seq); }, a.lastSeq >= 0 ? a.lastSeq : -1);
      delete a.events;
    });
    m.done_rev = m.rev;
    store().put('Matches', m);
    return true;
  }

  function followupsQuietly(m) {
    try { return followups(m); } catch (e) { GN.deps.log('followups ' + m.id + ': ' + (e && e.message)); return false; }
  }

  // ------------------------------------------------------------------ actions

  function commitMove(m, actor, action, req, me) {
      var done = GN.util.findAction(m.actions, req.actionId);
      if (done) {
        if (done.player !== actor) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
        followupsQuietly(m);
        return { ok: true, duplicate: true, rev: done.rev, response: done.response || {}, match: viewFor(m, me) };
      }
      if (req.expectedRevision !== m.rev) {
        return { ok: false, code: 'STALE', match: viewFor(m, me),
          error: 'The game changed before your move arrived, so it was not played. Check the board and try again.' };
      }
      if (m.status !== 'active') GN.fail('This game is over.', 'OVER');
      var g = GN.catalog.game(m.game_id);
      var anytime = (g.anytime || []).indexOf(action.type) >= 0;
      if (!anytime && g.actors(m.state).indexOf(actor) < 0) GN.fail("It's not your turn.", 'NOT_YOUR_TURN');
      var res = g.apply(GN.util.clone(m.state), actor, GN.util.clone(action), ctxFor(m));
      if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'ILLEGAL', error: (res && res.error) || 'That move is not allowed.' };

      GN.sync.invalidate('m:' + m.id);
      var rev = m.rev + 1, seq = nextSeq(m), at = now();
      var events = (res.events && res.events.length ? res.events : [{ type: action.type, public: {} }]).map(function (e, i) {
        return { seq: seq + i, type: e.type, actor: actor, public: GN.util.clone(e.public || {}) };
      });
      // the public position after the action, so replays never re-run the rules
      events[events.length - 1].public.snapshot = g.view(res.state, null);
      m.state = res.state;
      m.rev = rev;
      m.updated = at;
      m.summary = g.summary(res.state, m.players);
      if (res.result) {
        m.status = res.result.status === 'abandoned' ? 'abandoned' : 'finished';
        m.result = res.result;
      }
      m.actions = GN.util.remember(m.actions, { id: req.actionId, player: actor, rev: rev, at: at,
        response: res.response || {}, events: events }, KEEP);
      store().put('Matches', m);                       // the commit point
      followupsQuietly(m);
      GN.sync.here('m:' + m.id, me.id, []);            // only the requesting human is here
      GN.sync.here('t:' + m.table_id, me.id, []);
      return { ok: true, rev: rev, response: res.response || {}, match: viewFor(m, me) };
  }

  function act(token, matchId, action, req) {
    GN.util.checkReq(req);
    if (/^bot_/.test(req.actionId)) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
    if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string' ||
        GN.util.jsonSize(action) > MAX_ACTION) GN.fail('That move could not be read. Please reload.', 'BAD_REQUEST');
    var out = GN.deps.withLock(function () {
      store().refresh();
      var me = GN.identity.auth(token), m = load(matchId);
      if (!isPlayer(m, me.id)) GN.fail('You are not playing in this game.', 'FORBIDDEN');
      return commitMove(m, me.id, action, req, me);
    });
    if (out.ok && !out.duplicate) GN.outbox.flushQuietly();
    return out;
  }

  function botTurn(token, matchId, expectedRevision) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) GN.fail('Please reload the page.', 'BAD_REQUEST');
    var out = GN.deps.withLock(function () {
      store().refresh();
      var me = GN.identity.auth(token), m = load(matchId);
      if (!m.players.some(function (p) { return p.id === me.id && !p.bot; })) GN.fail('You are not playing in this game.', 'FORBIDDEN');
      var bot = m.players.filter(function (p) { return p.bot; })[0];
      if (!bot || !GN.bots || !GN.bots[m.game_id]) GN.fail('This game has no computer opponent.', 'BAD_REQUEST');
      var req = { expectedRevision: expectedRevision, actionId: 'bot_' + expectedRevision };
      var done = GN.util.findAction(m.actions, req.actionId);
      if (done) return commitMove(m, bot.id, {}, req, me);
      if (expectedRevision !== m.rev) return { ok: false, code: 'STALE', match: viewFor(m, me), error: 'The game changed a moment ago.' };
      if (m.status !== 'active' || GN.catalog.game(m.game_id).actors(m.state).indexOf(bot.id) < 0) GN.fail("It's not the computer's turn.", 'NOT_YOUR_TURN');
      var action = GN.bots[m.game_id].choose(m.state, bot.id, ctxFor(m));
      return commitMove(m, bot.id, action, req, me);
    });
    if (out.ok && !out.duplicate) GN.outbox.flushQuietly();
    return out;
  }

  /** A read-only question for the game (e.g. Wordwright's live score preview). */
  function query(token, matchId, q) {
    var me = GN.identity.auth(token);
    var m = load(matchId);
    if (!isPlayer(m, me.id)) GN.fail('You are not playing in this game.', 'FORBIDDEN');
    var g = GN.catalog.game(m.game_id);
    if (!g.query) GN.fail('This game has no questions to ask.', 'BAD_REQUEST');
    if (GN.util.jsonSize(q) > MAX_ACTION) GN.fail('That request is too large.', 'BAD_REQUEST');
    var r = g.query(m.state, me.id, GN.util.clone(q), ctxFor(m)) || {};
    r.rev = m.rev;
    return r;
  }

  function get(token, matchId) {
    var me = GN.identity.auth(token);
    var m = load(matchId);
    return { ok: true, match: viewFor(m, me) };
  }

  /** Ending a match early: any player may, at any time. No winner, no stats. */
  function abandon(token, matchId, req) {
    GN.util.checkReq(req);
    var out = GN.deps.withLock(function () {
      var store = GN.deps.store;
      store.refresh();
      var me = GN.identity.auth(token);
      var m = load(matchId);
      if (!isPlayer(m, me.id)) GN.fail('You are not playing in this game.', 'FORBIDDEN');
      var done = GN.util.findAction(m.actions, req.actionId);
      if (done) { followupsQuietly(m); return { ok: true, duplicate: true, match: viewFor(m, me) }; }
      if (req.expectedRevision !== m.rev) return { ok: false, code: 'STALE', match: viewFor(m, me), error: 'The game changed a moment ago.' };
      if (m.status !== 'active') GN.fail('This game is already over.', 'OVER');
      var g = GN.catalog.game(m.game_id);
      GN.sync.invalidate('m:' + m.id);
      var seq = nextSeq(m) - 1;
      m.rev = m.rev + 1;
      m.updated = GN.deps.now();
      m.status = 'abandoned';
      m.result = { status: 'abandoned', by: me.id, winners: [], adjustments: [] };
      m.summary = 'Ended early by ' + me.name;
      m.actions = GN.util.remember(m.actions, { id: req.actionId, player: me.id, rev: m.rev, at: m.updated, response: {},
        events: [{ seq: seq + 1, type: 'abandoned', actor: me.id, public: { snapshot: g.view(m.state, null) } }] }, 60);
      store.put('Matches', m);
      followupsQuietly(m);
      return { ok: true, match: viewFor(m, me) };
    });
    if (out.ok) GN.outbox.flushQuietly();
    return out;
  }

  return {
    act: act, botTurn: botTurn, abandon: abandon, query: query, get: get, load: load, viewFor: viewFor, createForTable: createForTable,
    followups: followups, followupsQuietly: followupsQuietly, isPlayer: isPlayer,
  };
})();

/** Statistics are derived from finished matches, so recomputing is always safe. */
GN.stats = {
  recompute: function (memberIds) {
    var store = GN.deps.store;
    var finished = store.list('Matches', { index: true }).filter(function (m) { return m.status === 'finished'; });
    memberIds.forEach(function (id) {
      var mem = store.get('Members', id);
      if (!mem) return;
      var s = { played: 0, wins: 0, games: {} };
      finished.forEach(function (m) {
        if (!(m.players || []).some(function (p) { return p.id === id; })) return;
        var gs = s.games[m.game_id] = s.games[m.game_id] || { played: 0, wins: 0 };
        var r = m.result || {};
        s.played++; gs.played++;
        if ((r.winners || []).indexOf(id) >= 0) { s.wins++; gs.wins++; }
        if (r.scores && typeof r.scores[id] === 'number') gs.best = Math.max(gs.best === undefined ? -Infinity : gs.best, r.scores[id]);
      });
      mem.stats = s;
      store.put('Members', mem);
    });
  },
};

/** Emails caused by a match revision. Keys make queuing repeatable without resending. */
GN.notify = {
  afterMatch: function (m) {
    var store = GN.deps.store;
    var table = store.get('Tables', m.table_id);
    var link = GN.deps.appUrl() + (table ? '?t=' + encodeURIComponent(table.share_key) : '');
    var gameName = GN.NAMES.games[m.game_id] || m.game_id;
    var group = store.setting('group_name') || GN.NAMES.platform;
    var esc = GN.util.esc;
    var turnEmails = /^(yes|y|on|true)$/i.test(store.setting('turn_emails'));
    var g = GN.catalog.game(m.game_id);
    m.players.forEach(function (p) {
      var mem = store.get('Members', p.id);
      if (!mem || !mem.email) return;
      var subject = null, body = null, key = null;
      if (m.rev === 0) {
        if (table && p.id === table.host_id) return;
        key = 'start:' + m.id + ':' + p.id;
        subject = group + ': ' + gameName + ' has started';
        body = 'A game of ' + gameName + ' started at ' + (table ? table.title : 'your table') + '.';
      } else if (turnEmails && m.status !== 'active') {
        key = m.id + ':' + m.rev + ':' + p.id;
        subject = group + ': ' + gameName + ' is over';
        body = m.summary || 'The game has finished.';
      } else if (turnEmails && g.actors(m.state).indexOf(p.id) >= 0) {
        var last = m.actions[m.actions.length - 1];
        if (last && last.player === p.id) return;        // they're still moving; no email to themselves
        key = m.id + ':' + m.rev + ':' + p.id;
        subject = group + ': your turn in ' + gameName;
        body = m.summary || "It's your turn.";
      }
      if (!key) return;
      GN.outbox.queue(key, mem.email, subject,
        '<p>' + esc(body) + '</p><p><a href="' + esc(link) + '">Open the table</a></p>');
    });
  },
};
