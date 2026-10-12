/**
 * Tables: a gathering that outlives its matches (seats, host, readiness, invitations,
 * Meet link, current and previous matches).
 *
 *  - Presence is display-only: losing it never removes a seat or moves the host.
 *  - Starting needs the seat count within the game's limits and everyone seated ready.
 *    Manual start by the host is the default; autostart is an explicit option.
 *  - When a match ends the table returns to "open" with the same seats and Meet link,
 *    and readiness is reset so the next game (rematch or a different game) is
 *    confirmed again.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.tables = (function () {
  function store() { return GN.deps.store; }
  function now() { return GN.deps.now(); }

  function load(id) {
    if (!GN.util.isId(id)) GN.fail('Table not found.', 'NOT_FOUND');
    var t = store().get('Tables', id);
    if (!t || t.status === 'closed') GN.fail('That table has closed.', 'NOT_FOUND');
    return t;
  }

  function seated(t, memberId) { return t.seats.some(function (s) { return s.member_id === memberId; }); }

  function invitedOk(t, memberId) {
    return !t.options.inviteOnly || t.host_id === memberId || (t.invited.members || []).indexOf(memberId) >= 0;
  }

  /** Why the table can't start right now, or null if it can. */
  function startBlock(t) {
    var g = GN.catalog.game(t.game_id);
    var n = t.seats.length;
    var name = GN.NAMES.games[g.id] || g.id;
    if (t.status !== 'open') return 'A game is already in progress.';
    if (n < g.players.min) return name + ' needs at least ' + g.players.min + ' players.';
    if (n > g.players.max) return name + ' allows at most ' + g.players.max + ' players.';
    var waiting = t.seats.filter(function (s) { return !s.ready; });
    if (waiting.length) return 'Waiting for everyone to be ready.';
    return null;
  }

  function nameOf(id) {
    var m = store().get('Members', id);
    return m ? m.name : '(unknown)';
  }
  function seatName(s) { return s.bot ? 'Computer' : nameOf(s.member_id); }

  function view(t, me, opts) {
    var g = GN.catalog.game(t.game_id);
    var ids = t.seats.map(function (s) { return s.member_id; });
    var here = opts && opts.here ? opts.here : [];
    var matches = store().list('Matches', { index: true, where: { table_id: t.id } })
      .sort(function (a, b) { return b.created - a.created; })
      .map(function (m) {
        return { id: m.id, game_id: m.game_id, status: m.status, summary: m.summary, created: m.created,
          updated: m.updated, result: m.result };
      });
    return {
      id: t.id, share_key: t.share_key, title: t.title, host_id: t.host_id, game_id: t.game_id,
      game_name: GN.NAMES.games[t.game_id] || t.game_id, players: t.seats.some(function (s) { return s.bot; }) ? { min: 2, max: 2 } : g.players, theme_id: t.theme_id,
      options: t.options, status: t.status, current_match_id: t.current_match_id, match_count: t.match_count,
      rev: t.rev, created: t.created, updated: t.updated, meet_url: t.meet_url || '',
      seats: t.seats.map(function (s) {
        return { member_id: s.member_id, name: seatName(s), bot: !!s.bot, ready: !!s.ready,
          here: !s.bot && here.indexOf(s.member_id) >= 0, host: s.member_id === t.host_id };
      }),
      invited: { members: (t.invited.members || []).map(function (id) { return { id: id, name: nameOf(id) }; }),
        emails: (t.invited.emails || []).length },
      startBlock: startBlock(t),
      matches: matches,
      me: me ? me.id : null,
      seated: me ? ids.indexOf(me.id) >= 0 : false,
      link: GN.deps.appUrl() + '?t=' + encodeURIComponent(t.share_key),
    };
  }

  /** Commit a change to one table (see matches.js for the rule). */
  function mutate(token, tableId, req, fn) {
    GN.util.checkReq(req);
    var out = GN.deps.withLock(function () {
      store().refresh();
      var me = GN.identity.auth(token);
      var t = load(tableId);
      var done = GN.util.findAction(t.actions, req.actionId);
      if (done) {
        if (done.player !== me.id) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
        repairStart(t);
        return { ok: true, duplicate: true, table: view(t, me), result: done.result || {} };
      }
      if (req.expectedRevision !== t.rev) {
        return { ok: false, code: 'STALE', table: view(t, me),
          error: 'The table changed a moment ago. Check it and try again.' };
      }
      var work = GN.util.clone(t);
      var result = fn(work, me) || {};
      GN.sync.invalidate('t:' + t.id);
      work.rev = t.rev + 1;
      work.updated = now();
      work.actions = GN.util.remember(work.actions, { id: req.actionId, player: me.id, rev: work.rev, result: result }, 40);
      store().put('Tables', work);                          // the commit point
      afterTable(work);
      GN.sync.here('t:' + work.id, me.id, []);              // acting counts as being here
      return { ok: true, table: view(work, me), result: result };
    });
    if (out.ok && !out.duplicate) GN.outbox.flushQuietly();
    return out;
  }

  /** Post-commit, idempotent: match follow-ups for a new match, cache hints. */
  function afterTable(t) {
    try {
      if (t.current_match_id) {
        var m = store().get('Matches', t.current_match_id);
        if (m) GN.matches.followupsQuietly(m);
      }
      GN.sync.publish('t:' + t.id, { rev: t.rev, status: t.status });
      GN.sync.touch('lobby');
    } catch (e) { GN.deps.log('afterTable: ' + (e && e.message)); }
  }

  /** A retried start whose table update had committed: make sure the match follow-ups ran. */
  function repairStart(t) {
    if (!t.current_match_id) return;
    var m = store().get('Matches', t.current_match_id);
    if (m) GN.matches.followupsQuietly(m);
  }

  function doStart(work, me) {
    var why = startBlock(work);
    if (why) GN.fail(why, 'CANNOT_START');
    var matchId = work.id + '-' + (work.match_count + 1);
    GN.matches.createForTable(work, matchId);      // reuses the match if a retry already made it
    work.status = 'playing';
    work.current_match_id = matchId;
    work.match_count = work.match_count + 1;
    return { matchId: matchId };
  }

  function maybeAutostart(work, me) {
    if (work.options.autostart && !startBlock(work)) return doStart(work, me);
    return {};
  }

  function requireHost(t, me) {
    if (t.host_id !== me.id) GN.fail('Only the host can do that.', 'FORBIDDEN');
  }

  function cleanTitle(s, fallback) {
    var t = typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    return t || fallback;
  }

  return {
    view: view,
    startBlock: startBlock,

    create: function (token, spec, actionId) {
      if (typeof actionId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(actionId)) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
      spec = spec && typeof spec === 'object' ? spec : {};
      if (GN.util.jsonSize(spec) > 4000) GN.fail('That request is too large.', 'BAD_REQUEST');
      return GN.deps.withLock(function () {
        store().refresh();
        var me = GN.identity.auth(token);
        var prior = store().list('Tables').filter(function (x) {
          return x.created_action === actionId && x.host_id === me.id;
        })[0];
        if (prior) { repairStart(prior); return { ok: true, duplicate: true, table: view(prior, me) }; }
        var g = GN.catalog.game(spec.gameId);
        if (spec.computer && g.id !== 'wordwright') GN.fail('This game has no computer opponent.', 'BAD_REQUEST');
        var computer = spec.computer === true;
        var t = {
          id: GN.deps.newId(10), share_key: GN.deps.newId(16),
          title: cleanTitle(spec.title, me.name + "'s table"), host_id: me.id, game_id: g.id,
          theme_id: GN.catalog.theme(spec.themeId),
          options: { game: GN.catalog.options(g, spec.options), autostart: spec.autostart === true,
            inviteOnly: computer || spec.inviteOnly === true },
          seats: [{ member_id: me.id, ready: computer, joined_at: now() }],
          invited: { members: [], emails: [] }, meet_url: '', status: 'open', current_match_id: '',
          match_count: 0, rev: 0, created_action: actionId, created: now(), updated: now(), actions: [],
        };
        if (computer) {
          t.options.game.dictionary = true;
          t.seats.push({ member_id: t.id + '-bot', bot: true, ready: true, joined_at: now() });
          var matchId = t.id + '-1';
          GN.matches.createForTable(t, matchId);
          t.status = 'playing'; t.current_match_id = matchId; t.match_count = 1;
        }
        store().put('Tables', t);
        if (computer) GN.matches.followupsQuietly(store().get('Matches', t.current_match_id));
        GN.sync.publish('t:' + t.id, { rev: 0, status: 'open' });
        GN.sync.touch('lobby');
        return { ok: true, table: view(t, me) };
      });
    },

    get: function (token, tableId) {
      var me = GN.identity.auth(token);
      var t = load(tableId);
      var here = GN.sync.here('t:' + t.id, me.id, t.seats.map(function (s) { return s.member_id; }));
      return { ok: true, table: view(t, me, { here: here }) };
    },

    /** Table links carry a share key, never a session. */
    byShareKey: function (token, key) {
      var me = GN.identity.auth(token);
      if (!GN.util.isId(key)) GN.fail('That table link is not valid.', 'NOT_FOUND');
      var t = store().list('Tables').filter(function (x) { return x.share_key === key; })[0];
      if (!t || t.status === 'closed') GN.fail('That table has closed.', 'NOT_FOUND');
      return { ok: true, table: view(t, me) };
    },

    sit: function (token, tableId, req) {
      return mutate(token, tableId, req, function (t, me) {
        if (seated(t, me.id)) GN.fail('You already have a seat.', 'SEATED');
        if (t.status !== 'open') GN.fail('A game is in progress at this table.', 'PLAYING');
        if (!invitedOk(t, me.id)) GN.fail('This table is invite-only.', 'FORBIDDEN');
        if (t.seats.some(function (s) { return s.bot; })) GN.fail('This computer table has two seats.', 'FULL');
        var g = GN.catalog.game(t.game_id);
        if (t.seats.length >= g.players.max) GN.fail('The table is full.', 'FULL');
        t.seats.push({ member_id: me.id, ready: false, joined_at: now() });
        return maybeAutostart(t, me);
      });
    },

    stand: function (token, tableId, req) {
      return mutate(token, tableId, req, function (t, me) {
        if (!seated(t, me.id)) GN.fail("You don't have a seat here.", 'NOT_SEATED');
        if (t.status === 'playing') GN.fail('Finish or end the current game first.', 'PLAYING');
        if (t.host_id === me.id) GN.fail('Make someone else host first, or close the table.', 'HOST');
        t.seats = t.seats.filter(function (s) { return s.member_id !== me.id; });
        return {};
      });
    },

    ready: function (token, tableId, req, ready) {
      return mutate(token, tableId, req, function (t, me) {
        if (t.status !== 'open') GN.fail('A game is in progress at this table.', 'PLAYING');
        var s = t.seats.filter(function (x) { return x.member_id === me.id; })[0];
        if (!s) GN.fail("You don't have a seat here.", 'NOT_SEATED');
        s.ready = ready === true;
        return maybeAutostart(t, me);
      });
    },

    /** Host: change game, theme, options, title, autostart or invite-only. Readiness resets. */
    configure: function (token, tableId, req, spec) {
      if (GN.util.jsonSize(spec) > 4000) GN.fail('That request is too large.', 'BAD_REQUEST');
      return mutate(token, tableId, req, function (t, me) {
        requireHost(t, me);
        if (t.status !== 'open') GN.fail('Finish or end the current game first.', 'PLAYING');
        spec = spec && typeof spec === 'object' ? spec : {};
        var g = GN.catalog.game(spec.gameId || t.game_id);
        if (t.seats.some(function (s) { return s.bot; }) && g.id !== 'wordwright') GN.fail('Computer tables only support Wordwright.', 'BAD_REQUEST');
        if (t.seats.length > g.players.max) {
          GN.fail((GN.NAMES.games[g.id] || g.id) + ' allows at most ' + g.players.max + ' players; ' +
            t.seats.length + ' are seated.', 'TOO_MANY');
        }
        t.game_id = g.id;
        if (spec.themeId !== undefined) t.theme_id = GN.catalog.theme(spec.themeId);
        t.options = {
          game: GN.catalog.options(g, spec.options !== undefined ? spec.options : (spec.gameId ? {} : t.options.game)),
          autostart: spec.autostart !== undefined ? spec.autostart === true : t.options.autostart,
          inviteOnly: spec.inviteOnly !== undefined ? spec.inviteOnly === true : t.options.inviteOnly,
        };
        if (t.seats.some(function (s) { return s.bot; })) { t.options.game.dictionary = true; t.options.inviteOnly = true; }
        if (spec.title !== undefined) t.title = cleanTitle(spec.title, t.title);
        t.seats.forEach(function (s) { s.ready = !!s.bot; });
        return {};
      });
    },

    invite: function (token, tableId, req, spec) {
      if (GN.util.jsonSize(spec) > 4000) GN.fail('That request is too large.', 'BAD_REQUEST');
      return mutate(token, tableId, req, function (t, me) {
        requireHost(t, me);
        if (t.seats.some(function (s) { return s.bot; })) GN.fail('Computer tables cannot invite another player.', 'BAD_REQUEST');
        spec = spec && typeof spec === 'object' ? spec : {};
        var ids = Array.isArray(spec.members) ? spec.members.filter(function (id) { return GN.util.isId(id); }) : [];
        var emails = Array.isArray(spec.emails) ? spec.emails.map(function (e) { return String(e).trim(); }) : [];
        if (emails.some(function (e) { return !GN.util.isEmail(e); })) GN.fail("One of those email addresses doesn't look right.", 'BAD_REQUEST');
        if (ids.length + emails.length > 20) GN.fail('Invite at most 20 at a time.', 'BAD_REQUEST');
        ids.forEach(function (id) {
          if (!store().get('Members', id)) GN.fail('Pick members from the list.', 'BAD_REQUEST');
          if (t.invited.members.indexOf(id) < 0) t.invited.members.push(id);
        });
        var group = store().setting('group_name') || GN.NAMES.platform;
        var link = GN.deps.appUrl() + '?t=' + encodeURIComponent(t.share_key);
        var code = spec.includeCode === true ? store().setting('entry_code') : '';
        var game = GN.NAMES.games[t.game_id] || t.game_id;
        var esc = GN.util.esc;
        var notice = function (to, key) {
          GN.outbox.queue(key, to, me.name + ' invited you to play ' + game,
            '<p>' + esc(me.name) + ' invited you to play ' + esc(game) + ' at <b>' + esc(t.title) + '</b> (' + esc(group) + ').</p>' +
            '<p><a href="' + esc(link) + '">Open the table</a></p>' +
            (code ? '<p>Group code: <b>' + esc(code) + '</b></p>' : '<p>You will need the group code from ' + esc(me.name) + '.</p>') +
            (t.meet_url ? '<p>Video call: <a href="' + esc(t.meet_url) + '">' + esc(t.meet_url) + '</a></p>' : ''));
        };
        emails.forEach(function (e) {
          if (t.invited.emails.indexOf(e) < 0) t.invited.emails.push(e);
          notice(e, 'invite:' + t.id + ':' + e.toLowerCase() + ':' + t.rev);
        });
        ids.forEach(function (id) {
          var mem = store().get('Members', id);
          if (mem.email) notice(mem.email, 'invite:' + t.id + ':' + id + ':' + t.rev);
        });
        return { invited: ids.length + emails.length };
      });
    },

    /** Host: attach a video-call link. Google Meet links are expected; other https links are allowed. */
    setMeet: function (token, tableId, req, url) {
      return mutate(token, tableId, req, function (t, me) {
        requireHost(t, me);
        var u = typeof url === 'string' ? url.trim() : '';
        if (u && (!/^https:\/\/[^\s<>"']+$/.test(u) || u.length > 300)) GN.fail('Paste a full https:// link.', 'BAD_URL');
        t.meet_url = u;
        return { meet: !!u, google: /^https:\/\/meet\.google\.com\//.test(u) };
      });
    },

    transferHost: function (token, tableId, req, memberId) {
      return mutate(token, tableId, req, function (t, me) {
        requireHost(t, me);
        if (!seated(t, memberId) || t.seats.some(function (s) { return s.bot && s.member_id === memberId; })) GN.fail('The new host must be a person at this table.', 'BAD_REQUEST');
        t.host_id = memberId;
        return {};
      });
    },

    start: function (token, tableId, req) {
      return mutate(token, tableId, req, function (t, me) {
        requireHost(t, me);
        return doStart(t, me);
      });
    },

    close: function (token, tableId, req) {
      return mutate(token, tableId, req, function (t, me) {
        requireHost(t, me);
        if (t.status === 'playing') GN.fail('Finish or end the current game first.', 'PLAYING');
        t.status = 'closed';
        return {};
      });
    },

    /**
     * After a match ends: back to "open" with readiness reset. Idempotent and only
     * acts if the table still points at this match. Lock must be held.
     */
    release: function (m) {
      var t = store().get('Tables', m.table_id);
      if (!t || t.current_match_id !== m.id || t.status !== 'playing') return false;
      GN.sync.invalidate('t:' + t.id);
      t.status = 'open';
      t.seats.forEach(function (s) { s.ready = !!s.bot; });
      t.rev = t.rev + 1;
      t.updated = now();
      store().put('Tables', t);
      GN.sync.publish('t:' + t.id, { rev: t.rev, status: t.status });
      return true;
    },
  };
})();
