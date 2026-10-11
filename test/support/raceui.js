// Browser module for the platform test game "race" (dev server --test-game only).
GNC.games.race = {
  howTo: '<p>Test game. Step 1 or 2 squares (2 keeps your turn), or roll a die. First to the goal wins.</p>',
  preview: function (el) { el.textContent = 'race'; },
  mount: function (host, api) {
    var el = api.el, box = el('div', { class: 'gn-panel' });
    host.appendChild(box);
    return {
      update: function (m) {
        GNC.clear(box);
        var v = m.view;
        box.appendChild(el('div', { class: 'gn-scorebar' }, api.players.map(function (p) {
          return el('span', { class: 'gn-score' + (m.actors.indexOf(p.id) >= 0 ? ' gn-turn' : '') },
            el('span', { class: 'gn-seat-chip', style: { background: p.color, color: p.text } }, p.symbol), p.name, el('b', null, String(v.pos[p.id])));
        })));
        var mine = m.actors.indexOf(api.me) >= 0;
        ['step1', 'step2', 'roll'].forEach(function (k) {
          var action = k === 'roll' ? { type: 'roll' } : { type: 'step', n: k === 'step1' ? 1 : 2 };
          box.appendChild(el('button', { class: 'gn-btn', disabled: !mine, onclick: function () { api.act(action); } }, k));
        });
      },
      destroy: function () {},
    };
  },
};
