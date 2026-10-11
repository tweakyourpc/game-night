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
  var TTL = 60, PRESENCE_MS = 75000;   // longer than the slowest (hidden-page) poll

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
      safe(function () {
        cache().put('seen:' + scope + ':' + memberId, { at: now }, 180);
        // anyone polling anywhere counts as "here" in the lobby
        if (scope !== 'lobby') cache().put('seen:lobby:' + memberId, { at: now }, 180);
      });
      var others = (ids || []).filter(function (id) { return id !== memberId; });
      var keys = others.map(function (id) { return 'seen:' + scope + ':' + id; });
      var got = safe(function () {
        if (cache().getAll) return cache().getAll(keys);
        var o = {};
        keys.forEach(function (k) { o[k] = cache().get(k); });
        return o;
      }) || {};
      return (ids || []).filter(function (id) {
        if (id === memberId) return true;
        var s = got['seen:' + scope + ':' + id];
        return !!(s && now - s.at < PRESENCE_MS);
      });
    },
  };
})();
