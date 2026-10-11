// In-memory stand-ins for the Sheets store, CacheService, LockService, Mail and Drive.
// Used by unit tests and the local dev server. Records are copied in and out, like a
// real sheet, and any operation can be made to fail once (fault injection).
'use strict';
const crypto = require('node:crypto');

function makeStore() {
  const tables = {};
  const faults = {};          // 'put:Matches' -> remaining failures
  const counts = {};          // operation counters, for tests
  const t = (name) => (tables[name] = tables[name] || new Map());
  const keyOf = (name, rec) => rec[GN.SCHEMA[name].key];
  // a Google Sheets cell holds at most 50,000 characters; fail loudly the way Sheets would
  const CELL_MAX = 50000;
  const roundTrip = (name, rec) => GN.recordOf(name, GN.rowOf(name, rec).map((v, i) => {
    const text = v === '' ? '' : String(v);
    if (text.length > CELL_MAX) throw new Error('cell too large: ' + name + '.' + GN.SCHEMA[name].cols[i] + ' ' + text.length);
    return text;
  }));
  function hit(op, name) {
    const k = op + ':' + name;
    counts[k] = (counts[k] || 0) + 1;
    if (faults[k] > 0) {
      faults[k]--;
      throw new Error('injected failure: ' + k);
    }
  }
  const store = {
    tables, faults, counts,
    failNext(op, name, times) { faults[op + ':' + name] = times || 1; },
    refresh() {},
    get(name, key) {
      hit('get', name);
      const r = t(name).get(String(key));
      return r ? GN.util.clone(r) : null;
    },
    list(name, opts) {
      hit('list', name);
      let out = [...t(name).values()].map((r) => GN.util.clone(r));
      const where = opts && opts.where;
      if (where) out = out.filter((r) => Object.keys(where).every((k) => String(r[k]) === String(where[k])));
      if (opts && opts.index && GN.SCHEMA[name].index) {
        const keep = GN.SCHEMA[name].cols.slice(0, GN.SCHEMA[name].index);
        out = out.map((r) => { const o = {}; keep.forEach((c) => (o[c] = r[c])); return o; });
      }
      return out;
    },
    put(name, rec) {
      hit('put', name);
      // values pass through the same text conversion a plain-text sheet applies
      t(name).set(String(keyOf(name, rec)), roundTrip(name, rec));
    },
    insert(name, rec) {
      hit('insert', name);
      const k = String(keyOf(name, rec));
      if (t(name).has(k)) return false;
      t(name).set(k, roundTrip(name, rec));
      return true;
    },
    remove(name, key) { hit('remove', name); t(name).delete(String(key)); },
    clear(name) { t(name).clear(); },
    setting(key) { const r = store.get('Settings', key); return r ? String(r.value) : ''; },
    setSetting(key, value) { store.put('Settings', { key, value: String(value) }); },
  };
  return store;
}

function makeDeps(opts = {}) {
  const store = makeStore();
  const cache = new Map();
  const mails = [];
  const files = new Map();
  let fileSeq = 0;
  let lockHeld = false;
  let clock = opts.now0 || 1_800_000_000_000;
  const faults = {};
  const deps = {
    store, mails, files, cacheMap: cache,
    get lockHeld() { return lockHeld; },
    tick(ms) { clock += ms; },
    now: () => (opts.realTime ? Date.now() : clock),
    rng: opts.rng || Math.random,
    newId: (n) => crypto.randomBytes(n).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, n),
    hash: (s) => crypto.createHash('sha256').update(String(s)).digest('hex'),
    sleep: (ms) => { deps.slept = (deps.slept || 0) + ms; },
    failNext(name, times) { faults[name] = times || 1; },
    withLock(fn) {
      if (lockHeld) throw new Error('lock is not re-entrant');
      lockHeld = true;
      try { return fn(); } finally { lockHeld = false; }
    },
    cache: {
      get(k) { return cache.has(k) ? JSON.parse(cache.get(k)) : null; },
      getAll(keys) { const o = {}; keys.forEach((k) => { if (cache.has(k)) o[k] = JSON.parse(cache.get(k)); }); return o; },
      put(k, v) {
        if (faults['cache.put'] > 0 && /^(m|t|lobby):/.test(k)) { faults['cache.put']--; throw new Error('injected cache failure'); }
        cache.set(k, JSON.stringify(v));
      },
      remove(k) {
        if (faults['cache.remove'] > 0) { faults['cache.remove']--; throw new Error('injected cache failure'); }
        cache.delete(k);
      },
    },
    mail(to, subject, html) {
      if (lockHeld) throw new Error('mail sent while holding the lock');
      if (faults.mail > 0) { faults.mail--; throw new Error('mail service unavailable'); }
      mails.push({ to, subject, html });
    },
    appUrl: () => opts.appUrl || 'https://example.test/exec',
    drive: {
      saveText(folder, name, text) {
        if (lockHeld) throw new Error('drive write while holding the lock');
        for (const [k, f] of files) if (f.folder === folder && f.name === name) files.delete(k);
        const id = 'f' + (++fileSeq);
        files.set(id, { folder, name, text });
        return { id, url: 'https://drive.test/' + id };
      },
      saveBytes(folder, name, mime, base64) {
        if (lockHeld) throw new Error('drive write while holding the lock');
        if (faults['drive.saveBytes'] > 0) { faults['drive.saveBytes']--; throw new Error('injected drive failure'); }
        for (const [k, f] of files) if (f.folder === folder && f.name === name) files.delete(k);
        const id = 'f' + (++fileSeq);
        files.set(id, { folder, name, mime, base64 });
        return { id, url: 'https://drive.test/' + id };
      },
      find(folder, name) { for (const [k, f] of files) if (f.folder === folder && f.name === name) return k; return null; },
      joinBytes(folder, name, mime, ids) {
        if (lockHeld) throw new Error('drive write while holding the lock');
        const bytes = Buffer.concat(ids.map((k) => Buffer.from(files.get(k).base64, 'base64')));
        return deps.drive.saveBytes(folder, name, mime, bytes.toString('base64'));
      },
      readText(id) { const f = files.get(id); return f ? f.text : null; },
      remove(id) { files.delete(id); },
    },
    services: {},
    log: () => {},
  };
  return deps;
}

module.exports = { makeStore, makeDeps };
