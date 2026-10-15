/**
 * Reports — Excel (score per item, findings) and PDF summary.
 * Every report states DRAFT vs CONFIRMED, dates, standard version and scope.
 */
var ITEM_STATUS_TH = { SCORED: 'ให้คะแนนแล้ว', NOT_STARTED: 'ยังไม่ตรวจ', INSUFFICIENT: 'หลักฐานไม่พอ', HELD: 'ระงับ (ต้องตรวจทาน)', PENDING_SCORE: 'รอเลือกคะแนน',
  EXEMPT: 'ยกเว้น (อนุมัติแล้ว)', OUT_OF_SCOPE: 'ไม่อยู่ในขอบเขต' };

function reportHeader_(a, bundle) {
  var ws = Db.get('workshops', a.workshop_id) || {}, g = a.group_id ? Db.get('groups', a.group_id) : null, t = a.team_id ? Db.get('teams', a.team_id) : null;
  return [
    ['สถานะรายงาน', a.status === 'CONFIRMED' ? 'ยืนยันแล้ว (FINAL)' : 'ร่าง — ยังไม่ยืนยัน (DRAFT)'],
    ['เลขที่รอบตรวจ', a.audit_no], ['ประเภทการตรวจ', a.audit_type], ['วันที่ตรวจ', a.audit_date],
    ['Workshop / Group / Team', [ws.code, g && g.name, t && t.name].filter(Boolean).join(' / ')],
    ['มาตรฐาน', bundle.set.name_th + ' — เวอร์ชัน ' + bundle.version.version_label + ' (มีผล ' + bundle.version.effective_date + ')'],
    ['ไฟล์ต้นทางมาตรฐาน', bundle.version.source_file_name + ' / ชีต ' + bundle.version.source_sheet_name],
    ['ขอบเขตการตรวจ', a.scope_mode === 'FULL' ? 'ตรวจเต็มทุกข้อ' : 'ตรวจบางส่วน — ' + (a.scope_note || 'ไม่ใช่ผลของทั้งมาตรฐาน')],
    ['ผู้ตรวจ / ผู้รับการตรวจ', a.auditor_name + ' / ' + (a.auditee_name || '-')],
    ['ยืนยันเมื่อ', a.confirmed_at || '-'], ['ส่งออกเมื่อ', Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm')]
  ];
}

function itemRows_(a, bundle, score, items) {
  var critById = indexById_(bundle.criteria);
  var itemByCrit = {}; items.forEach(function (i) { itemByCrit[i.criterion_id] = i; });
  var rulesById = indexById_(bundle.rules);
  return score.items.map(function (r) {
    var c = critById[r.criterion_id], i = itemByCrit[r.criterion_id] || {};
    var deducted = (r.deductions || []).reduce(function (s, d) { return s + d.points; }, 0);
    var reasons = (r.deductions || []).map(function (d) { var rule = rulesById[d.rule_id]; return d.rule_code + ' −' + d.points + ' (' + d.issue_key + ')' + (rule && rule.text ? ': ' + (rule.text.th || rule.text.zh) : ''); });
    if (r.overridden) reasons.push('แก้คะแนนจาก ' + r.override_from + ' → ' + r.score + ': ' + i.override_reason);
    if (r.hold_reasons && r.hold_reasons.length) reasons.push('ระงับ: ' + r.hold_reasons.join('; '));
    var title = c.title ? (c.title.th || c.title.zh || c.title.raw || '') : '';
    return [c.code, (dimName_(bundle, c.dimension_code)), title.split('\n')[0], c.max_points == null ? '' : c.max_points,
      bundle.set.scoring_mode === 'BAND' ? (i.ai_band_index != null && c.bands[i.ai_band_index] ? c.bands[i.ai_band_index].min + '–' + c.bands[i.ai_band_index].max : '') : (i.ai_proposed_score == null ? '' : i.ai_proposed_score),
      r.score == null ? '' : r.score, bundle.set.scoring_mode === 'BAND' ? '' : deducted, reasons.join('\n'),
      r.evidence.evidence_count + ' ชิ้น' + (r.evidence.sample_required != null ? ' / ตัวอย่าง ' + r.evidence.sample_collected + '/' + r.evidence.sample_required : ''),
      ITEM_STATUS_TH[r.status] || r.status];
  });
}

function dimName_(bundle, code) {
  var d = (bundle.version.dimensions || []).filter(function (x) { return x.code === code; })[0];
  if (!d || !d.name) return code;
  return String(d.name.th || d.name.zh || d.name.raw || code).split('\n')[0];
}

function xlsxFromRows_(fileName, sheets) {
  var ss = SpreadsheetApp.create('tmp-export-' + uuid_());
  try {
    sheets.forEach(function (s, idx) {
      var sh = idx === 0 ? ss.getSheets()[0].setName(s.name) : ss.insertSheet(s.name);
      var width = s.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
      var rows = s.rows.map(function (r) { var x = r.slice(); while (x.length < width) x.push(''); return x.map(function (v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }); });
      if (rows.length) sh.getRange(1, 1, rows.length, width).setValues(rows);
      if (s.headerRow) sh.getRange(s.headerRow, 1, 1, width).setFontWeight('bold').setBackground('#e8eef7');
      sh.getRange(1, 1, 1, 1).setFontWeight('bold');
      if (s.headerRow) sh.setFrozenRows(s.headerRow);
    });
    SpreadsheetApp.flush();
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw appError_('EXPORT', 'ส่งออก Excel ไม่สำเร็จ (HTTP ' + res.getResponseCode() + ')');
    return { file_name: fileName, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: Utilities.base64Encode(res.getBlob().getBytes()) };
  } finally {
    DriveApp.getFileById(ss.getId()).setTrashed(true);
  }
}

function apiExportAuditExcel(token, auditId) {
  return guard_(token, function (u) {
    var a = loadAudit_(u, auditId, 'report.export');
    var bundle = versionBundle_(a.standard_version_id);
    var items = Db.where('audit_items', 'audit_id', a.id);
    var score = scoreAudit_(a, bundle, items);
    var head = reportHeader_(a, bundle);
    var rows = [['รายงานสรุปคะแนนรายข้อ — ' + APP_NAME]].concat(head).concat([[''], summaryRow_(a, score), ['']]);
    var hdrIdx = rows.length + 1;
    rows.push(['ข้อ', 'หัวข้อ', 'รายการตรวจ', 'คะแนนเต็ม', 'คะแนน/ช่วงที่ AI เสนอ', 'คะแนนยืนยัน', 'คะแนนหัก', 'เหตุผล', 'ความครบถ้วนหลักฐาน', 'สถานะ']);
    itemRows_(a, bundle, score, items).forEach(function (r) { rows.push(r); });
    logAction_(u.id, 'EXPORT_AUDIT_XLSX', 'audits', a.id, null, null, '');
    return xlsxFromRows_(a.audit_no + (a.status === 'CONFIRMED' ? '_FINAL' : '_DRAFT') + '_scores.xlsx', [{ name: 'Scores', rows: rows, headerRow: hdrIdx }]);
  });
}

function summaryRow_(a, score) {
  if (a.status === 'CONFIRMED') return ['คะแนนสุดท้าย', a.final_score == null ? 'ไม่มี (ระงับ)' : a.final_score + ' / ' + a.final_of_max, 'ความครบถ้วน', a.coverage_pct + '%'];
  return ['คะแนนชั่วคราว (ยังไม่ใช่คะแนนสุดท้าย)', score.provisional.score == null ? '-' : score.provisional.score + ' จาก ' + score.provisional.of_max, 'ความครบถ้วน',
    (score.coverage.pct == null ? '-' : score.coverage.pct + '%') + ' (' + score.coverage.covered + '/' + score.coverage.required + ')'];
}

function apiExportFindingsExcel(token, filters) {
  return guard_(token, function (u) {
    var list = visibleFindings_(u, filters || {});
    var rows = [['รายการปัญหาและการแก้ไข — ' + APP_NAME], ['ส่งออกเมื่อ', Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm')],
      ['ขอบเขต', 'เฉพาะปัญหาจากรอบตรวจที่ยืนยันแล้ว ตามสิทธิ์ผู้ส่งออก'], ['ตัวกรอง', JSON.stringify(filters || {})], ['']];
    var hdr = rows.length + 1;
    rows.push(['Issue ID', 'เลขรอบตรวจ', 'ประเภท', 'Workshop', 'Group', 'Team', 'ข้อกำหนด', 'Red Line', 'สิ่งที่พบ', 'ผู้รับผิดชอบ', 'กำหนดเสร็จ', 'เกินกำหนด', 'สถานะ', 'การแก้ไขเฉพาะหน้า', 'สาเหตุ', 'มาตรการป้องกัน', 'ผลยืนยันประสิทธิผล']);
    list.forEach(function (f) {
      var act = lastAction_(f.id) || {};
      var rev = Db.where('closure_reviews', 'finding_id', f.id).sort(function (x, y) { return String(y.reviewed_at).localeCompare(String(x.reviewed_at)); })[0] || {};
      rows.push([f.issue_no, f.audit_no, f.audit_type, f.workshop, f.group, f.team, f.criterion_code, f.is_red_line ? 'ใช่' : '', f.description, f.owner_name, f.due_date, f.overdue ? 'เกินกำหนด' : '',
        f.status_th, act.containment || '', act.root_cause || '', act.preventive_action || '', rev.result ? (rev.result === 'EFFECTIVE' ? 'มีประสิทธิผล' : 'ยังไม่มีประสิทธิผล') + ': ' + rev.comment : '']);
    });
    logAction_(u.id, 'EXPORT_FINDINGS_XLSX', 'findings', '', null, { count: list.length }, '');
    return xlsxFromRows_('findings_' + todayBkk_() + '.xlsx', [{ name: 'Findings', rows: rows, headerRow: hdr }]);
  });
}

function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function apiExportAuditPdf(token, auditId) {
  return guard_(token, function (u) {
    var a = loadAudit_(u, auditId, 'report.export');
    var bundle = versionBundle_(a.standard_version_id);
    var items = Db.where('audit_items', 'audit_id', a.id);
    var score = scoreAudit_(a, bundle, items);
    var evidence = indexById_(Db.where('evidence_files', 'audit_id', a.id));
    var runs = indexById_(Db.all('ai_analysis_runs'));
    var findings = Db.where('findings', 'audit_id', a.id);
    var draft = a.status !== 'CONFIRMED';
    var h = [];
    h.push('<html><head><meta charset="utf-8"><style>body{font-family:"Sarabun","Noto Sans Thai",sans-serif;font-size:10.5pt;color:#1b2537}h1{font-size:16pt;color:#0b2a5b;margin:0 0 4px}h2{font-size:12pt;color:#0b2a5b;border-bottom:1px solid #c9d3e3;padding-bottom:2px;margin-top:14px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #c9d3e3;padding:3px 5px;vertical-align:top;text-align:left}th{background:#e8eef7}.wm{color:#b42318;font-weight:bold;font-size:13pt;border:2px solid #b42318;padding:4px 8px;display:inline-block}.ok{color:#05603a;font-weight:bold}.small{font-size:9pt;color:#4a5568}</style></head><body>');
    h.push('<h1>สรุปรอบออดิท ' + esc_(a.audit_no) + '</h1>');
    h.push(draft ? '<div class="wm">ร่าง — ยังไม่ยืนยัน (DRAFT) คะแนนอาจเปลี่ยนแปลง</div>' : '<div class="ok">ยืนยันแล้ว (FINAL)</div>');
    h.push('<h2>ข้อมูลรอบตรวจ</h2><table>');
    reportHeader_(a, bundle).forEach(function (r) { h.push('<tr><th style="width:30%">' + esc_(r[0]) + '</th><td>' + esc_(r[1]) + '</td></tr>'); });
    h.push('</table><h2>ผลคะแนน</h2><table>');
    var s = summaryRow_(a, score);
    h.push('<tr><th>' + esc_(s[0]) + '</th><td>' + esc_(s[1]) + '</td><th>' + esc_(s[2]) + '</th><td>' + esc_(s[3]) + '</td></tr>');
    if (score.red_line && score.red_line.confirmed_count) h.push('<tr><th>Red Line</th><td colspan="3">พบ ' + score.red_line.confirmed_count + ' รายการ, หัก ' + score.red_line.deduction + ' คะแนน (วิธีนับ: ' + esc_(score.red_line.mode || 'ยังไม่กำหนด') + ')</td></tr>');
    if (score.hold_reasons.length) h.push('<tr><th>คะแนนสุดท้ายถูกระงับ</th><td colspan="3">' + esc_(score.hold_reasons.join('; ')) + '</td></tr>');
    if (score.level) h.push('<tr><th>ระดับระบบ (KUP)</th><td colspan="3">' + esc_(score.level) + '</td></tr>');
    if (a.scope_mode === 'PARTIAL') h.push('<tr><th>หมายเหตุขอบเขต</th><td colspan="3">รอบตรวจบางส่วน — ไม่ใช่ผลผ่าน/ไม่ผ่านของทั้งมาตรฐาน</td></tr>');
    h.push('</table><h2>คะแนนรายข้อ</h2><table><tr><th>ข้อ</th><th>รายการตรวจ</th><th>เต็ม</th><th>AI เสนอ</th><th>ยืนยัน</th><th>หัก</th><th>เหตุผล</th><th>หลักฐาน</th><th>สถานะ</th></tr>');
    itemRows_(a, bundle, score, items).forEach(function (r) { h.push('<tr><td>' + esc_(r[0]) + '</td><td>' + esc_(r[2]) + '</td><td>' + esc_(r[3]) + '</td><td>' + esc_(r[4]) + '</td><td>' + esc_(r[5]) + '</td><td>' + esc_(r[6]) + '</td><td>' + esc_(r[7]).replace(/\n/g, '<br>') + '</td><td>' + esc_(r[8]) + '</td><td>' + esc_(r[9]) + '</td></tr>'); });
    h.push('</table><h2>หลักฐานอ้างอิงจากการวิเคราะห์</h2><table><tr><th>ข้อ</th><th>ข้อสังเกต (ประเภท)</th><th>หลักฐาน / ตำแหน่ง</th></tr>');
    var critById = indexById_(bundle.criteria);
    items.forEach(function (i) {
      var run = i.ai_run_id ? runs[i.ai_run_id] : null;
      if (!run || !run.parsed) return;
      run.parsed.observations.forEach(function (o) {
        var refs = (o.evidence_references || []).map(function (r) { var e = evidence[r.evidence_id]; return (e ? e.file_name + ' [EV-' + String(e.id).slice(0, 8) + ']' : r.evidence_id) + (r.locator ? ' @ ' + r.locator : ''); }).join('; ');
        h.push('<tr><td>' + esc_(critById[i.criterion_id].code) + '</td><td>' + esc_(o.text) + ' <span class="small">(' + ({ FACT: 'ข้อเท็จจริง', STATEMENT: 'คำกล่าว', ASSUMPTION: 'ข้อสันนิษฐาน' })[o.type] + ')</span></td><td>' + esc_(refs) + '</td></tr>');
      });
    });
    h.push('</table><p class="small">ผลวิเคราะห์ AI เป็นข้อเสนอ คะแนนในรายงานคำนวณโดยระบบจากกฎในมาตรฐาน และผ่านการยืนยันของผู้ตรวจ</p>');
    if (findings.length) {
      h.push('<h2>ปัญหาที่ต้องแก้ไข</h2><table><tr><th>Issue</th><th>ข้อ</th><th>สิ่งที่พบ</th><th>สถานะ</th></tr>');
      findings.forEach(function (f) { h.push('<tr><td>' + esc_(f.issue_no) + '</td><td>' + esc_(f.criterion_code) + (f.is_red_line ? ' (Red Line)' : '') + '</td><td>' + esc_(f.description) + '</td><td>' + esc_(FINDING_STATUS[f.status]) + '</td></tr>'); });
      h.push('</table>');
    }
    h.push('<p class="small">' + esc_(APP_NAME + ' v' + APP_VERSION + ' • engine ' + Scoring.ENGINE_VERSION + ' • standard hash ' + (bundle.version.content_hash || '-')) + '</p></body></html>');
    var pdf = HtmlService.createHtmlOutput(h.join('')).getBlob().getAs('application/pdf');
    logAction_(u.id, 'EXPORT_AUDIT_PDF', 'audits', a.id, null, null, '');
    return { file_name: a.audit_no + (draft ? '_DRAFT' : '_FINAL') + '.pdf', mime_type: 'application/pdf', base64: Utilities.base64Encode(pdf.getBytes()) };
  });
}
