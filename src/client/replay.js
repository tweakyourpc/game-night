/*
 * Replays in the browser. A replay (format v1, docs/replay-format.md) is a list of
 * public events; the last event of each action carries the public position after it.
 * Playback hands those positions to the game's own board, so nothing is re-run and no
 * dice are re-rolled.
 *
 * Export, by feature detection:
 *   - always: download the replay file (.json)
 *   - if this browser can record a canvas (MediaRecorder + captureStream) and draw the
 *     board into one: record a video while the replay plays in this tab. The format is
 *     whatever the browser offers (usually WebM; MP4 only where supported). Recording
 *     happens here, in the open tab, never in the background.
 *   - admins: save either file to the group's Drive folder instead of downloading.
 */
GNC.replay = (function () {
  var el = GNC.el;

  function nameOf(rp, id) { var p = rp.players.filter(function (x) { return x.id === id; })[0]; return p ? p.name : 'Someone'; }
  var CATS = { ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes', threeKind: 'Three of a Kind',
    fourKind: 'Four of a Kind', fullHouse: 'Full House', smallStraight: 'Small Straight', largeStraight: 'Large Straight', fiveKind: 'Five of a Kind', chance: 'Chance' };
  var sq = function (rc) { return 'abcdefgh'[rc[1]] + (8 - rc[0]); };

  /** A sentence for one event. */
  function describe(rp, e) {
    var p = e.public || {}, who = nameOf(rp, p.player || e.actor);
    switch (e.type) {
      case 'start': return 'The game begins.';
      case 'end': {
        var w = (p.winners || []).map(function (id) { return nameOf(rp, id); });
        var adj = (p.adjustments || []).map(function (a) { return nameOf(rp, a.player) + ' ' + (a.points > 0 ? '+' : '') + a.points; });
        return (w.length > 1 ? 'Tie: ' + w.join(' and ') : w.length ? w[0] + ' wins' : 'Draw') + (p.reason ? ' (' + p.reason + ')' : '') + '.' +
          (adj.length ? ' Final adjustments: ' + adj.join(', ') + '.' : '');
      }
      case 'abandoned': return who + ' ended the game early.';
      case 'play': return who + ' played ' + (p.words || []).map(function (x) { return x.word; }).join(', ') + ' for ' + p.score + (p.bingo ? ', using all seven tiles' : '') + '.';
      case 'exchange': return who + ' swapped ' + p.count + ' tile' + (p.count === 1 ? '' : 's') + '.';
      case 'pass': return who + ' passed.';
      case 'drop': return who + ' dropped a disc in column ' + (p.col + 1) + '.';
      case 'line': return who + ' drew a line' + (p.boxes && p.boxes.length ? ' and closed ' + p.boxes.length + (p.boxes.length > 1 ? ' boxes' : ' box') + (p.again ? ', so goes again' : '') : '') + '.';
      case 'move': return who + ' moved ' + sq(p.from) + ' to ' + sq(p.to) + (p.captured ? ', capturing on ' + sq(p.captured.at) : '') + (p.crowned ? ', and was crowned' : '') + (p.continues ? '; keeps jumping' : '') + '.';
      case 'resign': return who + ' resigned.';
      case 'offer-draw': return who + ' offered a draw.';
      case 'accept-draw': return who + ' accepted the draw.';
      case 'decline-draw': return who + ' declined the draw.';
      case 'withdraw-draw': return who + ' withdrew the draw offer.';
      case 'roll': return who + ' rolled ' + (p.dice || []).join(' ') + (p.n ? ' (roll ' + p.n + ' of 3)' : '') + '.';
      case 'score': return who + ' scored ' + p.points + ' for ' + (CATS[p.category] || p.category) + '.';
      default: return who + ': ' + e.type + '.';
    }
  }

  /** One frame per revision: its events, caption and the position after it. */
  function frames(rp) {
    var out = [], cur = null;
    rp.events.forEach(function (e) {
      if (!cur || cur.rev !== e.rev) { cur = { rev: e.rev, events: [], snapshot: null, at: e.at }; out.push(cur); }
      cur.events.push(e);
      if (e.public && e.public.snapshot) cur.snapshot = e.public.snapshot;
    });
    var last = null;
    out.forEach(function (f) { if (!f.snapshot) f.snapshot = last; last = f.snapshot; f.caption = f.events.map(function (e) { return describe(rp, e); }).join(' '); });
    return out.filter(function (f) { return f.snapshot; });
  }

  // ------------------------------------------------------------------ export helpers

  function download(blob, name) {
    try {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
    return true;
    } catch (e) { GNC.toast('Download could not start. Check browser download permissions; admins can save to Drive.', 'bad'); return false; }
  }

  function videoType() {
    if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function' || !HTMLCanvasElement.prototype.captureStream) return null;
    try {
    var types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    return null;
    } catch (e) { return null; }
  }

  /** Draws a DOM subtree into an image via SVG foreignObject (inline styles, no network). */
  function rasterize(node) {
    var r = node.getBoundingClientRect();
    var w = Math.ceil(r.width), h = Math.ceil(r.height);
    var css = Array.prototype.map.call(document.querySelectorAll('style'), function (s) { return s.textContent; }).join('\n') +
      '\n*{animation:none!important;transition:none!important}';
    var root = document.documentElement;
    var defs = Array.prototype.map.call(document.querySelectorAll('svg[width="0"]'), function (s) { return new XMLSerializer().serializeToString(s); }).join('');
    var body = getComputedStyle(document.body);
    var html = '<div xmlns="http://www.w3.org/1999/xhtml" data-theme="' + (root.getAttribute('data-theme') || '') + '" style="' +
      GNC.esc((root.getAttribute('style') || '') + ';width:' + w + 'px;height:' + h + 'px;font-family:' + body.fontFamily + ';color:' + body.color + ';font-size:' + body.fontSize) + '">' +
      '<style>' + css.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</style>' + defs + new XMLSerializer().serializeToString(node.cloneNode(true)) + '</div>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject width="100%" height="100%">' + html + '</foreignObject></svg>';
    var img = new Image();
    img.width = w; img.height = h;
    return new Promise(function (resolve, reject) {
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('This browser could not draw the board for a video.')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  /** Can this browser draw the board into a canvas without locking it (tainting)? */
  function canDraw(node) {
    return rasterize(node).then(function (img) {
      var c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      ctx.getImageData(0, 0, 1, 1);
      return true;
    }).catch(function () { return false; });
  }

  function base64Of(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  /** Admins: upload a recorded video to Drive in pieces (Drive files, not CacheService). */
  function saveVideoToDrive(blob, name, mime, status, cancelled) {
    var PIECE = 1800000, n = Math.ceil(blob.size / PIECE), id = GNC.newActionId().slice(0, 20);
    if (n > 12) return Promise.resolve({ ok: false, error: 'The video is too large to save to Drive (about 21 MB at most). Download it instead.' });
    var i = 0, token = GNC.session.token();
    function next() {
      if (cancelled && cancelled()) return Promise.resolve({ ok: false, error: 'Upload cancelled.' });
      if (i >= n) return GNC.call('uploadFinish', token, id, n, mime, name);
      status('Saving to Drive: part ' + (i + 1) + ' of ' + n + '…');
      return base64Of(blob.slice(i * PIECE, (i + 1) * PIECE)).then(function (b64) {
        return GNC.call('uploadChunk', token, id, i, b64);
      }).then(function (r) { if (!r.ok) return r; i++; return next(); });
    }
    return next().catch(function () { return { ok: false, error: 'Drive upload failed. Download the replay file or video instead.' }; }).then(function (r) {
      if (r.ok) return r;
      return GNC.call('uploadCancel', token, id).then(function (cleanup) {
        if (!cleanup.ok) r.error += ' Temporary pieces will be retried by maintenance after 24 hours.';
        return r;
      });
    });
  }

  // ------------------------------------------------------------------ the player

  function open(matchId) {
    GNC.call('replay', GNC.session.token(), matchId).then(function (res) {
      if (!res.ok) return GNC.toast(res.error || 'That replay could not be loaded.', 'bad');
      show(res.replay);
    });
  }

  function show(rp) {
    var fr = frames(rp);
    if (!fr.length) return GNC.toast('This game has no moves to replay yet.', 'info');
    var mod = GNC.games[rp.game.id];
    if (!mod) return GNC.toast('This page cannot show ' + rp.game.name + ' replays. Reload to update.', 'bad');
    var prevTheme = document.documentElement.getAttribute('data-theme');
    GNC.applyTheme(rp.theme.id);
    var i = 0, timer = null, speed = 1, recording = false, inst = null, prevMatch = null, closed = false, cancelRecording = null;
    var players = rp.players.map(function (p, k) { var st = GNC.seatStyle(rp.theme.id, k); return { id: p.id, name: p.name, seat: k, color: st.color, text: st.text, symbol: st.symbol }; });
    var api = {
      me: null, players: players, theme: GNC.themes[rp.theme.id],
      player: function (id) { return players.filter(function (p) { return p.id === id; })[0] || null; },
      sound: function (n) { if (!recording) GNC.sound.play(n); }, announce: function () {}, toast: GNC.toast, confirm: GNC.confirm, el: el,
      act: function () { return Promise.resolve({ ok: false, error: 'This is a replay.' }); },
      query: function () { return Promise.resolve({ ok: false }); },
    };
    var stage = el('div', { class: 'gn-replay-stage' });
    var caption = el('p', { class: 'gn-replay-caption', 'aria-live': 'polite' });
    var slider = el('input', { type: 'range', min: '0', max: String(fr.length - 1), value: '0', 'aria-label': 'Position in the replay' });
    var counter = el('span', { class: 'gn-help' });
    var playBtn = el('button', { class: 'gn-btn', onclick: function () { timer ? pause() : play(); } }, 'Play');
    var status = el('p', { class: 'gn-help', role: 'status' });
    var speedSel = el('select', { 'aria-label': 'Speed', onchange: function () { speed = Number(speedSel.value); if (timer) { pause(); play(); } } },
      [['0.5', 'Slow'], ['1', 'Normal'], ['2', 'Fast'], ['4', 'Very fast']].map(function (o) { return el('option', { value: o[0], selected: o[0] === '1' }, o[1]); }));
    var exportRow = el('div', { class: 'gn-row gn-wrap' });
    var title = rp.game.name + (rp.match.tableTitle ? ' at ' + rp.match.tableTitle : '') + ', ' + GNC.when(rp.match.started);
    var wrap = el('div', { class: 'gn-replay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Replay: ' + title },
      el('div', { class: 'gn-replay-head' }, el('h2', null, 'Replay: ' + title),
        el('button', { class: 'gn-btn gn-quiet', onclick: close }, 'Close')),
      el('p', { class: 'gn-help' }, rp.players.map(function (p) { return p.name; }).join(', ') + ' · rules version ' + rp.game.rulesVersion),
      stage, caption,
      el('div', { class: 'gn-row gn-wrap gn-replay-controls' },
        el('button', { class: 'gn-btn gn-quiet', 'aria-label': 'First move', onclick: function () { pause(); go(0); } }, '⏮'),
        el('button', { class: 'gn-btn gn-quiet', 'aria-label': 'Previous move', onclick: function () { pause(); go(i - 1); } }, '◀'),
        playBtn,
        el('button', { class: 'gn-btn gn-quiet', 'aria-label': 'Next move', onclick: function () { pause(); go(i + 1); } }, '▶'),
        el('button', { class: 'gn-btn gn-quiet', 'aria-label': 'Last move', onclick: function () { pause(); go(fr.length - 1); } }, '⏭'),
        speedSel, counter),
      slider, exportRow, status);
    slider.addEventListener('input', function () { pause(); go(Number(slider.value)); });
    var onKey = function (e) { if (e.key === 'Escape' && !recording) close(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    var host = el('div', { class: 'gn-board-host' });
    stage.appendChild(host);
    inst = mod.mount(host, api);

    function matchAt(k) {
      var last = k === fr.length - 1 && rp.final;
      return { id: 'replay-' + rp.match.id, table_id: rp.match.table, game_id: rp.game.id, players: rp.players, actors: [],
        status: last ? rp.final.status : 'active', result: last ? rp.final : null, rev: fr[k].rev, view: fr[k].snapshot,
        options: rp.options, theme_id: rp.theme.id, spectator: true, me: null };
    }
    function go(k) {
      k = Math.max(0, Math.min(fr.length - 1, k));
      var m = matchAt(k);
      inst.update(m, { reason: 'replay', previous: prevMatch });
      prevMatch = m;
      i = k;
      slider.value = String(k);
      counter.textContent = (k + 1) + ' / ' + fr.length;
      caption.textContent = fr[k].caption;
    }
    function play() {
      if (i >= fr.length - 1) go(0);
      playBtn.textContent = 'Pause';
      timer = setInterval(function () { if (i >= fr.length - 1) return pause(); go(i + 1); }, 1500 / speed);
    }
    function pause() { clearInterval(timer); timer = null; playBtn.textContent = 'Play'; }
    function close() {
      closed = true;
      if (cancelRecording) cancelRecording('Recording cancelled.');
      pause();
      document.removeEventListener('keydown', onKey);
      if (inst && inst.destroy) inst.destroy();
      wrap.remove();
      if (prevTheme) GNC.applyTheme(prevTheme);
    }
    var fileBase = (rp.game.name + ' ' + new Date(rp.match.started).toISOString().slice(0, 10)).replace(/[^A-Za-z0-9 _-]/g, '');

    // exports, by what this browser and this person can do
    exportRow.appendChild(el('button', { class: 'gn-btn gn-quiet', onclick: function () {
      download(new Blob([JSON.stringify(rp, null, 1)], { type: 'application/json' }), fileBase + '.json');
    } }, 'Download replay file'));
    var isAdmin = GNC.app && GNC.app.lobby && GNC.app.lobby.me.role === 'admin';
    if (isAdmin) {
      exportRow.appendChild(el('button', { class: 'gn-btn gn-quiet', onclick: function (e) {
        var b = e.currentTarget; b.disabled = true;
        GNC.call('saveReplay', GNC.session.token(), rp.match.id).then(function (r) {
          b.disabled = false;
          status.textContent = r.ok ? 'Saved to the group\'s Drive folder as ' + r.name + '.' : r.error;
        });
      } }, 'Save replay file to Drive'));
    }
    var mime = videoType();
    if (mime) {
      canDraw(host).then(function (yes) {
        if (closed) return;
        if (!yes) { status.textContent = 'Video recording is not available in this browser; the replay file still works.'; return; }
        exportRow.appendChild(el('button', { class: 'gn-btn', onclick: function (e) { record(e.currentTarget); } }, 'Record video'));
      });
    } else {
      status.textContent = 'This browser cannot record video; download the replay file instead.';
    }

    function record(btn) {
      pause();
      recording = true;
      btn.disabled = true;
      var W = 1280, H = 720;
      var canvas = el('canvas', { width: String(W), height: String(H) });
      var ctx = canvas.getContext('2d');
      var stream = null, rec = null, failed = false;
      function release() {
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        document.removeEventListener('visibilitychange', visibility);
        recording = false; btn.disabled = false; cancelRecording = null;
      }
      function fail(message) {
        failed = true;
        try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* release below */ }
        release();
        status.textContent = message + ' The replay file still works.';
      }
      function visibility() { if (document.hidden) fail('Recording stopped because the tab was hidden.'); }
      cancelRecording = fail;
      try {
        if (document.hidden || !ctx) throw new Error('Keep this tab visible while recording.');
        stream = canvas.captureStream(15);
        if (!stream.getVideoTracks().length) throw new Error('Canvas capture is unavailable.');
        rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3000000 });
      } catch (e) { fail('Recording unavailable: ' + e.message); return; }
      rec.onerror = function () { fail('The browser video encoder failed.'); };
      document.addEventListener('visibilitychange', visibility);
      var chunks = [];
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--gn-table').trim() || '#222';
      var ink = getComputedStyle(document.documentElement).getPropertyValue('--gn-table-text').trim() || '#fff';
      function paint(img, text) {
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        var s = Math.min((W - 80) / img.width, (H - 150) / img.height);
        ctx.drawImage(img, (W - img.width * s) / 2, 70, img.width * s, img.height * s);
        ctx.fillStyle = ink; ctx.textAlign = 'center';
        ctx.font = '600 30px ' + getComputedStyle(document.body).fontFamily;
        ctx.fillText(title, W / 2, 46);
        ctx.font = '24px ' + getComputedStyle(document.body).fontFamily;
        ctx.fillText(text.length > 110 ? text.slice(0, 107) + '…' : text, W / 2, H - 30);
      }
      var k = 0, hold = Math.max(600, 1500 / speed);
      try { rec.start(1000); } catch (e) { fail('Recording unavailable: ' + e.message); return; }
      status.textContent = 'Recording… keep this tab open and visible.';
      function step() {
        if (failed || closed) return Promise.resolve();
        if (k >= fr.length) {
          return GNC.later(2500).then(function () { if (!failed && rec.state !== 'inactive') rec.stop(); });
        }
        go(k);
        status.textContent = 'Recording move ' + (k + 1) + ' of ' + fr.length + '… keep this tab open.';
        return GNC.later(80).then(function () { return rasterize(host); }).then(function (img) {
          if (failed || closed) return;
          paint(img, fr[k].caption);
          k++;
          return GNC.later(hold).then(step);
        });
      }
      rec.onstop = function () {
        release();
        if (failed || closed) return;
        var type = mime.split(';')[0];
        var blob = new Blob(chunks, { type: type });
        if (!blob.size) { fail('The encoder produced no video.'); return; }
        var name = fileBase + (type === 'video/mp4' ? '.mp4' : '.webm');
        status.textContent = 'Video ready (' + Math.round(blob.size / 1024) + ' KB, ' + type + ').';
        exportRow.appendChild(el('button', { class: 'gn-btn', onclick: function () { download(blob, name); } }, 'Download video'));
        if (isAdmin) {
          exportRow.appendChild(el('button', { class: 'gn-btn gn-quiet', onclick: function (e) {
            var b = e.currentTarget; b.disabled = true;
            saveVideoToDrive(blob, name, type, function (t) { status.textContent = t; }, function () { return closed; }).then(function (r) {
              b.disabled = false;
              status.textContent = r.ok ? 'Saved to the group\'s Drive folder as ' + r.name + '.' : r.error;
            });
          } }, 'Save video to Drive'));
        }
      };
      step().catch(function (err) {
        fail('Recording stopped: ' + (err && err.message || err));
      });
    }

    go(0);
    playBtn.focus();
  }

  return { open: open, frames: frames, describe: describe };
})();
