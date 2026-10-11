/*
 * Game Night browser core: server calls, polling, themes, sound, small DOM helpers.
 * Plain browser JavaScript with no build step or framework. The same file runs inside
 * the Apps Script page and under tools/dev_server.js.
 */
var GNC = window.GNC || {};
window.GNC = GNC;

GNC.boot = window.GN_BOOT || { ready: false };
GNC.games = GNC.games || {};          // game id -> browser module (src/games/<id>/ui.js)

// ------------------------------------------------------------------ helpers

GNC.el = function (tag, attrs) {
  var e = document.createElement(tag);
  var kids = Array.prototype.slice.call(arguments, 2);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    });
  }
  kids.forEach(function add(c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  });
  return e;
};

GNC.esc = function (s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
};

GNC.clear = function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; };

GNC.newActionId = function () {
  var a = new Uint8Array(12);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
};

GNC.store = {
  get: function (k) { try { return window.localStorage.getItem('gn.' + k); } catch (e) { return null; } },
  set: function (k, v) { try { window.localStorage.setItem('gn.' + k, v); } catch (e) { /* private mode */ } },
  del: function (k) { try { window.localStorage.removeItem('gn.' + k); } catch (e) { /* ignore */ } },
};

GNC.when = function (ms) {
  if (!ms) return '';
  var d = new Date(ms), now = new Date();
  var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'today ' + time;
  var y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return 'yesterday ' + time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
};

/** Spoken updates for screen readers (polite) without moving focus. */
GNC.announce = function (text) {
  var live = document.getElementById('gn-live');
  if (!live) return;
  live.textContent = '';
  setTimeout(function () { live.textContent = text; }, 30);
};

/** A brief message at the bottom of the screen. kind: info | good | bad */
GNC.toast = function (text, kind) {
  var box = document.getElementById('gn-toasts');
  if (!box || !text) return;
  var t = GNC.el('div', { class: 'gn-toast gn-toast-' + (kind || 'info'), role: kind === 'bad' ? 'alert' : 'status' }, text);
  box.appendChild(t);
  setTimeout(function () { t.classList.add('gn-toast-out'); }, 3800);
  setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4300);
};

/**
 * An in-page dialog (never window.confirm, which blocks the page and some browsers
 * suppress inside the Apps Script frame). Resolves true/false.
 */
GNC.confirm = function (title, body, okLabel, cancelLabel) {
  return new Promise(function (resolve) {
    var prev = document.activeElement;
    var done = function (v) {
      document.removeEventListener('keydown', onKey, true);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      if (prev && prev.focus) prev.focus();
      resolve(v);
    };
    var onKey = function (e) { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    var ok = GNC.el('button', { class: 'gn-btn', onclick: function () { done(true); } }, okLabel || 'OK');
    var wrap = GNC.el('div', { class: 'gn-modal-wrap' },
      GNC.el('div', { class: 'gn-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gn-modal-title' },
        GNC.el('h2', { id: 'gn-modal-title' }, title),
        body ? GNC.el('p', null, body) : null,
        GNC.el('div', { class: 'gn-row gn-end' },
          GNC.el('button', { class: 'gn-btn gn-quiet', onclick: function () { done(false); } }, cancelLabel || 'Cancel'), ok)));
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey, true);
    ok.focus();
  });
};

GNC.copyText = function (text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
  }
  return Promise.resolve(fallback());
  function fallback() {
    var ta = GNC.el('textarea', { style: { position: 'fixed', top: '-1000px' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
};

// ------------------------------------------------------------------ server calls

GNC.metrics = {
  calls: [],
  record: function (method, ms, ok, tries) {
    this.calls.push({ method: method, ms: Math.round(ms), ok: ok, tries: tries, at: Date.now() });
    if (this.calls.length > 200) this.calls.shift();
    if (GNC.boot.debug) GNC.metrics.render();
  },
  summary: function () {
    var by = {};
    this.calls.forEach(function (c) { (by[c.method] = by[c.method] || []).push(c.ms); });
    return Object.keys(by).sort().map(function (m) {
      var a = by[m].slice().sort(function (x, y) { return x - y; });
      var pct = function (p) { return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
      return { method: m, n: a.length, p50: pct(0.5), p95: pct(0.95), max: a[a.length - 1] };
    });
  },
  render: function () {
    var box = document.getElementById('gn-debug');
    if (!box) {
      box = GNC.el('pre', { id: 'gn-debug', class: 'gn-debug', 'aria-hidden': 'true' });
      document.body.appendChild(box);
    }
    var rows = this.summary().map(function (s) {
      return (s.method + '          ').slice(0, 12) + ' n=' + s.n + ' p50=' + s.p50 + ' p95=' + s.p95 + ' max=' + s.max;
    });
    box.textContent = 'response times (ms)\n' + rows.join('\n') + '\npoll every ' + (GNC.poller.lastDelay / 1000) + 's';
  },
};

GNC.transport = function (method, args) {
  return new Promise(function (resolve, reject) {
    if (window.google && google.script && google.script.run) {
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).call(method, args);
    } else {
      fetch('rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: method, args: args }) })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(resolve, reject);
    }
  });
};

/**
 * Call the server. Network failures and BUSY answers are retried with the SAME
 * arguments (and so the same actionId), which the server treats as one action.
 */
GNC.call = function (method) {
  var args = Array.prototype.slice.call(arguments, 1);
  var t0 = performance.now(), tries = 0;
  var waits = [700, 1800, 4000];
  function attempt() {
    tries++;
    return GNC.transport(method, args).then(function (res) {
      if (res && res.code === 'BUSY' && tries <= waits.length) return later(waits[tries - 1]).then(attempt);
      return res;
    }, function (err) {
      if (tries <= waits.length) return later(waits[tries - 1]).then(attempt);
      return { ok: false, code: 'NETWORK', error: "Can't reach the game server. Check your connection.", detail: String(err && err.message || err) };
    });
  }
  return attempt().then(function (res) {
    res = res || { ok: false, code: 'SERVER', error: 'No answer from the server.' };
    GNC.metrics.record(method, performance.now() - t0, !!res.ok, tries);
    if (res.code === 'AUTH' && args[0] === GNC.session.token()) GNC.onSignedOut && GNC.onSignedOut(res.error);
    return res;
  });
};

function later(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
GNC.later = later;

/** A request object for a revisioned change. */
GNC.req = function (rev) { return { expectedRevision: rev, actionId: GNC.newActionId() }; };

// ------------------------------------------------------------------ polling

/**
 * One poll at a time, never overlapping. The delay adapts:
 *   someone else's turn, or a table filling up   ~2.5 s
 *   my turn (only my own actions change things)   ~8 s
 *   lobby only                                    ~10 s
 *   page hidden, or no input for 5 minutes        30 to 60 s
 * Focus, visibility, coming back online, or any click polls right away.
 */
GNC.poller = {
  generation: 0,
  invalidate: function () { this.generation++; },
  timer: null, inFlight: false, again: false, stopped: true, lastDelay: 0, lastInput: Date.now(),
  want: function () { return {}; },        // set by the shell
  onResult: function () {},
  delay: function () {
    var base = GNC.poller.pace ? GNC.poller.pace() : 10000;
    var idle = Date.now() - this.lastInput > 5 * 60000;
    if (document.hidden) return Math.max(base, 30000);
    if (idle) return Math.max(base * 3, 30000);
    return base;
  },
  start: function () { this.stopped = false; this.kick(0); },
  stop: function () { this.invalidate(); this.stopped = true; clearTimeout(this.timer); },
  kick: function (ms) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    var self = this;
    this.timer = setTimeout(function () { self.tick(); }, ms === undefined ? this.delay() : ms);
  },
  now: function () { if (this.inFlight) this.again = true; else this.kick(0); },
  tick: function () {
    var self = this;
    if (this.stopped) return;
    if (this.inFlight) { this.again = true; return; }
    var token = GNC.session.token();
    if (!token) return;
    this.inFlight = true;
    var want = this.want(), generation = this.generation;
    GNC.call('sync', token, want).then(function (res) {
      self.inFlight = false;
      if (!self.stopped && generation === self.generation && token === GNC.session.token() && res && res.ok) self.onResult(res, want);
      self.lastDelay = self.again ? 0 : self.delay();
      self.again = false;
      self.kick(self.lastDelay);
    });
  },
};

['pointerdown', 'keydown'].forEach(function (ev) {
  document.addEventListener(ev, function () {
    var wasIdle = Date.now() - GNC.poller.lastInput > 5 * 60000;
    GNC.poller.lastInput = Date.now();
    if (wasIdle) GNC.poller.now();
  }, true);
});
document.addEventListener('visibilitychange', function () { if (!document.hidden) GNC.poller.now(); });
window.addEventListener('focus', function () { GNC.poller.now(); });
window.addEventListener('online', function () { GNC.poller.now(); });

// ------------------------------------------------------------------ session

GNC.session = {
  token: function () { return GNC.store.get('token') || ''; },
  set: function (t) { GNC.store.set('token', t); },
  clear: function () { GNC.store.del('token'); },
};

// ------------------------------------------------------------------ themes

GNC.themes = window.GN_THEMES || {};

/** Theme tokens -> CSS custom properties on an element (the page, or one preview). */
GNC.applyTheme = function (id, target) {
  var t = GNC.themes[id] || GNC.themes[Object.keys(GNC.themes)[0]];
  if (!t) return null;
  var s = (target || document.documentElement).style;
  var set = function (k, v) { if (v !== undefined && v !== null) s.setProperty('--gn-' + k, v); };
  Object.keys(t.colors).forEach(function (k) {
    if (Array.isArray(t.colors[k])) t.colors[k].forEach(function (c, i) { set((k === 'players' ? 'p' : 'pt') + i, c); });
    else set(k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }), t.colors[k]);
  });
  set('font-display', t.typography.display);
  set('font-body', t.typography.body);
  set('font-ui', t.typography.ui);
  set('font-numbers', t.typography.numbers);
  set('tex-table', t.textures.table);
  set('tex-surface', t.textures.surface);
  set('tex-board', t.textures.board);
  set('tex-piece', t.textures.piece);
  set('radius', t.borders.radius);
  set('radius-sm', t.borders.small);
  set('border', t.borders.width);
  set('frame', t.borders.frame);
  set('shadow', t.borders.shadow);
  set('btn-radius', t.controls.buttonRadius);
  set('btn-shadow', t.controls.buttonShadow);
  set('btn-face', t.controls.buttonFace);
  set('btn-quiet', t.controls.buttonQuiet);
  if (!target) {
    document.documentElement.setAttribute('data-theme', t.id);
    GNC.sound.palette = t.sounds && t.sounds.palette || 'wood';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.colors.table);
  }
  return t;
};

/** Seat i's color, text color and symbol in the current theme: color is never the only cue. */
GNC.seatStyle = function (themeId, i) {
  var t = GNC.themes[themeId] || GNC.themes[Object.keys(GNC.themes)[0]];
  var n = t.colors.players.length;
  return { color: t.colors.players[i % n], text: t.colors.playerText[i % n], symbol: t.symbols[i % t.symbols.length] };
};

// ------------------------------------------------------------------ sound

/**
 * Small synthesized effects (no audio files). Off until the first click or key press,
 * as browsers require; mute and volume persist per device.
 */
GNC.sound = {
  ctx: null, palette: 'wood',
  muted: function () { return GNC.store.get('mute') === '1'; },
  volume: function () { var v = Number(GNC.store.get('volume')); return isFinite(v) && GNC.store.get('volume') !== null ? Math.max(0, Math.min(1, v)) : 0.6; },
  setMuted: function (m) { GNC.store.set('mute', m ? '1' : '0'); },
  setVolume: function (v) { GNC.store.set('volume', String(Math.max(0, Math.min(1, v)))); },
  unlock: function () {
    if (this.ctx || !(window.AudioContext || window.webkitAudioContext)) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
  },
  play: function (name) {
    if (this.muted() || !this.ctx) return;
    var c = this.ctx, v = this.volume() * 0.5;
    if (c.state === 'suspended') c.resume();
    var t = c.currentTime;
    var wood = this.palette !== 'chime';
    var tone = function (freq, start, dur, type, gain) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || (wood ? 'triangle' : 'sine');
      o.frequency.setValueAtTime(freq, t + start);
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * (gain || 1)), t + start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t + start); o.stop(t + start + dur + 0.02);
    };
    var knock = function (start, pitch, gain) {
      var len = Math.floor(c.sampleRate * 0.06), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      var src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = pitch || 900; f.Q.value = 2.5;
      g.gain.value = v * (gain || 1.6);
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start(t + start);
    };
    var sounds = {
      click: function () { wood ? knock(0, 1400, 0.8) : tone(1320, 0, 0.06, 'sine', 0.4); },
      place: function () { wood ? knock(0, 700) : tone(880, 0, 0.12, 'sine', 0.6); },
      drop: function () { wood ? (knock(0, 500, 1.8), knock(0.07, 650, 0.7)) : (tone(660, 0, 0.1), tone(990, 0.05, 0.15, 'sine', 0.5)); },
      line: function () { wood ? knock(0, 1100, 0.9) : tone(1180, 0, 0.08, 'sine', 0.45); },
      capture: function () { wood ? (knock(0, 800), knock(0.09, 600)) : (tone(740, 0, 0.1), tone(554, 0.08, 0.14)); },
      roll: function () { for (var i = 0; i < 6; i++) wood ? knock(i * 0.045, 900 + Math.random() * 900, 0.9) : tone(1500 + Math.random() * 900, i * 0.04, 0.04, 'sine', 0.25); },
      score: function () { tone(523, 0, 0.12); tone(784, 0.09, 0.18); },
      turn: function () { tone(660, 0, 0.15, 'sine', 0.5); tone(880, 0.12, 0.22, 'sine', 0.45); },
      win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.11, 0.35, null, 0.7); }); },
      bad: function () { tone(220, 0, 0.18, 'square', 0.25); },
    };
    try { (sounds[name] || sounds.click)(); } catch (e) { /* sound is optional */ }
  },
};
['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { GNC.sound.unlock(); }, { once: false, capture: true }); });
