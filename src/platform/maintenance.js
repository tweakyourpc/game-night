/**
 * Repair work that a failure interrupted, and replays.
 *
 * maintain() is run by the optional 10-minute trigger and, at most every few minutes,
 * opportunistically by ordinary requests, so installations without the trigger still
 * heal. Everything it does is idempotent.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.maintenance = (function () {
  function store() { return GN.deps.store; }

  function run(limit) {
    var fixed = { matches: 0, tables: 0, sent: 0 };
    var lagging = store().list('Matches', { index: true }).filter(function (m) { return m.done_rev < m.rev; })
      .slice(0, limit || 10);
    lagging.forEach(function (idx) {
      GN.deps.withLock(function () {
        store().refresh();
        var m = store().get('Matches', idx.id);
        if (m && m.done_rev < m.rev && GN.matches.followupsQuietly(m)) fixed.matches++;
      });
    });
    // tables still marked playing after their match ended (release failed and done_rev somehow caught up)
    GN.deps.withLock(function () {
      store().refresh();
      var byId = {};
      store().list('Matches', { index: true }).forEach(function (m) { byId[m.id] = m; });
      store().list('Tables').forEach(function (t) {
        var m = byId[t.current_match_id];
        if (t.status === 'playing' && m && m.status !== 'active' && GN.tables.release(m)) fixed.tables++;
      });
    });
    if (GN.files) GN.files.cleanup();
    var s = GN.outbox.flushQuietly();
    fixed.sent = s ? s.sent : 0;
    return fixed;
  }

  /** At most once every 5 minutes, piggybacking on a normal request. */
  function opportunistic() {
    var flag = GN.sync.hint('maint:last');
    if (flag) return null;
    GN.sync.publish('maint:last', { at: GN.deps.now() });
    try { GN.deps.cache.put('maint:last', { at: GN.deps.now() }, 300); } catch (e) { /* best effort */ }
    try { return run(3); } catch (e) { GN.deps.log('maintenance: ' + (e && e.message)); return null; }
  }

  return { run: run, opportunistic: opportunistic };
})();

/**
 * Replay format v1 (docs/replay-format.md): public events only, with stable player ids,
 * display-name snapshots, game and rules versions, and explicit final adjustments.
 * Built from the Events log, so it never re-runs rules or rerolls dice.
 */
GN.replay = {
  FORMAT: 'game-night-replay',
  VERSION: 1,
  build: function (token, matchId) {
    var me = GN.identity.auth(token);
    var m = GN.matches.load(matchId);
    if (m.done_rev < m.rev) {
      GN.deps.withLock(function () {
        GN.deps.store.refresh();
        var fresh = GN.matches.load(matchId);
        GN.matches.followupsQuietly(fresh);
        m = fresh;
      });
    }
    var events = GN.deps.store.list('Events', { where: { match_id: m.id } })
      .sort(function (a, b) { return a.seq - b.seq; })
      .map(function (e) { return { seq: e.seq, rev: e.rev, actor: e.actor, type: e.type, at: e.at, public: e.public }; });
    var table = GN.deps.store.get('Tables', m.table_id);
    var r = m.result || {};
    return {
      ok: true,
      replay: {
        format: GN.replay.FORMAT, version: GN.replay.VERSION,
        platform: GN.NAMES.platform,
        game: { id: m.game_id, name: GN.NAMES.games[m.game_id] || m.game_id, version: m.game_version,
          rulesVersion: m.rules_version, schemaVersion: m.schema_version },
        theme: { id: m.theme_id },
        match: { id: m.id, table: m.table_id, tableTitle: table ? table.title : '', started: m.created,
          ended: m.status === 'active' ? null : m.updated, status: m.status },
        players: m.players.map(function (p) { return { id: p.id, name: p.name }; }),
        options: m.options,
        events: events,
        final: m.status === 'active' ? null : {
          status: m.status, winners: r.winners || [], scores: r.scores || null,
          adjustments: r.adjustments || [], reason: r.reason || null,
        },
        exportedBy: me.id,
      },
    };
  },
};
