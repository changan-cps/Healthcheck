/**
 * StandardParser — turns workbook sheets (from XlsxReader) into candidate
 * standard versions: criteria, scoring rules, red lines, audit-route stops,
 * sample-size requirements and review flags.
 *
 * Principles (from the CPS AI Audit spec):
 *  - Never invent a condition. Anything that cannot be read unambiguously is
 *    emitted with a review flag ("ต้องตรวจทานเกณฑ์") instead of a guess.
 *  - Every value carries its source (file, sheet, cell).
 *  - Scores already present in the file (e.g. "Current score") are ignored.
 */
var StandardParser = (function () {
  'use strict';

  var PARSER_VERSION = 'std-parser-1.0.0';

  // ---------- text helpers ----------
  var THAI = /[฀-๿]/;
  var CJK = /[㐀-鿿]/;

  function lines(text) {
    return String(text || '').replace(/\r\n/g, '\n').split('\n')
      .map(function (s) { return s.replace(/\s+$/, '').replace(/^\s+/, ''); })
      .filter(function (s) { return s.length; });
  }

  /** Split bilingual cell into {zh, th, raw}. Thai lines → th; CJK-only lines → zh. */
  function splitLang(text) {
    var zh = [], th = [], other = [];
    lines(text).forEach(function (l) {
      if (THAI.test(l)) th.push(l);
      else if (CJK.test(l)) zh.push(l);
      else other.push(l);
    });
    // Lines with neither (e.g. "OIS&WES（10分）" has CJK) or pure latin go to both
    return { zh: zh.join('\n'), th: th.join('\n'), en: other.join('\n'), raw: String(text || '').trim() };
  }

  var CN_NUM = { '一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  function num(s) {
    if (s == null) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    return CN_NUM[s] || null;
  }

  /** Points like "（10分）", "10分", "（15）", "（8）分）". Returns number|null. */
  function parsePoints(text) {
    var t = String(text || '');
    var m = /(\d+(?:\.\d+)?)\s*[）)]?\s*分/.exec(t);
    if (m) return Number(m[1]);
    m = /[（(]\s*(\d+(?:\.\d+)?)\s*[）)]/.exec(t);
    if (m) return Number(m[1]);
    m = /(\d+(?:\.\d+)?)\s*คะแนน/.exec(t);
    return m ? Number(m[1]) : null;
  }

  function firstLine(text) { var l = lines(text); return l.length ? l[0] : ''; }

  function stripPoints(title) {
    return String(title || '').replace(/[（(]\s*\d+(?:\.\d+)?\s*[）)]?\s*分\s*[）)]?/g, '').replace(/[（(]\s*\d+\s*[）)]/g, '')
      .replace(/\s*\d+\s*分\s*$/, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  }

  // ---------- rule extraction (Team/Group/Manager deduction rules) ----------
  /**
   * Splits a criteria cell into numbered clauses and classifies each Chinese
   * clause. Thai clause with same number is attached as translation.
   */
  function extractRules(criteriaText, sourceRef) {
    var lang = splitLang(criteriaText);
    var zhClauses = clauses(lang.zh);
    var thClauses = clauses(lang.th);
    var rules = [];
    var flags = [];
    zhClauses.forEach(function (zc, i) {
      var tc = thClauses[i] || '';
      // A single clause may hold several sub-rules separated by "；" (e.g. "完全回答不出，扣5分；不清晰、不完整，扣3分")
      var parts = zc.split(/[；;](?=.*(?:扣|不得分|0分))/);
      parts.forEach(function (part, j) {
        var r = classify(part);
        if (!r) return;
        r.text = { zh: part.trim(), th: tc };
        r.source_ref = sourceRef;
        r.clause_no = i + 1;
        r.sub_no = j + 1;
        rules.push(r);
        // translation sanity: numbers in zh clause should appear in th clause
        var nz = (part.match(/\d+/g) || []).filter(function (n) { return n !== String(i + 1); });
        var missingNums = nz.filter(function (n) { return tc && tc.indexOf(n) < 0; });
        var latin = (part.match(/[A-Za-z0-9]{2,}/g) || []).filter(function (w) { return !/^\d+$/.test(w); });
        var missingLatin = latin.filter(function (w) {
          var alt = w.replace(/5S/i, '5ส');
          return tc && tc.indexOf(w) < 0 && tc.indexOf(alt) < 0;
        });
        if (!tc) flags.push(flag('TRANSLATION_MISSING', 'warn', 'ไม่พบคำแปลภาษาไทยของเงื่อนไขข้อ ' + (i + 1), sourceRef));
        else if (missingNums.length || missingLatin.length)
          flags.push(flag('TRANSLATION_MISMATCH', 'review',
            'คำแปลไทยของเงื่อนไขข้อ ' + (i + 1) + ' อาจไม่ตรงกับภาษาจีน (ไม่พบ: ' + missingNums.concat(missingLatin).join(', ') + ') — ใช้ภาษาจีนเป็นหลักจนกว่าจะตรวจทาน', sourceRef));
      });
    });
    if (!zhClauses.length && lang.raw) {
      // No Chinese text: try Thai-only text, but always for review
      clauses(lang.th).forEach(function (tc, i) {
        var m = /หัก\s*(\d+)/.exec(tc);
        rules.push({ rule_type: m ? 'ONCE' : 'UNPARSED', points: m ? Number(m[1]) : null, parse_status: 'NEEDS_REVIEW',
          note: 'อ่านจากข้อความภาษาไทยเท่านั้น', text: { zh: '', th: tc }, source_ref: sourceRef, clause_no: i + 1, sub_no: 1 });
      });
      flags.push(flag('RULE_THAI_ONLY', 'review', 'เกณฑ์มีเฉพาะภาษาไทย ต้องตรวจทานการตีความ', sourceRef));
    }
    return { rules: rules, flags: flags };
  }

  function clauses(text) {
    var ls = lines(text);
    var out = [];
    ls.forEach(function (l) {
      if (/^\s*(\d+)\s*[、.．)]/.test(l) || !out.length) out.push(l.replace(/^\s*\d+\s*[、.．)]\s*/, ''));
      else out[out.length - 1] += ' ' + l;
    });
    return out;
  }

  function classify(zh) {
    var t = zh.replace(/\s+/g, '');
    var m;
    // "能完整答出且逻辑清楚、正确，不扣分" → informational, no deduction
    if (/不扣分/.test(t) && !/扣\d+分/.test(t) && !/不得分|0分/.test(t))
      return { rule_type: 'NO_DEDUCTION', points: 0, parse_status: 'PARSED', note: 'เงื่อนไขไม่หักคะแนน' };
    // conditional pass/fail with explicit else: "达成…不扣分，没达成扣3分", "至少有一项…不扣分，其他扣3分"
    if (/不扣分/.test(t) && (m = /扣(\d+(?:\.\d+)?)分/.exec(t)))
      return { rule_type: 'ONCE', points: Number(m[1]), parse_status: 'PARSED',
        note: 'หักครั้งเดียวเมื่อไม่เป็นไปตามเงื่อนไข (ข้อความระบุกรณีไม่หักไว้ชัด)' };
    // zero-score conditions
    if (/不得分|(?:^|[，,])0分/.test(t)) {
      var rest = /扣(\d+(?:\.\d+)?)分/.exec(t);
      if (rest && /(一个|每个|一处|一项|一次)/.test(t))
        // "无闭环管理流程，0分；不符合问题一个扣3分" handled by split earlier, but if together keep both
        return { rule_type: 'ZERO_SCORE', points: null, parse_status: 'NEEDS_REVIEW', note: 'มีทั้งเงื่อนไข 0 คะแนนและการหักรายครั้งในประโยคเดียว' };
      return { rule_type: 'ZERO_SCORE', points: null, parse_status: 'PARSED', note: 'ได้ 0 คะแนนในข้อนี้เมื่อเข้าเงื่อนไข' };
    }
    if ((m = /扣(\d+(?:\.\d+)?)分/.exec(t))) {
      var pts = Number(m[1]);
      if (/(一个|每个|一处|一项|一次|1个|每项|每次|不符合一个|一个扣)/.test(t))
        return { rule_type: 'PER_OCCURRENCE', points: pts, parse_status: 'PARSED', note: 'หักต่อปัญหา 1 รายการ (ปัญหาเดียวกันนับครั้งเดียว)' };
      return { rule_type: 'ONCE', points: pts, parse_status: 'PARSED',
        note: 'ข้อความไม่ได้ระบุ "ต่อรายการ" จึงตีความเป็นหักครั้งเดียวต่อรอบตรวจ — โปรดยืนยัน' };
    }
    if (/扣/.test(t)) return { rule_type: 'UNPARSED', points: null, parse_status: 'NEEDS_REVIEW', note: 'พบคำว่า "扣" แต่อ่านจำนวนคะแนนไม่ได้' };
    return null;
  }

  // ---------- sample size ----------
  function parseSampleSize(text) {
    var t = String(text || '').replace(/\s+/g, '');
    var m, res = null;
    var D = '(\\d+|[一两二三四五六七八九十])';
    if ((m = new RegExp('每个(班组|版块|区)抽查' + D + '(个|份|条)?([^，,。；;：:]*)').exec(t)))
      res = { count: num(m[2]), per: m[1] === '班组' ? 'TEAM' : (m[1] === '版块' ? 'SECTION' : 'AREA'), unit: (m[3] || '') + (m[4] || '').slice(0, 8) };
    else if ((m = new RegExp('查看' + D + '[~～-]' + D + '个([^，,。；;]*)').exec(t)))
      res = { count: num(m[1]), max: num(m[2]), per: null, unit: '个' + m[3].slice(0, 6) };
    else if ((m = new RegExp('抽问' + D + '名以上([^，,。；;]*)').exec(t)))
      res = { count: num(m[1]), per: null, unit: '名' + m[2].slice(0, 6), at_least: true };
    else if ((m = new RegExp('(?:抽查|抽取|查)' + D + '(个|份|条|名)([^，,。；;：:]*)').exec(t)))
      res = { count: num(m[1]), per: null, unit: m[2] + m[3].slice(0, 8) };
    else if ((m = /随机抽查一个([^，,。；;：:]*)/.exec(t)))
      res = { count: 1, per: null, unit: '个' + m[1].slice(0, 6) };
    if (res) {
      res.text = m[0];
      res.status = res.per || res.max ? 'NEEDS_REVIEW' : 'PARSED';
      if (res.per) res.note = 'จำนวนต่อ ' + ({ TEAM: 'ทีม', SECTION: 'หมวด', AREA: 'พื้นที่' })[res.per] + ' — จำนวนรวมขึ้นกับจำนวนหน่วยในรอบตรวจ';
      if (res.max) res.note = 'ช่วง ' + res.count + '–' + res.max + ' ใช้ค่าต่ำสุดเป็นขั้นต่ำ';
    }
    return res;
  }

  // ---------- audit route stops ----------
  var ROUTE_STOPS = [
    { code: 'MEETING', name_th: 'จุดประชุม / เปิด-ปิดกะ', re: /会议|班前会|开班|收班|201|102|105|开收班/ },
    { code: 'BOARD', name_th: 'บอร์ดทีม / IPO / ตัวชี้วัด', re: /看板|IPO|积分卡|记分卡|计分卡|指标|A3|主体计划|工作计划/ },
    { code: 'STATION', name_th: 'ตำแหน่งงาน (สุ่มตรวจ)', re: /工位|作业指导书|OIS|SQDCPME|标准作业|6S|5S|定置|防错|Andon|扭力|阀门|目视化/ },
    { code: 'RECORDS', name_th: 'เอกสาร / บันทึก / แฟ้ม', re: /记录|交接班|跟踪表|台账|档案|过程验证|PJO|改善|升级/ },
    { code: 'INTERVIEW', name_th: 'สัมภาษณ์', re: /访谈|抽问|口述|知晓/ }
  ];
  function routeStopsFor(text, method) {
    var t = String(text || '');
    var codes = [];
    ROUTE_STOPS.forEach(function (s) { if (s.re.test(t)) codes.push(s.code); });
    if (/访谈/.test(method || '') && codes.indexOf('INTERVIEW') < 0) codes.push('INTERVIEW');
    if (!codes.length) codes.push('OTHER');
    return codes;
  }
  function timeHint(text) {
    var m = /(\d{1,2})[:：](\d{2})\s*分?\s*开班/.exec(String(text || ''));
    return m ? (m[1].length === 1 ? '0' + m[1] : m[1]) + ':' + m[2] : null;
  }

  function flag(code, severity, message, ref) {
    return { code: code, severity: severity, message_th: message, ref: ref || null };
  }

  // ---------- sheet classification ----------
  function findCell(sheet, re, maxRow) {
    for (var r = 1; r <= Math.min(sheet.maxRow, maxRow || 15); r++)
      for (var c = 1; c <= sheet.maxCol; c++) {
        var cell = sheet.raw(r, c);
        if (cell && cell.value != null && re.test(String(cell.value))) return { row: r, col: c };
      }
    return null;
  }

  function classifySheet(sheet) {
    var title = sheet.text(1, 1);
    if (/CPS-KUP健康体检表/.test(title) || (findCell(sheet, /^序号/, 6) && findCell(sheet, /评价标准/, 6))) {
      var level = /班组级|班长/.test(title + sheet.name) ? 'TEAM' : /区长/.test(title + sheet.name) ? 'GROUP' : /经理/.test(title + sheet.name) ? 'MANAGER' : null;
      return { kind: 'HC_LEVEL', level: level };
    }
    if (findCell(sheet, /0\s*-+\s*2\s*คะแนน/, 12) && findCell(sheet, /มาตรฐานการประเมิน/, 12)) return { kind: 'KUP_BAND', level: 'KUP' };
    if (/健康体检机制/.test(title)) return { kind: 'HC_OVERVIEW', level: null };
    if (findCell(sheet, /\d+\s*-+\s*\d+\s*คะแนน/, 12)) return { kind: 'OS_BAND', level: null, unsupported: 'ช่วงคะแนนต่างจาก KUP (เช่น 0–4/5–8/9–10) — ยังไม่รองรับในรุ่นแรก' };
    if (/(^|[^A-Z])[QMCD]OS|OS评价/.test(sheet.name)) return { kind: 'OS_BAND', level: null, unsupported: 'มาตรฐานระบบปฏิบัติการ (OS) มีโครงสร้างช่วงคะแนนต่างจาก KUP — ยังไม่รองรับในรุ่นแรก' };
    if (/Score Management/i.test(sheet.name)) return { kind: 'POINTS_SCHEME', level: null, unsupported: 'ระบบแต้ม CPS รายเดือน ไม่ใช่เกณฑ์ออดิทรายข้อ' };
    return { kind: 'UNKNOWN', level: null, unsupported: 'ไม่รู้จักรูปแบบชีต' };
  }

  // ---------- HC level sheets (Team / Group / Manager) ----------
  function parseHcLevel(sheet, ctx) {
    var src = function (ref) { return { file: ctx.fileName, sheet: sheet.name, cell: ref }; };
    var flags = [];
    var hdr = findCell(sheet, /^序号/, 8);
    var headerRow = hdr.row;
    var cols = {};
    for (var c = 1; c <= sheet.maxCol; c++) {
      var v = sheet.text(headerRow, c);
      var mg = sheet.mergeAt(headerRow, c);
      var key = null;
      if (/^序号/.test(v)) key = 'seq';
      else if (/评价维度/.test(v)) key = 'dimension';
      else if (/检查项目/.test(v)) key = 'item';
      else if (/评价内容/.test(v)) key = 'content';
      else if (/^对象/.test(v)) key = 'target';
      else if (/评价方式/.test(v)) key = 'method';
      else if (/评价标准/.test(v)) key = 'criteria';
      else if (/记录/.test(v)) key = 'record';
      // for merged header (e.g. 评价维度 over B:C) use the right-most column
      if (key) cols[key] = mg ? mg.right : c;
    }
    ['dimension', 'item', 'content', 'criteria'].forEach(function (k) {
      if (!cols[k]) flags.push(flag('HEADER_MISSING', 'block', 'ไม่พบคอลัมน์หัวตาราง "' + k + '"', src(XlsxReader.toRef(headerRow, 1))));
    });
    var criteria = [];
    var rules = [];
    var dims = {};
    var dimOrder = [];
    var ruleGroups = {}; // criteria merged cell ref → rule ids, to mark shared rules
    for (var r = headerRow + 1; r <= sheet.maxRow; r++) {
      var rowText = '';
      for (var cc = 1; cc <= sheet.maxCol; cc++) rowText += sheet.text(r, cc);
      if (/总分/.test(rowText) && !sheet.text(r, cols.item)) break;
      var itemCell = sheet.get(r, cols.item);
      var contentCell = sheet.get(r, cols.content);
      var seqRaw = cols.seq ? sheet.raw(r, cols.seq) : null;
      var seq = seqRaw && typeof seqRaw.value === 'number' ? seqRaw.value : null;
      // A row is a new criterion when it has its own number, or its own (non-merged-continuation) content.
      var ownContent = contentCell.value && contentCell.ref === XlsxReader.toRef(r, cols.content);
      var ownItem = itemCell.value && itemCell.ref === XlsxReader.toRef(r, cols.item);
      if (seq == null && !ownContent && !ownItem) continue;
      if (!itemCell.value && !contentCell.value) continue;
      var dimCell = sheet.get(r, cols.dimension);
      var dimText = dimCell.value != null ? String(dimCell.value) : '';
      var dimKey = dimCell.ref;
      if (!dims[dimKey]) {
        dims[dimKey] = { code: 'D' + (dimOrder.length + 1), name: splitLang(stripPoints(dimText)), max_points: parsePoints(dimText),
          source_ref: src(dimCell.ref), criteria: [] };
        dimOrder.push(dimKey);
        if (dims[dimKey].max_points == null)
          flags.push(flag('DIMENSION_POINTS_MISSING', 'review', 'ไม่พบคะแนนเต็มของหัวข้อประเมิน "' + firstLine(dimText) + '"', src(dimCell.ref)));
      }
      var itemText = sheet.text(r, cols.item);
      var content = sheet.text(r, cols.content);
      var criteriaCell = sheet.get(r, cols.criteria);
      var method = cols.method ? sheet.text(r, cols.method) : '';
      var target = cols.target ? sheet.text(r, cols.target) : '';
      var code = (ctx.level.charAt(0)) + '-' + (seq != null ? pad(seq) : 'R' + r);
      var crit = {
        code: code, seq: seq, row: r,
        dimension_code: dims[dimKey].code,
        title: splitLang(stripPoints(itemText)),
        requirement: splitLang(content),
        method: splitLang(method),
        target_role: splitLang(target),
        criteria_text: splitLang(criteriaCell.value == null ? '' : String(criteriaCell.value)),
        max_points: parsePoints(firstLine(itemText)) != null ? parsePoints(firstLine(itemText)) : parsePoints(itemText),
        max_points_source: 'ITEM',
        sample: parseSampleSize(content),
        route_stops: routeStopsFor(itemText + ' ' + content, method),
        time_hint: timeHint(content),
        source_ref: { file: ctx.fileName, sheet: sheet.name, row: r, cells: {
          seq: XlsxReader.toRef(r, cols.seq || 1), item: itemCell.ref, content: sheet.get(r, cols.content).ref, criteria: criteriaCell.ref } },
        criteria_merge: criteriaCell.merge,
        item_group: itemCell.merge ? itemCell.ref : null,
        flags: []
      };
      if (seq == null) crit.flags.push(flag('SEQ_MISSING', 'review', 'แถว ' + r + ' ไม่มีเลขข้อในไฟล์ ใช้รหัส ' + code + ' แทน', src(XlsxReader.toRef(r, cols.seq || 1))));
      if (crit.max_points == null) crit.flags.push(flag('ITEM_POINTS_MISSING', 'review', 'ไม่พบคะแนนเต็มรายข้อ — ต้องกำหนดก่อนประกาศใช้', src(itemCell.ref)));
      if (crit.sample && crit.sample.status === 'NEEDS_REVIEW') crit.flags.push(flag('SAMPLE_REVIEW', 'review', 'จำนวนตัวอย่าง: ' + crit.sample.note, src(crit.source_ref.cells.content)));
      if (!crit.sample && /抽查|抽问|随机/.test(content)) crit.flags.push(flag('SAMPLE_UNPARSED', 'review', 'มีการสุ่มตรวจแต่อ่านจำนวนตัวอย่างไม่ได้', src(crit.source_ref.cells.content)));
      // rules: if criteria cell is merged over several items, the rules are shared
      var groupKey = criteriaCell.ref;
      if (!ruleGroups[groupKey]) {
        var ex = criteriaCell.value ? extractRules(String(criteriaCell.value), src(criteriaCell.ref)) : { rules: [], flags: [] };
        ruleGroups[groupKey] = { rules: ex.rules, criteria: [] };
        ex.flags.forEach(function (f) { crit.flags.push(f); });
        if (!criteriaCell.value) crit.flags.push(flag('CRITERIA_MISSING', 'review', 'ไม่พบเกณฑ์การให้คะแนน', src(criteriaCell.ref)));
      }
      ruleGroups[groupKey].criteria.push(code);
      if (criteriaCell.merge && ruleGroups[groupKey].criteria.length === 2)
        flags.push(flag('SHARED_CRITERIA', 'info', 'เกณฑ์ในเซลล์ ' + criteriaCell.merge + ' ใช้ร่วมกันหลายข้อ', src(criteriaCell.ref)));
      dims[dimKey].criteria.push(code);
      criteria.push(crit);
    }
    // numbering gaps
    var seqs = criteria.map(function (c) { return c.seq; }).filter(function (s) { return s != null; });
    for (var i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] + 1)
      flags.push(flag('SEQ_GAP', 'review', 'เลขข้อข้ามจาก ' + seqs[i - 1] + ' ไป ' + seqs[i], src(null)));
    // an item (检查项目) cell merged over several numbered rows: its points belong to the group, not to each row
    var groups = {};
    criteria.forEach(function (c) { if (c.item_group) (groups[c.item_group] = groups[c.item_group] || []).push(c); });
    Object.keys(groups).forEach(function (g) {
      var list = groups[g];
      if (list.length < 2) return;
      var gp = list[0].max_points;
      list.forEach(function (c) {
        c.group_max_points = gp;
        c.max_points = null;
        c.max_points_source = 'ITEM_GROUP';
        c.flags.push(flag('ITEM_GROUP_POINTS', 'review', 'รายการตรวจ "' + firstLine(c.title.raw) + '" (' + (gp == null ? '?' : gp) + ' คะแนน) ครอบคลุม ' +
          list.length + ' ข้อ (' + list.map(function (x) { return x.code; }).join(', ') + ') แต่ไม่ได้แบ่งคะแนนรายข้อ — Admin ต้องกำหนด', src(g)));
      });
    });
    // derive item points when a dimension has exactly one item, else check sums
    dimOrder.forEach(function (k) {
      var d = dims[k];
      var items = criteria.filter(function (c) { return c.dimension_code === d.code; });
      if (items.length === 1 && items[0].max_points == null && d.max_points != null) {
        items[0].max_points = d.max_points;
        items[0].max_points_source = 'DIMENSION_SINGLE_ITEM';
        items[0].flags = items[0].flags.filter(function (f) { return f.code !== 'ITEM_POINTS_MISSING'; });
        items[0].flags.push(flag('ITEM_POINTS_FROM_DIMENSION', 'info', 'ใช้คะแนนเต็มของหัวข้อ (' + d.max_points + ') เพราะหัวข้อนี้มีข้อเดียว', d.source_ref));
      }
      var known = items.filter(function (c) { return c.max_points != null; });
      var sum = known.reduce(function (a, c) { return a + c.max_points; }, 0);
      if (d.max_points != null && known.length === items.length && Math.abs(sum - d.max_points) > 1e-9)
        flags.push(flag('DIMENSION_SUM_MISMATCH', 'review', 'ผลรวมคะแนนรายข้อ (' + sum + ') ไม่เท่าคะแนนหัวข้อ (' + d.max_points + ') ใน "' + d.name.zh + '"', d.source_ref));
      if (d.max_points != null && known.length < items.length)
        flags.push(flag('DIMENSION_ITEMS_UNSPLIT', 'review', 'หัวข้อ "' + (d.name.zh || d.name.th) + '" มีคะแนนรวม ' + d.max_points + ' แต่ ' +
          (items.length - known.length) + ' ข้อไม่ระบุคะแนนเต็ม (ผลรวมที่ระบุ ' + sum + ') — Admin ต้องกำหนดก่อนประกาศใช้', d.source_ref));
    });
    var total = dimOrder.reduce(function (a, k) { return a + (dims[k].max_points || 0); }, 0);
    // assemble rules with ids per criterion group
    var ruleSeq = 0;
    Object.keys(ruleGroups).forEach(function (gk) {
      var g = ruleGroups[gk];
      g.rules.forEach(function (rule) {
        ruleSeq++;
        rule.rule_code = ctx.level.charAt(0) + '-R' + pad(ruleSeq);
        rule.criteria_codes = g.criteria.slice();
        rules.push(rule);
        if (rule.parse_status === 'NEEDS_REVIEW')
          flags.push(flag('RULE_NEEDS_REVIEW', 'review', 'กฎ ' + rule.rule_code + ': ' + rule.note + ' — "' + (rule.text.zh || rule.text.th) + '"', rule.source_ref));
      });
    });
    return {
      criteria: criteria, rules: rules, flags: flags,
      dimensions: dimOrder.map(function (k) { return dims[k]; }),
      total_points: total
    };
  }

  // ---------- red lines from the overview sheet ----------
  function parseRedLines(sheet, ctx) {
    var start = findCell(sheet, /否决条款/, 30);
    if (!start) return null;
    var clausesOut = [], penalty = null, penaltyRef = null, flags = [];
    var current = null;
    for (var r = start.row; r <= Math.min(sheet.maxRow, start.row + 20); r++) {
      var t = sheet.text(r, start.col + 1);
      if (!t) { if (current && sheet.text(r, 1) && !/否决/.test(sheet.text(r, 1))) break; continue; }
      if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(t)) {
        current = { code: 'RL' + (clausesOut.length + 1), text: { zh: t.replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '').replace(/[；;。]$/, ''), th: '' },
          source_ref: { file: ctx.fileName, sheet: sheet.name, cell: XlsxReader.toRef(r, start.col + 1) } };
        clausesOut.push(current);
      } else if (/扣(\d+)分/.test(t) && /红线/.test(t)) {
        penalty = Number(/扣(\d+)分/.exec(t)[1]); penaltyRef = XlsxReader.toRef(r, start.col + 1);
        current = null;
      } else if (current && THAI.test(t) && !current.text.th) current.text.th = t;
    }
    if (penalty == null) flags.push(flag('REDLINE_PENALTY_MISSING', 'review', 'ไม่พบจำนวนคะแนนที่หักของ Red Line', null));
    flags.push(flag('REDLINE_MODE_UNCLEAR', 'review',
      'ข้อความ "以上条款一旦触发红线条款扣' + penalty + '分" ไม่ระบุว่าหักครั้งเดียวต่อรอบตรวจ หรือหักต่อข้อที่พบ — คะแนนสุดท้ายจะถูกระงับเมื่อพบ Red Line จนกว่า Admin จะกำหนด',
      { file: ctx.fileName, sheet: sheet.name, cell: penaltyRef }));
    var objCell = findCell(sheet, /^对象/, 10);
    return {
      clauses: clausesOut, penalty: penalty,
      penalty_ref: { file: ctx.fileName, sheet: sheet.name, cell: penaltyRef },
      applies_to_text: objCell ? sheet.text(objCell.row, objCell.col) : '',
      applies_to: ['TEAM', 'GROUP'], flags: flags
    };
  }

  /** Composite (quarterly) weights described in the overview sheet. Informational only. */
  function parseCompositeWeights(sheet, ctx) {
    var out = [];
    for (var r = 1; r <= sheet.maxRow; r++) {
      var w = sheet.raw(r, 4);
      if (w && typeof w.value === 'number' && w.value > 0 && w.value <= 1)
        out.push({ name: splitLang(sheet.text(r, 2)), weight: w.value, note: splitLang(sheet.text(r, 5)), source_ref: { file: ctx.fileName, sheet: sheet.name, cell: w.ref } });
    }
    return out;
  }

  // ---------- KUP band sheets ----------
  function parseKup(sheet, ctx) {
    var src = function (ref) { return { file: ctx.fileName, sheet: sheet.name, cell: ref }; };
    var flags = [];
    var topicCell = findCell(sheet, /^หัวข้อ$/, 12);
    var stdCell = findCell(sheet, /^มาตรฐานการประเมิน$/, 12);
    var headerRow = topicCell.row;
    var bandRow = null, bands = [];
    for (var r = headerRow; r <= headerRow + 2 && r <= sheet.maxRow; r++) {
      for (var c = 1; c <= sheet.maxCol; c++) {
        var cell = sheet.raw(r, c);
        var m = cell && /(\d+)\s*-+\s*(\d+)\s*คะแนน/.exec(String(cell.value));
        if (m) { bandRow = r; bands.push({ col: c, min: Number(m[1]), max: Number(m[2]), label: String(cell.value), ref: cell.ref }); }
      }
      if (bands.length) break;
    }
    bands.sort(function (a, b) { return a.col - b.col; });
    for (var bi = 1; bi < bands.length; bi++) if (bands[bi].min === bands[bi - 1].max)
      { flags.push(flag('BAND_BOUNDARY_SHARED', 'info', 'ขอบช่วงคะแนนซ้อนกัน (' + bands[bi - 1].label + ' / ' + bands[bi].label + ') — คะแนนที่ขอบ เช่น ' + bands[bi].min + ' อยู่ได้ทั้งสองช่วง ผู้ตรวจต้องเลือกช่วงก่อนให้คะแนน', src(bands[bi].ref))); break; }
    var colOf = function (re) { var f = null; for (var rr = headerRow; rr <= (bandRow || headerRow); rr++) for (var c2 = 1; c2 <= sheet.maxCol; c2++) { var x = sheet.raw(rr, c2); if (!f && x && re.test(String(x.value))) f = c2; } return f; };
    var cType = colOf(/^ประเภท$/), cImp = colOf(/ระดับความสำคัญ/), cW = colOf(/สัดส่วนน้ำหนัก/), cPrep = colOf(/หัวข้อหลักที่ต้องเตรียม/);
    var cPrepTh = colOf(/หัวข้อหลักที่ต้องเตรียม.*Thai/);
    var cCurrent = colOf(/Current score/i);
    if (cCurrent) flags.push(flag('EXISTING_SCORES_IGNORED', 'info', 'พบคอลัมน์ "Current score" ในชีตนี้ — ไม่นำมาใช้เป็นผลออดิท', src(XlsxReader.toRef(headerRow, cCurrent))));
    // category weights table (row with "การกำหนดค่าน้ำหนักของปัจจัย") and type weights
    var catWeights = {}, typeWeights = {}, levels = [], formulaChecks = [];
    var wRow = findCell(sheet, /การกำหนดค่าน้ำหนักของปัจจัย/, headerRow);
    var nameRow = findCell(sheet, /^Policy Deployment$/, headerRow);
    if (wRow && nameRow) {
      for (var c3 = nameRow.col - 1; c3 <= sheet.maxCol; c3++) {
        var nm = sheet.text(nameRow.row, c3), wv = sheet.raw(wRow.row, c3);
        if (nm && wv && typeof wv.value === 'number') catWeights[normalizeCat(nm)] = { weight: wv.value, ref: wv.ref, name: nm };
      }
    }
    var typeHdr = findCell(sheet, /น้ำหนักคะแนนของแต่ละประเภท/, headerRow);
    if (typeHdr) {
      for (var r4 = typeHdr.row + 1; r4 < headerRow; r4++) {
        var tn = sheet.text(r4, typeHdr.col), tw = null;
        for (var c4 = typeHdr.col + 1; c4 <= typeHdr.col + 3; c4++) { var cw = sheet.raw(r4, c4); if (cw && typeof cw.value === 'number') { tw = cw; break; } }
        var tm = /^\s*([CAK])\b/.exec(tn);
        if (tm && tw) typeWeights[tm[1]] = { weight: tw.value, ref: tw.ref, label: tn.replace(/\s+/g, ' ') };
      }
      for (var r5 = typeHdr.row + 1; r5 < headerRow; r5++) {
        var rng = sheet.text(r5, 1), lvl = sheet.text(r5, 2);
        if (/\d/.test(rng) && lvl) levels.push({ range: rng, level: lvl, description: sheet.text(r5, 3), ref: XlsxReader.toRef(r5, 1) });
      }
    }
    var criteria = [];
    var catOrder = [], cats = {};
    for (var r6 = (bandRow || headerRow) + 1; r6 <= sheet.maxRow; r6++) {
      var stdCellV = sheet.get(r6, stdCell.col);
      if (!stdCellV.value || stdCellV.ref !== XlsxReader.toRef(r6, stdCell.col)) continue;
      var catCell = sheet.get(r6, topicCell.col);
      var catName = sheet.text(r6, topicCell.col);
      var catKey = normalizeCat(catName);
      if (!cats[catKey]) { cats[catKey] = { code: 'K' + (catOrder.length + 1), name: catName, rows: [], source_ref: src(catCell.ref), merge: catCell.merge }; catOrder.push(catKey); }
      var std = String(stdCellV.value);
      var title = firstLine(std).replace(/[:：]\s*$/, '');
      var type = cType ? sheet.text(r6, cType) : '';
      var rowBands = bands.map(function (b, i) {
        var bc = sheet.get(r6, b.col);
        return { index: i, min: b.min, max: b.max, label: b.label, text: bc.value == null ? '' : String(bc.value).trim(), source_ref: src(bc.ref) };
      });
      var weightCell = cW ? sheet.get(r6, cW) : null;
      var c = {
        code: 'KUP-' + cats[catKey].code + '-' + pad(cats[catKey].rows.length + 1), seq: criteria.length + 1, row: r6,
        dimension_code: cats[catKey].code,
        title: { th: title, zh: '', en: '', raw: title },
        requirement: { th: std, zh: '', en: '', raw: std },
        method: { th: (cPrep ? sheet.text(r6, cPrep) : '') + (cPrepTh && cPrepTh !== cPrep && sheet.text(r6, cPrepTh) ? '\n' + sheet.text(r6, cPrepTh) : ''), zh: '', en: '', raw: '' },
        kup_type: type || null, kup_importance: cImp ? sheet.text(r6, cImp) : null,
        category_weight: weightCell && typeof weightCell.value === 'number' ? weightCell.value : null,
        bands: rowBands, max_points: bands.length ? bands[bands.length - 1].max : null, max_points_source: 'BAND',
        sample: null, route_stops: routeStopsForKup(std), time_hint: null,
        source_ref: { file: ctx.fileName, sheet: sheet.name, row: r6, cells: { standard: stdCellV.ref, type: cType ? XlsxReader.toRef(r6, cType) : null } },
        flags: []
      };
      if (!/^[CAK]$/.test(type)) c.flags.push(flag('KUP_TYPE_MISSING', 'review', 'ไม่พบประเภท C/A/K', src(c.source_ref.cells.type)));
      if (rowBands.some(function (b) { return !b.text; })) c.flags.push(flag('KUP_BAND_TEXT_MISSING', 'review', 'บางช่วงคะแนนไม่มีคำอธิบาย', src(stdCellV.ref)));
      cats[catKey].rows.push(r6);
      criteria.push(c);
    }
    // category weight consistency + COUNTIF formula ranges vs actual category rows
    var catList = catOrder.map(function (k) {
      var cat = cats[k];
      var rowWeights = criteria.filter(function (c) { return c.dimension_code === cat.code && c.category_weight != null; }).map(function (c) { return c.category_weight; });
      var w = catWeights[k] ? catWeights[k].weight : (rowWeights.length ? rowWeights[0] : null);
      if (catWeights[k] && rowWeights.some(function (x) { return Math.abs(x - catWeights[k].weight) > 1e-9; }))
        flags.push(flag('CATEGORY_WEIGHT_MISMATCH', 'review', 'น้ำหนักหมวด "' + cat.name + '" ในตารางกับในแถวไม่ตรงกัน', cat.source_ref));
      return { code: cat.code, name: splitLang(cat.name), weight: w, weight_ref: catWeights[k] ? src(catWeights[k].ref) : null,
        first_row: cat.rows[0], last_row: cat.rows[cat.rows.length - 1], source_ref: cat.source_ref, criteria: criteria.filter(function (c) { return c.dimension_code === cat.code; }).map(function (c) { return c.code; }) };
    });
    var wsum = catList.reduce(function (a, c) { return a + (c.weight || 0); }, 0);
    if (catList.length && Math.abs(wsum - 1) > 1e-6) flags.push(flag('CATEGORY_WEIGHT_SUM', 'review', 'ผลรวมน้ำหนักหมวด = ' + wsum.toFixed(4) + ' (ไม่เท่ากับ 1)', null));
    if (nameRow) {
      for (var fr = nameRow.row + 1; fr <= nameRow.row + 2; fr++) for (var fc = nameRow.col; fc <= sheet.maxCol; fc++) {
        var fcell = sheet.raw(fr, fc);
        var fm = fcell && fcell.formula && /COUNTIF\(\s*[A-Z]+(\d+)\s*:\s*[A-Z]+(\d+)\s*,\s*"([CA])"\s*\)/i.exec(fcell.formula);
        if (!fm) continue;
        var cname = normalizeCat(sheet.text(nameRow.row, fc));
        var cat2 = catList.filter(function (x) { return normalizeCat(x.name.raw) === cname; })[0];
        if (!cat2) continue;
        var ok = Number(fm[1]) === cat2.first_row && Number(fm[2]) === cat2.last_row;
        formulaChecks.push({ ref: fcell.ref, formula: fcell.formula, expected: 'I' + cat2.first_row + ':I' + cat2.last_row, ok: ok });
        if (!ok) flags.push(flag('FILE_FORMULA_RANGE', 'review', 'สูตรในไฟล์ ' + fcell.ref + ' ' + fcell.formula + ' ใช้ช่วงแถวไม่ตรงกับหมวด (แถว ' + cat2.first_row + '–' + cat2.last_row + ') — ระบบไม่ใช้สูตรนี้', src(fcell.ref)));
      }
    }
    flags.push(flag('KUP_AGGREGATION_UNDEFINED', 'review',
      'ไฟล์ระบุน้ำหนักหมวดและน้ำหนักประเภท C/A แต่ไม่มีสูตรรวมคะแนนเป็น 0–100 — ระบบจะไม่คำนวณคะแนนรวม KUP จนกว่า Admin จะยืนยันสูตร', null));
    if (!(bands.length)) flags.push(flag('KUP_BANDS_MISSING', 'block', 'ไม่พบหัวคอลัมน์ช่วงคะแนน', null));
    return { criteria: criteria, rules: [], flags: flags, dimensions: catList, bands: bands.map(function (b) { return { min: b.min, max: b.max, label: b.label }; }),
      type_weights: typeWeights, levels: levels, formula_checks: formulaChecks, total_points: 100 };
  }

  function routeStopsForKup(text) {
    var t = String(text || '');
    var out = [];
    if (/บอร์ด|IPO|ตัวชี้วัด|KPI|BI|ดิจิทัล/.test(t)) out.push('BOARD');
    if (/ประชุม|เริ่มกะ|ส่งต่อกะ/.test(t)) out.push('MEETING');
    if (/สถานี|ตำแหน่งงาน|หน้างาน|6S|5ส|OIS/.test(t)) out.push('STATION');
    if (/เอกสาร|บันทึก|แผน|ทะเบียน|PJO|ฝึกอบรม/.test(t)) out.push('RECORDS');
    if (/สัมภาษณ์|สุ่ม.*คน|เข้าใจ/.test(t)) out.push('INTERVIEW');
    if (!out.length) out.push('OTHER');
    return out;
  }

  function normalizeCat(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- similar sheets & diff ----------
  function signature(c) { return (c.title.zh || c.title.th || '').replace(/\s+/g, '').slice(0, 60); }

  function diffCandidates(a, b) {
    var mapB = {};
    b.criteria.forEach(function (c) { mapB[signature(c)] = c; });
    var mapA = {};
    a.criteria.forEach(function (c) { mapA[signature(c)] = c; });
    var onlyA = [], onlyB = [], changed = [];
    a.criteria.forEach(function (c) {
      var o = mapB[signature(c)];
      if (!o) { onlyA.push(c.code + ' ' + signature(c)); return; }
      var diffs = [];
      if ((c.requirement.raw || '') !== (o.requirement.raw || '')) diffs.push('เนื้อหามาตรฐาน');
      if ((c.kup_type || '') !== (o.kup_type || '')) diffs.push('ประเภท ' + c.kup_type + '→' + o.kup_type);
      if ((c.max_points || 0) !== (o.max_points || 0)) diffs.push('คะแนนเต็ม');
      if (c.bands && o.bands) c.bands.forEach(function (bd, i) { if (o.bands[i] && bd.text !== o.bands[i].text) diffs.push('ช่วงคะแนน ' + bd.label); });
      if (diffs.length) changed.push({ code: c.code, other_code: o.code, title: signature(c), changes: diffs });
    });
    b.criteria.forEach(function (c) { if (!mapA[signature(c)]) onlyB.push(c.code + ' ' + signature(c)); });
    return { only_in_first: onlyA, only_in_second: onlyB, changed: changed, same_count: a.criteria.length - onlyA.length - changed.length };
  }

  /**
   * Parse a workbook into candidate standard versions.
   * @param {{sheets:Array}} workbook from XlsxReader.read
   * @param {{fileName:string, fileHash?:string}} meta
   */
  function parseWorkbook(workbook, meta) {
    var ctx0 = { fileName: meta.fileName };
    var result = { parser_version: PARSER_VERSION, file_name: meta.fileName, file_hash: meta.fileHash || null, sheets: [], red_lines: null, composite_weights: [], similar_groups: [] };
    workbook.sheets.forEach(function (sheet) {
      var cls = classifySheet(sheet);
      var entry = { index: sheet.index, name: sheet.name, hidden: sheet.hidden, kind: cls.kind, level: cls.level, unsupported: cls.unsupported || null, title: splitLang(sheet.text(1, 1)) };
      try {
        if (cls.kind === 'HC_LEVEL' && cls.level) entry.candidate = parseHcLevel(sheet, { fileName: meta.fileName, level: cls.level });
        else if (cls.kind === 'KUP_BAND') entry.candidate = parseKup(sheet, { fileName: meta.fileName });
        else if (cls.kind === 'HC_OVERVIEW') {
          result.red_lines = parseRedLines(sheet, ctx0);
          result.composite_weights = parseCompositeWeights(sheet, ctx0);
        }
      } catch (e) {
        entry.error = 'อ่านชีตไม่สำเร็จ: ' + e.message;
      }
      if (entry.candidate) {
        entry.candidate.criteria_count = entry.candidate.criteria.length;
        entry.candidate.flag_count = entry.candidate.flags.length + entry.candidate.criteria.reduce(function (a, c) { return a + c.flags.length; }, 0);
      }
      if (sheet.hidden) entry.note = 'ชีตนี้ถูกซ่อนในไฟล์ต้นฉบับ';
      result.sheets.push(entry);
    });
    // similar sheets: same level among candidates
    var byLevel = {};
    result.sheets.forEach(function (s) { if (s.candidate) (byLevel[s.level] = byLevel[s.level] || []).push(s); });
    Object.keys(byLevel).forEach(function (lvl) {
      var list = byLevel[lvl];
      if (list.length < 2) return;
      var visible = list.filter(function (s) { return !s.hidden; });
      result.similar_groups.push({
        level: lvl, sheet_indexes: list.map(function (s) { return s.index; }),
        recommended_index: (visible[0] || list[0]).index,
        diff: diffCandidates(list[0].candidate, list[1].candidate),
        message_th: 'พบ ' + list.length + ' ชีตสำหรับระดับ ' + lvl + ' — ต้องเลือกฉบับที่ใช้งาน ระบบจะไม่รวมให้อัตโนมัติ'
      });
    });
    return result;
  }

  return {
    PARSER_VERSION: PARSER_VERSION, ROUTE_STOPS: ROUTE_STOPS,
    parseWorkbook: parseWorkbook, extractRules: extractRules, classify: classify, parseSampleSize: parseSampleSize,
    parsePoints: parsePoints, splitLang: splitLang, routeStopsFor: routeStopsFor, diffCandidates: diffCandidates
  };
})();
