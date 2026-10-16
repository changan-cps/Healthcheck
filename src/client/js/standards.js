/* Standards library: import review, draft decisions, publish, routes. */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;
  var KIND = { HC_LEVEL: 'เกณฑ์ Health Check รายข้อ', KUP_BAND: 'เกณฑ์ KUP ช่วงคะแนน', HC_OVERVIEW: 'กลไก/Red Line', OS_BAND: 'มาตรฐาน OS', POINTS_SCHEME: 'ระบบแต้ม', UNKNOWN: 'ไม่รู้จัก' };
  var RTYPE = { PER_OCCURRENCE: 'หักต่อปัญหา', ONCE: 'หักครั้งเดียว', ZERO_SCORE: 'ได้ 0 คะแนน', NO_DEDUCTION: 'ไม่หัก', UNPARSED: 'อ่านไม่ได้' };

  App.route('/standards', function () {
    App.setTitle('คลังมาตรฐาน');
    App.$('#main').innerHTML = App.loading();
    App.api('apiListStandards').then(function (sets) {
      var h = '<div class="page-head"><p class="muted">มาตรฐานที่ประกาศใช้แล้วแก้ไขไม่ได้ การแก้ไขต้องสร้างฉบับใหม่ ผลออดิทเดิมจึงไม่เปลี่ยน</p>' +
        (App.can('admin') ? '<label class="btn btn-primary">' + App.icon('upload') + 'นำเข้ามาตรฐานจาก Excel<input type="file" id="std-file" accept=".xlsx" hidden></label>' : '') + '</div><div id="imp-status"></div>';
      sets.forEach(function (s) {
        h += '<section class="panel"><header class="panel-h"><h2>' + esc(s.name_th) + '</h2><span class="muted">' + esc(s.name_zh) + ' • ' + (s.scoring_mode === 'BAND' ? 'ช่วงคะแนน' : 'หักคะแนนตามเกณฑ์') + (s.enabled_for_audit ? '' : ' • <span class="t-warn">ยังไม่เปิดใช้ออดิท</span>') + '</span></header>' +
          (s.versions.length ? '<ul class="row-list">' + s.versions.map(function (v) {
            return '<li><a href="#/standard/' + v.id + '"><span class="rl-main"><strong>' + esc(v.version_label) + '</strong> มีผล ' + esc(v.effective_date) + '</span><span class="rl-meta">' + esc(v.source_file_name) + ' / ' + esc(v.source_sheet_name) + ' ' + App.chip(v.status) + '</span></a>' +
              (v.status === 'DRAFT' && App.can('admin') ? '<button class="btn btn-sm btn-danger" data-del="' + v.id + '" data-label="' + esc(v.version_label) + '" aria-label="ลบฉบับร่าง ' + esc(v.version_label) + '">' + App.icon('trash') + 'ลบฉบับร่าง</button>' : '') + '</li>';
          }).join('') + '</ul>' : App.empty('ยังไม่มีเวอร์ชัน', App.can('admin') ? 'นำเข้าจากไฟล์ Excel มาตรฐาน' : '')) + '</section>';
      });
      App.$('#main').innerHTML = h;
      App.$$('[data-del]').forEach(function (btn) {
        btn.onclick = function () {
          App.confirm('ลบฉบับร่าง ' + btn.getAttribute('data-label'), 'ลบถาวร กู้คืนไม่ได้ (ใช้ได้เฉพาะฉบับร่างที่ยังไม่มีรอบตรวจอ้างอิง)', 'ลบฉบับร่าง', 'danger').then(function (ok) {
            if (!ok) return;
            btn.disabled = true;
            App.api('apiDeleteDraftVersion', btn.getAttribute('data-del')).then(function () { App.toast('ลบฉบับร่างแล้ว', 'ok'); App.render(); }, function (e) { btn.disabled = false; App.fail(e); });
          });
        };
      });
      var inp = App.$('#std-file');
      if (inp) inp.onchange = function () {
        var file = inp.files[0]; if (!file) return;
        App.$('#imp-status').innerHTML = App.loading('กำลังอ่านไฟล์ ' + file.name + '…');
        var r = new FileReader();
        r.onload = function () {
          App.api('apiParseStandardFile', file.name, String(r.result).split(',')[1]).then(function (res) { App.state.importPreview = res; App.nav('#/standards/import'); },
            function (e) { App.$('#imp-status').innerHTML = App.errorBox(e); });
        };
        r.readAsDataURL(file);
      };
    }, function (e) { App.$('#main').innerHTML = App.errorBox(e, 'App.render()'); });
  });

  // ---------- import review ----------
  App.route('/standards/import', function () {
    App.setTitle('ตรวจทานข้อมูลนำเข้า');
    var res = App.state.importPreview;
    if (!res) { App.nav('#/standards'); return; }
    var p = res.preview;
    var cands = p.sheets.filter(function (s) { return s.candidate; });
    var h = '<div class="page-head"><div><a class="link-btn" href="#/standards">' + App.icon('chevl') + 'คลังมาตรฐาน</a><h2 class="h-lg">' + esc(p.file_name) + '</h2><p class="muted">SHA-256 ' + esc(String(res.file_hash).slice(0, 16)) + '… • ตัวอ่าน ' + esc(p.parser_version) + '</p></div></div>';
    if (res.already_imported.length) h += '<p class="notice notice-warn">ไฟล์นี้เคยนำเข้าแล้ว: ' + esc(res.already_imported.map(function (v) { return v.label + ' (' + v.sheet + ', ' + v.status + ')'; }).join(', ')) + '</p>';
    h += '<p class="notice notice-info">ระบบยังไม่ใช้ข้อมูลนี้จนกว่าจะสร้างฉบับร่าง ตรวจทาน และประกาศใช้ — คะแนนเดิมในไฟล์ไม่ถูกนำมาเป็นผลออดิท</p>';
    h += '<section class="panel"><h2 class="panel-title">ชีตในไฟล์</h2><div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>ชีต</th><th>รูปแบบ</th><th>ระดับ</th><th class="num">ข้อ</th><th class="num">กฎ</th><th class="num">ต้องตรวจทาน</th><th>หมายเหตุ</th></tr></thead><tbody>' +
      p.sheets.map(function (s) {
        var c = s.candidate;
        return '<tr><td data-label="ชีต"><strong>' + esc(s.name) + '</strong>' + (s.hidden ? ' <span class="chip chip-neutral">ซ่อนในไฟล์</span>' : '') + '</td><td data-label="รูปแบบ">' + esc(KIND[s.kind] || s.kind) + '</td><td data-label="ระดับ">' + esc(s.level ? App.typeLabel[s.level] : '–') + '</td>' +
          '<td class="num" data-label="ข้อ">' + (c ? c.criteria_count : '–') + '</td><td class="num" data-label="กฎ">' + (c ? c.rules.length : '–') + '</td><td class="num" data-label="ต้องตรวจทาน">' + (c ? c.flag_count : '–') + '</td>' +
          '<td data-label="หมายเหตุ">' + esc(s.error || s.unsupported || (s.kind === 'HC_OVERVIEW' && p.red_lines ? 'Red Line ' + p.red_lines.clauses.length + ' ข้อ หักข้อละ ' + p.red_lines.penalty + ' คะแนน' : '')) + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    p.similar_groups.forEach(function (g) {
      var a = p.sheets.filter(function (s) { return s.index === g.sheet_indexes[0]; })[0], b = p.sheets.filter(function (s) { return s.index === g.sheet_indexes[1]; })[0];
      h += '<section class="panel panel-warn"><h2 class="panel-title">' + App.icon('alert') + esc(g.message_th) + '</h2><p>เปรียบเทียบ "' + esc(a.name) + '" กับ "' + esc(b.name) + '": เหมือนกัน ' + g.diff.same_count + ' ข้อ, ต่างกัน ' + g.diff.changed.length + ' ข้อ, มีเฉพาะชีตแรก ' + g.diff.only_in_first.length + ', มีเฉพาะชีตที่สอง ' + g.diff.only_in_second.length + '</p>' +
        (g.diff.changed.length ? '<ul class="plain-list small">' + g.diff.changed.map(function (c) { return '<li><strong>' + esc(c.code) + '</strong> ' + esc(c.title) + ' — ต่างที่: ' + esc(c.changes.join(', ')) + '</li>'; }).join('') + '</ul>' : '') +
        '<p class="hint">ระบบแนะนำชีตที่แสดงอยู่ในไฟล์ (ไม่ถูกซ่อน) — ระบบไม่รวมสองชีตให้อัตโนมัติ</p></section>';
    });
    cands.forEach(function (s) { h += candidatePreview(s, p); });
    if (App.can('admin') && cands.length) {
      h += '<section class="panel"><h2 class="panel-title">สร้างฉบับร่างจากชีตที่เลือก</h2><form id="mk-draft" class="form-grid">' +
        '<fieldset class="field span-2"><legend>ชีตที่ใช้</legend>' + cands.map(function (s) {
          var sim = p.similar_groups.filter(function (g) { return g.sheet_indexes.indexOf(s.index) >= 0; })[0];
          return '<label class="check"><input type="radio" name="sheet" value="' + s.index + '"' + (sim && sim.recommended_index === s.index ? ' checked' : '') + '><span>' + esc(s.name) + ' — ' + esc(App.typeLabel[s.level]) + ' (' + s.candidate.criteria_count + ' ข้อ)' + (sim ? (sim.recommended_index === s.index ? ' <em>แนะนำ</em>' : ' <em class="t-warn">ชีตซ้ำ</em>') : '') + '</span></label>';
        }).join('') + '</fieldset>' +
        '<label class="field"><span>ชื่อเวอร์ชัน</span><input name="label" required placeholder="เช่น Y2026 ฉบับ 1"></label><label class="field"><span>วันที่มีผล</span><input type="date" name="eff" required value="' + App.today() + '"></label>' +
        '<label class="check span-2" id="ack-sim" hidden><input type="checkbox" name="ack"><span>ฉันตรวจความแตกต่างของชีตที่คล้ายกันแล้ว และเลือกชีตนี้เป็นฉบับใช้งาน</span></label>' +
        '<p id="mk-err" class="field-error span-2" role="alert" hidden></p><div class="span-2"><button class="btn btn-primary">สร้างฉบับร่าง</button></div></form></section>';
    }
    App.$('#main').innerHTML = h;
    var f = App.$('#mk-draft');
    if (!f) return;
    var upd = function () { var idx = Number((App.$('input[name=sheet]:checked', f) || {}).value); App.$('#ack-sim').hidden = !p.similar_groups.some(function (g) { return g.sheet_indexes.indexOf(idx) >= 0; }); };
    App.$$('input[name=sheet]', f).forEach(function (r) { r.onchange = upd; }); upd();
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var err = App.$('#mk-err'); err.hidden = true;
      var sel = App.$('input[name=sheet]:checked', f);
      if (!sel || !f.label.value || !f.eff.value) { err.textContent = 'เลือกชีต และกรอกชื่อเวอร์ชันกับวันที่มีผล'; err.hidden = false; return; }
      App.api('apiCreateDraftVersion', { import_file_id: res.import_file_id, sheet_index: Number(sel.value), version_label: f.label.value, effective_date: f.eff.value, acknowledge_similar: f.ack.checked })
        .then(function (r) { App.toast('สร้างฉบับร่างแล้ว — ตรวจทานก่อนประกาศใช้', 'ok'); App.nav('#/standard/' + r.version_id); }, function (e) { err.textContent = App.errorText(e); err.hidden = false; });
    };
  });

  function candidatePreview(s, p) {
    var c = s.candidate;
    var flags = c.flags.concat([].concat.apply([], c.criteria.map(function (x) { return x.flags.map(function (f) { return Object.assign({ code_ref: x.code }, f); }); })));
    var review = flags.filter(function (f) { return f.severity !== 'info'; });
    return '<details class="panel cand"><summary><strong>' + esc(s.name) + '</strong> — ' + c.criteria_count + ' ข้อ, ต้องตรวจทาน ' + review.length + ' จุด</summary>' +
      (review.length ? '<h3 class="sub">จุดที่ต้องตรวจทานเกณฑ์</h3><ul class="flag-list">' + review.map(function (f) { return '<li class="sev-' + f.severity + '">' + (f.code_ref ? '<strong>' + esc(f.code_ref) + '</strong> ' : '') + esc(f.message_th) + (f.ref && f.ref.cell ? ' <span class="src">' + esc(f.ref.sheet + ' ' + f.ref.cell) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="table-wrap"><table class="tbl"><thead><tr><th>ข้อ</th><th>รายการตรวจ</th><th class="num">คะแนนเต็ม</th>' + (s.kind === 'KUP_BAND' ? '<th>ประเภท</th><th class="num">น้ำหนักหมวด</th>' : '<th>กฎ</th><th>ตัวอย่าง</th>') + '<th>เซลล์ต้นทาง</th></tr></thead><tbody>' +
      c.criteria.map(function (x) {
        var rules = c.rules.filter(function (r) { return r.criteria_codes.indexOf(x.code) >= 0; });
        return '<tr><td>' + esc(x.code) + '</td><td>' + esc(App.firstLine(x.title.zh || x.title.th || x.title.raw)) + (x.title.th && x.title.zh ? '<br><small>' + esc(App.firstLine(x.title.th)) + '</small>' : '') + '</td><td class="num">' + (x.max_points == null ? '<span class="t-held">?</span>' : x.max_points) + '</td>' +
          (s.kind === 'KUP_BAND' ? '<td>' + esc(x.kup_type) + ' / ' + esc(x.kup_importance) + '</td><td class="num">' + App.num(x.category_weight) + '</td>' :
            '<td class="small">' + rules.map(function (r) { return esc(r.rule_code + ' ' + RTYPE[r.rule_type] + (r.points ? ' ' + r.points : '')) + (r.parse_status === 'NEEDS_REVIEW' ? ' <span class="t-held">ตรวจทาน</span>' : ''); }).join('<br>') + '</td><td class="small">' + (x.sample ? esc(x.sample.count + (x.sample.per ? '/' + x.sample.per : '') + ' ' + (x.sample.unit || '')) : '–') + '</td>') +
          '<td class="small src">' + esc(Object.keys(x.source_ref.cells || {}).map(function (k) { return x.source_ref.cells[k]; }).filter(Boolean).join(' ')) + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }

  // ---------- version page ----------
  App.route('/standard/:id', function (id) {
    App.setTitle('มาตรฐาน');
    App.$('#main').innerHTML = App.loading();
    App.api('apiGetStandardVersion', id).then(renderVersion, function (e) { App.$('#main').innerHTML = App.errorBox(e, 'App.render()'); });
  });

  function renderVersion(b) {
    var v = b.version, s = v.settings || {}, draft = v.status === 'DRAFT', admin = App.can('admin'), edit = draft && admin;
    App.setTitle(b.set.code + ' ' + v.version_label);
    var acked = {}; (v.review_ack || []).forEach(function (a) { acked[a.key] = a; });
    var h = '<div class="page-head"><div><a class="link-btn" href="#/standards">' + App.icon('chevl') + 'คลังมาตรฐาน</a><h2 class="h-lg">' + esc(b.set.name_th) + ' — ' + esc(v.version_label) + ' ' + App.chip(v.status) + '</h2>' +
      '<p class="muted">มีผล ' + esc(v.effective_date) + ' • ต้นทาง ' + esc(v.source_file_name) + ' / ชีต ' + esc(v.source_sheet_name) + ' • ' + b.criteria.length + ' ข้อ' + (v.content_hash ? ' • hash ' + esc(v.content_hash.slice(0, 12)) : '') + '</p></div>' +
      '<div class="head-actions">' + (admin && !draft ? '<button class="btn btn-ghost" id="v-clone">สร้างฉบับใหม่เพื่อแก้ไข</button>' : '') + '</div></div>';
    if (!draft) h += '<p class="notice notice-info">' + (v.status === 'PUBLISHED' ? 'ประกาศใช้แล้วเมื่อ ' + App.fmtDate(v.published_at, true) + ' — แก้ไขไม่ได้ เพื่อไม่ให้ผลออดิทย้อนหลังเปลี่ยน' : 'เลิกใช้แล้ว — รอบตรวจเดิมยังอ้างอิงฉบับนี้') + '</p>';
    if (draft && b.publish_check) {
      var pc = b.publish_check;
      h += '<section class="panel ' + (pc.ready ? 'panel-ok' : 'panel-warn') + '"><h2 class="panel-title">' + (pc.ready ? App.icon('check') + 'พร้อมประกาศใช้' : App.icon('alert') + 'ยังประกาศใช้ไม่ได้ (' + pc.problems.length + ' รายการ)') + '</h2>' +
        (pc.problems.length ? '<ul class="blockers">' + pc.problems.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        (pc.warnings.length ? '<ul class="plain-list t-warn">' + pc.warnings.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        (admin ? '<button class="btn btn-primary" id="v-publish"' + (pc.ready ? '' : ' disabled') + '>ประกาศใช้มาตรฐานนี้</button>' : '') + '</section>';
    }
    // decisions
    h += '<section class="panel"><h2 class="panel-title">การตัดสินใจที่ไฟล์ไม่ได้ระบุ</h2><p class="hint">ระบบไม่เดาแทน — Admin เลือกและระบุเหตุผล ทุกการตัดสินใจถูกบันทึกในประวัติ</p><form id="v-set" class="decisions">';
    if (b.set.scoring_mode === 'DEDUCTION') {
      h += decision('item_floor_zero', 'คะแนนรายข้อต่ำสุดเป็น 0 หรือไม่ (เมื่อหักเกินคะแนนเต็ม)', s.item_floor_zero, [[true, 'ใช่ — ต่ำสุด 0'], [false, 'ไม่ — ระงับคะแนนให้ผู้ตรวจพิจารณา']], edit);
      if (b.red_lines.length) {
        h += decision('total_floor_zero', 'คะแนนรวมต่ำสุดเป็น 0 หรือไม่ หลังหัก Red Line', s.total_floor_zero, [[true, 'ใช่'], [false, 'ไม่ — ระงับคะแนน']], edit);
        h += decision('red_line_mode', 'วิธีนับการหัก Red Line ' + (s.red_line_points != null ? s.red_line_points + ' คะแนน' : '') + ' (ไฟล์: "以上条款一旦触发红线条款扣' + (s.red_line_points || '?') + '分")', s.red_line_mode, [[null, 'ยังไม่กำหนด (ระงับคะแนนเมื่อพบ)'], ['ONCE', 'หักครั้งเดียวต่อรอบตรวจ'], ['PER_CLAUSE', 'หักต่อข้อเงื่อนไขที่พบ'], ['PER_OCCURRENCE', 'หักทุกครั้งที่พบ']], edit);
      }
    } else {
      var tw = s.type_weights || {};
      h += '<fieldset class="decision"><legend>สูตรรวมคะแนน KUP เป็น 0–100</legend><p>ไฟล์ให้ข้อมูล: น้ำหนักหมวด ' + esc((v.dimensions || []).map(function (d) { return d.code + '=' + d.weight; }).join(', ')) + ' • น้ำหนักประเภท C=' + esc(tw.C) + ', A=' + esc(tw.A) + ', K=' + esc(tw.K) + '</p>' +
        '<p>สูตรที่ระบบเสนอ (FILE_WEIGHTS_V1): <code>คะแนนหมวด = C×ค่าเฉลี่ยข้อประเภท C + A×ค่าเฉลี่ยข้อประเภท A</code> และ <code>คะแนนรวม = Σ(น้ำหนักหมวด × คะแนนหมวด) × 10</code> — ไม่มีในไฟล์โดยตรง ต้องยืนยันกับผู้รับผิดชอบมาตรฐาน</p>' +
        '<label class="check"><input type="radio" name="kup_aggregation" value=""' + (!s.kup_aggregation ? ' checked' : '') + (edit ? '' : ' disabled') + '><span>ยังไม่ใช้สูตร — แสดงเฉพาะคะแนนรายข้อ</span></label>' +
        '<label class="check"><input type="radio" name="kup_aggregation" value="FILE_WEIGHTS_V1"' + (s.kup_aggregation === 'FILE_WEIGHTS_V1' ? ' checked' : '') + (edit ? '' : ' disabled') + '><span>ยืนยันใช้สูตร FILE_WEIGHTS_V1</span></label></fieldset>';
    }
    if (edit) h += '<label class="field"><span>เหตุผล / ผู้อนุมัติการตัดสินใจ</span><input name="reason" required placeholder="เช่น ยืนยันกับฝ่าย MFG เมื่อ 15 ต.ค. 2026"></label><button class="btn btn-ghost">บันทึกการตัดสินใจ</button>';
    h += '</form></section>';
    // flags
    var flags = b.flags.filter(function (f) { return f.severity !== 'info'; }), info = b.flags.filter(function (f) { return f.severity === 'info'; });
    h += '<section class="panel"><h2 class="panel-title">จุดที่ต้องตรวจทานเกณฑ์ (' + flags.length + ')</h2>' + (flags.length ? '<form id="v-ack"><ul class="flag-list">' + flags.map(function (f) {
      var a = acked[f.key];
      return '<li class="sev-' + f.severity + '"><label class="check"><input type="checkbox" value="' + esc(f.key) + '"' + (a ? ' checked disabled' : edit ? '' : ' disabled') + '><span>' + (f.criterion_code ? '<strong>' + esc(f.criterion_code) + '</strong> ' : '') + esc(f.message_th) + (f.ref && f.ref.cell ? ' <span class="src">' + esc((f.ref.sheet || '') + ' ' + f.ref.cell) + '</span>' : '') + (a ? ' <span class="chip chip-ok">ตรวจทานแล้ว</span>' : '') + '</span></label></li>';
    }).join('') + '</ul>' + (edit ? '<label class="field"><span>ความเห็นการตรวจทาน</span><input name="comment" placeholder="ตรวจกับต้นฉบับแล้ว"></label><button class="btn btn-ghost">ยืนยันว่าตรวจทานรายการที่เลือกแล้ว</button>' : '') + '</form>' : '<p class="t-muted">ไม่มี</p>') +
      (info.length ? '<details><summary>ข้อมูลประกอบ (' + info.length + ')</summary><ul class="plain-list small">' + info.map(function (f) { return '<li>' + esc(f.message_th) + '</li>'; }).join('') + '</ul></details>' : '') + '</section>';
    // criteria
    var dims = v.dimensions || [];
    h += '<section class="panel"><h2 class="panel-title">ข้อกำหนดและเกณฑ์ (' + b.criteria.length + ' ข้อ)</h2>' + dims.map(function (d) {
      var cs = b.criteria.filter(function (c) { return c.dimension_code === d.code; });
      return '<h3 class="sub">' + esc(App.firstLine(App.lang(d.name))) + (d.max_points != null ? ' — ' + d.max_points + ' คะแนน' : d.weight != null ? ' — น้ำหนัก ' + d.weight : '') + '</h3><div class="table-wrap"><table class="tbl"><thead><tr><th>ข้อ</th><th>รายการตรวจ</th><th class="num">คะแนนเต็ม</th><th>ตัวอย่าง</th><th>เกณฑ์</th><th>ต้นทาง</th></tr></thead><tbody>' +
        cs.map(function (c) {
          var rules = b.rules.filter(function (r) { return r.criterion_ids.indexOf(c.id) >= 0; });
          return '<tr><td><strong>' + esc(c.code) + '</strong></td><td>' + esc(App.firstLine(App.lang(c.title))) + '</td><td class="num">' + (c.max_points == null ? '<span class="t-held">ไม่ระบุ</span>' : c.max_points) + (c.group_max_points != null ? '<br><small>รวมกลุ่ม ' + c.group_max_points + '</small>' : '') +
            (edit && b.set.scoring_mode === 'DEDUCTION' ? '<br><button class="link-btn" data-pts="' + c.id + '">แก้</button>' : '') + '</td>' +
            '<td class="small">' + (c.sample ? esc(c.sample.count + (c.sample.per ? ' ต่อ ' + c.sample.per : '') + ' ' + (c.sample.unit || '')) + (c.sample.status === 'NEEDS_REVIEW' ? ' <span class="t-held">ตรวจทาน</span>' : '') : '–') + (edit ? '<br><button class="link-btn" data-smp="' + c.id + '">กำหนด</button>' : '') + '</td>' +
            '<td class="small">' + (b.set.scoring_mode === 'BAND' ? (c.bands || []).map(function (bd) { return bd.min + '–' + bd.max; }).join(' / ') + ' • ' + esc(c.kup_type) : rules.map(function (r) {
              return '<div class="rule-line"><strong>' + esc(r.rule_code) + '</strong> ' + esc(RTYPE[r.rule_type] + (r.points ? ' ' + r.points : '')) + ' — ' + esc(App.firstLine(r.text.zh || r.text.th)) + (r.parse_status === 'NEEDS_REVIEW' ? ' <span class="t-held">รอตรวจทาน</span>' : r.parse_status === 'ADMIN_CONFIRMED' ? ' <span class="t-ok">Admin ยืนยัน</span>' : '') + (edit ? ' <button class="link-btn" data-rule="' + r.id + '">แก้/ยืนยัน</button>' : '') + '</div>';
            }).join('')) + '</td><td class="small src">' + esc(c.source_ref.sheet + ' แถว ' + c.source_ref.row) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('') + '</section>';
    if (b.red_lines.length) h += '<section class="panel"><h2 class="panel-title">Red Line</h2><ul class="plain-list">' + b.red_lines.map(function (r) { return '<li><strong>' + esc(r.clause_code) + '</strong> ' + esc(r.text.zh) + '<br><small>' + esc(r.text.th) + '</small> <span class="src">' + esc(r.source_ref.cell) + '</span></li>'; }).join('') + '</ul></section>';
    h += routeEditor(b, admin);
    App.$('#main').innerHTML = h;
    wireVersion(b, edit, admin);
  }

  function decision(name, label, val, opts, edit) {
    return '<fieldset class="decision"><legend>' + esc(label) + '</legend>' + opts.map(function (o) {
      var v = o[0] === null ? '' : String(o[0]);
      var cur = val === null || val === undefined ? '' : String(val);
      return '<label class="check"><input type="radio" name="' + name + '" value="' + esc(v) + '"' + (cur === v ? ' checked' : '') + (edit ? '' : ' disabled') + '><span>' + esc(o[1]) + '</span></label>';
    }).join('') + (val === null || val === undefined ? '<span class="t-held small">ยังไม่ได้ตัดสิน</span>' : '') + '</fieldset>';
  }

  function routeEditor(b, admin) {
    return b.routes.map(function (r) {
      return '<section class="panel" data-route="' + r.id + '"><header class="panel-h"><h2>' + App.icon('route') + 'เส้นทางการออดิท: ' + esc(r.name) + '</h2><span class="muted">' + esc(r.notes || '') + '</span></header>' +
        '<ol class="route-edit">' + r.stops.filter(function (s) { return s.criterion_ids.length; }).map(function (s, i) {
          return '<li data-stop="' + s.id + '"><div class="re-head">' + (admin ? '<input class="re-name" value="' + esc(s.name) + '" aria-label="ชื่อจุดตรวจ"><input class="re-time" value="' + esc(s.time_hint || '') + '" placeholder="เวลา" aria-label="เวลา">' +
            '<button class="icon-btn" data-up aria-label="เลื่อนขึ้น">↑</button><button class="icon-btn" data-down aria-label="เลื่อนลง">↓</button>' : '<strong>' + esc(s.name) + '</strong>' + (s.time_hint ? ' ' + esc(s.time_hint) : '')) + '</div>' +
            '<div class="re-crit">' + b.criteria.map(function (c) { var on = s.criterion_ids.indexOf(c.id) >= 0; return admin ? '<label class="chip-check"><input type="checkbox" value="' + c.id + '"' + (on ? ' checked' : '') + '><span>' + esc(c.code) + '</span></label>' : on ? '<span class="chip chip-neutral">' + esc(c.code) + '</span>' : ''; }).join('') + '</div>' +
            (admin ? '<input class="re-instr" value="' + esc(s.instructions || '') + '" placeholder="คำแนะนำสำหรับจุดนี้ (ไม่บังคับ)" aria-label="คำแนะนำ">' : '') + '</li>';
        }).join('') + '</ol>' + (admin ? '<div class="btn-row"><button class="btn btn-ghost" data-addstop>' + App.icon('plus') + 'เพิ่มจุดตรวจ</button><button class="btn btn-primary" data-saveroute>บันทึกเส้นทาง</button></div><p class="hint">เส้นทางไม่มีผลต่อคะแนน ปรับได้แม้ประกาศใช้แล้ว ทุกข้อต้องอยู่ในอย่างน้อย 1 จุด</p>' : '') + '</section>';
    }).join('');
  }

  function wireVersion(b, edit, admin) {
    var v = b.version;
    var reload = function () { App.api('apiGetStandardVersion', v.id).then(renderVersion, App.fail); };
    var pub = App.$('#v-publish');
    if (pub) pub.onclick = function () { App.confirm('ประกาศใช้ ' + v.version_label, 'หลังประกาศใช้จะแก้ไขไม่ได้ ฉบับที่ใช้อยู่เดิมของชุดนี้จะเปลี่ยนเป็น "เลิกใช้" (รอบตรวจเดิมไม่เปลี่ยน)', 'ประกาศใช้').then(function (ok) { if (ok) App.api('apiPublishVersion', v.id, v.version).then(function (r) { App.toast('ประกาศใช้แล้ว', 'ok'); App.loadMaster().then(reload); }, App.fail); }); };
    var cl = App.$('#v-clone');
    if (cl) cl.onclick = function () { App.ask('สร้างฉบับใหม่จาก ' + v.version_label, 'ชื่อเวอร์ชันใหม่', { ok: 'สร้างฉบับร่าง' }).then(function (label) { if (label) App.api('apiCloneVersion', v.id, label, App.today()).then(function (r) { App.nav('#/standard/' + r.version_id); }, App.fail); }); };
    var sf = App.$('#v-set');
    if (sf && edit) sf.onsubmit = function (ev) {
      ev.preventDefault();
      var patch = {};
      ['item_floor_zero', 'total_floor_zero'].forEach(function (k) { var x = App.$('input[name=' + k + ']:checked', sf); if (x) patch[k] = x.value === 'true'; });
      var rm = App.$('input[name=red_line_mode]:checked', sf); if (rm) patch.red_line_mode = rm.value || null;
      var ka = App.$('input[name=kup_aggregation]:checked', sf); if (ka) { patch.kup_aggregation = ka.value || null; patch.kup_aggregation_confirmed = !!ka.value; }
      if (!sf.reason.value.trim()) { App.toast('ระบุเหตุผลการตัดสินใจ', 'error'); sf.reason.focus(); return; }
      App.api('apiUpdateDraftSettings', v.id, patch, v.version, sf.reason.value).then(function () { App.toast('บันทึกการตัดสินใจแล้ว', 'ok'); reload(); }, App.fail);
    };
    var af = App.$('#v-ack');
    if (af && edit) af.onsubmit = function (ev) {
      ev.preventDefault();
      var keys = App.$$('input[type=checkbox]:checked:not([disabled])', af).map(function (x) { return x.value; });
      if (!keys.length) { App.toast('เลือกรายการที่ตรวจทานแล้ว', 'info'); return; }
      App.api('apiAcknowledgeFlags', v.id, keys, v.version, af.comment.value).then(function () { App.toast('บันทึกการตรวจทาน ' + keys.length + ' รายการ', 'ok'); reload(); }, App.fail);
    };
    App.$$('[data-pts]').forEach(function (btn) {
      btn.onclick = function () {
        var c = b.criteria.filter(function (x) { return x.id === btn.getAttribute('data-pts'); })[0];
        App.dialog({ title: 'คะแนนเต็มข้อ ' + c.code, body: '<label class="field"><span>คะแนนเต็ม</span><input id="d-pts" type="number" step="0.5" min="0" value="' + (c.max_points == null ? '' : c.max_points) + '" autofocus></label><label class="field"><span>เหตุผล/แหล่งที่ยืนยัน</span><input id="d-why"></label>',
          actions: [{ label: 'ยกเลิก', value: false }, { label: 'บันทึก', kind: 'primary', value: true, onClick: function (w) { App.WS._d = { p: w.querySelector('#d-pts').value, r: w.querySelector('#d-why').value }; if (!App.WS._d.r) { w.querySelector('#d-why').focus(); return false; } } }] })
          .then(function (ok) { if (ok) App.api('apiUpdateDraftCriterion', c.id, { max_points: App.WS._d.p }, c.version, App.WS._d.r).then(reload, App.fail); });
      };
    });
    App.$$('[data-smp]').forEach(function (btn) {
      btn.onclick = function () {
        var c = b.criteria.filter(function (x) { return x.id === btn.getAttribute('data-smp'); })[0], s = c.sample || {};
        App.dialog({ title: 'จำนวนตัวอย่างข้อ ' + c.code, body: (s.text ? '<p class="hint">ข้อความในไฟล์: ' + esc(s.text) + '</p>' : '') + '<div class="form-grid"><label class="field"><span>จำนวน</span><input id="d-n" type="number" min="0" value="' + (s.count || '') + '"></label><label class="field"><span>คิดต่อ</span><select id="d-per"><option value="">ทั้งรอบตรวจ</option><option value="TEAM"' + (s.per === 'TEAM' ? ' selected' : '') + '>ต่อทีมในกลุ่ม</option></select></label><label class="field span-2"><span>หน่วย</span><input id="d-u" value="' + esc(s.unit || '') + '"></label><label class="field span-2"><span>เหตุผล</span><input id="d-why"></label></div><p class="hint">ใส่ 0 หรือเว้นว่างถ้าไม่ต้องนับตัวอย่าง</p>',
          actions: [{ label: 'ยกเลิก', value: false }, { label: 'บันทึก', kind: 'primary', value: true, onClick: function (w) { App.WS._d = { n: w.querySelector('#d-n').value, per: w.querySelector('#d-per').value, u: w.querySelector('#d-u').value, r: w.querySelector('#d-why').value }; if (!App.WS._d.r) { w.querySelector('#d-why').focus(); return false; } } }] })
          .then(function (ok) { if (!ok) return; var d = App.WS._d; App.api('apiUpdateDraftCriterion', c.id, { sample: Number(d.n) > 0 ? { count: Number(d.n), per: d.per || null, unit: d.u } : null }, c.version, d.r).then(reload, App.fail); });
      };
    });
    App.$$('[data-rule]').forEach(function (btn) {
      btn.onclick = function () {
        var r = b.rules.filter(function (x) { return x.id === btn.getAttribute('data-rule'); })[0];
        App.dialog({ title: 'กฎ ' + r.rule_code, body: '<p lang="zh">' + esc(r.text.zh) + '</p><p>' + esc(r.text.th) + '</p><p class="hint">การตีความของระบบ: ' + esc(r.note) + '</p><div class="form-grid"><label class="field"><span>ประเภท</span><select id="d-t">' +
          ['PER_OCCURRENCE', 'ONCE', 'ZERO_SCORE', 'NO_DEDUCTION'].map(function (t) { return '<option value="' + t + '"' + (r.rule_type === t ? ' selected' : '') + '>' + RTYPE[t] + '</option>'; }).join('') + '</select></label><label class="field"><span>คะแนนที่หัก</span><input id="d-p" type="number" step="0.5" value="' + (r.points == null ? '' : r.points) + '"></label><label class="field span-2"><span>เหตุผล</span><input id="d-why"></label></div>',
          actions: [{ label: 'ยกเลิก', value: false }, { label: 'ยืนยันกฎนี้', kind: 'primary', value: true, onClick: function (w) { App.WS._d = { t: w.querySelector('#d-t').value, p: w.querySelector('#d-p').value, r: w.querySelector('#d-why').value }; if (!App.WS._d.r) { w.querySelector('#d-why').focus(); return false; } } }] })
          .then(function (ok) { if (ok) App.api('apiUpdateDraftRule', r.id, { rule_type: App.WS._d.t, points: App.WS._d.p }, r.version, App.WS._d.r).then(reload, App.fail); });
      };
    });
    // route editor
    App.$$('[data-route]').forEach(function (sec) {
      var list = App.$('.route-edit', sec);
      App.$$('[data-up],[data-down]', sec).forEach(function (bt) { bt.onclick = function () { var li = bt.closest('li'); if (bt.hasAttribute('data-up') && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling); else if (bt.hasAttribute('data-down') && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li); bt.focus(); }; });
      var add = App.$('[data-addstop]', sec);
      if (add) add.onclick = function () {
        var li = document.createElement('li');
        li.innerHTML = '<div class="re-head"><input class="re-name" placeholder="ชื่อจุดตรวจ" aria-label="ชื่อจุดตรวจ"><input class="re-time" placeholder="เวลา" aria-label="เวลา"></div><div class="re-crit">' + b.criteria.map(function (c) { return '<label class="chip-check"><input type="checkbox" value="' + c.id + '"><span>' + esc(c.code) + '</span></label>'; }).join('') + '</div><input class="re-instr" placeholder="คำแนะนำ" aria-label="คำแนะนำ">';
        list.appendChild(li); li.querySelector('.re-name').focus();
      };
      var save = App.$('[data-saveroute]', sec);
      if (save) save.onclick = function () {
        var stops = App.$$('li', list).map(function (li) { return { id: li.getAttribute('data-stop') || null, name: li.querySelector('.re-name').value, time_hint: li.querySelector('.re-time').value, instructions: (li.querySelector('.re-instr') || {}).value || '', criterion_ids: App.$$('input[type=checkbox]:checked', li).map(function (x) { return x.value; }), code: 'CUSTOM' }; })
          .filter(function (s) { return s.criterion_ids.length || s.id; });
        App.api('apiSaveRoute', sec.getAttribute('data-route'), stops).then(function () { App.toast('บันทึกเส้นทางแล้ว', 'ok'); reload(); }, App.fail);
      };
    });
  }
})();
