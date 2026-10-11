/**
 * Dots and Boxes for 2 to 4 players. Players take turns drawing one line between two
 * neighbouring dots. Whoever completes a box (its fourth side) claims it and must draw
 * again; one line can complete two boxes at once. When every box is claimed, the most
 * boxes wins; equal top counts tie.
 *
 * A grid of R x C boxes has (R+1) x C horizontal lines h[r][c] and R x (C+1) vertical
 * lines v[r][c]. Each holds null or the id of whoever drew it; boxes[r][c] likewise.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.dots = (function () {
  var SIZES = { small: { rows: 3, cols: 3 }, medium: { rows: 4, cols: 4 }, large: { rows: 6, cols: 6 } };

  function grid(n, m) { var g = []; for (var i = 0; i < n; i++) { g.push([]); for (var j = 0; j < m; j++) g[i].push(null); } return g; }

  function setup(players, size) {
    var z = SIZES[size] || SIZES.medium;
    var scores = {};
    players.forEach(function (p) { scores[p] = 0; });
    return { players: players.slice(), rows: z.rows, cols: z.cols, size: SIZES[size] ? size : 'medium',
      h: grid(z.rows + 1, z.cols), v: grid(z.rows, z.cols + 1), boxes: grid(z.rows, z.cols),
      scores: scores, turn: 0, status: 'active', winners: [], moves: [], left: z.rows * z.cols };
  }

  /** {o: 'h'|'v', r, c} with integers inside the grid, or null. */
  function cleanEdge(s, e) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    if (e.o !== 'h' && e.o !== 'v') return null;
    if (!Number.isInteger(e.r) || !Number.isInteger(e.c)) return null;
    var maxR = e.o === 'h' ? s.rows : s.rows - 1, maxC = e.o === 'h' ? s.cols - 1 : s.cols;
    if (e.r < 0 || e.c < 0 || e.r > maxR || e.c > maxC) return null;
    return { o: e.o, r: e.r, c: e.c };
  }

  function boxDone(s, r, c) {
    return !!(s.h[r][c] && s.h[r + 1][c] && s.v[r][c] && s.v[r][c + 1]);
  }

  /** The (one or two) boxes a line borders. */
  function neighbours(s, e) {
    var out = [];
    if (e.o === 'h') {
      if (e.r > 0) out.push([e.r - 1, e.c]);
      if (e.r < s.rows) out.push([e.r, e.c]);
    } else {
      if (e.c > 0) out.push([e.r, e.c - 1]);
      if (e.c < s.cols) out.push([e.r, e.c]);
    }
    return out;
  }

  function draw(s, player, edge) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (s.players[s.turn] !== player) return { ok: false, error: "It's not your turn." };
    var e = cleanEdge(s, edge);
    if (!e) return { ok: false, error: 'Choose a line between two neighbouring dots.' };
    var lines = e.o === 'h' ? s.h : s.v;
    if (lines[e.r][e.c]) return { ok: false, error: 'That line is already drawn.' };
    lines[e.r][e.c] = player;
    var claimed = neighbours(s, e).filter(function (b) { return !s.boxes[b[0]][b[1]] && boxDone(s, b[0], b[1]); });
    claimed.forEach(function (b) { s.boxes[b[0]][b[1]] = player; });
    s.scores[player] += claimed.length;
    s.left -= claimed.length;
    s.moves.push({ player: player, edge: e, boxes: claimed });
    if (s.left === 0) {
      s.status = 'finished';
      var best = Math.max.apply(null, s.players.map(function (p) { return s.scores[p]; }));
      s.winners = s.players.filter(function (p) { return s.scores[p] === best; });
    } else if (!claimed.length) {
      s.turn = (s.turn + 1) % s.players.length;    // completing a box keeps the turn
    }
    return { ok: true, edge: e, boxes: claimed, again: claimed.length > 0 && s.status === 'active' };
  }

  return { SIZES: SIZES, setup: setup, draw: draw, cleanEdge: cleanEdge };
})();

GN.games.dots = (function () {
  var D = GN.dots;
  function label(size) { var z = D.SIZES[size]; return z.rows * z.cols + ' boxes (' + z.rows + ' × ' + z.cols + ')'; }
  return {
    id: 'dots', name: 'Dots and Boxes', version: '1.0.0', rulesVersion: 1, minutes: 15,
    description: 'Take turns joining dots. Close a box to claim it and draw again. Most boxes wins.',
    players: { min: 2, max: 4 },
    options: [
      { id: 'size', label: 'Grid', type: 'choice', default: 'medium',
        choices: [{ value: 'small', label: 'Small: ' + label('small') }, { value: 'medium', label: 'Medium: ' + label('medium') },
          { value: 'large', label: 'Large: ' + label('large') }] },
    ],
    anytime: [],

    setup: function (ctx) { return D.setup(ctx.players, ctx.options.size); },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action) {
      if (action.type !== 'line') return { ok: false, error: 'Unknown move.' };
      var r = D.draw(s, player, action.edge);
      if (!r.ok) return r;
      var events = [{ type: 'line', public: { player: player, edge: r.edge, boxes: r.boxes, again: r.again } }];
      var out = { ok: true, state: s, events: events, response: { boxes: r.boxes.length, again: r.again } };
      if (s.status === 'finished') {
        out.result = { status: 'finished', winners: s.winners.slice(), scores: GN.util.clone(s.scores), adjustments: [],
          reason: s.winners.length > 1 ? 'tied for the most boxes' : 'most boxes' };
        events.push({ type: 'end', public: { winners: out.result.winners, scores: s.scores, reason: out.result.reason } });
      }
      return out;
    },

    view: function (s) {
      return { players: s.players, rows: s.rows, cols: s.cols, size: s.size, h: s.h, v: s.v, boxes: s.boxes, scores: s.scores,
        turn: s.turn, current: s.status === 'active' ? s.players[s.turn] : null, status: s.status, winners: s.winners,
        left: s.left, last: s.moves[s.moves.length - 1] || null, moveCount: s.moves.length };
    },

    summary: function (s, players) {
      return players.map(function (p) { return p.name + ' ' + s.scores[p.id]; }).join(' · ') + (s.status === 'active' ? ' · ' + s.left + ' boxes left' : '');
    },
  };
})();
