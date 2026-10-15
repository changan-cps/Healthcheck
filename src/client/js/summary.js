/* Score summary, red lines, confirm, exports */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;

  App.route('/audit/:id/summary', function (id) {
    App.setTitle('สรุปคะแนน');
    App.$('#main').innerHTML = App.loading();
    App.api('apiGetAudit', id).then(function (d) { App.WS.data = d; render(d); }, function (e) { App.$('#main').innerHTML = App.errorBox(e, 'App.render()'); });
  });

  function render(d) {
    var a = d.audit, s = d.score, mode = d.standard.set.scoring_mode;
    var crit = {}; d.standard.criteria.forEach(function (c) { crit[c.id] = c; });
    var items = {}; d.items.forEach(function (i) { items[i.criterion_id] = i; });
    var rules = {}; d.standard.rules.forEach(function (r) { rules[r.id] = r; });
    var confirmed = a.status === 'CONFIRMED';
    App.setTitle('สรุปคะแนน ' + a.audit_no);
    var h = [];
    h.push('<div class="page-head"><div><a class="link-btn" href="#/audit/' + a.id + '">' + App.icon('chevl') + 'กลับไปหน้าตรวจ</a><h2 class="h-lg">' + esc(a.audit_no) + ' ' + App.chip(a.status) + '</h2>' +
      '<p class="muted">' + esc(App.typeLabel[a.audit_type]) + ' • ' + esc([d.workshop && d.workshop.code, d.group && d.group.name, d.team && d.team.name].filter(Boolean).join(' / ')) + ' • ' + esc(a.audit_date) + ' • ' + esc(d.standard.set.name_th) + ' ' + esc(d.standard.version.version_label) + '</p></div>' +
      '<div class="head-actions">' + (function () { var n = App.QC.nextTeamHref(a); return n && App.can('audit') ? '<a class="btn btn-primary" href="' + n.href + '">' + App.icon('chevr') + 'ตรวจทีมถัดไป: ' + esc(n.name) + '</a>' : ''; })() + '<button class="btn btn-ghost" data-exp="xlsx">' + App.icon('download') + 'Excel คะแนนรายข้อ</button><button class="btn btn-ghost" data-exp="pdf">' + App.icon('download') + 'PDF สรุปรอบ</button></div></div>');

    // score block — provisional vs final kept separate
    h.push('<section class="score-hero"><div class="sh-block"><span class="sh-label">' + (confirmed ? 'คะแนนสุดท้าย' : 'คะแนนสุดท้าย') + '</span><span class="sh-value">' +
      (confirmed ? (a.final_score == null ? '<span class="nodata">ไม่มี (ระงับ)</span>' : App.num(a.final_score) + '<small> / ' + App.num(a.final_of_max) + '</small>') :
        (s.final_score != null && s.can_confirm ? App.num(s.final_score) + '<small> / ' + App.num(s.final_of_max) + ' (รอยืนยัน)</small>' : '<span class="nodata">ยังไม่มี</span>')) + '</span>' +
      (a.scope_mode === 'PARTIAL' ? '<span class="t-warn">ตรวจบางส่วน — ไม่ใช่ผลของทั้งมาตรฐาน</span>' : '') + (s.level ? '<span>ระดับระบบ: ' + esc(s.level) + '</span>' : '') + '</div>' +
      '<div class="sh-block"><span class="sh-label">คะแนนชั่วคราว</span><span class="sh-value sh-sub">' + (s.provisional.score == null ? '–' : App.num(s.provisional.score) + '<small> จาก ' + App.num(s.provisional.of_max) + '</small>') + '</span><span class="muted">' + esc(s.provisional.note) + '</span></div>' +
      '<div class="sh-block"><span class="sh-label">ความครบถ้วนหลักฐาน</span><span class="sh-value sh-sub">' + (s.coverage.pct == null ? '–' : App.num(s.coverage.pct, 0) + '%') + '</span><span class="muted">' + s.coverage.covered + ' จาก ' + s.coverage.required + ' ข้อในขอบเขต</span></div>' +
      (s.red_line ? '<div class="sh-block"><span class="sh-label">Red Line</span><span class="sh-value sh-sub">' + s.red_line.confirmed_count + '</span><span class="muted">' + (s.red_line.confirmed_count ? (s.red_line.held ? 'ยังไม่กำหนดวิธีนับ — ระงับคะแนน' : 'หัก ' + s.red_line.deduction + ' คะแนน') : 'ไม่พบ') + '</span></div>' : '') + '</section>');

    if (!confirmed) {
      var blockers = s.blockers.concat(s.hold_reasons.map(function (r) { return { code: '-', reason: r }; }));
      if (blockers.length) h.push('<section class="panel panel-warn"><h2 class="panel-title">' + App.icon('alert') + 'ยังยืนยันรอบตรวจไม่ได้ (' + blockers.length + ' รายการ)</h2><ul class="blockers">' +
        blockers.map(function (b) { var it = b.code !== '-' ? d.standard.criteria.filter(function (c) { return c.code === b.code; })[0] : null; return '<li>' + (it ? '<a href="#/audit/' + a.id + '" data-jump="' + it.id + '"><strong>' + esc(b.code) + '</strong></a> ' : '') + esc(b.reason) + '</li>'; }).join('') + '</ul></section>');
      else h.push('<section class="panel panel-ok"><h2 class="panel-title">' + App.icon('check') + 'ทุกข้อครบแล้ว พร้อมยืนยันรอบตรวจ</h2><p>เมื่อยืนยันแล้ว คะแนนและหลักฐานจะแก้ไขไม่ได้ และระบบจะสร้างรายการปัญหาให้ติดตามการแก้ไข</p>' +
        (d.permissions.confirm ? '<button class="btn btn-primary" id="btn-confirm">' + App.icon('check') + 'ยืนยันรอบตรวจ</button>' : '<p class="hint">คุณไม่มีสิทธิ์ยืนยันรอบตรวจนี้</p>') + '</section>');
    }

    if (d.standard.red_lines.length) h.push(redLinePanel(d));

    if (mode === 'BAND' && s.categories) h.push('<section class="panel"><h2 class="panel-title">คะแนนรายหมวด KUP</h2><div class="table-wrap"><table class="tbl"><thead><tr><th>หมวด</th><th class="num">น้ำหนัก</th><th class="num">ตรวจแล้ว</th><th class="num">คะแนนหมวด (0–10)</th></tr></thead><tbody>' +
      s.categories.map(function (c) { return '<tr><td>' + esc(c.code + ' ' + App.firstLine(App.lang(c.name))) + '</td><td class="num">' + App.num(c.weight) + '</td><td class="num">' + c.scored + '/' + c.items + '</td><td class="num">' + (c.score == null ? '–' : App.num(c.score)) + '</td></tr>'; }).join('') + '</tbody></table></div></section>');

    h.push('<section class="panel"><h2 class="panel-title">คะแนนรายข้อ</h2><div class="table-wrap"><table class="tbl tbl-cards sum-tbl"><thead><tr><th>ข้อ</th><th>หัวข้อ</th><th class="num">คะแนนเต็ม</th><th class="num">AI เสนอ</th><th class="num">คะแนนยืนยัน</th><th class="num">คะแนนหัก</th><th>เหตุผล</th><th>หลักฐาน</th><th>สถานะ</th></tr></thead><tbody>' +
      s.items.map(function (r) {
        var c = crit[r.criterion_id], it = items[r.criterion_id] || {};
        var ded = (r.deductions || []).reduce(function (x, y) { return x + y.points; }, 0);
        var ai = mode === 'BAND' ? (it.ai_band_index != null && c.bands[it.ai_band_index] ? c.bands[it.ai_band_index].min + '–' + c.bands[it.ai_band_index].max : '–') : (it.ai_proposed_score == null ? '–' : App.num(it.ai_proposed_score));
        var reason = (r.deductions || []).map(function (x) { return esc(x.rule_code) + ' −' + App.num(x.points) + ' ' + esc(x.issue_key); }).join('<br>') + (r.overridden ? '<br>แก้จาก ' + App.num(r.override_from) + ': ' + esc(it.override_reason) : '') + (r.hold_reasons && r.hold_reasons.length ? '<br><span class="t-held">' + esc(r.hold_reasons.join('; ')) + '</span>' : '');
        var ev = r.evidence ? r.evidence.evidence_count + ' ชิ้น' + (r.evidence.sample_required != null ? ' • ตัวอย่าง ' + r.evidence.sample_collected + '/' + r.evidence.sample_required : '') + (r.evidence.complete ? '' : ' <span class="t-warn">ไม่ครบ</span>') : '';
        var incomplete = r.in_scope && r.status !== 'SCORED' && r.status !== 'EXEMPT';
        return '<tr class="' + (incomplete ? 'row-warn' : '') + (r.in_scope ? '' : ' row-out') + '"><td data-label="ข้อ"><strong>' + esc(c.code) + '</strong></td><td data-label="หัวข้อ">' + esc(App.firstLine(App.lang(c.title))) + '</td>' +
          '<td class="num" data-label="คะแนนเต็ม">' + App.num(c.max_points) + '</td><td class="num" data-label="AI เสนอ">' + ai + '</td><td class="num" data-label="คะแนนยืนยัน"><strong>' + (r.score == null ? '–' : App.num(r.score)) + '</strong></td>' +
          '<td class="num" data-label="คะแนนหัก">' + (mode === 'BAND' ? '–' : ded ? '−' + App.num(ded) : '0') + '</td><td data-label="เหตุผล">' + (reason || '–') +
          '<details class="calc-detail"><summary>ดูการคำนวณและหลักฐาน</summary>' + detail(d, r, c, it, rules) + '</details></td><td data-label="หลักฐาน">' + ev + '</td><td data-label="สถานะ">' + App.chip(r.status) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="hint">คะแนน AI เป็นข้อเสนอ คะแนนยืนยันคำนวณจากกฎในมาตรฐานและผ่านการตรวจทานของผู้ตรวจ</p></section>');

    if (d.findings.length) h.push('<section class="panel"><h2 class="panel-title">ปัญหาจากรอบนี้</h2><ul class="row-list">' + d.findings.map(function (f) { return '<li><a href="#/issue/' + f.id + '"><span class="rl-main"><strong>' + esc(f.issue_no) + '</strong> ' + esc(f.criterion_code) + ' — ' + esc(f.description) + '</span><span class="rl-meta">' + App.chip(f.status) + '</span></a></li>'; }).join('') + '</ul></section>');

    App.$('#main').innerHTML = h.join('');
    App.$$('[data-exp]').forEach(function (b) {
      b.onclick = function () {
        var fn = b.getAttribute('data-exp') === 'pdf' ? 'apiExportAuditPdf' : 'apiExportAuditExcel';
        b.disabled = true; var label = b.innerHTML; b.innerHTML = '<span class="spinner"></span>กำลังสร้างไฟล์…';
        App.api(fn, a.id).then(function (f) { App.download(f); App.toast('ดาวน์โหลด ' + f.file_name, 'ok'); }, App.fail).then(function () { b.disabled = false; b.innerHTML = label; });
      };
    });
    App.$$('[data-jump]').forEach(function (x) { x.onclick = function () { App.store.set('cps_ws_sel_' + a.id, x.getAttribute('data-jump')); }; });
    var bc = App.$('#btn-confirm');
    if (bc) bc.onclick = function () {
      App.confirm('ยืนยันรอบตรวจ ' + a.audit_no, 'คะแนนสุดท้าย ' + App.num(s.final_score) + ' / ' + App.num(s.final_of_max) + (a.scope_mode === 'PARTIAL' ? ' (ตรวจบางส่วน)' : '') + ' — หลังยืนยันจะแก้ไขผลไม่ได้', 'ยืนยันรอบตรวจ').then(function (ok) {
        if (!ok) return;
        bc.disabled = true;
        App.api('apiConfirmAudit', a.id, a.version).then(function (r) { App.toast('ยืนยันรอบตรวจแล้ว • สร้างปัญหา ' + r.findings_created + ' รายการ', 'ok'); App.render(); }, function (e) { bc.disabled = false; App.fail(e); });
      });
    };
    wireRedLine(d);
  }

  function detail(d, r, c, it, rules) {
    var ev = {}; d.evidence.forEach(function (e) { ev[e.id] = e; });
    var h = '<div class="small">';
    if (r.deductions && r.deductions.length) h += '<p><strong>การหักคะแนน</strong></p><ul>' + r.deductions.map(function (x) { var rl = rules[x.rule_id]; return '<li>' + esc(x.rule_code) + ' (' + esc(rl ? (rl.text.th || rl.text.zh) : '') + ') −' + App.num(x.points) + ' • ปัญหา "' + esc(x.issue_key) + '" • หลักฐาน ' + esc((x.evidence_ids || []).map(function (id) { return ev[id] ? ev[id].short_id : id; }).join(', ') || '–') + (x.note ? ' • ' + esc(x.note) : '') + '</li>'; }).join('') + '</ul>';
    if (r.band) h += '<p>ช่วงคะแนน ' + r.band.min + '–' + r.band.max + ' เลือก ' + App.num(r.score) + '</p>';
    var linked = d.links.filter(function (l) { return l.audit_item_id === it.id; }).map(function (l) { return ev[l.evidence_id]; }).filter(Boolean);
    h += '<p><strong>หลักฐานที่เชื่อม</strong> ' + (linked.length ? linked.map(function (e) { return esc(e.short_id + ' ' + (e.kind === 'NOTE' ? 'บันทึก' : e.file_name)); }).join(', ') : '–') + '</p>';
    if (it.auditor_notes) h += '<p><strong>บันทึกผู้ตรวจ</strong> ' + App.nl2br(it.auditor_notes) + '</p>';
    if (it.reviewed_at) h += '<p class="t-muted">ยืนยันผลข้อเมื่อ ' + App.fmtDate(it.reviewed_at, true) + '</p>';
    return h + '</div>';
  }

  // ---------- red lines ----------
  function redLinePanel(d) {
    var s = d.standard.version.settings || {};
    var recs = d.red_lines;
    return '<section class="panel" id="rl-panel"><h2 class="panel-title">' + App.icon('flag') + 'เงื่อนไข Red Line</h2><p class="hint">หักครั้งละ ' + (s.red_line_points == null ? '–' : s.red_line_points) + ' คะแนน • วิธีนับ: ' +
      esc({ ONCE: 'ครั้งเดียวต่อรอบตรวจ', PER_CLAUSE: 'ต่อข้อเงื่อนไขที่พบ', PER_OCCURRENCE: 'ต่อครั้งที่พบ' }[s.red_line_mode] || 'ยังไม่กำหนด (ถ้าพบ Red Line ระบบจะระงับคะแนนสุดท้าย)') + '</p><ul class="rl-list">' +
      d.standard.red_lines.map(function (c) {
        var mine = recs.filter(function (r) { return r.clause_id === c.id && r.status !== 'REJECTED'; });
        return '<li><div><strong>' + esc(c.clause_code) + '</strong> ' + esc(c.text.th || c.text.zh) + '</div>' + mine.map(function (r) {
          return '<div class="rl-rec">' + App.chip(r.status) + ' ' + esc(r.description) + (r.source === 'AI_PROPOSED' ? ' <span class="chip chip-info">AI เสนอ</span>' : '') +
            (d.permissions.edit ? ' <button class="link-btn" data-rl-edit="' + r.id + '">ตรวจสอบ/ยืนยัน</button>' : '') + '</div>';
        }).join('') + (d.permissions.edit ? '<button class="link-btn" data-rl-new="' + c.id + '">' + App.icon('plus') + 'บันทึกว่าพบ</button>' : '') + '</li>';
      }).join('') + '</ul></section>';
  }

  function wireRedLine(d) {
    App.$$('[data-rl-new]').forEach(function (b) { b.onclick = function () { App.redLineDialog(b.getAttribute('data-rl-new')); }; });
    App.$$('[data-rl-edit]').forEach(function (b) { b.onclick = function () { var r = d.red_lines.filter(function (x) { return x.id === b.getAttribute('data-rl-edit'); })[0]; App.redLineDialog(r.clause_id, r); }; });
  }

  /** Dialog to record/confirm/reject a red line. Without args: list all clauses. */
  App.redLineDialog = function (clauseId, rec) {
    var d = App.WS.data;
    if (!clauseId) {
      App.dialog({ title: 'Red Line', body: redLinePanel(d), actions: [{ label: 'ปิด' }], onOpen: function (w) {
        App.$$('[data-rl-new]', w).forEach(function (b) { b.onclick = function () { w.querySelector('[data-x]').click(); App.redLineDialog(b.getAttribute('data-rl-new')); }; });
        App.$$('[data-rl-edit]', w).forEach(function (b) { b.onclick = function () { var r = d.red_lines.filter(function (x) { return x.id === b.getAttribute('data-rl-edit'); })[0]; w.querySelector('[data-x]').click(); App.redLineDialog(r.clause_id, r); }; });
      } });
      return;
    }
    var c = d.standard.red_lines.filter(function (x) { return x.id === clauseId; })[0];
    var sel = {}; ((rec && rec.evidence_ids) || []).forEach(function (id) { sel[id] = true; });
    App.dialog({ title: 'Red Line ' + c.clause_code, body: '<p>' + esc(c.text.th || c.text.zh) + '</p><label class="field"><span>สิ่งที่พบ</span><textarea id="rl-desc" rows="3">' + esc(rec ? rec.description : '') + '</textarea></label>' +
      '<fieldset class="field"><legend>หลักฐาน (จำเป็นเมื่อยืนยัน)</legend><div class="pick-list">' + (d.evidence.length ? d.evidence.map(function (e) { return '<label class="check"><input type="checkbox" value="' + e.id + '"' + (sel[e.id] ? ' checked' : '') + '><span>' + esc(e.short_id + ' ' + (e.kind === 'NOTE' ? String(e.note_text).slice(0, 50) : e.file_name)) + '</span></label>'; }).join('') : '<p class="t-muted">ยังไม่มีหลักฐานในรอบนี้</p>') + '</div></fieldset>',
      actions: [{ label: 'ยกเลิก', value: null }].concat(rec ? [{ label: 'ไม่ใช่ Red Line', value: 'REJECTED' }] : []).concat([{ label: 'ยืนยันว่าพบ Red Line', kind: 'danger', value: 'CONFIRMED' }]),
      onOpen: function (w) { App.WS._rlw = w; } }).then(function (status) {
      if (!status) return;
      var w = App.WS._rlw;
      var data = { id: rec ? rec.id : null, version: rec ? rec.version : null, clause_id: clauseId, status: status, description: w.querySelector('#rl-desc').value, evidence_ids: App.$$('.pick-list input:checked', w).map(function (x) { return x.value; }) };
      App.api('apiSetRedLine', d.audit.id, data).then(function () { App.toast(status === 'CONFIRMED' ? 'บันทึก Red Line แล้ว' : 'บันทึกว่าไม่ใช่ Red Line', 'ok'); App.render(); }, App.fail);
    });
  };
})();
