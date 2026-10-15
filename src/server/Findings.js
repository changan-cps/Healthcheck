/**
 * Findings — issue tracking: owner, due date, corrective action (containment,
 * root cause, prevention, after-fix evidence) and effectiveness verification.
 * "แก้ไขแล้ว รอตรวจยืนยัน" (FIXED_PENDING_VERIFY) is separate from "ปิดแล้ว" (CLOSED).
 */
var FINDING_STATUS = { OPEN: 'เปิด', IN_PROGRESS: 'กำลังแก้ไข', FIXED_PENDING_VERIFY: 'แก้ไขแล้ว รอตรวจยืนยัน', CLOSED: 'ปิดแล้ว' };

function todayBkk_() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'); }

function findingView_(f, ctx) {
  var today = ctx.today;
  var a = ctx.audits[f.audit_id] || {};
  return { id: f.id, issue_no: f.issue_no, audit_id: f.audit_id, audit_no: a.audit_no, audit_type: f.audit_type, audit_status: a.status,
    workshop: (ctx.ws[f.workshop_id] || {}).code || '', workshop_id: f.workshop_id, group: (ctx.gs[f.group_id] || {}).name || '', team: (ctx.ts[f.team_id] || {}).name || '',
    criterion_code: f.criterion_code, dimension_code: f.dimension_code, description: f.description, is_red_line: f.is_red_line, status: f.status,
    status_th: FINDING_STATUS[f.status], owner_name: f.owner_name, owner_user_id: f.owner_user_id, due_date: f.due_date, closed_at: f.closed_at,
    overdue: !!(f.due_date && f.status !== 'CLOSED' && f.due_date < today), is_demo: f.is_demo, version: f.version, created_at: f.created_at };
}

function findingCtx_() {
  return { today: todayBkk_(), audits: indexById_(Db.all('audits')), ws: indexById_(Db.all('workshops')), gs: indexById_(Db.all('groups')), ts: indexById_(Db.all('teams')) };
}

function visibleFindings_(u, filters) {
  filters = filters || {};
  var ctx = findingCtx_();
  return Db.find('findings', function (f) {
    var a = ctx.audits[f.audit_id];
    if (!a || a.status !== 'CONFIRMED') return false;
    if (!Permissions.can(u, 'finding.view', { workshop_id: f.workshop_id, audit_status: a.status })) return false;
    if (!filters.include_demo && f.is_demo) return false;
    if (filters.workshop_id && f.workshop_id !== filters.workshop_id) return false;
    if (filters.audit_type && f.audit_type !== filters.audit_type) return false;
    if (filters.group_id && f.group_id !== filters.group_id) return false;
    if (filters.team_id && f.team_id !== filters.team_id) return false;
    if (filters.dimension_code && f.dimension_code !== filters.dimension_code) return false;
    if (filters.audit_id && f.audit_id !== filters.audit_id) return false;
    if (filters.from && a.audit_date < filters.from) return false;
    if (filters.to && a.audit_date > filters.to) return false;
    return true;
  }).map(function (f) { return findingView_(f, ctx); }).filter(function (v) {
    if (filters.status === 'OPEN_ANY') return v.status !== 'CLOSED';
    if (filters.status === 'OVERDUE') return v.overdue;
    if (filters.status && v.status !== filters.status) return false;
    return true;
  });
}

function apiListFindings(token, filters) {
  return guard_(token, function (u) { return visibleFindings_(u, filters).sort(function (a, b) { return String(a.issue_no).localeCompare(String(b.issue_no)); }); });
}

function loadFinding_(u, id, action) {
  var f = Db.get('findings', id);
  if (!f) throw appError_('NOT_FOUND', 'ไม่พบปัญหา');
  var a = Db.get('audits', f.audit_id);
  if (a.status !== 'CONFIRMED') throw appError_('VALIDATION', 'ปัญหานี้ยังอยู่ในรอบตรวจที่ไม่ได้ยืนยัน');
  Permissions.assert(u, action, { workshop_id: f.workshop_id, audit_status: a.status, submitted_by: (lastAction_(f.id) || {}).submitted_by });
  return { f: f, a: a };
}

function lastAction_(findingId) {
  var list = Db.where('corrective_actions', 'finding_id', findingId).sort(function (x, y) { return String(y.submitted_at).localeCompare(String(x.submitted_at)); });
  return list[0] || null;
}

function apiGetFinding(token, id) {
  return guard_(token, function (u) {
    var r = loadFinding_(u, id, 'finding.view');
    var f = r.f;
    var ctx = findingCtx_();
    var fe = Db.where('finding_evidence', 'finding_id', id);
    var canEv = Permissions.can(u, 'evidence.view', { workshop_id: f.workshop_id, linked_to_finding: true });
    var crit = f.criterion_id ? Db.get('audit_criteria', f.criterion_id) : null;
    var rule = f.rule_id ? (Db.get('scoring_rules', f.rule_id) || Db.get('red_line_rules', f.rule_id)) : null;
    return {
      finding: findingView_(f, ctx), criterion: crit ? { code: crit.code, title: crit.title, requirement: crit.requirement } : null,
      rule: rule ? { code: rule.rule_code || rule.clause_code, text: rule.text } : null,
      evidence: canEv ? fe.map(function (x) { var e = Db.get('evidence_files', x.evidence_id); return e && !e.deleted ? { phase: x.phase, evidence: evidencePublic_(e) } : null; }).filter(Boolean) : [],
      actions: Db.where('corrective_actions', 'finding_id', id), reviews: Db.where('closure_reviews', 'finding_id', id),
      history: Db.find('audit_logs', function (l) { return l.entity === 'findings' && l.entity_id === id; }),
      permissions: { update: Permissions.can(u, 'finding.update', { workshop_id: f.workshop_id }), submit: Permissions.can(u, 'finding.submit_action', { workshop_id: f.workshop_id }),
        verify: Permissions.can(u, 'finding.verify', { workshop_id: f.workshop_id, submitted_by: (lastAction_(id) || {}).submitted_by }),
        upload_after_fix: Permissions.can(u, 'evidence.upload', { workshop_id: f.workshop_id, audit_status: r.a.status, phase: 'AFTER_FIX' }) }
    };
  });
}

function apiUpdateFinding(token, id, patch, expectedVersion) {
  return guard_(token, function (u) {
    var r = loadFinding_(u, id, 'finding.update');
    if (r.f.status === 'CLOSED') throw appError_('IMMUTABLE', 'ปัญหาที่ปิดแล้วแก้ไขไม่ได้');
    var rec = {};
    if ('owner_name' in patch) rec.owner_name = String(patch.owner_name || '');
    if ('owner_user_id' in patch) rec.owner_user_id = patch.owner_user_id || '';
    if ('due_date' in patch) {
      if (patch.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(patch.due_date)) throw appError_('VALIDATION', 'รูปแบบวันที่ไม่ถูกต้อง');
      rec.due_date = patch.due_date || '';
    }
    if (patch.status === 'IN_PROGRESS' && r.f.status === 'OPEN') rec.status = 'IN_PROGRESS';
    var saved = Db.update('findings', id, rec, expectedVersion);
    logAction_(u.id, 'UPDATE_FINDING', 'findings', id, r.f, saved, patch.reason || '');
    return findingView_(saved, findingCtx_());
  });
}

function apiSubmitCorrectiveAction(token, id, data) {
  return guard_(token, function (u) {
    var r = loadFinding_(u, id, 'finding.submit_action');
    if (r.f.status === 'CLOSED') throw appError_('IMMUTABLE', 'ปัญหานี้ปิดแล้ว');
    ['containment', 'root_cause', 'preventive_action'].forEach(function (k) { if (!String(data[k] || '').trim()) throw appError_('VALIDATION', 'ต้องกรอก: ' + ({ containment: 'การแก้ไขเฉพาะหน้า', root_cause: 'การวิเคราะห์สาเหตุ', preventive_action: 'มาตรการป้องกันเกิดซ้ำ' })[k]); });
    var after = Db.find('finding_evidence', function (x) { return x.finding_id === id && x.phase === 'AFTER_FIX'; });
    if (!after.length) throw appError_('VALIDATION', 'ต้องแนบหลักฐานหลังแก้ไขอย่างน้อย 1 ชิ้น');
    var act = Db.insert('corrective_actions', { finding_id: id, containment: data.containment, root_cause: data.root_cause, preventive_action: data.preventive_action, submitted_by: u.id, submitted_at: nowIso_() });
    var saved = Db.update('findings', id, { status: 'FIXED_PENDING_VERIFY' }, data.version);
    logAction_(u.id, 'SUBMIT_CORRECTIVE_ACTION', 'findings', id, { status: r.f.status }, { status: saved.status, action_id: act.id }, '');
    return findingView_(saved, findingCtx_());
  });
}

function apiReviewClosure(token, id, data) {
  return guard_(token, function (u) {
    var r = loadFinding_(u, id, 'finding.verify');
    if (r.f.status !== 'FIXED_PENDING_VERIFY') throw appError_('VALIDATION', 'ตรวจยืนยันได้เฉพาะปัญหาที่ "แก้ไขแล้ว รอตรวจยืนยัน"');
    if (['EFFECTIVE', 'NOT_EFFECTIVE'].indexOf(data.result) < 0) throw appError_('VALIDATION', 'ต้องเลือกผลการตรวจยืนยัน');
    if (!String(data.comment || '').trim()) throw appError_('VALIDATION', 'ต้องระบุความเห็นผู้ตรวจยืนยัน');
    Db.insert('closure_reviews', { finding_id: id, result: data.result, comment: data.comment, reviewer_user_id: u.id, reviewed_at: nowIso_() });
    var patch = data.result === 'EFFECTIVE' ? { status: 'CLOSED', closed_at: nowIso_() } : { status: 'IN_PROGRESS' };
    var saved = Db.update('findings', id, patch, data.version);
    logAction_(u.id, data.result === 'EFFECTIVE' ? 'CLOSE_FINDING' : 'REJECT_FIX', 'findings', id, { status: r.f.status }, { status: saved.status }, data.comment);
    return findingView_(saved, findingCtx_());
  });
}
