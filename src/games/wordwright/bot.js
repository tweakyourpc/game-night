/** A bounded, deterministic casual opponent. The rules remain the final judge. */
var GN = typeof GN !== 'undefined' ? GN : {};
GN.bots = GN.bots || {};

GN.bots.wordwright = {
  choose: function (state, player, ctx) {
    var dict = null;
    try { dict = ctx.services && ctx.services.dict && ctx.services.dict(); } catch (e) { dict = null; }
    if (!dict || typeof dict.has !== 'function' || typeof dict.forEach !== 'function') {
      GN.fail('The word list is not available right now. Try again in a minute.', 'DICT');
    }
    var W = GN.wordwright, board = state.board, rack = state.racks[player];
    var start = Date.now(), nodes = 0, stopped = false, best = null;
    var occupied = [], counts = {}, rackCounts = {};
    for (var r = 0; r < W.SIZE; r++) for (var c = 0; c < W.SIZE; c++) {
      if (board[r][c]) {
        occupied.push({ r: r, c: c, l: board[r][c].l });
        counts[board[r][c].l] = (counts[board[r][c].l] || 0) + 1;
      }
    }
    rack.forEach(function (l) { rackCounts[l] = (rackCounts[l] || 0) + 1; });
    var blankCount = rackCounts['?'] || 0;
    function withinLimit() {
      if (nodes >= 50000 || Date.now() - start >= 2000) { stopped = true; return false; }
      return true;
    }
    function tryAt(word, row, col, dr, dc) {
      if (!withinLimit()) return;
      nodes++;
      var available = Object.assign({}, rackCounts), blanks = blankCount, placed = [];
      for (var i = 0; i < word.length; i++) {
        var rr = row + dr * i, cc = col + dc * i, l = word.charAt(i);
        if (rr < 0 || cc < 0 || rr >= W.SIZE || cc >= W.SIZE) return;
        var tile = board[rr][cc];
        if (tile) { if (tile.l !== l) return; continue; }
        if (available[l]) { available[l]--; placed.push({ r: rr, c: cc, l: l }); }
        else if (blanks) { blanks--; placed.push({ r: rr, c: cc, l: l, b: true }); }
        else return;
      }
      if (!placed.length || placed.length > rack.length) return;
      var score = W.evaluateMove(board, rack, placed, dict);
      if (score.ok && (!best || score.score > best.score)) best = { score: score.score, placements: placed };
    }
    dict.forEach(function (entry) {
      if (stopped || !withinLimit()) return;
      var word = String(entry).toUpperCase();
      if (!/^[A-Z]{2,15}$/.test(word)) return;
      var needed = {}, deficit = 0;
      for (var i = 0; i < word.length; i++) needed[word.charAt(i)] = (needed[word.charAt(i)] || 0) + 1;
      Object.keys(needed).forEach(function (l) { deficit += Math.max(0, needed[l] - (rackCounts[l] || 0) - (counts[l] || 0)); });
      if (deficit > blankCount) return;
      if (!occupied.length) {
        for (var offset = 0; offset < word.length; offset++) {
          if (stopped) return;
          tryAt(word, W.CENTER, W.CENTER - offset, 0, 1);
          tryAt(word, W.CENTER - offset, W.CENTER, 1, 0);
        }
      } else {
        for (var a = 0; a < occupied.length; a++) {
          for (var j = 0; j < word.length; j++) {
            if (stopped) return;
            if (word.charAt(j) !== occupied[a].l) continue;
            tryAt(word, occupied[a].r, occupied[a].c - j, 0, 1);
            tryAt(word, occupied[a].r - j, occupied[a].c, 1, 0);
          }
        }
      }
    });
    if (best) return { type: 'play', placements: best.placements };
    return state.bag.length >= W.RACK_SIZE && rack.length ? { type: 'exchange', letters: rack.slice() } : { type: 'pass' };
  },
};
