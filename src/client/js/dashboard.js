/* Dashboard */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;

  function quarterOptions() {
    var y = new Date().getFullYear(), out = ['<option value="">ทุกไตรมาส</option>'];
    for (var yy = y; yy >= y - 1; yy--) for (var q = 4; q >= 1; q--) out.push('<option value="' + yy + '-Q' + q + '">Q' + q + '/' + yy + '</option>');
    return out.join('');
  }

  function filterForm(f) {
    var md = App.state.md;
    var opt = function (list, val, label, valKey) { return list.map(function (x) { var v = x[valKey || 'id']; return '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(label(x)) + '</option>'; }).join(''); };
    var count = ['from', 'to', 'quarter', 'workshop_id', 'group_id', 'team_id', 'audit_type', 'kup_dimension'].filter(function (k) { return f[k]; }).length;
    return '<details class="filters"' + (window.innerWidth >= 768 ? ' open' : '') + '><summary>' + App.icon('filter') + 'ตัวกรอง' + (count ? ' (' + count + ')' : '') + '</summary><form id="dash-f" class="filter-grid">' +
      '<label class="field"><span>ตั้งแต่วันที่</span><input type="date" name="from" value="' + esc(f.from || '') + '"></label>' +
      '<label class="field"><span>ถึงวันที่</span><input type="date" name="to" value="' + esc(f.to || '') + '"></label>' +
      '<label class="field"><span>ไตรมาส</span><select name="quarter">' + quarterOptions().replace('value="' + f.quarter + '"', 'value="' + f.quarter + '" selected') + '</select></label>' +
      '<label class="field"><span>Workshop</span><select name="workshop_id"><option value="">ทั้งหมด</option>' + opt(md.workshops, f.workshop_id, function (w) { return w.code + ' ' + w.name_th; }) + '</select></label>' +
      '<label class="field"><span>Group</span><select name="group_id"><option value="">ทั้งหมด</option>' + opt(md.groups.filter(function (g) { return !f.workshop_id || g.workshop_id === f.workshop_id; }), f.group_id, function (g) { return g.name; }) + '</select></label>' +
      '<label class="field"><span>Team</span><select name="team_id"><option value="">ทั้งหมด</option>' + opt(md.teams.filter(function (t) { return (!f.workshop_id || t.workshop_id === f.workshop_id) && (!f.group_id || t.group_id === f.group_id); }), f.team_id, function (t) { return t.name; }) + '</select></label>' +
      '<label class="field"><span>ประเภทการตรวจ</span><select name="audit_type"><option value="">ทั้งหมด</option>' + ['TEAM', 'GROUP', 'KUP'].map(function (t) { return '<option value="' + t + '"' + (f.audit_type === t ? ' selected' : '') + '>' + App.typeLabel[t] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>หมวด KUP</span><select name="kup_dimension"' + (f.audit_type === 'KUP' ? '' : ' disabled') + '><option value="">ทั้งหมด</option>' + ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7'].map(function (k) { return '<option' + (f.kup_dimension === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></label>' +
      '<label class="check"><input type="checkbox" name="include_demo"' + (f.include_demo ? ' checked' : '') + '><span>รวมข้อมูลสาธิต</span></label>' +
      '<div class="filter-actions"><button class="btn btn-primary" type="submit">ใช้ตัวกรอง</button><a class="btn btn-ghost" href="#/">ล้าง</a></div></form></details>';
  }

  function qs(f, extra) {
    var o = {}; Object.keys(f).forEach(function (k) { if (f[k]) o[k] = f[k]; });
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
  }

  App.route('/', function (q) {
    App.setTitle('ภาพรวม');
    var f = { from: q.from || '', to: q.to || '', quarter: q.quarter || '', workshop_id: q.workshop_id || '', group_id: q.group_id || '', team_id: q.team_id || '', audit_type: q.audit_type || '', kup_dimension: q.kup_dimension || '', include_demo: q.include_demo === '1' };
    var main = App.$('#main');
    main.innerHTML = filterForm(f) + '<div id="dash-body">' + App.loading() + '</div>';
    var form = App.$('#dash-f');
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var o = {}; ['from', 'to', 'quarter', 'workshop_id', 'group_id', 'team_id', 'audit_type', 'kup_dimension'].forEach(function (k) { if (form[k].value && !form[k].disabled) o[k] = form[k].value; });
      if (form.include_demo.checked) o.include_demo = '1';
      location.hash = '#/?' + qs(o);
    };
    form.audit_type.onchange = function () { form.kup_dimension.disabled = form.audit_type.value !== 'KUP'; };
    var load = function () {
      App.api('apiDashboard', Object.assign({}, f, { include_demo: f.include_demo })).then(function (d) { App.$('#dash-body').innerHTML = body(d, f); }, function (e) { App.$('#dash-body').innerHTML = App.errorBox(e, 'App.render()'); });
    };
    load();
  });

  function body(d, f) {
    var base = qs({ from: f.from, to: f.to, quarter: f.quarter, workshop_id: f.workshop_id, group_id: f.group_id, team_id: f.team_id, audit_type: f.audit_type, include_demo: f.include_demo ? '1' : '' });
    var link = function (path, extra) { var s = qs({ from: f.from, to: f.to, quarter: f.quarter, workshop_id: f.workshop_id, audit_type: f.audit_type, include_demo: f.include_demo ? '1' : '' }, extra); return '#' + path + (s ? '?' + s : ''); };
    var ac = d.audit_counts, fc = d.finding_counts, cr = d.closure_rate;
    var h = [];
    h.push('<section class="kpi-strip" aria-label="ตัวเลขสรุป">' +
      kpi('รอบตรวจทั้งหมด', ac.total, '', link('/audits')) +
      kpi('กำลังตรวจ', ac.in_progress, '', link('/audits', { status: 'IN_PROGRESS' })) +
      kpi('ยืนยันแล้ว', ac.confirmed, '', link('/audits', { status: 'CONFIRMED' })) +
      kpi('คะแนนเฉลี่ย', d.average_pct == null ? null : App.num(d.average_pct, 1) + '%', d.average_note || ('จาก ' + (d.by_version[0] ? d.by_version[0].audits : 0) + ' รอบที่ยืนยันแล้วแบบตรวจเต็ม' + (d.excluded_from_average ? ' (ไม่รวมตรวจบางส่วน ' + d.excluded_from_average + ' รอบ)' : '')), null, 'wide') +
      '</section>');
    h.push('<section class="kpi-strip kpi-issues" aria-label="ปัญหา">' +
      kpi('ปัญหาทั้งหมด', fc.total, '', link('/issues')) +
      kpi('ยังเปิด', fc.open, fc.pending_verify ? 'รอตรวจยืนยัน ' + fc.pending_verify : '', link('/issues', { status: 'OPEN_ANY' }), fc.open ? 'warn' : '') +
      kpi('เกินกำหนด', fc.overdue, '', link('/issues', { status: 'OVERDUE' }), fc.overdue ? 'bad' : '') +
      kpi('ปิดแล้ว', fc.closed, '', link('/issues', { status: 'CLOSED' })) +
      kpi('อัตราปิดปัญหา', cr.pct == null ? null : App.num(cr.pct, 1) + '%', cr.denominator ? 'ปิด ' + cr.numerator + ' จาก ' + cr.denominator + ' รายการ' : 'ยังไม่มีปัญหา', null, 'wide') + '</section>');

    if (!d.comparable) h.push('<p class="notice notice-info">' + App.icon('alert') + esc(d.average_note) + '</p>');
    h.push('<div class="dash-grid">');
    d.by_version.forEach(function (v) {
      h.push('<section class="panel"><header class="panel-h"><h2>คะแนนเฉลี่ยแยก Workshop</h2><span class="muted">' + esc(v.label) + ' • ' + v.audits + ' รอบ</span></header>' +
        App.Charts.hbars(v.by_workshop.map(function (w) { return { label: w.workshop, value: w.average_pct, note: w.audits + ' รอบ', href: link('/audits', { workshop_id: w.workshop_id, status: 'CONFIRMED' }), tone: w.average_pct < 70 ? 'bad' : w.average_pct < 85 ? 'warn' : 'ok' }; }), { max: 100, suffix: '%', label: 'คะแนนเฉลี่ยแยก Workshop' }) + '</section>');
      h.push('<section class="panel"><header class="panel-h"><h2>แนวโน้มคะแนนตามรอบตรวจ</h2><span class="muted">' + esc(v.label) + '</span></header>' +
        App.Charts.line(v.trend.map(function (t) { return { label: t.audit_no + ' (' + t.workshop + ' ' + t.date + ')', short: t.date.slice(5), value: t.pct, href: '#/audit/' + t.audit_id + '/summary' }; }), { label: 'แนวโน้มคะแนน ' + v.label }) + '</section>');
    });
    if (!d.by_version.length) h.push('<section class="panel span-2">' + App.empty('ยังไม่มีคะแนนที่เปรียบเทียบได้', 'คะแนนจะแสดงเมื่อมีรอบตรวจที่ยืนยันแล้วแบบตรวจเต็ม — รอบที่กำลังตรวจหรือตรวจบางส่วนจะไม่ถูกนับเป็นคะแนนเฉลี่ย', App.can('audit') ? '<a class="btn btn-primary" href="#/audits/new">' + App.icon('plus') + 'สร้างรอบออดิท</a>' : '') + '</section>');
    h.push('<section class="panel"><header class="panel-h"><h2>Pareto ปัญหาแยกหัวข้อ</h2><span class="muted">' + fc.total + ' รายการ</span></header>' +
      App.Charts.pareto(d.pareto.map(function (p) { return Object.assign({}, p, { href: link('/issues', { dimension_code: p.dimension_code, audit_type: p.audit_type }) }); })) + '</section>');
    h.push('<section class="panel"><header class="panel-h"><h2>ปัญหาที่ต้องติดตามเร่งด่วน</h2><span class="muted">Red Line / เกินกำหนด / ครบกำหนดใน 7 วัน</span></header>' + urgent(d.urgent, d.unassigned) + '</section>');
    h.push('<section class="panel span-2"><header class="panel-h"><h2>คะแนนล่าสุดแยก Team / Group / KUP</h2></header>' + unitTable(d.unit_table) + '</section>');
    h.push('</div>');
    return h.join('');
  }

  function kpi(label, value, note, href, tone) {
    var inner = '<span class="kpi-label">' + esc(label) + '</span><span class="kpi-value">' + (value == null ? '<span class="nodata">ไม่มีข้อมูล</span>' : esc(value)) + '</span>' + (note ? '<span class="kpi-note">' + esc(note) + '</span>' : '');
    var cls = 'kpi' + (tone === 'wide' ? ' kpi-wide' : tone ? ' kpi-' + tone : '');
    return href ? '<a class="' + cls + '" href="' + esc(href) + '">' + inner + '</a>' : '<div class="' + cls + '">' + inner + '</div>';
  }

  function urgent(list, unassigned) {
    if (!list.length) return App.empty('ไม่มีปัญหาเร่งด่วน', unassigned ? 'มี ' + unassigned + ' ปัญหาที่ยังไม่กำหนดผู้รับผิดชอบหรือกำหนดเสร็จ' : '', unassigned ? '<a class="btn btn-ghost" href="#/issues?status=OPEN_ANY">ดูปัญหาที่ยังเปิด</a>' : '');
    return '<ul class="row-list">' + list.map(function (f) {
      return '<li><a href="#/issue/' + f.id + '"><span class="rl-main"><strong>' + esc(f.issue_no) + '</strong> ' + (f.is_red_line ? '<span class="chip chip-bad">Red Line</span> ' : '') + esc(f.description) + '</span>' +
        '<span class="rl-meta">' + esc(f.workshop + (f.team ? ' / ' + f.team : '')) + ' • ' + (f.due_date ? (f.overdue ? '<span class="t-bad">เกินกำหนด ' + esc(f.due_date) + '</span>' : 'กำหนด ' + esc(f.due_date)) : 'ยังไม่กำหนดวันเสร็จ') + '</span></a></li>';
    }).join('') + '</ul>';
  }

  function unitTable(rows) {
    if (!rows.length) return App.empty('ยังไม่มีรอบตรวจที่ยืนยันแล้ว', '');
    return '<div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>ประเภท</th><th>Workshop</th><th>หน่วย</th><th>มาตรฐาน</th><th>วันที่</th><th class="num">คะแนน</th><th>ขอบเขต</th><th>รายละเอียด KUP</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var score = r.final_score == null ? '<span class="nodata">ไม่มีคะแนนสุดท้าย</span>' : App.num(r.final_score) + ' / ' + App.num(r.final_of_max);
        var kup = r.kup_categories ? r.kup_categories.map(function (c) { return esc(c.code) + ' ' + (c.score == null ? '–' : App.num(c.score)); }).join(', ') + (r.level ? ' • ' + esc(r.level) : '') : '–';
        return '<tr><td data-label="ประเภท">' + esc(App.typeLabel[r.audit_type]) + '</td><td data-label="Workshop">' + esc(r.workshop) + '</td><td data-label="หน่วย">' + esc(r.unit || '–') + '</td><td data-label="มาตรฐาน">' + esc(r.version) + '</td>' +
          '<td data-label="วันที่">' + esc(r.date) + '</td><td class="num" data-label="คะแนน"><a href="#/audit/' + r.audit_id + '/summary">' + score + '</a></td><td data-label="ขอบเขต">' + (r.scope_mode === 'FULL' ? 'ตรวจเต็ม' : '<span class="t-warn">บางส่วน</span>') + '</td><td data-label="KUP">' + kup + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
})();
