/**
 * The installation's spreadsheet tabs. Each record is an object; `json` columns are
 * stored as JSON text. In Matches the large columns (state, actions) come LAST so that
 * index reads (lobby, maintenance) can skip them.
 *
 * Bump SCHEMA_VERSION and add a migration in maintenance.js when this changes.
 */
var GN = typeof GN !== 'undefined' ? GN : {};

GN.SCHEMA_VERSION = 1;

GN.SCHEMA = {
  Settings: { key: 'key', cols: ['key', 'value'] },
  Members: {
    key: 'id',
    cols: ['id', 'name', 'email', 'role', 'pin_hash', 'avatar', 'status', 'created', 'stats'],
    json: ['stats'],
    num: ['created'],
  },
  Sessions: {
    key: 'token_hash',
    cols: ['token_hash', 'member_id', 'created', 'last_seen', 'label', 'revoked'],
    num: ['created', 'last_seen'],
  },
  Tables: {
    key: 'id',
    cols: ['id', 'share_key', 'title', 'host_id', 'game_id', 'theme_id', 'options', 'seats', 'invited',
      'meet_url', 'status', 'current_match_id', 'match_count', 'rev', 'created_action', 'created', 'updated', 'actions'],
    json: ['options', 'seats', 'invited', 'actions'],
    num: ['match_count', 'rev', 'created', 'updated'],
  },
  Matches: {
    key: 'id',
    cols: ['id', 'table_id', 'game_id', 'game_version', 'rules_version', 'schema_version', 'theme_id', 'options',
      'players', 'status', 'rev', 'done_rev', 'summary', 'result', 'created', 'updated', 'state', 'actions'],
    json: ['options', 'players', 'result', 'state', 'actions'],
    num: ['rules_version', 'schema_version', 'rev', 'done_rev', 'created', 'updated'],
    index: 16,   // the first 16 columns are the light "index"; state and actions follow
  },
  Events: {
    key: 'key',
    cols: ['key', 'match_id', 'seq', 'rev', 'actor', 'type', 'public', 'at'],
    json: ['public'],
    num: ['seq', 'rev', 'at'],
  },
  Outbox: {
    key: 'key',
    cols: ['key', 'to', 'subject', 'html', 'status', 'attempts', 'created', 'claimed_at', 'sent_at', 'last_error'],
    num: ['attempts', 'created', 'claimed_at'],
  },
};

/** Record <-> row conversion, shared by every store. */
GN.rowOf = function (table, record) {
  var s = GN.SCHEMA[table];
  return s.cols.map(function (c) {
    var v = record[c];
    if (s.json && s.json.indexOf(c) >= 0) return v === undefined || v === null ? '' : JSON.stringify(v);
    return v === undefined || v === null ? '' : v;
  });
};

GN.recordOf = function (table, row) {
  var s = GN.SCHEMA[table];
  var o = {};
  s.cols.forEach(function (c, i) {
    var v = i < row.length ? row[i] : '';
    if (s.json && s.json.indexOf(c) >= 0) {
      o[c] = v === '' || v === null || v === undefined ? null : JSON.parse(v);
    } else if (s.num && s.num.indexOf(c) >= 0) {
      o[c] = v === '' || v === null || v === undefined ? 0 : Number(v);
    } else {
      o[c] = v;
    }
  });
  return o;
};
