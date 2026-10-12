// Game Night 0.1.0 | MIT | Copyright (c) 2026 Game Night contributors
// ---- src/config/names.js
/**
 * Display names, in one place. Internal ids (game ids, storage keys) never change when
 * a display name does, so renaming a game here is safe for existing installations.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.NAMES = {
  platform: 'Game Night',
  games: {
    wordwright: 'Wordwright',
    fourinarow: 'Four in a Row',
    dots: 'Dots and Boxes',
    checkers: 'Checkers',
    fivefold: 'Fivefold',          // the five-dice scorecard game; rename freely
  },
};


// ---- src/themes/themes.js
/**
 * The installed themes, as the server knows them (ids and names only; looks live in
 * each theme's theme.json and are packed for the browser by tools/build.mjs).
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.THEMES = [
  { id: 'walnut', name: 'Walnut Parlor', version: '1.0.0' },
  { id: 'slate', name: 'Slate Study', version: '1.0.0' },
];


// ---- src/platform/admin.js
/**
 * Group administration (settings, members, PINs, sessions). Admins only.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.admin = (function () {
  var EDITABLE = {
    group_name: function (v) { return GN.util.cleanName(v) || null; },
    entry_code: function (v) { return typeof v === 'string' && GN.identity.normCode(v).length >= 4 && v.length <= 100 ? v.trim() : null; },
    identity_mode: function (v) { return v === 'pin' || v === 'trusted' ? v : null; },
    turn_emails: function (v) { return v === 'yes' || v === 'no' ? v : null; },
    default_theme: function (v) { return GN.catalog.themes().some(function (t) { return t.id === v; }) ? v : null; },
  };

  function adminLocked(token, fn) {
    return GN.deps.withLock(function () {
      GN.deps.store.refresh();
      var me = GN.identity.auth(token);
      GN.identity.requireAdmin(me);
      var r = fn(me);
      GN.sync.touch('lobby');
      return r;
    });
  }

  return {
    settings: function (token) {
      var me = GN.identity.auth(token);
      GN.identity.requireAdmin(me);
      var s = {};
      Object.keys(EDITABLE).forEach(function (k) { s[k] = GN.deps.store.setting(k); });
      return { ok: true, settings: s };
    },
    setSetting: function (token, key, value) {
      if (!EDITABLE.hasOwnProperty(key)) GN.fail('That setting cannot be changed here.', 'BAD_REQUEST');
      var clean = EDITABLE[key](value);
      if (clean === null) GN.fail('That value is not allowed for ' + key + '.', 'BAD_REQUEST');
      return adminLocked(token, function () {
        GN.deps.store.setSetting(key, clean);
        return { ok: true, key: key, value: clean };
      });
    },
    /** change = {name?, role?, removed?, pin?} */
    setMember: function (token, memberId, change) {
      return adminLocked(token, function (me) {
        var m = GN.util.isId(memberId) && GN.deps.store.get('Members', memberId);
        if (!m) GN.fail('No such member.', 'NOT_FOUND');
        change = change && typeof change === 'object' ? change : {};
        if (change.name !== undefined) {
          var n = GN.util.cleanName(change.name);
          var taken = GN.identity.members().some(function (x) { return x.id !== m.id && x.name.toLowerCase() === n.toLowerCase(); });
          if (!n || taken) GN.fail('Pick a different name.', 'BAD_REQUEST');
          m.name = n;
        }
        if (change.role !== undefined) {
          if (change.role !== 'admin' && change.role !== 'member') GN.fail('Role must be admin or member.', 'BAD_REQUEST');
          if (m.id === me.id && change.role !== 'admin') GN.fail("You can't remove your own admin role.", 'BAD_REQUEST');
          if (change.role === 'admin' && !m.pin_hash && !GN.identity.validPin(change.pin)) GN.fail('Set a PIN for a new admin.', 'BAD_PIN');
          m.role = change.role;
        }
        if (change.pin !== undefined) {
          if (!GN.identity.validPin(change.pin)) GN.fail('A PIN has 4 to 8 digits.', 'BAD_PIN');
          m.pin_hash = GN.identity.pinHash(change.pin);
        }
        if (change.removed === true) {
          if (m.id === me.id) GN.fail("You can't remove yourself.", 'BAD_REQUEST');
          m.status = 'removed';
          GN.deps.store.list('Sessions', { where: { member_id: m.id } }).forEach(function (s) {
            s.revoked = 'yes'; GN.deps.store.put('Sessions', s);
            try { GN.deps.cache.remove('sess:' + s.token_hash); } catch (e) { /* hint only */ }
          });
        }
        GN.deps.store.put('Members', m);
        return { ok: true, member: GN.identity.publicMember(m) };
      });
    },
  };
})();


// ---- src/platform/api.js
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


// ---- src/platform/assets.js
/**
 * Optional game artwork (for example Wordwright's board pictures), fetched by the page
 * only when a player chooses it. A game lists its assets in `assets: [names]`; nothing
 * else can be requested. Installations may leave the asset files out, in which case
 * data is null and the page draws its own board.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.assets = {
  /** The Apps Script file that holds an asset, e.g. asset_wordwright_board_maple. */
  fileName: function (gameId, name) { return 'asset_' + gameId + '_' + name.replace(/-/g, '_'); },

  get: function (token, gameId, name) {
    GN.identity.auth(token);
    var g = GN.util.isId(gameId) && GN.games[gameId];
    if (!g || !g.assets || g.assets.indexOf(name) < 0) GN.fail('No such picture.', 'NOT_FOUND');
    var data = null;
    try { data = GN.deps.asset ? GN.deps.asset(GN.assets.fileName(gameId, name)) : null; } catch (e) { data = null; }
    return { ok: true, game: gameId, name: name, data: data || null };
  },
};


// ---- src/platform/catalog.js
/**
 * The game and theme registry. Games register themselves (GN.games[id] = {...}) from
 * their own rules file; this module validates them and describes them to the lobby.
 * See docs/game-authoring.md for the interface.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.catalog = (function () {
  var REQUIRED = ['id', 'version', 'rulesVersion', 'players', 'setup', 'actors', 'apply', 'view', 'summary'];

  function game(id) {
    var g = typeof id === 'string' && GN.games.hasOwnProperty(id) ? GN.games[id] : null;
    if (!g) GN.fail('That game is not available here.', 'NO_GAME');
    return g;
  }

  function check(g) {
    REQUIRED.forEach(function (k) {
      if (g[k] === undefined) throw new Error('game ' + (g.id || '?') + ' is missing ' + k);
    });
    return g;
  }

  /** Validate table options against the game's declared options; fills defaults. */
  function options(g, given) {
    var out = {};
    var src = given && typeof given === 'object' && !Array.isArray(given) ? given : {};
    (g.options || []).forEach(function (o) {
      var v = src.hasOwnProperty(o.id) ? src[o.id] : o.default;
      if (o.type === 'choice') {
        var allowed = o.choices.map(function (c) { return c.value; });
        if (allowed.indexOf(v) < 0) GN.fail('Pick one of the offered choices for ' + o.label + '.', 'BAD_OPTION');
      } else if (o.type === 'boolean') {
        if (typeof v !== 'boolean') GN.fail(o.label + ' must be on or off.', 'BAD_OPTION');
      } else if (o.type === 'text') {
        if (typeof v !== 'string' || v.length > (o.max || 40)) GN.fail(o.label + ' is too long.', 'BAD_OPTION');
      }
      out[o.id] = v;
    });
    return out;
  }

  function describe() {
    return Object.keys(GN.games).sort().map(function (id) {
      var g = check(GN.games[id]);
      return {
        id: g.id, name: GN.NAMES.games[g.id] || g.name || g.id, description: g.description || '',
        players: g.players, options: g.options || [], version: g.version, rulesVersion: g.rulesVersion,
        minutes: g.minutes || null,
      };
    });
  }

  function themes() {
    return GN.THEMES ? GN.THEMES.map(function (t) { return { id: t.id, name: t.name, version: t.version }; }) : [];
  }

  function theme(id) {
    var ok = (GN.THEMES || []).some(function (t) { return t.id === id; });
    return ok ? id : ((GN.THEMES || [])[0] || { id: 'walnut' }).id;
  }

  return { game: game, check: check, options: options, describe: describe, themes: themes, theme: theme };
})();


// ---- src/platform/files.js
/**
 * Saving replays to the installation's Drive folder (the owner's Drive). Admins only:
 * everyone else downloads files in their browser.
 *
 *   saveReplay(matchId)                      the replay file (JSON, format v1)
 *   uploadChunk(uploadId, index, base64)     one piece of a recorded video
 *   uploadFinish(uploadId, count, mime, name) joins the pieces into one file
 *
 * Video pieces are kept as temporary Drive files, never in CacheService, and removed
 * once joined. Nothing here holds the script lock.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.files = (function () {
  var MAX_CHUNK = 2600000;          // base64 characters per call (under the request cap)
  var MAX_CHUNKS = 12;              // about 23 MB of video
  var TYPES = { 'video/webm': 'webm', 'video/mp4': 'mp4' };

  function cleanName(s, ext) {
    var n = String(s || 'replay').replace(/[^A-Za-z0-9 ._-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'replay';
    return n.replace(/\.[A-Za-z0-9]+$/, '') + '.' + ext;
  }
  function partName(id, i) { return id + '.' + i + '.part'; }

  // Metadata is durable, scoped to installation AND device session. Drive work stays
  // outside the script lock. A short lease prevents concurrent chunk/finish writes.
  function scope(token, id) {
    GN.identity.requireAdmin(GN.identity.auth(token));
    if (!GN.util.isId(id, 40)) GN.fail('That upload is not valid.', 'BAD_REQUEST');
    return GN.deps.hash(GN.deps.store.setting('install_id') + ':' + token + ':' + id).slice(0, 40);
  }
  function read(key) { var s = GN.deps.store.setting('upload:' + key); return s ? JSON.parse(s) : null; }
  function write(key, v) { GN.deps.store.setSetting('upload:' + key, JSON.stringify(v)); }
  function clean(key) {
    var failed = false;
    for (var i = 0; i < MAX_CHUNKS; i++) {
      try { var id = GN.deps.drive.find('uploads', partName(key, i)); if (id) GN.deps.drive.remove(id); }
      catch (e) { failed = true; }
    }
    return !failed;
  }
  function work(key, fn) {
    var lease = GN.deps.newId(12);
    var meta = GN.deps.withLock(function () {
      GN.deps.store.refresh();
      var m = read(key) || { at: GN.deps.now(), status: 'open' };
      if (m.lease && GN.deps.now() - m.at < 120000) GN.fail('Upload busy. Try again.', 'BUSY');
      m.lease = lease; m.at = GN.deps.now(); write(key, m); return m;
    });
    try { return fn(meta); }
    finally {
      GN.deps.withLock(function () {
        GN.deps.store.refresh();
        var current = read(key);
        if (current && current.lease === lease) { delete meta.lease; write(key, meta); }
      });
    }
  }

  return {
    cleanup: function () {
      GN.deps.store.list('Settings').filter(function (r) { return r.key.indexOf('upload:') === 0; }).slice(0, 30).forEach(function (r) {
        var m = JSON.parse(r.value), key = r.key.slice(7);
        if (GN.deps.now() - m.at > 86400000 && clean(key)) GN.deps.store.remove('Settings', r.key);
      });
    },
    uploadCancel: function (token, uploadId) {
      var key = scope(token, uploadId);
      return work(key, function (m) { if (m.status !== 'done') m.status = 'cancelled'; return { ok: clean(key) }; });
    },
    saveReplay: function (token, matchId) {
      GN.identity.requireAdmin(GN.identity.auth(token));
      var rp = GN.replay.build(token, matchId).replay;
      var name = cleanName(rp.game.name + ' ' + rp.match.id, 'json');
      var f = GN.deps.drive.saveText('replays', name, JSON.stringify(rp, null, 1));
      return { ok: true, url: f.url, name: name };
    },

    uploadChunk: function (token, uploadId, index, data) {
      var key = scope(token, uploadId);
      if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) GN.fail('That upload is not valid.', 'BAD_REQUEST');
      if (typeof data !== 'string' || !data.length || data.length > MAX_CHUNK || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) GN.fail('That piece of the video is not valid.', 'BAD_REQUEST');
      return work(key, function (m) {
        if (m.status !== 'open') GN.fail('That upload is closed.', 'BAD_REQUEST');
        try { GN.deps.drive.saveBytes('uploads', partName(key, index), 'application/octet-stream', data); }
        catch (e) { m.status = 'failed'; clean(key); throw e; }
        return { ok: true, index: index };
      });
    },

    uploadFinish: function (token, uploadId, count, mime, name) {
      var key = scope(token, uploadId);
      if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) GN.fail('That upload is not valid.', 'BAD_REQUEST');
      var ext = TYPES[String(mime).split(';')[0]];
      if (!ext) GN.fail('Only WebM or MP4 video can be saved.', 'BAD_REQUEST');
      return work(key, function (m) {
        if (m.status === 'done') { clean(key); return m.result; }
        if (m.status !== 'open') GN.fail('That upload is closed.', 'BAD_REQUEST');
        var drive = GN.deps.drive, parts = [], filename = cleanName(name, ext);
        // Unique deterministic output name recovers a lost completion response.
        var storedName = key + '-' + filename;
        for (var i = 0; i < count; i++) {
          var id = drive.find('uploads', partName(key, i));
          if (!id) {
            m.status = 'failed';
            if (clean(key)) write(key, m);
            GN.fail('Part ' + (i + 1) + ' of the video is missing. Try saving again.', 'MISSING');
          }
          parts.push(id);
        }
        try {
          var existing = drive.find('replays', storedName);
          var file = existing ? { url: 'https://drive.google.com/file/d/' + existing + '/view' } : drive.joinBytes('replays', storedName, String(mime).split(';')[0], parts);
          m.result = { ok: true, url: file.url, name: filename }; m.status = 'done';
          // Persist completion before cleanup; retries return the same result.
          write(key, m); clean(key);
          return m.result;
        } catch (e) { m.status = 'failed'; clean(key); throw e; }
      });
    },

    MAX_CHUNK: MAX_CHUNK,
    MAX_CHUNKS: MAX_CHUNKS,
  };
})();


// ---- src/platform/identity.js
/**
 * Group entry, members and device sessions. See docs/identity.md.
 *
 *  - The group code lets someone in. Then:
 *      trusted mode: tap your name, or add a new one;
 *      pin mode:     name + personal PIN (set the first time).
 *  - Admins always need their PIN, in either mode, so picking an admin's name in
 *    trusted mode doesn't grant admin rights.
 *  - A device gets a random session token. Only its hash is stored (Sessions sheet), so
 *    reading the spreadsheet doesn't let anyone impersonate a player.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.identity = (function () {
  var PIN_TRIES = 5, PIN_LOCK_S = 600;

  function deps() { return GN.deps; }
  function store() { return GN.deps.store; }

  function normCode(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  function checkCode(code) {
    var want = store().setting('entry_code');
    if (!want || !normCode(want)) GN.fail('Joining is turned off. Ask the group admin.', 'JOIN_OFF');
    if (typeof code !== 'string' || code.length > 100 || normCode(code) !== normCode(want)) {
      if (deps().sleep) deps().sleep(1500);         // a public page: make guessing slow
      GN.fail("That code isn't right. Ask whoever runs the group for the current code.", 'BAD_CODE');
    }
  }

  function pinHash(pin, salt) {
    salt = salt || deps().newId(12);
    return salt + '$' + deps().hash(salt + ':' + pin);
  }

  function pinOk(member, pin) {
    if (!member.pin_hash || typeof pin !== 'string') return false;
    var salt = String(member.pin_hash).split('$')[0];
    return pinHash(pin, salt) === member.pin_hash;
  }

  function validPin(pin) { return typeof pin === 'string' && /^[0-9]{4,8}$/.test(pin); }

  function mode() { return store().setting('identity_mode') === 'pin' ? 'pin' : 'trusted'; }

  function members() {
    return store().list('Members').filter(function (m) { return m.status !== 'removed'; });
  }

  function publicMember(m) {
    return { id: m.id, name: m.name, role: m.role || 'member', avatar: m.avatar || null, stats: m.stats || {} };
  }

  function newSession(member, label) {
    var token = deps().newId(32);
    store().put('Sessions', {
      token_hash: deps().hash(token), member_id: member.id, created: deps().now(), last_seen: deps().now(),
      label: String(label || '').slice(0, 60), revoked: '',
    });
    return token;
  }

  /** The member behind a session token, or an AUTH error. */
  function auth(token) {
    if (!GN.util.isId(token, 64)) GN.fail('Please sign in again.', 'AUTH');
    var h = deps().hash(token);
    // a 5-minute snapshot keeps polls from reading the sheet; removal clears it at once,
    // other member changes (name, role) reach polls within 5 minutes
    var hint = null;
    try { hint = deps().cache.get('sess:' + h); } catch (e) { hint = null; }
    if (hint && hint.m && hint.member) return hint.member;
    var s = store().get('Sessions', h);
    if (!s || s.revoked) GN.fail('Please sign in again.', 'AUTH');
    var m = store().get('Members', s.member_id);
    if (!m || m.status === 'removed') GN.fail('Please sign in again.', 'AUTH');
    var snap = { id: m.id, name: m.name, email: m.email || '', role: m.role || 'member', status: m.status,
      avatar: m.avatar || '', pin_hash: '', stats: m.stats || {} };
    try { deps().cache.put('sess:' + h, { m: m.id, member: snap }, 300); } catch (e) { /* cache is optional */ }
    return snap;
  }

  function lockedOut(memberId) {
    var c = deps().cache.get('pinfail:' + memberId);
    return c && c.n >= PIN_TRIES;
  }

  function notePinFailure(memberId) {
    var c = deps().cache.get('pinfail:' + memberId) || { n: 0 };
    c.n++;
    try { deps().cache.put('pinfail:' + memberId, c, PIN_LOCK_S); } catch (e) { /* best effort */ }
    if (deps().sleep) deps().sleep(1500);
  }

  return {
    normCode: normCode,
    mode: mode,
    auth: auth,
    publicMember: publicMember,
    pinHash: pinHash,
    validPin: validPin,

    /**
     * join(code)                                 -> {mode, members} to choose from
     * join(code, {memberId, pin?})               -> {token} for an existing member
     * join(code, {name, pin?, email?})           -> {token} for a new member
     */
    join: function (code, choice, label) {
      checkCode(code);
      if (!choice) {
        return { ok: true, mode: mode(), group: store().setting('group_name') || GN.NAMES.platform,
          members: members().map(function (m) { return { id: m.id, name: m.name, admin: m.role === 'admin' }; }) };
      }
      if (typeof choice !== 'object') GN.fail('Pick your name.', 'BAD_REQUEST');
      var pinNeeded = function (m) { return mode() === 'pin' || m.role === 'admin'; };
      if (choice.memberId) {
        if (!GN.util.isId(choice.memberId)) GN.fail('Pick your name from the list.', 'BAD_REQUEST');
        var m = store().get('Members', choice.memberId);
        if (!m || m.status === 'removed') GN.fail('Pick your name from the list.', 'BAD_REQUEST');
        if (pinNeeded(m)) {
          if (lockedOut(m.id)) GN.fail('Too many wrong PINs. Try again in 10 minutes.', 'PIN_LOCKED');
          if (!m.pin_hash) GN.fail('This name has no PIN yet. Ask an admin to set one.', 'PIN_MISSING');
          if (!pinOk(m, choice.pin)) {
            notePinFailure(m.id);
            GN.fail("That PIN isn't right.", 'BAD_PIN');
          }
        }
        return { ok: true, token: newSession(m, label), member: publicMember(m) };
      }
      var name = GN.util.cleanName(choice.name);
      if (!name) GN.fail('Type your name.', 'BAD_REQUEST');
      if (mode() === 'pin' && !validPin(choice.pin)) GN.fail('Choose a PIN of 4 to 8 digits.', 'BAD_PIN');
      if (choice.email !== undefined && choice.email !== '' && !GN.util.isEmail(choice.email)) {
        GN.fail("That email address doesn't look right.", 'BAD_REQUEST');
      }
      return deps().withLock(function () {
        store().refresh();
        var taken = members().some(function (x) { return String(x.name).toLowerCase() === name.toLowerCase(); });
        if (taken) GN.fail(name + ' is already in the group. Pick it from the list instead.', 'NAME_TAKEN');
        var nm = {
          id: deps().newId(10), name: name, email: choice.email || '', role: 'member',
          pin_hash: mode() === 'pin' ? pinHash(choice.pin) : '', avatar: '', status: 'active',
          created: deps().now(), stats: {},
        };
        store().put('Members', nm);
        GN.sync.touch('lobby');
        return { ok: true, token: newSession(nm, label), member: publicMember(nm) };
      });
    },

    signOut: function (token) {
      if (!GN.util.isId(token, 64)) return { ok: true };
      var h = deps().hash(token);
      deps().withLock(function () {
        var s = store().get('Sessions', h);
        if (s) { s.revoked = 'yes'; store().put('Sessions', s); }
      });
      try { deps().cache.remove('sess:' + h); } catch (e) { /* hint only */ }
      return { ok: true };
    },

    requireAdmin: function (member) {
      if (member.role !== 'admin') GN.fail('Only a group admin can do that.', 'FORBIDDEN');
    },

    members: members,
  };
})();


// ---- src/platform/install.js
/**
 * Installation lifecycle: first-time setup, wiping a copied template, and schema
 * migrations. The Apps Script layer decides WHEN (menu, copy detection); this decides
 * WHAT, so it can be tested with the simulated store.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.install = (function () {
  var DATA_TABLES = ['Members', 'Sessions', 'Tables', 'Matches', 'Events', 'Outbox', 'Settings'];

  function store() { return GN.deps.store; }

  function isSetUp() { return !!store().setting('install_id') && !!store().setting('entry_code'); }

  /**
   * spec = {groupName, code, adminName, adminPin, identityMode?}
   * Creates a brand-new installation: fresh install id, settings, and the first admin.
   */
  function initialize(spec) {
    spec = spec || {};
    var group = GN.util.cleanName(spec.groupName) || GN.NAMES.platform;
    var code = typeof spec.code === 'string' ? spec.code.trim() : '';
    var adminName = GN.util.cleanName(spec.adminName);
    if (GN.identity.normCode(code).length < 4 || code.length > 100) GN.fail('Choose a group code of at least 4 characters.', 'BAD_CODE');
    if (!adminName) GN.fail("Type the admin's name.", 'BAD_REQUEST');
    if (!GN.identity.validPin(spec.adminPin)) GN.fail('Choose an admin PIN of 4 to 8 digits.', 'BAD_PIN');
    return GN.deps.withLock(function () {
      store().refresh();
      if (isSetUp()) GN.fail('This installation is already set up.', 'ALREADY');
      var installId = GN.deps.newId(16);
      [['install_id', installId], ['schema_version', GN.SCHEMA_VERSION], ['group_name', group], ['entry_code', code],
        ['identity_mode', spec.identityMode === 'pin' ? 'pin' : 'trusted'], ['turn_emails', 'no'],
        ['default_theme', (GN.THEMES[0] || { id: 'walnut' }).id]].forEach(function (kv) { store().setSetting(kv[0], kv[1]); });
      var admin = { id: GN.deps.newId(10), name: adminName, email: spec.adminEmail || '', role: 'admin',
        pin_hash: GN.identity.pinHash(spec.adminPin), avatar: '', status: 'active', created: GN.deps.now(), stats: {} };
      store().put('Members', admin);
      return { ok: true, installId: installId, adminId: admin.id };
    });
  }

  /** A copied template (or a reset): nothing inherited may survive. */
  function wipe() {
    return GN.deps.withLock(function () {
      DATA_TABLES.forEach(function (t) { store().clear(t); });
      return { ok: true };
    });
  }

  /** Idempotent upgrades between schema versions; run on every request after an upgrade. */
  var MIGRATIONS = {
    // 2: function () { ... }   (none yet; version 1 is the first released layout)
  };

  function migrate() {
    var have = Number(store().setting('schema_version') || 0);
    if (!have || have >= GN.SCHEMA_VERSION) return have;
    return GN.deps.withLock(function () {
      store().refresh();
      var v = Number(store().setting('schema_version') || 0);
      while (v < GN.SCHEMA_VERSION) {
        v++;
        if (MIGRATIONS[v]) MIGRATIONS[v]();
        store().setSetting('schema_version', v);
      }
      return v;
    });
  }

  return { initialize: initialize, wipe: wipe, migrate: migrate, isSetUp: isSetUp, DATA_TABLES: DATA_TABLES };
})();


// ---- src/platform/lobby.js
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
      defaultTheme: GN.catalog.theme(store().setting('default_theme')),
      tables: tables.sort(function (a, b) { return b.updated - a.updated; }).map(function (t) {
        var g = GN.catalog.game(t.game_id);
        return {
          id: t.id, title: t.title, game_id: t.game_id, game_name: GN.NAMES.games[t.game_id] || t.game_id,
          theme_id: t.theme_id, host: names[t.host_id] || '(unknown)', host_id: t.host_id, status: t.status,
          seats: t.seats.map(function (s) { return { member_id: s.member_id, name: s.bot ? 'Computer' : names[s.member_id] || '(unknown)', bot: !!s.bot, ready: !!s.ready }; }),
          players: t.seats.some(function (s) { return s.bot; }) ? { min: 2, max: 2 } : g.players, inviteOnly: !!t.options.inviteOnly,
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
        if (want.lobby === v) {
          // presence changes without a lobby version bump; ids come from the page, so no sheet read
          var ids = Array.isArray(want.members) ? want.members.filter(function (x) { return GN.util.isId(x); }).slice(0, 60) : [];
          out.lobby = { changed: false, v: v, here: GN.sync.here('lobby', me.id, ids) };
        } else {
          out.lobby = { changed: true, v: v, lobby: lobbyData(me) };
        }
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


// ---- src/platform/maintenance.js
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


// ---- src/platform/matches.js
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


// ---- src/platform/outbox.js
/**
 * Email outbox (from Crabbles). Emails are queued under the lock with an idempotent
 * key, sent after the lock is released, and retried with backoff (5, 10, 20 ... min,
 * at most a day apart, 12 attempts) so a Gmail daily quota recovers on its own.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.outbox = (function () {
  var MAX_ATTEMPTS = 12;
  function backoff(n) { return n ? Math.min(24 * 3600000, 5 * 60000 * Math.pow(2, n - 1)) : 0; }
  function store() { return GN.deps.store; }

  return {
    /** Queue once per key; returns false when that key was already queued. */
    queue: function (key, to, subject, html) {
      if (!to) return false;
      return store().insert('Outbox', {
        key: key, to: to, subject: subject, html: html, status: 'pending', attempts: 0,
        created: GN.deps.now(), claimed_at: 0, sent_at: '', last_error: '',
      });
    },

    /** Send what's due. Claim under the lock, send without it, record under it. */
    flush: function (limit) {
      var now = GN.deps.now();
      var items = GN.deps.withLock(function () {
        store().refresh();
        var due = store().list('Outbox').filter(function (o) {
          var waited = now - (o.claimed_at || 0) >= backoff(o.attempts || 0);
          var stuck = o.status === 'sending' && now - (o.claimed_at || 0) > 10 * 60000;
          return ((o.status === 'pending' && waited) || stuck) && (o.attempts || 0) < MAX_ATTEMPTS;
        }).slice(0, limit || 10);
        due.forEach(function (o) {
          o.status = 'sending'; o.claimed_at = now; o.attempts = (o.attempts || 0) + 1;
          store().put('Outbox', o);
        });
        return due;
      });
      var results = items.map(function (o) {
        try {
          GN.deps.mail(o.to, o.subject, o.html);
          return { key: o.key, ok: true };
        } catch (e) {
          return { key: o.key, ok: false, error: String(e && e.message || e).slice(0, 300) };
        }
      });
      if (results.length) {
        GN.deps.withLock(function () {
          store().refresh();
          results.forEach(function (r) {
            var o = store().get('Outbox', r.key);
            if (!o) return;
            if (r.ok) { o.status = 'sent'; o.sent_at = new Date(GN.deps.now()).toISOString(); }
            else { o.status = (o.attempts || 0) >= MAX_ATTEMPTS ? 'failed' : 'pending'; o.last_error = r.error; }
            store().put('Outbox', o);
          });
        });
      }
      return {
        sent: results.filter(function (r) { return r.ok; }).length,
        failed: results.filter(function (r) { return !r.ok; }).length,
      };
    },

    flushQuietly: function () {
      try { return GN.outbox.flush(10); } catch (e) { GN.deps.log('outbox: ' + (e && e.message)); return null; }
    },
  };
})();


// ---- src/platform/schema.js
/**
 * The installation's spreadsheet tabs. Each record is an object; `json` columns are
 * stored as JSON text. In Matches the large columns (state, actions) come LAST so that
 * index reads (lobby, maintenance) can skip them.
 *
 * Bump SCHEMA_VERSION and add a migration in maintenance.js when this changes.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.SCHEMA_VERSION = 1;

GN.SCHEMA = {
  Settings: { key: 'key', cols: ['key', 'value'] },
  Members: {
    key: 'id',
    cols: ['id', 'name', 'email', 'role', 'pin_hash', 'avatar', 'status', 'created', 'stats'],
    json: ['stats'],
    num: ['created'],
  },
  Sessions: {
    key: 'token_hash',
    cols: ['token_hash', 'member_id', 'created', 'last_seen', 'label', 'revoked'],
    num: ['created', 'last_seen'],
  },
  Tables: {
    key: 'id',
    cols: ['id', 'share_key', 'title', 'host_id', 'game_id', 'theme_id', 'options', 'seats', 'invited',
      'meet_url', 'status', 'current_match_id', 'match_count', 'rev', 'created_action', 'created', 'updated', 'actions'],
    json: ['options', 'seats', 'invited', 'actions'],
    num: ['match_count', 'rev', 'created', 'updated'],
  },
  Matches: {
    key: 'id',
    cols: ['id', 'table_id', 'game_id', 'game_version', 'rules_version', 'schema_version', 'theme_id', 'options',
      'players', 'status', 'rev', 'done_rev', 'summary', 'result', 'created', 'updated', 'state', 'actions'],
    json: ['options', 'players', 'result', 'state', 'actions'],
    num: ['rules_version', 'schema_version', 'rev', 'done_rev', 'created', 'updated'],
    index: 16,   // the first 16 columns are the light "index"; state and actions follow
  },
  Events: {
    key: 'key',
    cols: ['key', 'match_id', 'seq', 'rev', 'actor', 'type', 'public', 'at'],
    json: ['public'],
    num: ['seq', 'rev', 'at'],
  },
  Outbox: {
    key: 'key',
    cols: ['key', 'to', 'subject', 'html', 'status', 'attempts', 'created', 'claimed_at', 'sent_at', 'last_error'],
    num: ['attempts', 'created', 'claimed_at'],
  },
};

/** Record <-> row conversion, shared by every store. */
GN.rowOf = function (table, record) {
  var s = GN.SCHEMA[table];
  return s.cols.map(function (c) {
    var v = record[c];
    if (s.json && s.json.indexOf(c) >= 0) return v === undefined || v === null ? '' : JSON.stringify(v);
    return v === undefined || v === null ? '' : v;
  });
};

GN.recordOf = function (table, row) {
  var s = GN.SCHEMA[table];
  var o = {};
  s.cols.forEach(function (c, i) {
    var v = i < row.length ? row[i] : '';
    if (s.json && s.json.indexOf(c) >= 0) {
      o[c] = v === '' || v === null || v === undefined ? null : JSON.parse(v);
    } else if (s.num && s.num.indexOf(c) >= 0) {
      o[c] = v === '' || v === null || v === undefined ? 0 : Number(v);
    } else {
      o[c] = v;
    }
  });
  return o;
};


// ---- src/platform/sync.js
/**
 * Cache hints for cheap polling, and presence.
 *
 * The spreadsheet is the only source of truth. The cache only holds "latest revision"
 * hints, short-lived (60 s), so it can be lost at any time:
 *  - before a commit the hint is removed, so a hint can never be newer-looking than
 *    the sheet;
 *  - after the commit it's republished. If republishing fails, the next poll misses
 *    the cache and reads the sheet.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.sync = (function () {
  var TTL = 60, PRESENCE_MS = 75000;   // longer than the slowest (hidden-page) poll

  function cache() { return GN.deps.cache; }
  function safe(fn) { try { return fn(); } catch (e) { GN.deps.log('cache: ' + (e && e.message)); return null; } }

  return {
    PRESENCE_MS: PRESENCE_MS,
    /** Before committing a change to scope (e.g. 'm:abc', 't:xyz', 'lobby'). */
    invalidate: function (key) { safe(function () { cache().remove(key); }); },
    publish: function (key, value) { safe(function () { cache().put(key, value, TTL); }); },
    hint: function (key) { return safe(function () { return cache().get(key); }); },
    /** The lobby changed: a new random version makes every lobby poll refetch. */
    touch: function (what) {
      if (what === 'lobby') safe(function () { cache().put('lobby:v', { v: GN.deps.newId(8) }, 6 * 3600); });
    },
    lobbyVersion: function () {
      var h = safe(function () { return cache().get('lobby:v'); });
      if (h && h.v) return h.v;
      var v = GN.deps.newId(8);
      safe(function () { cache().put('lobby:v', { v: v }, 6 * 3600); });
      return v;
    },
    /** Presence: record that member was here, return who has been seen recently. */
    here: function (scope, memberId, ids) {
      var now = GN.deps.now();
      safe(function () {
        cache().put('seen:' + scope + ':' + memberId, { at: now }, 180);
        // anyone polling anywhere counts as "here" in the lobby
        if (scope !== 'lobby') cache().put('seen:lobby:' + memberId, { at: now }, 180);
      });
      var others = (ids || []).filter(function (id) { return id !== memberId; });
      var keys = others.map(function (id) { return 'seen:' + scope + ':' + id; });
      var got = safe(function () {
        if (cache().getAll) return cache().getAll(keys);
        var o = {};
        keys.forEach(function (k) { o[k] = cache().get(k); });
        return o;
      }) || {};
      return (ids || []).filter(function (id) {
        if (id === memberId) return true;
        var s = got['seen:' + scope + ':' + id];
        return !!(s && now - s.at < PRESENCE_MS);
      });
    },
  };
})();


// ---- src/platform/tables.js
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


// ---- src/platform/util.js
/**
 * Small shared helpers. Plain JavaScript: runs in Apps Script (V8), Node tests and the
 * dev server, all sharing one global scope the way Apps Script loads files.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

/** An error meant for the player: message is shown, code is machine-readable. */
GN.ApiError = function (message, code, extra) {
  this.message = message;
  this.code = code || 'ERROR';
  this.extra = extra || null;
};

GN.fail = function (message, code, extra) {
  throw new GN.ApiError(message, code, extra);
};

GN.util = {
  clone: function (x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); },

  /** A short id/token-shaped string: letters, digits, _ and -. */
  isId: function (s, max) {
    return typeof s === 'string' && s.length > 0 && s.length <= (max || 64) && /^[A-Za-z0-9_-]+$/.test(s);
  },

  isText: function (s, max) { return typeof s === 'string' && s.length <= max; },

  cleanName: function (s) {
    return typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, 30) : '';
  },

  isEmail: function (s) {
    return typeof s === 'string' && s.length <= 254 && /^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/.test(s);
  },

  esc: function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },

  /** Fisher-Yates with an injectable random source (tests pass a fixed one). */
  shuffle: function (arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  },

  /** JSON size guard for anything a browser sends. */
  jsonSize: function (x) {
    try { return JSON.stringify(x === undefined ? null : x).length; } catch (e) { return Infinity; }
  },

  /** A request's {expectedRevision, actionId}; throws BAD_REQUEST when malformed. */
  checkReq: function (req) {
    if (!req || typeof req !== 'object' || Array.isArray(req)) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
    if (typeof req.actionId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(req.actionId)) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
    if (!Number.isInteger(req.expectedRevision) || req.expectedRevision < 0) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
    return req;
  },

  /** Remember an action's result on a record, keeping the last `keep` entries. */
  remember: function (list, entry, keep) {
    return (list || []).concat([entry]).slice(-(keep || 40));
  },

  findAction: function (list, actionId) {
    return (list || []).filter(function (a) { return a.id === actionId; })[0] || null;
  },
};


// ---- src/games/checkers/rules.js
/**
 * Checkers: American / English draughts for two players.
 *
 *  - 8 x 8 board; play on the dark squares ((row + col) odd). 12 pieces each.
 *  - Dark (first seat unless the table chooses at random) starts on rows 5-7 and moves
 *    first, "up" the board (towards row 0). Light starts on rows 0-2 and moves down.
 *  - Men move one square diagonally forward; they capture forward by jumping an
 *    adjacent opposing piece onto the empty square beyond. Kings move and capture one
 *    square diagonally in any direction (no long-range "flying" kings).
 *  - Capturing is compulsory. If several captures are possible, the player may choose
 *    ANY of them; there is no rule to take the most pieces.
 *  - After a capture, if the same piece can capture again it must continue, with that
 *    piece only. Each jump is one action, so the turn stays with the player until the
 *    sequence ends.
 *  - A man reaching the far row is crowned king, and crowning ends the turn, even in
 *    the middle of a capture sequence.
 *  - A player with no pieces, or no legal move on their turn, loses.
 *  - Either player may resign at any time. A draw may be offered; it happens only if
 *    the opponent accepts. An offer lapses when the opponent moves instead.
 *  - PLATFORM RULE (not part of the traditional rules): the game is drawn when the same
 *    position, with the same player to move, occurs for the third time.
 *
 * Board: rows[r][c] = null | {o: 0|1, k: bool} where o is the seat (0 dark, 1 light).
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.checkers = (function () {
  var N = 8;

  function initial() {
    var b = [];
    for (var r = 0; r < N; r++) {
      b.push([]);
      for (var c = 0; c < N; c++) {
        var dark = (r + c) % 2 === 1;
        b[r].push(dark && r <= 2 ? { o: 1, k: false } : dark && r >= 5 ? { o: 0, k: false } : null);
      }
    }
    return b;
  }

  function inside(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  function forward(o) { return o === 0 ? -1 : 1; }
  function farRow(o) { return o === 0 ? 0 : N - 1; }
  function dirs(p) { return p.k ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[forward(p.o), -1], [forward(p.o), 1]]; }

  function jumpsFrom(b, r, c) {
    var p = b[r][c], out = [];
    if (!p) return out;
    dirs(p).forEach(function (d) {
      var mr = r + d[0], mc = c + d[1], lr = r + 2 * d[0], lc = c + 2 * d[1];
      if (inside(lr, lc) && b[mr][mc] && b[mr][mc].o !== p.o && !b[lr][lc]) out.push({ from: [r, c], to: [lr, lc], capture: [mr, mc] });
    });
    return out;
  }

  function stepsFrom(b, r, c) {
    var p = b[r][c], out = [];
    if (!p) return out;
    dirs(p).forEach(function (d) {
      var tr = r + d[0], tc = c + d[1];
      if (inside(tr, tc) && !b[tr][tc]) out.push({ from: [r, c], to: [tr, tc], capture: null });
    });
    return out;
  }

  /** Every legal move for seat o: jumps only if any exist (captures are compulsory). */
  function legal(s, o) {
    if (s.continuing) return jumpsFrom(s.rows, s.continuing[0], s.continuing[1]);
    var jumps = [], steps = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var p = s.rows[r][c];
      if (!p || p.o !== o) continue;
      jumps = jumps.concat(jumpsFrom(s.rows, r, c));
      steps = steps.concat(stepsFrom(s.rows, r, c));
    }
    return jumps.length ? jumps : steps;
  }

  function count(b, o) {
    var n = 0;
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (b[r][c] && b[r][c].o === o) n++;
    return n;
  }

  /** Compact position key: the 32 playable squares plus the seat to move. */
  function key(s) {
    var k = '';
    for (var r = 0; r < N; r++) for (var c = (r + 1) % 2; c < N; c += 2) {
      var p = s.rows[r][c];
      k += !p ? '.' : p.o === 0 ? (p.k ? 'D' : 'd') : (p.k ? 'L' : 'l');
    }
    return k + s.turn;
  }

  function setup(players, darkSeat) {
    var order = darkSeat === 1 ? [players[1], players[0]] : players.slice();
    var s = { players: order, rows: initial(), turn: 0, continuing: null, status: 'active', winner: null, reason: null,
      drawOffer: null, seen: {}, moves: [], plies: 0 };
    s.seen[key(s)] = 1;
    return s;
  }

  function seatOf(s, player) { return s.players.indexOf(player); }

  function end(s, winnerSeat, reason) {
    s.status = 'finished';
    s.winner = winnerSeat === null ? null : s.players[winnerSeat];
    s.reason = reason;
    s.continuing = null;
    s.drawOffer = null;
  }

  function cleanSquare(x) {
    return Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && inside(x[0], x[1]) ? [x[0], x[1]] : null;
  }

  function move(s, player, from, to) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    var o = seatOf(s, player);
    if (o !== s.turn) return { ok: false, error: "It's not your turn." };
    var f = cleanSquare(from), t = cleanSquare(to);
    if (!f || !t) return { ok: false, error: 'Choose a piece and a square on the board.' };
    var p = s.rows[f[0]][f[1]];
    if (!p || p.o !== o) return { ok: false, error: 'Choose one of your own pieces.' };
    var options = legal(s, o);
    var mv = options.filter(function (m) { return m.from[0] === f[0] && m.from[1] === f[1] && m.to[0] === t[0] && m.to[1] === t[1]; })[0];
    if (!mv) {
      if (s.continuing) return { ok: false, error: 'Keep jumping with the same piece.' };
      if (options.length && options[0].capture) return { ok: false, error: 'You must capture: a jump is available.' };
      return { ok: false, error: 'That piece cannot move there.' };
    }
    s.rows[t[0]][t[1]] = p;
    s.rows[f[0]][f[1]] = null;
    var captured = null;
    if (mv.capture) {
      var cp = s.rows[mv.capture[0]][mv.capture[1]];
      captured = { at: mv.capture, king: cp.k };
      s.rows[mv.capture[0]][mv.capture[1]] = null;
    }
    var crowned = !p.k && t[0] === farRow(o);
    if (crowned) p.k = true;
    s.plies++;
    var more = !!mv.capture && !crowned && jumpsFrom(s.rows, t[0], t[1]).length > 0;
    var rec = { player: player, from: f, to: t, captured: captured, crowned: crowned, continues: more };
    s.moves.push(rec);
    if (more) { s.continuing = t; return { ok: true, move: rec }; }

    // the turn ends
    s.continuing = null;
    if (s.drawOffer && s.drawOffer !== player) s.drawOffer = null;   // moving instead of answering declines
    s.turn = 1 - s.turn;
    var other = s.turn;
    if (!count(s.rows, other)) { end(s, o, 'no pieces left'); return { ok: true, move: rec }; }
    if (!legal(s, other).length) { end(s, o, 'no legal moves'); return { ok: true, move: rec }; }
    // positions cannot repeat across a capture or a man's move, so history restarts there
    if (captured || !p.k || crowned) s.seen = {};
    var k = key(s);
    s.seen[k] = (s.seen[k] || 0) + 1;
    if (s.seen[k] >= 3) end(s, null, 'the same position occurred three times (platform rule)');
    return { ok: true, move: rec };
  }

  function resign(s, player) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    var o = seatOf(s, player);
    if (o < 0) return { ok: false, error: 'You are not playing in this game.' };
    end(s, 1 - o, 'resignation');
    return { ok: true };
  }

  function offerDraw(s, player) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (seatOf(s, player) < 0) return { ok: false, error: 'You are not playing in this game.' };
    if (s.drawOffer === player) return { ok: false, error: 'You have already offered a draw.' };
    if (s.drawOffer) return { ok: false, error: 'Your opponent has offered a draw: accept or decline it.' };
    s.drawOffer = player;
    return { ok: true };
  }

  function answerDraw(s, player, accept) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (seatOf(s, player) < 0) return { ok: false, error: 'You are not playing in this game.' };
    if (!s.drawOffer || s.drawOffer === player) return { ok: false, error: 'There is no draw offer to answer.' };
    if (accept) end(s, null, 'draw agreed');
    else s.drawOffer = null;
    return { ok: true };
  }

  function withdrawDraw(s, player) {
    if (s.status !== 'active' || s.drawOffer !== player) return { ok: false, error: 'You have no draw offer to withdraw.' };
    s.drawOffer = null;
    return { ok: true };
  }

  return { N: N, initial: initial, setup: setup, legal: legal, move: move, resign: resign, offerDraw: offerDraw,
    answerDraw: answerDraw, withdrawDraw: withdrawDraw, key: key, count: count, jumpsFrom: jumpsFrom };
})();

GN.games.checkers = (function () {
  var K = GN.checkers;

  function result(s) {
    return { status: 'finished', winners: s.winner ? [s.winner] : [], scores: null, adjustments: [], reason: s.reason };
  }

  return {
    id: 'checkers', name: 'Checkers', version: '1.0.0', rulesVersion: 1, minutes: 30,
    description: 'American draughts on an 8 × 8 board. Jump to capture, captures are compulsory, and reach the far side to crown a king.',
    players: { min: 2, max: 2 },
    options: [
      { id: 'dark', label: 'Who plays Dark (moves first)', type: 'choice', default: 'seat',
        choices: [{ value: 'seat', label: 'The first seat (usually the host)' }, { value: 'random', label: 'Decided at random' }] },
    ],
    anytime: ['resign', 'offer-draw', 'accept-draw', 'decline-draw', 'withdraw-draw'],

    setup: function (ctx) {
      return K.setup(ctx.players, ctx.options.dark === 'random' ? Math.floor(ctx.rng() * 2) : 0);
    },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action) {
      var r, events;
      switch (action.type) {
        case 'move':
          r = K.move(s, player, action.from, action.to);
          if (!r.ok) return r;
          events = [{ type: 'move', public: r.move }];
          break;
        case 'resign': r = K.resign(s, player); if (!r.ok) return r; events = [{ type: 'resign', public: { player: player } }]; break;
        case 'offer-draw': r = K.offerDraw(s, player); if (!r.ok) return r; events = [{ type: 'offer-draw', public: { player: player } }]; break;
        case 'accept-draw': r = K.answerDraw(s, player, true); if (!r.ok) return r; events = [{ type: 'accept-draw', public: { player: player } }]; break;
        case 'decline-draw': r = K.answerDraw(s, player, false); if (!r.ok) return r; events = [{ type: 'decline-draw', public: { player: player } }]; break;
        case 'withdraw-draw': r = K.withdrawDraw(s, player); if (!r.ok) return r; events = [{ type: 'withdraw-draw', public: { player: player } }]; break;
        default: return { ok: false, error: 'Unknown move.' };
      }
      var out = { ok: true, state: s, events: events, response: { continues: !!s.continuing } };
      if (s.status === 'finished') {
        out.result = result(s);
        events.push({ type: 'end', public: { winners: out.result.winners, reason: s.reason } });
      }
      return out;
    },

    view: function (s) {
      var legal = s.status === 'active' ? K.legal(s, s.turn) : [];
      return { players: s.players, rows: s.rows, turn: s.turn, current: s.status === 'active' ? s.players[s.turn] : null,
        continuing: s.continuing, mustCapture: legal.length > 0 && !!legal[0].capture, legal: legal, drawOffer: s.drawOffer,
        status: s.status, winner: s.winner, reason: s.reason, last: s.moves[s.moves.length - 1] || null,
        pieces: [K.count(s.rows, 0), K.count(s.rows, 1)], plies: s.plies };
    },

    summary: function (s, players) {
      var name = function (id) { return (players.filter(function (p) { return p.id === id; })[0] || {}).name || '?'; };
      if (s.status === 'finished') return s.winner ? name(s.winner) + ' won (' + s.reason + ')' : 'Draw (' + s.reason + ')';
      return name(s.players[0]) + ' ' + K.count(s.rows, 0) + ' · ' + name(s.players[1]) + ' ' + K.count(s.rows, 1) + ' pieces';
    },
  };
})();


// ---- src/games/dots/rules.js
/**
 * Dots and Boxes for 2 to 4 players. Players take turns drawing one line between two
 * neighbouring dots. Whoever completes a box (its fourth side) claims it and must draw
 * again; one line can complete two boxes at once. When every box is claimed, the most
 * boxes wins; equal top counts tie.
 *
 * A grid of R x C boxes has (R+1) x C horizontal lines h[r][c] and R x (C+1) vertical
 * lines v[r][c]. Each holds null or the id of whoever drew it; boxes[r][c] likewise.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.dots = (function () {
  var SIZES = { small: { rows: 3, cols: 3 }, medium: { rows: 4, cols: 4 }, large: { rows: 6, cols: 6 } };

  function grid(n, m) { var g = []; for (var i = 0; i < n; i++) { g.push([]); for (var j = 0; j < m; j++) g[i].push(null); } return g; }

  function setup(players, size) {
    var z = SIZES[size] || SIZES.medium;
    var scores = {};
    players.forEach(function (p) { scores[p] = 0; });
    return { players: players.slice(), rows: z.rows, cols: z.cols, size: SIZES[size] ? size : 'medium',
      h: grid(z.rows + 1, z.cols), v: grid(z.rows, z.cols + 1), boxes: grid(z.rows, z.cols),
      scores: scores, turn: 0, status: 'active', winners: [], moves: [], left: z.rows * z.cols };
  }

  /** {o: 'h'|'v', r, c} with integers inside the grid, or null. */
  function cleanEdge(s, e) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    if (e.o !== 'h' && e.o !== 'v') return null;
    if (!Number.isInteger(e.r) || !Number.isInteger(e.c)) return null;
    var maxR = e.o === 'h' ? s.rows : s.rows - 1, maxC = e.o === 'h' ? s.cols - 1 : s.cols;
    if (e.r < 0 || e.c < 0 || e.r > maxR || e.c > maxC) return null;
    return { o: e.o, r: e.r, c: e.c };
  }

  function boxDone(s, r, c) {
    return !!(s.h[r][c] && s.h[r + 1][c] && s.v[r][c] && s.v[r][c + 1]);
  }

  /** The (one or two) boxes a line borders. */
  function neighbours(s, e) {
    var out = [];
    if (e.o === 'h') {
      if (e.r > 0) out.push([e.r - 1, e.c]);
      if (e.r < s.rows) out.push([e.r, e.c]);
    } else {
      if (e.c > 0) out.push([e.r, e.c - 1]);
      if (e.c < s.cols) out.push([e.r, e.c]);
    }
    return out;
  }

  function draw(s, player, edge) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (s.players[s.turn] !== player) return { ok: false, error: "It's not your turn." };
    var e = cleanEdge(s, edge);
    if (!e) return { ok: false, error: 'Choose a line between two neighbouring dots.' };
    var lines = e.o === 'h' ? s.h : s.v;
    if (lines[e.r][e.c]) return { ok: false, error: 'That line is already drawn.' };
    lines[e.r][e.c] = player;
    var claimed = neighbours(s, e).filter(function (b) { return !s.boxes[b[0]][b[1]] && boxDone(s, b[0], b[1]); });
    claimed.forEach(function (b) { s.boxes[b[0]][b[1]] = player; });
    s.scores[player] += claimed.length;
    s.left -= claimed.length;
    s.moves.push({ player: player, edge: e, boxes: claimed });
    if (s.left === 0) {
      s.status = 'finished';
      var best = Math.max.apply(null, s.players.map(function (p) { return s.scores[p]; }));
      s.winners = s.players.filter(function (p) { return s.scores[p] === best; });
    } else if (!claimed.length) {
      s.turn = (s.turn + 1) % s.players.length;    // completing a box keeps the turn
    }
    return { ok: true, edge: e, boxes: claimed, again: claimed.length > 0 && s.status === 'active' };
  }

  return { SIZES: SIZES, setup: setup, draw: draw, cleanEdge: cleanEdge };
})();

GN.games.dots = (function () {
  var D = GN.dots;
  function label(size) { var z = D.SIZES[size]; return z.rows * z.cols + ' boxes (' + z.rows + ' × ' + z.cols + ')'; }
  return {
    id: 'dots', name: 'Dots and Boxes', version: '1.0.0', rulesVersion: 1, minutes: 15,
    description: 'Take turns joining dots. Close a box to claim it and draw again. Most boxes wins.',
    players: { min: 2, max: 4 },
    options: [
      { id: 'size', label: 'Grid', type: 'choice', default: 'medium',
        choices: [{ value: 'small', label: 'Small: ' + label('small') }, { value: 'medium', label: 'Medium: ' + label('medium') },
          { value: 'large', label: 'Large: ' + label('large') }] },
    ],
    anytime: [],

    setup: function (ctx) { return D.setup(ctx.players, ctx.options.size); },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action) {
      if (action.type !== 'line') return { ok: false, error: 'Unknown move.' };
      var r = D.draw(s, player, action.edge);
      if (!r.ok) return r;
      var events = [{ type: 'line', public: { player: player, edge: r.edge, boxes: r.boxes, again: r.again } }];
      var out = { ok: true, state: s, events: events, response: { boxes: r.boxes.length, again: r.again } };
      if (s.status === 'finished') {
        out.result = { status: 'finished', winners: s.winners.slice(), scores: GN.util.clone(s.scores), adjustments: [],
          reason: s.winners.length > 1 ? 'tied for the most boxes' : 'most boxes' };
        events.push({ type: 'end', public: { winners: out.result.winners, scores: s.scores, reason: out.result.reason } });
      }
      return out;
    },

    view: function (s) {
      return { players: s.players, rows: s.rows, cols: s.cols, size: s.size, h: s.h, v: s.v, boxes: s.boxes, scores: s.scores,
        turn: s.turn, current: s.status === 'active' ? s.players[s.turn] : null, status: s.status, winners: s.winners,
        left: s.left, last: s.moves[s.moves.length - 1] || null, moveCount: s.moves.length };
    },

    summary: function (s, players) {
      return players.map(function (p) { return p.name + ' ' + s.scores[p.id]; }).join(' · ') + (s.status === 'active' ? ' · ' + s.left + ' boxes left' : '');
    },
  };
})();


// ---- src/games/fivefold/rules.js
/**
 * Fivefold (display name configurable in src/config/names.js): a five-dice scorecard
 * game for 2 to 4 players.
 *
 *  - On your turn roll five dice up to three times. After the first roll you may hold
 *    any dice; the rest are rolled again. You may score after any roll.
 *  - Score exactly one empty category per turn; 13 categories, so 13 rounds.
 *      Ones..Sixes      sum of the dice showing that face
 *      Three of a Kind  sum of all dice, if at least three show the same face
 *      Four of a Kind   sum of all dice, if at least four show the same face
 *      Full House       25, for three of one face and two of another
 *      Small Straight   30, for four faces in sequence
 *      Large Straight   40, for five faces in sequence
 *      Five of a Kind   50, for all five the same
 *      Chance           sum of all dice
 *  - Upper bonus: 35 when Ones..Sixes total 63 or more.
 *  - A category may be scored as 0 (for example to keep a better one free); the player
 *    must confirm it.
 *  - SIMPLIFICATION: there are no extra bonuses for further Five of a Kind rolls and no
 *    "joker" rules. Five of a kind scores 0 as a Full House or a straight.
 *
 * Dice are rolled by the server only. Every roll is stored in the match (and in its
 * events), so retries return the same dice and replays show the actual rolls.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.fivefold = (function () {
  var UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
  var LOWER = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'fiveKind', 'chance'];
  var CATEGORIES = UPPER.concat(LOWER);
  var LABELS = { ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
    threeKind: 'Three of a Kind', fourKind: 'Four of a Kind', fullHouse: 'Full House', smallStraight: 'Small Straight',
    largeStraight: 'Large Straight', fiveKind: 'Five of a Kind', chance: 'Chance' };
  var BONUS = 35, BONUS_AT = 63, ROLLS = 3;

  function counts(d) { var n = [0, 0, 0, 0, 0, 0, 0]; d.forEach(function (x) { n[x]++; }); return n; }
  function sum(d) { return d.reduce(function (a, b) { return a + b; }, 0); }
  function run(d) {
    var have = counts(d), best = 0, cur = 0;
    for (var f = 1; f <= 6; f++) { cur = have[f] ? cur + 1 : 0; if (cur > best) best = cur; }
    return best;
  }

  /** Points the dice would score in a category (no bonuses). */
  function score(cat, d) {
    var n = counts(d), most = Math.max.apply(null, n);
    var i = UPPER.indexOf(cat);
    if (i >= 0) return n[i + 1] * (i + 1);
    switch (cat) {
      case 'threeKind': return most >= 3 ? sum(d) : 0;
      case 'fourKind': return most >= 4 ? sum(d) : 0;
      case 'fullHouse': return n.indexOf(3) >= 0 && n.indexOf(2) >= 0 ? 25 : 0;
      case 'smallStraight': return run(d) >= 4 ? 30 : 0;
      case 'largeStraight': return run(d) === 5 ? 40 : 0;
      case 'fiveKind': return most === 5 ? 50 : 0;
      case 'chance': return sum(d);
    }
    return 0;
  }

  function upperTotal(card) { return UPPER.reduce(function (a, c) { return a + (card[c] || 0); }, 0); }
  function totals(card) {
    var up = upperTotal(card), bonus = up >= BONUS_AT ? BONUS : 0;
    var low = LOWER.reduce(function (a, c) { return a + (card[c] || 0); }, 0);
    return { upper: up, bonus: bonus, lower: low, total: up + bonus + low };
  }

  function emptyCard() { var c = {}; CATEGORIES.forEach(function (k) { c[k] = null; }); return c; }

  function setup(players) {
    var cards = {};
    players.forEach(function (p) { cards[p] = emptyCard(); });
    return { players: players.slice(), cards: cards, turn: 0, round: 1, dice: null, held: [false, false, false, false, false],
      rollsLeft: ROLLS, status: 'active', winners: [], rolls: [], scored: [], adjustments: [] };
  }

  function die(rng) { return 1 + Math.floor(rng() * 6); }

  function roll(s, player, hold, rng) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (s.players[s.turn] !== player) return { ok: false, error: "It's not your turn." };
    if (s.rollsLeft <= 0) return { ok: false, error: 'No rolls left: choose a category to score.' };
    var h = [false, false, false, false, false];
    if (hold !== undefined && hold !== null) {
      if (!Array.isArray(hold) || hold.length !== 5 || hold.some(function (x) { return typeof x !== 'boolean'; })) {
        return { ok: false, error: 'Choose which dice to hold.' };
      }
      h = hold.slice();
    }
    if (!s.dice) {
      if (h.some(Boolean)) return { ok: false, error: 'Roll first; you can hold dice after the first roll.' };
    } else if (h.every(Boolean)) {
      return { ok: false, error: 'Release at least one die to roll again, or score now.' };
    }
    var dice = s.dice ? s.dice.slice() : [0, 0, 0, 0, 0];
    for (var i = 0; i < 5; i++) if (!h[i]) dice[i] = die(rng);
    s.dice = dice;
    s.held = h;
    s.rollsLeft--;
    var rec = { player: player, round: s.round, n: ROLLS - s.rollsLeft, dice: dice.slice(), held: h.slice() };
    s.rolls.push(rec);
    return { ok: true, roll: rec };
  }

  function take(s, player, cat, zeroOk) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (s.players[s.turn] !== player) return { ok: false, error: "It's not your turn." };
    if (!s.dice) return { ok: false, error: 'Roll the dice first.' };
    if (CATEGORIES.indexOf(cat) < 0) return { ok: false, error: 'Choose a category on your scorecard.' };
    var card = s.cards[player];
    if (card[cat] !== null) return { ok: false, error: LABELS[cat] + ' is already scored.' };
    var pts = score(cat, s.dice);
    if (pts === 0 && zeroOk !== true) return { ok: false, code: 'CONFIRM_ZERO', error: LABELS[cat] + ' would score 0. Confirm to take the zero.' };
    card[cat] = pts;
    var rec = { player: player, round: s.round, category: cat, points: pts, dice: s.dice.slice() };
    s.scored.push(rec);
    s.dice = null; s.held = [false, false, false, false, false]; s.rollsLeft = ROLLS;
    s.turn = (s.turn + 1) % s.players.length;
    if (s.turn === 0) s.round++;
    if (s.round > CATEGORIES.length) finish(s);
    return { ok: true, scored: rec };
  }

  function finish(s) {
    s.status = 'finished';
    s.adjustments = [];
    var best = -1;
    s.players.forEach(function (p) {
      var t = totals(s.cards[p]);
      if (t.bonus) s.adjustments.push({ player: p, points: t.bonus, reason: 'upper section ' + t.upper + ' (63 or more)' });
      if (t.total > best) best = t.total;
    });
    s.winners = s.players.filter(function (p) { return totals(s.cards[p]).total === best; });
  }

  return { UPPER: UPPER, LOWER: LOWER, CATEGORIES: CATEGORIES, LABELS: LABELS, BONUS: BONUS, BONUS_AT: BONUS_AT, ROLLS: ROLLS,
    score: score, totals: totals, setup: setup, roll: roll, take: take };
})();

GN.games.fivefold = (function () {
  var F = GN.fivefold;
  return {
    id: 'fivefold', name: 'Fivefold', version: '1.0.0', rulesVersion: 1, minutes: 30,
    description: 'Roll five dice up to three times a turn and fill a 13-line scorecard. Straights, full houses and five of a kind score big.',
    players: { min: 2, max: 4 },
    options: [],
    anytime: [],

    setup: function (ctx) { return F.setup(ctx.players); },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action, ctx) {
      var r, events;
      if (action.type === 'roll') {
        r = F.roll(s, player, action.hold, ctx.rng);
        if (!r.ok) return r;
        events = [{ type: 'roll', public: r.roll }];
        return { ok: true, state: s, events: events, response: { dice: r.roll.dice, held: r.roll.held, rollsLeft: s.rollsLeft } };
      }
      if (action.type === 'score') {
        r = F.take(s, player, action.category, action.zero);
        if (!r.ok) return r;
        events = [{ type: 'score', public: r.scored }];
        var out = { ok: true, state: s, events: events, response: { points: r.scored.points } };
        if (s.status === 'finished') {
          var scores = {};
          s.players.forEach(function (p) { scores[p] = F.totals(s.cards[p]).total; });
          out.result = { status: 'finished', winners: s.winners.slice(), scores: scores, adjustments: GN.util.clone(s.adjustments),
            reason: s.winners.length > 1 ? 'tied for the highest total' : 'highest total' };
          events.push({ type: 'end', public: { winners: out.result.winners, scores: scores, adjustments: s.adjustments } });
        }
        return out;
      }
      return { ok: false, error: 'Unknown move.' };
    },

    view: function (s) {
      var totals = {}, potential = null;
      s.players.forEach(function (p) { totals[p] = F.totals(s.cards[p]); });
      if (s.status === 'active' && s.dice) {
        potential = {};
        var card = s.cards[s.players[s.turn]];
        F.CATEGORIES.forEach(function (c) { if (card[c] === null) potential[c] = F.score(c, s.dice); });
      }
      return { players: s.players, cards: s.cards, totals: totals, turn: s.turn, current: s.status === 'active' ? s.players[s.turn] : null,
        round: Math.min(s.round, F.CATEGORIES.length), rounds: F.CATEGORIES.length, dice: s.dice, held: s.held, rollsLeft: s.rollsLeft,
        potential: potential, status: s.status, winners: s.winners, adjustments: s.status === 'active' ? [] : s.adjustments,
        lastRoll: s.rolls[s.rolls.length - 1] || null, lastScore: s.scored[s.scored.length - 1] || null };
    },

    summary: function (s, players) {
      return players.map(function (p) { return p.name + ' ' + F.totals(s.cards[p.id]).total; }).join(' · ') +
        (s.status === 'active' ? ' · round ' + s.round + ' of 13' : '');
    },
  };
})();


// ---- src/games/fourinarow/rules.js
/**
 * Four in a Row: two players drop discs into a 7-column, 6-row upright grid. A disc
 * falls to the lowest empty space. Four or more of your discs in a line (across, down
 * or diagonal) wins; a full grid with no line is a draw.
 *
 * Grid: rows[r][c], r = 0 is the TOP row, c = 0 the left column; null | player id.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.fourinarow = (function () {
  var COLS = 7, ROWS = 6, NEED = 4;

  function empty() {
    var g = [];
    for (var r = 0; r < ROWS; r++) { g.push([]); for (var c = 0; c < COLS; c++) g[r].push(null); }
    return g;
  }

  /** The row a disc dropped in column c lands in, or -1 if the column is full. */
  function landing(grid, c) {
    for (var r = ROWS - 1; r >= 0; r--) if (!grid[r][c]) return r;
    return -1;
  }

  /** The longest line through (r, c) for its owner, if it is at least NEED long. */
  function lineThrough(grid, r, c) {
    var who = grid[r][c];
    var best = null;
    [[0, 1], [1, 0], [1, 1], [1, -1]].forEach(function (d) {
      var cells = [[r, c]];
      [1, -1].forEach(function (s) {
        var rr = r + d[0] * s, cc = c + d[1] * s;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && grid[rr][cc] === who) {
          if (s > 0) cells.push([rr, cc]); else cells.unshift([rr, cc]);
          rr += d[0] * s; cc += d[1] * s;
        }
      });
      if (cells.length >= NEED && (!best || cells.length > best.length)) best = cells;
    });
    return best;
  }

  function full(grid) { return grid[0].every(function (x) { return x; }); }

  function setup(players, first) {
    return { players: players.slice(), rows: empty(), turn: first || 0, status: 'active', winner: null, line: null,
      moves: [], first: first || 0 };
  }

  function drop(s, player, col) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (s.players[s.turn] !== player) return { ok: false, error: "It's not your turn." };
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return { ok: false, error: 'Choose one of the seven columns.' };
    var r = landing(s.rows, col);
    if (r < 0) return { ok: false, error: 'That column is full.' };
    s.rows[r][col] = player;
    s.moves.push({ player: player, col: col, row: r });
    var line = lineThrough(s.rows, r, col);
    if (line) {
      s.status = 'finished'; s.winner = player; s.line = line;
    } else if (full(s.rows)) {
      s.status = 'finished'; s.winner = null;
    } else {
      s.turn = 1 - s.turn;
    }
    return { ok: true, row: r, col: col, line: line };
  }

  return { COLS: COLS, ROWS: ROWS, empty: empty, landing: landing, lineThrough: lineThrough, setup: setup, drop: drop };
})();

GN.games.fourinarow = (function () {
  var F = GN.fourinarow;
  return {
    id: 'fourinarow', name: 'Four in a Row', version: '1.0.0', rulesVersion: 1, minutes: 10,
    description: 'Drop discs into the upright grid. Line up four of yours across, down or diagonally before your opponent does.',
    players: { min: 2, max: 2 },
    options: [
      { id: 'first', label: 'Who goes first', type: 'choice', default: 'seat',
        choices: [{ value: 'seat', label: 'The first seat (usually the host)' }, { value: 'random', label: 'Decided at random' }] },
    ],
    anytime: [],

    setup: function (ctx) {
      var first = ctx.options.first === 'random' ? Math.floor(ctx.rng() * 2) : 0;
      return F.setup(ctx.players, first);
    },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action) {
      if (action.type !== 'drop') return { ok: false, error: 'Unknown move.' };
      var r = F.drop(s, player, action.col);
      if (!r.ok) return r;
      var events = [{ type: 'drop', public: { player: player, col: r.col, row: r.row } }];
      var out = { ok: true, state: s, events: events, response: { row: r.row, col: r.col } };
      if (s.status === 'finished') {
        out.result = { status: 'finished', winners: s.winner ? [s.winner] : [], scores: null, adjustments: [],
          reason: s.winner ? 'four in a row' : 'the grid is full: a draw', line: s.line };
        events.push({ type: 'end', public: { winners: out.result.winners, line: s.line, reason: out.result.reason } });
      }
      return out;
    },

    view: function (s) {
      return { players: s.players, rows: s.rows, turn: s.turn, current: s.status === 'active' ? s.players[s.turn] : null,
        status: s.status, winner: s.winner, line: s.line, last: s.moves[s.moves.length - 1] || null, moveCount: s.moves.length };
    },

    summary: function (s, players) {
      var name = function (id) { return (players.filter(function (p) { return p.id === id; })[0] || {}).name || '?'; };
      if (s.status === 'finished') return s.winner ? name(s.winner) + ' won' : 'Draw';
      return s.moves.length + ' discs played · ' + name(s.players[s.turn]) + ' to move';
    },
  };
})();


// ---- src/games/wordwright/rules.js
/**
 * Wordwright: a crossword tile game for 2 to 4 players (ported from the Crabbles rules).
 * Pure rules, no Apps Script calls; GN.games.wordwright adapts them to the platform's
 * game interface (docs/game-authoring.md).
 *
 * Board: 15x15 of null | {l: "A".."Z", b: true for a blank}.
 * Racks hold "A".."Z" and "?" (a blank). A placement is {r, c, l, b}.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.wordwright = (function () {
  var SIZE = 15, CENTER = 7, RACK_SIZE = 7, BINGO = 50;

  var DISTRIBUTION = {
    A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
    N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, '?': 2,
  };
  var VALUES = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
    N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, '?': 0,
  };

  // One quadrant (rows/cols 0..7), mirrored to all four.
  var PREMIUM_QUADRANT = {
    TW: [[0, 0], [0, 7], [7, 0]],
    DW: [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]],
    TL: [[1, 5], [5, 1], [5, 5]],
    DL: [[0, 3], [3, 0], [2, 6], [6, 2], [3, 7], [7, 3], [6, 6]],
  };

  var PREMIUM = (function () {
    var grid = [];
    for (var r = 0; r < SIZE; r++) { grid.push([]); for (var c = 0; c < SIZE; c++) grid[r].push(''); }
    Object.keys(PREMIUM_QUADRANT).forEach(function (kind) {
      PREMIUM_QUADRANT[kind].forEach(function (rc) {
        var r = rc[0], c = rc[1];
        [[r, c], [r, SIZE - 1 - c], [SIZE - 1 - r, c], [SIZE - 1 - r, SIZE - 1 - c]].forEach(function (p) { grid[p[0]][p[1]] = kind; });
      });
    });
    return grid;
  })();

  function emptyBoard() {
    var b = [];
    for (var r = 0; r < SIZE; r++) { b.push([]); for (var c = 0; c < SIZE; c++) b[r].push(null); }
    return b;
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function newBag(rng) {
    var bag = [];
    Object.keys(DISTRIBUTION).forEach(function (l) { for (var i = 0; i < DISTRIBUTION[l]; i++) bag.push(l); });
    return shuffle(bag, rng);
  }

  function draw(bag, rack) { while (rack.length < RACK_SIZE && bag.length) rack.push(bag.pop()); return rack; }
  function rackValue(rack) { return rack.reduce(function (s, l) { return s + VALUES[l]; }, 0); }
  function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
  function boardIsEmpty(board) {
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (board[r][c]) return false;
    return true;
  }

  function takeFromRack(rack, placements) {
    var left = rack.slice();
    for (var i = 0; i < placements.length; i++) {
      var k = left.indexOf(placements[i].b ? '?' : placements[i].l);
      if (k < 0) return null;
      left.splice(k, 1);
    }
    return left;
  }

  function fail(msg, extra) {
    var o = { ok: false, error: msg };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }

  /** Placements come from a browser: check their shape before anything reads them. */
  function cleanPlacements(placements) {
    if (!Array.isArray(placements) || !placements.length) return { error: 'Place at least one tile.' };
    if (placements.length > RACK_SIZE) return { error: 'You can place at most 7 tiles.' };
    var out = [];
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      if (!p || typeof p !== 'object' || Array.isArray(p)) return { error: 'A tile placement is malformed.' };
      if (!Number.isInteger(p.r) || !Number.isInteger(p.c) || !inBounds(p.r, p.c)) return { error: 'A tile is off the board.' };
      if (typeof p.l !== 'string' || !/^[A-Z]$/.test(p.l)) return { error: 'Every tile needs a letter (choose one for blanks).' };
      if (p.b !== undefined && p.b !== null && typeof p.b !== 'boolean') return { error: 'A tile placement is malformed.' };
      out.push({ r: p.r, c: p.c, l: p.l, b: p.b === true });
    }
    return { placements: out };
  }

  function cleanLetters(letters) {
    if (!Array.isArray(letters) || !letters.length) return { error: 'Choose tiles to exchange.' };
    if (letters.length > RACK_SIZE) return { error: 'You can exchange at most 7 tiles.' };
    for (var i = 0; i < letters.length; i++) {
      if (typeof letters[i] !== 'string' || !/^[A-Z?]$/.test(letters[i])) return { error: 'Those tiles are not on your rack.' };
    }
    return { letters: letters.slice() };
  }

  function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  function hasNeighbourAlong(board, p, dr, dc) {
    var a = [p.r - dr, p.c - dc], b = [p.r + dr, p.c + dc];
    return (inBounds(a[0], a[1]) && !!board[a[0]][a[1]]) || (inBounds(b[0], b[1]) && !!board[b[0]][b[1]]);
  }

  function wordThrough(board, r, c, dr, dc) {
    while (inBounds(r - dr, c - dc) && board[r - dr][c - dc]) { r -= dr; c -= dc; }
    var cells = [], word = '';
    while (inBounds(r, c) && board[r][c]) {
      cells.push({ r: r, c: c, t: board[r][c] });
      word += board[r][c].l;
      r += dr; c += dc;
    }
    return { word: word, cells: cells };
  }

  /** Premium squares count only under tiles placed this turn. */
  function scoreWord(cells) {
    var sum = 0, mult = 1;
    cells.forEach(function (cell) {
      var v = cell.t.b ? 0 : VALUES[cell.t.l];
      if (cell.t.fresh) {
        var pr = PREMIUM[cell.r][cell.c];
        if (pr === 'DL') v *= 2;
        else if (pr === 'TL') v *= 3;
        else if (pr === 'DW') mult *= 2;
        else if (pr === 'TW') mult *= 3;
      }
      sum += v;
    });
    return sum * mult;
  }

  /**
   * Check and score a move. dict has has(word), or is null to skip the dictionary.
   * {ok:false, error} or {ok, words:[{word, score}], score, bingo, rackLeft, placements}.
   */
  function evaluateMove(board, rack, placements, dict) {
    var clean = cleanPlacements(placements);
    if (clean.error) return fail(clean.error);
    placements = clean.placements;
    var seen = {};
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      if (board[p.r][p.c]) return fail('That square is already taken.');
      var key = p.r + ',' + p.c;
      if (seen[key]) return fail('Two tiles on one square.');
      seen[key] = true;
    }
    var rackLeft = takeFromRack(rack, placements);
    if (!rackLeft) return fail('Those tiles are not on your rack.');

    var rows = unique(placements.map(function (q) { return q.r; }));
    var cols = unique(placements.map(function (q) { return q.c; }));
    if (rows.length > 1 && cols.length > 1) return fail('Tiles must be in one row or one column.');

    var after = board.map(function (row) { return row.slice(); });
    placements.forEach(function (q) { after[q.r][q.c] = { l: q.l, b: !!q.b, fresh: true }; });

    var horizontal = rows.length === 1 && (cols.length > 1 || hasNeighbourAlong(after, placements[0], 0, 1));
    var dr = horizontal ? 0 : 1, dc = horizontal ? 1 : 0;

    var line = placements.map(function (q) { return horizontal ? q.c : q.r; });
    var lo = Math.min.apply(null, line), hi = Math.max.apply(null, line);
    for (var k = lo; k <= hi; k++) {
      var rr = horizontal ? rows[0] : k, cc = horizontal ? k : cols[0];
      if (!after[rr][cc]) return fail('There is a gap between your tiles.');
    }

    if (boardIsEmpty(board)) {
      if (!seen[CENTER + ',' + CENTER]) return fail('The first word must cover the centre star.');
      if (placements.length < 2) return fail('The first word needs at least two letters.');
    } else {
      var touches = placements.some(function (q) {
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) {
          var r = q.r + d[0], c = q.c + d[1];
          return inBounds(r, c) && board[r][c];
        });
      });
      if (!touches) return fail('Your word must connect to tiles already on the board.');
    }

    var words = [];
    var main = wordThrough(after, placements[0].r, placements[0].c, dr, dc);
    if (main.cells.length > 1) words.push(main);
    placements.forEach(function (q) {
      var cross = wordThrough(after, q.r, q.c, dc, dr);
      if (cross.cells.length > 1) words.push(cross);
    });
    if (!words.length) return fail('A word needs at least two letters.');

    if (dict) {
      var bad = words.filter(function (w) { return !dict.has(w.word); }).map(function (w) { return w.word; });
      if (bad.length) return fail('Not in the dictionary: ' + bad.join(', '), { badWords: bad });
    }

    var total = 0;
    var scored = words.map(function (w) { var s = scoreWord(w.cells); total += s; return { word: w.word, score: s }; });
    var bingo = placements.length === RACK_SIZE;
    if (bingo) total += BINGO;
    return { ok: true, words: scored, score: total, bingo: bingo, rackLeft: rackLeft, placements: placements };
  }

  // ------------------------------------------------------------------ game flow

  function newGameState(players, rng) {
    var bag = newBag(rng);
    var racks = {}, scores = {};
    players.forEach(function (p) { racks[p] = draw(bag, []); scores[p] = 0; });
    return { players: players.slice(), board: emptyBoard(), bag: bag, racks: racks, scores: scores,
      turn: 0, scoreless: 0, status: 'active', moves: [], winner: null, adjustments: [], resigned: [] };
  }

  function currentPlayer(s) { return s.players[s.turn]; }

  function requireTurn(s, player) {
    if (s.status !== 'active') return 'This game is over.';
    if (currentPlayer(s) !== player) return "It's not your turn.";
    return null;
  }

  function activePlayers(s) { return s.players.filter(function (p) { return (s.resigned || []).indexOf(p) < 0; }); }
  function advance(s) {
    do { s.turn = (s.turn + 1) % s.players.length; }
    while ((s.resigned || []).indexOf(currentPlayer(s)) >= 0);
  }

  function scoreless(s) {
    s.scoreless = (s.scoreless || 0) + 1;
    if (s.scoreless >= 6) finish(s, null);
    else advance(s);
  }

  /**
   * End of game: each player loses their unplayed tile values; whoever went out gains
   * the total. Every change is recorded in s.adjustments for the result and replays.
   */
  function finish(s, wentOut) {
    var bonus = 0;
    s.adjustments = s.adjustments || [];
    activePlayers(s).forEach(function (p) {
      var v = rackValue(s.racks[p]);
      if (v) s.adjustments.push({ player: p, points: -v, reason: 'unplayed tiles ' + s.racks[p].join('') });
      s.scores[p] -= v;
      bonus += v;
    });
    if (wentOut && bonus) {
      s.scores[wentOut] += bonus;
      s.adjustments.push({ player: wentOut, points: bonus, reason: "went out: everyone else's unplayed tiles" });
    }
    s.status = 'finished';
    s.wentOut = wentOut || null;
    var eligible = activePlayers(s);
    var best = Math.max.apply(null, eligible.map(function (p) { return s.scores[p]; }));
    var top = eligible.filter(function (p) { return s.scores[p] === best; });
    s.winner = top.length === 1 ? top[0] : 'tie';
    s.winners = top;
    s.finishReason = wentOut ? 'went out' : 'six scoreless turns in a row';
  }

  function resignPlayer(s, player, rng, now) {
    if (s.status !== 'active') return fail('This game is over.');
    if (s.players.indexOf(player) < 0 || (s.resigned || []).indexOf(player) >= 0) return fail('You are not an active player.');
    s.resigned = s.resigned || [];
    var penalty = rackValue(s.racks[player]);
    if (penalty) {
      s.scores[player] -= penalty;
      s.adjustments.push({ player: player, points: -penalty, reason: 'resigned: unplayed tiles ' + s.racks[player].join('') });
    }
    s.bag = shuffle(s.bag.concat(s.racks[player]), rng);
    s.racks[player] = [];
    s.resigned.push(player);
    s.moves.push({ player: player, type: 'resign', score: 0, at: now || 0 });
    var remaining = activePlayers(s);
    if (remaining.length === 1) {
      s.status = 'finished';
      s.winner = remaining[0];
      s.winners = remaining;
      s.finishReason = 'resignation';
    } else if (currentPlayer(s) === player) advance(s);
    return { ok: true };
  }

  function playMove(s, player, placements, dict, now) {
    var err = requireTurn(s, player);
    if (err) return fail(err);
    var res = evaluateMove(s.board, s.racks[player], placements, dict);
    if (!res.ok) return res;
    res.placements.forEach(function (p) { s.board[p.r][p.c] = { l: p.l, b: p.b }; });
    s.racks[player] = draw(s.bag, res.rackLeft);
    s.scores[player] += res.score;
    // a valid play worth 0 (all blanks, no premiums) still counts as scoreless
    s.scoreless = res.score === 0 ? (s.scoreless || 0) + 1 : 0;
    s.moves.push({ player: player, type: 'play', tiles: res.placements, words: res.words, score: res.score, bingo: res.bingo, at: now || 0 });
    if (!s.racks[player].length && !s.bag.length) finish(s, player);
    else if (s.scoreless >= 6) finish(s, null);
    else advance(s);
    return { ok: true, score: res.score, words: res.words, bingo: res.bingo, placements: res.placements };
  }

  function exchangeTiles(s, player, letters, rng, now) {
    var err = requireTurn(s, player);
    if (err) return fail(err);
    var clean = cleanLetters(letters);
    if (clean.error) return fail(clean.error);
    letters = clean.letters;
    if (s.bag.length < RACK_SIZE) return fail('You can only exchange while the bag has at least 7 tiles.');
    var left = takeFromRack(s.racks[player], letters.map(function (l) { return l === '?' ? { l: 'A', b: true } : { l: l }; }));
    if (!left) return fail('Those tiles are not on your rack.');
    // return the tiles, mix the bag, then draw: a returned tile can come straight back
    s.bag = shuffle(s.bag.concat(letters), rng);
    draw(s.bag, left);
    s.racks[player] = left;
    s.moves.push({ player: player, type: 'exchange', count: letters.length, score: 0, at: now || 0 });
    scoreless(s);
    return { ok: true, count: letters.length };
  }

  function passTurn(s, player, now) {
    var err = requireTurn(s, player);
    if (err) return fail(err);
    s.moves.push({ player: player, type: 'pass', score: 0, at: now || 0 });
    scoreless(s);
    return { ok: true };
  }

  /** What a viewer may see: their own rack only; never the bag order or other racks. */
  function publicView(s, viewer) {
    var rackCounts = {};
    s.players.forEach(function (p) { rackCounts[p] = s.racks[p].length; });
    return {
      players: s.players, board: s.board, scores: s.scores, turn: s.turn, current: currentPlayer(s),
      status: s.status, winner: s.winner, bagCount: s.bag.length, rackCounts: rackCounts, resigned: s.resigned || [],
      myRack: viewer && s.racks[viewer] ? s.racks[viewer] : null,
      moves: s.moves.slice(-12), moveCount: s.moves.length, scoreless: s.scoreless || 0,
      adjustments: s.status === 'active' ? [] : s.adjustments,
    };
  }

  return {
    SIZE: SIZE, CENTER: CENTER, RACK_SIZE: RACK_SIZE, BINGO: BINGO, DISTRIBUTION: DISTRIBUTION, VALUES: VALUES, PREMIUM: PREMIUM,
    emptyBoard: emptyBoard, newBag: newBag, shuffle: shuffle, evaluateMove: evaluateMove, scoreWord: scoreWord,
    cleanPlacements: cleanPlacements, cleanLetters: cleanLetters, rackValue: rackValue,
    newGameState: newGameState, playMove: playMove, exchangeTiles: exchangeTiles, passTurn: passTurn, resignPlayer: resignPlayer, publicView: publicView,
  };
})();

GN.games.wordwright = (function () {
  var W = GN.wordwright;

  function dict(ctx) {
    if (!ctx.options.dictionary) return null;
    var d = ctx.services && ctx.services.dict ? ctx.services.dict() : null;
    if (!d) GN.fail('The word list is not available right now. Try again in a minute.', 'DICT');
    return d;
  }

  function result(s) {
    return { status: 'finished', winners: s.winners.slice(), scores: GN.util.clone(s.scores), adjustments: GN.util.clone(s.adjustments),
      reason: s.finishReason || (s.wentOut ? 'went out' : 'six scoreless turns in a row') };
  }

  return {
    id: 'wordwright', name: 'Wordwright', version: '1.0.0', rulesVersion: 1, minutes: 45,
    description: 'Build crossing words from a rack of seven letter tiles. Premium squares multiply letters and words.',
    players: { min: 2, max: 4 },
    options: [
      { id: 'dictionary', label: 'Check words against the word list', type: 'boolean', default: true,
        help: 'Off: players agree among themselves what counts.' },
      { id: 'board', label: 'Board', type: 'choice', default: 'drawn', display: true,
        help: 'Only changes the picture; the squares and rules are the same.',
        choices: [{ value: 'drawn', label: 'Drawn (matches the look)' }, { value: 'maple', label: 'Maple artwork' },
          { value: 'walnut', label: 'Walnut artwork' }, { value: 'felt', label: 'Felt artwork' }, { value: 'slate', label: 'Slate artwork' }] },
    ],
    anytime: ['resign'],
    assets: ['board-maple', 'board-walnut', 'board-felt', 'board-slate'],

    setup: function (ctx) { return W.newGameState(ctx.players, ctx.rng); },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action, ctx) {
      var r, events;
      if (action.type === 'play') {
        r = W.playMove(s, player, action.placements, dict(ctx), ctx.now);
        if (!r.ok) return r;
        events = [{ type: 'play', public: { player: player, tiles: r.placements, words: r.words, score: r.score, bingo: r.bingo } }];
      } else if (action.type === 'exchange') {
        r = W.exchangeTiles(s, player, action.letters, ctx.rng, ctx.now);
        if (!r.ok) return r;
        events = [{ type: 'exchange', public: { player: player, count: r.count } }];
      } else if (action.type === 'pass') {
        r = W.passTurn(s, player, ctx.now);
        if (!r.ok) return r;
        events = [{ type: 'pass', public: { player: player } }];
      } else if (action.type === 'resign') {
        r = W.resignPlayer(s, player, ctx.rng, ctx.now);
        if (!r.ok) return r;
        events = [{ type: 'resign', public: { player: player } }];
      } else {
        return { ok: false, error: 'Unknown move.' };
      }
      var out = { ok: true, state: s, events: events, response: { score: r.score || 0, words: r.words || [], bingo: !!r.bingo } };
      if (s.status === 'finished') {
        out.result = result(s);
        events.push({ type: 'end', public: { scores: s.scores, adjustments: s.adjustments, winners: s.winners, reason: out.result.reason } });
      }
      return out;
    },

    view: function (s, viewer) { return W.publicView(s, viewer); },

    summary: function (s, players) {
      return players.map(function (p) { return p.name + ' ' + s.scores[p.id]; }).join(' · ');
    },

    /** Score preview: evaluate a move without playing it. */
    query: function (s, player, q, ctx) {
      if (!q || q.type !== 'preview') return { ok: false, error: 'Unknown question.' };
      var rack = s.racks[player];
      if (!rack) return { ok: false, error: 'You are not playing in this game.' };
      var d = null;
      try { d = dict(ctx); } catch (e) { d = null; }
      var r = W.evaluateMove(s.board, rack, q.placements, d);
      return r.ok ? { ok: true, score: r.score, words: r.words, bingo: r.bingo, checked: !!d }
        : { ok: true, valid: false, error: r.error, badWords: r.badWords || [] };
    },
  };
})();


// ---- src/games/wordwright/bot.js
/** A bounded, deterministic casual opponent. The rules remain the final judge. */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.bots = GN.bots || {};

GN.bots.wordwright = {
  choose: function (state, player, ctx) {
    var dict = null;
    try { dict = ctx.services && ctx.services.dict && ctx.services.dict(); } catch (e) { dict = null; }
    if (!dict || typeof dict.has !== 'function' || typeof dict.forEach !== 'function') {
      GN.fail('The word list is not available right now. Try again in a minute.', 'DICT');
    }
    var W = GN.wordwright, board = state.board, rack = state.racks[player];
    var start = Date.now(), nodes = 0, stopped = false, best = null;
    var occupied = [], counts = {}, rackCounts = {};
    for (var r = 0; r < W.SIZE; r++) for (var c = 0; c < W.SIZE; c++) {
      if (board[r][c]) {
        occupied.push({ r: r, c: c, l: board[r][c].l });
        counts[board[r][c].l] = (counts[board[r][c].l] || 0) + 1;
      }
    }
    rack.forEach(function (l) { rackCounts[l] = (rackCounts[l] || 0) + 1; });
    var blankCount = rackCounts['?'] || 0;
    function withinLimit() {
      if (nodes >= 50000 || Date.now() - start >= 2000) { stopped = true; return false; }
      return true;
    }
    function tryAt(word, row, col, dr, dc) {
      if (!withinLimit()) return;
      nodes++;
      var available = Object.assign({}, rackCounts), blanks = blankCount, placed = [];
      for (var i = 0; i < word.length; i++) {
        var rr = row + dr * i, cc = col + dc * i, l = word.charAt(i);
        if (rr < 0 || cc < 0 || rr >= W.SIZE || cc >= W.SIZE) return;
        var tile = board[rr][cc];
        if (tile) { if (tile.l !== l) return; continue; }
        if (available[l]) { available[l]--; placed.push({ r: rr, c: cc, l: l }); }
        else if (blanks) { blanks--; placed.push({ r: rr, c: cc, l: l, b: true }); }
        else return;
      }
      if (!placed.length || placed.length > rack.length) return;
      var score = W.evaluateMove(board, rack, placed, dict);
      if (score.ok && (!best || score.score > best.score)) best = { score: score.score, placements: placed };
    }
    dict.forEach(function (entry) {
      if (stopped || !withinLimit()) return;
      var word = String(entry).toUpperCase();
      if (!/^[A-Z]{2,15}$/.test(word)) return;
      var needed = {}, deficit = 0;
      for (var i = 0; i < word.length; i++) needed[word.charAt(i)] = (needed[word.charAt(i)] || 0) + 1;
      Object.keys(needed).forEach(function (l) { deficit += Math.max(0, needed[l] - (rackCounts[l] || 0) - (counts[l] || 0)); });
      if (deficit > blankCount) return;
      if (!occupied.length) {
        for (var offset = 0; offset < word.length; offset++) {
          if (stopped) return;
          tryAt(word, W.CENTER, W.CENTER - offset, 0, 1);
          tryAt(word, W.CENTER - offset, W.CENTER, 1, 0);
        }
      } else {
        for (var a = 0; a < occupied.length; a++) {
          for (var j = 0; j < word.length; j++) {
            if (stopped) return;
            if (word.charAt(j) !== occupied[a].l) continue;
            tryAt(word, occupied[a].r, occupied[a].c - j, 0, 1);
            tryAt(word, occupied[a].r - j, occupied[a].c, 1, 0);
          }
        }
      }
    });
    if (best) return { type: 'play', placements: best.placements };
    return state.bag.length >= W.RACK_SIZE && rack.length ? { type: 'exchange', letters: rack.slice() } : { type: 'pass' };
  },
};


// ---- src/appsscript/Server.js
/**
 * Game Night: Apps Script entry points. This project is BOUND to the installation's
 * spreadsheet (Extensions > Apps Script in that sheet).
 *
 *   onOpen          adds the "Game Night" menu to the spreadsheet
 *   gnSetup         first-time setup (menu); Google asks for authorization here
 *   doGet / call    the web app and its one RPC entry point
 *   gnMaintain      optional timed trigger: repairs and email retries
 *
 * An installation counts as "this one" only when the script's stored ids match BOTH
 * the spreadsheet and the Settings tab. A copied spreadsheet (template or not) never
 * inherits members, sessions, codes or setup flags: setup wipes them first.
 */

// ------------------------------------------------------------------ menu and setup

function onOpen() {
  SpreadsheetApp.getUi().createMenu(GN.NAMES.platform)
    .addItem('Set up this spreadsheet…', 'gnSetup')
    .addItem('How to publish the web app', 'gnPublishHelp')
    .addItem('Turn on automatic repairs (optional)', 'gnInstallTrigger')
    .addItem('Repair now', 'gnRepairNow')
    .addToUi();
}

function gnSetup() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var status = gnBinding_(ss);
  if (status === 'ours') {
    ui.alert(GN.NAMES.platform, 'This spreadsheet is already set up. Use "How to publish the web app" for the next step.', ui.ButtonSet.OK);
    return;
  }
  if (status === 'foreign') {
    var ok = ui.alert('Start fresh?', 'This spreadsheet contains data from another ' + GN.NAMES.platform +
      ' installation (it was probably copied). Setting up will erase its members, tables, games and settings. Continue?',
      ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
  }
  var ask = function (title, prompt, check, fallback) {
    while (true) {
      var r = ui.prompt(title, prompt, ui.ButtonSet.OK_CANCEL);
      if (r.getSelectedButton() !== ui.Button.OK) return null;
      var v = r.getResponseText().trim() || fallback || '';
      var problem = check(v);
      if (!problem) return v;
      ui.alert(title, problem, ui.ButtonSet.OK);
    }
  };
  var group = ask('Group name', 'What should the group be called? (Shown on the entry screen and in invitations.)',
    function (v) { return v ? null : 'Type a name.'; }, 'Game Night');
  if (group === null) return;
  var code = ask('Group code', 'Choose the code people type to join (at least 4 characters). Share it only with your group.',
    function (v) { return v.length >= 4 ? null : 'Use at least 4 characters.'; });
  if (code === null) return;
  var name = ask('Your name', 'Your display name in the games (you will be the group admin).',
    function (v) { return v ? null : 'Type your name.'; });
  if (name === null) return;
  var pin = ask('Your admin PIN', 'Choose a 4 to 8 digit PIN. You will need it to sign in as admin on each device.',
    function (v) { return /^[0-9]{4,8}$/.test(v) ? null : 'Use 4 to 8 digits.'; });
  if (pin === null) return;

  gnFreshInstall_(ss);
  gnInitDeps_();
  var res = GN.install.initialize({ groupName: group, code: code, adminName: name, adminPin: pin,
    adminEmail: Session.getEffectiveUser().getEmail() });
  var props = PropertiesService.getScriptProperties();
  props.setProperties({ SHEET_ID: ss.getId(), INSTALL_ID: res.installId, SCRIPT_ID: ScriptApp.getScriptId() });
  ui.alert('Set up', 'Done. Next, publish the web app: open the menu ' + GN.NAMES.platform +
    ' > "How to publish the web app".', ui.ButtonSet.OK);
}

function gnPublishHelp() {
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  SpreadsheetApp.getUi().alert('Publish the web app',
    '1. Extensions > Apps Script.\n' +
    '2. Deploy > New deployment > the gear icon > Web app.\n' +
    '3. Execute as: Me.   Who has access: Anyone.\n' +
    '4. Deploy, approve the permissions, and copy the Web app URL.\n' +
    '5. Open that URL, type your group code and sign in as yourself with your PIN.\n' +
    '6. Share the URL and the code with your group.\n\n' +
    'Copying a spreadsheet never publishes anything: each copy must be deployed by its owner.' +
    (url ? '\n\nCurrent web app URL: ' + url : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function gnInstallTrigger() {
  if (!gnReady_()) return;
  var ui = SpreadsheetApp.getUi();
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'gnMaintain'; });
  if (!has) ScriptApp.newTrigger('gnMaintain').timeBased().everyMinutes(10).create();
  ui.alert(GN.NAMES.platform, 'Automatic repairs and email retries now run every 10 minutes.', ui.ButtonSet.OK);
}

function gnRepairNow() {
  if (!gnReady_()) return;
  var r = GN.maintenance.run(50);
  SpreadsheetApp.getUi().alert(GN.NAMES.platform, 'Repaired ' + r.matches + ' games and ' + r.tables +
    ' tables; sent ' + r.sent + ' emails.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Optional timed trigger. */
function gnMaintain() {
  if (!gnReady_()) return;
  var r = GN.maintenance.run(30);
  console.log(JSON.stringify({ job: 'maintain', fixed: r }));
}

/**
 * 'none'    nothing here yet (fresh copy of the template, or a new sheet)
 * 'ours'    set up, and the stored ids match this spreadsheet and its Settings
 * 'foreign' the sheet holds another installation's data (a copy of a used sheet)
 */
function gnBinding_(ss) {
  var props = PropertiesService.getScriptProperties();
  gnInitDeps_(ss);
  var installId = GN.deps.store.setting('install_id');
  if (props.getProperty('SCRIPT_ID') === ScriptApp.getScriptId() && props.getProperty('SHEET_ID') === ss.getId() && installId && props.getProperty('INSTALL_ID') === installId) return 'ours';
  var hasData = !!installId || GN.install.DATA_TABLES.some(function (t) {
    var sh = ss.getSheetByName(t);
    return sh && sh.getLastRow() > 1;
  });
  return hasData ? 'foreign' : 'none';
}

/** Forget everything inherited: script properties, data tabs, cached hints. */
function gnFreshInstall_(ss) {
  PropertiesService.getScriptProperties().deleteAllProperties();
  try {
    var t = ScriptApp.getProjectTriggers();
    t.forEach(function (x) { ScriptApp.deleteTrigger(x); });
  } catch (e) { /* triggers are optional */ }
  gnInitDeps_(ss);
  GN.install.wipe();
}

// ------------------------------------------------------------------ web app

function doGet(e) {
  var p = (e && e.parameter) || {};
  var t = HtmlService.createTemplateFromFile('Index');
  var ready = gnReady_();
  t.ready = ready;
  // the only server data in the page; "<" is escaped so it cannot close the script tag
  t.boot = JSON.stringify({
    ready: ready, platform: GN.NAMES.platform,
    link: GN.util.isId(p.t) ? p.t : '',
    debug: p.debug === '1',
  }).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(GN.NAMES.platform)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** The single function the page calls. */
function call(method, args) {
  var t0 = Date.now(), res = null;
  try {
    if (!gnReady_()) return (res = { ok: false, code: 'NOT_SET_UP', error: 'This group is not set up yet. Its owner must open the spreadsheet and use the ' + GN.NAMES.platform + ' menu.' });
    GN.install.migrate();
    res = GN.api.handle(method, Array.isArray(args) ? args : null);
    return res;
  } catch (e) {
    // nothing was committed unless the store write finished; the page retries with the same actionId
    console.error(JSON.stringify({ rpc: String(method).slice(0, 30), error: String(e && e.stack || e).slice(0, 800) }));
    var busy = /lock|timed? ?out|Service invoked too many times|temporarily/i.test(String(e && e.message));
    return (res = { ok: false, code: busy ? 'BUSY' : 'SERVER', retry: true,
      error: busy ? 'The game is busy for a moment. Trying again…' : 'Something went wrong on the server. Please try again.' });
  } finally {
    console.log(JSON.stringify({ rpc: String(method).slice(0, 30), ms: Date.now() - t0, ok: !!(res && res.ok), code: res && res.code || null }));
  }
}

/**
 * Setup binds both the container and script project. Web requests may open the saved
 * sheet only after matching the current script id; inherited copy properties fail closed.
 */
function gnReady_() {
  var ss = gnContainer_();
  if (!ss) return false;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SCRIPT_ID') !== ScriptApp.getScriptId() || props.getProperty('SHEET_ID') !== ss.getId()) return false;
  gnInitDeps_(ss);
  GN.deps.store.list('Settings');              // one read; the settings below come from memory
  var installId = GN.deps.store.setting('install_id');
  return !!installId && installId === props.getProperty('INSTALL_ID') && GN.install.isSetUp();
}

function gnContainer_() {
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { /* web execution */ }
  if (active) return active;
  // A copied bound project has a different script id. Check BEFORE opening any id.
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SCRIPT_ID') !== ScriptApp.getScriptId()) return null;
  var id = props.getProperty('SHEET_ID');
  if (!id) return null;
  try { return SpreadsheetApp.openById(id); } catch (e) { return null; }
}

// ------------------------------------------------------------------ adapters

var GN_SS_ = null;

function gnInitDeps_(ss) {
  if (ss) GN_SS_ = ss;
  if (!GN_SS_) GN_SS_ = gnContainer_();
  if (!GN_SS_) throw new Error('This script must be bound to its spreadsheet.');
  if (GN.deps && GN.deps._ss === GN_SS_) return GN.deps;
  var cache = CacheService.getScriptCache();
  var props = PropertiesService.getScriptProperties();
  GN.deps = {
    _ss: GN_SS_,
    store: gnSheetStore_(GN_SS_),
    cache: {
      get: function (k) { var v = cache.get(k); return v ? JSON.parse(v) : null; },
      getAll: function (keys) {
        var raw = keys.length ? cache.getAll(keys) : {}, out = {};
        Object.keys(raw).forEach(function (k) { out[k] = JSON.parse(raw[k]); });
        return out;
      },
      put: function (k, v, seconds) { cache.put(k, JSON.stringify(v), Math.min(21600, seconds || 60)); },
      remove: function (k) { cache.remove(k); },
    },
    withLock: function (fn) {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { return fn(); } finally { lock.releaseLock(); }
    },
    now: function () { return Date.now(); },
    rng: Math.random,
    newId: function (n) {
      var s = '';
      while (s.length < n) s += Utilities.base64EncodeWebSafe(Utilities.getUuid()).replace(/[^A-Za-z0-9]/g, '');
      return s.slice(0, n);
    },
    hash: function (s) {
      return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
        .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    },
    sleep: function (ms) { Utilities.sleep(ms); },
    mail: function (to, subject, html) { MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: GN.NAMES.platform }); },
    appUrl: function () { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } },
    drive: gnDrive_(props),
    services: { dict: gnDictionary_ },
    asset: function (file) {
      try { return HtmlService.createHtmlOutputFromFile(file).getContent(); } catch (e) { return null; }   // optional file
    },
    log: function (s) { console.log(String(s).slice(0, 500)); },
  };
  return GN.deps;
}

/** Drive folders for this installation, created on first use. */
function gnDrive_(props) {
  function folder(sub) {
    var rootId = props.getProperty('FOLDER_ID'), root = null;
    if (rootId) { try { root = DriveApp.getFolderById(rootId); } catch (e) { root = null; } }
    if (!root) {
      root = DriveApp.createFolder(GN.NAMES.platform + ' files');
      props.setProperty('FOLDER_ID', root.getId());
    }
    if (!sub) return root;
    var it = root.getFoldersByName(sub);
    return it.hasNext() ? it.next() : root.createFolder(sub);
  }
  return {
    saveText: function (sub, name, text) {
      var f = folder(sub);
      var old = f.getFilesByName(name);
      while (old.hasNext()) old.next().setTrashed(true);
      var file = f.createFile(name, text, 'text/plain');
      return { id: file.getId(), url: file.getUrl() };
    },
    saveBytes: function (sub, name, mime, base64) {
      var f = folder(sub);
      var old = f.getFilesByName(name);
      while (old.hasNext()) old.next().setTrashed(true);          // a retried piece replaces the first
      var file = f.createFile(Utilities.newBlob(Utilities.base64Decode(base64), mime, name));
      return { id: file.getId(), url: file.getUrl() };
    },
    find: function (sub, name) {
      var it = folder(sub).getFilesByName(name);
      return it.hasNext() ? it.next().getId() : null;
    },
    joinBytes: function (sub, name, mime, ids) {
      var bytes = [];
      ids.forEach(function (id) { bytes = bytes.concat(DriveApp.getFileById(id).getBlob().getBytes()); });
      var file = folder(sub).createFile(Utilities.newBlob(bytes, mime, name));
      return { id: file.getId(), url: file.getUrl() };
    },
    readText: function (id) { return DriveApp.getFileById(id).getBlob().getDataAsString(); },
    remove: function (id) { DriveApp.getFileById(id).setTrashed(true); },
    folder: folder,
  };
}

/** Word list for Wordwright: downloaded to Drive on first use (public-domain ENABLE list). */
var GN_DICT_ = null;
function gnDictionary_() {
  if (GN_DICT_) return GN_DICT_;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DICT_ID'), text = null;
  if (id) { try { text = DriveApp.getFileById(id).getBlob().getDataAsString(); } catch (e) { text = null; } }
  if (!text) {
    text = UrlFetchApp.fetch('https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt').getContentText();
    var file = GN.deps.drive.folder('data').createFile('enable1.txt', text, 'text/plain');
    props.setProperty('DICT_ID', file.getId());
  }
  GN_DICT_ = new Set(text.toUpperCase().split(/\r?\n/).filter(function (w) { return w; }));
  ['QI', 'ZA', 'QIS', 'ZAS', 'OK', 'EW'].forEach(function (w) { GN_DICT_.add(w); });
  return GN_DICT_;
}

/**
 * Cell text that Sheets would treat as a formula (or strip, like a leading apostrophe)
 * is stored with an invisible marker in front; reads remove it. Player names are
 * free text, so "=IMPORTXML(...)" must stay text.
 */
var GN_MARK_ = '\u2063';
function gnCellOut_(v) { return typeof v === 'string' && /^[=+\-@'\u2063]/.test(v) ? GN_MARK_ + v : v; }
function gnCellIn_(v) { return typeof v === 'string' && v.charAt(0) === GN_MARK_ ? v.slice(1) : v; }

/** The spreadsheet store: one tab per GN.SCHEMA entry, plain-text cells. */
function gnSheetStore_(ss) {
  var memo = {};
  function toRow(name, rec) { return GN.rowOf(name, rec).map(gnCellOut_); }
  function fromRow(name, row) { return GN.recordOf(name, row.map(gnCellIn_)); }
  function append(name, row) {
    var sh = sheet(name);
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  }
  function sheet(name) {
    var sh = ss.getSheetByName(name);
    if (sh) return sh;
    var cols = GN.SCHEMA[name].cols;
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  function width(name, opts) {
    var s = GN.SCHEMA[name];
    return opts && opts.index && s.index ? s.index : s.cols.length;
  }
  function rowIndex(name, key) {
    var sh = sheet(name);
    var last = sh.getLastRow();
    if (last < 2) return -1;
    var hit = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(gnCellOut_(String(key))))
      .matchEntireCell(true).matchCase(true).useRegularExpression(false).findNext();
    return hit ? hit.getRow() : -1;
  }
  function readAll(name, opts) {
    var k = name + (opts && opts.index ? ':i' : '');
    if (memo[k]) return memo[k];
    var sh = sheet(name);
    var last = sh.getLastRow();
    var rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, width(name, opts)).getValues();
    memo[k] = rows.filter(function (r) { return r[0] !== ''; }).map(function (r) { return fromRow(name, r); });
    return memo[k];
  }
  function forget(name) { delete memo[name]; delete memo[name + ':i']; }
  var store = {
    refresh: function () { memo = {}; },
    get: function (name, key) {
      if (memo[name]) {
        var keyCol = GN.SCHEMA[name].key;
        var hit = memo[name].filter(function (r) { return String(r[keyCol]) === String(key); })[0];
        return hit ? JSON.parse(JSON.stringify(hit)) : null;
      }
      var row = rowIndex(name, key);
      if (row < 0) return null;
      return fromRow(name, sheet(name).getRange(row, 1, 1, GN.SCHEMA[name].cols.length).getValues()[0]);
    },
    list: function (name, opts) {
      var rows = readAll(name, opts);
      var where = opts && opts.where;
      if (where) rows = rows.filter(function (r) { return Object.keys(where).every(function (k) { return String(r[k]) === String(where[k]); }); });
      return JSON.parse(JSON.stringify(rows));
    },
    put: function (name, rec) {
      var row = toRow(name, rec);
      var at = rowIndex(name, rec[GN.SCHEMA[name].key]);
      if (at < 0) append(name, row);
      else sheet(name).getRange(at, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      forget(name);
    },
    insert: function (name, rec) {
      if (rowIndex(name, rec[GN.SCHEMA[name].key]) >= 0) return false;
      append(name, toRow(name, rec));
      forget(name);
      return true;
    },
    remove: function (name, key) {
      var at = rowIndex(name, key);
      if (at >= 0) sheet(name).deleteRow(at);
      forget(name);
    },
    clear: function (name) {
      var sh = sheet(name);
      var last = sh.getLastRow();
      if (last > 1) sh.deleteRows(2, last - 1);
      forget(name);
    },
    setting: function (key) { var r = store.get('Settings', key); return r ? String(r.value) : ''; },
    setSetting: function (key, value) { store.put('Settings', { key: key, value: String(value) }); },
  };
  return store;
}
