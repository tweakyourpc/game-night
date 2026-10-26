var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.tictactoe = (function () {
  var LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  function winner(board) {
    for (var i = 0; i < LINES.length; i++) {
      var line = LINES[i];
      if (board[line[0]] && board[line[0]] === board[line[1]] && board[line[0]] === board[line[2]]) return line;
    }
    return null;
  }
  function setup(players, first) {
    return { players: players.slice(), board: [null,null,null,null,null,null,null,null,null], turn: first || 0,
      status: 'active', winner: null, line: null, moves: [] };
  }
  return { LINES: LINES, winner: winner, setup: setup };
})();

GN.games.tictactoe = {
  id: 'tictactoe', name: 'Tic-tac-toe', version: '1.0.0', rulesVersion: 1, minutes: 3,
  description: 'Place three marks in a row across, down or diagonally before your opponent.',
  players: { min: 2, max: 2 },
  options: [{ id: 'first', label: 'Who goes first', type: 'choice', default: 'seat',
    choices: [{ value: 'seat', label: 'The first seat (usually the host)' }, { value: 'random', label: 'Decided at random' }] }],
  setup: function (ctx) { return GN.tictactoe.setup(ctx.players, ctx.options.first === 'random' ? Math.floor(ctx.rng() * 2) : 0); },
  actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },
  apply: function (s, player, action) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (s.players[s.turn] !== player) return { ok: false, error: "It's not your turn." };
    if (!action || action.type !== 'mark' || !Number.isInteger(action.cell) || action.cell < 0 || action.cell > 8) return { ok: false, error: 'Choose one of the nine squares.' };
    if (s.board[action.cell]) return { ok: false, error: 'That square is already occupied.' };
    s.board[action.cell] = player;
    s.moves.push({ player: player, cell: action.cell });
    s.line = GN.tictactoe.winner(s.board);
    if (s.line) { s.status = 'finished'; s.winner = player; }
    else if (s.moves.length === 9) s.status = 'finished';
    else s.turn = 1 - s.turn;
    var events = [{ type: 'mark', public: { player: player, cell: action.cell } }];
    var out = { ok: true, state: s, events: events, response: { cell: action.cell } };
    if (s.status === 'finished') {
      out.result = { status: 'finished', winners: s.winner ? [s.winner] : [], scores: null, adjustments: [],
        reason: s.winner ? 'three in a row' : 'the board is full: a draw', line: s.line };
      events.push({ type: 'end', public: { winners: out.result.winners, line: s.line, reason: out.result.reason } });
    }
    return out;
  },
  view: function (s) { return { players: s.players, board: s.board, turn: s.turn, current: s.status === 'active' ? s.players[s.turn] : null,
    status: s.status, winner: s.winner, line: s.line, last: s.moves[s.moves.length - 1] || null, moveCount: s.moves.length }; },
  summary: function (s, players) {
    var name = function (id) { return (players.filter(function (p) { return p.id === id; })[0] || {}).name || '?'; };
    if (s.status === 'finished') return s.winner ? name(s.winner) + ' won' : 'Draw';
    return s.moves.length + ' moves played · ' + name(s.players[s.turn]) + ' to move';
  },
};
