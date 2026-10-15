'use strict';
/**
 * In-memory fake of the Google Apps Script services used by the server code.
 * Loads every src/shared and src/server file into one VM context (like Apps
 * Script's single global scope), so tests exercise the real server code.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { unzipToBuffers } = require('./unzip');

const ROOT = path.resolve(__dirname, '../..');

function toSigned(buf) { return Array.from(buf).map((b) => (b > 127 ? b - 256 : b)); }
function toBuf(bytes) { return Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))); }

class Blob {
  constructor(bytes, mime, name) { this._b = Buffer.isBuffer(bytes) ? bytes : (typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : toBuf(bytes || [])); this._m = mime || 'application/octet-stream'; this._n = name || ''; }
  getBytes() { return toSigned(this._b); }
  getDataAsString() { return this._b.toString('utf8'); }
  getContentType() { return this._m; }
  getName() { return this._n; }
  setName(n) { this._n = n; return this; }
  getAs(m) { return new Blob(Buffer.concat([Buffer.from('%PDF-FAKE\n'), this._b]), m, this._n); }
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = (this.sheet.data[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) throw new Error(`setValues dimension mismatch ${vals.length}x${vals[0] && vals[0].length} vs ${this.nr}x${this.nc}`);
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] = this.sheet.data[this.r - 1 + i] || [];
      for (let j = 0; j < this.nc; j++) {
        let v = vals[i][j];
        const fmt = (this.sheet.formats[this.r - 1 + i] || [])[this.c - 1 + j];
        if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1); // quote prefix
        else if (typeof v === 'string' && /^=/.test(v)) throw new Error('Formula written to sheet: ' + v);
        else if (typeof v === 'string' && fmt !== '@' && /^\d{4}-\d{2}-\d{2}/.test(v)) v = new Date(v); // mimic Sheets auto-conversion
        row[this.c - 1 + j] = v;
      }
    }
    this.sheet.calls++;
    return this;
  }
  setNumberFormats(f) { for (let i = 0; i < this.nr; i++) { const row = this.sheet.formats[this.r - 1 + i] = this.sheet.formats[this.r - 1 + i] || []; for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = f[i][j]; } return this; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.data = []; this.formats = []; this.calls = 0; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() { let n = this.data.length; while (n > 0 && (!this.data[n - 1] || this.data[n - 1].every((v) => v === '' || v === undefined))) n--; return n; }
  getLastColumn() { return this.data.reduce((m, r) => { let n = (r || []).length; while (n > 0 && (r[n - 1] === '' || r[n - 1] === undefined)) n--; return Math.max(m, n); }, 0); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  deleteRow(r) { this.data.splice(r - 1, 1); this.formats.splice(r - 1, 1); }
  setFrozenRows() { return this; }
}

class Spreadsheet {
  constructor(name) { this.id = 'ss_' + crypto.randomUUID(); this.name = name; this.sheets = [new Sheet('Sheet1')]; }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
}

function makeServices(state) {
  const props = state.props;
  const files = state.files;
  const folders = state.folders;
  const mkFile = (blob, folderId) => {
    const id = 'f_' + crypto.randomUUID();
    files[id] = { id, blob, folderId, trashed: false };
    return fileApi(id);
  };
  const fileApi = (id) => ({
    getId: () => id, getBlob: () => files[id].blob, getName: () => files[id].blob.getName(), setTrashed: (t) => { files[id].trashed = t; },
    getSize: () => files[id].blob._b.length
  });
  const folderApi = (id) => ({
    getId: () => id,
    createFile: (blob) => mkFile(blob, id),
    createFolder: (name) => { const fid = 'd_' + crypto.randomUUID(); folders[fid] = { id: fid, name, parent: id }; return folderApi(fid); },
    getFoldersByName: (name) => { const list = Object.values(folders).filter((f) => f.parent === id && f.name === name); let i = 0; return { hasNext: () => i < list.length, next: () => folderApi(list[i++].id) }; }
  });
  return {
    SpreadsheetApp: {
      create: (name) => { const s = new Spreadsheet(name); state.spreadsheets[s.id] = s; files[s.id] = { id: s.id, blob: new Blob('', 'sheet', name), trashed: false }; return s; },
      openById: (id) => { if (!state.spreadsheets[id]) throw new Error('No spreadsheet ' + id); state.counters.openById++; return state.spreadsheets[id]; },
      flush: () => {}
    },
    DriveApp: {
      createFolder: (name) => { const fid = 'd_' + crypto.randomUUID(); folders[fid] = { id: fid, name, parent: null }; return folderApi(fid); },
      getFolderById: (id) => { if (!folders[id]) throw new Error('No folder'); return folderApi(id); },
      getFileById: (id) => { if (!files[id]) throw new Error('No file ' + id); return fileApi(id); }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: (k) => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => { const e = state.cache[k]; return e && e.exp > Date.now() ? e.v : null; }, put: (k, v, ttl) => { state.cache[k] = { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }; }, remove: (k) => { delete state.cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (state.lockHeld) return false; state.lockHeld = true; return true; }, waitLock: () => { state.lockHeld = true; }, releaseLock: () => { state.lockHeld = false; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, v) => toSigned(crypto.createHash('sha256').update(typeof v === 'string' ? Buffer.from(v, 'utf8') : toBuf(v)).digest()),
      computeHmacSha256Signature: (v, key) => toSigned(crypto.createHmac('sha256', typeof key === 'string' ? Buffer.from(key, 'utf8') : toBuf(key)).update(typeof v === 'string' ? Buffer.from(v, 'utf8') : toBuf(v)).digest()),
      base64Encode: (b) => (typeof b === 'string' ? Buffer.from(b, 'utf8') : toBuf(b)).toString('base64'),
      base64Decode: (s) => toSigned(Buffer.from(s, 'base64')),
      newBlob: (bytes, mime, name) => new Blob(Array.isArray(bytes) ? toBuf(bytes) : bytes, mime, name),
      unzip: (blob) => Object.entries(unzipToBuffers(blob._b)).map(([n, b]) => new Blob(b, 'application/octet-stream', n)),
      formatDate: (d, tz, fmt) => {
        const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
          .reduce((o, x) => { o[x.type] = x.value; return o; }, {});
        return fmt.replace('yyyy', p.year).replace('yy', p.year.slice(2)).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
      },
      sleep: () => {}
    },
    UrlFetchApp: { fetch: (url, opt) => { if (!state.fetchHandler) throw new Error('Network disabled in tests: ' + url); state.counters.fetch++; return state.fetchHandler(url, opt); } },
    ScriptApp: { getOAuthToken: () => 'fake-token' },
    HtmlService: { createHtmlOutput: (h) => ({ getBlob: () => new Blob(h, 'text/html', 'r.html'), getContent: () => h }) },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    console: { log: () => {}, error: (...a) => { if (process.env.DEBUG) console.error(...a); }, warn: () => {} },
    Logger: { log: () => {} }
  };
}

function createRuntime(opts = {}) {
  const state = { props: {}, files: {}, folders: {}, spreadsheets: {}, cache: {}, lockHeld: false, fetchHandler: null, counters: { openById: 0, fetch: 0 } };
  const ctx = vm.createContext({ ...makeServices(state), Date, Math, JSON, Intl });
  const order = ['src/shared/XlsxReader.js', 'src/shared/StandardParser.js', 'src/shared/Scoring.js', 'src/shared/AiSchema.js', 'src/shared/Permissions.js', 'src/shared/DashboardCalc.js'];
  const serverDir = path.join(ROOT, 'src/server');
  fs.readdirSync(serverDir).filter((f) => f.endsWith('.js')).sort().forEach((f) => order.push('src/server/' + f));
  for (const f of order) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  ctx.__state = state;
  return ctx;
}

module.exports = { createRuntime, Blob };
