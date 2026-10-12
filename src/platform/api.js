/**
 * The public surface: every call the page can make, with argument limits. The Apps
 * Script layer (and the dev server) route call(method, args) through GN.api.handle.
 * Anything not listed here is unreachable from a browser.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.api = (function () {
  var MAX_ARGS_CHARS = 3200000;

  // method -> [max args, function]
  var PUBLIC = {
    join: [3, function (code, choice, label) { return GN.identity.join(code, choice, label); }],
    signOut: [1, function (t) { return GN.identity.signOut(t); }],
    lobby: [1, function (t) { return GN.lobby.get(t); }],
    sync: [2, function (t, want) { return GN.lobby.sync(t, want); }],
    profile: [3, function (t, name, email) { return GN.profile.update(t, name, email); }],
    createTable: [3, function (t, spec, actionId) { return GN.tables.create(t, spec, actionId); }],
    table: [2, function (t, id) { return GN.tables.get(t, id); }],
    tableByLink: [2, function (t, key) { return GN.tables.byShareKey(t, key); }],
    sit: [3, function (t, id, req) { return GN.tables.sit(t, id, req); }],
    stand: [3, function (t, id, req) { return GN.tables.stand(t, id, req); }],
    ready: [4, function (t, id, req, v) { return GN.tables.ready(t, id, req, v); }],
    configure: [4, function (t, id, req, spec) { return GN.tables.configure(t, id, req, spec); }],
    invite: [4, function (t, id, req, spec) { return GN.tables.invite(t, id, req, spec); }],
    setMeet: [4, function (t, id, req, url) { return GN.tables.setMeet(t, id, req, url); }],
    transferHost: [4, function (t, id, req, m) { return GN.tables.transferHost(t, id, req, m); }],
    start: [3, function (t, id, req) { return GN.tables.start(t, id, req); }],
    closeTable: [3, function (t, id, req) { return GN.tables.close(t, id, req); }],
    match: [2, function (t, id) { return GN.matches.get(t, id); }],
    act: [4, function (t, id, action, req) { return GN.matches.act(t, id, action, req); }],
    botTurn: [3, function (t, id, rev) { return GN.matches.botTurn(t, id, rev); }],
    query: [3, function (t, id, q) { return GN.matches.query(t, id, q); }],
    abandon: [3, function (t, id, req) { return GN.matches.abandon(t, id, req); }],
    asset: [3, function (t, game, name) { return GN.assets.get(t, game, name); }],
    saveReplay: [2, function (t, id) { return GN.files.saveReplay(t, id); }],
    uploadCancel: [2, function (t, id) { return GN.files.uploadCancel(t, id); }],
    uploadChunk: [4, function (t, id, i, data) { return GN.files.uploadChunk(t, id, i, data); }],
    uploadFinish: [5, function (t, id, n, mime, name) { return GN.files.uploadFinish(t, id, n, mime, name); }],
    replay: [2, function (t, id) { return GN.replay.build(t, id); }],
    adminSettings: [1, function (t) { return GN.admin.settings(t); }],
    adminSet: [3, function (t, k, v) { return GN.admin.setSetting(t, k, v); }],
    adminMember: [3, function (t, id, change) { return GN.admin.setMember(t, id, change); }],
  };

  function handle(method, args) {
    if (typeof method !== 'string' || !PUBLIC.hasOwnProperty(method)) return { ok: false, error: 'Unknown action.', code: 'BAD_REQUEST' };
    if (!Array.isArray(args) || args.length > PUBLIC[method][0]) return { ok: false, error: 'Please reload the page.', code: 'BAD_REQUEST' };
    if (GN.util.jsonSize(args) > MAX_ARGS_CHARS) return { ok: false, error: 'That request is too large.', code: 'BAD_REQUEST' };
    try {
      var r = PUBLIC[method][1].apply(null, args);
      if (method !== 'join') GN.maintenance.opportunistic();
      return r;
    } catch (e) {
      if (e instanceof GN.ApiError) return { ok: false, error: e.message, code: e.code, extra: e.extra };
      throw e;
    }
  }

  return { handle: handle, methods: function () { return Object.keys(PUBLIC); } };
})();

/** A member's own profile: display name and optional email. */
GN.profile = {
  update: function (token, name, email) {
    return GN.deps.withLock(function () {
      GN.deps.store.refresh();
      var snap = GN.identity.auth(token);
      var m = GN.deps.store.get('Members', snap.id);
      if (typeof name === 'string' && name.trim()) {
        var n = GN.util.cleanName(name);
        var taken = GN.identity.members().some(function (x) { return x.id !== m.id && x.name.toLowerCase() === n.toLowerCase(); });
        if (taken) GN.fail(n + ' is already taken by someone else.', 'NAME_TAKEN');
        m.name = n;
      }
      if (typeof email === 'string') {
        if (email.trim() && !GN.util.isEmail(email.trim())) GN.fail("That email address doesn't look right.", 'BAD_REQUEST');
        m.email = email.trim();
      }
      GN.deps.store.put('Members', m);
      try { GN.deps.cache.remove('sess:' + GN.deps.hash(token)); } catch (e) { /* hint only */ }
      GN.sync.touch('lobby');
      return { ok: true, me: GN.identity.publicMember(m), email: m.email };
    });
  },
};
