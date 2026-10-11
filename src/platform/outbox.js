/**
 * Email outbox (from Crabbles). Emails are queued under the lock with an idempotent
 * key, sent after the lock is released, and retried with backoff (5, 10, 20 ... min,
 * at most a day apart, 12 attempts) so a Gmail daily quota recovers on its own.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.outbox = (function () {
  var MAX_ATTEMPTS = 12;
  function backoff(n) { return n ? Math.min(24 * 3600000, 5 * 60000 * Math.pow(2, n - 1)) : 0; }
  function store() { return GN.deps.store; }

  return {
    /** Queue once per key; returns false when that key was already queued. */
    queue: function (key, to, subject, html) {
      if (!to) return false;
      return store().insert('Outbox', {
        key: key, to: to, subject: subject, html: html, status: 'pending', attempts: 0,
        created: GN.deps.now(), claimed_at: 0, sent_at: '', last_error: '',
      });
    },

    /** Send what's due. Claim under the lock, send without it, record under it. */
    flush: function (limit) {
      var now = GN.deps.now();
      var items = GN.deps.withLock(function () {
        store().refresh();
        var due = store().list('Outbox').filter(function (o) {
          var waited = now - (o.claimed_at || 0) >= backoff(o.attempts || 0);
          var stuck = o.status === 'sending' && now - (o.claimed_at || 0) > 10 * 60000;
          return ((o.status === 'pending' && waited) || stuck) && (o.attempts || 0) < MAX_ATTEMPTS;
        }).slice(0, limit || 10);
        due.forEach(function (o) {
          o.status = 'sending'; o.claimed_at = now; o.attempts = (o.attempts || 0) + 1;
          store().put('Outbox', o);
        });
        return due;
      });
      var results = items.map(function (o) {
        try {
          GN.deps.mail(o.to, o.subject, o.html);
          return { key: o.key, ok: true };
        } catch (e) {
          return { key: o.key, ok: false, error: String(e && e.message || e).slice(0, 300) };
        }
      });
      if (results.length) {
        GN.deps.withLock(function () {
          store().refresh();
          results.forEach(function (r) {
            var o = store().get('Outbox', r.key);
            if (!o) return;
            if (r.ok) { o.status = 'sent'; o.sent_at = new Date(GN.deps.now()).toISOString(); }
            else { o.status = (o.attempts || 0) >= MAX_ATTEMPTS ? 'failed' : 'pending'; o.last_error = r.error; }
            store().put('Outbox', o);
          });
        });
      }
      return {
        sent: results.filter(function (r) { return r.ok; }).length,
        failed: results.filter(function (r) { return !r.ok; }).length,
      };
    },

    flushQuietly: function () {
      try { return GN.outbox.flush(10); } catch (e) { GN.deps.log('outbox: ' + (e && e.message)); return null; }
    },
  };
})();
