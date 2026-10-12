// Assembles the two Apps Script files from src/: Code.js (every server file, in load
// order) and Index.html (the page with styles, themes, games and scripts inlined).
// Used by tools/build.mjs (release) and tools/dev_server.js (local testing). Node only;
// nothing here runs in an installation.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

/** Game ids with a browser module, in catalog order. */
function gameIds() {
  const dir = path.join(SRC, 'games');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((g) => fs.existsSync(path.join(dir, g, 'rules.js'))).sort();
}

/** Theme files in the order src/themes/themes.js lists them (the first is the default). */
function themes() {
  const dir = path.join(SRC, 'themes');
  const listed = [...read('themes/themes.js').matchAll(/id:\s*'([a-z0-9_-]+)'/g)].map((m) => m[1]);
  const out = {};
  for (const id of listed) {
    const f = path.join(dir, id, 'theme.json');
    if (fs.existsSync(f)) out[id] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return out;
}

function serverFiles() {
  const list = ['config/names.js', 'themes/themes.js'];
  for (const f of fs.readdirSync(path.join(SRC, 'platform')).sort()) if (f.endsWith('.js')) list.push('platform/' + f);
  for (const g of gameIds()) {
    list.push('games/' + g + '/rules.js');
    if (fs.existsSync(path.join(SRC, 'games', g, 'bot.js'))) list.push('games/' + g + '/bot.js');
  }
  list.push('appsscript/Server.js');
  return list;
}

function serverBundle() {
  return serverFiles().map((f) => '// ---- src/' + f + '\n' + read(f)).join('\n\n');
}

/** Script text that is safe inside an inline <script> element. */
const inlineSafe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

function gamesScript(extraUi) {
  const parts = [];
  for (const g of gameIds()) {
    const ui = path.join(SRC, 'games', g, 'ui.js');
    if (fs.existsSync(ui)) parts.push('// ---- src/games/' + g + '/ui.js\n' + fs.readFileSync(ui, 'utf8'));
    const meta = path.join(ROOT, 'assets', g, 'boards.json');
    if (fs.existsSync(meta)) {
      parts.push('GNC.games[' + JSON.stringify(g) + '] = GNC.games[' + JSON.stringify(g) + '] || {};\nGNC.games[' +
        JSON.stringify(g) + '].assetMeta = ' + fs.readFileSync(meta, 'utf8').trim() + ';');
    }
    const how = path.join(SRC, 'games', g, 'howto.html');
    if (fs.existsSync(how)) {
      parts.push('GNC.games[' + JSON.stringify(g) + '] = GNC.games[' + JSON.stringify(g) + '] || {};\nGNC.games[' +
        JSON.stringify(g) + '].howTo = ' + JSON.stringify(fs.readFileSync(how, 'utf8')) + ';');
    }
  }
  for (const f of extraUi || []) parts.push(fs.readFileSync(f, 'utf8'));
  return parts.join('\n\n');
}

/**
 * boot: a JSON string for the dev server, or null for Apps Script (a scriptlet that
 * doGet fills in). The page holds exactly one scriptlet; anything else that looks like
 * one is a build error, because Apps Script would try to run it.
 */
function page(boot, opts = {}) {
  let html = read('client/Index.html');
  const fill = {
    'client/app.css': read('client/app.css'),
    themes: 'window.GN_THEMES = ' + JSON.stringify(themes()) + ';',
    'client/core.js': read('client/core.js'),
    'client/replay.js': read('client/replay.js'),
    games: gamesScript(opts.extraUi),
    'client/shell.js': read('client/shell.js'),
  };
  html = html.replace(/\/\*@inline ([^*]+)\*\//g, (m, name) => {
    if (!(name in fill)) throw new Error('unknown inline ' + name);
    return name.endsWith('.css') ? fill[name] : inlineSafe(fill[name]);
  });
  if (html.includes('<?')) throw new Error('The page contains "<?", which Apps Script would treat as a scriptlet.');
  html = html.replace('/*@boot*/', boot === null ? '<?!= boot ?>' : boot);
  return html;
}

module.exports = { page, serverBundle, serverFiles, gameIds, themes, SRC, ROOT };
