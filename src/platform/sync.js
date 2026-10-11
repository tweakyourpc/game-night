/**
 * Cache hints for cheap polling, and presence.
 *
 * The spreadsheet is the only source of truth. The cache only holds "latest revision"
 * hints, short-lived (60 s), so it can be lost at any time:
 *  - before a commit the hint is removed, so a hint can never be newer-looking than
 *    the sheet;
 *  - after the commit it's republished. If republishing fails, the next poll misses
 *    the cache and reads the sheet.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.sync = (function () {
  var TTL = 60, PRESENCE_MS = 25000;

  function cache() { return GN.deps.cache; }
  function safe(fn) { try { return fn(); } catch (e) { GN.deps.log('cache: ' + (e && e.message)); return null; } }

  return {
    PRESENCE_MS: PRESENCE_MS,
    /** Before committing a change to scope (e.g. 'm:abc', 't:xyz', 'lobby'). */
    invalidate: function (key) { safe(function () { cache().remove(key); }); },
    publish: function (key, value) { safe(function () { cache().put(key, value, TTL); }); },
    hint: function (key) { return safe(function () { return cache().get(key); }); },
    /** The lobby changed: a new random version makes every lobby poll refetch. */
    touch: function (what) {
      if (what === 'lobby') safe(function () { cache().put('lobby:v', { v: GN.deps.newId(8) }, 6 * 3600); });
    },
    lobbyVersion: function () {
      var h = safe(function () { return cache().get('lobby:v'); });
      if (h && h.v) return h.v;
      var v = GN.deps.newId(8);
      safe(function () { cache().put('lobby:v', { v: v }, 6 * 3600); });
      return v;
    },
    /** Presence: record that member was here, return who has been seen recently. */
    here: function (scope, memberId, ids) {
      var now = GN.deps.now();
      safe(function () { cache().put('seen:' + scope + ':' + memberId, { at: now }, 120); });
      var out = [];
      (ids || []).forEach(function (id) {
        var s = id === memberId ? { at: now } : safe(function () { return cache().get('seen:' + scope + ':' + id); });
        if (s && now - s.at < PRESENCE_MS) out.push(id);
      });
      return out;
    },
  };
})();
