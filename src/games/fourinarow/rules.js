/**
 * Four in a Row: two players drop discs into a 7-column, 6-row upright grid. A disc
 * falls to the lowest empty space. Four or more of your discs in a line (across, down
 * or diagonal) wins; a full grid with no line is a draw.
 *
 * Grid: rows[r][c], r = 0 is the TOP row, c = 0 the left column; null | player id.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.fourinarow = (function () {
  var COLS = 7, ROWS = 6, NEED = 4;

  function empty() {
    var g = [];
    for (var r = 0; r < ROWS; r++) { g.push([]); for (var c = 0; c < COLS; c++) g[r].push(null); }
    return g;
  }

  /** The row a disc dropped in column c lands in, or -1 if the column is full. */
  function landing(grid, c) {
    for (var r = ROWS - 1; r >= 0; r--) if (!grid[r][c]) return r;
    return -1;
  }

  /** The longest line through (r, c) for its owner, if it is at least NEED long. */
  function lineThrough(grid, r, c) {
    var who = grid[r][c];
    var best = null;
    [[0, 1], [1, 0], [1, 1], [1, -1]].forEach(function (d) {
      var cells = [[r, c]];
      [1, -1].forEach(function (s) {
        var rr = r + d[0] * s, cc = c + d[1] * s;
        while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && grid[rr][cc] === who) {
          if (s > 0) cells.push([rr, cc]); else cells.unshift([rr, cc]);
          rr += d[0] * s; cc += d[1] * s;
        }
      });
      if (cells.length >= NEED && (!best || cells.length > best.length)) best = cells;
    });
    return best;
  }

  function full(grid) { return grid[0].every(function (x) { return x; }); }

  function setup(players, first) {
    return { players: players.slice(), rows: empty(), turn: first || 0, status: 'active', winner: null, line: null,
      moves: [], first: first || 0 };
  }

  function drop(s, player, col) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (s.players[s.turn] !== player) return { ok: false, error: "It's not your turn." };
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return { ok: false, error: 'Choose one of the seven columns.' };
    var r = landing(s.rows, col);
    if (r < 0) return { ok: false, error: 'That column is full.' };
    s.rows[r][col] = player;
    s.moves.push({ player: player, col: col, row: r });
    var line = lineThrough(s.rows, r, col);
    if (line) {
      s.status = 'finished'; s.winner = player; s.line = line;
    } else if (full(s.rows)) {
      s.status = 'finished'; s.winner = null;
    } else {
      s.turn = 1 - s.turn;
    }
    return { ok: true, row: r, col: col, line: line };
  }

  return { COLS: COLS, ROWS: ROWS, empty: empty, landing: landing, lineThrough: lineThrough, setup: setup, drop: drop };
})();

GN.games.fourinarow = (function () {
  var F = GN.fourinarow;
  return {
    id: 'fourinarow', name: 'Four in a Row', version: '1.0.0', rulesVersion: 1, minutes: 10,
    description: 'Drop discs into the upright grid. Line up four of yours across, down or diagonally before your opponent does.',
    players: { min: 2, max: 2 },
    options: [
      { id: 'first', label: 'Who goes first', type: 'choice', default: 'seat',
        choices: [{ value: 'seat', label: 'The first seat (usually the host)' }, { value: 'random', label: 'Decided at random' }] },
    ],
    anytime: [],

    setup: function (ctx) {
      var first = ctx.options.first === 'random' ? Math.floor(ctx.rng() * 2) : 0;
      return F.setup(ctx.players, first);
    },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action) {
      if (action.type !== 'drop') return { ok: false, error: 'Unknown move.' };
      var r = F.drop(s, player, action.col);
      if (!r.ok) return r;
      var events = [{ type: 'drop', public: { player: player, col: r.col, row: r.row } }];
      var out = { ok: true, state: s, events: events, response: { row: r.row, col: r.col } };
      if (s.status === 'finished') {
        out.result = { status: 'finished', winners: s.winner ? [s.winner] : [], scores: null, adjustments: [],
          reason: s.winner ? 'four in a row' : 'the grid is full: a draw', line: s.line };
        events.push({ type: 'end', public: { winners: out.result.winners, line: s.line, reason: out.result.reason } });
      }
      return out;
    },

    view: function (s) {
      return { players: s.players, rows: s.rows, turn: s.turn, current: s.status === 'active' ? s.players[s.turn] : null,
        status: s.status, winner: s.winner, line: s.line, last: s.moves[s.moves.length - 1] || null, moveCount: s.moves.length };
    },

    summary: function (s, players) {
      var name = function (id) { return (players.filter(function (p) { return p.id === id; })[0] || {}).name || '?'; };
      if (s.status === 'finished') return s.winner ? name(s.winner) + ' won' : 'Draw';
      return s.moves.length + ' discs played · ' + name(s.players[s.turn]) + ' to move';
    },
  };
})();
