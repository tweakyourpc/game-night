/**
 * Small shared helpers. Plain JavaScript: runs in Apps Script (V8), Node tests and the
 * dev server, all sharing one global scope the way Apps Script loads files.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

/** An error meant for the player: message is shown, code is machine-readable. */
GN.ApiError = function (message, code, extra) {
  this.message = message;
  this.code = code || 'ERROR';
  this.extra = extra || null;
};

GN.fail = function (message, code, extra) {
  throw new GN.ApiError(message, code, extra);
};

GN.util = {
  clone: function (x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); },

  /** A short id/token-shaped string: letters, digits, _ and -. */
  isId: function (s, max) {
    return typeof s === 'string' && s.length > 0 && s.length <= (max || 64) && /^[A-Za-z0-9_-]+$/.test(s);
  },

  isText: function (s, max) { return typeof s === 'string' && s.length <= max; },

  cleanName: function (s) {
    return typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, 30) : '';
  },

  isEmail: function (s) {
    return typeof s === 'string' && s.length <= 254 && /^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/.test(s);
  },

  esc: function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },

  /** Fisher-Yates with an injectable random source (tests pass a fixed one). */
  shuffle: function (arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  },

  /** JSON size guard for anything a browser sends. */
  jsonSize: function (x) {
    try { return JSON.stringify(x === undefined ? null : x).length; } catch (e) { return Infinity; }
  },

  /** A request's {expectedRevision, actionId}; throws BAD_REQUEST when malformed. */
  checkReq: function (req) {
    if (!req || typeof req !== 'object' || Array.isArray(req)) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
    if (typeof req.actionId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(req.actionId)) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
    if (!Number.isInteger(req.expectedRevision) || req.expectedRevision < 0) GN.fail('Please reload the page and try again.', 'BAD_REQUEST');
    return req;
  },

  /** Remember an action's result on a record, keeping the last `keep` entries. */
  remember: function (list, entry, keep) {
    return (list || []).concat([entry]).slice(-(keep || 40));
  },

  findAction: function (list, actionId) {
    return (list || []).filter(function (a) { return a.id === actionId; })[0] || null;
  },
};
