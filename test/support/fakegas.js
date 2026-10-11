// Simulated Apps Script services, detailed enough to run src/appsscript/Server.js and the
// real spreadsheet store in Node. Each "project" is a separate VM context with its own
// globals, script properties, cache and bound spreadsheet, like a real container-bound
// script. copyProject() imitates File > Make a copy of the spreadsheet.
//
// This is a simulation. It does not prove the real deployment works; the release
// checklist (docs/troubleshooting.md) covers checks in a real Google account.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { serverFiles, SRC } = require('./load.js');

const CELL_MAX = 50000;
let nextId = 1;
const newFileId = (prefix) => prefix + (nextId++).toString(36).padStart(8, '0') + crypto.randomBytes(6).toString('hex');

// ------------------------------------------------------------------ Sheets

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];          // rows[r][c] = {v, f} ; f = number format
    this.maxRows = 1000;
    this.frozen = 0;
  }
  cell(r, c) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push({ v: '', f: '' });
    return row[c - 1];
  }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getLastRow() {
    for (let r = this.rows.length; r >= 1; r--) if (this.rows[r - 1].some((x) => x.v !== '')) return r;
    return 0;
  }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  setFrozenRows(n) { this.frozen = n; }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  deleteRows(r, n) { this.rows.splice(r - 1, n); }
  clone() {
    const s = new FakeSheet(this.name);
    s.rows = this.rows.map((row) => row.map((x) => ({ ...x })));
    s.frozen = this.frozen;
    return s;
  }
}

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.sheet.cell(this.r + i, this.c + j), i, j); }
  setNumberFormat(f) { if (this.r + this.nr - 1 > this.sheet.maxRows) this.sheet.maxRows = this.r + this.nr - 1; this.each((x) => (x.f = f)); return this; }
  setFontWeight() { return this; }
  setValues(values) {
    if (values.length !== this.nr || values.some((row) => row.length !== this.nc)) throw new Error('The number of rows or columns in the data does not match the range.');
    this.each((x, i, j) => {
      let v = values[i][j];
      if (v === null || v === undefined) v = '';
      if (typeof v === 'string' && v.length > CELL_MAX) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
      // Sheets parses typed values even in plain-text cells when they look like formulas,
      // and drops a leading apostrophe. Simulate both so the store must escape them.
      if (typeof v === 'string' && /^[=+@-]/.test(v) && v.length > 1 && !/^-?\d/.test(v)) v = '#ERROR! (parsed as formula: ' + v + ')';
      else if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
      if (x.f === '@') v = String(v);
      x.v = v;
    });
    return this;
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const x = this.sheet.rows[this.r + i - 1] && this.sheet.rows[this.r + i - 1][this.c + j - 1];
        row.push(x ? x.v : '');
      }
      out.push(row);
    }
    return out;
  }
  createTextFinder(text) {
    const range = this;
    const opt = { entire: false, matchCase: false, regex: false };
    const finder = {
      matchEntireCell(b) { opt.entire = b; return finder; },
      matchCase(b) { opt.matchCase = b; return finder; },
      useRegularExpression(b) { opt.regex = b; return finder; },
      findNext() {
        const want = opt.matchCase ? text : text.toLowerCase();
        for (let i = 0; i < range.nr; i++) {
          for (let j = 0; j < range.nc; j++) {
            const row = range.sheet.rows[range.r + i - 1];
            let v = String(row && row[range.c + j - 1] ? row[range.c + j - 1].v : '');
            if (!opt.matchCase) v = v.toLowerCase();
            if (opt.entire ? v === want : v.includes(want)) return { getRow: () => range.r + i };
          }
        }
        return null;
      },
    };
    return finder;
  }
}

class FakeSpreadsheet {
  constructor(name) { this.id = newFileId('ss'); this.name = name; this.sheets = [new FakeSheet('Sheet1')]; }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  copy(name) { const c = new FakeSpreadsheet(name); c.sheets = this.sheets.map((s) => s.clone()); return c; }
}

// ------------------------------------------------------------------ one script project

function makeProject(ss, opts = {}) {
  const props = new Map(opts.props || []);
  const cache = new Map();
  const triggers = [];
  const mails = [];
  const ui = { alerts: [], prompts: [], answers: [], confirm: [] };
  const log = [];
  let lockBusy = false;
  const state = { url: opts.url || '', lockFail: 0 };

  const Button = { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' };
  const ButtonSet = { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' };
  const services = {
    SpreadsheetApp: {
      getActive: () => ss,
      getActiveSpreadsheet: () => state.web ? null : ss,
      openById: (id) => { state.opened = (state.opened || []).concat(id); if (id !== ss.getId()) throw new Error('foreign sheet'); return ss; },
      getUi: () => ({
        Button, ButtonSet,
        createMenu: (title) => {
          const menu = { title, items: [] };
          const m = { addItem: (label, fn) => { menu.items.push([label, fn]); return m; }, addToUi: () => { ui.menu = menu; } };
          return m;
        },
        alert: (title, msg, set) => {
          ui.alerts.push({ title, msg: msg === undefined ? title : msg });
          if (set === ButtonSet.YES_NO) return ui.confirm.length ? ui.confirm.shift() : Button.NO;
          return Button.OK;
        },
        prompt: (title, msg) => {
          ui.prompts.push(title);
          if (!ui.answers.length) return { getSelectedButton: () => Button.CANCEL, getResponseText: () => '' };
          const a = ui.answers.shift();
          return { getSelectedButton: () => (a === null ? Button.CANCEL : Button.OK), getResponseText: () => (a === null ? '' : a) };
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        setProperties: (o) => { for (const k of Object.keys(o)) props.set(k, String(o[k])); },
        deleteAllProperties: () => props.clear(),
        getProperties: () => Object.fromEntries(props),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        getAll: (keys) => { const o = {}; keys.forEach((k) => { if (cache.has(k)) o[k] = cache.get(k); }); return o; },
        put: (k, v) => {
          if (String(v).length > 100 * 1024) throw new Error('Argument too large: value');
          cache.set(k, String(v));
        },
        remove: (k) => cache.delete(k),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          if (state.lockFail > 0) { state.lockFail--; throw new Error('Lock timeout: another process was holding the lock for too long.'); }
          if (lockBusy) throw new Error('re-entrant lock in simulation');
          lockBusy = true;
        },
        releaseLock: () => { lockBusy = false; },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...crypto.createHash('sha256').update(String(s), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString('base64url'),
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
      sleep: () => {},
    },
    MailApp: { sendEmail: (o) => { if (lockBusy) throw new Error('mail sent while holding the lock'); mails.push(o); } },
    Session: { getEffectiveUser: () => ({ getEmail: () => opts.ownerEmail || 'owner@example.com' }) },
    ScriptApp: {
      getScriptId: () => "script-" + ss.getId(),
      getService: () => ({ getUrl: () => state.url }),
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: (fn) => {
        const b = { timeBased: () => b, everyMinutes: () => b, create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } };
        return b;
      },
    },
    DriveApp: {
      createFolder: () => { throw new Error('Drive is not simulated here'); },
      getFolderById: () => { throw new Error('Drive is not simulated here'); },
      getFileById: () => { throw new Error('Drive is not simulated here'); },
    },
    UrlFetchApp: { fetch: () => { throw new Error('network is not simulated here'); } },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
      createTemplateFromFile: (name) => {
        const t = { name, evaluate: () => { const out = { template: t, setTitle: () => out, addMetaTag: () => out, setXFrameOptionsMode: () => out }; return out; } };
        return t;
      },
      createHtmlOutputFromFile: (name) => ({ getContent: () => '<!-- ' + name + ' -->' }),
    },
    console: {
      log: (s) => log.push(String(s)),
      error: (s) => log.push('ERROR ' + String(s)),
      warn: (s) => log.push('WARN ' + String(s)),
    },
  };

  const context = vm.createContext({ ...services });
  const files = opts.bundle ? [opts.bundle].concat(opts.extra || []) : serverFiles().map((f) => path.join(SRC, f)).concat(opts.extra || [], [path.join(SRC, 'appsscript', 'Server.js')]);
  for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });

  /** Run a server function the way Apps Script does: a fresh execution, same project. */
  const run = (fn, ...args) => {
    context.GN.deps = null;           // globals other than state persist only within one execution
    context.GN_SS_ = null;
    return context[fn](...args);
  };
  return { ss, props, cache, triggers, mails, ui, log, state, context, run,
    /** Answer the next setup prompts (null = Cancel). */
    answer: (...a) => { ui.answers.push(...a); },
    confirm: (...a) => { ui.confirm.push(...a); } };
}

/** A blank spreadsheet with the bound script, as the release template is. */
function template(opts = {}) {
  return makeProject(new FakeSpreadsheet('Game Night'), opts);
}

/** File > Make a copy: new spreadsheet, new script project. Properties copy only if asked. */
function copyProject(p, opts = {}) {
  return makeProject(p.ss.copy('Copy of ' + p.ss.getName()), {
    ...opts, props: opts.copyProperties ? [...p.props] : [],
  });
}

module.exports = { template, copyProject, FakeSpreadsheet, CELL_MAX };
