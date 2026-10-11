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
