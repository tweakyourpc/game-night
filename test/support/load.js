// Loads the server-side source files into this Node process's global scope, the way
// Apps Script loads every .gs file into one shared scope.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', '..', 'src');

/** The server files, in the order the build concatenates them. */
function serverFiles() {
  const list = ['config/names.js', 'themes/themes.js'];
  for (const f of fs.readdirSync(path.join(SRC, 'platform')).sort()) list.push('platform/' + f);
  for (const g of fs.readdirSync(path.join(SRC, 'games')).sort()) {
    const rules = path.join('games', g, 'rules.js');
    if (fs.existsSync(path.join(SRC, rules))) list.push(rules);
  }
  return list;
}

let loaded = false;
function loadServer(extra = []) {
  if (loaded) return globalThis.GN;
  for (const f of serverFiles().concat(extra)) {
    const file = path.isAbsolute(f) ? f : path.join(SRC, f);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  }
  loaded = true;
  return globalThis.GN;
}

module.exports = { loadServer, serverFiles, SRC };
