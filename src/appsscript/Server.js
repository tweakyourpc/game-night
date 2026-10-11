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
