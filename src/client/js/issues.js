/* Findings list and detail with corrective action and effectiveness review. */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;

  App.route('/issues', function (q) {
    App.setTitle('ปัญหาและติดตามการแก้ไข');
    var md = App.state.md;
    var st = q.status || '';
    App.$('#main').innerHTML = '<div class="page-head"><div class="seg" role="group" aria-label="สถานะ">' + [['', 'ทั้งหมด'], ['OPEN_ANY', 'ยังเปิด'], ['OVERDUE', 'เกินกำหนด'], ['FIXED_PENDING_VERIFY', 'รอตรวจยืนยัน'], ['CLOSED', 'ปิดแล้ว']].map(function (s) {
      var nq = Object.assign({}, q, { status: s[0] }); if (!s[0]) delete nq.status;
      return '<a class="seg-btn' + (st === s[0] ? ' on' : '') + '" aria-pressed="' + (st === s[0]) + '" href="#/issues?' + Object.keys(nq).map(function (k) { return k + '=' + encodeURIComponent(nq[k]); }).join('&') + '">' + s[1] + '</a>';
    }).join('') + '</div><label class="field inline"><span class="sr-only">Workshop</span><select id="is-ws"><option value="">ทุก Workshop</option>' + md.workshops.map(function (w) { return '<option value="' + w.id + '"' + (q.workshop_id === w.id ? ' selected' : '') + '>' + esc(w.code) + '</option>'; }).join('') + '</select></label>' +
      '<label class="search"><span class="sr-only">ค้นหา</span><input id="is-search" type="search" placeholder="ค้นหา Issue ID ข้อกำหนด ผู้รับผิดชอบ"></label><button class="btn btn-ghost" id="is-exp">' + App.icon('download') + 'Excel</button></div><div id="is-list">' + App.loading() + '</div>';
    var filters = {}; ['status', 'workshop_id', 'audit_type', 'dimension_code', 'from', 'to', 'audit_id'].forEach(function (k) { if (q[k]) filters[k] = q[k]; });
    if (q.include_demo === '1') filters.include_demo = true;
    App.$('#is-ws').onchange = function () { var nq = Object.assign({}, q, { workshop_id: this.value }); if (!this.value) delete nq.workshop_id; location.hash = '#/issues?' + Object.keys(nq).map(function (k) { return k + '=' + encodeURIComponent(nq[k]); }).join('&'); };
    App.$('#is-exp').onclick = function () { var b = this; b.disabled = true; App.api('apiExportFindingsExcel', filters).then(App.download, App.fail).then(function () { b.disabled = false; }); };
    App.api('apiListFindings', filters).then(function (list) {
      var draw = function (t) {
        t = (t || '').toLowerCase();
        var rows = list.filter(function (f) { return !t || [f.issue_no, f.criterion_code, f.owner_name, f.description, f.team].join(' ').toLowerCase().indexOf(t) >= 0; });
        App.$('#is-list').innerHTML = rows.length ? '<div class="table-wrap"><table class="tbl tbl-cards sortable"><thead><tr><th data-sort="text">Issue ID</th><th data-sort="text">Workshop</th><th data-sort="text">Team/Group</th><th data-sort="text">KUP/หัวข้อ</th><th data-sort="text">ข้อกำหนด</th><th>สิ่งที่พบ</th><th data-sort="text">ผู้รับผิดชอบ</th><th data-sort="text">กำหนดเสร็จ</th><th>สถานะ</th></tr></thead><tbody>' +
          rows.map(function (f) {
            return '<tr><td data-label="Issue ID"><a href="#/issue/' + f.id + '"><strong>' + esc(f.issue_no) + '</strong></a>' + (f.is_red_line ? ' <span class="chip chip-bad">Red Line</span>' : '') + '</td><td data-label="Workshop">' + esc(f.workshop) + '</td><td data-label="Team/Group">' + esc(f.team || f.group || '–') + '</td>' +
              '<td data-label="หัวข้อ">' + esc(f.audit_type === 'KUP' ? f.dimension_code : App.typeLabel[f.audit_type]) + '</td><td data-label="ข้อกำหนด">' + esc(f.criterion_code) + '</td><td data-label="สิ่งที่พบ">' + esc(f.description) + '</td>' +
              '<td data-label="ผู้รับผิดชอบ">' + (f.owner_name ? esc(f.owner_name) : '<span class="t-warn">ยังไม่กำหนด</span>') + '</td><td data-label="กำหนดเสร็จ">' + (f.due_date ? (f.overdue ? '<span class="t-bad">' + esc(f.due_date) + ' (เกินกำหนด)</span>' : esc(f.due_date)) : '<span class="t-warn">ยังไม่กำหนด</span>') + '</td><td data-label="สถานะ">' + App.chip(f.status) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : App.empty('ไม่พบปัญหา', list.length ? 'ลองเปลี่ยนคำค้นหา' : 'ปัญหาจะถูกสร้างเมื่อยืนยันรอบตรวจที่มีข้อไม่สอดคล้อง');
      };
      draw('');
      App.$('#is-search').oninput = App.debounce(function (e) { draw(e.target.value); }, 150);
      App.sortable(App.$('#is-list'));
    }, function (e) { App.$('#is-list').innerHTML = App.errorBox(e, 'App.render()'); });
  });

  App.route('/issue/:id', function (id) {
    App.setTitle('รายละเอียดปัญหา');
    App.$('#main').innerHTML = App.loading();
    App.api('apiGetFinding', id).then(render, function (e) { App.$('#main').innerHTML = App.errorBox(e, 'App.render()'); });
  });

  function evList(list) {
    if (!list.length) return '<p class="t-muted">ไม่มี</p>';
    return '<ul class="ev-list">' + list.map(function (x) { var e = x.evidence; return '<li class="ev"><span class="thumb thumb-ic">' + App.icon(e.kind === 'AUDIO' ? 'mic' : e.kind === 'NOTE' ? 'note' : /PHOTO/.test(e.kind) ? 'camera' : 'file') + '</span><div class="ev-body"><div class="ev-title"><strong>' + esc(e.short_id) + '</strong> ' + esc(e.kind === 'NOTE' ? '' : e.file_name) + '</div>' + (e.kind === 'NOTE' ? '<p class="ev-note">' + App.nl2br(e.note_text) + '</p>' : '<button class="link-btn" data-open="' + e.id + '">' + App.icon('eye') + 'เปิด</button>') + '<div class="ev-meta">' + App.fmtDate(e.captured_at, true) + '</div></div></li>'; }).join('') + '</ul>';
  }

  function render(d) {
    var f = d.finding, p = d.permissions;
    App.setTitle(f.issue_no);
    var src = d.evidence.filter(function (x) { return x.phase === 'SOURCE'; }), after = d.evidence.filter(function (x) { return x.phase === 'AFTER_FIX'; });
    var act = d.actions.slice().sort(function (a, b) { return String(b.submitted_at).localeCompare(String(a.submitted_at)); })[0];
    var steps = [['OPEN', 'เปิด'], ['IN_PROGRESS', 'กำลังแก้ไข'], ['FIXED_PENDING_VERIFY', 'แก้ไขแล้ว รอตรวจยืนยัน'], ['CLOSED', 'ปิดแล้ว']];
    var idx = steps.map(function (s) { return s[0]; }).indexOf(f.status);
    var h = '<div class="page-head"><div><a class="link-btn" href="#/issues">' + App.icon('chevl') + 'รายการปัญหา</a><h2 class="h-lg">' + esc(f.issue_no) + ' ' + App.chip(f.status) + (f.is_red_line ? ' <span class="chip chip-bad">Red Line</span>' : '') + '</h2>' +
      '<p class="muted">' + esc(f.workshop + (f.group ? ' / ' + f.group : '') + (f.team ? ' / ' + f.team : '')) + ' • รอบตรวจ <a href="#/audit/' + f.audit_id + '/summary">' + esc(f.audit_no) + '</a> • ข้อ ' + esc(f.criterion_code) + '</p></div></div>' +
      '<ol class="progress-steps" aria-label="สถานะการแก้ไข">' + steps.map(function (s, i) { return '<li class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '"' + (i === idx ? ' aria-current="step"' : '') + '>' + s[1] + '</li>'; }).join('') + '</ol>';
    h += '<div class="two-col"><section class="panel"><h2 class="panel-title">สิ่งที่พบ</h2><p>' + App.nl2br(f.description) + '</p>' +
      (d.criterion ? '<p class="hint">ข้อกำหนด: ' + esc(App.firstLine(App.lang(d.criterion.title))) + '</p>' : '') + (d.rule ? '<p class="hint">เกณฑ์: ' + esc(d.rule.code) + ' ' + esc(d.rule.text.th || d.rule.text.zh) + '</p>' : '') +
      '<h3 class="sub">หลักฐานต้นทาง</h3>' + evList(src) + '</section>';
    h += '<section class="panel"><h2 class="panel-title">ผู้รับผิดชอบและกำหนดเสร็จ</h2><form id="own-f" class="form-grid">' +
      '<label class="field"><span>ผู้รับผิดชอบ</span><input name="owner_name" value="' + esc(f.owner_name || '') + '"' + (p.update && f.status !== 'CLOSED' ? '' : ' disabled') + '></label>' +
      '<label class="field"><span>กำหนดเสร็จ</span><input type="date" name="due_date" value="' + esc(f.due_date || '') + '"' + (p.update && f.status !== 'CLOSED' ? '' : ' disabled') + '></label>' +
      (p.update && f.status !== 'CLOSED' ? '<div class="span-2"><button class="btn btn-ghost">บันทึกผู้รับผิดชอบ</button></div>' : '') + '</form></section></div>';
    h += '<section class="panel"><h2 class="panel-title">การแก้ไข</h2>' + (act ? '<dl class="facts facts-wide"><div><dt>การแก้ไขเฉพาะหน้า</dt><dd>' + App.nl2br(act.containment) + '</dd></div><div><dt>การวิเคราะห์สาเหตุ</dt><dd>' + App.nl2br(act.root_cause) + '</dd></div><div><dt>มาตรการป้องกันเกิดซ้ำ</dt><dd>' + App.nl2br(act.preventive_action) + '</dd></div><div><dt>ส่งเมื่อ</dt><dd>' + App.fmtDate(act.submitted_at, true) + '</dd></div></dl>' : '<p class="t-muted">ยังไม่มีการส่งผลการแก้ไข</p>') +
      '<h3 class="sub">หลักฐานหลังแก้ไข</h3>' + evList(after);
    if (p.upload_after_fix && f.status !== 'CLOSED' && f.status !== 'FIXED_PENDING_VERIFY') h += '<label class="btn btn-ghost">' + App.icon('upload') + 'แนบหลักฐานหลังแก้ไข<input type="file" id="af-file" accept="image/*,application/pdf" hidden></label>';
    if (p.submit && (f.status === 'OPEN' || f.status === 'IN_PROGRESS')) h += '<form id="ca-f" class="stack ca-form"><label class="field"><span>การแก้ไขเฉพาะหน้า</span><textarea name="containment" rows="2" required>' + esc(act ? act.containment : '') + '</textarea></label>' +
      '<label class="field"><span>การวิเคราะห์สาเหตุ</span><textarea name="root_cause" rows="2" required>' + esc(act ? act.root_cause : '') + '</textarea></label>' +
      '<label class="field"><span>มาตรการป้องกันเกิดซ้ำ</span><textarea name="preventive_action" rows="2" required>' + esc(act ? act.preventive_action : '') + '</textarea></label>' +
      '<p class="hint">ต้องแนบหลักฐานหลังแก้ไขอย่างน้อย 1 ชิ้นก่อนส่ง</p><button class="btn btn-primary">ส่งผลการแก้ไข (แก้ไขแล้ว รอตรวจยืนยัน)</button></form>';
    h += '</section>';
    h += '<section class="panel"><h2 class="panel-title">ผลยืนยันประสิทธิผล</h2>' + (d.reviews.length ? '<ul class="plain-list">' + d.reviews.map(function (r) { return '<li>' + (r.result === 'EFFECTIVE' ? App.chip('CLOSED', 'มีประสิทธิผล') : App.chip('OPEN', 'ยังไม่มีประสิทธิผล')) + ' ' + esc(r.comment) + ' <span class="t-muted">' + App.fmtDate(r.reviewed_at, true) + '</span></li>'; }).join('') + '</ul>' : '<p class="t-muted">ยังไม่มีการตรวจยืนยัน</p>') +
      (f.status === 'FIXED_PENDING_VERIFY' ? (p.verify ? '<form id="rv-f" class="stack"><label class="field"><span>ความเห็นผู้ตรวจยืนยัน</span><textarea name="comment" rows="2" required></textarea></label><div class="btn-row"><button class="btn btn-primary" value="EFFECTIVE">มีประสิทธิผล — ปิดปัญหา</button><button class="btn btn-ghost" value="NOT_EFFECTIVE">ยังไม่มีประสิทธิผล — ส่งกลับแก้ไข</button></div></form>' : '<p class="hint">ผู้ส่งผลการแก้ไขตรวจยืนยันเองไม่ได้ ต้องเป็นผู้ตรวจคนอื่นหรือ Admin</p>') : '') + '</section>';
    h += '<section class="panel"><h2 class="panel-title">ประวัติการเปลี่ยนแปลง</h2>' + (d.history.length ? '<ul class="timeline">' + d.history.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); }).map(function (l) { return '<li><span class="t-muted">' + App.fmtDate(l.created_at, true) + '</span> ' + esc(l.action) + (l.reason ? ' — ' + esc(l.reason) : '') + '</li>'; }).join('') + '</ul>' : '<p class="t-muted">ยังไม่มี</p>') + '</section>';
    App.$('#main').innerHTML = h;
    App.$$('[data-open]').forEach(function (b) {
      b.onclick = function () {
        App.api('apiGetEvidenceContent', b.getAttribute('data-open')).then(function (fl) { if (fl.base64) App.download(fl); }, App.fail);
      };
    });
    var own = App.$('#own-f');
    if (own) own.onsubmit = function (ev) { ev.preventDefault(); App.api('apiUpdateFinding', f.id, { owner_name: own.owner_name.value, due_date: own.due_date.value, status: 'IN_PROGRESS' }, f.version).then(function () { App.toast('บันทึกแล้ว', 'ok'); App.render(); }, App.fail); };
    var af = App.$('#af-file');
    if (af) af.onchange = function () {
      var file = af.files[0]; if (!file) return;
      var r = new FileReader();
      r.onload = function () {
        App.api('apiUploadEvidence', { audit_id: f.audit_id, kind: /^image\//.test(file.type) ? 'OVERVIEW_PHOTO' : 'DOCUMENT', file_name: file.name, mime_type: file.type, base64: String(r.result).split(',')[1], phase: 'AFTER_FIX', finding_id: f.id })
          .then(function () { App.toast('แนบหลักฐานหลังแก้ไขแล้ว', 'ok'); App.render(); }, App.fail);
      };
      r.readAsDataURL(file);
    };
    var ca = App.$('#ca-f');
    if (ca) ca.onsubmit = function (ev) { ev.preventDefault(); App.api('apiSubmitCorrectiveAction', f.id, { containment: ca.containment.value, root_cause: ca.root_cause.value, preventive_action: ca.preventive_action.value, version: f.version }).then(function () { App.toast('ส่งผลการแก้ไขแล้ว — รอตรวจยืนยัน', 'ok'); App.render(); }, App.fail); };
    var rv = App.$('#rv-f');
    if (rv) App.$$('button', rv).forEach(function (b) { b.onclick = function (ev) { ev.preventDefault(); App.api('apiReviewClosure', f.id, { result: b.value, comment: rv.comment.value, version: f.version }).then(function () { App.toast(b.value === 'EFFECTIVE' ? 'ปิดปัญหาแล้ว' : 'ส่งกลับแก้ไขแล้ว', 'ok'); App.render(); }, App.fail); }; });
  }
})();
