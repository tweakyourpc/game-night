/**
 * Optional game artwork (for example Wordwright's board pictures), fetched by the page
 * only when a player chooses it. A game lists its assets in `assets: [names]`; nothing
 * else can be requested. Installations may leave the asset files out, in which case
 * data is null and the page draws its own board.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.assets = {
  /** The Apps Script file that holds an asset, e.g. asset_wordwright_board_maple. */
  fileName: function (gameId, name) { return 'asset_' + gameId + '_' + name.replace(/-/g, '_'); },

  get: function (token, gameId, name) {
    GN.identity.auth(token);
    var g = GN.util.isId(gameId) && GN.games[gameId];
    if (!g || !g.assets || g.assets.indexOf(name) < 0) GN.fail('No such picture.', 'NOT_FOUND');
    var data = null;
    try { data = GN.deps.asset ? GN.deps.asset(GN.assets.fileName(gameId, name)) : null; } catch (e) { data = null; }
    return { ok: true, game: gameId, name: name, data: data || null };
  },
};
