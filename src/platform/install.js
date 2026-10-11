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
