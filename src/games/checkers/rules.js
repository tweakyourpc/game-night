/**
 * Checkers: American / English draughts for two players.
 *
 *  - 8 x 8 board; play on the dark squares ((row + col) odd). 12 pieces each.
 *  - Dark (first seat unless the table chooses at random) starts on rows 5-7 and moves
 *    first, "up" the board (towards row 0). Light starts on rows 0-2 and moves down.
 *  - Men move one square diagonally forward; they capture forward by jumping an
 *    adjacent opposing piece onto the empty square beyond. Kings move and capture one
 *    square diagonally in any direction (no long-range "flying" kings).
 *  - Capturing is compulsory. If several captures are possible, the player may choose
 *    ANY of them; there is no rule to take the most pieces.
 *  - After a capture, if the same piece can capture again it must continue, with that
 *    piece only. Each jump is one action, so the turn stays with the player until the
 *    sequence ends.
 *  - A man reaching the far row is crowned king, and crowning ends the turn, even in
 *    the middle of a capture sequence.
 *  - A player with no pieces, or no legal move on their turn, loses.
 *  - Either player may resign at any time. A draw may be offered; it happens only if
 *    the opponent accepts. An offer lapses when the opponent moves instead.
 *  - PLATFORM RULE (not part of the traditional rules): the game is drawn when the same
 *    position, with the same player to move, occurs for the third time.
 *
 * Board: rows[r][c] = null | {o: 0|1, k: bool} where o is the seat (0 dark, 1 light).
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.checkers = (function () {
  var N = 8;

  function initial() {
    var b = [];
    for (var r = 0; r < N; r++) {
      b.push([]);
      for (var c = 0; c < N; c++) {
        var dark = (r + c) % 2 === 1;
        b[r].push(dark && r <= 2 ? { o: 1, k: false } : dark && r >= 5 ? { o: 0, k: false } : null);
      }
    }
    return b;
  }

  function inside(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
  function forward(o) { return o === 0 ? -1 : 1; }
  function farRow(o) { return o === 0 ? 0 : N - 1; }
  function dirs(p) { return p.k ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[forward(p.o), -1], [forward(p.o), 1]]; }

  function jumpsFrom(b, r, c) {
    var p = b[r][c], out = [];
    if (!p) return out;
    dirs(p).forEach(function (d) {
      var mr = r + d[0], mc = c + d[1], lr = r + 2 * d[0], lc = c + 2 * d[1];
      if (inside(lr, lc) && b[mr][mc] && b[mr][mc].o !== p.o && !b[lr][lc]) out.push({ from: [r, c], to: [lr, lc], capture: [mr, mc] });
    });
    return out;
  }

  function stepsFrom(b, r, c) {
    var p = b[r][c], out = [];
    if (!p) return out;
    dirs(p).forEach(function (d) {
      var tr = r + d[0], tc = c + d[1];
      if (inside(tr, tc) && !b[tr][tc]) out.push({ from: [r, c], to: [tr, tc], capture: null });
    });
    return out;
  }

  /** Every legal move for seat o: jumps only if any exist (captures are compulsory). */
  function legal(s, o) {
    if (s.continuing) return jumpsFrom(s.rows, s.continuing[0], s.continuing[1]);
    var jumps = [], steps = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var p = s.rows[r][c];
      if (!p || p.o !== o) continue;
      jumps = jumps.concat(jumpsFrom(s.rows, r, c));
      steps = steps.concat(stepsFrom(s.rows, r, c));
    }
    return jumps.length ? jumps : steps;
  }

  function count(b, o) {
    var n = 0;
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (b[r][c] && b[r][c].o === o) n++;
    return n;
  }

  /** Compact position key: the 32 playable squares plus the seat to move. */
  function key(s) {
    var k = '';
    for (var r = 0; r < N; r++) for (var c = (r + 1) % 2; c < N; c += 2) {
      var p = s.rows[r][c];
      k += !p ? '.' : p.o === 0 ? (p.k ? 'D' : 'd') : (p.k ? 'L' : 'l');
    }
    return k + s.turn;
  }

  function setup(players, darkSeat) {
    var order = darkSeat === 1 ? [players[1], players[0]] : players.slice();
    var s = { players: order, rows: initial(), turn: 0, continuing: null, status: 'active', winner: null, reason: null,
      drawOffer: null, seen: {}, moves: [], plies: 0 };
    s.seen[key(s)] = 1;
    return s;
  }

  function seatOf(s, player) { return s.players.indexOf(player); }

  function end(s, winnerSeat, reason) {
    s.status = 'finished';
    s.winner = winnerSeat === null ? null : s.players[winnerSeat];
    s.reason = reason;
    s.continuing = null;
    s.drawOffer = null;
  }

  function cleanSquare(x) {
    return Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && inside(x[0], x[1]) ? [x[0], x[1]] : null;
  }

  function move(s, player, from, to) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    var o = seatOf(s, player);
    if (o !== s.turn) return { ok: false, error: "It's not your turn." };
    var f = cleanSquare(from), t = cleanSquare(to);
    if (!f || !t) return { ok: false, error: 'Choose a piece and a square on the board.' };
    var p = s.rows[f[0]][f[1]];
    if (!p || p.o !== o) return { ok: false, error: 'Choose one of your own pieces.' };
    var options = legal(s, o);
    var mv = options.filter(function (m) { return m.from[0] === f[0] && m.from[1] === f[1] && m.to[0] === t[0] && m.to[1] === t[1]; })[0];
    if (!mv) {
      if (s.continuing) return { ok: false, error: 'Keep jumping with the same piece.' };
      if (options.length && options[0].capture) return { ok: false, error: 'You must capture: a jump is available.' };
      return { ok: false, error: 'That piece cannot move there.' };
    }
    s.rows[t[0]][t[1]] = p;
    s.rows[f[0]][f[1]] = null;
    var captured = null;
    if (mv.capture) {
      var cp = s.rows[mv.capture[0]][mv.capture[1]];
      captured = { at: mv.capture, king: cp.k };
      s.rows[mv.capture[0]][mv.capture[1]] = null;
    }
    var crowned = !p.k && t[0] === farRow(o);
    if (crowned) p.k = true;
    s.plies++;
    var more = !!mv.capture && !crowned && jumpsFrom(s.rows, t[0], t[1]).length > 0;
    var rec = { player: player, from: f, to: t, captured: captured, crowned: crowned, continues: more };
    s.moves.push(rec);
    if (more) { s.continuing = t; return { ok: true, move: rec }; }

    // the turn ends
    s.continuing = null;
    if (s.drawOffer && s.drawOffer !== player) s.drawOffer = null;   // moving instead of answering declines
    s.turn = 1 - s.turn;
    var other = s.turn;
    if (!count(s.rows, other)) { end(s, o, 'no pieces left'); return { ok: true, move: rec }; }
    if (!legal(s, other).length) { end(s, o, 'no legal moves'); return { ok: true, move: rec }; }
    // positions cannot repeat across a capture or a man's move, so history restarts there
    if (captured || !p.k || crowned) s.seen = {};
    var k = key(s);
    s.seen[k] = (s.seen[k] || 0) + 1;
    if (s.seen[k] >= 3) end(s, null, 'the same position occurred three times (platform rule)');
    return { ok: true, move: rec };
  }

  function resign(s, player) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    var o = seatOf(s, player);
    if (o < 0) return { ok: false, error: 'You are not playing in this game.' };
    end(s, 1 - o, 'resignation');
    return { ok: true };
  }

  function offerDraw(s, player) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (seatOf(s, player) < 0) return { ok: false, error: 'You are not playing in this game.' };
    if (s.drawOffer === player) return { ok: false, error: 'You have already offered a draw.' };
    if (s.drawOffer) return { ok: false, error: 'Your opponent has offered a draw: accept or decline it.' };
    s.drawOffer = player;
    return { ok: true };
  }

  function answerDraw(s, player, accept) {
    if (s.status !== 'active') return { ok: false, error: 'This game is over.' };
    if (seatOf(s, player) < 0) return { ok: false, error: 'You are not playing in this game.' };
    if (!s.drawOffer || s.drawOffer === player) return { ok: false, error: 'There is no draw offer to answer.' };
    if (accept) end(s, null, 'draw agreed');
    else s.drawOffer = null;
    return { ok: true };
  }

  function withdrawDraw(s, player) {
    if (s.status !== 'active' || s.drawOffer !== player) return { ok: false, error: 'You have no draw offer to withdraw.' };
    s.drawOffer = null;
    return { ok: true };
  }

  return { N: N, initial: initial, setup: setup, legal: legal, move: move, resign: resign, offerDraw: offerDraw,
    answerDraw: answerDraw, withdrawDraw: withdrawDraw, key: key, count: count, jumpsFrom: jumpsFrom };
})();

GN.games.checkers = (function () {
  var K = GN.checkers;

  function result(s) {
    return { status: 'finished', winners: s.winner ? [s.winner] : [], scores: null, adjustments: [], reason: s.reason };
  }

  return {
    id: 'checkers', name: 'Checkers', version: '1.0.0', rulesVersion: 1, minutes: 30,
    description: 'American draughts on an 8 × 8 board. Jump to capture, captures are compulsory, and reach the far side to crown a king.',
    players: { min: 2, max: 2 },
    options: [
      { id: 'dark', label: 'Who plays Dark (moves first)', type: 'choice', default: 'seat',
        choices: [{ value: 'seat', label: 'The first seat (usually the host)' }, { value: 'random', label: 'Decided at random' }] },
    ],
    anytime: ['resign', 'offer-draw', 'accept-draw', 'decline-draw', 'withdraw-draw'],

    setup: function (ctx) {
      return K.setup(ctx.players, ctx.options.dark === 'random' ? Math.floor(ctx.rng() * 2) : 0);
    },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action) {
      var r, events;
      switch (action.type) {
        case 'move':
          r = K.move(s, player, action.from, action.to);
          if (!r.ok) return r;
          events = [{ type: 'move', public: r.move }];
          break;
        case 'resign': r = K.resign(s, player); if (!r.ok) return r; events = [{ type: 'resign', public: { player: player } }]; break;
        case 'offer-draw': r = K.offerDraw(s, player); if (!r.ok) return r; events = [{ type: 'offer-draw', public: { player: player } }]; break;
        case 'accept-draw': r = K.answerDraw(s, player, true); if (!r.ok) return r; events = [{ type: 'accept-draw', public: { player: player } }]; break;
        case 'decline-draw': r = K.answerDraw(s, player, false); if (!r.ok) return r; events = [{ type: 'decline-draw', public: { player: player } }]; break;
        case 'withdraw-draw': r = K.withdrawDraw(s, player); if (!r.ok) return r; events = [{ type: 'withdraw-draw', public: { player: player } }]; break;
        default: return { ok: false, error: 'Unknown move.' };
      }
      var out = { ok: true, state: s, events: events, response: { continues: !!s.continuing } };
      if (s.status === 'finished') {
        out.result = result(s);
        events.push({ type: 'end', public: { winners: out.result.winners, reason: s.reason } });
      }
      return out;
    },

    view: function (s) {
      var legal = s.status === 'active' ? K.legal(s, s.turn) : [];
      return { players: s.players, rows: s.rows, turn: s.turn, current: s.status === 'active' ? s.players[s.turn] : null,
        continuing: s.continuing, mustCapture: legal.length > 0 && !!legal[0].capture, legal: legal, drawOffer: s.drawOffer,
        status: s.status, winner: s.winner, reason: s.reason, last: s.moves[s.moves.length - 1] || null,
        pieces: [K.count(s.rows, 0), K.count(s.rows, 1)], plies: s.plies };
    },

    summary: function (s, players) {
      var name = function (id) { return (players.filter(function (p) { return p.id === id; })[0] || {}).name || '?'; };
      if (s.status === 'finished') return s.winner ? name(s.winner) + ' won (' + s.reason + ')' : 'Draw (' + s.reason + ')';
      return name(s.players[0]) + ' ' + K.count(s.rows, 0) + ' · ' + name(s.players[1]) + ' ' + K.count(s.rows, 1) + ' pieces';
    },
  };
})();
