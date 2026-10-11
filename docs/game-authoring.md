# Game modules

Use an existing `src/games/<id>` module as the contract. This release has five games; adding games is outside the release work.

`rules.js` registers `GN.games[id]` with `id`, `name`, `version`, `rulesVersion`, `players: {min,max}`, declarative `options`, `setup(ctx)`, `actors(state)`, `apply(state, playerId, action, ctx)`, `view(state, viewerId)` and `summary(state, players)`. Optional `query`, `assets`, and `anytime` are used by the current modules. `ctx` supplies player IDs, validated options, RNG and dictionary services. Return `{ok:false,error}` or `{ok:true,state,events,response?,result?}`; a result finishes the match. Result uses `winners`, optional `scores`, `adjustments` and `reason`. Rules must validate every move server-side and never call Google services directly.

`view(state, null)` is a public spectator snapshot written into replay events; never expose hidden hands, bags or future randomness. `actors` may retain the current player for extra turns, or list multiple players. Do not assume every game has scores.

`ui.js` registers `GNC.games[id]`. The actual browser contract is `mount(host, api)` returning `{update(match, context), destroy()}`; optional `preview(element)` draws the catalogue picture. The API provides `act`, `query`, `players`, `me`, `theme`, sound and accessible announcements. `update` receives the full public match including `view`, with reason initial/poll/mine/stale/replay; preserve unfinished input where compatible. The generic replay player mounts this same UI using spectator snapshots. It does not call the planned but unimplemented `replay.draw` interface.

Add `howto.html`, use configured public names in `src/config/names.js`, and declare supported options. The assembler includes modules automatically. Cover illegal/legal moves, hidden views, stale and duplicate actions, convergence, reconnect, end results and replay snapshots. Run `npm test`, build, then check the packaged browser at desktop and phone widths in both themes.
