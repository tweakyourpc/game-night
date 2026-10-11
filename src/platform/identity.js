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
