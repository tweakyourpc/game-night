// Saving replays and recorded videos to the installation's Drive folder.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { world } = require('../support/world.js');

function finished() {
  const w = world();
  w.join('Bob');
  const { match } = w.play('race', ['Ann', 'Bob']);
  for (;;) {
    const m = w.call('match', w.tokens.Ann, match.id).match;
    if (m.status !== 'active') break;
    w.act(w.actor(match.id), match.id, { type: 'step', n: 1 });
  }
  return { w, match };
}

test('admins save a replay file to Drive; members cannot', () => {
  const { w, match } = finished();
  const r = w.call('saveReplay', w.tokens.Ann, match.id);
  assert.equal(r.ok, true, r.error);
  assert.match(r.name, /\.json$/);
  const f = [...w.deps.files.values()].find((x) => x.name === r.name);
  assert.equal(f.folder, 'replays');
  assert.equal(JSON.parse(f.text).format, 'game-night-replay');
  assert.equal(w.call('saveReplay', w.tokens.Bob, match.id).code, 'FORBIDDEN');
});

test('a video uploads in pieces, a retried piece replaces itself, and the pieces are removed', () => {
  const { w } = finished();
  const bytes = Buffer.from('0123456789'.repeat(300));
  const parts = [bytes.subarray(0, 1000), bytes.subarray(1000, 2000), bytes.subarray(2000)].map((b) => b.toString('base64'));
  parts.forEach((p, i) => assert.equal(w.call('uploadChunk', w.tokens.Ann, 'up123456', i, p).ok, true));
  assert.equal(w.call('uploadChunk', w.tokens.Ann, 'up123456', 1, parts[1]).ok, true, 'retry');
  const r = w.call('uploadFinish', w.tokens.Ann, 'up123456', 3, 'video/webm;codecs=vp9', 'Four in a Row: Ann & Bob');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.name, 'Four in a Row Ann Bob.webm');
  const saved = [...w.deps.files.values()].filter((x) => x.folder === 'replays');
  assert.equal(saved.length, 1);
  assert.deepEqual(Buffer.from(saved[0].base64, 'base64'), bytes);
  assert.equal([...w.deps.files.values()].filter((x) => x.folder === 'uploads').length, 0, 'pieces removed');
});

test('uploads are checked: missing pieces, sizes, types and members', () => {
  const { w } = finished();
  const piece = Buffer.from('abc').toString('base64');
  assert.equal(w.call('uploadChunk', w.tokens.Ann, 'upABCDEF', 0, piece).ok, true);
  assert.equal(w.call('uploadFinish', w.tokens.Ann, 'upABCDEF', 2, 'video/webm', 'x').code, 'MISSING');
  assert.equal([...w.deps.files.values()].filter(x => x.folder === 'uploads').length, 0, 'missing part failure cleans its owned pieces');
  assert.equal(w.call('uploadFinish', w.tokens.Ann, 'upABCDEF', 1, 'text/html', 'x').code, 'BAD_REQUEST');
  assert.equal(w.call('uploadChunk', w.tokens.Ann, 'upABCDEF', 99, piece).code, 'BAD_REQUEST');
  assert.equal(w.call('uploadChunk', w.tokens.Ann, 'upABCDEF', 1, '<script>').code, 'BAD_REQUEST');
  assert.equal(w.call('uploadChunk', w.tokens.Ann, '../etc', 1, piece).code, 'BAD_REQUEST');
  assert.equal(w.call('uploadChunk', w.tokens.Bob, 'upABCDEF', 1, piece).code, 'FORBIDDEN');
  assert.equal(w.call('uploadChunk', w.tokens.Ann, 'upABCDEF', 1, 'A'.repeat(2600001)).code, 'BAD_REQUEST');
});

test('cache is never used for video pieces', () => {
  const { w } = finished();
  const before = w.deps.cacheMap.size;
  w.call('uploadChunk', w.tokens.Ann, 'upCACHE1', 0, Buffer.from('x'.repeat(5000)).toString('base64'));
  const big = [...w.deps.cacheMap.values()].filter((v) => String(v).length > 4000);
  assert.equal(big.length, 0);
  assert.ok(w.deps.cacheMap.size <= before + 2, 'at most presence/maintenance hints were written');
});

test('uploads are isolated by device, finish is idempotent, cancellation and expiry clean pieces', () => {
  const { w } = finished();
  const token = w.tokens.Ann, data = Buffer.from('video').toString('base64');
  const other = w.call('join', 'maple owl', { memberId: w.idOf('Ann'), pin: '1234' }).token;
  assert.ok(other);
  assert.equal(w.call('uploadChunk', token, 'scope123', 0, data).ok, true);
  assert.equal(w.call('uploadFinish', other, 'scope123', 1, 'video/webm', 'test').code, 'MISSING');
  const r = w.call('uploadFinish', token, 'scope123', 1, 'video/webm', 'test');
  assert.equal(r.ok, true);
  assert.deepEqual(w.call('uploadFinish', token, 'scope123', 1, 'video/webm', 'test'), r);
  assert.equal([...w.deps.files.values()].filter(x => x.folder === 'replays').length, 1);
  w.call('uploadChunk', token, 'cancel123', 0, data);
  assert.equal(w.call('uploadCancel', other, 'cancel123').ok, true);
  assert.equal([...w.deps.files.values()].filter(x => x.folder === 'uploads').length, 1);
  assert.equal(w.call('uploadCancel', token, 'cancel123').ok, true);
  w.call('uploadChunk', token, 'expire123', 0, data);
  w.deps.tick(86400001); GN.files.cleanup();
  assert.equal([...w.deps.files.values()].filter(x => x.folder === 'uploads').length, 0);
});

test('Drive write failure cleans earlier pieces without affecting replay export', () => {
  const { w, match } = finished(), data = Buffer.from('video').toString('base64');
  w.call('uploadChunk', w.tokens.Ann, 'failure123', 0, data);
  w.deps.failNext('drive.saveBytes');
  assert.throws(() => w.call('uploadChunk', w.tokens.Ann, 'failure123', 1, data), /injected drive failure/);
  assert.equal([...w.deps.files.values()].filter(x => x.folder === 'uploads').length, 0);
  assert.equal(w.call('replay', w.tokens.Ann, match.id).ok, true);
});
