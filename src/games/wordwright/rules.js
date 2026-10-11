/**
 * Wordwright: a crossword tile game for 2 to 4 players (ported from the Crabbles rules).
 * Pure rules, no Apps Script calls; GN.games.wordwright adapts them to the platform's
 * game interface (docs/game-authoring.md).
 *
 * Board: 15x15 of null | {l: "A".."Z", b: true for a blank}.
 * Racks hold "A".."Z" and "?" (a blank). A placement is {r, c, l, b}.
 */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.games = GN.games || {};

GN.wordwright = (function () {
  var SIZE = 15, CENTER = 7, RACK_SIZE = 7, BINGO = 50;

  var DISTRIBUTION = {
    A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
    N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, '?': 2,
  };
  var VALUES = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
    N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, '?': 0,
  };

  // One quadrant (rows/cols 0..7), mirrored to all four.
  var PREMIUM_QUADRANT = {
    TW: [[0, 0], [0, 7], [7, 0]],
    DW: [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]],
    TL: [[1, 5], [5, 1], [5, 5]],
    DL: [[0, 3], [3, 0], [2, 6], [6, 2], [3, 7], [7, 3], [6, 6]],
  };

  var PREMIUM = (function () {
    var grid = [];
    for (var r = 0; r < SIZE; r++) { grid.push([]); for (var c = 0; c < SIZE; c++) grid[r].push(''); }
    Object.keys(PREMIUM_QUADRANT).forEach(function (kind) {
      PREMIUM_QUADRANT[kind].forEach(function (rc) {
        var r = rc[0], c = rc[1];
        [[r, c], [r, SIZE - 1 - c], [SIZE - 1 - r, c], [SIZE - 1 - r, SIZE - 1 - c]].forEach(function (p) { grid[p[0]][p[1]] = kind; });
      });
    });
    return grid;
  })();

  function emptyBoard() {
    var b = [];
    for (var r = 0; r < SIZE; r++) { b.push([]); for (var c = 0; c < SIZE; c++) b[r].push(null); }
    return b;
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function newBag(rng) {
    var bag = [];
    Object.keys(DISTRIBUTION).forEach(function (l) { for (var i = 0; i < DISTRIBUTION[l]; i++) bag.push(l); });
    return shuffle(bag, rng);
  }

  function draw(bag, rack) { while (rack.length < RACK_SIZE && bag.length) rack.push(bag.pop()); return rack; }
  function rackValue(rack) { return rack.reduce(function (s, l) { return s + VALUES[l]; }, 0); }
  function inBounds(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
  function boardIsEmpty(board) {
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (board[r][c]) return false;
    return true;
  }

  function takeFromRack(rack, placements) {
    var left = rack.slice();
    for (var i = 0; i < placements.length; i++) {
      var k = left.indexOf(placements[i].b ? '?' : placements[i].l);
      if (k < 0) return null;
      left.splice(k, 1);
    }
    return left;
  }

  function fail(msg, extra) {
    var o = { ok: false, error: msg };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }

  /** Placements come from a browser: check their shape before anything reads them. */
  function cleanPlacements(placements) {
    if (!Array.isArray(placements) || !placements.length) return { error: 'Place at least one tile.' };
    if (placements.length > RACK_SIZE) return { error: 'You can place at most 7 tiles.' };
    var out = [];
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      if (!p || typeof p !== 'object' || Array.isArray(p)) return { error: 'A tile placement is malformed.' };
      if (!Number.isInteger(p.r) || !Number.isInteger(p.c) || !inBounds(p.r, p.c)) return { error: 'A tile is off the board.' };
      if (typeof p.l !== 'string' || !/^[A-Z]$/.test(p.l)) return { error: 'Every tile needs a letter (choose one for blanks).' };
      if (p.b !== undefined && p.b !== null && typeof p.b !== 'boolean') return { error: 'A tile placement is malformed.' };
      out.push({ r: p.r, c: p.c, l: p.l, b: p.b === true });
    }
    return { placements: out };
  }

  function cleanLetters(letters) {
    if (!Array.isArray(letters) || !letters.length) return { error: 'Choose tiles to exchange.' };
    if (letters.length > RACK_SIZE) return { error: 'You can exchange at most 7 tiles.' };
    for (var i = 0; i < letters.length; i++) {
      if (typeof letters[i] !== 'string' || !/^[A-Z?]$/.test(letters[i])) return { error: 'Those tiles are not on your rack.' };
    }
    return { letters: letters.slice() };
  }

  function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  function hasNeighbourAlong(board, p, dr, dc) {
    var a = [p.r - dr, p.c - dc], b = [p.r + dr, p.c + dc];
    return (inBounds(a[0], a[1]) && !!board[a[0]][a[1]]) || (inBounds(b[0], b[1]) && !!board[b[0]][b[1]]);
  }

  function wordThrough(board, r, c, dr, dc) {
    while (inBounds(r - dr, c - dc) && board[r - dr][c - dc]) { r -= dr; c -= dc; }
    var cells = [], word = '';
    while (inBounds(r, c) && board[r][c]) {
      cells.push({ r: r, c: c, t: board[r][c] });
      word += board[r][c].l;
      r += dr; c += dc;
    }
    return { word: word, cells: cells };
  }

  /** Premium squares count only under tiles placed this turn. */
  function scoreWord(cells) {
    var sum = 0, mult = 1;
    cells.forEach(function (cell) {
      var v = cell.t.b ? 0 : VALUES[cell.t.l];
      if (cell.t.fresh) {
        var pr = PREMIUM[cell.r][cell.c];
        if (pr === 'DL') v *= 2;
        else if (pr === 'TL') v *= 3;
        else if (pr === 'DW') mult *= 2;
        else if (pr === 'TW') mult *= 3;
      }
      sum += v;
    });
    return sum * mult;
  }

  /**
   * Check and score a move. dict has has(word), or is null to skip the dictionary.
   * {ok:false, error} or {ok, words:[{word, score}], score, bingo, rackLeft, placements}.
   */
  function evaluateMove(board, rack, placements, dict) {
    var clean = cleanPlacements(placements);
    if (clean.error) return fail(clean.error);
    placements = clean.placements;
    var seen = {};
    for (var i = 0; i < placements.length; i++) {
      var p = placements[i];
      if (board[p.r][p.c]) return fail('That square is already taken.');
      var key = p.r + ',' + p.c;
      if (seen[key]) return fail('Two tiles on one square.');
      seen[key] = true;
    }
    var rackLeft = takeFromRack(rack, placements);
    if (!rackLeft) return fail('Those tiles are not on your rack.');

    var rows = unique(placements.map(function (q) { return q.r; }));
    var cols = unique(placements.map(function (q) { return q.c; }));
    if (rows.length > 1 && cols.length > 1) return fail('Tiles must be in one row or one column.');

    var after = board.map(function (row) { return row.slice(); });
    placements.forEach(function (q) { after[q.r][q.c] = { l: q.l, b: !!q.b, fresh: true }; });

    var horizontal = rows.length === 1 && (cols.length > 1 || hasNeighbourAlong(after, placements[0], 0, 1));
    var dr = horizontal ? 0 : 1, dc = horizontal ? 1 : 0;

    var line = placements.map(function (q) { return horizontal ? q.c : q.r; });
    var lo = Math.min.apply(null, line), hi = Math.max.apply(null, line);
    for (var k = lo; k <= hi; k++) {
      var rr = horizontal ? rows[0] : k, cc = horizontal ? k : cols[0];
      if (!after[rr][cc]) return fail('There is a gap between your tiles.');
    }

    if (boardIsEmpty(board)) {
      if (!seen[CENTER + ',' + CENTER]) return fail('The first word must cover the centre star.');
      if (placements.length < 2) return fail('The first word needs at least two letters.');
    } else {
      var touches = placements.some(function (q) {
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) {
          var r = q.r + d[0], c = q.c + d[1];
          return inBounds(r, c) && board[r][c];
        });
      });
      if (!touches) return fail('Your word must connect to tiles already on the board.');
    }

    var words = [];
    var main = wordThrough(after, placements[0].r, placements[0].c, dr, dc);
    if (main.cells.length > 1) words.push(main);
    placements.forEach(function (q) {
      var cross = wordThrough(after, q.r, q.c, dc, dr);
      if (cross.cells.length > 1) words.push(cross);
    });
    if (!words.length) return fail('A word needs at least two letters.');

    if (dict) {
      var bad = words.filter(function (w) { return !dict.has(w.word); }).map(function (w) { return w.word; });
      if (bad.length) return fail('Not in the dictionary: ' + bad.join(', '), { badWords: bad });
    }

    var total = 0;
    var scored = words.map(function (w) { var s = scoreWord(w.cells); total += s; return { word: w.word, score: s }; });
    var bingo = placements.length === RACK_SIZE;
    if (bingo) total += BINGO;
    return { ok: true, words: scored, score: total, bingo: bingo, rackLeft: rackLeft, placements: placements };
  }

  // ------------------------------------------------------------------ game flow

  function newGameState(players, rng) {
    var bag = newBag(rng);
    var racks = {}, scores = {};
    players.forEach(function (p) { racks[p] = draw(bag, []); scores[p] = 0; });
    return { players: players.slice(), board: emptyBoard(), bag: bag, racks: racks, scores: scores,
      turn: 0, scoreless: 0, status: 'active', moves: [], winner: null, adjustments: [] };
  }

  function currentPlayer(s) { return s.players[s.turn]; }

  function requireTurn(s, player) {
    if (s.status !== 'active') return 'This game is over.';
    if (currentPlayer(s) !== player) return "It's not your turn.";
    return null;
  }

  function advance(s) { s.turn = (s.turn + 1) % s.players.length; }

  function scoreless(s) {
    s.scoreless = (s.scoreless || 0) + 1;
    if (s.scoreless >= 6) finish(s, null);
    else advance(s);
  }

  /**
   * End of game: each player loses their unplayed tile values; whoever went out gains
   * the total. Every change is recorded in s.adjustments for the result and replays.
   */
  function finish(s, wentOut) {
    var bonus = 0;
    s.adjustments = [];
    s.players.forEach(function (p) {
      var v = rackValue(s.racks[p]);
      if (v) s.adjustments.push({ player: p, points: -v, reason: 'unplayed tiles ' + s.racks[p].join('') });
      s.scores[p] -= v;
      bonus += v;
    });
    if (wentOut && bonus) {
      s.scores[wentOut] += bonus;
      s.adjustments.push({ player: wentOut, points: bonus, reason: "went out: everyone else's unplayed tiles" });
    }
    s.status = 'finished';
    s.wentOut = wentOut || null;
    var best = Math.max.apply(null, s.players.map(function (p) { return s.scores[p]; }));
    var top = s.players.filter(function (p) { return s.scores[p] === best; });
    s.winner = top.length === 1 ? top[0] : 'tie';
    s.winners = top;
  }

  function playMove(s, player, placements, dict, now) {
    var err = requireTurn(s, player);
    if (err) return fail(err);
    var res = evaluateMove(s.board, s.racks[player], placements, dict);
    if (!res.ok) return res;
    res.placements.forEach(function (p) { s.board[p.r][p.c] = { l: p.l, b: p.b }; });
    s.racks[player] = draw(s.bag, res.rackLeft);
    s.scores[player] += res.score;
    // a valid play worth 0 (all blanks, no premiums) still counts as scoreless
    s.scoreless = res.score === 0 ? (s.scoreless || 0) + 1 : 0;
    s.moves.push({ player: player, type: 'play', tiles: res.placements, words: res.words, score: res.score, bingo: res.bingo, at: now || 0 });
    if (!s.racks[player].length && !s.bag.length) finish(s, player);
    else if (s.scoreless >= 6) finish(s, null);
    else advance(s);
    return { ok: true, score: res.score, words: res.words, bingo: res.bingo, placements: res.placements };
  }

  function exchangeTiles(s, player, letters, rng, now) {
    var err = requireTurn(s, player);
    if (err) return fail(err);
    var clean = cleanLetters(letters);
    if (clean.error) return fail(clean.error);
    letters = clean.letters;
    if (s.bag.length < RACK_SIZE) return fail('You can only exchange while the bag has at least 7 tiles.');
    var left = takeFromRack(s.racks[player], letters.map(function (l) { return l === '?' ? { l: 'A', b: true } : { l: l }; }));
    if (!left) return fail('Those tiles are not on your rack.');
    // return the tiles, mix the bag, then draw: a returned tile can come straight back
    s.bag = shuffle(s.bag.concat(letters), rng);
    draw(s.bag, left);
    s.racks[player] = left;
    s.moves.push({ player: player, type: 'exchange', count: letters.length, score: 0, at: now || 0 });
    scoreless(s);
    return { ok: true, count: letters.length };
  }

  function passTurn(s, player, now) {
    var err = requireTurn(s, player);
    if (err) return fail(err);
    s.moves.push({ player: player, type: 'pass', score: 0, at: now || 0 });
    scoreless(s);
    return { ok: true };
  }

  /** What a viewer may see: their own rack only; never the bag order or other racks. */
  function publicView(s, viewer) {
    var rackCounts = {};
    s.players.forEach(function (p) { rackCounts[p] = s.racks[p].length; });
    return {
      players: s.players, board: s.board, scores: s.scores, turn: s.turn, current: currentPlayer(s),
      status: s.status, winner: s.winner, bagCount: s.bag.length, rackCounts: rackCounts,
      myRack: viewer && s.racks[viewer] ? s.racks[viewer] : null,
      moves: s.moves.slice(-12), moveCount: s.moves.length, scoreless: s.scoreless || 0,
      adjustments: s.status === 'active' ? [] : s.adjustments,
    };
  }

  return {
    SIZE: SIZE, CENTER: CENTER, RACK_SIZE: RACK_SIZE, BINGO: BINGO, DISTRIBUTION: DISTRIBUTION, VALUES: VALUES, PREMIUM: PREMIUM,
    emptyBoard: emptyBoard, newBag: newBag, shuffle: shuffle, evaluateMove: evaluateMove, scoreWord: scoreWord,
    cleanPlacements: cleanPlacements, cleanLetters: cleanLetters, rackValue: rackValue,
    newGameState: newGameState, playMove: playMove, exchangeTiles: exchangeTiles, passTurn: passTurn, publicView: publicView,
  };
})();

GN.games.wordwright = (function () {
  var W = GN.wordwright;

  function dict(ctx) {
    if (!ctx.options.dictionary) return null;
    var d = ctx.services && ctx.services.dict ? ctx.services.dict() : null;
    if (!d) GN.fail('The word list is not available right now. Try again in a minute.', 'DICT');
    return d;
  }

  function result(s) {
    return { status: 'finished', winners: s.winners.slice(), scores: GN.util.clone(s.scores), adjustments: GN.util.clone(s.adjustments),
      reason: s.wentOut ? 'went out' : 'six scoreless turns in a row' };
  }

  return {
    id: 'wordwright', name: 'Wordwright', version: '1.0.0', rulesVersion: 1, minutes: 45,
    description: 'Build crossing words from a rack of seven letter tiles. Premium squares multiply letters and words.',
    players: { min: 2, max: 4 },
    options: [
      { id: 'dictionary', label: 'Check words against the word list', type: 'boolean', default: true,
        help: 'Off: players agree among themselves what counts.' },
      { id: 'board', label: 'Board', type: 'choice', default: 'drawn', display: true,
        help: 'Only changes the picture; the squares and rules are the same.',
        choices: [{ value: 'drawn', label: 'Drawn (matches the look)' }, { value: 'maple', label: 'Maple artwork' },
          { value: 'walnut', label: 'Walnut artwork' }, { value: 'felt', label: 'Felt artwork' }, { value: 'slate', label: 'Slate artwork' }] },
    ],
    anytime: [],
    assets: ['board-maple', 'board-walnut', 'board-felt', 'board-slate'],

    setup: function (ctx) { return W.newGameState(ctx.players, ctx.rng); },

    actors: function (s) { return s.status === 'active' ? [s.players[s.turn]] : []; },

    apply: function (s, player, action, ctx) {
      var r, events;
      if (action.type === 'play') {
        r = W.playMove(s, player, action.placements, dict(ctx), ctx.now);
        if (!r.ok) return r;
        events = [{ type: 'play', public: { player: player, tiles: r.placements, words: r.words, score: r.score, bingo: r.bingo } }];
      } else if (action.type === 'exchange') {
        r = W.exchangeTiles(s, player, action.letters, ctx.rng, ctx.now);
        if (!r.ok) return r;
        events = [{ type: 'exchange', public: { player: player, count: r.count } }];
      } else if (action.type === 'pass') {
        r = W.passTurn(s, player, ctx.now);
        if (!r.ok) return r;
        events = [{ type: 'pass', public: { player: player } }];
      } else {
        return { ok: false, error: 'Unknown move.' };
      }
      var out = { ok: true, state: s, events: events, response: { score: r.score || 0, words: r.words || [], bingo: !!r.bingo } };
      if (s.status === 'finished') {
        out.result = result(s);
        events.push({ type: 'end', public: { scores: s.scores, adjustments: s.adjustments, winners: s.winners, reason: out.result.reason } });
      }
      return out;
    },

    view: function (s, viewer) { return W.publicView(s, viewer); },

    summary: function (s, players) {
      return players.map(function (p) { return p.name + ' ' + s.scores[p.id]; }).join(' · ');
    },

    /** Score preview: evaluate a move without playing it. */
    query: function (s, player, q, ctx) {
      if (!q || q.type !== 'preview') return { ok: false, error: 'Unknown question.' };
      var rack = s.racks[player];
      if (!rack) return { ok: false, error: 'You are not playing in this game.' };
      var d = null;
      try { d = dict(ctx); } catch (e) { d = null; }
      var r = W.evaluateMove(s.board, rack, q.placements, d);
      return r.ok ? { ok: true, score: r.score, words: r.words, bingo: r.bingo, checked: !!d }
        : { ok: true, valid: false, error: r.error, badWords: r.badWords || [] };
    },
  };
})();
