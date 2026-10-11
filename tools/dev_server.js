#!/usr/bin/env node
// Local test server: the real platform and game code with simulated storage (in memory,
// lost on exit). For development and browser checks only; an installation never runs this.
//
//   node tools/dev_server.js --port <broker-port> [--bundle <apps-script-directory>] [--test-game] [--words enable1.txt] [--state dev-state.json]
//
// It starts with a sample group: code "maple owl", admin "Ann" with PIN 1234.
// Use http://localhost:PORT and http://127.0.0.1:PORT as two different players (each
// address keeps its own sign-in in the browser).
'use strict';
const http = require('node:http');
const path = require('node:path');
const { page } = require('./assemble.js');
const { loadServer } = require('../test/support/load.js');
const { makeDeps } = require('../test/support/memstore.js');

const args = process.argv.slice(2);
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 0;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Pass --port with a portbroker allocation.');
const bundle = args.includes('--bundle') ? path.resolve(args[args.indexOf('--bundle') + 1]) : null;
const startedAt = new Date().toISOString();
const testGame = args.includes('--test-game');
const extra = testGame ? [path.join(__dirname, '..', 'test', 'support', 'racegame.js')] : [];
if (bundle) require('node:vm').runInThisContext(require('node:fs').readFileSync(path.join(bundle, 'Code.gs'), 'utf8'));
else loadServer(extra);

const deps = makeDeps({ realTime: true });
deps.sleep = () => {};                       // keep wrong-code answers fast locally
deps.appUrl = () => 'http://localhost:' + port + '/';
// Wordwright's word list: --words <file> (one word per line, e.g. the ENABLE list);
// without it every word is accepted locally.
const wordsAt = args.indexOf('--words');
let dict = null;
deps.services.dict = () => {
  if (dict) return dict;
  if (wordsAt >= 0) dict = new Set(require('node:fs').readFileSync(args[wordsAt + 1], 'utf8').toUpperCase().split(/\r?\n/).filter(Boolean));
  else { console.log('[dev] no --words file: accepting every word'); dict = { has: () => true }; }
  return dict;
};
deps.asset = (file) => {
  if (bundle) { const p = path.join(bundle, file + '.html'); return require('node:fs').existsSync(p) ? require('node:fs').readFileSync(p, 'utf8') : null; }
  const m = /^asset_([a-z0-9]+)_(.+)$/.exec(file);
  const f = m && path.join(__dirname, '..', 'assets', m[1], m[2].replace(/_/g, '-') + '.jpg');
  return f && require('node:fs').existsSync(f) ? 'data:image/jpeg;base64,' + require('node:fs').readFileSync(f).toString('base64') : null;
};
deps.mail = (to, subject) => console.log('[mail not sent] to ' + to + ': ' + subject);
GN.deps = deps;

// --state <file>: keep the simulated spreadsheet between restarts (local testing only)
const stateAt = args.indexOf('--state');
const stateFile = stateAt >= 0 ? args[stateAt + 1] : null;
const fs = require('node:fs');
if (stateFile && fs.existsSync(stateFile)) {
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  for (const [name, rows] of Object.entries(saved)) deps.store.tables[name] = new Map(rows);
  console.log('[dev] loaded ' + stateFile);
} else {
  GN.install.initialize({ groupName: 'Demo Group', code: 'maple owl', adminName: 'Ann', adminPin: '1234' });
}
const save = () => {
  if (!stateFile) return;
  const out = {};
  for (const [name, map] of Object.entries(deps.store.tables)) out[name] = [...map];
  fs.writeFileSync(stateFile, JSON.stringify(out));
};

const slow = Number(process.env.GN_DEV_DELAY_MS || 0);   // simulate Apps Script latency

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/whoami') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({service:'game-night-local-harness',version:'0.1.0',pid:process.pid,startedAt,host:'0.0.0.0',port}));
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/exec')) {
    const boot = JSON.stringify({ ready: true, platform: GN.NAMES.platform, link: GN.util.isId(url.searchParams.get('t') || '') ? url.searchParams.get('t') : '',
      debug: url.searchParams.get('debug') === '1' }).replace(/</g, '\\u003c');
    let html;
    try {
      html = bundle ? fs.readFileSync(path.join(bundle, 'Index.html'), 'utf8').replace('<?!= boot ?>', boot) : page(boot, { extraUi: testGame ? [path.join(__dirname, '..', 'test', 'support', 'raceui.js')] : [] });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end(String(e.stack));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  if (req.method === 'POST' && url.pathname === '/rpc') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
    req.on('end', () => {
      let out;
      const t0 = Date.now();
      try {
        const { method, args: a } = JSON.parse(body);
        GN.deps.store.refresh();
        out = GN.api.handle(method, a);
        if (method !== 'sync') save();
        console.log(method.padEnd(14), (Date.now() - t0) + 'ms', out && out.ok ? 'ok' : (out && out.code));
      } catch (e) {
        console.error(e);
        out = { ok: false, code: 'SERVER', error: 'Server error (see the dev server console).' };
      }
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      }, slow);
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(port, '0.0.0.0', () => console.log('Game Night dev server: http://localhost:' + port + '/  (code "maple owl", admin Ann / PIN 1234)'));
