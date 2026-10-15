/**
 * Db — Google Sheets data access with:
 *  - typed columns (numbers stored as numbers, JSON as text, text forced to plain-text format)
 *  - foreign-key checks on insert/update
 *  - optimistic locking (version column) + script lock for every write
 *  - formula-injection protection for user text
 *
 * Limitations (documented in README): Sheets has no multi-row transactions.
 * Multi-step writes (e.g. confirming an audit) validate everything first,
 * then write child rows and flip the parent status LAST, so a failure leaves
 * the parent unconfirmed and the step can be retried idempotently.
 */
var Db = (function () {
  var cache = {};
  var ss = null;

  function spreadsheet() {
    if (ss) return ss;
    var id = getProp_('DB_SPREADSHEET_ID');
    if (!id) throw appError_('NOT_SETUP', 'ระบบยังไม่ได้ติดตั้งฐานข้อมูล — Admin ต้องรันฟังก์ชัน setup() ในตัวแก้ไข Apps Script ก่อน');
    ss = SpreadsheetApp.openById(id);
    return ss;
  }

  function sheet(table) {
    var sh = spreadsheet().getSheetByName(table);
    if (!sh) throw appError_('SCHEMA', 'ไม่พบตาราง ' + table + ' — รัน migrate()');
    return sh;
  }

  function cols(table) {
    var c = SCHEMA_COLUMNS[table];
    if (!c) throw new Error('Unknown table ' + table);
    return c;
  }

  function toCell(col, v) {
    if (v === undefined || v === null) return '';
    switch (col.type) {
      case 'n':
        if (v === '') return '';
        var n = Number(v);
        if (!isFinite(n)) throw appError_('VALIDATION', 'ค่า ' + col.name + ' ต้องเป็นตัวเลข');
        return n;
      case 'b': return v === true || v === 'TRUE' || v === 'true';
      case 'j':
        var s = JSON.stringify(v);
        if (s.length > LIMITS.CELL_MAX_CHARS) throw appError_('TOO_LARGE', 'ข้อมูล ' + col.name + ' ใหญ่เกินขนาดเซลล์ (' + s.length + ' ตัวอักษร)');
        return s;
      default:
        var t = String(v);
        if (t.length > LIMITS.CELL_MAX_CHARS) t = t.slice(0, LIMITS.CELL_MAX_CHARS);
        // prevent formula injection from user text
        if (/^[=+\-@]/.test(t)) t = "'" + t;
        return t;
    }
  }

  function fromCell(col, v) {
    if (v === '' || v === null || v === undefined) return col.type === 'b' ? false : null;
    switch (col.type) {
      case 'n': return typeof v === 'number' ? v : (isFinite(Number(v)) ? Number(v) : null);
      case 'b': return v === true || v === 'TRUE' || v === 'true';
      case 'j': try { return JSON.parse(v); } catch (e) { return null; }
      case 'd': return v instanceof Date ? v.toISOString() : String(v);
      default: return v instanceof Date ? v.toISOString() : String(v);
    }
  }

  function load(table, fresh) {
    if (cache[table] && !fresh) return cache[table];
    var sh = sheet(table);
    var c = cols(table);
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var pos = {};
    header.forEach(function (h, i) { pos[h] = i; });
    c.forEach(function (col) { if (pos[col.name] == null) throw appError_('SCHEMA', 'ตาราง ' + table + ' ไม่มีคอลัมน์ ' + col.name + ' — รัน migrate()'); });
    var values = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
    var rows = [], byId = {};
    values.forEach(function (arr, i) {
      if (arr[pos.id] === '' || arr[pos.id] == null) return;
      var o = {};
      c.forEach(function (col) { o[col.name] = fromCell(col, arr[pos[col.name]]); });
      o._row = i + 2;
      rows.push(o);
      byId[o.id] = o;
    });
    cache[table] = { rows: rows, byId: byId, pos: pos, width: lastCol };
    return cache[table];
  }

  function clean(o) { var r = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') r[k] = o[k]; }); return r; }

  function all(table) { return load(table).rows.map(clean); }
  function get(table, id) { var r = load(table).byId[id]; return r ? clean(r) : null; }
  function find(table, pred) { return load(table).rows.filter(pred).map(clean); }
  function findOne(table, pred) { var r = load(table).rows.filter(pred)[0]; return r ? clean(r) : null; }
  function where(table, field, value) { return find(table, function (r) { return r[field] === value; }); }

  function rowArray(table, obj, width, pos) {
    var arr = new Array(width);
    for (var i = 0; i < width; i++) arr[i] = '';
    cols(table).forEach(function (col) { arr[pos[col.name]] = toCell(col, obj[col.name]); });
    return arr;
  }

  function checkRefs(table, obj) {
    cols(table).forEach(function (col) {
      if (!col.ref || obj[col.name] == null || obj[col.name] === '') return;
      if (!load(col.ref).byId[obj[col.name]]) throw appError_('FK', 'อ้างอิง ' + col.name + ' ไม่พบใน ' + col.ref + ' (' + obj[col.name] + ')');
    });
  }

  function insert(table, obj) { return insertMany(table, [obj])[0]; }

  function insertMany(table, list) {
    if (!list.length) return [];
    return withLock(function () {
      var t = load(table, true);
      var now = nowIso_();
      var out = list.map(function (o) {
        var r = {};
        Object.keys(o).forEach(function (k) { r[k] = o[k]; });
        r.id = r.id || uuid_();
        if (t.byId[r.id]) throw appError_('DUPLICATE', 'รหัสซ้ำใน ' + table);
        r.created_at = r.created_at || now; r.updated_at = now; r.version = 1;
        checkRefs(table, r);
        return r;
      });
      var sh = sheet(table);
      var start = sh.getLastRow() + 1;
      var range = sh.getRange(start, 1, out.length, t.width);
      // plain-text format for text/JSON/date columns so Sheets never auto-converts ids or ISO dates
      var fmtRow = new Array(t.width);
      for (var i = 0; i < t.width; i++) fmtRow[i] = 'General';
      cols(table).forEach(function (col) { if (col.type !== 'n' && col.type !== 'b') fmtRow[t.pos[col.name]] = '@'; });
      range.setNumberFormats(out.map(function () { return fmtRow; }));
      range.setValues(out.map(function (r) { return rowArray(table, r, t.width, t.pos); }));
      out.forEach(function (r, i) { r._row = start + i; t.rows.push(r); t.byId[r.id] = r; });
      return out.map(clean);
    });
  }

  /**
   * Update with optimistic locking. expectedVersion === undefined skips the check
   * (server-internal updates); pass the version the client saw for user edits.
   */
  function update(table, id, patch, expectedVersion) {
    return withLock(function () {
      var t = load(table, true);
      var cur = t.byId[id];
      if (!cur) throw appError_('NOT_FOUND', 'ไม่พบข้อมูล ' + table + ' ' + id);
      if (expectedVersion != null && Number(expectedVersion) !== cur.version) {
        var e = appError_('CONFLICT', 'ข้อมูลถูกแก้ไขจากอุปกรณ์อื่นแล้ว (เวอร์ชัน ' + cur.version + ') — โหลดข้อมูลล่าสุดก่อนบันทึก');
        e.current = clean(cur);
        throw e;
      }
      var next = clean(cur);
      Object.keys(patch).forEach(function (k) { if (k !== 'id' && k !== 'version' && k !== 'created_at') next[k] = patch[k]; });
      next.updated_at = nowIso_();
      next.version = cur.version + 1;
      checkRefs(table, next);
      sheet(table).getRange(cur._row, 1, 1, t.width).setValues([rowArray(table, next, t.width, t.pos)]);
      next._row = cur._row;
      t.byId[id] = next;
      t.rows[t.rows.indexOf(cur)] = next;
      return clean(next);
    });
  }

  /** Batch update without version checks (server-internal), one fresh read. */
  function updateMany(table, list) {
    return withLock(function () {
      var t = load(table, true);
      var sh = sheet(table);
      var now = nowIso_();
      return list.map(function (x) {
        var cur = t.byId[x.id];
        if (!cur) throw appError_('NOT_FOUND', 'ไม่พบข้อมูล ' + table + ' ' + x.id);
        var next = clean(cur);
        Object.keys(x.patch).forEach(function (k) { if (k !== 'id' && k !== 'version') next[k] = x.patch[k]; });
        next.updated_at = now; next.version = cur.version + 1;
        checkRefs(table, next);
        sh.getRange(cur._row, 1, 1, t.width).setValues([rowArray(table, next, t.width, t.pos)]);
        next._row = cur._row; t.byId[x.id] = next; t.rows[t.rows.indexOf(cur)] = next;
        return clean(next);
      });
    });
  }

  /** Physically delete a row (used only for link tables; business records are soft-deleted). */
  function remove(table, id) {
    return withLock(function () {
      var t = load(table, true);
      var cur = t.byId[id];
      if (!cur) return false;
      sheet(table).deleteRow(cur._row);
      delete cache[table];
      return true;
    });
  }

  var lockDepth = 0;
  function withLock(fn) {
    if (lockDepth > 0) return fn();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) throw appError_('BUSY', 'ระบบกำลังบันทึกข้อมูลจากผู้ใช้อื่น กรุณาลองใหม่อีกครั้ง');
    lockDepth++;
    try { return fn(); } finally { lockDepth--; lock.releaseLock(); }
  }

  /** Run fn holding the lock with fresh data (for multi-step writes). */
  function transaction(fn) {
    return withLock(function () { cache = {}; return fn(); });
  }

  function reset() { cache = {}; ss = null; }

  /** Create missing tables/columns (idempotent). */
  function ensureSchema(spreadsheetObj) {
    var target = spreadsheetObj || spreadsheet();
    Object.keys(SCHEMA_COLUMNS).forEach(function (table) {
      var sh = target.getSheetByName(table) || target.insertSheet(table);
      var c = SCHEMA_COLUMNS[table];
      var lastCol = sh.getLastColumn();
      var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      var missing = c.filter(function (col) { return header.indexOf(col.name) < 0; });
      if (missing.length) {
        var start = header.filter(function (h) { return h !== ''; }).length + 1;
        sh.getRange(1, start, 1, missing.length).setValues([missing.map(function (m) { return m.name; })]);
      }
      if (sh.setFrozenRows) sh.setFrozenRows(1);
    });
    reset();
  }

  return { all: all, get: get, find: find, findOne: findOne, where: where, insert: insert, insertMany: insertMany, update: update, updateMany: updateMany, remove: remove,
    withLock: withLock, transaction: transaction, reset: reset, ensureSchema: ensureSchema, spreadsheet: spreadsheet };
})();

function appError_(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}
