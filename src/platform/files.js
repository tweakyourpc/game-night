/**
 * Saving replays to the installation's Drive folder (the owner's Drive). Admins only:
 * everyone else downloads files in their browser.
 *
 *   saveReplay(matchId)                      the replay file (JSON, format v1)
 *   uploadChunk(uploadId, index, base64)     one piece of a recorded video
 *   uploadFinish(uploadId, count, mime, name) joins the pieces into one file
 *
 * Video pieces are kept as temporary Drive files, never in CacheService, and removed
 * once joined. Nothing here holds the script lock.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.files = (function () {
  var MAX_CHUNK = 2600000;          // base64 characters per call (under the request cap)
  var MAX_CHUNKS = 12;              // about 23 MB of video
  var TYPES = { 'video/webm': 'webm', 'video/mp4': 'mp4' };

  function cleanName(s, ext) {
    var n = String(s || 'replay').replace(/[^A-Za-z0-9 ._-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'replay';
    return n.replace(/\.[A-Za-z0-9]+$/, '') + '.' + ext;
  }
  function partName(id, i) { return id + '.' + i + '.part'; }

  // Metadata is durable, scoped to installation AND device session. Drive work stays
  // outside the script lock. A short lease prevents concurrent chunk/finish writes.
  function scope(token, id) {
    GN.identity.requireAdmin(GN.identity.auth(token));
    if (!GN.util.isId(id, 40)) GN.fail('That upload is not valid.', 'BAD_REQUEST');
    return GN.deps.hash(GN.deps.store.setting('install_id') + ':' + token + ':' + id).slice(0, 40);
  }
  function read(key) { var s = GN.deps.store.setting('upload:' + key); return s ? JSON.parse(s) : null; }
  function write(key, v) { GN.deps.store.setSetting('upload:' + key, JSON.stringify(v)); }
  function clean(key) {
    var failed = false;
    for (var i = 0; i < MAX_CHUNKS; i++) {
      try { var id = GN.deps.drive.find('uploads', partName(key, i)); if (id) GN.deps.drive.remove(id); }
      catch (e) { failed = true; }
    }
    return !failed;
  }
  function work(key, fn) {
    var lease = GN.deps.newId(12);
    var meta = GN.deps.withLock(function () {
      GN.deps.store.refresh();
      var m = read(key) || { at: GN.deps.now(), status: 'open' };
      if (m.lease && GN.deps.now() - m.at < 120000) GN.fail('Upload busy. Try again.', 'BUSY');
      m.lease = lease; m.at = GN.deps.now(); write(key, m); return m;
    });
    try { return fn(meta); }
    finally {
      GN.deps.withLock(function () {
        GN.deps.store.refresh();
        var current = read(key);
        if (current && current.lease === lease) { delete meta.lease; write(key, meta); }
      });
    }
  }

  return {
    cleanup: function () {
      GN.deps.store.list('Settings').filter(function (r) { return r.key.indexOf('upload:') === 0; }).slice(0, 30).forEach(function (r) {
        var m = JSON.parse(r.value), key = r.key.slice(7);
        if (GN.deps.now() - m.at > 86400000 && clean(key)) GN.deps.store.remove('Settings', r.key);
      });
    },
    uploadCancel: function (token, uploadId) {
      var key = scope(token, uploadId);
      return work(key, function (m) { if (m.status !== 'done') m.status = 'cancelled'; return { ok: clean(key) }; });
    },
    saveReplay: function (token, matchId) {
      GN.identity.requireAdmin(GN.identity.auth(token));
      var rp = GN.replay.build(token, matchId).replay;
      var name = cleanName(rp.game.name + ' ' + rp.match.id, 'json');
      var f = GN.deps.drive.saveText('replays', name, JSON.stringify(rp, null, 1));
      return { ok: true, url: f.url, name: name };
    },

    uploadChunk: function (token, uploadId, index, data) {
      var key = scope(token, uploadId);
      if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) GN.fail('That upload is not valid.', 'BAD_REQUEST');
      if (typeof data !== 'string' || !data.length || data.length > MAX_CHUNK || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) GN.fail('That piece of the video is not valid.', 'BAD_REQUEST');
      return work(key, function (m) {
        if (m.status !== 'open') GN.fail('That upload is closed.', 'BAD_REQUEST');
        try { GN.deps.drive.saveBytes('uploads', partName(key, index), 'application/octet-stream', data); }
        catch (e) { m.status = 'failed'; clean(key); throw e; }
        return { ok: true, index: index };
      });
    },

    uploadFinish: function (token, uploadId, count, mime, name) {
      var key = scope(token, uploadId);
      if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) GN.fail('That upload is not valid.', 'BAD_REQUEST');
      var ext = TYPES[String(mime).split(';')[0]];
      if (!ext) GN.fail('Only WebM or MP4 video can be saved.', 'BAD_REQUEST');
      return work(key, function (m) {
        if (m.status === 'done') { clean(key); return m.result; }
        if (m.status !== 'open') GN.fail('That upload is closed.', 'BAD_REQUEST');
        var drive = GN.deps.drive, parts = [], filename = cleanName(name, ext);
        // Unique deterministic output name recovers a lost completion response.
        var storedName = key + '-' + filename;
        for (var i = 0; i < count; i++) {
          var id = drive.find('uploads', partName(key, i));
          if (!id) {
            m.status = 'failed';
            if (clean(key)) write(key, m);
            GN.fail('Part ' + (i + 1) + ' of the video is missing. Try saving again.', 'MISSING');
          }
          parts.push(id);
        }
        try {
          var existing = drive.find('replays', storedName);
          var file = existing ? { url: 'https://drive.google.com/file/d/' + existing + '/view' } : drive.joinBytes('replays', storedName, String(mime).split(';')[0], parts);
          m.result = { ok: true, url: file.url, name: filename }; m.status = 'done';
          // Persist completion before cleanup; retries return the same result.
          write(key, m); clean(key);
          return m.result;
        } catch (e) { m.status = 'failed'; clean(key); throw e; }
      });
    },

    MAX_CHUNK: MAX_CHUNK,
    MAX_CHUNKS: MAX_CHUNKS,
  };
})();
