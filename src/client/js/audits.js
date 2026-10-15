/* Audit list + create audit */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;

  App.route('/audits', function (q) {
    App.setTitle('รอบตรวจ');
    var main = App.$('#main');
    main.innerHTML = '<div class="page-head"><div class="seg" role="group" aria-label="สถานะ">' +
      [['', 'ทั้งหมด'], ['IN_PROGRESS', 'กำลังตรวจ'], ['DRAFT', 'ร่าง'], ['CONFIRMED', 'ยืนยันแล้ว']].map(function (s) {
        var on = (q.status || '') === s[0];
        var nq = Object.assign({}, q, { status: s[0] }); if (!s[0]) delete nq.status;
        return '<a class="seg-btn' + (on ? ' on' : '') + '" aria-pressed="' + on + '" href="#/audits?' + Object.keys(nq).map(function (k) { return k + '=' + encodeURIComponent(nq[k]); }).join('&') + '">' + s[1] + '</a>';
      }).join('') + '</div><label class="search"><span class="sr-only">ค้นหา</span><input id="aud-search" type="search" placeholder="ค้นหาเลขรอบตรวจ ทีม ผู้ตรวจ"></label>' +
      (App.can('audit') ? '<a class="btn btn-primary" href="#/audits/new">' + App.icon('plus') + 'สร้างรอบออดิท</a>' : '') + '</div><div id="aud-list">' + App.loading() + '</div>';
    var filters = { include_demo: q.include_demo === '1' };
    ['workshop_id', 'audit_type', 'from', 'to'].forEach(function (k) { if (q[k]) filters[k] = q[k]; });
    if (q.status === 'IN_PROGRESS') filters.statuses = ['DRAFT', 'IN_PROGRESS']; else if (q.status) filters.status = q.status;
    App.api('apiListAudits', filters).then(function (list) {
      var render = function (term) {
        var t = (term || '').toLowerCase();
        var rows = list.filter(function (a) { return !t || [a.audit_no, a.team, a.group, a.workshop, a.auditor_name].join(' ').toLowerCase().indexOf(t) >= 0; });
        App.$('#aud-list').innerHTML = rows.length ? table(rows) : App.empty('ไม่พบรอบตรวจ', list.length ? 'ลองเปลี่ยนคำค้นหา' : 'ยังไม่มีรอบตรวจตามตัวกรองนี้', App.can('audit') && !list.length ? '<a class="btn btn-primary" href="#/audits/new">สร้างรอบออดิทแรก</a>' : '');
      };
      render('');
      App.$('#aud-search').oninput = App.debounce(function (e) { render(e.target.value); }, 150);
      sortable(App.$('#aud-list'));
    }, function (e) { App.$('#aud-list').innerHTML = App.errorBox(e, 'App.render()'); });
  });

  function scoreCell(a) {
    if (a.status === 'CONFIRMED') return a.final_score == null ? '<span class="nodata">ไม่มีคะแนนสุดท้าย</span>' : '<strong>' + App.num(a.final_score) + '</strong> / ' + App.num(a.final_of_max) + (a.scope_mode === 'PARTIAL' ? ' <small class="t-warn">(บางส่วน)</small>' : '');
    return a.provisional_score == null ? '–' : '<span class="t-muted">ชั่วคราว ' + App.num(a.provisional_score) + ' / ' + App.num(a.provisional_of_max) + '</span>';
  }

  function table(rows) {
    return '<div class="table-wrap"><table class="tbl tbl-cards sortable"><thead><tr><th data-sort="text">เลขที่</th><th data-sort="text">วันที่</th><th data-sort="text">ประเภท</th><th data-sort="text">หน่วยงาน</th><th data-sort="text">ผู้ตรวจ</th><th data-sort="num" class="num">ความครบถ้วน</th><th data-sort="num" class="num">คะแนน</th><th>สถานะ</th></tr></thead><tbody>' +
      rows.map(function (a) {
        return '<tr><td data-label="เลขที่"><a href="#/audit/' + a.id + '"><strong>' + esc(a.audit_no) + '</strong></a>' + (a.is_demo ? ' <span class="chip chip-neutral">ข้อมูลสาธิต</span>' : '') + '</td>' +
          '<td data-label="วันที่">' + esc(a.audit_date) + '</td><td data-label="ประเภท">' + esc(App.typeLabel[a.audit_type]) + (a.scope_mode === 'PARTIAL' ? ' <small class="t-warn">ตรวจบางส่วน</small>' : '') + '</td>' +
          '<td data-label="หน่วยงาน">' + esc([a.workshop, a.group, a.team].filter(Boolean).join(' / ')) + '</td><td data-label="ผู้ตรวจ">' + esc(a.auditor_name) + '</td>' +
          '<td class="num" data-label="ความครบถ้วน" data-v="' + (a.coverage_pct || 0) + '">' + (a.coverage_pct == null ? '–' : App.num(a.coverage_pct, 0) + '%') + '</td>' +
          '<td class="num" data-label="คะแนน" data-v="' + (a.final_score == null ? -1 : a.final_score) + '">' + scoreCell(a) + '</td><td data-label="สถานะ">' + App.chip(a.status) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /** Click-to-sort for tables with th[data-sort]. */
  function sortable(root) {
    root.addEventListener('click', function (e) {
      var th = e.target.closest('th[data-sort]'); if (!th) return;
      var tbl = th.closest('table'), idx = Array.prototype.indexOf.call(th.parentNode.children, th);
      var dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
      App.$$('th', tbl).forEach(function (x) { x.removeAttribute('aria-sort'); });
      th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
      var body = tbl.tBodies[0];
      var rows = Array.prototype.slice.call(body.rows);
      rows.sort(function (a, b) {
        var ca = a.cells[idx], cb = b.cells[idx];
        if (th.dataset.sort === 'num') return dir * (Number(ca.dataset.v || ca.textContent) - Number(cb.dataset.v || cb.textContent));
        return dir * ca.textContent.localeCompare(cb.textContent, 'th');
      });
      rows.forEach(function (r) { body.appendChild(r); });
    });
  }
  App.sortable = sortable;

  // ---------- create ----------
  App.route('/audits/new', function (q) {
    q = q || {};
    App.setTitle('สร้างรอบออดิท');
    var md = App.state.md, u = App.state.user;
    if (!App.can('audit')) { App.$('#main').innerHTML = App.empty('ไม่มีสิทธิ์สร้างรอบตรวจ', 'บทบาทของคุณดูรายงานได้อย่างเดียว'); return; }
    var types = ['TEAM', 'GROUP', 'KUP', 'MANAGER'];
    var main = App.$('#main');
    main.innerHTML = '<form id="new-audit" class="form-page" novalidate>' +
      '<section class="panel"><h2 class="panel-title">ประเภทและมาตรฐาน</h2><div class="form-grid">' +
      '<fieldset class="field span-2"><legend>ประเภทการตรวจ</legend><div class="radio-row">' + types.map(function (t) {
        var avail = md.versions.some(function (v) { return v.level === t && v.enabled_for_audit; });
        return '<label class="radio-card' + (avail ? '' : ' disabled') + '"><input type="radio" name="audit_type" value="' + t + '"' + (avail ? '' : ' disabled') + '><span><strong>' + esc(App.typeLabel[t]) + '</strong><small>' +
          (avail ? 'มีมาตรฐานที่ประกาศใช้' : t === 'MANAGER' ? 'เตรียมโครงสร้าง — ยังไม่เปิดใช้ในรุ่นแรก' : 'ยังไม่มีมาตรฐานที่ประกาศใช้') + '</small></span></label>';
      }).join('') + '</div></fieldset>' +
      '<label class="field"><span>มาตรฐาน / เวอร์ชัน</span><select name="standard_version_id" required disabled><option value="">เลือกประเภทก่อน</option></select></label>' +
      '<label class="field"><span>เส้นทางการออดิท</span><select name="route_id"><option value="">ใช้เส้นทางแนะนำ</option></select></label></div></section>' +
      '<section class="panel"><h2 class="panel-title">หน่วยงานที่ตรวจ</h2><div class="form-grid">' +
      '<label class="field"><span>Workshop</span><select name="workshop_id" required><option value="">เลือก Workshop</option>' + md.workshops.map(function (w) { return '<option value="' + w.id + '">' + esc(w.code + ' ' + w.name_th) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Group</span><select name="group_id"><option value="">–</option></select></label>' +
      '<label class="field"><span>Team</span><select name="team_id"><option value="">–</option></select></label>' +
      '<label class="field" id="team-count-f" hidden><span>จำนวนทีมในกลุ่ม (ใช้คำนวณจำนวนตัวอย่าง)</span><input type="number" name="team_count" min="1" step="1"></label>' +
      '<label class="field"><span>ผู้ตรวจ</span><select name="auditor_user_id">' + md.auditors.map(function (a) { return '<option value="' + a.id + '"' + (a.id === u.id ? ' selected' : '') + '>' + esc(a.display_name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>ผู้รับการตรวจ</span><input name="auditee_name" placeholder="ชื่อหัวหน้าทีม / หัวหน้ากลุ่ม"></label>' +
      '<label class="field"><span>วันที่ตรวจ</span><input type="date" name="audit_date" required value="' + App.today() + '"></label></div></section>' +
      '<section class="panel"><h2 class="panel-title">ขอบเขตการตรวจ</h2><div class="radio-row">' +
      '<label class="radio-card"><input type="radio" name="scope_mode" value="FULL" checked><span><strong>ตรวจเต็มทุกข้อ</strong><small>คะแนนนำไปเทียบใน Dashboard ได้</small></span></label>' +
      '<label class="radio-card"><input type="radio" name="scope_mode" value="PARTIAL"><span><strong>ตรวจบางส่วน</strong><small>ไม่นับเป็นผลผ่านทั้งมาตรฐาน และไม่รวมในคะแนนเฉลี่ย</small></span></label></div>' +
      '<div id="partial-box" hidden><label class="field"><span>เหตุผล/ขอบเขต</span><input name="scope_note" placeholder="เช่น ตรวจติดตามเฉพาะหัวข้อการยืนยันกระบวนการ"></label><div id="crit-pick" class="crit-pick"></div></div></section>' +
      '<p id="na-err" class="field-error" role="alert" hidden></p><div class="form-actions"><a class="btn btn-ghost" href="#/audits">ยกเลิก</a><button class="btn btn-primary" type="submit">สร้างรอบตรวจ</button></div></form>';
    var f = App.$('#new-audit');
    var bundleCache = {};
    function fillVersions() {
      var t = f.audit_type.value;
      var list = md.versions.filter(function (v) { return v.level === t && v.enabled_for_audit; });
      f.standard_version_id.disabled = !list.length;
      f.standard_version_id.innerHTML = list.map(function (v) { return '<option value="' + v.id + '">' + esc(v.set_name + ' — ' + v.version_label + ' (มีผล ' + v.effective_date + ')') + '</option>'; }).join('') || '<option value="">ไม่มีมาตรฐาน</option>';
      fillRoutes(); loadCriteria();
      App.$('#team-count-f').hidden = t !== 'GROUP';
      f.team_id.disabled = t !== 'TEAM';
      f.group_id.disabled = t === 'KUP';
    }
    function fillRoutes() {
      var v = md.versions.filter(function (x) { return x.id === f.standard_version_id.value; })[0];
      f.route_id.innerHTML = v && v.routes.length ? v.routes.map(function (r) { return '<option value="' + r.id + '"' + (r.is_default ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') : '<option value="">ไม่มีเส้นทาง</option>';
    }
    function fillUnits() {
      var w = f.workshop_id.value;
      f.group_id.innerHTML = '<option value="">–</option>' + md.groups.filter(function (g) { return g.workshop_id === w; }).map(function (g) { return '<option value="' + g.id + '">' + esc(g.name) + '</option>'; }).join('');
      fillTeams();
    }
    function fillTeams() {
      var g = f.group_id.value, w = f.workshop_id.value;
      var teams = md.teams.filter(function (t) { return t.workshop_id === w && (!g || t.group_id === g); });
      f.team_id.innerHTML = '<option value="">–</option>' + teams.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
      if (g) f.team_count.value = md.teams.filter(function (t) { return t.group_id === g; }).length || '';
    }
    function loadCriteria() {
      var vid = f.standard_version_id.value;
      if (!vid || f.scope_mode.value !== 'PARTIAL') return;
      var box = App.$('#crit-pick');
      var draw = function (b) {
        var dims = b.version.dimensions || [];
        box.innerHTML = '<p class="hint">เลือกข้อที่จะตรวจ</p>' + dims.map(function (d) {
          return '<fieldset class="crit-group"><legend>' + esc(App.firstLine(App.lang(d.name))) + '</legend>' + b.criteria.filter(function (c) { return c.dimension_code === d.code; }).map(function (c) {
            return '<label class="check"><input type="checkbox" name="crit" value="' + c.id + '"><span><strong>' + esc(c.code) + '</strong> ' + esc(App.firstLine(App.lang(c.title))) + '</span></label>';
          }).join('') + '</fieldset>';
        }).join('');
      };
      if (bundleCache[vid]) return draw(bundleCache[vid]);
      box.innerHTML = App.loading('กำลังโหลดรายการข้อ…');
      App.api('apiGetStandardVersion', vid).then(function (b) { bundleCache[vid] = b; draw(b); }, function (e) { box.innerHTML = App.errorBox(e); });
    }
    App.$$('input[name=audit_type]', f).forEach(function (r) { r.onchange = fillVersions; });
    f.standard_version_id.onchange = function () { fillRoutes(); loadCriteria(); };
    f.workshop_id.onchange = fillUnits; f.group_id.onchange = fillTeams;
    App.$$('input[name=scope_mode]', f).forEach(function (r) { r.onchange = function () { App.$('#partial-box').hidden = f.scope_mode.value !== 'PARTIAL'; loadCriteria(); }; });
    var first = (q.type && App.$('input[name=audit_type][value=' + q.type + ']:not([disabled])', f)) || App.$('input[name=audit_type]:not([disabled])', f); if (first) { first.checked = true; fillVersions(); }
    if (q.v) { f.standard_version_id.value = q.v; fillRoutes(); }
    if (q.route) f.route_id.value = q.route;
    if (q.ws) { f.workshop_id.value = q.ws; fillUnits(); }
    if (q.g) { f.group_id.value = q.g; fillTeams(); }
    if (q.t) { f.team_id.value = q.t; var tm = md.teams.filter(function (t) { return t.id === q.t; })[0]; if (tm && tm.leader_name) f.auditee_name.value = tm.leader_name; }
    if (q.t) App.$('#new-audit').insertAdjacentHTML('afterbegin', '<p class="notice notice-info">' + App.icon('chevr') + 'ตรวจทีมถัดไป — ใช้มาตรฐานและเส้นทางเดิม ตรวจสอบแล้วกด "สร้างรอบตรวจ"</p>');
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var err = App.$('#na-err'); err.hidden = true;
      var req = { audit_type: f.audit_type.value, standard_version_id: f.standard_version_id.value, route_id: f.route_id.value, workshop_id: f.workshop_id.value, group_id: f.group_id.value,
        team_id: f.team_id.value, team_count: f.team_count.value, auditor_user_id: f.auditor_user_id.value, auditee_name: f.auditee_name.value, audit_date: f.audit_date.value,
        scope_mode: f.scope_mode.value, scope_note: f.scope_note.value, criterion_ids: App.$$('input[name=crit]:checked', f).map(function (x) { return x.value; }) };
      var missing = [];
      if (!req.standard_version_id) missing.push('มาตรฐาน');
      if (!req.workshop_id) missing.push('Workshop');
      if (req.audit_type === 'TEAM' && !req.team_id) missing.push('Team');
      if (req.audit_type === 'GROUP' && !req.group_id) missing.push('Group');
      if (req.scope_mode === 'PARTIAL' && !req.criterion_ids.length) missing.push('ข้อที่จะตรวจ');
      if (missing.length) { err.textContent = 'กรอกให้ครบ: ' + missing.join(', '); err.hidden = false; return; }
      var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'กำลังสร้าง…';
      App.api('apiCreateAudit', req).then(function (r) { App.toast('สร้างรอบตรวจ ' + r.audit_no + ' แล้ว', 'ok'); location.hash = '#/audit/' + r.audit_id; },
        function (e) { err.textContent = App.errorText(e); err.hidden = false; btn.disabled = false; btn.textContent = 'สร้างรอบตรวจ'; });
    };
  });
})();
