// Theme template v1: every theme has the same fields, matches the server's list, and
// keeps text and seat symbols readable (WCAG contrast).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('../support/load.js');
const { themes } = require('../../tools/assemble.js');

loadServer();
const all = themes();

function lum(hex) {
  const n = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the server list and the theme files agree', () => {
  assert.deepEqual(Object.keys(all), GN.THEMES.map((t) => t.id));
  for (const t of GN.THEMES) {
    assert.equal(all[t.id].name, t.name);
    assert.equal(all[t.id].version, t.version);
  }
});

for (const [id, t] of Object.entries(all)) {
  test('theme ' + id + ' follows template v1', () => {
    assert.equal(t.templateVersion, 1);
    assert.match(t.version, /^\d+\.\d+\.\d+$/);
    for (const k of ['table', 'tableText', 'tableMuted', 'surface', 'surfaceAlt', 'surfaceText', 'muted', 'line', 'accent', 'accentText',
      'focus', 'good', 'warn', 'bad', 'boardBase', 'boardLine', 'boardCell', 'boardDark', 'highlight']) assert.ok(t.colors[k], k);
    assert.ok(t.colors.players.length >= 4 && t.colors.playerText.length === t.colors.players.length);
    assert.ok(t.symbols.length >= 4 && new Set(t.symbols).size === t.symbols.length, 'distinct seat symbols');
    for (const k of ['display', 'body', 'ui', 'numbers']) assert.ok(t.typography[k], k);
    for (const k of ['table', 'surface', 'board', 'piece']) assert.ok(t.textures[k], k);
    for (const k of ['radius', 'small', 'width', 'frame', 'shadow']) assert.ok(t.borders[k], k);
    for (const k of ['buttonRadius', 'buttonShadow', 'buttonFace', 'buttonQuiet']) assert.ok(t.controls[k], k);
    assert.ok(['wood', 'chime'].includes(t.sounds.palette));
    assert.equal(typeof t.artwork, 'object');
    // raster images are not part of a theme template; textures are CSS
    assert.ok(!/url\(/.test(JSON.stringify(t)), 'no image URLs in a theme');
  });

  test('theme ' + id + ' keeps text readable', () => {
    const c = t.colors;
    assert.ok(contrast(c.surfaceText, c.surface) >= 7, 'body text');
    assert.ok(contrast(c.muted, c.surface) >= 4.5, 'muted text');
    assert.ok(contrast(c.tableText, c.table) >= 7, 'text on the table');
    assert.ok(contrast(c.accentText, c.accent) >= 4.5, 'buttons');
    c.players.forEach((p, i) => assert.ok(contrast(c.playerText[i], p) >= 3, 'seat ' + i + ' symbol ' + contrast(c.playerText[i], p).toFixed(2)));
  });
}
