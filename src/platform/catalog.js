/**
 * The game and theme registry. Games register themselves (GN.games[id] = {...}) from
 * their own rules file; this module validates them and describes them to the lobby.
 * See docs/game-authoring.md for the interface.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.catalog = (function () {
  var REQUIRED = ['id', 'version', 'rulesVersion', 'players', 'setup', 'actors', 'apply', 'view', 'summary'];

  function game(id) {
    var g = typeof id === 'string' && GN.games.hasOwnProperty(id) ? GN.games[id] : null;
    if (!g) GN.fail('That game is not available here.', 'NO_GAME');
    return g;
  }

  function check(g) {
    REQUIRED.forEach(function (k) {
      if (g[k] === undefined) throw new Error('game ' + (g.id || '?') + ' is missing ' + k);
    });
    return g;
  }

  /** Validate table options against the game's declared options; fills defaults. */
  function options(g, given) {
    var out = {};
    var src = given && typeof given === 'object' && !Array.isArray(given) ? given : {};
    (g.options || []).forEach(function (o) {
      var v = src.hasOwnProperty(o.id) ? src[o.id] : o.default;
      if (o.type === 'choice') {
        var allowed = o.choices.map(function (c) { return c.value; });
        if (allowed.indexOf(v) < 0) GN.fail('Pick one of the offered choices for ' + o.label + '.', 'BAD_OPTION');
      } else if (o.type === 'boolean') {
        if (typeof v !== 'boolean') GN.fail(o.label + ' must be on or off.', 'BAD_OPTION');
      } else if (o.type === 'text') {
        if (typeof v !== 'string' || v.length > (o.max || 40)) GN.fail(o.label + ' is too long.', 'BAD_OPTION');
      }
      out[o.id] = v;
    });
    return out;
  }

  function describe() {
    return Object.keys(GN.games).sort().map(function (id) {
      var g = check(GN.games[id]);
      return {
        id: g.id, name: GN.NAMES.games[g.id] || g.name || g.id, description: g.description || '',
        players: g.players, options: g.options || [], version: g.version, rulesVersion: g.rulesVersion,
        minutes: g.minutes || null,
      };
    });
  }

  function themes() {
    return GN.THEMES ? GN.THEMES.map(function (t) { return { id: t.id, name: t.name, version: t.version }; }) : [];
  }

  function theme(id) {
    var ok = (GN.THEMES || []).some(function (t) { return t.id === id; });
    return ok ? id : ((GN.THEMES || [])[0] || { id: 'walnut' }).id;
  }

  return { game: game, check: check, options: options, describe: describe, themes: themes, theme: theme };
})();
