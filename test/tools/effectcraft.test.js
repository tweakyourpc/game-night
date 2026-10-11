// The EffectCraft converter (tools/effectcraft/render_replay.py): replay v1 in, game
// recipe + drawn tiles + script out, deterministically. Skipped when Python 3 with
// Pillow is not installed (it is a contributor tool, not part of an installation).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { world } = require('../support/world.js');

const TOOL = path.join(__dirname, '..', '..', 'tools', 'effectcraft', 'render_replay.py');
const havePillow = spawnSync('python3', ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;

function sampleReplay() {
  const w = world();
  w.deps.services.dict = () => ({ has: () => true });
  w.join('Bob');
  const { match } = w.play('wordwright', ['Ann', 'Bob']);
  const rec = w.deps.store.get('Matches', match.id);
  rec.state.racks[w.idOf('Ann')] = [...'FORT?XY'];
  rec.state.racks[w.idOf('Bob')] = [...'SEAQZEE'];
  w.deps.store.put('Matches', rec);
  const play = (who, placements) => {
    const m = w.call('match', w.tokens.Ann, match.id).match;
    const r = w.call('act', w.tokens[who], match.id, { type: 'play', placements }, w.req(m.rev));
    assert.equal(r.ok, true, r.error);
  };
  play('Ann', [{ r: 7, c: 6, l: 'F' }, { r: 7, c: 7, l: 'O' }, { r: 7, c: 8, l: 'R' }, { r: 7, c: 9, l: 'T' }]);
  play('Bob', [{ r: 7, c: 10, l: 'S' }]);
  play('Ann', [{ r: 8, c: 6, l: 'A', b: true }]);
  const m = w.call('match', w.tokens.Ann, match.id).match;
  w.call('act', w.tokens.Bob, match.id, { type: 'pass' }, w.req(m.rev));
  return w.call('replay', w.tokens.Ann, match.id).replay;
}

const hashDir = (dir) => {
  const h = crypto.createHash('sha256');
  const walk = (d) => fs.readdirSync(d).sort().forEach((f) => {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p); else { h.update(f); h.update(fs.readFileSync(p)); }
  });
  walk(dir);
  return h.digest('hex');
};

test('effectcraft: a replay becomes a game recipe, drawn tiles and a script, the same every time', { skip: !havePillow && 'Python 3 with Pillow is not installed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-ec-'));
  const file = path.join(tmp, 'replay.json');
  fs.writeFileSync(file, JSON.stringify(sampleReplay()));
  const run = (out, board) => spawnSync('python3', ['-I', TOOL, file, '--out', out, '--board', board], { encoding: 'utf8' });
  const a = run(path.join(tmp, 'a'), 'drawn');
  assert.equal(a.status, 0, a.stderr);
  const b = run(path.join(tmp, 'b'), 'drawn');
  assert.equal(b.status, 0, b.stderr);
  assert.equal(hashDir(path.join(tmp, 'a')), hashDir(path.join(tmp, 'b')), 'byte-identical outputs');
  const recipe = fs.readFileSync(path.join(tmp, 'a', 'recipe.yaml'), 'utf8');
  assert.match(recipe, /^mode: "game"$/m);
  assert.match(recipe, /^skin: "drawn"$/m);
  const tiles = fs.readdirSync(path.join(tmp, 'a', 'media', 'tiles'));
  assert.equal(tiles.length, 27);
  const jsx = fs.readdirSync(path.join(tmp, 'a')).find((f) => f.endsWith('.jsx'));
  const script = fs.readFileSync(path.join(tmp, 'a', jsx), 'utf8');
  assert.match(script, /F001/);
  assert.match(script, /blank A/);
  assert.match(script, /Bob plays FORTS/);
  // the recipe is real YAML with the earlier renderer's fields
  const parsed = spawnSync('python3', ['-I', '-c', 'import sys, yaml, json; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', path.join(tmp, 'a', 'recipe.yaml')], { encoding: 'utf8' });
  if (parsed.status === 0) {
    const r = JSON.parse(parsed.stdout);
    assert.deepEqual(r.players, ['Ann', 'Bob']);
    assert.deepEqual(r.moves.map((m) => m.type), ['play', 'play', 'play', 'pass']);
    assert.deepEqual(r.moves[2].tiles, [[8, 6, 'A', true]]);
    assert.deepEqual(r.moves[0].words, ['FORT']);
  }
  // other games are refused clearly
  const rp = JSON.parse(fs.readFileSync(file, 'utf8'));
  rp.game.id = 'checkers'; rp.game.name = 'Checkers';
  fs.writeFileSync(file, JSON.stringify(rp));
  const c = run(path.join(tmp, 'c'), 'drawn');
  assert.notEqual(c.status, 0);
  assert.match(c.stderr, /play in the browser/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
