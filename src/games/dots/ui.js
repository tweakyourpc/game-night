/*
 * Dots and Boxes in the browser. The picture is SVG; every undrawn line has a large,
 * labelled button on top of it.
 *   mouse: hover previews the line; click draws it
 *   touch: first tap previews; tapping the same line again draws it
 *   keyboard: Tab to a line (its label names the two dots), Enter or Space draws it
 * Claimed boxes show the owner's initials and symbol as well as their colour.
 */
(function () {
  var ROWS_LABEL = '123456789';
  var COLS_LABEL = 'ABCDEFGHIJ';
  var CSS = [
    '.dt { display: grid; gap: 10px; justify-items: center; }',
    '.dt-frame { width: min(100%, 560px); padding: 8px; border-radius: var(--gn-radius); background: var(--gn-tex-surface); background-color: var(--gn-surface); box-shadow: var(--gn-frame); }',
    '.dt-board { position: relative; width: 100%; }',
    '.dt-board svg { display: block; width: 100%; height: auto; }',
    '.dt-dot { fill: var(--gn-surface-text); }',
    '.dt-guide { stroke: var(--gn-line); stroke-width: .04; stroke-dasharray: .08 .12; }',
    '.dt-line { stroke: var(--gn-surface-text); stroke-width: .12; stroke-linecap: round; }',
    '.dt-line.dt-last { stroke: var(--gn-accent); }',
    '.dt-new { stroke-dasharray: 1.2; stroke-dashoffset: 1.2; animation: dt-draw .35s ease-out forwards; }',
    '@keyframes dt-draw { to { stroke-dashoffset: 0; } }',
    '.dt-preview { stroke-width: .12; stroke-linecap: round; stroke-dasharray: .14 .1; opacity: .9; }',
    '.dt-box rect { rx: .06; }',
    '.dt-box text { font-family: var(--gn-font-ui); font-weight: 700; text-anchor: middle; dominant-baseline: central; }',
    '.dt-box.dt-fresh { transform-box: fill-box; transform-origin: center; animation: dt-pop .4s cubic-bezier(.2,1.5,.4,1) both; }',
    '@keyframes dt-pop { from { transform: scale(.2); opacity: 0; } to { transform: none; opacity: 1; } }',
    '.dt-hit { position: absolute; border: 0; padding: 0; background: transparent; cursor: pointer; border-radius: 8px; touch-action: manipulation; }',
    '.dt-hit:hover:not(:disabled), .dt-hit.dt-sel { background: rgba(0,0,0,.06); }',
    '.dt-hit:focus-visible { outline: 3px solid var(--gn-focus); outline-offset: -2px; }',
    '.dt-hit:disabled { cursor: default; }',
    '.dt-help { text-align: center; font-family: var(--gn-font-ui); min-height: 1.4em; margin: 0; }',
  ].join('\n');

  function injectCss() {
    if (document.getElementById('dt-css')) return;
    var st = document.createElement('style'); st.id = 'dt-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function preview(el) {
    var html = '<svg viewBox="0 0 210 130"><rect x="40" y="5" width="130" height="120" rx="8" fill="var(--gn-surface)"/>';
    var lines = [[0, 0, 0, 1], [0, 1, 0, 2], [0, 0, 1, 0], [0, 1, 1, 1], [1, 0, 1, 1], [1, 1, 2, 1], [0, 2, 1, 2], [2, 2, 2, 3]];
    var X = function (c) { return 60 + c * 30; }, Y = function (r) { return 22 + r * 30; };
    html += '<rect x="' + X(0) + '" y="' + Y(0) + '" width="30" height="30" fill="var(--gn-p0)" opacity=".85"/>';
    html += '<rect x="' + X(1) + '" y="' + Y(0) + '" width="30" height="30" fill="var(--gn-p1)" opacity=".85"/>';
    lines.forEach(function (l) { html += '<line x1="' + X(l[1]) + '" y1="' + Y(l[0]) + '" x2="' + X(l[3]) + '" y2="' + Y(l[2]) + '" stroke="var(--gn-surface-text)" stroke-width="4" stroke-linecap="round"/>'; });
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) html += '<circle cx="' + X(c) + '" cy="' + Y(r) + '" r="4.5" fill="var(--gn-surface-text)"/>';
    el.innerHTML = html + '</svg>';
  }

  /** Short labels for players: initials, made unique within the match. */
  function initials(players) {
    var out = {};
    var first = players.map(function (p) { return (p.name || '?').trim().charAt(0).toUpperCase() || '?'; });
    players.forEach(function (p, i) {
      var clash = first.filter(function (x) { return x === first[i]; }).length > 1;
      out[p.id] = clash ? (p.name || '??').trim().slice(0, 2).replace(/^./, function (x) { return x.toUpperCase(); }) : first[i];
    });
    return out;
  }

  function mount(host, api) {
    injectCss();
    var el = api.el;
    var m = null, v = null, sel = null, hover = null, sending = false, pointerKind = 'mouse', lastRev = -1;
    var tags = initials(api.players);
    var root = el('div', { class: 'dt' });
    var bar = el('div', { class: 'gn-scorebar', role: 'list', 'aria-label': 'Boxes claimed' });
    var frame = el('div', { class: 'dt-frame' });
    var board = el('div', { class: 'dt-board', role: 'group' });
    var help = el('p', { class: 'dt-help', 'aria-live': 'polite' });
    frame.appendChild(board);
    root.appendChild(bar); root.appendChild(frame); root.appendChild(help);
    host.appendChild(root);
    board.addEventListener('pointerdown', function (e) { pointerKind = e.pointerType || 'mouse'; }, true);

    function myTurn() { return m && m.status === 'active' && m.actors.indexOf(api.me) >= 0 && !sending; }
    function seat(id) { return api.player(id) || { color: '#888', text: '#fff', symbol: '?', name: '?' }; }
    var same = function (a, b) { return a && b && a.o === b.o && a.r === b.r && a.c === b.c; };
    function ends(e) { return e.o === 'h' ? [[e.r, e.c], [e.r, e.c + 1]] : [[e.r, e.c], [e.r + 1, e.c]]; }
    function dotName(p) { return COLS_LABEL[p[1]] + ROWS_LABEL[p[0]]; }
    function edgeName(e) { var d = ends(e); return 'Line ' + dotName(d[0]) + ' to ' + dotName(d[1]); }

    function send(e) {
      if (!myTurn()) return;
      sending = true; sel = e; render();
      help.textContent = 'Drawing…';
      api.act({ type: 'line', edge: e }).then(function (r) {
        sending = false; sel = null;
        if (r.ok) {
          var res = r.response || {};
          api.sound(res.boxes ? 'score' : 'line');
          if (res.again) { api.announce(res.boxes === 2 ? 'Two boxes! Draw again.' : 'Box! Draw again.'); }
        }
        render();
      });
    }

    function onEdge(e, ev) {
      if (!myTurn()) return;
      var viaKey = ev && ev.detail === 0;
      if (viaKey || pointerKind === 'mouse' || same(sel, e)) return send(e);
      sel = e; api.sound('click'); render();
    }

    function render(animate) {
      var R = v.rows, C = v.cols, W = C + 1, Hh = R + 1;
      GNC.clear(bar);
      v.players.forEach(function (id) {
        var p = seat(id), turn = m.status === 'active' && v.current === id;
        bar.appendChild(el('span', { class: 'gn-score' + (turn ? ' gn-turn' : ''), role: 'listitem',
          'aria-label': p.name + ', ' + v.scores[id] + ' boxes' + (turn ? ', drawing now' : '') },
        el('span', { class: 'gn-seat-chip', style: { background: p.color, color: p.text }, 'aria-hidden': 'true' }, tags[id]),
        p.name, el('b', null, String(v.scores[id]))));
      });
      bar.appendChild(el('span', { class: 'gn-help', style: { color: 'inherit' } }, v.left + ' boxes left'));

      var last = v.last, fresh = {};
      if (animate && last) last.boxes.forEach(function (b) { fresh[b[0] + ',' + b[1]] = true; });
      var s = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" aria-hidden="true">';
      for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
        var o = v.boxes[r][c];
        if (!o) continue;
        var p = seat(o);
        s += '<g class="dt-box' + (fresh[r + ',' + c] ? ' dt-fresh' : '') + '"><rect x="' + (c + 0.56) + '" y="' + (r + 0.56) + '" width=".88" height=".88" fill="' + p.color + '"/>' +
          '<text x="' + (c + 1) + '" y="' + (r + 0.92) + '" font-size=".34" fill="' + p.text + '">' + GNC.esc(tags[o]) + '</text>' +
          '<text x="' + (c + 1) + '" y="' + (r + 1.24) + '" font-size=".2" fill="' + p.text + '">' + p.symbol + '</text></g>';
      }
      var lineSvg = function (e, cls, color) {
        var d = ends(e);
        return '<line class="' + cls + '" x1="' + (d[0][1] + 0.5) + '" y1="' + (d[0][0] + 0.5) + '" x2="' + (d[1][1] + 0.5) + '" y2="' + (d[1][0] + 0.5) + '"' +
          (color ? ' stroke="' + color + '"' : '') + ' pathLength="1.2"/>';
      };
      var undrawn = [];
      [['h', R + 1, C], ['v', R, C + 1]].forEach(function (k) {
        for (var rr = 0; rr < k[1]; rr++) for (var cc = 0; cc < k[2]; cc++) {
          var e = { o: k[0], r: rr, c: cc };
          var by = (k[0] === 'h' ? v.h : v.v)[rr][cc];
          if (!by) { undrawn.push(e); s += lineSvg(e, 'dt-guide'); continue; }
          var isLast = last && same(last.edge, e);
          s += lineSvg(e, 'dt-line' + (isLast ? ' dt-last' : '') + (isLast && animate ? ' dt-new' : ''));
        }
      });
      var show = sel || (pointerKind === 'mouse' ? hover : null);
      if (show && myTurn()) s += lineSvg(show, 'dt-preview', seat(api.me).color);
      for (var dr = 0; dr <= R; dr++) for (var dc = 0; dc <= C; dc++) s += '<circle class="dt-dot" cx="' + (dc + 0.5) + '" cy="' + (dr + 0.5) + '" r=".09"/>';
      s += '</svg>';

      var focused = board.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
      board.innerHTML = s;
      board.setAttribute('aria-label', 'Dots, ' + (R + 1) + ' rows by ' + (C + 1) + ' columns. ' + undrawn.length + ' lines left to draw.');
      undrawn.forEach(function (e) {
        var key = e.o + e.r + '-' + e.c;
        var horiz = e.o === 'h';
        var x = horiz ? e.c + 0.62 : e.c + 0.5 - 0.3, y = horiz ? e.r + 0.5 - 0.3 : e.r + 0.62;
        var w = horiz ? 0.76 : 0.6, h = horiz ? 0.6 : 0.76;
        var b = el('button', { class: 'dt-hit' + (same(sel, e) ? ' dt-sel' : ''), 'data-k': key, disabled: !myTurn(),
          'aria-label': edgeName(e) + (same(sel, e) ? '. Activate again to draw it' : ''),
          style: { left: (x / W * 100) + '%', top: (y / Hh * 100) + '%', width: (w / W * 100) + '%', height: (h / Hh * 100) + '%' } });
        b.addEventListener('click', function (ev) { onEdge(e, ev); });
        b.addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse' && !same(hover, e)) { hover = e; render(); } });
        board.appendChild(b);
      });
      board.onpointerleave = function () { if (hover) { hover = null; render(); } };
      if (focused) { var f = board.querySelector('[data-k="' + focused + '"]'); if (f) f.focus(); }

      if (m.status !== 'active') {
        var names = v.winners.map(function (id) { return seat(id).name; });
        help.textContent = names.length > 1 ? 'Tie between ' + names.join(' and ') + '.' : names[0] + ' claimed the most boxes.';
      } else if (!sending) {
        help.textContent = myTurn() ? (pointerKind === 'mouse' ? 'Click a line between two dots.' : 'Tap a line to preview it, then tap again to draw.')
          : 'Waiting for ' + seat(v.current).name + '.';
      }
    }

    return {
      update: function (match) {
        var prev = m ? m.rev : -1;
        m = match; v = match.view;
        var animate = prev >= 0 && m.rev > prev && m.rev !== lastRev;
        lastRev = m.rev;
        if (sel && (!myTurn() || (sel.o === 'h' ? v.h : v.v)[sel.r][sel.c])) sel = null;
        render(animate);
        if (animate && v.last && v.last.player !== api.me) {
          api.sound(v.last.boxes.length ? 'score' : 'line');
          api.announce(seat(v.last.player).name + ' drew ' + edgeName(v.last.edge) + (v.last.boxes.length ? ' and claimed ' + v.last.boxes.length + (v.last.boxes.length > 1 ? ' boxes' : ' box') : '') + '.');
        }
      },
      destroy: function () {},
    };
  }

  GNC.games.dots = { preview: preview, mount: mount };
})();
