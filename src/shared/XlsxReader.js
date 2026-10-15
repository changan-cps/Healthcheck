/**
 * XlsxReader — dependency-free reader for .xlsx workbooks.
 *
 * Works in Google Apps Script (V8) and in Node (tests). The caller unzips the
 * file and passes a map { "xl/workbook.xml": "<xml…>", … } of UTF-8 strings.
 *   - Apps Script: Utilities.unzip(blob) → see Standards.gs readXlsxBlob_()
 *   - Node tests:  test/helpers/unzip.js
 *
 * Output keeps the exact source location of every value (sheet + A1 cell) so
 * imported standards can always be traced back to the original file.
 */
var XlsxReader = (function () {
  'use strict';

  function decodeXml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function attr(tag, name) {
    var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
    return m ? decodeXml(m[1]) : null;
  }

  /** Concatenate all <t> runs of an <si>/<is> fragment, skipping phonetic <rPh>. */
  function textOf(fragment) {
    var cleaned = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    var out = '';
    var re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    var m;
    while ((m = re.exec(cleaned))) out += m[1] ? decodeXml(m[1]) : '';
    return out;
  }

  function colToNum(col) {
    var n = 0;
    for (var i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n;
  }
  function numToCol(n) {
    var s = '';
    while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function parseRef(ref) {
    var m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) throw new Error('Bad cell ref ' + ref);
    return { col: colToNum(m[1]), row: parseInt(m[2], 10) };
  }
  function toRef(row, col) { return numToCol(col) + row; }

  function resolvePath(base, target) {
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = base.split('/'); parts.pop();
    target.split('/').forEach(function (p) {
      if (p === '..') parts.pop(); else if (p !== '.') parts.push(p);
    });
    return parts.join('/');
  }

  function readSharedStrings(xml) {
    if (!xml) return [];
    var out = [];
    var re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    var m;
    while ((m = re.exec(xml))) out.push(m[1] ? textOf(m[1]) : '');
    return out;
  }

  function readSheet(xml, shared) {
    var cells = {};
    var maxRow = 0, maxCol = 0;
    var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    var m;
    while ((m = cellRe.exec(xml))) {
      var head = m[1];
      var body = m[2] || '';
      var ref = attr(head, 'r');
      if (!ref) continue;
      var t = attr(head, 't');
      var fMatch = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/.exec(body);
      var vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
      var value = null;
      if (t === 's' && vMatch) value = shared[parseInt(vMatch[1], 10)];
      else if (t === 'inlineStr') value = textOf(body);
      else if (t === 'str' || t === 'e') value = vMatch ? decodeXml(vMatch[1]) : null;
      else if (t === 'b') value = vMatch ? vMatch[1] === '1' : null;
      else if (vMatch) { var num = Number(vMatch[1]); value = isNaN(num) ? decodeXml(vMatch[1]) : num; }
      var formula = fMatch && fMatch[1] ? '=' + decodeXml(fMatch[1]) : null;
      if ((value === null || value === '') && !formula) continue;
      var p = parseRef(ref);
      cells[ref] = { ref: ref, row: p.row, col: p.col, value: value, formula: formula };
      if (p.row > maxRow) maxRow = p.row;
      if (p.col > maxCol) maxCol = p.col;
    }
    var merges = [];
    var mRe = /<mergeCell\s+ref="([A-Z]+\d+):([A-Z]+\d+)"\s*\/>/g;
    while ((m = mRe.exec(xml))) {
      var a = parseRef(m[1]), b = parseRef(m[2]);
      merges.push({ ref: m[1] + ':' + m[2], top: a.row, left: a.col, bottom: b.row, right: b.col });
    }
    return { cells: cells, merges: merges, maxRow: maxRow, maxCol: maxCol };
  }

  /**
   * @param {Object<string,string>} files unzipped workbook parts
   * @return {{sheets: Array}} sheets in workbook order
   */
  function read(files) {
    var wb = files['xl/workbook.xml'];
    if (!wb) throw new Error('ไม่พบ xl/workbook.xml — ไฟล์นี้ไม่ใช่ .xlsx ที่ถูกต้อง');
    var rels = files['xl/_rels/workbook.xml.rels'] || '';
    var relMap = {};
    var rRe = /<Relationship\b([^>]*)\/?>/g, m;
    while ((m = rRe.exec(rels))) relMap[attr(m[1], 'Id')] = attr(m[1], 'Target');
    var shared = readSharedStrings(files['xl/sharedStrings.xml']);
    var sheets = [];
    var sRe = /<sheet\b([^>]*)\/?>/g;
    var index = 0;
    while ((m = sRe.exec(wb))) {
      var name = attr(m[1], 'name');
      var state = attr(m[1], 'state') || 'visible';
      var rid = attr(m[1], 'r:id');
      var path = relMap[rid] ? resolvePath('xl/workbook.xml', relMap[rid]) : null;
      var xml = path ? files[path] : null;
      var parsed = xml ? readSheet(xml, shared) : { cells: {}, merges: [], maxRow: 0, maxCol: 0 };
      sheets.push(makeSheet(index++, name, state, parsed));
    }
    return { sheets: sheets };
  }

  function makeSheet(index, name, state, parsed) {
    var owner = {};
    parsed.merges.forEach(function (mg) {
      for (var r = mg.top; r <= mg.bottom; r++)
        for (var c = mg.left; c <= mg.right; c++) owner[r + ':' + c] = mg;
    });
    return {
      index: index, name: name, state: state, hidden: state !== 'visible',
      maxRow: parsed.maxRow, maxCol: parsed.maxCol, merges: parsed.merges, cells: parsed.cells,
      /** Raw cell (only top-left of a merge holds a value). */
      raw: function (row, col) { return parsed.cells[toRef(row, col)] || null; },
      /** Value resolved through merged ranges: returns {value, ref, merge}. */
      get: function (row, col) {
        var mg = owner[row + ':' + col];
        var r = mg ? mg.top : row, c = mg ? mg.left : col;
        var cell = parsed.cells[toRef(r, c)];
        return { value: cell ? cell.value : null, formula: cell ? cell.formula : null, ref: toRef(r, c), merge: mg ? mg.ref : null };
      },
      text: function (row, col) {
        var v = this.get(row, col).value;
        return v == null ? '' : String(v).replace(/\r\n/g, '\n').trim();
      },
      mergeAt: function (row, col) { return owner[row + ':' + col] || null; }
    };
  }

  return { read: read, toRef: toRef, colToNum: colToNum, numToCol: numToCol, parseRef: parseRef, decodeXml: decodeXml };
})();
