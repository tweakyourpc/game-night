/**
 * The lobby (catalog, open tables, ongoing matches, who's here) and the single polling
 * call, sync(), which answers for lobby + table + match in one round trip and reads the
 * spreadsheet only when a cache hint says something changed (or the hint is missing).
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.lobby = (function () {
  function store() { return GN.deps.store; }

  function lobbyData(me) {
    var members = GN.identity.members();
    var names = {};
    members.forEach(function (m) { names[m.id] = m.name; });
    var tables = store().list('Tables').filter(function (t) { return t.status !== 'closed'; });
    var matches = store().list('Matches', { index: true });
    var active = matches.filter(function (m) { return m.status === 'active'; });
    var here = GN.sync.here('lobby', me.id, members.map(function (m) { return m.id; }));
    return {
      group: store().setting('group_name') || GN.NAMES.platform,
      platform: GN.NAMES.platform,
      code: store().setting('entry_code'),
      mode: GN.identity.mode(),
      me: Object.assign(GN.identity.publicMember(members.filter(function (m) { return m.id === me.id; })[0] || me),
        { email: me.email || '' }),
      members: members.map(GN.identity.publicMember),
      here: here,
      catalog: GN.catalog.describe(),
      themes: GN.catalog.themes(),
      tables: tables.sort(function (a, b) { return b.updated - a.updated; }).map(function (t) {
        var g = GN.catalog.game(t.game_id);
        return {
          id: t.id, title: t.title, game_id: t.game_id, game_name: GN.NAMES.games[t.game_id] || t.game_id,
          theme_id: t.theme_id, host: names[t.host_id] || '(unknown)', host_id: t.host_id, status: t.status,
          seats: t.seats.map(function (s) { return { member_id: s.member_id, name: names[s.member_id] || '(unknown)', ready: !!s.ready }; }),
          players: g.players, inviteOnly: !!t.options.inviteOnly,
          invited: (t.invited.members || []).indexOf(me.id) >= 0, meet: !!t.meet_url,
          current_match_id: t.current_match_id, updated: t.updated, created: t.created, match_count: t.match_count,
        };
      }),
      matches: active.map(function (m) {
        return { id: m.id, table_id: m.table_id, game_id: m.game_id, summary: m.summary, updated: m.updated,
          players: m.players, mine: (m.players || []).some(function (p) { return p.id === me.id; }) };
      }),
    };
  }

  return {
    get: function (token) {
      var me = GN.identity.auth(token);
      return { ok: true, v: GN.sync.lobbyVersion(), lobby: lobbyData(me) };
    },

    /**
     * want = { lobby: knownVersion?, table: {id, rev}?, match: {id, rev}? }
     * Each part comes back as {changed: false} or with fresh data.
     */
    sync: function (token, want) {
      want = want && typeof want === 'object' ? want : {};
      var me = GN.identity.auth(token);
      var out = { ok: true, at: GN.deps.now() };
      if (want.lobby !== undefined) {
        var v = GN.sync.lobbyVersion();
        out.lobby = want.lobby === v ? { changed: false, v: v } : { changed: true, v: v, lobby: lobbyData(me) };
      }
      if (want.table && GN.util.isId(want.table.id)) {
        var th = GN.sync.hint('t:' + want.table.id);
        if (th && th.rev === want.table.rev) {
          // presence uses the seat list the page already has, so an idle poll reads no sheet
          var seatIds = Array.isArray(want.table.seats) ? want.table.seats.filter(function (x) { return GN.util.isId(x); }).slice(0, 8) : [];
          out.table = { changed: false, rev: th.rev, here: GN.sync.here('t:' + want.table.id, me.id, seatIds) };
        } else {
          var r = GN.tables.get(token, want.table.id);
          GN.sync.publish('t:' + r.table.id, { rev: r.table.rev, status: r.table.status });
          out.table = { changed: r.table.rev !== want.table.rev, rev: r.table.rev, table: r.table,
            here: r.table.seats.filter(function (s) { return s.here; }).map(function (s) { return s.member_id; }) };
        }
      }
      if (want.match && GN.util.isId(want.match.id)) {
        var mh = GN.sync.hint('m:' + want.match.id);
        if (mh && mh.rev === want.match.rev) {
          out.match = { changed: false, rev: mh.rev };
        } else {
          var m = GN.matches.load(want.match.id);
          GN.sync.publish('m:' + m.id, { rev: m.rev, status: m.status });
          out.match = m.rev === want.match.rev ? { changed: false, rev: m.rev }
            : { changed: true, rev: m.rev, match: GN.matches.viewFor(m, me) };
        }
        var pids = Array.isArray(want.match.players) ? want.match.players.filter(function (x) { return GN.util.isId(x); }).slice(0, 8) : [];
        out.match.here = GN.sync.here('m:' + want.match.id, me.id, pids);
      }
      return out;
    },
  };
})();
