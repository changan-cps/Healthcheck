'use strict';
/**
 * End-to-end server flow on the fake Apps Script runtime:
 * import → publish → audit → evidence → AI (mocked HTTP) → score → confirm → findings → dashboard.
 * Requires the real standard files: set CPS_STANDARD_DIR (see README). Skipped otherwise.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRuntime } = require('./helpers/fake-gas');
const { findStandardFiles } = require('./helpers/files');

const files = findStandardFiles();
const skip = !files.hc ? 'ไม่พบไฟล์มาตรฐาน (ตั้งค่า CPS_STANDARD_DIR)' : false;

const plain = (x) => JSON.parse(JSON.stringify(x));
function okData(res) {
  if (!res.ok) throw new Error(res.error.code + ': ' + res.error.message + (res.error.details ? ' ' + JSON.stringify(res.error.details) : ''));
  return res.data;
}

function setupAll() {
  const rt = createRuntime();
  rt.__state.props.ADMIN_INITIAL_PASSWORD = 'Admin12345';
  rt.setup();
  const admin = okData(rt.apiLogin('admin', 'Admin12345')).token;
  return { rt, admin };
}

function publishTeam(rt, admin, opts = {}) {
  const b64 = fs.readFileSync(files.hc).toString('base64');
  const parsed = okData(rt.apiParseStandardFile(admin, path.basename(files.hc), b64));
  const team = parsed.preview.sheets.find((s) => s.level === 'TEAM');
  const vid = okData(rt.apiCreateDraftVersion(admin, { import_file_id: parsed.import_file_id, sheet_index: team.index, version_label: 'Y2026-T1', effective_date: '2026-01-01' })).version_id;
  let b = okData(rt.apiGetStandardVersion(admin, vid));
  assert.equal(b.publish_check.ready, false, 'draft must not be publishable before review');
  // admin decisions
  b = okData(rt.apiGetStandardVersion(admin, vid));
  okData(rt.apiUpdateDraftSettings(admin, vid, { item_floor_zero: true, total_floor_zero: true, ...(opts.redLineMode ? { red_line_mode: opts.redLineMode } : {}) }, b.version.version, 'ทดสอบ: ตัดสินโดย Admin'));
  b = okData(rt.apiGetStandardVersion(admin, vid));
  for (const c of b.criteria.filter((c) => c.sample && c.sample.status === 'NEEDS_REVIEW')) {
    okData(rt.apiUpdateDraftCriterion(admin, c.id, { sample: { count: c.sample.count, per: c.sample.per === 'TEAM' ? null : c.sample.per, unit: c.sample.unit } }, c.version, 'ยืนยันจำนวนตัวอย่าง'));
  }
  b = okData(rt.apiGetStandardVersion(admin, vid));
  okData(rt.apiAcknowledgeFlags(admin, vid, b.flags.map((f) => f.key), b.version.version, 'ตรวจทานแล้ว'));
  b = okData(rt.apiGetStandardVersion(admin, vid));
  assert.deepEqual(plain(b.publish_check.problems), []);
  okData(rt.apiPublishVersion(admin, vid, b.version.version));
  return vid;
}

function master(rt, admin) {
  const md = okData(rt.apiMasterData(admin));
  const bs = md.workshops.find((w) => w.code === 'BS');
  const ps = md.workshops.find((w) => w.code === 'PS');
  const g = okData(rt.apiSaveMaster(admin, 'groups', { workshop_id: bs.id, code: 'BS-G1', name: 'Group 1' }));
  const t = okData(rt.apiSaveMaster(admin, 'teams', { workshop_id: bs.id, group_id: g.id, code: 'BS-T1', name: 'Team A' }));
  const mk = (username, role, scope) => okData(rt.apiSaveUser(admin, { username, display_name: username, role, scope_workshop_ids: scope, password: 'Passw0rd1' })).user;
  const users = { auditor: mk('auditor1', 'AUDITOR', [bs.id]), auditor2: mk('auditor2', 'AUDITOR', [bs.id]), owner: mk('owner1', 'WORKSHOP_OWNER', [bs.id]), viewerPS: mk('viewer1', 'VIEWER', [ps.id]), viewerBS: mk('viewer2', 'VIEWER', [bs.id]) };
  const tok = {};
  for (const k of Object.keys(users)) tok[k] = okData(rt.apiLogin(users[k].username, 'Passw0rd1')).token;
  return { bs, ps, g, t, users, tok };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString('base64');

test('standard import → publish → audit → confirm → findings → dashboard', { skip }, () => {
  const { rt, admin } = setupAll();
  const vid = publishTeam(rt, admin);
  const m = master(rt, admin);
  const A = m.tok.auditor;

  const created = okData(rt.apiCreateAudit(A, { audit_type: 'TEAM', standard_version_id: vid, workshop_id: m.bs.id, group_id: m.g.id, team_id: m.t.id, audit_date: '2026-10-15', auditee_name: 'หัวหน้าทีม A', scope_mode: 'FULL' }));
  let full = okData(rt.apiGetAudit(A, created.audit_id));
  assert.equal(full.items.length, 15);
  assert.ok(full.route && full.route.stops.length >= 4, 'default audit route created');
  const covered = new Set(full.route.stops.flatMap((s) => s.criterion_ids));
  assert.equal(covered.size, 15, 'every criterion appears in the route');

  const byCode = Object.fromEntries(full.standard.criteria.map((c) => [c.code, c]));
  const itemOf = (code) => full.items.find((i) => i.criterion_id === byCode[code].id);
  const rulesOf = (code) => full.standard.rules.filter((r) => r.criterion_ids.includes(byCode[code].id));

  // insufficient evidence is not 0 and not pass
  let it = itemOf('T-01');
  let r = okData(rt.apiSaveItemDraft(A, it.id, { result: 'INSUFFICIENT' }, it.version));
  let s = r.score.items.find((x) => x.code === 'T-01');
  assert.equal(s.status, 'INSUFFICIENT');
  assert.equal(s.score, null);
  assert.equal(r.score.final_score, null);

  // two evidence for the same issue → one deduction
  const e1 = okData(rt.apiUploadEvidence(A, { audit_id: created.audit_id, kind: 'OVERVIEW_PHOTO', file_name: 'a.jpg', mime_type: 'image/jpeg', base64: JPEG, item_ids: [it.id], station: 'ST-01' })).evidence;
  const e2 = okData(rt.apiUploadEvidence(A, { audit_id: created.audit_id, kind: 'ZOOM_PHOTO', file_name: 'b.jpg', mime_type: 'image/jpeg', base64: JPEG, item_ids: [it.id], parent_evidence_id: e1.id })).evidence;
  const per3 = rulesOf('T-01').find((x) => x.rule_type === 'PER_OCCURRENCE');
  it = okData(rt.apiGetAudit(A, created.audit_id)).items.find((i) => i.id === it.id);
  r = okData(rt.apiSaveItemDraft(A, it.id, { result: 'NONCONFORM', issues: [
    { issue_key: 'บันทึกส่งกะไม่ระบุสถานะผิดปกติ', rule_id: per3.id, evidence_ids: [e1.id] },
    { issue_key: 'บันทึกส่งกะไม่ระบุสถานะผิดปกติ', rule_id: per3.id, evidence_ids: [e2.id] }] }, it.version));
  s = r.score.items.find((x) => x.code === 'T-01');
  assert.equal(s.score, 7, '10 − 3 once for one issue seen in two photos');

  // unsupported file type is rejected with a message
  const bad = rt.apiUploadEvidence(A, { audit_id: created.audit_id, kind: 'OVERVIEW_PHOTO', file_name: 'x.exe', mime_type: 'application/x-msdownload', base64: JPEG });
  assert.equal(bad.ok, false); assert.equal(bad.error.code, 'UNSUPPORTED');

  // cannot confirm while items are missing
  full = okData(rt.apiGetAudit(A, created.audit_id));
  const notReady = rt.apiConfirmAudit(A, created.audit_id, full.audit.version);
  assert.equal(notReady.ok, false); assert.equal(notReady.error.code, 'NOT_READY');

  // complete the rest as CONFORM with a field note
  for (const item of full.items) {
    if (item.id === it.id) continue;
    okData(rt.apiUploadEvidence(A, { audit_id: created.audit_id, kind: 'NOTE', note_text: 'ตรวจหน้างานแล้ว สอดคล้อง', item_ids: [item.id], sample_label: '1' }));
    if (item.sample_required > 1) for (let k = 2; k <= item.sample_required; k++) okData(rt.apiUploadEvidence(A, { audit_id: created.audit_id, kind: 'NOTE', note_text: 'ตัวอย่าง ' + k, item_ids: [item.id], sample_label: String(k) }));
    const fresh = okData(rt.apiGetAudit(A, created.audit_id)).items.find((i) => i.id === item.id);
    okData(rt.apiSaveItemDraft(A, fresh.id, { result: 'CONFORM', mark_reviewed: true }, fresh.version));
  }
  // T-01 sample: requires evidence present (has 2 photos) — mark reviewed
  it = okData(rt.apiGetAudit(A, created.audit_id)).items.find((i) => i.id === it.id);
  okData(rt.apiSaveItemDraft(A, it.id, { mark_reviewed: true }, it.version));

  // sample shortfall must block: T-02 needs 2 stations
  full = okData(rt.apiGetAudit(A, created.audit_id));
  assert.equal(full.score.can_confirm, true, JSON.stringify(full.score.blockers));
  assert.equal(full.score.final_score, 97);

  // viewer of another workshop cannot read; owner cannot edit
  assert.equal(rt.apiGetAudit(m.tok.viewerPS, created.audit_id).ok, false);
  assert.equal(rt.apiGetAudit(m.tok.owner, created.audit_id).ok, false, 'owner sees only confirmed audits');
  const ownerEdit = rt.apiSaveItemDraft(m.tok.owner, it.id, { auditor_notes: 'x' }, it.version);
  assert.equal(ownerEdit.ok, false); assert.equal(ownerEdit.error.code, 'FORBIDDEN');
  assert.equal(rt.apiGetEvidenceContent(m.tok.viewerBS, e1.id).ok, false, 'viewer cannot open raw evidence');

  // concurrent edit protection
  const stale = rt.apiSaveItemDraft(A, it.id, { auditor_notes: 'old' }, it.version);
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'CONFLICT');

  const conf = okData(rt.apiConfirmAudit(A, created.audit_id, full.audit.version));
  assert.equal(conf.audit.status, 'CONFIRMED');
  assert.equal(conf.audit.final_score, 97);
  assert.equal(conf.findings_created, 1, 'one finding for one issue');
  // confirm is idempotent / immutable
  assert.equal(rt.apiConfirmAudit(A, created.audit_id).ok, false);
  const afterEdit = rt.apiSaveItemDraft(A, it.id, { auditor_notes: 'late' });
  assert.equal(afterEdit.ok, false);

  // owner can now view & submit corrective action; same person cannot verify own fix
  const f = okData(rt.apiListFindings(m.tok.owner, {}))[0];
  assert.ok(f);
  okData(rt.apiUploadEvidence(m.tok.owner, { audit_id: created.audit_id, kind: 'OVERVIEW_PHOTO', file_name: 'after.jpg', mime_type: 'image/jpeg', base64: JPEG, phase: 'AFTER_FIX', finding_id: f.id }));
  const fd = okData(rt.apiGetFinding(m.tok.owner, f.id));
  okData(rt.apiSubmitCorrectiveAction(m.tok.owner, f.id, { containment: 'แก้บันทึก', root_cause: 'ไม่มีช่องสถานะผิดปกติในแบบฟอร์ม', preventive_action: 'ปรับแบบฟอร์ม', version: fd.finding.version }));
  let f2 = okData(rt.apiGetFinding(A, f.id)).finding;
  assert.equal(f2.status, 'FIXED_PENDING_VERIFY');
  const selfVerify = rt.apiReviewClosure(m.tok.owner, f.id, { result: 'EFFECTIVE', comment: 'ok', version: f2.version });
  assert.equal(selfVerify.ok, false);
  okData(rt.apiReviewClosure(A, f.id, { result: 'EFFECTIVE', comment: 'ตรวจหน้างานแล้วได้ผล', version: f2.version }));
  f2 = okData(rt.apiGetFinding(A, f.id)).finding;
  assert.equal(f2.status, 'CLOSED');

  // dashboard numbers match the rows
  const d = okData(rt.apiDashboard(admin, {}));
  assert.equal(d.audit_counts.confirmed, 1);
  assert.equal(d.average_pct, 97);
  assert.equal(d.finding_counts.total, 1);
  assert.deepEqual(plain(d.closure_rate), { numerator: 1, denominator: 1, pct: 100 });
  const dPS = okData(rt.apiDashboard(m.tok.viewerPS, {}));
  assert.equal(dPS.audit_counts.total, 0);
  assert.equal(dPS.average_pct, null, 'no data is null, not 0');

  // published standard is immutable; editing a clone does not change the confirmed result
  const crit = okData(rt.apiGetStandardVersion(admin, vid)).criteria[0];
  assert.equal(rt.apiUpdateDraftCriterion(admin, crit.id, { max_points: 99 }, crit.version, 'x').error.code, 'IMMUTABLE');
  const clone = okData(rt.apiCloneVersion(admin, vid, 'Y2026-T2', '2026-12-01')).version_id;
  const c2 = okData(rt.apiGetStandardVersion(admin, clone)).criteria[0];
  okData(rt.apiUpdateDraftCriterion(admin, c2.id, { max_points: 12 }, c2.version, 'ทดสอบ'));
  const again = okData(rt.apiGetAudit(admin, created.audit_id));
  assert.equal(again.audit.final_score, 97);
  assert.equal(again.standard.criteria[0].max_points, 10);

  // a published version can never be deleted; a draft can, with its criteria/rules/routes
  assert.equal(rt.apiDeleteDraftVersion(admin, vid).error.code, 'IMMUTABLE');
  assert.equal(rt.apiDeleteDraftVersion(m.tok.viewerPS, clone).error.code, 'FORBIDDEN');
  okData(rt.apiDeleteDraftVersion(admin, clone));
  assert.equal(rt.apiGetStandardVersion(admin, clone).ok, false);
  assert.ok(okData(rt.apiGetStandardVersion(admin, vid)).criteria.length > 0, 'published version untouched');

  // reports
  rt.__state.fetchHandler = () => ({ getResponseCode: () => 200, getBlob: () => ({ getBytes: () => [80, 75] }), getContentText: () => '' });
  assert.match(okData(rt.apiExportAuditExcel(A, created.audit_id)).file_name, /_FINAL_scores\.xlsx$/);
  assert.match(okData(rt.apiExportAuditPdf(A, created.audit_id)).file_name, /_FINAL\.pdf$/);
  assert.ok(okData(rt.apiExportFindingsExcel(A, {})).base64);
});

test('red line: unclear counting rule holds the final score', { skip }, () => {
  const { rt, admin } = setupAll();
  const vid = publishTeam(rt, admin);
  const m = master(rt, admin);
  const A = m.tok.auditor;
  const rej = rt.apiCreateAudit(A, { audit_type: 'TEAM', standard_version_id: vid, workshop_id: m.bs.id, group_id: m.g.id, team_id: m.t.id, audit_date: '2026-10-15', scope_mode: 'PARTIAL', criterion_ids: [] });
  assert.equal(rej.ok, false, 'partial without criteria rejected');
  let full;
  const created = okData(rt.apiCreateAudit(A, { audit_type: 'TEAM', standard_version_id: vid, workshop_id: m.bs.id, team_id: m.t.id, group_id: m.g.id, audit_date: '2026-10-15', scope_mode: 'FULL' }));
  full = okData(rt.apiGetAudit(A, created.audit_id));
  const ev = okData(rt.apiUploadEvidence(A, { audit_id: created.audit_id, kind: 'OVERVIEW_PHOTO', file_name: 'rl.jpg', mime_type: 'image/jpeg', base64: JPEG })).evidence;
  const clause = full.standard.red_lines[0];
  const noEv = rt.apiSetRedLine(A, created.audit_id, { clause_id: clause.id, status: 'CONFIRMED', description: 'พนักงานไม่สวม PPE', evidence_ids: [] });
  assert.equal(noEv.ok, false, 'red line needs evidence');
  const r = okData(rt.apiSetRedLine(A, created.audit_id, { clause_id: clause.id, status: 'CONFIRMED', description: 'พนักงานไม่สวม PPE', evidence_ids: [ev.id] }));
  assert.ok(r.score.hold_reasons.some((h) => /Red Line/.test(h)));
  assert.equal(r.score.final_score, null);
});

test('partial audit is never shown as a full pass', { skip }, () => {
  const { rt, admin } = setupAll();
  const vid = publishTeam(rt, admin, { redLineMode: 'ONCE' });
  const m = master(rt, admin);
  const A = m.tok.auditor;
  const bundle = okData(rt.apiGetStandardVersion(admin, vid));
  const pick = bundle.criteria.filter((c) => c.code === 'T-04');
  const created = okData(rt.apiCreateAudit(A, { audit_type: 'TEAM', standard_version_id: vid, workshop_id: m.bs.id, group_id: m.g.id, team_id: m.t.id, audit_date: '2026-10-15', scope_mode: 'PARTIAL', criterion_ids: pick.map((c) => c.id), scope_note: 'ตรวจเฉพาะ PJO' }));
  let full = okData(rt.apiGetAudit(A, created.audit_id));
  const item = full.items.find((i) => i.in_scope);
  okData(rt.apiUploadEvidence(A, { audit_id: created.audit_id, kind: 'NOTE', note_text: 'สัมภาษณ์หัวหน้าทีม', item_ids: [item.id] }));
  const fresh = okData(rt.apiGetAudit(A, created.audit_id)).items.find((i) => i.id === item.id);
  const r = okData(rt.apiSaveItemDraft(A, fresh.id, { result: 'CONFORM', mark_reviewed: true }, fresh.version));
  assert.equal(r.score.is_partial_scope, true);
  assert.equal(r.score.final_score, 5);
  assert.equal(r.score.in_scope_max, 5, 'partial result is reported against the in-scope max only');
  full = okData(rt.apiGetAudit(A, created.audit_id));
  okData(rt.apiConfirmAudit(A, created.audit_id, full.audit.version));
  const d = okData(rt.apiDashboard(admin, {}));
  assert.equal(d.average_pct, null, 'partial audits are excluded from averages');
  assert.equal(d.excluded_from_average, 1);
});

test('AI: not connected, valid output, invalid output, retry without duplicates', { skip }, () => {
  const { rt, admin } = setupAll();
  const vid = publishTeam(rt, admin, { redLineMode: 'ONCE' });
  const m = master(rt, admin);
  const A = m.tok.auditor;
  const created = okData(rt.apiCreateAudit(A, { audit_type: 'TEAM', standard_version_id: vid, workshop_id: m.bs.id, group_id: m.g.id, team_id: m.t.id, audit_date: '2026-10-15', scope_mode: 'FULL' }));
  let full = okData(rt.apiGetAudit(A, created.audit_id));
  const crit = full.standard.criteria.find((c) => c.code === 'T-02');
  const item = full.items.find((i) => i.criterion_id === crit.id);
  const ev = okData(rt.apiUploadEvidence(A, { audit_id: created.audit_id, kind: 'OVERVIEW_PHOTO', file_name: 's1.jpg', mime_type: 'image/jpeg', base64: JPEG, item_ids: [item.id], sample_label: '1' })).evidence;

  const nc = rt.apiAnalyzeItem(A, item.id);
  assert.equal(nc.ok, false); assert.equal(nc.error.code, 'AI_NOT_CONNECTED');

  okData(rt.apiSetAiConfig(admin, { provider: 'gemini', model: 'gemini-2.5-flash', api_key: 'TEST-ONLY-NOT-A-REAL-KEY-0000000000' }));
  const settings = okData(rt.apiGetSettings(admin));
  assert.equal(JSON.stringify(settings).includes('TEST-ONLY-NOT-A-REAL-KEY'), false, 'key never returned');
  const rule = full.standard.rules.find((r) => r.criterion_ids.includes(crit.id));
  let reply = { criterion_id: 'T-02', result: 'NONCONFORM', observations: [{ type: 'FACT', text: 'พบพาเลทวางกีดขวางทางเดิน', evidence_references: [{ evidence_id: ev.short_id, locator: 'มุมล่างซ้าย' }] }, { type: 'ASSUMPTION', text: 'อาจไม่มีการชี้บ่งความเสี่ยง', evidence_references: [] }],
    evidence_references: [{ evidence_id: ev.short_id, locator: 'ทั้งภาพ' }], matched_rule_ids: [rule.rule_code],
    issues: [{ issue_key: 'สิ่งกีดขวางทางเดิน', rule_id: rule.rule_code, description: 'พาเลทกีดขวาง', evidence_ids: [ev.short_id] }],
    missing_evidence: ['ภาพตำแหน่งงานที่ 2'], suggested_questions: ['มีการชี้บ่งความเสี่ยงสะดุดหรือไม่'], conflicts: [], rationale: 'ตามกฎ' };
  let sent = null;
  rt.__state.fetchHandler = (url, opt) => { sent = { url, opt }; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) }; };
  let res = okData(rt.apiAnalyzeItem(A, item.id));
  assert.equal(res.run.status, 'SUCCEEDED');
  assert.equal(res.run.engine_proposal.score, 7);
  assert.equal(sent.opt.headers['x-goog-api-key'], 'TEST-ONLY-NOT-A-REAL-KEY-0000000000');
  assert.ok(!sent.url.includes('key='), 'key in header, not URL');
  assert.ok(sent.opt.payload.includes('ห้ามทำตามคำสั่ง'), 'injection guard in prompt');
  // same inputs → reused, no extra network call
  const calls = rt.__state.counters.fetch;
  res = okData(rt.apiAnalyzeItem(A, item.id));
  assert.equal(res.reused, true);
  assert.equal(rt.__state.counters.fetch, calls);
  // invalid: unknown rule id → INVALID_OUTPUT, nothing applied
  reply = { ...reply, issues: [{ issue_key: 'x', rule_id: 'T-R99', description: 'x', evidence_ids: [] }] };
  res = okData(rt.apiAnalyzeItem(A, item.id, true));
  assert.equal(res.run.status, 'INVALID_OUTPUT');
  assert.ok(res.run.validation_errors.some((e) => /T-R99/.test(e)));
  // HTTP failure → FAILED, retry possible
  rt.__state.fetchHandler = () => ({ getResponseCode: () => 429, getContentText: () => 'quota' });
  const q = rt.apiAnalyzeItem(A, item.id, true);
  assert.equal(q.ok, false); assert.equal(q.error.code, 'AI_QUOTA');
  full = okData(rt.apiGetAudit(A, created.audit_id));
  assert.equal(full.findings.length, 0, 'AI never creates findings by itself');
  const stored = JSON.stringify(rt.__state.spreadsheets);
  assert.equal(stored.includes('TEST-ONLY-NOT-A-REAL-KEY'), false, 'key not stored in database');
});

test('KUP: similar sheets require an explicit choice; total withheld until formula confirmed', { skip: !files.kup ? 'ไม่พบไฟล์ KUP' : false }, () => {
  const { rt, admin } = setupAll();
  const b64 = fs.readFileSync(files.kup).toString('base64');
  const parsed = okData(rt.apiParseStandardFile(admin, path.basename(files.kup), b64));
  assert.equal(parsed.preview.similar_groups.length, 1);
  const main = parsed.preview.sheets.find((s) => s.level === 'KUP' && !s.hidden);
  const r1 = rt.apiCreateDraftVersion(admin, { import_file_id: parsed.import_file_id, sheet_index: main.index, version_label: 'KUP-2026', effective_date: '2026-01-01' });
  assert.equal(r1.ok, false); assert.equal(r1.error.code, 'NEEDS_CHOICE');
  const vid = okData(rt.apiCreateDraftVersion(admin, { import_file_id: parsed.import_file_id, sheet_index: main.index, version_label: 'KUP-2026', effective_date: '2026-01-01', acknowledge_similar: true })).version_id;
  let b = okData(rt.apiGetStandardVersion(admin, vid));
  assert.equal(b.criteria.length, 46);
  okData(rt.apiAcknowledgeFlags(admin, vid, b.flags.map((f) => f.key), b.version.version, 'ok'));
  b = okData(rt.apiGetStandardVersion(admin, vid));
  assert.deepEqual(plain(b.publish_check.problems), []);
  assert.ok(b.publish_check.warnings.some((w) => /สูตรรวม KUP/.test(w)));
  okData(rt.apiPublishVersion(admin, vid, b.version.version));
  const m = master(rt, admin);
  const A = m.tok.auditor;
  const created = okData(rt.apiCreateAudit(A, { audit_type: 'KUP', standard_version_id: vid, workshop_id: m.bs.id, audit_date: '2026-10-15', scope_mode: 'FULL' }));
  const full = okData(rt.apiGetAudit(A, created.audit_id));
  const it = full.items[0];
  okData(rt.apiUploadEvidence(A, { audit_id: created.audit_id, kind: 'NOTE', note_text: 'เอกสารองค์กร', item_ids: [it.id] }));
  const fresh = okData(rt.apiGetAudit(A, created.audit_id)).items[0];
  const bad = okData(rt.apiSaveItemDraft(A, fresh.id, { result: 'CONFORM', band_index: 2, band_score: 7 }, fresh.version));
  assert.equal(bad.score.items[0].status, 'HELD', 'score outside chosen band is held');
  const ok = okData(rt.apiSaveItemDraft(A, fresh.id, { band_score: 5 }, bad.item.version));
  assert.equal(ok.score.items[0].score, 5);
  assert.ok(ok.score.hold_reasons.some((h) => /สูตรรวมคะแนน KUP/.test(h)));
});

test('quick capture: unassigned tray, AI suggestions validated, previous issues of the same team', { skip }, () => {
  const { rt, admin } = setupAll();
  const vid = publishTeam(rt, admin, { redLineMode: 'ONCE' });
  const m = master(rt, admin);
  const A = m.tok.auditor;
  // round 1: one issue, confirmed
  const bundle = okData(rt.apiGetStandardVersion(admin, vid));
  const t02 = bundle.criteria.find((c) => c.code === 'T-02');
  const a1 = okData(rt.apiCreateAudit(A, { audit_type: 'TEAM', standard_version_id: vid, workshop_id: m.bs.id, group_id: m.g.id, team_id: m.t.id, audit_date: '2026-09-01', scope_mode: 'PARTIAL', criterion_ids: [t02.id] }));
  let full = okData(rt.apiGetAudit(A, a1.audit_id));
  // quick capture: no item, flagged as issue → stays unassigned
  const q = okData(rt.apiUploadEvidence(A, { audit_id: a1.audit_id, kind: 'OVERVIEW_PHOTO', file_name: 'q.jpg', mime_type: 'image/jpeg', base64: JPEG, quick: true, flag_issue: true, note_text: 'พาเลทขวางทางเดิน' })).evidence;
  assert.equal(q.quick, true); assert.equal(q.flag_issue, true);
  full = okData(rt.apiGetAudit(A, a1.audit_id));
  assert.equal(full.links.filter((l) => l.evidence_id === q.id).length, 0, 'quick capture is not linked yet');
  // AI suggestion: invalid code dropped, valid mapped to item id
  okData(rt.apiSetAiConfig(admin, { provider: 'gemini', model: 'gemini-2.5-flash', api_key: 'TEST-ONLY-NOT-A-REAL-KEY-0000000000' }));
  rt.__state.fetchHandler = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ suggestions: [
    { evidence_id: q.short_id, criterion_codes: ['T-02', 'T-99'], looks_like_issue: true, issue_summary: 'สิ่งกีดขวางทางเดิน', reason: 'ภาพแสดงทางเดิน' },
    { evidence_id: 'EV-deadbeef', criterion_codes: ['T-02'], reason: 'x' }] }) }] } }] }) });
  const sug = okData(rt.apiSuggestEvidenceItems(A, a1.audit_id, [q.id]));
  assert.equal(sug.suggestions.length, 1);
  assert.deepEqual(plain(sug.suggestions[0].criterion_codes), ['T-02']);
  assert.equal(sug.warnings.length, 2);
  const item = full.items.find((i) => i.criterion_id === t02.id);
  okData(rt.apiLinkEvidence(A, item.id, q.id, true));
  const rule = full.standard.rules.find((r) => r.criterion_ids.includes(t02.id));
  let it = okData(rt.apiGetAudit(A, a1.audit_id)).items.find((i) => i.id === item.id);
  okData(rt.apiUploadEvidence(A, { audit_id: a1.audit_id, kind: 'NOTE', note_text: 'ตำแหน่งที่ 2 ปกติ', item_ids: [item.id], sample_label: '2' }));
  okData(rt.apiUpdateEvidenceMeta(A, q.id, { sample_label: '1' }, q.version));
  it = okData(rt.apiGetAudit(A, a1.audit_id)).items.find((i) => i.id === item.id);
  okData(rt.apiSaveItemDraft(A, it.id, { result: 'NONCONFORM', issues: [{ issue_key: 'สิ่งกีดขวางทางเดิน', rule_id: rule.id, evidence_ids: [q.id] }], mark_reviewed: true }, it.version));
  full = okData(rt.apiGetAudit(A, a1.audit_id));
  okData(rt.apiConfirmAudit(A, a1.audit_id, full.audit.version));
  // round 2 for the same team sees round 1's issue
  const a2 = okData(rt.apiCreateAudit(A, { audit_type: 'TEAM', standard_version_id: vid, workshop_id: m.bs.id, group_id: m.g.id, team_id: m.t.id, audit_date: '2026-10-15', scope_mode: 'FULL' }));
  const g2 = okData(rt.apiGetAudit(A, a2.audit_id));
  assert.equal(g2.history.previous.audit_no, full.audit.audit_no);
  assert.equal(g2.history.findings.length, 1);
  assert.equal(g2.history.findings[0].criterion_code, 'T-02');
  assert.equal(g2.history.open_count, 1);
});
