/**
 * Evidence — private Drive storage, item links (many-to-many), transcripts.
 * Files are never shared publicly; content is streamed through apiGetEvidenceContent
 * after a server-side permission check.
 */
function evidencePublic_(e) {
  return { id: e.id, audit_id: e.audit_id, kind: e.kind, parent_evidence_id: e.parent_evidence_id, file_name: e.file_name, mime_type: e.mime_type,
    size_bytes: e.size_bytes, duration_sec: e.duration_sec, station: e.station, area: e.area, stop_id: e.stop_id, sample_label: e.sample_label,
    captured_by: e.captured_by, captured_at: e.captured_at, note_text: e.note_text, transcript_status: e.transcript_status, transcript: e.transcript,
    transcript_edited_by: e.transcript_edited_by, locator_hint: e.locator_hint, analysis_supported: e.analysis_supported, phase: e.phase, quick: e.quick, flag_issue: e.flag_issue, version: e.version,
    short_id: 'EV-' + String(e.id).slice(0, 8) };
}

function auditFolder_(audit) {
  var root = DriveApp.getFolderById(getProp_('EVIDENCE_FOLDER_ID'));
  var name = audit.audit_no;
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function checkEvidenceFile_(kind, mime, size, name) {
  var k = EVIDENCE_KINDS[kind];
  if (!k) throw appError_('VALIDATION', 'ประเภทหลักฐานไม่ถูกต้อง');
  var m = String(mime || '').toLowerCase();
  var accepted = k.mimes.indexOf(m) >= 0;
  var unanalyzable = (k.accept_unanalyzable || []).indexOf(m) >= 0;
  if (!accepted && !unanalyzable)
    throw appError_('UNSUPPORTED', 'ไม่รองรับไฟล์ชนิด ' + (m || 'ไม่ทราบชนิด') + ' สำหรับ "' + k.label + '" — รองรับ: ' + k.mimes.join(', '));
  if (size > k.max) throw appError_('TOO_LARGE', 'ไฟล์ "' + name + '" ใหญ่ ' + (size / 1048576).toFixed(1) + ' MB เกินขนาดสูงสุด ' + (k.max / 1048576) + ' MB สำหรับ' + k.label);
  return { analysis_supported: k.analyzable && accepted && !/heic|heif/.test(m) };
}

/**
 * Upload one evidence file (base64) or a text note, and link it to items.
 * req: {audit_id, kind, file_name, mime_type, base64, note_text, station, area, stop_id, sample_label, parent_evidence_id,
 *       item_ids[], phase ('SOURCE'|'AFTER_FIX'), finding_id, duration_sec, client_ref}
 */
function apiUploadEvidence(token, req) {
  return guard_(token, function (u) {
    var a = Db.get('audits', req.audit_id);
    if (!a) throw appError_('NOT_FOUND', 'ไม่พบรอบตรวจ');
    var phase = req.phase === 'AFTER_FIX' ? 'AFTER_FIX' : 'SOURCE';
    Permissions.assert(u, 'evidence.upload', { workshop_id: a.workshop_id, audit_status: a.status, phase: phase });
    if (phase === 'AFTER_FIX') {
      var f = Db.get('findings', req.finding_id);
      if (!f || f.audit_id !== a.id) throw appError_('VALIDATION', 'หลักฐานหลังแก้ไขต้องผูกกับปัญหาของรอบตรวจนี้');
    }
    // idempotent retry from the offline queue
    if (req.client_ref) {
      var dup = Db.findOne('evidence_files', function (e) { return e.audit_id === a.id && e.locator_hint === 'client:' + req.client_ref; });
      if (dup) return { evidence: evidencePublic_(dup), duplicate: true };
    }
    var rec = { audit_id: a.id, kind: req.kind, parent_evidence_id: req.parent_evidence_id || '', station: req.station || '', area: req.area || '',
      stop_id: req.stop_id || '', sample_label: req.sample_label || '', captured_by: u.id, captured_at: req.captured_at || nowIso_(),
      note_text: String(req.note_text || '').slice(0, 20000), phase: phase, deleted: false, duration_sec: req.duration_sec || null,
      locator_hint: req.client_ref ? 'client:' + req.client_ref : '', quick: !!req.quick, flag_issue: !!req.flag_issue };
    if (req.parent_evidence_id) {
      var p = Db.get('evidence_files', req.parent_evidence_id);
      if (!p || p.audit_id !== a.id || p.kind !== 'OVERVIEW_PHOTO') throw appError_('VALIDATION', 'ภาพซูมต้องเชื่อมกับภาพรวมของรอบตรวจเดียวกัน');
    }
    if (req.kind === 'NOTE') {
      if (!rec.note_text.trim()) throw appError_('VALIDATION', 'บันทึกว่าง');
      rec.analysis_supported = true; rec.file_name = 'บันทึกหน้างาน'; rec.mime_type = 'text/plain'; rec.size_bytes = rec.note_text.length;
    } else {
      var bytes = Utilities.base64Decode(req.base64 || '');
      var chk = checkEvidenceFile_(req.kind, req.mime_type, bytes.length, req.file_name);
      var safeName = String(req.file_name || 'evidence').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
      var file = auditFolder_(a).createFile(Utilities.newBlob(bytes, req.mime_type, safeName));
      rec.drive_file_id = file.getId(); rec.file_name = safeName; rec.mime_type = req.mime_type; rec.size_bytes = bytes.length;
      rec.analysis_supported = chk.analysis_supported;
      if (req.kind === 'AUDIO') rec.transcript_status = 'NONE';
    }
    var ev = Db.insert('evidence_files', rec);
    var items = (req.item_ids || []).map(function (id) { return Db.get('audit_items', id); }).filter(function (i) { return i && i.audit_id === a.id; });
    if (items.length) Db.insertMany('audit_item_evidence', items.map(function (i) { return { audit_item_id: i.id, evidence_id: ev.id, linked_by: u.id, note: '' }; }));
    if (phase === 'AFTER_FIX') Db.insert('finding_evidence', { finding_id: req.finding_id, evidence_id: ev.id, phase: 'AFTER_FIX' });
    logAction_(u.id, 'UPLOAD_EVIDENCE', 'evidence_files', ev.id, null, { kind: ev.kind, file: ev.file_name, size: ev.size_bytes, items: items.length }, '');
    var notice = null;
    if (!ev.analysis_supported) notice = req.kind === 'VIDEO' ? 'บันทึกวิดีโอแล้ว แต่ AI ยังไม่รองรับการวิเคราะห์วิดีโอ — ข้อนี้จะไม่ถือว่า AI ตรวจวิดีโอแล้ว'
      : 'บันทึกไฟล์แล้ว แต่ AI ยังวิเคราะห์ไฟล์ชนิดนี้ไม่ได้ (แนะนำแปลงเป็น PDF หรือภาพ)';
    var refreshed = items.length ? refreshAuditScore_(a.id, null) : null;
    return { evidence: evidencePublic_(ev), notice: notice, score: refreshed ? refreshed.score : null };
  });
}

function apiLinkEvidence(token, itemId, evidenceId, linked) {
  return guard_(token, function (u) {
    var item = Db.get('audit_items', itemId);
    var a = loadAudit_(u, item.audit_id, 'audit.edit');
    var ev = Db.get('evidence_files', evidenceId);
    if (!ev || ev.audit_id !== a.id || ev.deleted) throw appError_('VALIDATION', 'หลักฐานไม่อยู่ในรอบตรวจนี้');
    var existing = Db.findOne('audit_item_evidence', function (l) { return l.audit_item_id === itemId && l.evidence_id === evidenceId; });
    if (linked && !existing) Db.insert('audit_item_evidence', { audit_item_id: itemId, evidence_id: evidenceId, linked_by: u.id, note: '' });
    if (!linked && existing) {
      Db.remove('audit_item_evidence', existing.id);
      logAction_(u.id, 'UNLINK_EVIDENCE', 'audit_item_evidence', existing.id, existing, null, '');
    }
    return refreshAuditScore_(a.id, null);
  });
}

function apiDeleteEvidence(token, evidenceId, reason) {
  return guard_(token, function (u) {
    var ev = Db.get('evidence_files', evidenceId);
    var a = loadAudit_(u, ev.audit_id, 'audit.edit');
    if (!String(reason || '').trim()) throw appError_('VALIDATION', 'ต้องระบุเหตุผลการลบ');
    Db.update('evidence_files', evidenceId, { deleted: true });
    logAction_(u.id, 'DELETE_EVIDENCE', 'evidence_files', evidenceId, evidencePublic_(ev), null, reason);
    return refreshAuditScore_(a.id, null);
  });
}

function canViewEvidence_(u, ev) {
  var a = Db.get('audits', ev.audit_id);
  var linked = Db.find('finding_evidence', function (fe) { return fe.evidence_id === ev.id; }).length > 0;
  return Permissions.can(u, 'evidence.view', { workshop_id: a.workshop_id, linked_to_finding: linked });
}

/** Returns file content (base64) after permission check. */
function apiGetEvidenceContent(token, evidenceId) {
  return guard_(token, function (u) {
    var ev = Db.get('evidence_files', evidenceId);
    if (!ev || ev.deleted) throw appError_('NOT_FOUND', 'ไม่พบหลักฐาน');
    if (!canViewEvidence_(u, ev)) throw appError_('FORBIDDEN', 'ไม่มีสิทธิ์เปิดหลักฐานนี้');
    if (ev.kind === 'NOTE') return { mime_type: 'text/plain', text: ev.note_text };
    var blob = DriveApp.getFileById(ev.drive_file_id).getBlob();
    return { mime_type: ev.mime_type, file_name: ev.file_name, base64: Utilities.base64Encode(blob.getBytes()) };
  });
}

function apiUpdateTranscript(token, evidenceId, segments, expectedVersion) {
  return guard_(token, function (u) {
    var ev = Db.get('evidence_files', evidenceId);
    var a = loadAudit_(u, ev.audit_id, 'audit.edit');
    if (ev.kind !== 'AUDIO') throw appError_('VALIDATION', 'แก้ข้อความถอดเสียงได้เฉพาะไฟล์เสียง');
    var clean = (segments || []).map(function (s) { return { start_sec: Math.max(0, Number(s.start_sec) || 0), end_sec: s.end_sec == null ? null : Number(s.end_sec), speaker: String(s.speaker || '').slice(0, 60), text: String(s.text || '').slice(0, 4000) }; })
      .filter(function (s) { return s.text.trim(); });
    var t = ev.transcript || {};
    var saved = Db.update('evidence_files', evidenceId, { transcript: { language: t.language || '', segments: clean, machine: t.machine || t.segments || null },
      transcript_status: 'EDITED', transcript_edited_by: u.id, transcript_edited_at: nowIso_() }, expectedVersion);
    logAction_(u.id, 'EDIT_TRANSCRIPT', 'evidence_files', evidenceId, null, { segments: clean.length }, '');
    return evidencePublic_(saved);
  });
}

function apiUpdateEvidenceMeta(token, evidenceId, patch, expectedVersion) {
  return guard_(token, function (u) {
    var ev = Db.get('evidence_files', evidenceId);
    loadAudit_(u, ev.audit_id, 'audit.edit');
    var rec = {};
    ['station', 'area', 'stop_id', 'sample_label', 'note_text', 'locator_hint'].forEach(function (k) { if (k in patch) rec[k] = String(patch[k] || ''); });
    var saved = Db.update('evidence_files', evidenceId, rec, expectedVersion);
    var r = refreshAuditScore_(ev.audit_id, null);
    return { evidence: evidencePublic_(saved), score: r.score };
  });
}
