/*
 * Four in a Row in the browser. Each column is one large button.
 *   mouse: hovering previews where the disc lands; a click drops it
 *   touch: the first tap previews; tapping the same column again drops it
 *   keyboard: arrows move between columns (with preview); Enter or Space drops
 * The disc falls only after the server accepts the move, into the row it reports.
 */
(function () {
  var COLS = 7, ROWS = 6;
  var CSS = [
    '.f4 { display: grid; gap: 10px; justify-items: center; }',
    '.f4-frame { position: relative; width: min(100%, 560px); padding: 10px; border-radius: var(--gn-radius); background: var(--gn-tex-board); background-color: var(--gn-board-base); box-shadow: var(--gn-frame); }',
    '.f4-grid { position: relative; display: grid; grid-template-columns: repeat(7, 1fr); gap: 0; }',
    '.f4-col { position: relative; display: grid; grid-template-rows: repeat(6, 1fr); border: 0; padding: 0; background: none; cursor: pointer; touch-action: manipulation; border-radius: 10px; }',
    '.f4-col:focus-visible { outline: 3px solid var(--gn-focus); outline-offset: 2px; z-index: 2; }',
    '.f4-col:disabled { cursor: default; }',
    '.f4-col.f4-sel { background: rgba(255,255,255,.12); }',
    '.f4-cell { position: relative; aspect-ratio: 1 / 1; display: grid; place-items: center; }',
    '.f4-hole { width: 82%; height: 82%; border-radius: 50%; background: var(--gn-board-dark); box-shadow: inset 0 3px 6px rgba(0,0,0,.55); }',
    '.f4-disc { position: absolute; width: 82%; height: 82%; border-radius: 50%; display: grid; place-items: center; font-size: clamp(12px, 3.6vw, 26px); font-weight: 700;',
    '  background-image: var(--gn-tex-piece); box-shadow: inset 0 -3px 0 rgba(0,0,0,.25), 0 2px 3px rgba(0,0,0,.35); }',
    '.f4-ghost { opacity: .45; outline: 3px dashed currentColor; outline-offset: -3px; }',
    '.f4-fall { animation: f4-fall var(--f4-ms, 420ms) cubic-bezier(.45,0,.55,1) both; }',
    '@keyframes f4-fall { 0% { transform: translateY(calc(var(--f4-rows) * -110%)); } 80% { transform: translateY(0); } 90% { transform: translateY(-8%); } 100% { transform: translateY(0); } }',
    '.f4-win { box-shadow: 0 0 0 4px var(--gn-highlight), 0 0 16px 4px var(--gn-highlight); animation: f4-pulse 1.2s ease-in-out infinite alternate; }',
    '@keyframes f4-pulse { from { filter: brightness(1); } to { filter: brightness(1.25); } }',
    '.f4-line { position: absolute; inset: 0; pointer-events: none; }',
    '.f4-line line { stroke: var(--gn-highlight); stroke-width: 6; stroke-linecap: round; opacity: .85; }',
    '.f4-arrows { display: grid; grid-template-columns: repeat(7, 1fr); width: 100%; height: 22px; margin-bottom: 2px; }',
    '.f4-arrow { text-align: center; color: var(--gn-highlight); font-size: 18px; line-height: 22px; visibility: hidden; }',
    '.f4-arrow.on { visibility: visible; }',
    '.f4-help { text-align: center; font-family: var(--gn-font-ui); min-height: 1.4em; margin: 0; }',
  ].join('\n');

  function injectCss() {
    if (document.getElementById('f4-css')) return;
    var st = document.createElement('style'); st.id = 'f4-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function preview(el) {
    var colors = ['var(--gn-p0)', 'var(--gn-p1)'];
    var marks = [[5, 1, 0], [5, 2, 1], [4, 2, 0], [5, 3, 1], [4, 3, 0], [3, 3, 0], [5, 4, 1], [4, 4, 1]];
    var html = '<svg viewBox="0 0 210 130"><rect x="25" y="5" width="160" height="120" rx="8" fill="var(--gn-board-base)"/>';
    for (var r = 0; r < 6; r++) for (var c = 0; c < 7; c++) {
      var hit = marks.filter(function (m) { return m[0] === r && m[1] === c; })[0];
      html += '<circle cx="' + (40 + c * 22) + '" cy="' + (17 + r * 20) + '" r="8.5" fill="' + (hit ? colors[hit[2]] : 'var(--gn-board-dark)') + '"/>';
    }
    el.innerHTML = html + '</svg>';
  }

  function mount(host, api) {
    injectCss();
    var el = api.el;
    var m = null, v = null, sel = -1, hover = -1, sending = false, lastSeen = -1;
    var root = el('div', { class: 'f4' });
    var bar = el('div', { class: 'gn-scorebar', role: 'list', 'aria-label': 'Players' });
    var frame = el('div', { class: 'f4-frame' });
    var arrows = el('div', { class: 'f4-arrows', 'aria-hidden': 'true' });
    var grid = el('div', { class: 'f4-grid', role: 'group', 'aria-label': 'Grid, 7 columns by 6 rows' });
    var help = el('p', { class: 'f4-help', 'aria-live': 'polite' });
    frame.appendChild(arrows); frame.appendChild(grid);
    root.appendChild(bar); root.appendChild(frame); root.appendChild(help);
    host.appendChild(root);

    var pointerKind = 'mouse';
    grid.addEventListener('pointerdown', function (e) { pointerKind = e.pointerType || 'mouse'; }, true);

    function myTurn() { return m && m.status === 'active' && m.actors.indexOf(api.me) >= 0 && !sending; }
    function seatOf(id) { return api.player(id) || { color: '#888', text: '#fff', symbol: '?', name: '?' }; }
    function landing(c) { for (var r = ROWS - 1; r >= 0; r--) if (!v.rows[r][c]) return r; return -1; }

    function disc(id, cls) {
      var p = seatOf(id);
      return el('span', { class: 'f4-disc' + (cls ? ' ' + cls : ''), style: { background: p.color, color: p.text }, 'aria-hidden': 'true' }, p.symbol);
    }

    function drop(c) {
      if (!myTurn() || landing(c) < 0) return;
      sending = true; sel = c;
      render();
      help.textContent = 'Dropping…';
      api.act({ type: 'drop', col: c }).then(function (r) {
        sending = false;
        if (r.ok) { sel = -1; api.sound('drop'); }
        render();
      });
    }

    function onColumn(c, e) {
      if (!myTurn()) return;
      if (landing(c) < 0) { api.toast('That column is full.', 'info'); api.sound('bad'); return; }
      var viaKey = e && e.detail === 0;          // Enter or Space on the focused column
      if (pointerKind === 'mouse' && !viaKey) return drop(c);
      if (viaKey || sel === c) return drop(c);
      sel = c;                                     // touch: first tap previews
      api.sound('click');
      render();
    }

    function onKey(e) {
      var t = e.target;
      if (!t.classList.contains('f4-col')) return;
      var c = +t.dataset.c;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var n = Math.max(0, Math.min(COLS - 1, c + (e.key === 'ArrowRight' ? 1 : -1)));
        if (myTurn()) sel = n;                      // keyboard preview
        render();
        var b = grid.querySelector('[data-c="' + n + '"]');
        if (b) b.focus();
      }
    }
    grid.addEventListener('keydown', onKey);

    function render(animate) {
      GNC.clear(bar);
      v.players.forEach(function (id) {
        var p = seatOf(id), turn = m.status === 'active' && v.current === id;
        bar.appendChild(el('span', { class: 'gn-score' + (turn ? ' gn-turn' : ''), role: 'listitem', 'aria-label': p.name + (turn ? ', to move' : '') },
          el('span', { class: 'gn-seat-chip', style: { background: p.color, color: p.text }, 'aria-hidden': 'true' }, p.symbol), p.name));
      });
      var focusC = grid.contains(document.activeElement) ? document.activeElement.dataset.c : null;
      GNC.clear(grid); GNC.clear(arrows);
      var preview = sel >= 0 ? sel : (pointerKind === 'mouse' ? hover : -1);
      var winSet = {};
      (v.line || []).forEach(function (rc) { winSet[rc[0] + ',' + rc[1]] = true; });
      var last = v.last;
      for (var c = 0; c < COLS; c++) {
        var free = landing(c);
        arrows.appendChild(el('span', { class: 'f4-arrow' + (preview === c && myTurn() ? ' on' : '') }, '▼'));
        var col = el('button', { class: 'f4-col' + (sel === c ? ' f4-sel' : ''), 'data-c': c, disabled: !myTurn() && !(m.status === 'active'),
          'aria-label': 'Column ' + (c + 1) + (free < 0 ? ', full' : ', ' + (free + 1) + ' spaces free') + (sel === c ? '. Activate again to drop here' : '') });
        for (var r = 0; r < ROWS; r++) {
          var cell = el('span', { class: 'f4-cell' }, el('span', { class: 'f4-hole' }));
          var who = v.rows[r][c];
          if (who) {
            var isLast = last && last.row === r && last.col === c;
            var d = disc(who, (winSet[r + ',' + c] ? 'f4-win' : '') + (isLast && animate ? ' f4-fall' : ''));
            if (isLast && animate) d.style.setProperty('--f4-rows', String(r + 1));
            cell.appendChild(d);
          } else if (preview === c && free === r && myTurn()) {
            cell.appendChild(disc(api.me, 'f4-ghost'));
          }
          col.appendChild(cell);
        }
        (function (cc) {
          col.addEventListener('click', function (e) { onColumn(cc, e); });
          col.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse' && myTurn() && hover !== cc) { hover = cc; render(); } });
        })(c);
        grid.appendChild(col);
      }
      grid.onpointerleave = function () { if (hover >= 0) { hover = -1; render(); } };
      if (v.line) drawLine(v.line);
      if (focusC !== null) { var f = grid.querySelector('[data-c="' + focusC + '"]'); if (f) f.focus(); }
      if (m.status !== 'active') help.textContent = v.winner ? seatOf(v.winner).name + ' made four in a row.' : 'The grid is full: a draw.';
      else if (!sending) help.textContent = myTurn() ? (pointerKind === 'mouse' ? 'Click a column to drop your disc.' : 'Tap a column to see where your disc lands, then tap again to drop.') : 'Waiting for ' + seatOf(v.current).name + '.';
    }

    function drawLine(line) {
      var a = line[0], b = line[line.length - 1];
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'f4-line'); svg.setAttribute('viewBox', '0 0 70 60'); svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = '<line x1="' + (a[1] * 10 + 5) + '" y1="' + (a[0] * 10 + 5) + '" x2="' + (b[1] * 10 + 5) + '" y2="' + (b[0] * 10 + 5) + '" vector-effect="non-scaling-stroke"/>';
      grid.appendChild(svg);
    }

    return {
      update: function (match, info) {
        var prevRev = m ? m.rev : -1;
        m = match; v = match.view;
        var animate = m.rev !== lastSeen && prevRev >= 0 && m.rev > prevRev && v.last;
        lastSeen = m.rev;
        if (sel >= 0 && (!myTurn() || landing(sel) < 0)) sel = -1;
        render(animate);
        if (animate && v.last && v.last.player !== api.me) {
          api.sound('drop');
          api.announce(seatOf(v.last.player).name + ' dropped in column ' + (v.last.col + 1) + '.');
        }
        if (animate && m.status !== 'active') {
          api.announce(v.winner ? seatOf(v.winner).name + ' wins with four in a row.' : 'Draw: the grid is full.');
        }
      },
      destroy: function () { grid.removeEventListener('keydown', onKey); },
    };
  }

  GNC.games.fourinarow = { preview: preview, mount: mount };
})();
