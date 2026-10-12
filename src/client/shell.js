/*
 * Game Night screens: entry (group code and name), lobby, table, and the match frame
 * that hosts a game's own browser module. Uses GNC from core.js.
 */
(function () {
  var el = GNC.el, clear = GNC.clear;
  var root = document.getElementById('gn-app');

  var app = {
    navigation: 0,
    screen: 'boot',            // until the first screen is drawn
    lobby: null, lobbyV: null,
    table: null, here: [],
    match: null, matchHere: [], frame: null,
    pendingLink: GNC.boot.link || '',
  };
  GNC.app = app;

  // ------------------------------------------------------------------ shared pieces

  /** Re-render a region unless someone is typing in it; then wait until they leave it. */
  function patch(region, build) {
    var a = document.activeElement;
    var typing = a && region.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'button';
    if (typing) {
      if (!region._waiting) {
        region._waiting = true;
        region.addEventListener('focusout', function later() {
          setTimeout(function () {
            if (region.contains(document.activeElement)) return;
            region.removeEventListener('focusout', later);
            region._waiting = false;
            patch(region, region._build);
          }, 0);
        });
      }
      region._build = build;
      return;
    }
    var focusId = a && region.contains(a) ? a.getAttribute('data-focus') : null;
    clear(region);
    var out = build();
    if (out) region.appendChild(out);
    if (focusId) { var again = region.querySelector('[data-focus="' + focusId + '"]'); if (again) again.focus(); }
  }

  function region(id) { return el('div', { id: id, class: 'gn-region' }); }

  function showError(res, fallback) {
    GNC.toast((res && res.error) || fallback || 'Something went wrong.', 'bad');
    GNC.sound.play('bad');
  }

  function busy(btn, promise) {
    if (!btn) return promise;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    return promise.then(function (r) { btn.disabled = false; btn.removeAttribute('aria-busy'); return r; });
  }

  function gameName(id) {
    var g = app.lobby && app.lobby.catalog.filter(function (x) { return x.id === id; })[0];
    return g ? g.name : id;
  }

  function soundControls() {
    var vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Sound volume', 'data-focus': 'vol',
      oninput: function () { GNC.sound.setVolume(Number(vol.value)); }, onchange: function () { GNC.sound.play('click'); } });
    vol.value = GNC.sound.volume();
    var mute = el('button', { class: 'gn-icon-btn', 'aria-pressed': GNC.sound.muted() ? 'true' : 'false',
      title: 'Sound on or off', onclick: function () {
        GNC.sound.setMuted(!GNC.sound.muted());
        mute.setAttribute('aria-pressed', GNC.sound.muted() ? 'true' : 'false');
        mute.textContent = GNC.sound.muted() ? '🔇' : '🔊';
        mute.setAttribute('aria-label', GNC.sound.muted() ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
        GNC.sound.play('click');
      } }, GNC.sound.muted() ? '🔇' : '🔊');
    mute.setAttribute('aria-label', GNC.sound.muted() ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
    return el('div', { class: 'gn-sound' }, mute, vol);
  }

  function topBar(left) {
    var me = app.lobby && app.lobby.me;
    return el('header', { class: 'gn-top' },
      el('div', { class: 'gn-top-left' }, left),
      el('div', { class: 'gn-top-right' },
        soundControls(),
        me ? el('button', { class: 'gn-link', onclick: profileDialog, 'aria-label': 'Your profile: ' + me.name }, me.name) : null,
        me ? el('button', { class: 'gn-link', onclick: signOut }, 'Sign out') : null));
  }

  function howToPlay(gameId) {
    var mod = GNC.games[gameId];
    var body = el('div', { class: 'gn-howto' });
    // {game} stands for the configured display name (games can be renamed in src/config/names.js)
    body.innerHTML = mod && mod.howTo ? mod.howTo.replace(/\{game\}/g, GNC.esc(gameName(gameId))) : '<p>No instructions yet.</p>';
    modal(gameName(gameId) + ': how to play', body);
  }

  function modal(title, body, buttons) {
    var prev = document.activeElement;
    var close = function () {
      document.removeEventListener('keydown', onKey, true);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (prev && prev.focus) prev.focus();
    };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    var closeBtn = el('button', { class: 'gn-btn gn-quiet', onclick: close }, 'Close');
    var wrap = el('div', { class: 'gn-modal-wrap', onclick: function (e) { if (e.target === wrap) close(); } },
      el('div', { class: 'gn-modal gn-modal-wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        el('h2', null, title), body, el('div', { class: 'gn-row gn-end' }, buttons || null, closeBtn)));
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey, true);
    closeBtn.focus();
    return close;
  }

  // ------------------------------------------------------------------ entry

  function showEntry(message) {
    app.navigation++; GNC.poller.invalidate();
    app.screen = 'entry';
    GNC.poller.stop();
    clear(root);
    var code = el('input', { id: 'gn-code', type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
      'aria-describedby': 'gn-code-help', required: true });
    var go = el('button', { class: 'gn-btn', type: 'submit' }, 'Continue');
    var form = el('form', { class: 'gn-card gn-entry', onsubmit: function (e) {
      e.preventDefault();
      if (!code.value.trim()) return code.focus();
      busy(go, GNC.call('join', code.value)).then(function (res) {
        if (!res.ok) { showError(res); code.select(); return; }
        pickName(code.value, res);
      });
    } },
    el('h1', null, GNC.boot.platform || 'Game Night'),
    message ? el('p', { class: 'gn-note', role: 'status' }, message) : null,
    el('label', { for: 'gn-code' }, 'Group code'),
    code,
    el('p', { id: 'gn-code-help', class: 'gn-help' }, 'Ask whoever runs your group for the code.'),
    el('div', { class: 'gn-row gn-end' }, go));
    root.appendChild(el('main', { class: 'gn-center' }, form));
    code.focus();
  }

  function pickName(codeValue, info) {
    clear(root);
    var list = el('div', { class: 'gn-names', role: 'list' });
    var pinBox = el('div', { class: 'gn-pin', hidden: true });
    var chosen = null;
    var signIn = function (choice, btn) {
      return busy(btn, GNC.call('join', codeValue, choice, navigator.userAgent.slice(0, 60))).then(function (res) {
        if (!res.ok) return showError(res);
        GNC.session.set(res.token);
        GNC.sound.play('click');
        enterLobby();
      });
    };
    info.members.forEach(function (m) {
      var needsPin = info.mode === 'pin' || m.admin;
      list.appendChild(el('button', { class: 'gn-name', role: 'listitem', onclick: function (e) {
        if (!needsPin) return signIn({ memberId: m.id }, e.currentTarget);
        chosen = m;
        clear(pinBox);
        pinBox.hidden = false;
        var pin = el('input', { id: 'gn-pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', maxlength: '8' });
        var ok = el('button', { class: 'gn-btn', type: 'submit' }, 'Sign in');
        pinBox.appendChild(el('form', { onsubmit: function (ev) { ev.preventDefault(); signIn({ memberId: chosen.id, pin: pin.value }, ok); } },
          el('label', { for: 'gn-pin' }, 'PIN for ' + m.name), el('div', { class: 'gn-row' }, pin, ok)));
        pin.focus();
      } }, m.name, m.admin ? el('span', { class: 'gn-tag' }, 'admin') : null));
    });
    var newName = el('input', { id: 'gn-newname', type: 'text', maxlength: '30', autocomplete: 'nickname' });
    var newPin = info.mode === 'pin' ? el('input', { id: 'gn-newpin', type: 'password', inputmode: 'numeric', maxlength: '8', autocomplete: 'new-password' }) : null;
    var add = el('button', { class: 'gn-btn', type: 'submit' }, 'Join');
    root.appendChild(el('main', { class: 'gn-center' }, el('div', { class: 'gn-card gn-entry' },
      el('h1', null, info.group),
      info.members.length ? el('h2', null, 'Who are you?') : null,
      list, pinBox,
      el('details', { class: 'gn-new', open: !info.members.length },
        el('summary', null, "I'm new here"),
        el('form', { onsubmit: function (e) {
          e.preventDefault();
          var choice = { name: newName.value };
          if (newPin) choice.pin = newPin.value;
          signIn(choice, add);
        } },
        el('label', { for: 'gn-newname' }, 'Your name (as others will see it)'), newName,
        newPin ? [el('label', { for: 'gn-newpin' }, 'Choose a PIN (4 to 8 digits)'), newPin] : null,
        el('div', { class: 'gn-row gn-end' }, add))),
      el('p', { class: 'gn-help' }, info.mode === 'pin'
        ? 'Each person signs in with their own PIN.'
        : 'This group trusts each other: pick your own name. Admins still use a PIN.'))));
  }

  function signOut() {
    GNC.call('signOut', GNC.session.token());
    GNC.session.clear();
    destroyFrame();
    showEntry('Signed out.');
  }

  GNC.onSignedOut = function (msg) {
    if (app.screen === 'entry') return;
    GNC.session.clear();
    destroyFrame();
    showEntry(msg || 'Please sign in again.');
  };

  function profileDialog() {
    var me = app.lobby.me;
    var name = el('input', { id: 'gn-pname', type: 'text', maxlength: '30', value: me.name });
    var email = el('input', { id: 'gn-pemail', type: 'email', value: me.email || '', placeholder: 'optional' });
    var save = el('button', { class: 'gn-btn', onclick: function () {
      busy(save, GNC.call('profile', GNC.session.token(), name.value, email.value)).then(function (res) {
        if (!res.ok) return showError(res);
        GNC.toast('Saved.', 'good');
        close();
        refreshLobby();
      });
    } }, 'Save');
    var close = modal('Your profile', el('div', { class: 'gn-form' },
      el('label', { for: 'gn-pname' }, 'Name'), name,
      el('label', { for: 'gn-pemail' }, 'Email for invitations (optional)'), email,
      el('p', { class: 'gn-help' }, 'Only used for invitations and, if your group turns them on, turn reminders.')), save);
  }

  // ------------------------------------------------------------------ lobby

  function enterLobby() {
    var navigation = ++app.navigation;
    GNC.call('lobby', GNC.session.token()).then(function (res) {
      if (navigation !== app.navigation) return;
      if (!res.ok) { if (res.code !== 'AUTH') showError(res); if (res.code === 'NETWORK') return showEntry(res.error); return; }
      app.lobby = res.lobby;
      app.lobbyV = res.v;
      if (app.pendingLink) {
        var key = app.pendingLink;
        app.pendingLink = '';
        return GNC.call('tableByLink', GNC.session.token(), key).then(function (r) {
          if (navigation !== app.navigation) return;
          if (r.ok) return openTable(r.table.id, r.table);
          showError(r);
          showLobby();
        });
      }
      showLobby();
    });
  }

  function refreshLobby() {
    return GNC.call('lobby', GNC.session.token()).then(function (res) {
      if (!res.ok) return;
      app.lobby = res.lobby; app.lobbyV = res.v;
      if (app.screen === 'lobby') renderLobbyParts();
    });
  }

  var L = {};
  function showLobby() {
    app.navigation++; GNC.poller.invalidate();
    app.screen = 'lobby';
    destroyFrame();
    GNC.applyTheme(app.lobby.defaultTheme || (app.lobby.themes[0] || {}).id);
    app.table = null; app.match = null;
    clear(root);
    L.here = region('gn-l-here'); L.mine = region('gn-l-mine'); L.tables = region('gn-l-tables');
    L.catalog = region('gn-l-catalog'); L.admin = region('gn-l-admin');
    root.appendChild(topBar(el('h1', { class: 'gn-title' }, app.lobby.group)));
    root.appendChild(el('main', { class: 'gn-lobby' },
      el('section', { 'aria-labelledby': 'h-here', class: 'gn-panel gn-here-panel' }, el('h2', { id: 'h-here' }, "Who's here"), L.here),
      el('section', { 'aria-labelledby': 'h-mine', class: 'gn-panel' }, el('h2', { id: 'h-mine' }, 'Your games'), L.mine),
      el('section', { 'aria-labelledby': 'h-tables', class: 'gn-panel' }, el('h2', { id: 'h-tables' }, 'Tables'), L.tables),
      el('section', { 'aria-labelledby': 'h-cat', class: 'gn-panel gn-wide' }, el('h2', { id: 'h-cat' }, 'Start a table'), L.catalog),
      app.lobby.me.role === 'admin' ? el('section', { 'aria-labelledby': 'h-admin', class: 'gn-panel gn-wide' },
        el('h2', { id: 'h-admin' }, 'Group settings'), L.admin) : null));
    renderLobbyParts();
    GNC.poller.start();
  }

  function renderLobbyParts() {
    var lb = app.lobby;
    patch(L.here, function () {
      var names = lb.members.filter(function (m) { return lb.here.indexOf(m.id) >= 0; });
      return el('ul', { class: 'gn-chips' }, names.map(function (m) {
        return el('li', { class: 'gn-chip' }, el('span', { class: 'gn-dot gn-on', 'aria-hidden': 'true' }), m.name);
      }), names.length ? null : el('li', { class: 'gn-help' }, 'Nobody else right now.'));
    });
    patch(L.mine, function () {
      var mine = lb.matches.filter(function (m) { return m.mine; });
      var tables = lb.tables.filter(function (t) { return t.seats.some(function (s) { return s.member_id === lb.me.id; }) && t.status === 'open'; });
      if (!mine.length && !tables.length) return el('p', { class: 'gn-help' }, 'Nothing in progress. Start a table below or join one.');
      return el('ul', { class: 'gn-list' },
        mine.map(function (m) {
          return el('li', null, el('button', { class: 'gn-row-btn', onclick: function () { openTable(m.table_id); } },
            el('strong', null, gameName(m.game_id)), el('span', null, m.summary || ''), el('span', { class: 'gn-when' }, GNC.when(m.updated))));
        }),
        tables.map(function (t) {
          return el('li', null, el('button', { class: 'gn-row-btn', onclick: function () { openTable(t.id); } },
            el('strong', null, t.title), el('span', null, t.game_name + ': waiting to start'), el('span', { class: 'gn-when' }, GNC.when(t.updated))));
        }));
    });
    patch(L.tables, function () {
      var list = lb.tables.filter(function (t) { return !t.inviteOnly || t.invited || t.host_id === lb.me.id || t.seats.some(function (s) { return s.member_id === lb.me.id; }); });
      if (!list.length) return el('p', { class: 'gn-help' }, 'No tables yet.');
      return el('ul', { class: 'gn-list' }, list.map(function (t) {
        var seated = t.seats.map(function (s) { return s.name + (s.ready ? ' ✓' : ''); }).join(', ');
        var state = t.status === 'playing' ? 'playing' : t.seats.length + ' of ' + t.players.max + ' seats';
        return el('li', null, el('button', { class: 'gn-row-btn', onclick: function () { openTable(t.id); },
          'aria-label': t.title + ', ' + t.game_name + ', ' + state + ', hosted by ' + t.host },
        el('strong', null, t.title),
        el('span', null, t.game_name + ' · ' + state + (t.meet ? ' · video call' : '')),
        el('span', { class: 'gn-help' }, seated)));
      }));
    });
    patch(L.catalog, function () {
      return el('div', { class: 'gn-catalog' }, lb.catalog.map(function (g) {
        var prev = el('div', { class: 'gn-preview', 'aria-hidden': 'true' });
        var mod = GNC.games[g.id];
        if (mod && mod.preview) { try { mod.preview(prev); } catch (e) { /* preview is decoration */ } }
        return el('article', { class: 'gn-game-card' }, prev,
          el('h3', null, g.name),
          el('p', null, g.description),
          el('p', { class: 'gn-help' }, g.players.min === g.players.max ? g.players.min + ' players' : g.players.min + ' to ' + g.players.max + ' players'),
          el('div', { class: 'gn-row' },
            el('button', { class: 'gn-btn', onclick: function () { newTableDialog(g); } }, 'New table'),
            el('button', { class: 'gn-btn gn-quiet', onclick: function () { howToPlay(g.id); } }, 'How to play')));
      }));
    });
    if (L.admin && lb.me.role === 'admin') patch(L.admin, adminPanel);
  }

  /** Options form for a game; returns {node, read()}. */
  function optionsForm(g, current) {
    current = current || {};
    var readers = [];
    var node = el('div', { class: 'gn-form' }, (g.options || []).map(function (o) {
      var id = 'opt-' + g.id + '-' + o.id;
      var val = current[o.id] !== undefined ? current[o.id] : o.default;
      if (o.type === 'choice') {
        var sel = el('select', { id: id, 'data-focus': id }, o.choices.map(function (c) {
          return el('option', { value: JSON.stringify(c.value), selected: JSON.stringify(c.value) === JSON.stringify(val) }, c.label);
        }));
        readers.push(function (out) { out[o.id] = JSON.parse(sel.value); });
        return [el('label', { for: id }, o.label), sel, o.help ? el('p', { class: 'gn-help' }, o.help) : null];
      }
      if (o.type === 'boolean') {
        var cb = el('input', { id: id, type: 'checkbox', checked: !!val });
        readers.push(function (out) { out[o.id] = cb.checked; });
        return [el('label', { class: 'gn-check' }, cb, ' ' + o.label), o.help ? el('p', { class: 'gn-help' }, o.help) : null];
      }
      var tx = el('input', { id: id, type: 'text', maxlength: String(o.max || 30), value: val || '', 'data-focus': id });
      readers.push(function (out) { out[o.id] = tx.value; });
      return [el('label', { for: id }, o.label), tx];
    }));
    return { node: node, read: function () { var out = {}; readers.forEach(function (r) { r(out); }); return out; } };
  }

  function themePicker(current, idPrefix) {
    var sel = el('select', { id: idPrefix + '-theme', 'data-focus': idPrefix + '-theme' }, app.lobby.themes.map(function (t) {
      return el('option', { value: t.id, selected: t.id === current }, t.name);
    }));
    return { label: el('label', { for: idPrefix + '-theme' }, 'Look'), node: sel };
  }

  function newTableDialog(g) {
    var title = el('input', { id: 'nt-title', type: 'text', maxlength: '40', placeholder: app.lobby.me.name + "'s table" });
    var opts = optionsForm(g, {});
    var theme = themePicker(app.lobby.defaultTheme || app.lobby.themes[0].id, 'nt');
    var auto = el('input', { type: 'checkbox' });
    var invite = el('input', { type: 'checkbox' });
    var actionId = GNC.newActionId();         // the same id on every retry of this dialog
    var create = el('button', { class: 'gn-btn', onclick: function () {
      busy(create, GNC.call('createTable', GNC.session.token(), { gameId: g.id, title: title.value, themeId: theme.node.value,
        options: opts.read(), autostart: auto.checked, inviteOnly: invite.checked }, actionId)).then(function (res) {
        if (!res.ok) return showError(res);
        close();
        GNC.sound.play('place');
        openTable(res.table.id, res.table);
      });
    } }, 'Create table');
    var close = modal('New ' + g.name + ' table', el('div', { class: 'gn-form' },
      el('label', { for: 'nt-title' }, 'Table name'), title,
      opts.node, theme.label, theme.node,
      el('label', { class: 'gn-check' }, auto, ' Start automatically when every seat is ready'),
      el('label', { class: 'gn-check' }, invite, ' Invite only')), create);
  }

  function adminPanel() {
    var lb = app.lobby;
    var wrap = el('div', { class: 'gn-admin' });
    GNC.call('adminSettings', GNC.session.token()).then(function (res) {
      if (!res.ok) return;
      var s = res.settings;
      var row = function (key, label, input, help) {
        var save = el('button', { class: 'gn-btn gn-quiet', onclick: function () {
          var v = input.type === 'checkbox' ? (input.checked ? 'yes' : 'no') : input.value;
          busy(save, GNC.call('adminSet', GNC.session.token(), key, v)).then(function (r) {
            if (!r.ok) return showError(r);
            GNC.toast('Saved.', 'good');
          });
        } }, 'Save');
        input.id = 'adm-' + key;
        input.setAttribute('data-focus', 'adm-' + key);
        return el('div', { class: 'gn-admin-row' }, el('label', { for: input.id }, label), el('div', { class: 'gn-row' }, input, save),
          help ? el('p', { class: 'gn-help' }, help) : null);
      };
      var mode = el('select', null, el('option', { value: 'trusted', selected: s.identity_mode !== 'pin' }, 'Trusted: pick your name'),
        el('option', { value: 'pin', selected: s.identity_mode === 'pin' }, 'PIN: everyone has a PIN'));
      var emails = el('select', null, el('option', { value: 'no', selected: s.turn_emails !== 'yes' }, 'Off'),
        el('option', { value: 'yes', selected: s.turn_emails === 'yes' }, 'On'));
      var theme = el('select', null, lb.themes.map(function (t) { return el('option', { value: t.id, selected: t.id === s.default_theme }, t.name); }));
      wrap.appendChild(row('group_name', 'Group name', el('input', { type: 'text', value: s.group_name, maxlength: '30' })));
      wrap.appendChild(row('entry_code', 'Group code', el('input', { type: 'text', value: s.entry_code, maxlength: '100' }),
        'Changing it does not sign anyone out; new devices need the new code.'));
      wrap.appendChild(row('identity_mode', 'Sign-in', mode, 'See docs/identity.md: trusted family versus individual PINs.'));
      wrap.appendChild(row('turn_emails', 'Turn reminder emails', emails));
      wrap.appendChild(row('default_theme', 'Default look', theme));
      wrap.appendChild(el('h3', null, 'Members'));
      wrap.appendChild(el('ul', { class: 'gn-list' }, lb.members.map(function (m) {
        var pin = el('input', { type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: 'new PIN', 'aria-label': 'New PIN for ' + m.name, 'data-focus': 'pin-' + m.id });
        var setPin = el('button', { class: 'gn-btn gn-quiet', onclick: function () {
          busy(setPin, GNC.call('adminMember', GNC.session.token(), m.id, { pin: pin.value })).then(function (r) {
            if (!r.ok) return showError(r);
            pin.value = '';
            GNC.toast('PIN set for ' + m.name + '.', 'good');
          });
        } }, 'Set PIN');
        var remove = m.id === lb.me.id ? null : el('button', { class: 'gn-btn gn-quiet gn-danger', onclick: function () {
          GNC.confirm('Remove ' + m.name + '?', 'They are signed out everywhere. Finished games keep their name.', 'Remove').then(function (yes) {
            if (!yes) return;
            GNC.call('adminMember', GNC.session.token(), m.id, { removed: true }).then(function (r) {
              if (!r.ok) return showError(r);
              refreshLobby();
            });
          });
        } }, 'Remove');
        return el('li', { class: 'gn-member' }, el('strong', null, m.name), m.role === 'admin' ? el('span', { class: 'gn-tag' }, 'admin') : null,
          el('div', { class: 'gn-row' }, pin, setPin, remove));
      })));
    });
    return wrap;
  }

  // ------------------------------------------------------------------ table

  var T = {};
  function openTable(tableId, known) {
    app.navigation++; GNC.poller.invalidate();
    app.screen = 'table';
    destroyFrame();
    app.table = known || null;
    app.match = null;
    clear(root);
    T.head = region('gn-t-head'); T.play = el('div', { id: 'gn-t-play', class: 'gn-play' });
    T.seats = region('gn-t-seats'); T.setup = region('gn-t-setup'); T.invite = region('gn-t-invite');
    T.meet = region('gn-t-meet'); T.history = region('gn-t-history'); T.status = region('gn-t-status');
    root.appendChild(topBar(el('div', { class: 'gn-row' },
      el('button', { class: 'gn-link', onclick: function () { showLobby(); refreshLobby(); } }, '← Lobby'), T.head)));
    root.appendChild(el('main', { class: 'gn-table' },
      el('div', { class: 'gn-table-main' }, T.status, T.play),
      el('aside', { class: 'gn-table-side' },
        el('section', { class: 'gn-panel', 'aria-labelledby': 'h-seats' }, el('h2', { id: 'h-seats' }, 'Seats'), T.seats),
        T.meet,
        el('section', { class: 'gn-panel', 'aria-labelledby': 'h-setup' }, el('h2', { id: 'h-setup' }, 'Game'), T.setup),
        el('section', { class: 'gn-panel', 'aria-labelledby': 'h-invite' }, el('h2', { id: 'h-invite' }, 'Invite'), T.invite),
        el('section', { class: 'gn-panel', 'aria-labelledby': 'h-hist' }, el('h2', { id: 'h-hist' }, 'Earlier games'), T.history))));
    var navigation = app.navigation;
    var load = known ? Promise.resolve({ ok: true, table: known }) : GNC.call('table', GNC.session.token(), tableId);
    load.then(function (res) {
      if (navigation !== app.navigation) return;
      if (!res.ok) { showError(res); return showLobby(); }
      setTable(res.table);
      GNC.poller.start();
    });
  }

  function setTable(t) {
    var prev = app.table;
    if (app.screen !== 'table' || (prev && (prev.id !== t.id || t.rev < prev.rev))) return;
    app.table = t;
    GNC.applyTheme(t.theme_id);
    app.here = t.seats.filter(function (s) { return s.here; }).map(function (s) { return s.member_id; });
    if (t.current_match_id && (!app.match || app.match.id !== t.current_match_id)) loadMatch(t.current_match_id);
    if (!t.current_match_id) renderWaiting(t);
    if (prev && prev.status === 'open' && t.status === 'playing') { GNC.sound.play('turn'); GNC.announce('The game has started.'); }
    renderTable();
  }

  /** Before the first game: the game's preview, description and seats-at-a-glance. */
  function renderWaiting(t) {
    if (app.frame) return;
    var g = app.lobby.catalog.filter(function (x) { return x.id === t.game_id; })[0] || { name: t.game_name, description: '' };
    var prev = el('div', { class: 'gn-preview gn-preview-big', 'aria-hidden': 'true' });
    var mod = GNC.games[t.game_id];
    if (mod && mod.preview) { try { mod.preview(prev); } catch (e) { /* decoration */ } }
    clear(T.play);
    T.play.appendChild(el('div', { class: 'gn-panel gn-waiting' }, prev,
      el('h2', null, g.name), el('p', null, g.description),
      el('button', { class: 'gn-btn gn-quiet', onclick: function () { howToPlay(t.game_id); } }, 'How to play')));
    T.play._game = t.game_id;
  }

  function isHost() { return app.table && app.lobby && app.table.host_id === app.lobby.me.id; }

  function tableAct(method, extra, btn) {
    var t = app.table;
    var args = [method, GNC.session.token(), t.id, GNC.req(t.rev)].concat(extra || []);
    return busy(btn, GNC.call.apply(null, args)).then(function (res) {
      if (res.table) setTable(res.table);
      if (!res.ok) showError(res);
      return res;
    });
  }

  function renderTable() {
    var t = app.table, me = app.lobby.me;
    patch(T.head, function () {
      return el('div', { class: 'gn-table-title' }, el('h1', { class: 'gn-title' }, t.title),
        el('span', { class: 'gn-sub' }, t.game_name + (t.status === 'playing' ? ' · playing' : '')));
    });
    patch(T.seats, function () {
      var mine = t.seats.filter(function (s) { return s.member_id === me.id; })[0];
      var list = el('ol', { class: 'gn-seats' }, t.seats.map(function (s, i) {
        var st = GNC.seatStyle(t.theme_id, i);
        var here = s.member_id === me.id || app.here.indexOf(s.member_id) >= 0;
        return el('li', { class: 'gn-seat' + (s.ready ? ' gn-ready' : '') },
          el('span', { class: 'gn-seat-chip', style: { background: st.color, color: st.text }, 'aria-hidden': 'true' }, st.symbol),
          el('span', { class: 'gn-seat-name' }, s.name, s.host ? el('span', { class: 'gn-tag' }, 'host') : null),
          el('span', { class: 'gn-dot' + (here ? ' gn-on' : ''), title: here ? 'here now' : 'away' }),
          el('span', { class: 'gn-sr' }, here ? ', here now' : ', away'),
          t.status === 'open' ? el('span', { class: 'gn-ready-mark' }, s.ready ? '✓ ready' : 'not ready') : null);
      }));
      var g = t.players;
      var actions = el('div', { class: 'gn-row gn-wrap' });
      if (t.status === 'open') {
        if (!mine && t.seats.length < g.max) actions.appendChild(el('button', { class: 'gn-btn', onclick: function (e) { tableAct('sit', [], e.currentTarget).then(function (r) { if (r.ok) GNC.sound.play('place'); }); } }, 'Take a seat'));
        if (mine) {
          actions.appendChild(el('button', { class: 'gn-btn' + (mine.ready ? ' gn-quiet' : ''), 'aria-pressed': mine.ready ? 'true' : 'false',
            onclick: function (e) { tableAct('ready', [!mine.ready], e.currentTarget).then(function (r) { if (r.ok) GNC.sound.play('click'); }); } },
          mine.ready ? 'Not ready yet' : "I'm ready"));
          if (!isHost()) actions.appendChild(el('button', { class: 'gn-btn gn-quiet', onclick: function (e) { tableAct('stand', [], e.currentTarget); } }, 'Leave seat'));
        }
        if (isHost()) {
          var why = t.startBlock;
          actions.appendChild(el('button', { class: 'gn-btn gn-go', disabled: !!why, 'aria-describedby': 'gn-start-why',
            onclick: function (e) { tableAct('start', [], e.currentTarget); } }, t.match_count ? 'Start next game' : 'Start game'));
          actions.appendChild(el('p', { id: 'gn-start-why', class: 'gn-help' }, why || (t.options.autostart ? 'Starts by itself when everyone is ready.' : 'Everyone is ready.')));
        } else {
          actions.appendChild(el('p', { class: 'gn-help' }, t.startBlock ? t.startBlock : 'Waiting for the host to start.'));
        }
      }
      var host = null;
      if (isHost() && t.seats.length > 1) {
        var sel = el('select', { id: 'gn-newhost', 'data-focus': 'gn-newhost' }, t.seats.filter(function (s) { return !s.host; }).map(function (s) {
          return el('option', { value: s.member_id }, s.name);
        }));
        host = el('details', { class: 'gn-more' }, el('summary', null, 'Host tools'),
          el('label', { for: 'gn-newhost' }, 'Make someone else host'),
          el('div', { class: 'gn-row' }, sel, el('button', { class: 'gn-btn gn-quiet', onclick: function (e) { tableAct('transferHost', [sel.value], e.currentTarget); } }, 'Make host')),
          t.status === 'open' ? el('button', { class: 'gn-btn gn-quiet gn-danger', onclick: closeTable }, 'Close table') : null);
      } else if (isHost() && t.status === 'open') {
        host = el('details', { class: 'gn-more' }, el('summary', null, 'Host tools'), el('button', { class: 'gn-btn gn-quiet gn-danger', onclick: closeTable }, 'Close table'));
      }
      return el('div', null, list, el('p', { class: 'gn-help' }, t.seats.length + ' of ' + g.max + ' seats (' + (g.min === g.max ? g.min : g.min + ' to ' + g.max) + ' players)'), actions, host);
    });
    patch(T.setup, function () {
      var g = app.lobby.catalog.filter(function (x) { return x.id === t.game_id; })[0];
      if (!isHost() || t.status !== 'open') {
        var desc = g ? (g.options || []).map(function (o) {
          var v = t.options.game[o.id];
          var c = (o.choices || []).filter(function (x) { return JSON.stringify(x.value) === JSON.stringify(v); })[0];
          return o.label + ': ' + (c ? c.label : (typeof v === 'boolean' ? (v ? 'on' : 'off') : v));
        }) : [];
        return el('div', null, el('p', null, el('strong', null, t.game_name)), desc.length ? el('ul', { class: 'gn-plain' }, desc.map(function (d) { return el('li', null, d); })) : null,
          el('button', { class: 'gn-btn gn-quiet', onclick: function () { howToPlay(t.game_id); } }, 'How to play'));
      }
      var gameSel = el('select', { id: 'cfg-game', 'data-focus': 'cfg-game' }, app.lobby.catalog.map(function (c) {
        return el('option', { value: c.id, selected: c.id === t.game_id }, c.name);
      }));
      var opts = optionsForm(g, t.options.game);
      var theme = themePicker(t.theme_id, 'cfg');
      var auto = el('input', { type: 'checkbox', checked: !!t.options.autostart });
      var invite = el('input', { type: 'checkbox', checked: !!t.options.inviteOnly });
      var save = el('button', { class: 'gn-btn', onclick: function (e) {
        var spec = { themeId: theme.node.value, autostart: auto.checked, inviteOnly: invite.checked };
        if (gameSel.value !== t.game_id) spec.gameId = gameSel.value; else spec.options = opts.read();
        tableAct('configure', [spec], e.currentTarget).then(function (r) { if (r.ok) GNC.toast('Table updated. Everyone needs to be ready again.', 'good'); });
      } }, 'Save changes');
      gameSel.addEventListener('change', function () {
        var ng = app.lobby.catalog.filter(function (x) { return x.id === gameSel.value; })[0];
        var fresh = optionsForm(ng, {});
        opts.node.replaceWith(fresh.node);
        opts = fresh;
      });
      return el('div', { class: 'gn-form' },
        el('label', { for: 'cfg-game' }, 'Game'), gameSel, opts.node, theme.label, theme.node,
        el('label', { class: 'gn-check' }, auto, ' Start automatically when every seat is ready'),
        el('label', { class: 'gn-check' }, invite, ' Invite only'),
        el('div', { class: 'gn-row gn-wrap' }, save, el('button', { class: 'gn-btn gn-quiet', onclick: function () { howToPlay(gameSel.value); } }, 'How to play')));
    });
    patch(T.meet, function () { return meetPanel(t); });
    patch(T.invite, function () { return invitePanel(t); });
    patch(T.history, function () {
      var done = t.matches.filter(function (m) { return m.status !== 'active'; });
      if (!done.length) return el('p', { class: 'gn-help' }, 'None yet.');
      return el('ul', { class: 'gn-list' }, done.slice(0, 10).map(function (m) {
        return el('li', null, el('span', null, gameName(m.game_id) + ': ' + (m.summary || m.status)), el('span', { class: 'gn-when' }, GNC.when(m.updated)),
          GNC.replay ? el('button', { class: 'gn-link', onclick: function () { GNC.replay.open(m.id); } }, 'Replay') : null);
      }));
    });
    renderStatus();
  }

  function closeTable() {
    GNC.confirm('Close this table?', 'It disappears from the lobby. Finished games stay in everyone\'s history.', 'Close table').then(function (yes) {
      if (yes) tableAct('closeTable', []).then(function (r) { if (r.ok) { showLobby(); refreshLobby(); } });
    });
  }

  function meetPanel(t) {
    var open = t.meet_url ? el('button', { class: 'gn-btn', onclick: function () {
      // opened only by this click, in a new tab; the game keeps running here
      var w = window.open(t.meet_url, '_blank', 'noopener');
      if (!w) GNC.toast('Your browser blocked the new tab. Allow pop-ups for this page, or copy the link.', 'bad');
    } }, 'Join video call') : null;
    var editor = null;
    if (isHost()) {
      var url = el('input', { id: 'gn-meet', type: 'url', placeholder: 'https://meet.google.com/…', value: t.meet_url || '', 'data-focus': 'gn-meet' });
      editor = el('details', { class: 'gn-more', open: !t.meet_url && false },
        el('summary', null, t.meet_url ? 'Change video call link' : 'Add a video call link (optional)'),
        el('label', { for: 'gn-meet' }, 'Paste a Google Meet (or other https) link'),
        el('div', { class: 'gn-row' }, url, el('button', { class: 'gn-btn gn-quiet', onclick: function (e) {
          tableAct('setMeet', [url.value], e.currentTarget).then(function (r) { if (r.ok) GNC.toast(url.value ? 'Video call link saved.' : 'Video call link removed.', 'good'); });
        } }, 'Save')),
        el('p', { class: 'gn-help' }, 'Optional. The game works without it; players open the call in a new tab.'));
    }
    if (!open && !editor) return null;
    return el('section', { class: 'gn-panel', 'aria-label': 'Video call' }, open, editor);
  }

  function invitePanel(t) {
    var withCode = el('input', { type: 'checkbox', id: 'inv-code' });
    var text = function () {
      return app.lobby.me.name + ' invited you to play ' + t.game_name + ' at "' + t.title + '" (' + app.lobby.group + ').\n' +
        'Open: ' + t.link + '\n' +
        (withCode.checked ? 'Group code: ' + app.lobby.code + '\n' : 'Ask ' + app.lobby.me.name + ' for the group code.\n') +
        (t.meet_url ? 'Video call: ' + t.meet_url + '\n' : '');
    };
    var copyLink = el('button', { class: 'gn-btn gn-quiet', onclick: function () {
      GNC.copyText(t.link).then(function (ok) { GNC.toast(ok ? 'Link copied.' : 'Copy failed; select the link and copy it.', ok ? 'good' : 'bad'); });
    } }, 'Copy link');
    var copyMsg = el('button', { class: 'gn-btn gn-quiet', onclick: function () {
      GNC.copyText(text()).then(function (ok) { GNC.toast(ok ? 'Invitation copied. Paste it in a text or chat.' : 'Copy failed.', ok ? 'good' : 'bad'); });
    } }, 'Copy invitation');
    var parts = [
      el('p', { class: 'gn-help' }, 'The link opens this table. It never signs anyone in: people still need the group code and their own name.'),
      el('input', { type: 'text', readonly: true, value: t.link, 'aria-label': 'Table link', class: 'gn-linkbox', onfocus: function (e) { e.target.select(); } }),
      el('div', { class: 'gn-row gn-wrap' }, copyLink, copyMsg),
      el('label', { class: 'gn-check' }, withCode, ' Include the group code in copied invitations'),
    ];
    if (isHost()) {
      var others = app.lobby.members.filter(function (m) { return !t.seats.some(function (s) { return s.member_id === m.id; }); });
      var picks = others.map(function (m) { return { m: m, cb: el('input', { type: 'checkbox' }) }; });
      var emails = el('input', { id: 'inv-emails', type: 'text', placeholder: 'name@example.com, …', 'data-focus': 'inv-emails' });
      var codeMail = el('input', { type: 'checkbox' });
      var send = el('button', { class: 'gn-btn', onclick: function (e) {
        var spec = { members: picks.filter(function (p) { return p.cb.checked; }).map(function (p) { return p.m.id; }),
          emails: emails.value.split(/[\s,;]+/).filter(function (x) { return x; }), includeCode: codeMail.checked };
        if (!spec.members.length && !spec.emails.length) return GNC.toast('Pick someone or type an email address.', 'bad');
        tableAct('invite', [spec], e.currentTarget).then(function (r) {
          if (r.ok) { GNC.toast('Invitations sent.', 'good'); emails.value = ''; }
        });
      } }, 'Send invitations');
      parts.push(el('details', { class: 'gn-more' }, el('summary', null, 'Invite by email'),
        others.length ? el('fieldset', { class: 'gn-fieldset' }, el('legend', null, 'Group members'),
          picks.map(function (p) { return el('label', { class: 'gn-check' }, p.cb, ' ' + p.m.name); })) : null,
        el('label', { for: 'inv-emails' }, 'Other email addresses'), emails,
        el('label', { class: 'gn-check' }, codeMail, ' Include the group code in the email'),
        el('p', { class: 'gn-help' }, 'Members are emailed only if they saved an email address. Invited members can join invite-only tables.'),
        send));
    }
    return el('div', null, parts);
  }

  // ------------------------------------------------------------------ status and match

  function renderStatus() {
    var t = app.table, m = app.match;
    patch(T.status, function () {
      if (!m) return t.status === 'open' ? el('div', { class: 'gn-banner' }, t.startBlock || 'Ready to start.') : null;
      if (m.status === 'active') {
        var mine = m.actors.indexOf(app.lobby.me.id) >= 0;
        var names = m.players.filter(function (p) { return m.actors.indexOf(p.id) >= 0; }).map(function (p) { return p.name; });
        var line = m.spectator ? 'Watching. ' + (names.length ? 'Waiting for ' + names.join(' and ') + '.' : '')
          : mine ? (m.actors.length > 1 ? 'Your move (others can move too).' : 'Your turn.') : 'Waiting for ' + names.join(' and ') + '.';
        var end = m.spectator ? null : el('button', { class: 'gn-link', onclick: abandonMatch }, 'Abandon match');
        return el('div', { class: 'gn-banner' + (mine ? ' gn-banner-go' : '') }, el('span', { role: 'status' }, line), end);
      }
      var r = m.result || {};
      var winners = m.players.filter(function (p) { return (r.winners || []).indexOf(p.id) >= 0; }).map(function (p) { return p.name; });
      var head = m.status === 'abandoned' ? 'Game ended early.' : winners.length > 1 ? 'Tie: ' + winners.join(' and ') + '.'
        : winners.length ? winners[0] + ' wins!' : 'Draw.';
      return el('div', { class: 'gn-banner gn-banner-done' }, el('strong', { role: 'status' }, head),
        r.scores ? el('span', null, m.players.map(function (p) { return p.name + ' ' + (r.scores[p.id] !== undefined ? r.scores[p.id] : ''); }).join(' · ')) : null,
        el('button', { class: 'gn-btn gn-quiet', onclick: function () { GNC.replay.open(m.id); } }, 'Watch replay'),
        t.status === 'open' ? el('span', { class: 'gn-help' }, isHost() ? 'Play again: everyone taps "I\'m ready", then Start. Or change the game.' : 'Tap "I\'m ready" to play again.') : null);
    });
  }

  function abandonMatch() {
    var wordwright = app.match && app.match.game_id === 'wordwright';
    var detail = 'This stops the match without scoring a winner. The table stays open for another game.' +
      (wordwright ? ' To finish Wordwright normally, players can Pass until six scoreless turns; rack points are then deducted and a winner is declared.' : '');
    GNC.confirm('Abandon this match for everyone?', detail, 'Abandon match', 'Keep playing').then(function (yes) {
      if (!yes) return;
      var m = app.match;
      GNC.call('abandon', GNC.session.token(), m.id, GNC.req(m.rev)).then(function (res) {
        if (res.match) setMatch(res.match, 'mine');
        if (!res.ok) showError(res);
        GNC.poller.now();
      });
    });
  }

  function loadMatch(id) {
    GNC.call('match', GNC.session.token(), id).then(function (res) {
      if (res.ok && app.table && app.table.current_match_id === id) setMatch(res.match, 'initial');
    });
  }

  function destroyFrame() {
    if (app.frame) { try { app.frame.destroy(); } catch (e) { /* ignore */ } }
    app.frame = null;
  }

  /** Mount the game module once per match; later states go to update(), keeping drafts. */
  function setMatch(m, reason) {
    if (app.screen !== 'table' || !app.table || app.table.current_match_id !== m.id) return;
    var prev = app.match;
    if (prev && prev.id === m.id && m.rev < prev.rev) return;       // never go backwards
    app.match = m;
    if (!app.frame || app.frame.matchId !== m.id) {
      destroyFrame();
      clear(T.play);
      var mod = GNC.games[m.game_id];
      if (!mod) { T.play.appendChild(el('p', { class: 'gn-banner' }, 'This page has no board for ' + m.game_id + '. Reload to update.')); return renderStatus(); }
      var host = el('div', { class: 'gn-board-host', 'data-game': m.game_id });
      T.play.appendChild(host);
      var inst = mod.mount(host, frameApi(m));
      app.frame = { matchId: m.id, inst: inst, destroy: function () { if (inst && inst.destroy) inst.destroy(); } };
      inst.update(m, { reason: 'initial', previous: null });
    } else if (!prev || prev.rev !== m.rev || reason === 'stale') {
      app.frame.inst.update(m, { reason: reason, previous: prev });
      if (m.status === 'active' && prev && prev.actors.indexOf(app.lobby.me.id) < 0 && m.actors.indexOf(app.lobby.me.id) >= 0) {
        GNC.sound.play('turn');
        GNC.announce('Your turn.');
      }
      if (prev && prev.status === 'active' && m.status !== 'active') {
        var won = (m.result && m.result.winners || []).indexOf(app.lobby.me.id) >= 0;
        GNC.sound.play(won ? 'win' : 'score');
      }
    }
    renderStatus();
  }

  function frameApi(m) {
    var players = m.players.map(function (p, i) {
      var st = GNC.seatStyle(m.theme_id, i);
      return { id: p.id, name: p.name, seat: i, color: st.color, text: st.text, symbol: st.symbol };
    });
    return {
      me: app.lobby.me.id,
      players: players,
      player: function (id) { return players.filter(function (p) { return p.id === id; })[0] || null; },
      theme: GNC.themes[m.theme_id],
      sound: function (n) { GNC.sound.play(n); },
      announce: GNC.announce,
      toast: GNC.toast,
      confirm: GNC.confirm,
      el: GNC.el,
      /** Send an action. Resolves {ok, match, response, error, code}; the frame is updated first. */
      act: function (action) {
        var cur = app.match;
        return GNC.call('act', GNC.session.token(), cur.id, action, GNC.req(cur.rev)).then(function (res) {
          if (res.match) setMatch(res.match, res.ok ? 'mine' : 'stale');
          if (!res.ok) {
            if (res.code === 'STALE') GNC.toast(res.error, 'info');
            else { GNC.toast(res.error || 'That move is not allowed.', 'bad'); GNC.sound.play('bad'); }
          }
          GNC.poller.now();
          return res;
        });
      },
      query: function (q) { return GNC.call('query', GNC.session.token(), app.match.id, q); },
    };
  }

  // ------------------------------------------------------------------ polling glue

  GNC.poller.want = function () {
    if (app.screen === 'lobby') return { lobby: app.lobbyV, members: app.lobby.members.map(function (m) { return m.id; }) };
    if (app.screen === 'table' && app.table) {
      var w = { table: { id: app.table.id, rev: app.table.rev, seats: app.table.seats.map(function (s) { return s.member_id; }) } };
      if (app.match) w.match = { id: app.match.id, rev: app.match.rev, players: app.match.players.map(function (p) { return p.id; }) };
      return w;
    }
    return {};
  };

  GNC.poller.pace = function () {
    if (app.screen === 'table' && app.table) {
      var m = app.match;
      if (m && m.status === 'active') return m.actors.indexOf(app.lobby.me.id) >= 0 && m.actors.length === 1 ? 8000 : 2500;
      return 3000;
    }
    return 10000;
  };

  GNC.poller.onResult = function (res, want) {
    if (want && want.table && (!app.table || want.table.id !== app.table.id)) return;
    if (res.lobby && res.lobby.changed && app.screen === 'lobby') {
      app.lobby = res.lobby.lobby; app.lobbyV = res.lobby.v;
      renderLobbyParts();
    } else if (res.lobby) {
      app.lobbyV = res.lobby.v;
      if (res.lobby.here && app.screen === 'lobby' && res.lobby.here.join() !== app.lobby.here.join()) {
        app.lobby.here = res.lobby.here;
        renderLobbyParts();
      }
    }
    if (app.screen !== 'table' || !app.table) return;
    if (res.table) {
      if (res.table.changed && res.table.table) setTable(res.table.table);
      else if (res.table.here) {
        var changed = res.table.here.join() !== app.here.join();
        app.here = res.table.here;
        if (changed) renderTable();
      }
    }
    if (res.match && app.match) {
      if (res.match.changed && res.match.match) setMatch(res.match.match, 'poll');
      if (res.match.here) app.matchHere = res.match.here;
    }
  };

  // ------------------------------------------------------------------ start

  if (!GNC.boot.ready) {
    root.appendChild(el('main', { class: 'gn-center' }, el('div', { class: 'gn-card' },
      el('h1', null, GNC.boot.platform || 'Game Night'),
      el('p', null, 'This group is not set up yet.'),
      el('p', { class: 'gn-help' }, 'The owner opens the spreadsheet that holds this game and chooses Game Night › Set up this spreadsheet.'))));
    return;
  }
  GNC.applyTheme(Object.keys(GNC.themes)[0]);
  if (GNC.session.token()) enterLobby(); else showEntry(app.pendingLink ? 'Sign in to open the table you were invited to.' : '');
})();
