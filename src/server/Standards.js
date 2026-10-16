/**
 * Standards — import from Excel, review, edit drafts, publish immutable versions,
 * and manage audit routes.
 */
function readXlsxBlob_(blob) {
  var parts = Utilities.unzip(Utilities.newBlob(blob.getBytes(), 'application/zip', 'x.zip'));
  var files = {};
  parts.forEach(function (b) {
    var n = b.getName();
    if (/\.(xml|rels)$/.test(n) && /^(xl\/(workbook|sharedStrings)\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/sheet\d+\.xml)$/.test(n)) files[n] = b.getDataAsString('UTF-8');
  });
  return XlsxReader.read(files);
}

function standardsFolder_() {
  var root = DriveApp.getFolderById(getProp_('EVIDENCE_FOLDER_ID'));
  var it = root.getFoldersByName('_standards_source');
  return it.hasNext() ? it.next() : root.createFolder('_standards_source');
}

function bytesHash_(bytes) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return d.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** Step 1: upload + parse. Returns the parse preview (nothing is published). */
function apiParseStandardFile(token, fileName, base64) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    if (!/\.xlsx$/i.test(fileName || '')) throw appError_('VALIDATION', 'รองรับเฉพาะไฟล์ .xlsx');
    var bytes = Utilities.base64Decode(base64);
    if (bytes.length > LIMITS.XLSX_MAX_BYTES) throw appError_('TOO_LARGE', 'ไฟล์ใหญ่เกิน 10 MB');
    var hash = bytesHash_(bytes);
    var blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName);
    var wb = readXlsxBlob_(blob);
    var result = StandardParser.parseWorkbook(wb, { fileName: fileName, fileHash: hash });
    var file = standardsFolder_().createFile(blob);
    var prior = Db.find('standard_versions', function (v) { return v.source_file_hash === hash; });
    logAction_(u.id, 'PARSE_STANDARD_FILE', 'files', file.getId(), null, { file_name: fileName, hash: hash }, '');
    return { import_file_id: file.getId(), file_hash: hash, preview: previewOf_(result), already_imported: prior.map(function (v) { return { id: v.id, label: v.version_label, sheet: v.source_sheet_name, status: v.status }; }) };
  });
}

function previewOf_(result) {
  // full candidate data is returned so the review screen can show everything with source cells
  return result;
}

/** Step 2: create a DRAFT version from one chosen sheet (re-parsed server-side from the stored file). */
function apiCreateDraftVersion(token, req) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    var file = DriveApp.getFileById(req.import_file_id);
    var bytes = file.getBlob().getBytes();
    var hash = bytesHash_(bytes);
    var result = StandardParser.parseWorkbook(readXlsxBlob_(file.getBlob()), { fileName: file.getName(), fileHash: hash });
    var sheet = result.sheets.filter(function (s) { return s.index === Number(req.sheet_index); })[0];
    if (!sheet || !sheet.candidate) throw appError_('VALIDATION', 'ชีตนี้ไม่ใช่มาตรฐานที่นำเข้าได้');
    var similar = result.similar_groups.filter(function (g) { return g.sheet_indexes.indexOf(sheet.index) >= 0; })[0];
    if (similar && req.acknowledge_similar !== true)
      throw appError_('NEEDS_CHOICE', similar.message_th + ' — ยืนยันการเลือกชีต "' + sheet.name + '" ก่อนสร้างฉบับร่าง');
    var set = Db.findOne('standard_sets', function (s) { return s.level === sheet.level; });
    if (!set) throw appError_('VALIDATION', 'ไม่พบชุดมาตรฐานระดับ ' + sheet.level);
    if (!req.version_label || !req.effective_date) throw appError_('VALIDATION', 'ต้องระบุชื่อเวอร์ชันและวันที่มีผล');
    var cand = sheet.candidate;
    var rl = result.red_lines && (result.red_lines.applies_to || []).indexOf(sheet.level) >= 0 ? result.red_lines : null;
    var settings = {
      item_floor_zero: null, total_floor_zero: null,
      red_line_points: rl ? rl.penalty : null, red_line_points_source: rl ? rl.penalty_ref : null, red_line_mode: null,
      kup_aggregation: null, kup_aggregation_confirmed: false,
      type_weights: cand.type_weights ? { C: (cand.type_weights.C || {}).weight, A: (cand.type_weights.A || {}).weight, K: (cand.type_weights.K || {}).weight } : null,
      type_weights_source: cand.type_weights || null,
      levels: (cand.levels || []).map(parseLevel_), bands: cand.bands || null,
      composite_weights: result.composite_weights || []
    };
    var flags = cand.flags.slice();
    if (rl) rl.flags.forEach(function (f) { flags.push(f); });
    if (sheet.hidden) flags.push({ code: 'SOURCE_SHEET_HIDDEN', severity: 'review', message_th: 'ชีตต้นทางถูกซ่อนในไฟล์ — ตรวจว่าเป็นฉบับใช้งานจริง', ref: null });
    var version = Db.insert('standard_versions', {
      standard_set_id: set.id, version_label: String(req.version_label), effective_date: String(req.effective_date), status: 'DRAFT',
      source_file_name: file.getName(), source_sheet_name: sheet.name, source_sheet_index: sheet.index, source_file_hash: hash,
      parser_version: result.parser_version, imported_by: u.id, imported_at: nowIso_(), settings: settings,
      dimensions: cand.dimensions.map(function (d) { return { code: d.code, name: d.name, max_points: d.max_points == null ? null : d.max_points, weight: d.weight == null ? null : d.weight, source_ref: d.source_ref, criteria_codes: d.criteria }; }),
      review_flags: flags, review_ack: [], notes: req.notes || ''
    });
    var idByCode = {};
    var critRows = cand.criteria.map(function (c, i) {
      var id = uuid_(); idByCode[c.code] = id;
      return { id: id, standard_version_id: version.id, code: c.code, seq: i + 1, source_seq: c.seq, dimension_code: c.dimension_code, title: c.title,
        requirement: c.requirement, method: c.method, target_role: c.target_role || null, criteria_text: c.criteria_text || null,
        max_points: c.max_points, max_points_source: c.max_points_source, group_max_points: c.group_max_points == null ? null : c.group_max_points,
        kup_type: c.kup_type || '', kup_importance: c.kup_importance || '', category_weight: c.category_weight, bands: c.bands || null,
        sample: c.sample, time_hint: c.time_hint || '', source_ref: c.source_ref, review_flags: c.flags };
    });
    Db.insertMany('audit_criteria', critRows);
    Db.insertMany('scoring_rules', cand.rules.map(function (r, i) {
      return { standard_version_id: version.id, rule_code: r.rule_code, criterion_ids: r.criteria_codes.map(function (c) { return idByCode[c]; }),
        rule_type: r.rule_type, points: r.points, text: r.text, note: r.note || '', parse_status: r.parse_status, source_ref: r.source_ref, seq: i + 1 };
    }));
    if (rl) Db.insertMany('red_line_rules', rl.clauses.map(function (c, i) {
      return { standard_version_id: version.id, clause_code: c.code, text: c.text, source_ref: c.source_ref, seq: i + 1 };
    }));
    createDefaultRoute_(version.id, sheet.level, cand.criteria, idByCode);
    logAction_(u.id, 'CREATE_DRAFT_STANDARD', 'standard_versions', version.id, null, { sheet: sheet.name, criteria: critRows.length, rules: cand.rules.length }, '');
    return { version_id: version.id };
  });
}

function parseLevel_(L) {
  var r = String(L.range || '').replace(/\s/g, '');
  var m;
  if ((m = /^<(\d+)$/.exec(r)) || (m = /^คะแนน<(\d+)$/.exec(r))) return { lt: Number(m[1]), level: L.level, range: L.range };
  if ((m = /^(\d+)-(\d+)$/.exec(r))) return { min: Number(m[1]), max: Number(m[2]) + (Number(m[2]) >= 100 ? 0 : 1), level: L.level, range: L.range };
  return { level: L.level, range: L.range };
}

var ROUTE_ORDER_ = { TEAM: ['MEETING', 'BOARD', 'STATION', 'RECORDS', 'INTERVIEW', 'OTHER'], GROUP: ['MEETING', 'BOARD', 'STATION', 'RECORDS', 'INTERVIEW', 'OTHER'],
  MANAGER: ['MEETING', 'BOARD', 'STATION', 'RECORDS', 'INTERVIEW', 'OTHER'], KUP: ['BOARD', 'RECORDS', 'STATION', 'MEETING', 'INTERVIEW', 'OTHER'] };

function createDefaultRoute_(versionId, level, criteria, idByCode) {
  var names = {};
  StandardParser.ROUTE_STOPS.forEach(function (s) { names[s.code] = s.name_th; });
  names.OTHER = 'อื่น ๆ (ระบุจุดตรวจ)';
  var route = Db.insert('audit_routes', { standard_version_id: versionId, name: 'เส้นทางแนะนำ (สร้างอัตโนมัติ)', is_default: true,
    notes: 'สร้างจากคำสำคัญในวิธีตรวจ/เนื้อหามาตรฐาน — Admin ปรับลำดับและชื่อจุดได้' });
  var stops = [];
  (ROUTE_ORDER_[level] || ROUTE_ORDER_.TEAM).forEach(function (code) {
    var ids = criteria.filter(function (c) { return (c.route_stops || []).indexOf(code) >= 0; }).map(function (c) { return idByCode[c.code]; });
    if (!ids.length) return;
    // a time hint only makes sense for the meeting / shift-start stop
    var hint = code !== 'MEETING' ? '' : (criteria.filter(function (c) { return c.time_hint && (c.route_stops || []).indexOf(code) >= 0; }).map(function (c) { return c.time_hint; })[0] || '');
    stops.push({ route_id: route.id, seq: stops.length + 1, code: code, name: names[code], time_hint: hint, criterion_ids: ids, instructions: '' });
  });
  Db.insertMany('route_stops', stops);
  return route;
}

function versionBundle_(versionId) {
  var v = Db.get('standard_versions', versionId);
  if (!v) throw appError_('NOT_FOUND', 'ไม่พบมาตรฐานเวอร์ชันนี้');
  var set = Db.get('standard_sets', v.standard_set_id);
  var criteria = Db.where('audit_criteria', 'standard_version_id', versionId).sort(function (a, b) { return a.seq - b.seq; });
  var rules = Db.where('scoring_rules', 'standard_version_id', versionId).sort(function (a, b) { return a.seq - b.seq; });
  var redLines = Db.where('red_line_rules', 'standard_version_id', versionId).sort(function (a, b) { return a.seq - b.seq; });
  var routes = Db.where('audit_routes', 'standard_version_id', versionId).map(function (r) {
    r.stops = Db.where('route_stops', 'route_id', r.id).sort(function (a, b) { return a.seq - b.seq; });
    return r;
  });
  return { version: v, set: set, criteria: criteria, rules: rules, red_lines: redLines, routes: routes };
}

/** Publish readiness — every 'review' flag must be acknowledged and every decision made. */
function publishCheck_(b) {
  var problems = [];
  var v = b.version, s = v.settings || {};
  var mode = b.set.scoring_mode;
  b.rules.forEach(function (r) { if (r.parse_status === 'NEEDS_REVIEW') problems.push('กฎ ' + r.rule_code + ' ยังรอตรวจทาน'); });
  if (mode === 'DEDUCTION') {
    b.criteria.forEach(function (c) { if (c.max_points == null) problems.push('ข้อ ' + c.code + ' ยังไม่มีคะแนนเต็ม'); });
    (v.dimensions || []).forEach(function (d) {
      var items = b.criteria.filter(function (c) { return c.dimension_code === d.code; });
      var sum = items.reduce(function (a, c) { return a + (c.max_points || 0); }, 0);
      if (d.max_points != null && items.every(function (c) { return c.max_points != null; }) && Math.abs(sum - d.max_points) > 1e-9)
        problems.push('หัวข้อ ' + d.code + ': ผลรวมรายข้อ ' + sum + ' ≠ ' + d.max_points);
    });
    if (s.item_floor_zero !== true && s.item_floor_zero !== false) problems.push('ยังไม่ได้ตัดสินว่า "คะแนนรายข้อต่ำสุดเป็น 0" หรือไม่');
    if (b.red_lines.length && s.total_floor_zero !== true && s.total_floor_zero !== false) problems.push('ยังไม่ได้ตัดสินว่า "คะแนนรวมต่ำสุดเป็น 0 หลังหัก Red Line" หรือไม่');
  }
  b.criteria.forEach(function (c) { if (c.sample && c.sample.status === 'NEEDS_REVIEW') problems.push('ข้อ ' + c.code + ': จำนวนตัวอย่างรอตรวจทาน'); });
  var acked = {};
  (v.review_ack || []).forEach(function (a) { acked[a.key] = true; });
  allFlags_(b).forEach(function (f) { if (f.severity === 'review' && !acked[f.key]) problems.push('ยังไม่ได้ยืนยันการตรวจทาน: ' + f.message_th); if (f.severity === 'block') problems.push('ข้อผิดพลาด: ' + f.message_th); });
  var routeIds = {};
  b.routes.forEach(function (r) { r.stops.forEach(function (st) { (st.criterion_ids || []).forEach(function (id) { routeIds[id] = true; }); }); });
  var missingRoute = b.criteria.filter(function (c) { return !routeIds[c.id]; }).map(function (c) { return c.code; });
  if (missingRoute.length) problems.push('ข้อที่ไม่อยู่ในเส้นทางการออดิท: ' + missingRoute.join(', '));
  var warnings = [];
  if (b.red_lines.length && !s.red_line_mode) warnings.push('ยังไม่ได้กำหนดวิธีนับ Red Line — ถ้าพบ Red Line คะแนนสุดท้ายจะถูกระงับและปิดรอบตรวจไม่ได้');
  if (mode === 'BAND' && !(s.kup_aggregation === 'FILE_WEIGHTS_V1' && s.kup_aggregation_confirmed)) warnings.push('ยังไม่ได้ยืนยันสูตรรวม KUP — จะแสดงได้เฉพาะคะแนนรายข้อ และปิดรอบตรวจไม่ได้');
  return { ready: problems.length === 0, problems: problems, warnings: warnings };
}

function allFlags_(b) {
  var out = [];
  (b.version.review_flags || []).forEach(function (f, i) { out.push(withKey_(f, 'V' + i)); });
  b.criteria.forEach(function (c) { (c.review_flags || []).forEach(function (f, i) { var x = withKey_(f, c.code + ':' + i); x.criterion_code = c.code; out.push(x); }); });
  return out;
}
function withKey_(f, key) { var x = JSON.parse(JSON.stringify(f)); x.key = key; return x; }

function apiListStandards(token) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.view');
    var versions = Db.all('standard_versions');
    return Db.all('standard_sets').map(function (s) {
      s.versions = versions.filter(function (v) { return v.standard_set_id === s.id; }).map(function (v) {
        return { id: v.id, version_label: v.version_label, effective_date: v.effective_date, status: v.status, source_file_name: v.source_file_name,
          source_sheet_name: v.source_sheet_name, published_at: v.published_at, imported_at: v.imported_at };
      }).sort(function (a, b) { return String(b.imported_at).localeCompare(String(a.imported_at)); });
      return s;
    });
  });
}

function apiGetStandardVersion(token, versionId) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.view');
    var b = versionBundle_(versionId);
    b.flags = allFlags_(b);
    b.publish_check = b.version.status === 'DRAFT' ? publishCheck_(b) : null;
    return b;
  });
}

function requireDraft_(versionId) {
  var v = Db.get('standard_versions', versionId);
  if (!v) throw appError_('NOT_FOUND', 'ไม่พบมาตรฐาน');
  if (v.status !== 'DRAFT') throw appError_('IMMUTABLE', 'มาตรฐานที่ประกาศใช้แล้วแก้ไขไม่ได้ — สร้างฉบับใหม่ (Clone) เพื่อแก้ไข');
  return v;
}

function apiUpdateDraftCriterion(token, criterionId, patch, expectedVersion, reason) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    var c = Db.get('audit_criteria', criterionId);
    requireDraft_(c.standard_version_id);
    var allowed = {};
    if ('max_points' in patch) allowed.max_points = patch.max_points === '' || patch.max_points == null ? null : Number(patch.max_points);
    if ('max_points' in patch) allowed.max_points_source = 'ADMIN';
    if ('sample' in patch) {
      var s = patch.sample;
      allowed.sample = s == null ? null : { count: Number(s.count), per: s.per || null, unit: String(s.unit || ''), text: (c.sample && c.sample.text) || '', status: 'ADMIN_CONFIRMED', note: s.note || '' };
    }
    if ('time_hint' in patch) allowed.time_hint = String(patch.time_hint || '');
    if (!reason) throw appError_('VALIDATION', 'ต้องระบุเหตุผลการแก้ไข');
    var saved = Db.update('audit_criteria', criterionId, allowed, expectedVersion);
    logAction_(u.id, 'EDIT_DRAFT_CRITERION', 'audit_criteria', criterionId, c, saved, reason);
    return saved;
  });
}

function apiUpdateDraftRule(token, ruleId, patch, expectedVersion, reason) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    var r = Db.get('scoring_rules', ruleId);
    requireDraft_(r.standard_version_id);
    if (!reason) throw appError_('VALIDATION', 'ต้องระบุเหตุผลการแก้ไข');
    var allowed = { parse_status: 'ADMIN_CONFIRMED' };
    if (patch.rule_type) {
      if (['PER_OCCURRENCE', 'ONCE', 'ZERO_SCORE', 'NO_DEDUCTION'].indexOf(patch.rule_type) < 0) throw appError_('VALIDATION', 'ประเภทกฎไม่ถูกต้อง');
      allowed.rule_type = patch.rule_type;
    }
    if ('points' in patch) allowed.points = patch.points === '' || patch.points == null ? null : Number(patch.points);
    var type = allowed.rule_type || r.rule_type;
    var pts = 'points' in allowed ? allowed.points : r.points;
    if ((type === 'PER_OCCURRENCE' || type === 'ONCE') && !(pts > 0)) throw appError_('VALIDATION', 'กฎหักคะแนนต้องมีจำนวนคะแนนมากกว่า 0');
    allowed.note = (r.note ? r.note + ' | ' : '') + 'Admin ยืนยัน: ' + reason;
    var saved = Db.update('scoring_rules', ruleId, allowed, expectedVersion);
    logAction_(u.id, 'EDIT_DRAFT_RULE', 'scoring_rules', ruleId, r, saved, reason);
    return saved;
  });
}

function apiUpdateDraftSettings(token, versionId, patch, expectedVersion, reason) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    var v = requireDraft_(versionId);
    if (!reason) throw appError_('VALIDATION', 'ต้องระบุเหตุผล');
    var s = JSON.parse(JSON.stringify(v.settings || {}));
    if ('item_floor_zero' in patch) s.item_floor_zero = patch.item_floor_zero === null ? null : !!patch.item_floor_zero;
    if ('total_floor_zero' in patch) s.total_floor_zero = patch.total_floor_zero === null ? null : !!patch.total_floor_zero;
    if ('red_line_mode' in patch) {
      if ([null, 'ONCE', 'PER_CLAUSE', 'PER_OCCURRENCE'].indexOf(patch.red_line_mode) < 0) throw appError_('VALIDATION', 'วิธีนับ Red Line ไม่ถูกต้อง');
      s.red_line_mode = patch.red_line_mode;
    }
    if ('red_line_points' in patch) s.red_line_points = patch.red_line_points == null ? null : Number(patch.red_line_points);
    if ('kup_aggregation' in patch) {
      if ([null, 'FILE_WEIGHTS_V1'].indexOf(patch.kup_aggregation) < 0) throw appError_('VALIDATION', 'สูตรไม่ถูกต้อง');
      s.kup_aggregation = patch.kup_aggregation;
      s.kup_aggregation_confirmed = patch.kup_aggregation === 'FILE_WEIGHTS_V1' && patch.kup_aggregation_confirmed === true;
    }
    s.decisions = (s.decisions || []).concat([{ by: u.id, at: nowIso_(), patch: patch, reason: reason }]);
    var saved = Db.update('standard_versions', versionId, { settings: s }, expectedVersion);
    logAction_(u.id, 'EDIT_DRAFT_SETTINGS', 'standard_versions', versionId, v.settings, s, reason);
    return saved;
  });
}

function apiAcknowledgeFlags(token, versionId, keys, expectedVersion, comment) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    var v = requireDraft_(versionId);
    var ack = (v.review_ack || []).slice();
    var have = {};
    ack.forEach(function (a) { have[a.key] = true; });
    (keys || []).forEach(function (k) { if (!have[k]) ack.push({ key: k, by: u.id, at: nowIso_(), comment: comment || '' }); });
    var saved = Db.update('standard_versions', versionId, { review_ack: ack }, expectedVersion);
    logAction_(u.id, 'ACK_FLAGS', 'standard_versions', versionId, null, { keys: keys }, comment || '');
    return saved;
  });
}

function apiPublishVersion(token, versionId, expectedVersion) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    return Db.transaction(function () {
      requireDraft_(versionId);
      var b = versionBundle_(versionId);
      var chk = publishCheck_(b);
      if (!chk.ready) { var e = appError_('NOT_READY', 'ยังประกาศใช้ไม่ได้ (' + chk.problems.length + ' รายการ)'); e.details = chk.problems; throw e; }
      var content = JSON.stringify({ c: b.criteria.map(function (c) { return [c.code, c.max_points, c.bands, c.requirement]; }), r: b.rules.map(function (r) { return [r.rule_code, r.rule_type, r.points, r.criterion_ids]; }), s: b.version.settings });
      var hash = sha256Hex_(content);
      // retire older published versions of the same set (they remain referenced by past audits, unchanged)
      Db.find('standard_versions', function (x) { return x.standard_set_id === b.version.standard_set_id && x.status === 'PUBLISHED'; }).forEach(function (old) {
        Db.update('standard_versions', old.id, { status: 'RETIRED' });
      });
      var saved = Db.update('standard_versions', versionId, { status: 'PUBLISHED', published_by: u.id, published_at: nowIso_(), content_hash: hash }, expectedVersion);
      logAction_(u.id, 'PUBLISH_STANDARD', 'standard_versions', versionId, null, { content_hash: hash, warnings: chk.warnings }, '');
      return { version: saved, warnings: chk.warnings };
    });
  });
}

/** Create a new DRAFT copy of a version (to revise a published standard without touching past results). */
function apiCloneVersion(token, versionId, label, effectiveDate) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    var b = versionBundle_(versionId);
    var v = b.version;
    var nv = Db.insert('standard_versions', { standard_set_id: v.standard_set_id, version_label: label, effective_date: effectiveDate, status: 'DRAFT',
      source_file_name: v.source_file_name, source_sheet_name: v.source_sheet_name, source_sheet_index: v.source_sheet_index, source_file_hash: v.source_file_hash,
      parser_version: v.parser_version, imported_by: u.id, imported_at: nowIso_(), settings: v.settings, dimensions: v.dimensions,
      review_flags: v.review_flags, review_ack: v.review_ack, notes: 'คัดลอกจาก ' + v.version_label });
    var map = {};
    Db.insertMany('audit_criteria', b.criteria.map(function (c) { var n = JSON.parse(JSON.stringify(c)); map[c.id] = n.id = uuid_(); n.standard_version_id = nv.id; delete n.version; delete n.created_at; return n; }));
    Db.insertMany('scoring_rules', b.rules.map(function (r) { var n = JSON.parse(JSON.stringify(r)); delete n.id; delete n.version; delete n.created_at; n.standard_version_id = nv.id; n.criterion_ids = r.criterion_ids.map(function (i) { return map[i]; }); return n; }));
    Db.insertMany('red_line_rules', b.red_lines.map(function (r) { var n = JSON.parse(JSON.stringify(r)); delete n.id; delete n.version; delete n.created_at; n.standard_version_id = nv.id; return n; }));
    b.routes.forEach(function (rt) {
      var nr = Db.insert('audit_routes', { standard_version_id: nv.id, name: rt.name, is_default: rt.is_default, notes: rt.notes });
      Db.insertMany('route_stops', rt.stops.map(function (s) { return { route_id: nr.id, seq: s.seq, code: s.code, name: s.name, time_hint: s.time_hint, criterion_ids: s.criterion_ids.map(function (i) { return map[i]; }), instructions: s.instructions }; }));
    });
    logAction_(u.id, 'CLONE_STANDARD', 'standard_versions', nv.id, null, { from: versionId }, '');
    return { version_id: nv.id };
  });
}

/** Permanently delete a DRAFT version (never a published/retired one, and never one an audit refers to). */
function apiDeleteDraftVersion(token, versionId) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    return Db.transaction(function () {
      var v = requireDraft_(versionId);
      if (Db.find('audits', function (a) { return a.standard_version_id === versionId; }).length)
        throw appError_('IN_USE', 'ลบไม่ได้ เพราะมีรอบตรวจอ้างอิงฉบับนี้อยู่');
      var routes = Db.find('audit_routes', function (r) { return r.standard_version_id === versionId; });
      routes.forEach(function (r) {
        Db.find('route_stops', function (st) { return st.route_id === r.id; }).forEach(function (st) { Db.remove('route_stops', st.id); });
        Db.remove('audit_routes', r.id);
      });
      ['red_line_rules', 'scoring_rules', 'audit_criteria'].forEach(function (t) {
        Db.find(t, function (x) { return x.standard_version_id === versionId; }).forEach(function (x) { Db.remove(t, x.id); });
      });
      Db.remove('standard_versions', versionId);
      logAction_(u.id, 'DELETE_DRAFT_STANDARD', 'standard_versions', versionId, { version_label: v.version_label, source_sheet_name: v.source_sheet_name }, null, '');
      return { deleted: versionId };
    });
  });
}

/** Save a route's stops (does not affect scores). Every criterion must appear in at least one stop. */
function apiSaveRoute(token, routeId, stops, name) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'standard.manage');
    var route = Db.get('audit_routes', routeId);
    if (!route) throw appError_('NOT_FOUND', 'ไม่พบเส้นทาง');
    var crit = Db.where('audit_criteria', 'standard_version_id', route.standard_version_id);
    var valid = {};
    crit.forEach(function (c) { valid[c.id] = true; });
    var covered = {};
    stops.forEach(function (s) {
      if (!String(s.name || '').trim()) throw appError_('VALIDATION', 'ทุกจุดต้องมีชื่อ');
      (s.criterion_ids || []).forEach(function (id) { if (!valid[id]) throw appError_('FK', 'มีข้อที่ไม่อยู่ในมาตรฐานนี้'); covered[id] = true; });
    });
    var missing = crit.filter(function (c) { return !covered[c.id]; }).map(function (c) { return c.code; });
    if (missing.length) throw appError_('VALIDATION', 'ทุกข้อต้องอยู่ในเส้นทางอย่างน้อย 1 จุด — ยังขาด: ' + missing.join(', '));
    var existing = Db.where('route_stops', 'route_id', routeId);
    var keep = {};
    stops.forEach(function (s, i) {
      var rec = { route_id: routeId, seq: i + 1, code: s.code || 'CUSTOM', name: String(s.name).trim(), time_hint: s.time_hint || '', criterion_ids: s.criterion_ids || [], instructions: s.instructions || '' };
      if (s.id && existing.some(function (e) { return e.id === s.id; })) { Db.update('route_stops', s.id, rec); keep[s.id] = true; }
      else Db.insert('route_stops', rec);
    });
    // removed stops are emptied (kept for past visit history) and moved to the end
    existing.filter(function (e) { return !keep[e.id]; }).forEach(function (e) { Db.update('route_stops', e.id, { criterion_ids: [], seq: 999, name: e.name + ' (ยกเลิก)' }); });
    if (name) Db.update('audit_routes', routeId, { name: name });
    logAction_(u.id, 'SAVE_ROUTE', 'audit_routes', routeId, null, { stops: stops.length }, '');
    return versionBundle_(route.standard_version_id).routes;
  });
}
