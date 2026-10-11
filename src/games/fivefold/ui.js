/*
 * Fivefold in the browser: a dice tray and a shared scorecard.
 * Dice are drawn as SVG. While a roll is on its way the free dice tumble; they settle
 * on the faces the server rolled (never on faces chosen here). Tap a die to hold it
 * after the first roll; your holds survive a reload on this device. Potential scores
 * appear in your empty boxes but are only recorded when you choose one.
 */
(function () {
  var UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
  var LOWER = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'fiveKind', 'chance'];
  var LABELS = { ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes',
    threeKind: 'Three of a Kind', fourKind: 'Four of a Kind', fullHouse: 'Full House', smallStraight: 'Small Straight',
    largeStraight: 'Large Straight', fiveKind: 'Five of a Kind', chance: 'Chance' };
  var HINTS = { threeKind: 'sum of all dice', fourKind: 'sum of all dice', fullHouse: '25', smallStraight: '30',
    largeStraight: '40', fiveKind: '50', chance: 'sum of all dice' };
  var PIPS = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]] };
  var CSS = [
    '.ff { display: grid; gap: 12px; }',
    '.ff-tray { display: grid; gap: 10px; justify-items: center; padding: 14px; border-radius: var(--gn-radius); background: var(--gn-tex-board); background-color: var(--gn-board-base); box-shadow: var(--gn-frame); }',
    '.ff-dice { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }',
    '.ff-die { position: relative; width: 64px; height: 76px; border: 0; padding: 0; background: none; cursor: pointer; display: grid; justify-items: center; align-content: start; gap: 2px; touch-action: manipulation; }',
    '.ff-die svg { width: 60px; height: 60px; filter: drop-shadow(0 3px 2px rgba(0,0,0,.4)); transition: transform .15s; }',
    '.ff-die .face { fill: #fbf6ea; stroke: #5b4630; stroke-width: 3; }',
    '[data-theme="slate"] .ff-die .face { fill: #ffffff; stroke: #34495a; }',
    '.ff-die .pip { fill: #2a1a0f; } [data-theme="slate"] .ff-die .pip { fill: #142330; }',
    '.ff-die .blank { fill: none; stroke: #b8a68c; stroke-dasharray: 6 6; stroke-width: 3; }',
    '.ff-die.ff-held svg { transform: translateY(-6px); }',
    '.ff-die.ff-held .face { stroke: var(--gn-highlight); stroke-width: 7; }',
    '@media (max-width: 480px) { .ff-dice { gap: 4px; flex-wrap: nowrap; } .ff-die { width: 54px; height: 68px; } .ff-die svg { width: 50px; height: 50px; } .ff-tray { padding: 10px 6px; } }',
    '.ff-tag { font: 700 11px/1 var(--gn-font-ui); letter-spacing: .08em; padding: 2px 6px; border-radius: 999px; visibility: hidden; background: var(--gn-highlight); color: #1b1300; }',
    '.ff-held .ff-tag { visibility: visible; }',
    '.ff-die:disabled { cursor: default; }',
    '.ff-die:focus-visible { outline: 3px solid var(--gn-focus); outline-offset: 2px; border-radius: 10px; }',
    '.ff-tumble svg { animation: ff-tumble .18s linear infinite; }',
    '@keyframes ff-tumble { 0% { transform: rotate(0) translateY(-4px); } 50% { transform: rotate(160deg) translateY(2px); } 100% { transform: rotate(360deg) translateY(-4px); } }',
    '.ff-settle svg { animation: ff-settle .35s cubic-bezier(.2,1.6,.4,1); }',
    '@keyframes ff-settle { from { transform: scale(1.25) rotate(-12deg); } to { transform: none; } }',
    '.ff-rollrow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; color: var(--gn-table-text); font-family: var(--gn-font-ui); }',
    '.ff-card { width: 100%; overflow-x: auto; background: var(--gn-surface); color: var(--gn-surface-text); border-radius: var(--gn-radius); box-shadow: var(--gn-shadow); }',
    '.ff-card table { width: 100%; border-collapse: collapse; font-family: var(--gn-font-ui); font-size: .95rem; }',
    '.ff-card th, .ff-card td { padding: 6px 8px; border-bottom: 1px solid var(--gn-line); text-align: center; }',
    '.ff-card th[scope=row] { text-align: left; font-weight: 600; white-space: nowrap; }',
    '.ff-card th[scope=row] small { display: block; font-weight: 400; color: var(--gn-muted); font-size: .78rem; }',
    '.ff-card thead th { position: sticky; top: 0; background: var(--gn-surface-alt); }',
    '.ff-card .ff-turn { box-shadow: inset 0 -3px 0 var(--gn-highlight); }',
    '.ff-card .ff-sub td, .ff-card .ff-sub th { background: var(--gn-surface-alt); font-weight: 700; }',
    '.ff-card .ff-total td, .ff-card .ff-total th { font-size: 1.05rem; font-weight: 800; background: var(--gn-surface-alt); }',
    '.ff-card td b { font-family: var(--gn-font-numbers); }',
    '.ff-pick { min-width: 52px; min-height: 36px; border-radius: 8px; border: 2px dashed var(--gn-accent); background: transparent; color: var(--gn-accent); font-weight: 700; cursor: pointer; }',
    '.ff-pick.ff-zero { border-color: var(--gn-muted); color: var(--gn-muted); }',
    '.ff-pick:hover, .ff-pick:focus-visible { background: var(--gn-accent); color: var(--gn-accent-text); border-style: solid; }',
    '.ff-new { animation: ff-flash 1.2s ease-out; }',
    '@keyframes ff-flash { from { background: var(--gn-highlight); } to { background: transparent; } }',
    '.ff-ghost { color: var(--gn-muted); font-style: italic; }',
  ].join('\n');

  function injectCss() {
    if (document.getElementById('ff-css')) return;
    var st = document.createElement('style'); st.id = 'ff-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function dieSvg(n) {
    var s = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect class="face" x="5" y="5" width="90" height="90" rx="18"/>';
    if (!n) s += '<rect class="blank" x="22" y="22" width="56" height="56" rx="10"/>';
    else PIPS[n].forEach(function (p) { s += '<circle class="pip" cx="' + p[0] + '" cy="' + p[1] + '" r="9"/>'; });
    return s + '</svg>';
  }

  function preview(el) {
    injectCss();
    var faces = [5, 5, 5, 2, 2];
    el.innerHTML = '<div style="display:flex;gap:8px;align-items:center;justify-content:center;height:100%">' +
      faces.map(function (f, i) { return '<div class="ff-die' + (i < 3 ? ' ff-held' : '') + '" style="width:40px;height:44px">' + dieSvg(f).replace('<svg ', '<svg style="width:38px;height:38px" ') + '</div>'; }).join('') + '</div>';
  }

  function mount(host, api) {
    injectCss();
    var el = api.el;
    var m = null, v = null, hold = [false, false, false, false, false], rolling = false, sending = false;
    var tumbleTimer = null, settleNext = false, flashedScore = null;
    var root = el('div', { class: 'ff' });
    var tray = el('div', { class: 'ff-tray' });
    var dice = el('div', { class: 'ff-dice', role: 'group', 'aria-label': 'Dice' });
    var rollRow = el('div', { class: 'ff-rollrow' });
    var card = el('div', { class: 'ff-card' });
    var live = el('p', { class: 'gn-sr', 'aria-live': 'polite' });
    tray.appendChild(dice); tray.appendChild(rollRow);
    root.appendChild(tray); root.appendChild(card); root.appendChild(live);
    host.appendChild(root);

    function myTurn() { return m && m.status === 'active' && m.actors.indexOf(api.me) >= 0 && !sending; }
    function person(id) { return api.player(id) || { name: '?', color: '#888', text: '#fff', symbol: '?' }; }
    function draftKey() { return 'ff.hold.' + m.id + '.' + v.round + '.' + v.rollsLeft; }
    function saveHold() { if (m) GNC.store.set(draftKey(), JSON.stringify(hold)); }
    function loadHold() {
      try { var h = JSON.parse(GNC.store.get(draftKey()) || 'null'); if (Array.isArray(h) && h.length === 5) return h.map(Boolean); } catch (e) { /* none */ }
      return null;
    }

    function tumble(on) {
      clearInterval(tumbleTimer);
      if (!on) return;
      tumbleTimer = setInterval(function () {
        Array.prototype.forEach.call(dice.querySelectorAll('.ff-tumble'), function (d) {
          d.querySelector('svg').outerHTML = dieSvg(1 + Math.floor(Math.random() * 6));
        });
      }, 90);
    }

    function doRoll() {
      if (!myTurn() || v.rollsLeft <= 0) return;
      if (v.dice && hold.every(Boolean)) { api.toast('Release at least one die to roll, or score now.', 'info'); return; }
      sending = true; rolling = true;
      renderDice(true);
      tumble(true);
      api.sound('roll');
      api.act({ type: 'roll', hold: v.dice ? hold : undefined }).then(function (r) {
        sending = false; rolling = false; tumble(false);
        if (r.ok) {
          hold = r.response.held.slice();
          settleNext = true;
          api.announce('Rolled ' + r.response.dice.join(', ') + '. ' + r.response.rollsLeft + ' rolls left.');
        }
        render();
      });
    }

    function doScore(cat, pts) {
      if (!myTurn()) return;
      var go = function (zero) {
        sending = true; render();
        api.act({ type: 'score', category: cat, zero: zero }).then(function (r) {
          sending = false;
          if (r.ok) { api.sound(pts ? 'score' : 'click'); api.announce(LABELS[cat] + ': ' + pts + ' points.'); hold = [false, false, false, false, false]; }
          render();
        });
      };
      if (pts === 0) {
        api.confirm('Score 0 for ' + LABELS[cat] + '?', 'These dice do not fit ' + LABELS[cat] + '. The box will be filled with 0 for the rest of the game.', 'Take the 0').then(function (y) { if (y) go(true); });
      } else go(false);
    }

    function renderDice(tumbling) {
      GNC.clear(dice);
      var faces = v.dice || [0, 0, 0, 0, 0];
      var canHold = myTurn() && !!v.dice && v.rollsLeft > 0;
      for (var i = 0; i < 5; i++) {
        var held = v.dice ? (v.current === api.me ? hold[i] : v.held[i]) : false;
        var moving = tumbling && !held;
        var settle = !tumbling && settleNext && !!v.dice && !held;
        var b = el('button', { class: 'ff-die' + (held ? ' ff-held' : '') + (moving ? ' ff-tumble' : '') + (settle ? ' ff-settle' : ''), disabled: !canHold,
          'aria-pressed': v.dice ? (held ? 'true' : 'false') : null,
          'aria-label': 'Die ' + (i + 1) + ': ' + (faces[i] || 'not rolled') + (held ? ', held' : '') + (canHold ? '. Activate to ' + (held ? 'release' : 'hold') : '') });
        b.innerHTML = dieSvg(faces[i]);
        b.appendChild(el('span', { class: 'ff-tag', 'aria-hidden': 'true' }, 'HELD'));
        (function (k) {
          b.addEventListener('click', function () {
            if (!canHold || rolling) return;
            hold[k] = !hold[k];
            saveHold();
            api.sound('click');
            renderDice(false);
          });
        })(i);
        dice.appendChild(b);
      }
      if (!tumbling) settleNext = false;
    }

    function renderRoll() {
      GNC.clear(rollRow);
      var who = v.current ? person(v.current) : null;
      if (m.status !== 'active') {
        var names = v.winners.map(function (id) { return person(id).name; });
        rollRow.appendChild(el('strong', null, names.length > 1 ? 'Tie: ' + names.join(' and ') : names[0] + ' wins'));
        return;
      }
      if (myTurn() || (sending && v.current === api.me)) {
        var label = !v.dice ? 'Roll the dice' : v.rollsLeft ? 'Roll again (' + v.rollsLeft + ' left)' : 'No rolls left';
        rollRow.appendChild(el('button', { class: 'gn-btn gn-go', disabled: sending || v.rollsLeft <= 0, onclick: doRoll }, label));
        rollRow.appendChild(el('span', null, !v.dice ? 'Round ' + v.round + ' of ' + v.rounds :
          v.rollsLeft ? 'Tap dice to hold them, then roll, or pick a box below to score.' : 'Pick a box below to score.'));
      } else {
        rollRow.appendChild(el('span', null, who.name + (v.dice ? ' has rolled ' + (3 - v.rollsLeft) + ' of 3 times' : ' is about to roll') + ' · round ' + v.round + ' of ' + v.rounds));
      }
    }

    function renderCard() {
      GNC.clear(card);
      var players = v.players;
      var newest = v.lastScore;
      var newestKey = newest ? newest.player + ':' + newest.category : null;
      var flash = newestKey && newestKey !== flashedScore;
      flashedScore = newestKey;
      var head = el('tr', null, el('th', { scope: 'col' }, 'Box'), players.map(function (id) {
        var p = person(id);
        return el('th', { scope: 'col', class: v.current === id ? 'ff-turn' : '' },
          el('span', { class: 'gn-seat-chip', style: { background: p.color, color: p.text, display: 'inline-grid', width: '22px', height: '22px', marginRight: '4px' }, 'aria-hidden': 'true' }, p.symbol), p.name);
      }));
      var rows = [];
      var line = function (cat) {
        return el('tr', null, el('th', { scope: 'row' }, LABELS[cat], HINTS[cat] ? el('small', null, HINTS[cat]) : null), players.map(function (id) {
          var val = v.cards[id][cat];
          var fresh = flash && newest.player === id && newest.category === cat;
          if (val !== null) return el('td', { class: fresh ? 'ff-new' : '' }, el('b', null, String(val)));
          if (id === v.current && v.potential && v.potential[cat] !== undefined) {
            var pts = v.potential[cat];
            if (id === api.me && myTurn()) {
              return el('td', null, el('button', { class: 'ff-pick' + (pts ? '' : ' ff-zero'), onclick: function () { doScore(cat, pts); },
                'aria-label': 'Score ' + LABELS[cat] + ' for ' + pts + (pts ? '' : ', a zero') }, String(pts)));
            }
            return el('td', { class: 'ff-ghost', 'aria-label': 'possible ' + pts }, String(pts));
          }
          return el('td', { 'aria-label': 'empty' }, '');
        }));
      };
      UPPER.forEach(function (c) { rows.push(line(c)); });
      rows.push(el('tr', { class: 'ff-sub' }, el('th', { scope: 'row' }, 'Upper total'), players.map(function (id) { return el('td', null, String(v.totals[id].upper)); })));
      rows.push(el('tr', { class: 'ff-sub' }, el('th', { scope: 'row' }, 'Bonus', el('small', null, '35 at 63 or more')), players.map(function (id) {
        var t = v.totals[id];
        return el('td', null, t.bonus ? '+' + t.bonus : el('span', { class: 'ff-ghost' }, (63 - t.upper) + ' to go'));
      })));
      LOWER.forEach(function (c) { rows.push(line(c)); });
      rows.push(el('tr', { class: 'ff-total' }, el('th', { scope: 'row' }, 'Total'), players.map(function (id) { return el('td', null, el('b', null, String(v.totals[id].total))); })));
      card.appendChild(el('table', null, el('caption', { class: 'gn-sr' }, 'Scorecard'), el('thead', null, head), el('tbody', null, rows)));
    }

    function render() {
      renderDice(rolling);
      renderRoll();
      renderCard();
    }

    return {
      update: function (match) {
        var prev = m;
        m = match; v = match.view;
        if (v.current === api.me && v.dice) {
          var saved = loadHold();
          hold = saved || v.held.slice();
        } else if (!v.dice) {
          hold = [false, false, false, false, false];
        }
        var fromOther = prev && m.rev > prev.rev && v.lastRoll && v.lastRoll.player !== api.me && (!prev.view.lastRoll || prev.view.lastRoll !== v.lastRoll) && v.dice;
        if (fromOther && !rolling) {
          // show the other player's roll arriving: a short tumble, then the real faces
          rolling = true; renderDice(true); tumble(true); api.sound('roll');
          setTimeout(function () { rolling = false; tumble(false); settleNext = true; render(); }, 500);
          renderRoll(); renderCard();
        } else if (!rolling) {
          if (!prev) flashedScore = v.lastScore ? v.lastScore.player + ':' + v.lastScore.category : null;   // no flash on first load
          render();
        }
        if (prev && prev.rev < m.rev && v.lastScore && v.lastScore.player !== api.me && (!prev.view.lastScore || prev.view.lastScore.round !== v.lastScore.round || prev.view.lastScore.player !== v.lastScore.player)) {
          live.textContent = person(v.lastScore.player).name + ' scored ' + v.lastScore.points + ' for ' + LABELS[v.lastScore.category] + '.';
        }
      },
      destroy: function () { tumble(false); },
    };
  }

  GNC.games.fivefold = { preview: preview, mount: mount, labels: LABELS };
})();
