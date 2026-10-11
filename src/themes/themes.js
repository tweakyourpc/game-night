/**
 * The installed themes, as the server knows them (ids and names only; looks live in
 * each theme's theme.json and are packed for the browser by tools/build.mjs).
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.THEMES = [
  { id: 'walnut', name: 'Walnut Parlor', version: '1.0.0' },
  { id: 'slate', name: 'Slate Study', version: '1.0.0' },
];
