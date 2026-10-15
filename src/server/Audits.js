/**
 * Audits — create rounds, autosave item drafts, route visits, red lines,
 * exemptions, live scoring and the confirm transaction.
 */
var AUDIT_TYPES = { TEAM: 'TEAM', GROUP: 'GROUP', KUP: 'KUP', MANAGER: 'MANAGER' };

function apiMasterData(token) {
  return guard_(token, function (u) {
    var inScope = function (w) { return Permissions.inScope(u, w.id) || u.role === 'ADMIN'; };
    var workshops = Db.all('workshops').filter(function (w) { return w.active && inScope(w); });
    var wsIds = {}; workshops.forEach(function (w) { wsIds[w.id] = true; });
    var sets = Db.all('standard_sets');
    var versions = Db.find('standard_versions', function (v) { return v.status === 'PUBLISHED'; }).map(function (v) {
      var s = sets.filter(function (x) { return x.id === v.standard_set_id; })[0];
      return { id: v.id, version_label: v.version_label, effective_date: v.effective_date, level: s.level, set_name: s.name_th, enabled_for_audit: s.enabled_for_audit,
        routes: Db.where('audit_routes', 'standard_version_id', v.id).map(function (r) { return { id: r.id, name: r.name, is_default: r.is_default }; }) };
    });
    return {
      user: publicUser_(u), ai: aiConfig_(),
      workshops: workshops,
      groups: Db.find('groups', function (g) { return g.active && wsIds[g.workshop_id]; }),
      teams: Db.find('teams', function (t) { return t.active && wsIds[t.workshop_id]; }),
      versions: versions,
      auditors: Db.find('users', function (x) { return x.active && (x.role === 'AUDITOR' || x.role === 'ADMIN'); }).map(function (x) { return { id: x.id, display_name: x.display_name }; }),
      owners: Db.find('users', function (x) { return x.active && x.role === 'WORKSHOP_OWNER'; }).map(function (x) { return { id: x.id, display_name: x.display_name, scope_workshop_ids: x.scope_workshop_ids }; }),
      limits: LIMITS, evidence_kinds: EVIDENCE_KINDS, app_version: APP_VERSION
    };
  });
}

function apiSaveMaster(token, table, data) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'master.manage');
    if (['workshops', 'groups', 'teams'].indexOf(table) < 0) throw appError_('VALIDATION', 'ตารางไม่ถูกต้อง');
    var rec = {};
    var fields = { workshops: ['code', 'name_th', 'name_en', 'name_zh', 'active'], groups: ['workshop_id', 'code', 'name', 'leader_name', 'active'], teams: ['workshop_id', 'group_id', 'code', 'name', 'leader_name', 'active'] }[table];
    fields.forEach(function (f) { if (f in data) rec[f] = data[f]; });
    if (!String(rec.code || '').trim() && !data.id) throw appError_('VALIDATION', 'ต้องระบุรหัส');
    if (table === 'teams' && rec.group_id) {
      var g = Db.get('groups', rec.group_id);
      if (!g || g.workshop_id !== rec.workshop_id) throw appError_('VALIDATION', 'Group ไม่อยู่ใน Workshop นี้');
    }
    var saved;
    if (data.id) { var before = Db.get(table, data.id); saved = Db.update(table, data.id, rec, data.version); logAction_(u.id, 'UPDATE_' + table, table, data.id, before, saved, ''); }
    else { rec.active = rec.active !== false; rec.is_demo = !!data.is_demo; saved = Db.insert(table, rec); logAction_(u.id, 'CREATE_' + table, table, saved.id, null, saved, ''); }
    return saved;
  });
}

function nextAuditNo_() {
  var ym = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMM');
  var prefix = 'CPS-' + ym + '-';
  var n = Db.find('audits', function (a) { return String(a.audit_no).indexOf(prefix) === 0; }).length + 1;
  return prefix + ('000' + n).slice(-4);
}

function resolveSample_(criterion, teamCount) {
  var s = criterion.sample;
  if (!s || !(s.count > 0)) return null;
  if (s.per === 'TEAM') return teamCount > 0 ? s.count * teamCount : null;
  if (s.per === 'SECTION' || s.per === 'AREA') return null; // number of sections not known in master data
  return s.count;
}

function apiCreateAudit(token, req) {
  return guard_(token, function (u) {
    var ws = Db.get('workshops', req.workshop_id);
    if (!ws) throw appError_('VALIDATION', 'ต้องเลือก Workshop');
    Permissions.assert(u, 'audit.create', { workshop_id: ws.id });
    var v = Db.get('standard_versions', req.standard_version_id);
    if (!v || v.status !== 'PUBLISHED') throw appError_('VALIDATION', 'ต้องเลือกมาตรฐานที่ประกาศใช้แล้ว');
    var set = Db.get('standard_sets', v.standard_set_id);
    if (!set.enabled_for_audit) throw appError_('VALIDATION', 'มาตรฐานระดับนี้ยังไม่เปิดใช้สำหรับการออดิทในรุ่นนี้');
    if (set.level !== req.audit_type) throw appError_('VALIDATION', 'ประเภทการตรวจไม่ตรงกับมาตรฐานที่เลือก');
    if ((req.audit_type === 'TEAM') && !req.team_id) throw appError_('VALIDATION', 'การตรวจระดับทีมต้องเลือก Team');
    if ((req.audit_type === 'GROUP') && !req.group_id) throw appError_('VALIDATION', 'การตรวจระดับกลุ่มต้องเลือก Group');
    if (req.group_id) { var g = Db.get('groups', req.group_id); if (!g || g.workshop_id !== ws.id) throw appError_('VALIDATION', 'Group ไม่อยู่ใน Workshop นี้'); }
    if (req.team_id) { var t = Db.get('teams', req.team_id); if (!t || t.workshop_id !== ws.id) throw appError_('VALIDATION', 'Team ไม่อยู่ใน Workshop นี้'); }
    if (!req.audit_date) throw appError_('VALIDATION', 'ต้องระบุวันที่ตรวจ');
    var auditor = Db.get('users', req.auditor_user_id || u.id);
    var criteria = Db.where('audit_criteria', 'standard_version_id', v.id).sort(function (a, b) { return a.seq - b.seq; });
    var partial = req.scope_mode === 'PARTIAL';
    var chosen = {};
    (req.criterion_ids || []).forEach(function (id) { chosen[id] = true; });
    if (partial && !Object.keys(chosen).length) throw appError_('VALIDATION', 'การตรวจบางส่วนต้องเลือกอย่างน้อย 1 ข้อ');
    var routes = Db.where('audit_routes', 'standard_version_id', v.id);
    var route = routes.filter(function (r) { return r.id === req.route_id; })[0] || routes.filter(function (r) { return r.is_default; })[0] || routes[0];
    var teamCount = req.audit_type === 'GROUP' ? (Number(req.team_count) || Db.find('teams', function (t) { return t.group_id === req.group_id && t.active; }).length) : 1;
    var audit = Db.insert('audits', {
      audit_no: nextAuditNo_(), audit_type: req.audit_type, standard_version_id: v.id, workshop_id: ws.id, group_id: req.group_id || '', team_id: req.team_id || '',
      route_id: route ? route.id : '', scope_mode: partial ? 'PARTIAL' : 'FULL', scope_note: req.scope_note || '', auditor_user_id: auditor.id,
      auditor_name: auditor.display_name, auditee_name: String(req.auditee_name || ''), audit_date: String(req.audit_date), status: 'DRAFT',
      team_count: teamCount, is_demo: !!ws.is_demo, created_by: u.id, score_status: 'NOT_STARTED'
    });
    Db.insertMany('audit_items', criteria.map(function (c) {
      return { audit_id: audit.id, criterion_id: c.id, seq: c.seq, in_scope: partial ? !!chosen[c.id] : true, status: 'NOT_STARTED', issues: [],
        sample_required: resolveSample_(c, teamCount), sample_collected: 0, exemption_status: '' };
    }));
    logAction_(u.id, 'CREATE_AUDIT', 'audits', audit.id, null, { audit_no: audit.audit_no, scope: audit.scope_mode, criteria: partial ? Object.keys(chosen).length : criteria.length }, '');
    return { audit_id: audit.id, audit_no: audit.audit_no };
  });
}

function loadAudit_(u, auditId, action) {
  var a = Db.get('audits', auditId);
  if (!a) throw appError_('NOT_FOUND', 'ไม่พบรอบตรวจ');
  Permissions.assert(u, action || 'audit.view', { workshop_id: a.workshop_id, audit_status: a.status });
  return a;
}

function itemEvidenceStats_(itemIds) {
  var links = Db.find('audit_item_evidence', function (l) { return itemIds[l.audit_item_id]; });
  var ev = {};
  Db.all('evidence_files').forEach(function (e) { if (!e.deleted) ev[e.id] = e; });
  var stats = {};
  links.forEach(function (l) {
    var e = ev[l.evidence_id];
    if (!e) return;
    var s = stats[l.audit_item_id] = stats[l.audit_item_id] || { count: 0, samples: {} };
    s.count++;
    if (e.sample_label) s.samples[e.sample_label] = true;
  });
  return stats;
}

function scoreAudit_(audit, bundle, items) {
  var ids = {};
  items.forEach(function (i) { ids[i.id] = true; });
  var stats = itemEvidenceStats_(ids);
  var redLines = Db.where('audit_red_lines', 'audit_id', audit.id);
  return Scoring.computeAudit({
    mode: bundle.set.scoring_mode, settings: bundle.version.settings || {}, dimensions: bundle.version.dimensions || [],
    criteria: bundle.criteria.map(function (c) { return { id: c.id, code: c.code, max_points: c.max_points, dimension_code: c.dimension_code, kup_type: c.kup_type, bands: c.bands }; }),
    rules: bundle.rules.map(function (r) { return { id: r.id, rule_code: r.rule_code, rule_type: r.rule_type, points: r.points, parse_status: r.parse_status, criterion_ids: r.criterion_ids }; }),
    items: items.map(function (i) {
      var s = stats[i.id] || { count: 0, samples: {} };
      return { criterion_id: i.criterion_id, in_scope: i.in_scope, result: i.result, issues: i.issues || [], band_index: i.band_index, band_score: i.band_score,
        override_score: i.override_score, override_reason: i.override_reason, exemption_status: i.exemption_status, auditor_notes: i.auditor_notes,
        evidence_count: s.count, sample_required: i.sample_required, sample_collected: Object.keys(s.samples).length };
    }),
    red_lines: redLines.map(function (r) { return { status: r.status, clause_code: r.clause_code }; })
  });
}

function apiGetAudit(token, auditId) {
  return guard_(token, function (u) {
    var a = loadAudit_(u, auditId);
    var bundle = versionBundle_(a.standard_version_id);
    var items = Db.where('audit_items', 'audit_id', a.id).sort(function (x, y) { return x.seq - y.seq; });
    var itemIds = {}; items.forEach(function (i) { itemIds[i.id] = true; });
    var links = Db.find('audit_item_evidence', function (l) { return itemIds[l.audit_item_id]; });
    var canSeeEvidence = Permissions.can(u, 'evidence.view', { workshop_id: a.workshop_id });
    var evidence = canSeeEvidence ? Db.find('evidence_files', function (e) { return e.audit_id === a.id && !e.deleted; }).map(evidencePublic_) : [];
    var runs = Db.find('ai_analysis_runs', function (r) { return itemIds[r.audit_item_id]; });
    var latestRun = {};
    runs.forEach(function (r) { var cur = latestRun[r.audit_item_id]; if (!cur || String(r.started_at) > String(cur.started_at)) latestRun[r.audit_item_id] = r; });
    var route = bundle.routes.filter(function (r) { return r.id === a.route_id; })[0] || bundle.routes[0] || null;
    return {
      audit: a, standard: { version: bundle.version, set: bundle.set, criteria: bundle.criteria, rules: bundle.rules, red_lines: bundle.red_lines },
      route: route, visits: Db.where('route_visits', 'audit_id', a.id), items: items, links: canSeeEvidence ? links : [], evidence: evidence,
      ai_runs: Object.keys(latestRun).map(function (k) { return runPublic_(latestRun[k]); }),
      red_lines: Db.where('audit_red_lines', 'audit_id', a.id), findings: Db.where('findings', 'audit_id', a.id),
      score: scoreAudit_(a, bundle, items),
      workshop: Db.get('workshops', a.workshop_id), group: a.group_id ? Db.get('groups', a.group_id) : null, team: a.team_id ? Db.get('teams', a.team_id) : null,
      permissions: { edit: Permissions.can(u, 'audit.edit', { workshop_id: a.workshop_id, audit_status: a.status }),
        confirm: Permissions.can(u, 'audit.confirm', { workshop_id: a.workshop_id, audit_status: a.status }),
        approve_exemption: Permissions.can(u, 'exemption.approve'), evidence: canSeeEvidence },
      ai: aiConfig_(),
      history: Permissions.can(u, 'finding.view', { workshop_id: a.workshop_id, audit_status: 'CONFIRMED' }) ? unitHistory_(a) : null
    };
  });
}

/**
 * Previous confirmed audits of the same unit (team for TEAM, group for GROUP, workshop otherwise)
 * and their findings, so the auditor can re-check last time's issues.
 */
function unitHistory_(a) {
  var key = a.audit_type === 'TEAM' ? 'team_id' : a.audit_type === 'GROUP' ? 'group_id' : 'workshop_id';
  if (!a[key]) return { previous: null, audits: [], findings: [], open_count: 0 };
  var prev = Db.find('audits', function (x) { return x.id !== a.id && x.status === 'CONFIRMED' && x.audit_type === a.audit_type && x[key] === a[key]; })
    .sort(function (x, y) { return String(y.audit_date + y.confirmed_at).localeCompare(String(x.audit_date + x.confirmed_at)); }).slice(0, 3);
  var ids = {}; prev.forEach(function (p) { ids[p.id] = p; });
  var findings = Db.find('findings', function (f) { return ids[f.audit_id]; }).map(function (f) {
    var p = ids[f.audit_id];
    return { id: f.id, issue_no: f.issue_no, criterion_code: f.criterion_code, description: f.description, status: f.status, is_red_line: f.is_red_line,
      audit_no: p.audit_no, audit_date: p.audit_date, due_date: f.due_date };
  });
  return {
    previous: prev[0] ? { id: prev[0].id, audit_no: prev[0].audit_no, audit_date: prev[0].audit_date, final_score: prev[0].final_score, final_of_max: prev[0].final_of_max, scope_mode: prev[0].scope_mode } : null,
    audits: prev.map(function (p) { return { id: p.id, audit_no: p.audit_no, audit_date: p.audit_date, final_score: p.final_score, final_of_max: p.final_of_max }; }),
    findings: findings,
    open_count: findings.filter(function (f) { return f.status !== 'CLOSED'; }).length
  };
}

function runPublic_(r) {
  return { id: r.id, audit_item_id: r.audit_item_id, kind: r.kind, status: r.status, provider: r.provider, model: r.model, prompt_version: r.prompt_version,
    started_at: r.started_at, finished_at: r.finished_at, parsed: r.parsed, validation_errors: r.validation_errors, warnings: r.warnings,
    error_message: r.error_message, skipped_evidence: r.skipped_evidence, input_evidence_ids: r.input_evidence_ids, attempt: r.attempt, engine_proposal: r.engine_proposal };
}

function apiListAudits(token, filters) {
  return guard_(token, function (u) {
    filters = filters || {};
    var list = Db.find('audits', function (a) {
      if (!Permissions.can(u, 'audit.view', { workshop_id: a.workshop_id, audit_status: a.status })) return false;
      if (!filters.include_demo && a.is_demo) return false;
      if (filters.status && a.status !== filters.status) return false;
      if (filters.statuses && filters.statuses.indexOf(a.status) < 0) return false;
      if (filters.workshop_id && a.workshop_id !== filters.workshop_id) return false;
      if (filters.audit_type && a.audit_type !== filters.audit_type) return false;
      if (filters.from && a.audit_date < filters.from) return false;
      if (filters.to && a.audit_date > filters.to) return false;
      return true;
    });
    var ws = indexById_(Db.all('workshops')), gs = indexById_(Db.all('groups')), ts = indexById_(Db.all('teams')), vs = indexById_(Db.all('standard_versions'));
    return list.sort(function (a, b) { return String(b.audit_date + b.created_at).localeCompare(String(a.audit_date + a.created_at)); }).map(function (a) {
      return { id: a.id, audit_no: a.audit_no, audit_type: a.audit_type, status: a.status, scope_mode: a.scope_mode, audit_date: a.audit_date,
        workshop: (ws[a.workshop_id] || {}).code, group: (gs[a.group_id] || {}).name || '', team: (ts[a.team_id] || {}).name || '',
        version_label: (vs[a.standard_version_id] || {}).version_label, auditor_name: a.auditor_name, final_score: a.final_score, final_of_max: a.final_of_max,
        provisional_score: a.provisional_score, provisional_of_max: a.provisional_of_max, coverage_pct: a.coverage_pct, score_status: a.score_status, is_demo: a.is_demo };
    });
  });
}

function indexById_(list) { var m = {}; list.forEach(function (x) { m[x.id] = x; }); return m; }

/** Autosave of one item. patch may contain notes/result/issues/band/override; mark_reviewed=true records the reviewer. */
function apiSaveItemDraft(token, itemId, patch, expectedVersion) {
  return guard_(token, function (u) {
    var item = Db.get('audit_items', itemId);
    if (!item) throw appError_('NOT_FOUND', 'ไม่พบข้อตรวจ');
    var a = loadAudit_(u, item.audit_id, 'audit.edit');
    var crit = Db.get('audit_criteria', item.criterion_id);
    var rec = {};
    if ('auditor_notes' in patch) rec.auditor_notes = String(patch.auditor_notes || '');
    if ('result' in patch) {
      if (patch.result && AiSchema.RESULTS.indexOf(patch.result) < 0) throw appError_('VALIDATION', 'ผลการตรวจไม่ถูกต้อง');
      rec.result = patch.result || '';
    }
    if ('issues' in patch) {
      var rules = Db.where('scoring_rules', 'standard_version_id', a.standard_version_id);
      var ok = {}; rules.forEach(function (r) { if ((r.criterion_ids || []).indexOf(crit.id) >= 0) ok[r.id] = true; });
      var issues = (patch.issues || []).map(function (is) {
        if (!ok[is.rule_id]) throw appError_('VALIDATION', 'กฎที่เลือกไม่ใช่ของข้อนี้');
        if (!String(is.issue_key || '').trim()) throw appError_('VALIDATION', 'ต้องตั้งชื่อปัญหา (ใช้ชื่อเดียวกันเมื่อเป็นปัญหาเดียวกัน)');
        return { issue_key: String(is.issue_key).trim().slice(0, 120), rule_id: is.rule_id, description: String(is.description || '').slice(0, 2000), evidence_ids: (is.evidence_ids || []).slice(0, 50), source: is.source || 'AUDITOR' };
      });
      rec.issues = issues;
    }
    ['band_index', 'band_score', 'override_score'].forEach(function (k) { if (k in patch) rec[k] = patch[k] === '' || patch[k] == null ? null : Number(patch[k]); });
    if ('override_reason' in patch) rec.override_reason = String(patch.override_reason || '');
    if ('in_scope' in patch && a.scope_mode === 'PARTIAL') rec.in_scope = !!patch.in_scope;
    rec.updated_by = u.id;
    var nextResult = 'result' in rec ? rec.result : item.result;
    rec.status = patch.mark_reviewed && nextResult ? 'REVIEWED' : (nextResult || rec.auditor_notes || item.auditor_notes ? 'IN_PROGRESS' : item.status);
    if (patch.mark_reviewed) {
      if (!nextResult) throw appError_('VALIDATION', 'ต้องเลือกผลการตรวจก่อนยืนยันข้อนี้');
      rec.reviewed_by = u.id; rec.reviewed_at = nowIso_();
    }
    var before = item;
    var saved = Db.update('audit_items', itemId, rec, expectedVersion);
    if (a.status === 'DRAFT') Db.update('audits', a.id, { status: 'IN_PROGRESS' });
    var overrideChanged = ('override_score' in rec && rec.override_score !== before.override_score);
    if (overrideChanged || patch.mark_reviewed || ('result' in rec && rec.result !== before.result))
      logAction_(u.id, overrideChanged ? 'OVERRIDE_SCORE' : 'REVIEW_ITEM', 'audit_items', itemId,
        { result: before.result, override_score: before.override_score, computed_score: before.computed_score },
        { result: saved.result, override_score: saved.override_score }, saved.override_reason || '');
    return refreshAuditScore_(a.id, saved);
  });
}

/** Recompute and persist the audit's provisional score; returns item + score. */
function refreshAuditScore_(auditId, item) {
  var a = Db.get('audits', auditId);
  var bundle = versionBundle_(a.standard_version_id);
  var items = Db.where('audit_items', 'audit_id', auditId);
  var score = scoreAudit_(a, bundle, items);
  var r = item ? score.items.filter(function (x) { return x.criterion_id === item.criterion_id; })[0] : null;
  if (item && r && r.computed_score !== item.computed_score) item = Db.update('audit_items', item.id, { computed_score: r.computed_score == null ? null : r.computed_score });
  if (a.status !== 'CONFIRMED') Db.update('audits', auditId, { provisional_score: score.provisional.score, provisional_of_max: score.provisional.of_max, coverage_pct: score.coverage.pct,
    score_status: score.final_status });
  return { item: item, score: score, audit_version: Db.get('audits', auditId).version };
}

function apiRequestExemption(token, itemId, reason) {
  return guard_(token, function (u) {
    var item = Db.get('audit_items', itemId);
    var a = loadAudit_(u, item.audit_id, 'exemption.request');
    if (!String(reason || '').trim()) throw appError_('VALIDATION', 'ต้องระบุเหตุผลการขอยกเว้น');
    var saved = Db.update('audit_items', itemId, { exemption_status: 'REQUESTED', exemption_reason: String(reason), exemption_requested_by: u.id });
    logAction_(u.id, 'REQUEST_EXEMPTION', 'audit_items', itemId, null, { reason: reason }, reason);
    return refreshAuditScore_(a.id, saved);
  });
}

function apiDecideExemption(token, itemId, approve, comment) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'exemption.approve');
    var item = Db.get('audit_items', itemId);
    var a = Db.get('audits', item.audit_id);
    if (a.status === 'CONFIRMED') throw appError_('IMMUTABLE', 'รอบตรวจยืนยันแล้ว');
    if (item.exemption_status !== 'REQUESTED') throw appError_('VALIDATION', 'ไม่มีคำขอยกเว้นที่รออนุมัติ');
    if (item.exemption_requested_by === u.id && Db.find('users', function (x) { return x.role === 'ADMIN' && x.active; }).length > 1)
      throw appError_('FORBIDDEN', 'ผู้ขอยกเว้นอนุมัติคำขอของตนเองไม่ได้');
    var saved = Db.update('audit_items', itemId, { exemption_status: approve ? 'APPROVED' : 'REJECTED', exemption_decided_by: u.id });
    logAction_(u.id, approve ? 'APPROVE_EXEMPTION' : 'REJECT_EXEMPTION', 'audit_items', itemId, null, null, comment || '');
    return refreshAuditScore_(a.id, saved);
  });
}

/** Red line candidate/confirmation (always requires an auditor decision). */
function apiSetRedLine(token, auditId, data) {
  return guard_(token, function (u) {
    var a = loadAudit_(u, auditId, 'redline.confirm');
    var clause = Db.get('red_line_rules', data.clause_id);
    if (!clause || clause.standard_version_id !== a.standard_version_id) throw appError_('VALIDATION', 'เงื่อนไข Red Line ไม่อยู่ในมาตรฐานนี้');
    if (['CANDIDATE', 'CONFIRMED', 'REJECTED'].indexOf(data.status) < 0) throw appError_('VALIDATION', 'สถานะไม่ถูกต้อง');
    var evIds = (data.evidence_ids || []).filter(function (id) { var e = Db.get('evidence_files', id); return e && e.audit_id === a.id && !e.deleted; });
    if (data.status === 'CONFIRMED' && !evIds.length) throw appError_('VALIDATION', 'การยืนยัน Red Line ต้องอ้างหลักฐานอย่างน้อย 1 ชิ้น');
    if (data.status === 'CONFIRMED' && !String(data.description || '').trim()) throw appError_('VALIDATION', 'ต้องบรรยายสิ่งที่พบ');
    var rec = { audit_id: a.id, clause_id: clause.id, clause_code: clause.clause_code, status: data.status, description: String(data.description || ''),
      evidence_ids: evIds, source: data.source || 'AUDITOR' };
    if (data.status === 'CONFIRMED') { rec.confirmed_by = u.id; rec.confirmed_at = nowIso_(); }
    var saved = data.id ? Db.update('audit_red_lines', data.id, rec, data.version) : Db.insert('audit_red_lines', rec);
    logAction_(u.id, 'RED_LINE_' + data.status, 'audit_red_lines', saved.id, null, rec, data.description || '');
    return refreshAuditScore_(a.id, null);
  });
}

/** Route visit: START or FINISH a stop; visits can happen across sessions/days. */
function apiRouteVisit(token, auditId, stopId, action, sessionLabel, note) {
  return guard_(token, function (u) {
    var a = loadAudit_(u, auditId, 'audit.edit');
    var stop = Db.get('route_stops', stopId);
    if (!stop || stop.route_id !== a.route_id) throw appError_('VALIDATION', 'จุดตรวจไม่อยู่ในเส้นทางของรอบนี้');
    var open = Db.findOne('route_visits', function (v) { return v.audit_id === a.id && v.stop_id === stopId && v.status === 'IN_PROGRESS'; });
    if (action === 'START') {
      if (open) return open;
      return Db.insert('route_visits', { audit_id: a.id, stop_id: stopId, status: 'IN_PROGRESS', started_at: nowIso_(), visited_by: u.id, session_label: sessionLabel || '', note: note || '' });
    }
    if (action === 'FINISH') {
      if (!open) open = Db.insert('route_visits', { audit_id: a.id, stop_id: stopId, status: 'IN_PROGRESS', started_at: nowIso_(), visited_by: u.id, session_label: sessionLabel || '' });
      return Db.update('route_visits', open.id, { status: 'DONE', finished_at: nowIso_(), note: note || open.note || '' });
    }
    throw appError_('VALIDATION', 'action ไม่ถูกต้อง');
  });
}

/**
 * Confirm the audit: one locked operation. Validates everything first, writes
 * findings (idempotent by item+issue_key), item final scores, then flips the
 * audit to CONFIRMED last.
 */
function apiConfirmAudit(token, auditId, expectedVersion, comment) {
  return guard_(token, function (u) {
    return Db.transaction(function () {
      var a = loadAudit_(u, auditId, 'audit.confirm');
      if (expectedVersion != null && Number(expectedVersion) !== a.version) throw appError_('CONFLICT', 'รอบตรวจถูกแก้ไขจากอุปกรณ์อื่น — โหลดใหม่ก่อนยืนยัน');
      var bundle = versionBundle_(a.standard_version_id);
      if (bundle.version.status === 'DRAFT') throw appError_('VALIDATION', 'มาตรฐานยังเป็นฉบับร่าง');
      var items = Db.where('audit_items', 'audit_id', a.id);
      var pendingEx = items.filter(function (i) { return i.in_scope && i.exemption_status === 'REQUESTED'; });
      var score = scoreAudit_(a, bundle, items);
      var blockers = score.blockers.slice();
      pendingEx.forEach(function (i) { blockers.push({ code: (bundle.criteria.filter(function (c) { return c.id === i.criterion_id; })[0] || {}).code, reason: 'คำขอยกเว้นรออนุมัติ' }); });
      score.hold_reasons.forEach(function (h) { blockers.push({ code: '-', reason: h }); });
      if (!score.can_confirm || blockers.length) {
        var e = appError_('NOT_READY', 'ยังยืนยันรอบตรวจไม่ได้ (' + blockers.length + ' รายการ)'); e.details = blockers; throw e;
      }
      var critById = indexById_(bundle.criteria);
      var existing = {};
      Db.where('findings', 'audit_id', a.id).forEach(function (f) { existing[f.audit_item_id + '|' + f.issue_key] = f; });
      var seqBase = Db.all('findings').length;
      var newFindings = [], fe = [];
      items.forEach(function (i) {
        var r = score.items.filter(function (x) { return x.criterion_id === i.criterion_id; })[0];
        if (!i.in_scope || r.status !== 'SCORED') return;
        var c = critById[i.criterion_id];
        var seen = {};
        (i.issues || []).forEach(function (is) {
          if (seen[is.issue_key] || existing[i.id + '|' + is.issue_key]) return;
          seen[is.issue_key] = true;
          var id = uuid_();
          newFindings.push({ id: id, issue_no: 'ISS-' + ('00000' + (seqBase + newFindings.length + 1)).slice(-5), audit_id: a.id, audit_item_id: i.id, criterion_id: c.id,
            criterion_code: c.code, dimension_code: c.dimension_code, workshop_id: a.workshop_id, group_id: a.group_id, team_id: a.team_id, audit_type: a.audit_type,
            rule_id: is.rule_id, issue_key: is.issue_key, description: is.description || is.issue_key, is_red_line: false, source: is.source || 'AUDITOR',
            status: 'OPEN', owner_name: a.auditee_name || '', due_date: '', is_demo: a.is_demo });
          (is.evidence_ids || []).forEach(function (ev) { fe.push({ finding_id: id, evidence_id: ev, phase: 'SOURCE' }); });
        });
      });
      Db.where('audit_red_lines', 'audit_id', a.id).forEach(function (rl) {
        if (rl.status !== 'CONFIRMED' || existing['RL|' + rl.clause_code + '|' + rl.id]) return;
        var id = uuid_();
        newFindings.push({ id: id, issue_no: 'ISS-' + ('00000' + (seqBase + newFindings.length + 1)).slice(-5), audit_id: a.id, audit_item_id: 'RL', criterion_id: '', criterion_code: rl.clause_code,
          dimension_code: 'RED_LINE', workshop_id: a.workshop_id, group_id: a.group_id, team_id: a.team_id, audit_type: a.audit_type, rule_id: rl.clause_id,
          issue_key: rl.clause_code + '|' + rl.id, description: rl.description, is_red_line: true, source: rl.source, status: 'OPEN', owner_name: a.auditee_name || '', due_date: '', is_demo: a.is_demo });
        (rl.evidence_ids || []).forEach(function (ev) { fe.push({ finding_id: id, evidence_id: ev, phase: 'SOURCE' }); });
      });
      Db.insertMany('findings', newFindings);
      Db.insertMany('finding_evidence', fe);
      Db.updateMany('audit_items', items.map(function (i) {
        var r = score.items.filter(function (x) { return x.criterion_id === i.criterion_id; })[0];
        return { id: i.id, patch: { confirmed_score: r.score == null ? null : r.score, computed_score: r.computed_score == null ? (r.score == null ? null : r.score) : r.computed_score } };
      }));
      var detail = {
        engine_version: score.engine_version, standard_content_hash: bundle.version.content_hash, counts: score.counts, coverage: score.coverage,
        red_line: score.red_line, categories: score.categories || null, level: score.level, is_partial_scope: score.is_partial_scope,
        items: score.items.map(function (r) { return { code: r.code, status: r.status, score: r.score, max: r.max_points, band_index: r.band_index, dimension_code: r.dimension_code,
          deductions: (r.deductions || []).map(function (d) { return { rule_code: d.rule_code, points: d.points, issue_key: d.issue_key }; }) }; })
      };
      var saved = Db.update('audits', a.id, { status: 'CONFIRMED', final_score: score.final_score, final_of_max: score.final_of_max, provisional_score: score.provisional.score,
        provisional_of_max: score.provisional.of_max, coverage_pct: score.coverage.pct, score_status: 'FINAL', score_detail: detail, confirmed_by: u.id, confirmed_at: nowIso_() });
      logAction_(u.id, 'CONFIRM_AUDIT', 'audits', a.id, null, { final_score: score.final_score, of: score.final_of_max, findings: newFindings.length }, comment || '');
      return { audit: saved, findings_created: newFindings.length, score: score };
    });
  });
}
