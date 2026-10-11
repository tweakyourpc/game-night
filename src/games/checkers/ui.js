/*
 * Checkers in the browser. Each player sees their own pieces at the bottom. Tap (or
 * click, or Tab + Enter) one of your pieces that can move, then a highlighted square.
 * When a capture is compulsory only the capturing pieces are offered; during a
 * multi-jump the continuing piece stays selected. Squares are named a1-h8 from Dark's
 * side.
 */
(function () {
  var N = 8;
  var CSS = [
    '.ck { display: grid; gap: 10px; justify-items: center; }',
    '.ck-frame { width: min(100%, 560px); padding: 12px; border-radius: var(--gn-radius); background: var(--gn-tex-board); background-color: var(--gn-board-base); box-shadow: var(--gn-frame); }',
    '.ck-board { position: relative; display: grid; grid-template-columns: repeat(8, 1fr); aspect-ratio: 1 / 1; border: 2px solid var(--gn-board-line); }',
    '.ck-sq { position: relative; display: grid; place-items: center; border: 0; padding: 0; margin: 0; background: var(--gn-board-cell); }',
    '.ck-sq.ck-dark { background: var(--gn-board-dark); }',
    'button.ck-sq { cursor: pointer; }',
    '.ck-sq:focus-visible { outline: 3px solid var(--gn-focus); outline-offset: -3px; z-index: 3; }',
    '.ck-sq.ck-from::after, .ck-sq.ck-to-last::after { content: ""; position: absolute; inset: 0; background: var(--gn-highlight); opacity: .22; pointer-events: none; }',
    '.ck-target::before { content: ""; position: absolute; width: 30%; height: 30%; border-radius: 50%; background: var(--gn-highlight); opacity: .9; box-shadow: 0 0 0 3px rgba(0,0,0,.25); }',
    '.ck-target.ck-cap::before { width: 46%; height: 46%; background: transparent; border: 4px solid var(--gn-highlight); opacity: 1; }',
    '.ck-piece { position: relative; width: 78%; height: 78%; border-radius: 50%; display: grid; place-items: center; font-size: clamp(12px, 3.4vw, 24px); line-height: 1;',
    '  background-image: var(--gn-tex-piece); box-shadow: inset 0 0 0 3px rgba(0,0,0,.18), inset 0 -4px 0 rgba(0,0,0,.25), 0 3px 4px rgba(0,0,0,.45); z-index: 1; }',
    '.ck-p0 { background-color: #2a2422; color: #f3d77a; }',
    '.ck-p1 { background-color: #efe3c8; color: #8a5a00; }',
    '[data-theme="slate"] .ck-p0 { background-color: #1d2a36; color: #ffd36e; } [data-theme="slate"] .ck-p1 { background-color: #f5f7f9; color: #9a6400; }',
    '.ck-king { box-shadow: inset 0 0 0 3px rgba(0,0,0,.18), inset 0 -4px 0 rgba(0,0,0,.25), 0 3px 0 -1px rgba(0,0,0,.45), 0 6px 4px rgba(0,0,0,.4); }',
    '.ck-movable { box-shadow: 0 0 0 3px var(--gn-highlight), 0 3px 4px rgba(0,0,0,.45); }',
    '.ck-must { box-shadow: 0 0 0 4px var(--gn-highlight), 0 0 14px 4px var(--gn-highlight); }',
    '.ck-selected { transform: translateY(-6%) scale(1.06); box-shadow: 0 0 0 4px var(--gn-focus), 0 8px 10px rgba(0,0,0,.45); }',
    '.ck-cont { animation: ck-pulse 1s ease-in-out infinite alternate; }',
    '@keyframes ck-pulse { from { box-shadow: 0 0 0 3px var(--gn-highlight); } to { box-shadow: 0 0 0 7px var(--gn-highlight), 0 0 18px 6px var(--gn-highlight); } }',
    '.ck-slide { animation: ck-slide .35s cubic-bezier(.3,.8,.4,1) both; }',
    '@keyframes ck-slide { from { transform: translate(var(--ck-dx), var(--ck-dy)); } to { transform: none; } }',
    '.ck-gone { position: absolute; width: 78%; height: 78%; border-radius: 50%; animation: ck-gone .5s ease-in forwards; pointer-events: none; }',
    '@keyframes ck-gone { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(.3) rotate(25deg); } }',
    '.ck-crownpop { animation: ck-pop .5s .3s cubic-bezier(.2,1.6,.4,1) both; display: inline-block; }',
    '@keyframes ck-pop { from { transform: scale(0); } to { transform: none; } }',
    '.ck-coord { position: absolute; font: 600 9px/1 var(--gn-font-ui); opacity: .6; pointer-events: none; }',
    '.ck-coord.f { right: 3px; bottom: 2px; } .ck-coord.r { left: 3px; top: 2px; }',
    '.ck-help { text-align: center; font-family: var(--gn-font-ui); min-height: 1.4em; margin: 0; }',
    '.ck-offer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; padding: 8px 12px; border-radius: var(--gn-radius); background: var(--gn-surface); color: var(--gn-surface-text); }',
    '.ck-controls { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }',
  ].join('\n');

  function injectCss() {
    if (document.getElementById('ck-css')) return;
    var st = document.createElement('style'); st.id = 'ck-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function preview(el) {
    var html = '<svg viewBox="0 0 210 130"><rect x="45" y="5" width="120" height="120" fill="var(--gn-board-cell)"/>';
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      if ((r + c) % 2) {
        html += '<rect x="' + (45 + c * 15) + '" y="' + (5 + r * 15) + '" width="15" height="15" fill="var(--gn-board-dark)"/>';
        if (r < 3 || r > 4) html += '<circle cx="' + (52.5 + c * 15) + '" cy="' + (12.5 + r * 15) + '" r="5.6" fill="' + (r < 3 ? '#efe3c8' : '#2a2422') + '" stroke="rgba(0,0,0,.35)"/>';
      }
    }
    el.innerHTML = html + '</svg>';
  }

  function mount(host, api) {
    injectCss();
    var el = api.el;
    var m = null, v = null, sel = null, sending = false, lastRev = -1;
    var root = el('div', { class: 'ck' });
    var bar = el('div', { class: 'gn-scorebar', role: 'list', 'aria-label': 'Players' });
    var offer = el('div', { 'aria-live': 'polite' });
    var frame = el('div', { class: 'ck-frame' });
    var board = el('div', { class: 'ck-board', role: 'group' });
    var help = el('p', { class: 'ck-help', 'aria-live': 'polite' });
    var controls = el('div', { class: 'ck-controls' });
    frame.appendChild(board);
    root.appendChild(bar); root.appendChild(offer); root.appendChild(frame); root.appendChild(help); root.appendChild(controls);
    host.appendChild(root);

    function mySeat() { return v.players.indexOf(api.me); }
    function flipped() { return mySeat() === 1; }
    function myTurn() { return m && m.status === 'active' && m.actors.indexOf(api.me) >= 0 && !sending; }
    function seatName(o) { return o === 0 ? 'Dark' : 'Light'; }
    function person(id) { return api.player(id) || { name: '?', color: '#888', text: '#fff', symbol: '?' }; }
    function sqName(r, c) { return 'abcdefgh'[c] + (N - r); }
    function same(a, b) { return a && b && a[0] === b[0] && a[1] === b[1]; }
    function movesFrom(r, c) { return (myTurn() ? v.legal : []).filter(function (x) { return x.from[0] === r && x.from[1] === c; }); }

    function act(action) {
      sending = true; render();
      return api.act(action).then(function (r) { sending = false; render(); return r; });
    }

    function onSquare(r, c) {
      if (!myTurn()) return;
      var target = sel && movesFrom(sel[0], sel[1]).filter(function (x) { return x.to[0] === r && x.to[1] === c; })[0];
      if (target) {
        help.textContent = 'Moving…';
        act({ type: 'move', from: target.from, to: target.to }).then(function (res) {
          if (res.ok) {
            api.sound(target.capture ? 'capture' : 'place');
            sel = res.match && res.match.view.continuing ? res.match.view.continuing : null;
            render();
          }
        });
        return;
      }
      if (movesFrom(r, c).length && !v.continuing) { sel = same(sel, [r, c]) ? null : [r, c]; api.sound('click'); render(); }
    }

    function pieceEl(p, extra) {
      return el('span', { class: 'ck-piece ck-p' + p.o + (p.k ? ' ck-king' : '') + (extra ? ' ' + extra : ''), 'aria-hidden': 'true' }, p.k ? '♛' : '');
    }

    function render(animate) {
      var me = mySeat();
      GNC.clear(bar);
      [0, 1].forEach(function (o) {
        var id = v.players[o], p = person(id), turn = m.status === 'active' && v.turn === o;
        bar.appendChild(el('span', { class: 'gn-score' + (turn ? ' gn-turn' : ''), role: 'listitem',
          'aria-label': p.name + ' plays ' + seatName(o) + ', ' + v.pieces[o] + ' pieces' + (turn ? ', to move' : '') },
        el('span', { class: 'ck-piece ck-p' + o, style: { width: '24px', height: '24px' }, 'aria-hidden': 'true' }),
        p.name + ' (' + seatName(o) + ')', el('b', null, String(v.pieces[o]))));
      });

      GNC.clear(offer);
      if (m.status === 'active' && v.drawOffer && me >= 0) {
        if (v.drawOffer === api.me) {
          offer.appendChild(el('div', { class: 'ck-offer' }, 'You offered a draw.',
            el('button', { class: 'gn-btn gn-quiet', onclick: function () { act({ type: 'withdraw-draw' }); } }, 'Withdraw offer')));
        } else {
          offer.appendChild(el('div', { class: 'ck-offer', role: 'alert' }, person(v.drawOffer).name + ' offers a draw.',
            el('button', { class: 'gn-btn', onclick: function () { act({ type: 'accept-draw' }).then(function (r) { if (r.ok) api.sound('score'); }); } }, 'Accept draw'),
            el('button', { class: 'gn-btn gn-quiet', onclick: function () { act({ type: 'decline-draw' }); } }, 'Decline')));
        }
      }

      if (v.continuing && myTurn()) sel = v.continuing;
      var targets = sel ? movesFrom(sel[0], sel[1]) : [];
      var movable = {};
      (myTurn() ? v.legal : []).forEach(function (x) { movable[x.from.join()] = true; });
      var last = animate ? v.last : null;
      var lastShown = v.last;
      var focused = board.contains(document.activeElement) ? document.activeElement.getAttribute('data-sq') : null;
      GNC.clear(board);
      board.setAttribute('aria-label', 'Board' + (flipped() ? ', seen from Light\'s side' : '') + '. ' + (v.mustCapture && myTurn() ? 'A capture is compulsory.' : ''));
      for (var vr = 0; vr < N; vr++) {
        for (var vc = 0; vc < N; vc++) {
          var r = flipped() ? N - 1 - vr : vr, c = flipped() ? N - 1 - vc : vc;
          var dark = (r + c) % 2 === 1;
          var p = v.rows[r][c];
          var tgt = targets.filter(function (x) { return x.to[0] === r && x.to[1] === c; })[0];
          var actionable = dark && myTurn() && (movable[r + ',' + c] || tgt);
          var cls = 'ck-sq' + (dark ? ' ck-dark' : '') + (tgt ? ' ck-target' + (tgt.capture ? ' ck-cap' : '') : '') +
            (lastShown && same(lastShown.from, [r, c]) ? ' ck-from' : '') + (lastShown && same(lastShown.to, [r, c]) ? ' ck-to-last' : '');
          var label = sqName(r, c) + (p ? ', ' + seatName(p.o) + (p.k ? ' king' : ' man') : dark ? ', empty' : '');
          if (movable[r + ',' + c]) label += v.mustCapture ? ', must capture' : ', can move';
          if (tgt) label += tgt.capture ? ', jump here to capture ' + sqName(tgt.capture[0], tgt.capture[1]) : ', move here';
          var sq = actionable ? el('button', { class: cls, 'data-sq': r + '-' + c, 'aria-label': label, 'aria-pressed': same(sel, [r, c]) ? 'true' : null })
            : el('span', { class: cls, role: dark ? 'img' : null, 'aria-label': dark ? label : null });
          if (vr === N - 1) sq.appendChild(el('span', { class: 'ck-coord f', 'aria-hidden': 'true' }, 'abcdefgh'[c]));
          if (vc === 0) sq.appendChild(el('span', { class: 'ck-coord r', 'aria-hidden': 'true' }, String(N - r)));
          if (p) {
            var extra = (same(sel, [r, c]) ? 'ck-selected' : '') + (movable[r + ',' + c] ? (v.mustCapture ? ' ck-must' : ' ck-movable') : '') +
              (v.continuing && same(v.continuing, [r, c]) ? ' ck-cont' : '');
            var pe = pieceEl(p, extra);
            if (last && same(last.to, [r, c])) {
              var dy = (last.from[0] - last.to[0]) * (flipped() ? -100 : 100), dx = (last.from[1] - last.to[1]) * (flipped() ? -100 : 100);
              pe.classList.add('ck-slide');
              pe.style.setProperty('--ck-dx', (dx / 0.78) + '%'); pe.style.setProperty('--ck-dy', (dy / 0.78) + '%');
              if (last.crowned) { pe.textContent = ''; pe.appendChild(el('span', { class: 'ck-crownpop' }, '♛')); }
            }
            sq.appendChild(pe);
          }
          if (last && last.captured && same(last.captured.at, [r, c])) {
            sq.appendChild(el('span', { class: 'ck-gone ck-piece ck-p' + (1 - v.players.indexOf(last.player)), 'aria-hidden': 'true' }));
          }
          if (actionable) (function (rr, cc) { sq.addEventListener('click', function () { onSquare(rr, cc); }); })(r, c);
          board.appendChild(sq);
        }
      }
      if (focused) { var f = board.querySelector('[data-sq="' + focused + '"]'); if (f) f.focus(); }

      GNC.clear(controls);
      if (m.status === 'active' && me >= 0) {
        controls.appendChild(el('button', { class: 'gn-btn gn-quiet', disabled: sending || !!v.drawOffer, onclick: function () {
          api.confirm('Offer a draw?', 'The game ends in a draw only if ' + person(v.players[1 - me]).name + ' accepts.', 'Offer draw').then(function (y) { if (y) act({ type: 'offer-draw' }); });
        } }, 'Offer draw'));
        controls.appendChild(el('button', { class: 'gn-btn gn-quiet gn-danger', disabled: sending, onclick: function () {
          api.confirm('Resign?', person(v.players[1 - me]).name + ' wins.', 'Resign').then(function (y) { if (y) act({ type: 'resign' }); });
        } }, 'Resign'));
      }

      if (m.status !== 'active') {
        help.textContent = v.winner ? person(v.winner).name + ' wins: ' + v.reason + '.' : 'Draw: ' + v.reason + '.';
      } else if (!sending) {
        if (!myTurn()) help.textContent = me < 0 ? person(v.current).name + ' to move.' : 'Waiting for ' + person(v.current).name + '.';
        else if (v.continuing) help.textContent = 'Keep jumping: the same piece must capture again.';
        else if (v.mustCapture) help.textContent = 'You must capture. Choose a highlighted piece.';
        else help.textContent = sel ? 'Choose a highlighted square.' : 'Choose a piece to move.';
      }
    }

    return {
      update: function (match) {
        var prev = m ? m.rev : -1;
        m = match; v = match.view;
        var animate = prev >= 0 && m.rev > prev && m.rev !== lastRev && v.last;
        lastRev = m.rev;
        if (sel && !v.continuing && (!myTurn() || !movesFrom(sel[0], sel[1]).length)) sel = null;
        render(animate);
        if (animate && v.last.player !== api.me) {
          api.sound(v.last.captured ? 'capture' : 'place');
          api.announce(person(v.last.player).name + ' moved ' + sqName(v.last.from[0], v.last.from[1]) + ' to ' + sqName(v.last.to[0], v.last.to[1]) +
            (v.last.captured ? ', capturing on ' + sqName(v.last.captured.at[0], v.last.captured.at[1]) : '') + (v.last.crowned ? ', and was crowned' : '') + '.');
        }
        if (v.drawOffer && v.drawOffer !== api.me && mySeat() >= 0) api.announce(person(v.drawOffer).name + ' offers a draw.');
      },
      destroy: function () {},
    };
  }

  GNC.games.checkers = { preview: preview, mount: mount };
})();
