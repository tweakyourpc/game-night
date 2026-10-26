(function () {
  var CSS = '.ttt{display:grid;gap:14px;justify-items:center}.ttt-board{display:grid;grid-template-columns:repeat(3,1fr);width:min(92vw,360px);aspect-ratio:1;border:2px solid var(--gn-highlight);border-radius:var(--gn-radius);overflow:hidden;background:var(--gn-board-base);box-shadow:var(--gn-frame)}.ttt-cell{position:relative;border:0;border-right:1px solid var(--gn-highlight);border-bottom:1px solid var(--gn-highlight);background:transparent;color:var(--gn-p0);font:700 clamp(42px,15vw,82px)/1 var(--gn-font-ui);cursor:pointer}.ttt-cell:nth-child(3n){border-right:0}.ttt-cell:nth-child(n+7){border-bottom:0}.ttt-cell:focus-visible{outline:3px solid var(--gn-focus);outline-offset:-5px;z-index:1}.ttt-cell:disabled{cursor:default}.ttt-cell.win{background:color-mix(in srgb,var(--gn-highlight) 22%,transparent);color:var(--gn-highlight)}.ttt-mark{display:block;animation:ttt-in .18s ease-out}@keyframes ttt-in{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}.ttt-help{text-align:center;font-family:var(--gn-font-ui);min-height:1.4em;margin:0}';
  function inject() { if (!document.getElementById('ttt-css')) { var s = document.createElement('style'); s.id = 'ttt-css'; s.textContent = CSS; document.head.appendChild(s); } }
  function preview(el) { el.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><rect x="8" y="8" width="104" height="104" rx="8" fill="var(--gn-board-base)" stroke="var(--gn-highlight)" stroke-width="2"/><path d="M42 8v104M78 8v104M8 42h104M8 78h104" stroke="var(--gn-highlight)"/><path d="M20 20l20 20m0-20L20 40M65 20a10 10 0 1 0 0 20a10 10 0 1 0 0-20" fill="none" stroke="var(--gn-p0)" stroke-width="4"/></svg>'; }
  function mount(host, api) {
    inject(); var el = api.el, m = null, v = null, sending = false;
    var root = el('div', { class: 'ttt' }), bar = el('div', { class: 'gn-scorebar', role: 'list', 'aria-label': 'Players' }), board = el('div', { class: 'ttt-board', role: 'grid', 'aria-label': 'Tic-tac-toe board' }), help = el('p', { class: 'ttt-help', 'aria-live': 'polite' });
    root.appendChild(bar); root.appendChild(board); root.appendChild(help); host.appendChild(root);
    function seat(id) { return api.player(id) || { color: '#888', text: '#fff', symbol: '?' }; }
    function mine() { return m && m.status === 'active' && m.actors.indexOf(api.me) >= 0 && !sending; }
    function render() {
      GNC.clear(bar); v.players.forEach(function (id) { var p = seat(id), turn = v.current === id; bar.appendChild(el('span', { class: 'gn-score' + (turn ? ' gn-turn' : ''), role: 'listitem' }, el('span', { class: 'gn-seat-chip', style: { background: p.color, color: p.text } }, p.symbol), p.name)); });
      GNC.clear(board); var wins = {}; (v.line || []).forEach(function (x) { wins[x] = true; });
      v.board.forEach(function (id, i) { var p = id && seat(id); var b = el('button', { class: 'ttt-cell' + (wins[i] ? ' win' : ''), role: 'gridcell', disabled: !!id || !mine(), 'aria-label': id ? 'Square ' + (i + 1) + ', occupied' : 'Square ' + (i + 1) + ', empty' }); if (p) b.appendChild(el('span', { class: 'ttt-mark', style: { color: p.color } }, p.symbol)); b.addEventListener('click', function () { if (!mine()) return; sending = true; render(); api.act({ type: 'mark', cell: i }).then(function (r) { sending = false; if (r.ok) api.sound('click'); render(); }); }); board.appendChild(b); });
      if (m.status !== 'active') help.textContent = v.winner ? seat(v.winner).name + ' wins.' : 'Draw: the board is full.'; else if (!sending) help.textContent = mine() ? 'Choose a square.' : 'Waiting for ' + seat(v.current).name + '.';
    }
    return { update: function (match) { m = match; v = match.view; render(); }, destroy: function () {} };
  }
  GNC.games.tictactoe = { preview: preview, mount: mount };
})();
