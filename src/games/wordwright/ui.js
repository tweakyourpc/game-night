/*
 * Wordwright in the browser. Tiles are drawn as SVG from the theme's colours (no tile
 * pictures). The board is drawn too, or, if the table chose one, an optional board
 * picture fetched once from the server.
 *
 * Input: tap a rack tile then a square, drag a tile onto a square, or focus a square
 * and type letters (arrow keys move, Backspace takes back, Enter plays). Unplayed tiles
 * survive polling; they return to the rack only if the board changes under them.
 * Rack order is local to this browser. Drag between rack slots, or tap Arrange and
 * then two tiles, to sort letters without a server request.
 */
(function () {
  var VALUES = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10,
    R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, '?': 0 };
  var SIZE = 15, CENTER = 7;
  var COLS = 'ABCDEFGHIJKLMNO';
  var PREMIUM = (function () {
    var q = { TW: [[0, 0], [0, 7], [7, 0]], DW: [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]], TL: [[1, 5], [5, 1], [5, 5]],
      DL: [[0, 3], [3, 0], [2, 6], [6, 2], [3, 7], [7, 3], [6, 6]] };
    var g = [];
    for (var r = 0; r < SIZE; r++) { g.push([]); for (var c = 0; c < SIZE; c++) g[r].push(''); }
    Object.keys(q).forEach(function (k) {
      q[k].forEach(function (rc) {
        [[rc[0], rc[1]], [rc[0], 14 - rc[1]], [14 - rc[0], rc[1]], [14 - rc[0], 14 - rc[1]]].forEach(function (p) { g[p[0]][p[1]] = k; });
      });
    });
    return g;
  })();
  var PREMIUM_TEXT = { TW: ['3×', 'word', '3W'], DW: ['2×', 'word', '2W'], TL: ['3×', 'letter', '3L'], DL: ['2×', 'letter', '2L'] };
  var PREMIUM_SPOKEN = { TW: 'triple word', DW: 'double word', TL: 'triple letter', DL: 'double letter' };

  var CSS = [
    '.ww { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }',
    '.ww-board, .ww-rack, .ww-ghost { -webkit-user-select: none; user-select: none; -webkit-user-drag: none; -webkit-touch-callout: none; }',
    '.ww-boardwrap { width: 100%; max-width: 680px; margin: 0 auto; overflow: auto; border-radius: var(--gn-radius); }',
    '.ww-zoom .ww-board { width: 200%; max-width: none; }',
    '.ww-board { position: relative; width: 100%; aspect-ratio: 1 / 1; display: grid; grid-template-columns: repeat(15, 1fr); grid-template-rows: repeat(15, 1fr);',
    '  gap: 2px; padding: 6px; background: var(--gn-tex-board); background-color: var(--gn-board-base); box-shadow: var(--gn-frame); border-radius: var(--gn-radius); touch-action: manipulation; }',
    '.ww-board.ww-art { display: block; padding: 0; gap: 0; background-size: 100% 100%; background-color: #3a2416; }',
    '.ww-art .ww-cell { position: absolute; background: transparent !important; box-shadow: none !important; }',
    '.ww-art .ww-cell .ww-prem { display: none; }',
    '.ww-cell { position: relative; border: 0; padding: 0; margin: 0; min-width: 0; min-height: 0; background: var(--gn-board-cell); border-radius: 3px; cursor: pointer;',
    '  display: grid; place-items: center; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); font: inherit; color: inherit; }',
    '.ww-cell:focus-visible { outline: 3px solid var(--gn-focus); outline-offset: 0; z-index: 3; }',
    '.ww-cell.ww-target { box-shadow: inset 0 0 0 3px var(--gn-highlight); }',
    '.ww-prem { font-family: var(--gn-font-ui); font-size: clamp(6px, 1.45vw, 11px); line-height: 1; text-align: center; font-weight: 700; letter-spacing: .02em; pointer-events: none; }',
    '.ww-prem small { display: block; font-size: .78em; font-weight: 600; }',
    '.ww-short { display: none; }',
    '@media (max-width: 560px) { .ww-board:not(.ww-zoomed) .ww-long { display: none; } .ww-board:not(.ww-zoomed) .ww-short { display: inline; font-size: 8px; } }',
    '.ww-zoom .ww-board .ww-long { display: inline; } .ww-zoom .ww-board .ww-short { display: none; }',
    '.ww-TW { background: #a8322a; color: #fff; } .ww-DW { background: #e8a47f; color: #3a1405; }',
    '.ww-TL { background: #1e5f8f; color: #fff; } .ww-DL { background: #a9d3ef; color: #0c2b40; }',
    '.ww-star { color: #3a1405; font-size: clamp(10px, 2.6vw, 20px); }',
    '.ww-tile { width: 100%; height: 100%; display: block; pointer-events: none; filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); }',
    '.ww-tile .face { fill: #f7ecd2; stroke: #8a6a3f; stroke-width: 2; }',
    '[data-theme="slate"] .ww-tile .face { fill: #fbfcfd; stroke: #6d8394; }',
    '.ww-tile .shine { fill: url(#ww-shine); }',
    '.ww-tile .letter { fill: #2a1a0f; font-family: var(--gn-font-display); font-weight: 700; font-size: 62px; }',
    '[data-theme="slate"] .ww-tile .letter { fill: #142330; }',
    '.ww-tile .pts { fill: #2a1a0f; font-family: var(--gn-font-ui); font-weight: 700; font-size: 24px; }',
    '.ww-tile.blank .letter { fill: #8a3b12; font-style: italic; }',
    '[data-theme="slate"] .ww-tile.blank .letter { fill: #2f6f8f; }',
    '.ww-tile.blank .ring { fill: none; stroke: currentColor; stroke-dasharray: 6 5; stroke-width: 3; color: #8a3b12; }',
    '.ww-tile.pending .face { stroke: var(--gn-accent); stroke-width: 6; }',
    '.ww-tile.recent .face { fill: #fff3b0; }',
    '[data-theme="slate"] .ww-tile.recent .face { fill: #d9f1ff; }',
    '.ww-tile.selected { transform: translateY(-14%); filter: drop-shadow(0 6px 4px rgba(0,0,0,.4)); }',
    '.ww-tile.marked .face { fill: #d7c6a3; } .ww-tile.marked { opacity: .65; }',
    '.ww-new .ww-tile { animation: ww-drop .45s cubic-bezier(.2,1.4,.4,1) both; }',
    '@keyframes ww-drop { from { transform: translateY(-40%) scale(1.25); opacity: 0; } to { transform: none; opacity: 1; } }',
    '.ww-rack { display: flex; justify-content: center; gap: 6px; padding: 8px; border-radius: var(--gn-radius); background: rgba(0,0,0,.25); min-height: 64px; touch-action: none; }',
    '.ww-rtile { width: 52px; height: 52px; border: 0; background: none; padding: 0; cursor: grab; border-radius: 8px; }',
    '.ww-rtile:focus-visible { outline: 3px solid var(--gn-focus); }',
    '.ww-rtile.ww-target { outline: 3px solid var(--gn-highlight); }',
    '.ww-rtile[disabled] { cursor: default; }',
    '@media (max-width: 480px) { .ww-rtile { width: 42px; height: 42px; } .ww-rack { gap: 4px; padding: 6px; } }',
    '.ww-ghost { position: fixed; width: 52px; height: 52px; pointer-events: none; z-index: 80; transform: translate(-50%, -60%) scale(1.15); }',
    '.ww-controls { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }',
    '.ww-preview { text-align: center; min-height: 1.5em; font-family: var(--gn-font-ui); }',
    '.ww-preview.bad { color: #ffb4a8; } .ww-preview.good { color: #c9f7c4; }',
    '.ww-side { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }',
    '.ww-log { list-style: none; margin: 0; padding: 0; font-size: .92rem; } .ww-log li { padding: 3px 0; border-bottom: 1px solid var(--gn-line); }',
    '.ww-letters { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }',
    '.ww-letters button { min-height: 44px; font-weight: 700; font-size: 1.1rem; }',
    '.ww-bag { font-family: var(--gn-font-ui); font-size: .9rem; opacity: .9; }',
  ].join('\n');

  function injectCss() {
    if (document.getElementById('ww-css')) return;
    var st = document.createElement('style');
    st.id = 'ww-css';
    st.textContent = CSS;
    document.head.appendChild(st);
    // one shared gradient definition for tile shine
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('width', '0'); defs.setAttribute('height', '0'); defs.setAttribute('aria-hidden', 'true');
    defs.style.position = 'absolute';
    defs.innerHTML = '<defs><linearGradient id="ww-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/>' +
      '<stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient></defs>';
    document.body.appendChild(defs);
  }

  /** One tile as SVG markup. letter: 'A'..'Z' (or '' for an unchosen blank). */
  function tileSvg(letter, blank, cls) {
    var pts = blank ? '' : String(VALUES[letter] || '');
    return '<svg class="ww-tile' + (blank ? ' blank' : '') + (cls ? ' ' + cls : '') + '" viewBox="0 0 100 100" aria-hidden="true">' +
      '<rect class="face" x="4" y="4" width="92" height="92" rx="12"/>' +
      '<rect class="shine" x="4" y="4" width="92" height="92" rx="12"/>' +
      (blank ? '<rect class="ring" x="13" y="13" width="74" height="74" rx="8"/>' : '') +
      '<text class="letter" x="' + (pts ? 44 : 50) + '" y="71" text-anchor="middle">' + (letter || '') + '</text>' +
      (pts ? '<text class="pts" x="86" y="88" text-anchor="end">' + pts + '</text>' : '') +
      '</svg>';
  }

  function spokenTile(l, b) { return b ? 'blank as ' + l + ', 0 points' : l + ', ' + VALUES[l] + (VALUES[l] === 1 ? ' point' : ' points'); }

  // ------------------------------------------------------------------ catalog preview

  function preview(el) {
    injectCss();
    var word = [['W', 0], ['O', 1], ['R', 2], ['D', 3]];
    var html = '<svg viewBox="0 0 300 140" role="img" aria-label="Letter tiles on a board">' +
      '<rect x="0" y="0" width="300" height="140" fill="var(--gn-board-base)"/>';
    for (var i = 0; i < 12; i++) for (var j = 0; j < 6; j++) {
      var prem = (i + j) % 7 === 0 ? 'var(--gn-p1)' : (i * j) % 11 === 3 ? '#e8a47f' : 'var(--gn-board-cell)';
      html += '<rect x="' + (6 + i * 24) + '" y="' + (6 + j * 22) + '" width="22" height="20" rx="2" fill="' + prem + '" opacity=".9"/>';
    }
    html += '</svg>';
    el.innerHTML = html;
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;display:flex;gap:6px';
    word.forEach(function (w) { var d = document.createElement('div'); d.style.cssText = 'width:44px;height:44px'; d.innerHTML = tileSvg(w[0], false); box.appendChild(d); });
    el.style.position = 'relative';
    el.appendChild(box);
  }

  // ------------------------------------------------------------------ the game

  function mount(host, api) {
    injectCss();
    var el = api.el;
    var m = null, v = null;
    var order = [];             // local rack order: letters as the player arranged them
    var pending = [];           // [{r, c, l, b, slot}] tiles on the board, not yet played
    var selected = -1;          // rack slot index
    var arrangeMode = false, arrangeFrom = -1;
    var exchangeMode = false, marked = {};
    var cursor = { r: CENTER, c: CENTER, across: true };
    var previewSeq = 0, previewTimer = null;
    var art = null;             // {data, grid} when a board picture is in use
    var lastAnimatedRev = -1;

    var root = el('div', { class: 'ww' });
    var scorebar = el('div', { class: 'gn-scorebar', role: 'list', 'aria-label': 'Scores' });
    var wrap = el('div', { class: 'ww-boardwrap' });
    var board = el('div', { class: 'ww-board', role: 'group', 'aria-label': 'Board, 15 by 15. Columns A to O, rows 1 to 15.' });
    wrap.appendChild(board);
    var rack = el('div', { class: 'ww-rack', role: 'group', 'aria-label': 'Your tiles' });
    var previewLine = el('p', { class: 'ww-preview', 'aria-live': 'polite' });
    var controls = el('div', { class: 'ww-controls' });
    var side = el('div', { class: 'ww-side' });
    root.appendChild(scorebar); root.appendChild(wrap); root.appendChild(rack); root.appendChild(previewLine); root.appendChild(controls); root.appendChild(side);
    host.appendChild(root);

    function myTurn() { return m && m.status === 'active' && m.actors.indexOf(api.me) >= 0; }
    function player(id) { return api.player(id) || { name: '?', symbol: '?', color: '#888', text: '#fff' }; }

    // ---- rack bookkeeping
    function syncOrder(rackLetters) {
      var left = rackLetters.slice(), next = [];
      order.forEach(function (l) { var k = left.indexOf(l); if (k >= 0) { next.push(l); left.splice(k, 1); } });
      order = next.concat(left);
    }
    function usedSlots() { var u = {}; pending.forEach(function (p) { u[p.slot] = true; }); return u; }
    function pendingAt(r, c) { return pending.filter(function (p) { return p.r === r && p.c === c; })[0] || null; }
    function cellTile(r, c) { return v.board[r][c]; }

    /** Keep the draft if it still fits the new board and rack; otherwise give the tiles back. */
    function reconcile() {
      if (!pending.length) return;
      // Our own play can reach the board before its response does: the draft is now on the board.
      var landed = pending.every(function (p) { var t = v.board[p.r][p.c]; return t && t.l === p.l && !!t.b === p.b; });
      if (landed) { pending = []; selected = -1; return; }
      var ok = m.status === 'active' && pending.every(function (p) { return !v.board[p.r][p.c] && order[p.slot] === (p.b ? '?' : p.l); });
      if (!ok) {
        pending = [];
        api.toast('The board changed, so your tiles went back to your rack.', 'info');
      }
    }

    function place(slot, r, c, letter) {
      if (!myTurn() || exchangeMode) return;
      if (v.board[r][c] || pendingAt(r, c) || usedSlots()[slot]) return;
      var l = order[slot];
      if (l === '?' && !letter) {
        chooseBlank().then(function (ch) { if (ch) place(slot, r, c, ch); });
        return;
      }
      pending.push({ r: r, c: c, l: l === '?' ? letter : l, b: l === '?', slot: slot });
      selected = -1;
      api.sound('place');
      render();
      schedulePreview();
    }

    function takeBack(r, c) {
      var p = pendingAt(r, c);
      if (!p) return;
      pending = pending.filter(function (x) { return x !== p; });
      api.sound('click');
      render();
      schedulePreview();
    }

    function recall() { pending = []; selected = -1; render(); schedulePreview(); }

    function chooseBlank() {
      return new Promise(function (resolve) {
        var done = false;
        var grid = el('div', { class: 'ww-letters' }, COLS.split('').concat('PQRSTUVWXYZ'.split('')).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(function (L) {
          return el('button', { class: 'gn-btn gn-quiet', 'aria-label': 'Blank as ' + L, onclick: function () { done = true; close(); resolve(L); } }, L);
        }));
        var wrapEl = el('div', { class: 'gn-modal-wrap' }, el('div', { class: 'gn-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose a letter for the blank' },
          el('h2', null, 'Which letter is the blank?'), el('p', { class: 'gn-help' }, 'A blank scores 0 points but counts as any letter.'), grid,
          el('div', { class: 'gn-row gn-end' }, el('button', { class: 'gn-btn gn-quiet', onclick: function () { close(); resolve(null); } }, 'Cancel'))));
        function close() { document.removeEventListener('keydown', onKey, true); if (wrapEl.parentNode) wrapEl.parentNode.removeChild(wrapEl); }
        function onKey(e) {
          if (e.key === 'Escape') { close(); resolve(null); }
          else if (/^[a-z]$/i.test(e.key) && !done) { e.preventDefault(); done = true; close(); resolve(e.key.toUpperCase()); }
        }
        document.body.appendChild(wrapEl);
        document.addEventListener('keydown', onKey, true);
        grid.firstChild.focus();
      });
    }

    // ---- score preview (server-checked, never committed)
    function schedulePreview() {
      clearTimeout(previewTimer);
      previewLine.className = 'ww-preview';
      if (!pending.length) { previewLine.textContent = myTurn() ? 'Your turn: place tiles, then Play. ' + (v.scoreless || 0) + ' of 6 scoreless turns.' : ''; renderControls(); return; }
      previewLine.textContent = 'Checking…';
      var seq = ++previewSeq;
      previewTimer = setTimeout(function () {
        api.query({ type: 'preview', placements: placements() }).then(function (r) {
          if (seq !== previewSeq) return;
          if (!r || !r.ok) { previewLine.textContent = ''; return; }
          if (r.valid === false) {
            previewLine.className = 'ww-preview bad';
            previewLine.textContent = r.error;
          } else {
            previewLine.className = 'ww-preview good';
            previewLine.textContent = r.words.map(function (w) { return w.word + ' ' + w.score; }).join(', ') +
              (r.bingo ? ', all seven tiles +50' : '') + ' → ' + r.score + ' points' + (r.checked ? '' : ' (words not checked)');
          }
          renderControls(r);
        });
      }, 250);
      renderControls();
    }

    function placements() { return pending.map(function (p) { return { r: p.r, c: p.c, l: p.l, b: p.b }; }); }

    // ---- actions
    function play(btn) {
      if (!pending.length) return;
      if (btn) btn.disabled = true;
      api.act({ type: 'play', placements: placements() }).then(function (r) {
        if (btn) btn.disabled = false;
        if (!r.ok) return;
        pending = []; selected = -1;
        var res = r.response || {};
        api.sound('score');
        api.announce('You played ' + (res.words || []).map(function (w) { return w.word; }).join(', ') + ' for ' + res.score + ' points.');
        render();
      });
    }

    function exchange() {
      var letters = Object.keys(marked).map(function (k) { return order[k]; });
      if (!letters.length) return api.toast('Tap the tiles to swap first.', 'info');
      api.confirm('Swap ' + letters.length + ' tile' + (letters.length > 1 ? 's' : '') + '?', 'You score nothing this turn.', 'Swap').then(function (yes) {
        if (!yes) return;
        api.act({ type: 'exchange', letters: letters }).then(function (r) {
          if (!r.ok) return;
          exchangeMode = false; marked = {};
          api.sound('roll');
          render();
        });
      });
    }

    function pass() {
      api.confirm('Pass this turn?', 'Six scoreless turns in a row end the game.', 'Pass').then(function (yes) {
        if (yes) api.act({ type: 'pass' }).then(function (r) { if (r.ok) { recall(); } });
      });
    }

    function shuffleRack() {
      if (pending.length) return api.toast('Take back your tiles first.', 'info');
      for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
      api.sound('roll');
      saveDraft();
      renderRack();
    }

    function moveRackTile(from, to) {
      if (pending.length || from === to || from < 0 || to < 0) return;
      var letter = order.splice(from, 1)[0];
      order.splice(to, 0, letter);
      selected = -1; arrangeFrom = -1;
      saveDraft();
      api.sound('click');
      renderRack();
    }

    // ---- drag (mouse and touch)
    function startDrag(e, slot, fromCell) {
      if (exchangeMode || (fromCell && !myTurn()) || (!fromCell && pending.length)) return;
      var sx = e.clientX, sy = e.clientY, ghost = null, moved = false;
      var target = e.currentTarget;
      if (e.pointerType === 'mouse') e.preventDefault();      // no text selection or native drag
      try { target.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
      function move(ev) {
        if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 8) return;
        moved = true;
        if (!ghost) {
          ghost = el('div', { class: 'ww-ghost' });
          var l = fromCell ? fromCell.l : order[slot];
          ghost.innerHTML = tileSvg(l === '?' ? '' : l, fromCell ? fromCell.b : l === '?', 'selected');
          document.body.appendChild(ghost);
        }
        ghost.style.left = ev.clientX + 'px';
        ghost.style.top = ev.clientY + 'px';
        var c = cellAt(ev.clientX, ev.clientY), rt = fromCell ? null : rackAt(ev.clientX, ev.clientY);
        Array.prototype.forEach.call(root.querySelectorAll('.ww-target'), function (x) { x.classList.remove('ww-target'); });
        if (rt) rt.classList.add('ww-target');
        else if (c && myTurn()) c.classList.add('ww-target');
      }
      function up(ev) {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
        Array.prototype.forEach.call(root.querySelectorAll('.ww-target'), function (x) { x.classList.remove('ww-target'); });
        if (!moved) return;                      // a tap: the click handler deals with it
        target._dragged = true;
        setTimeout(function () { target._dragged = false; }, 50);
        var c = cellAt(ev.clientX, ev.clientY);
        if (fromCell) {
          pending = pending.filter(function (x) { return x !== fromCell; });
          if (c && !v.board[+c.dataset.r][+c.dataset.c] && !pendingAt(+c.dataset.r, +c.dataset.c)) {
            fromCell.r = +c.dataset.r; fromCell.c = +c.dataset.c; pending.push(fromCell); api.sound('place');
          }
          render(); schedulePreview();
        } else if (rackAt(ev.clientX, ev.clientY)) {
          moveRackTile(slot, +rackAt(ev.clientX, ev.clientY).dataset.slot);
        } else if (c && myTurn() && !arrangeMode) {
          place(slot, +c.dataset.r, +c.dataset.c, fromCell && fromCell.b ? fromCell.l : null);
        }
      }
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    }

    function cellAt(x, y) {
      var hit = document.elementFromPoint(x, y);
      while (hit && hit !== document.body) { if (hit.classList && hit.classList.contains('ww-cell')) return hit; hit = hit.parentNode; }
      return null;
    }
    function rackAt(x, y) {
      var hit = document.elementFromPoint(x, y);
      while (hit && hit !== document.body) { if (hit.classList && hit.classList.contains('ww-rtile')) return hit; hit = hit.parentNode; }
      return null;
    }

    // ---- keyboard on the board
    function onBoardKey(e) {
      var t = e.target;
      if (!t.classList || !t.classList.contains('ww-cell')) return;
      var r = +t.dataset.r, c = +t.dataset.c;
      var go = function (nr, nc) {
        nr = Math.max(0, Math.min(14, nr)); nc = Math.max(0, Math.min(14, nc));
        cursor.r = nr; cursor.c = nc;
        var n = board.querySelector('[data-r="' + nr + '"][data-c="' + nc + '"]');
        if (n) n.focus();
      };
      if (e.key === 'ArrowRight') { e.preventDefault(); cursor.across = true; go(r, c + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); cursor.across = true; go(r, c - 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); cursor.across = false; go(r + 1, c); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cursor.across = false; go(r - 1, c); }
      else if (e.key === 'Enter') { e.preventDefault(); if (pending.length) play(); }
      else if (e.key === 'Backspace') {
        e.preventDefault();
        var last = pending[pending.length - 1];
        if (last) { takeBack(last.r, last.c); go(last.r, last.c); }
      } else if (/^[a-z]$/i.test(e.key) && myTurn()) {
        e.preventDefault();
        var L = e.key.toUpperCase(), used = usedSlots();
        var slot = order.findIndex(function (x, i) { return !used[i] && x === L; });
        var asBlank = false;
        if (slot < 0) { slot = order.findIndex(function (x, i) { return !used[i] && x === '?'; }); asBlank = slot >= 0; }
        if (slot < 0) { api.toast('No ' + L + ' on your rack.', 'info'); api.sound('bad'); return; }
        if (v.board[r][c] || pendingAt(r, c)) return;
        var nr = r, nc = c;
        do { if (cursor.across) nc++; else nr++; } while (nr < 15 && nc < 15 && (v.board[nr][nc] || (nr === r && nc === c) || pendingAt(nr, nc)));
        cursor.r = Math.min(14, nr); cursor.c = Math.min(14, nc);
        place(slot, r, c, asBlank ? L : null);
      }
    }
    board.addEventListener('keydown', onBoardKey);

    // ---- rendering
    function renderScores() {
      GNC.clear(scorebar);
      v.players.forEach(function (id) {
        var p = player(id), turn = m.status === 'active' && v.current === id, resigned = (v.resigned || []).indexOf(id) >= 0;
        scorebar.appendChild(el('span', { class: 'gn-score' + (turn ? ' gn-turn' : ''), role: 'listitem',
          'aria-label': p.name + ', ' + v.scores[id] + ' points, ' + v.rackCounts[id] + ' tiles' + (resigned ? ', resigned' : '') + (turn ? ', playing now' : '') },
        el('span', { class: 'gn-seat-chip', style: { background: p.color, color: p.text }, 'aria-hidden': 'true' }, p.symbol),
        el('span', null, p.name + (resigned ? ' (resigned)' : '')), el('b', null, String(v.scores[id])), el('span', { class: 'gn-help', 'aria-hidden': 'true' }, '· ' + v.rackCounts[id] + ' tiles')));
      });
      scorebar.appendChild(el('span', { class: 'ww-bag', 'aria-label': v.bagCount + ' tiles left in the bag' }, 'Bag: ' + v.bagCount));
    }

    function recentCells() {
      var last = v.moves[v.moves.length - 1];
      var s = {};
      if (last && last.type === 'play') last.tiles.forEach(function (t) { s[t.r + ',' + t.c] = true; });
      return s;
    }

    function renderBoard(animate) {
      var recent = recentCells();
      var hadFocus = board.contains(document.activeElement);
      GNC.clear(board);
      board.classList.toggle('ww-art', !!art);
      board.style.backgroundImage = art ? 'url("' + art.data + '")' : '';
      for (var r = 0; r < SIZE; r++) {
        for (var c = 0; c < SIZE; c++) {
          var t = cellTile(r, c), p = pendingAt(r, c), prem = PREMIUM[r][c];
          var name = COLS[c] + (r + 1);
          var label = name + (r === CENTER && c === CENTER ? ', centre star' : '') + (prem ? ', ' + PREMIUM_SPOKEN[prem] : '');
          var cell = el('button', { class: 'ww-cell' + (prem && !t && !p ? ' ww-' + prem : '') + (t && recent[r + ',' + c] && animate ? ' ww-new' : ''),
            'data-r': r, 'data-c': c, tabindex: r === cursor.r && c === cursor.c ? '0' : '-1' });
          if (art) {
            var g = art.grid;
            cell.style.left = (g.cols[c] * 100) + '%'; cell.style.top = (g.rows[r] * 100) + '%';
            cell.style.width = ((g.cols[c + 1] - g.cols[c]) * 100) + '%'; cell.style.height = ((g.rows[r + 1] - g.rows[r]) * 100) + '%';
          }
          if (t) {
            cell.innerHTML = tileSvg(t.l, t.b, recent[r + ',' + c] ? 'recent' : '');
            label += ', ' + spokenTile(t.l, t.b) + (recent[r + ',' + c] ? ', just played' : '');
          } else if (p) {
            cell.innerHTML = tileSvg(p.l, p.b, 'pending');
            label += ', your tile ' + spokenTile(p.l, p.b) + ', not played yet. Activate to take it back.';
            cell.style.touchAction = 'none';
            (function (pp) { cell.addEventListener('pointerdown', function (e) { startDrag(e, pp.slot, pp); }); })(p);
          } else {
            if (r === CENTER && c === CENTER) cell.appendChild(el('span', { class: 'ww-prem ww-star', 'aria-hidden': 'true' }, '★'));
            else if (prem) cell.appendChild(el('span', { class: 'ww-prem', 'aria-hidden': 'true' },
              el('span', { class: 'ww-long' }, PREMIUM_TEXT[prem][0], el('small', null, PREMIUM_TEXT[prem][1])),
              el('span', { class: 'ww-short' }, PREMIUM_TEXT[prem][2])));
            label += ', empty';
          }
          cell.setAttribute('aria-label', label);
          cell.addEventListener('click', onCell);
          cell.addEventListener('focus', function (e) { cursor.r = +e.target.dataset.r; cursor.c = +e.target.dataset.c; });
          board.appendChild(cell);
        }
      }
      // rebuilding the squares must not drop keyboard focus mid-word
      if (hadFocus) { var f = board.querySelector('[data-r="' + cursor.r + '"][data-c="' + cursor.c + '"]'); if (f) f.focus(); }
    }

    function onCell(e) {
      var cell = e.currentTarget;
      if (cell._dragged) return;
      var r = +cell.dataset.r, c = +cell.dataset.c;
      cursor.r = r; cursor.c = c;
      if (pendingAt(r, c)) return takeBack(r, c);
      if (selected >= 0 && !v.board[r][c]) return place(selected, r, c, null);
      if (!v.board[r][c] && myTurn() && selected < 0) api.toast('Pick a tile from your rack first, or type a letter.', 'info');
    }

    function renderRack() {
      GNC.clear(rack);
      if (!v.myRack) { rack.appendChild(el('span', { class: 'gn-help', style: { color: 'inherit' } }, 'Watching: tiles are hidden.')); return; }
      var used = usedSlots();
      order.forEach(function (l, i) {
        if (used[i]) return;
        var cls = (selected === i || arrangeFrom === i ? 'selected' : '') + (marked[i] ? ' marked' : '');
        var b = el('button', { class: 'ww-rtile', 'data-slot': i, 'aria-pressed': exchangeMode ? (marked[i] ? 'true' : 'false') : (selected === i || arrangeFrom === i ? 'true' : 'false'),
          'aria-label': (l === '?' ? 'blank tile' : spokenTile(l, false)) + (exchangeMode ? (marked[i] ? ', chosen to swap' : '') : '') });
        b.innerHTML = tileSvg(l === '?' ? '' : l, l === '?', cls);
        b.addEventListener('pointerdown', function (e) { startDrag(e, i, null); });
        b.addEventListener('click', function () {
          if (b._dragged) return;
          if (exchangeMode) { if (marked[i]) delete marked[i]; else marked[i] = true; api.sound('click'); renderRack(); renderControls(); return; }
          if (arrangeMode) {
            if (arrangeFrom < 0) { arrangeFrom = i; api.announce('Choose where to move ' + (l === '?' ? 'blank' : l) + '.'); renderRack(); }
            else moveRackTile(arrangeFrom, i);
            return;
          }
          selected = selected === i ? -1 : i;
          api.sound('click');
          renderRack();
          if (selected >= 0) api.announce('Selected ' + (l === '?' ? 'blank' : l) + '. Now choose a square.');
        });
        rack.appendChild(b);
      });
    }

    function renderControls(preview) {
      GNC.clear(controls);
      if (!m || m.status !== 'active' || !v.myRack) return;
      var mine = myTurn();
      if (exchangeMode) {
        var n = Object.keys(marked).length;
        controls.appendChild(el('button', { class: 'gn-btn', disabled: !n, onclick: exchange }, n ? 'Swap ' + n + ' tile' + (n > 1 ? 's' : '') : 'Tap tiles to swap'));
        controls.appendChild(el('button', { class: 'gn-btn gn-quiet', onclick: function () { exchangeMode = false; marked = {}; render(); } }, 'Cancel'));
        return;
      }
      var playBtn = el('button', { class: 'gn-btn gn-go', disabled: !mine || !pending.length || (preview && preview.valid === false),
        onclick: function (e) { play(e.currentTarget); } }, preview && preview.valid !== false && preview.score !== undefined ? 'Play for ' + preview.score : 'Play');
      controls.appendChild(playBtn);
      controls.appendChild(el('button', { class: 'gn-btn gn-quiet', disabled: !pending.length, onclick: recall }, 'Take back'));
      controls.appendChild(el('button', { class: 'gn-btn gn-quiet', onclick: shuffleRack, 'aria-label': 'Shuffle your rack' }, 'Shuffle'));
      controls.appendChild(el('button', { class: 'gn-btn gn-quiet', disabled: !!pending.length, 'aria-pressed': arrangeMode ? 'true' : 'false',
        onclick: function () { arrangeMode = !arrangeMode; arrangeFrom = -1; selected = -1; renderRack(); renderControls(); } }, arrangeMode ? 'Done arranging' : 'Arrange tiles'));
      controls.appendChild(el('button', { class: 'gn-btn gn-quiet', disabled: !mine || v.bagCount < 7,
        title: v.bagCount < 7 ? 'Needs at least 7 tiles in the bag' : '', onclick: function () { recall(); exchangeMode = true; marked = {}; render(); } }, 'Swap tiles'));
      controls.appendChild(el('button', { class: 'gn-btn gn-quiet', disabled: !mine, onclick: pass }, 'Pass'));
      controls.appendChild(el('button', { class: 'gn-btn gn-quiet', disabled: (v.resigned || []).indexOf(api.me) >= 0,
        onclick: function () { api.confirm('Resign from Wordwright?', 'Your unplayed tiles are deducted from your score. You cannot rejoin this match.', 'Resign', 'Keep playing').then(function (yes) {
          if (yes) api.act({ type: 'resign' }).then(function (r) { if (r.ok) { pending = []; render(); } });
        }); } }, 'Resign'));
      controls.appendChild(el('button', { class: 'gn-btn gn-quiet', 'aria-pressed': root.classList.contains('ww-zoom') ? 'true' : 'false',
        onclick: function (e) { root.classList.toggle('ww-zoom'); e.currentTarget.setAttribute('aria-pressed', root.classList.contains('ww-zoom') ? 'true' : 'false'); } }, 'Zoom'));
    }

    function describe(mv) {
      var who = player(mv.player).name;
      if (mv.type === 'play') return who + ' played ' + mv.words.map(function (w) { return w.word; }).join(', ') + ' for ' + mv.score + (mv.bingo ? ' (all seven tiles!)' : '');
      if (mv.type === 'exchange') return who + ' swapped ' + mv.count + ' tile' + (mv.count > 1 ? 's' : '');
      if (mv.type === 'pass') return who + ' passed';
      if (mv.type === 'resign') return who + ' resigned';
      return who + ' ' + mv.type;
    }

    function renderSide() {
      GNC.clear(side);
      var items = v.moves.slice().reverse().map(function (mv) { return el('li', null, describe(mv)); });
      if (m.status !== 'active' && v.adjustments && v.adjustments.length) {
        items.unshift(el('li', null, el('strong', null, 'Final: '), v.adjustments.map(function (a) {
          return player(a.player).name + ' ' + (a.points > 0 ? '+' : '') + a.points + ' (' + a.reason + ')';
        }).join('; ')));
      }
      side.appendChild(el('section', { class: 'gn-panel', 'aria-label': 'Moves' }, el('h3', null, 'Moves'),
        items.length ? el('ol', { class: 'ww-log' }, items) : el('p', { class: 'gn-help' }, 'No moves yet. The first word must cover the ★.')));
    }

    /** The draft survives a reload on this device (it never leaves the browser). */
    function saveDraft() {
      if (!m) return;
      if (v && v.myRack) GNC.store.set('ww.draft.' + m.id, JSON.stringify({ order: order, pending: pending }));
    }
    function restoreDraft() {
      try {
        var d = JSON.parse(GNC.store.get('ww.draft.' + m.id) || 'null');
        if (!d || d.order.slice().sort().join() !== order.slice().sort().join()) return;
        order = d.order;
        pending = d.pending;
      } catch (e) { pending = []; }
    }

    function render(animate) {
      saveDraft();
      renderScores();
      renderBoard(animate);
      renderRack();
      renderControls();
      renderSide();
      if (!pending.length) previewLine.textContent = myTurn() ? 'Your turn: place tiles, then Play. ' + (v.scoreless || 0) + ' of 6 scoreless turns.' : (m.status === 'active' ? '' : 'Game over.');
    }

    function loadArt(id) {
      if (!id || id === 'drawn') { art = null; return Promise.resolve(); }
      var meta = GNC.games.wordwright.assetMeta;
      if (!meta || !meta.boards[id]) { art = null; return Promise.resolve(); }
      var key = 'ww.board.' + id;
      var cached = GNC.store.get(key);
      if (cached) { art = { data: cached, grid: meta.grid }; return Promise.resolve(); }
      return GNC.call('asset', GNC.session.token(), 'wordwright', 'board-' + id).then(function (r) {
        if (r && r.ok && r.data) { art = { data: r.data, grid: meta.grid }; GNC.store.set(key, r.data); }
        else { art = null; api.toast('That board picture is not installed here; showing the drawn board.', 'info'); }
      });
    }

    return {
      update: function (match, info) {
        var first = !m;
        m = match; v = match.view;
        if (v.myRack) syncOrder(v.myRack);
        if (first && v.myRack) restoreDraft();
        reconcile();
        if (exchangeMode && !myTurn()) { exchangeMode = false; marked = {}; }
        var animate = !first && m.rev !== lastAnimatedRev && info.previous && info.previous.rev < m.rev;
        lastAnimatedRev = m.rev;
        if (animate) {
          var last = v.moves[v.moves.length - 1];
          if (last && last.player !== api.me) {
            api.sound(last.type === 'play' ? 'place' : 'click');
            api.announce(describe(last) + '.');
          }
        }
        if (first) loadArt(m.options && m.options.board).then(function () { render(false); });
        render(animate);
        if (pending.length) schedulePreview();
      },
      destroy: function () { clearTimeout(previewTimer); board.removeEventListener('keydown', onBoardKey); },
    };
  }

  GNC.games.wordwright = { preview: preview, mount: mount, tileSvg: tileSvg };
})();
