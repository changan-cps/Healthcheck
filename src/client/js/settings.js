/* Settings: AI connection, users & permissions, master data, demo data, audit log. */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;

  App.route('/settings', function (q) {
    App.setTitle('ตั้งค่า');
    if (!App.can('admin')) { App.$('#main').innerHTML = App.empty('เฉพาะ Admin', ''); return; }
    var tab = q.tab || 'ai';
    var tabs = [['ai', 'การเชื่อมต่อ AI'], ['users', 'ผู้ใช้และสิทธิ์'], ['master', 'Workshop / Group / Team'], ['log', 'ประวัติการใช้งาน'], ['system', 'ระบบ']];
    App.$('#main').innerHTML = '<nav class="tabs" aria-label="หมวดการตั้งค่า">' + tabs.map(function (t) { return '<a class="tab' + (t[0] === tab ? ' on' : '') + '" href="#/settings?tab=' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + t[1] + '</a>'; }).join('') + '</nav><div id="set-body">' + App.loading() + '</div>';
    ({ ai: ai, users: users, master: master, log: log, system: system })[tab]();
  });

  function body(h) { App.$('#set-body').innerHTML = h; }

  function ai() {
    App.api('apiGetSettings').then(function (s) {
      var c = s.ai;
      body('<section class="panel"><h2 class="panel-title">การเชื่อมต่อ AI</h2><p>สถานะ: ' + (c.connected ? '<span class="chip chip-ok">เชื่อมต่อแล้ว</span>' : '<span class="chip chip-warn">ยังไม่ได้เชื่อมต่อ AI</span>') + ' • ' + esc(c.provider) + ' / ' + esc(c.model) + '</p>' +
        '<form id="ai-f" class="form-grid"><label class="field"><span>ผู้ให้บริการ</span><select name="provider"><option value="gemini"' + (c.provider === 'gemini' ? ' selected' : '') + '>Google Gemini (มีแพ็กเกจฟรี, รองรับภาพ เสียง PDF)</option><option value="openai"' + (c.provider === 'openai' ? ' selected' : '') + '>OpenAI (ภาพ/PDF — เสียงต้องถอดก่อน)</option></select></label>' +
        '<label class="field"><span>โมเดล</span><input name="model" value="' + esc(c.model) + '"></label>' +
        '<label class="field"><span>แพ็กเกจ Gemini</span><select name="tier"><option value="free"' + (c.free_tier_notice ? ' selected' : '') + '>ฟรี</option><option value="paid"' + (!c.free_tier_notice ? ' selected' : '') + '>เสียเงิน</option></select></label>' +
        '<label class="field"><span>API Key (ใส่เพื่อเปลี่ยน — ระบบไม่แสดงคีย์เดิม)</span><input name="api_key" type="password" autocomplete="off" placeholder="' + (c.connected ? '•••••••• (บันทึกไว้แล้ว)' : 'วาง API Key') + '"></label>' +
        '<div class="span-2 btn-row"><button class="btn btn-primary">บันทึก</button><button type="button" class="btn btn-ghost" id="ai-test"' + (c.connected ? '' : ' disabled') + '>ทดสอบการเชื่อมต่อ</button>' + (c.connected ? '<button type="button" class="btn btn-ghost t-bad" id="ai-clear">ลบ API Key</button>' : '') + '</div></form><div id="ai-res" role="status"></div>' +
        '<div class="notice notice-info"><strong>เรื่องข้อมูลกับ Gemini แบบฟรี</strong><p>ข้อมูลที่ส่งผ่านแพ็กเกจฟรีอาจถูก Google นำไปใช้ปรับปรุงบริการ ควรตรวจกับ IT/ฝ่ายข้อมูลก่อนใช้กับภาพหน้างานจริง เปลี่ยนเป็นแพ็กเกจเสียเงินได้โดยไม่ต้องแก้โค้ด</p>' +
        '<p>API Key ถูกเก็บใน Script Properties ฝั่งเซิร์ฟเวอร์ ไม่อยู่ในหน้าเว็บ ฐานข้อมูล GitHub หรือ log</p></div></section>');
      var f = App.$('#ai-f');
      f.onsubmit = function (ev) { ev.preventDefault(); App.api('apiSetAiConfig', { provider: f.provider.value, model: f.model.value.trim(), tier: f.tier.value, api_key: f.api_key.value.trim() }).then(function (cfg) { App.state.md.ai = cfg; App.renderAiChip(); App.toast('บันทึกการตั้งค่า AI แล้ว', 'ok'); ai(); }, App.fail); };
      var t = App.$('#ai-test');
      t.onclick = function () { t.disabled = true; App.$('#ai-res').innerHTML = App.loading('กำลังเรียก AI…'); App.api('apiTestAi').then(function (r) { App.$('#ai-res').innerHTML = '<p class="notice notice-info">' + App.icon('check') + 'เชื่อมต่อสำเร็จ: ' + esc(r.provider + ' / ' + r.model) + ' ตอบกลับใน ' + r.ms + ' ms</p>'; }, function (e) { App.$('#ai-res').innerHTML = '<p class="notice notice-bad">' + esc(App.errorText(e)) + '</p>'; }).then(function () { t.disabled = false; }); };
      var cl = App.$('#ai-clear');
      if (cl) cl.onclick = function () { App.confirm('ลบ API Key', 'ระบบจะแสดง "ยังไม่ได้เชื่อมต่อ AI" และวิเคราะห์ไม่ได้จนกว่าจะใส่คีย์ใหม่', 'ลบคีย์', 'danger').then(function (ok) { if (ok) App.api('apiSetAiConfig', { clear_key: true }).then(function (cfg) { App.state.md.ai = cfg; App.renderAiChip(); ai(); }, App.fail); }); };
    }, function (e) { body(App.errorBox(e)); });
  }

  function users() {
    App.api('apiListUsers').then(function (list) {
      var md = App.state.md;
      var wsName = function (ids) { return (ids || []).map(function (id) { if (id === '*') return 'ทุก Workshop'; var w = md.workshops.filter(function (x) { return x.id === id; })[0]; return w ? w.code : '?'; }).join(', ') || '–'; };
      body('<section class="panel"><header class="panel-h"><h2>ผู้ใช้ (' + list.length + ')</h2><button class="btn btn-primary" id="u-new">' + App.icon('plus') + 'เพิ่มผู้ใช้</button></header><div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>บทบาท</th><th>ขอบเขต Workshop</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
        list.map(function (u) { return '<tr><td data-label="ชื่อผู้ใช้">' + esc(u.username) + '</td><td data-label="ชื่อ">' + esc(u.display_name) + '</td><td data-label="บทบาท">' + esc(u.role_name) + '</td><td data-label="ขอบเขต">' + esc(wsName(u.scope_workshop_ids)) + '</td><td data-label="สถานะ">' + (u.active ? App.chip('CONFIRMED', 'ใช้งาน') : App.chip('CANCELLED', 'ปิดใช้งาน')) + '</td><td><button class="link-btn" data-u="' + u.id + '">แก้ไข</button></td></tr>'; }).join('') +
        '</tbody></table></div><dl class="facts facts-wide small"><div><dt>Admin</dt><dd>จัดการมาตรฐาน ผู้ใช้ ตั้งค่า อนุมัติการยกเว้น</dd></div><div><dt>Auditor</dt><dd>ตรวจ วิเคราะห์ และยืนยันผลใน Workshop ที่ได้รับสิทธิ์ ตรวจยืนยันการแก้ไขของผู้อื่น</dd></div><div><dt>Workshop Owner</dt><dd>ดูผลที่ยืนยันแล้วของหน่วยงาน ส่งการแก้ไขและหลักฐานหลังแก้ไข</dd></div><div><dt>Viewer</dt><dd>ดูรายงานที่ยืนยันแล้วตามขอบเขต ไม่เปิดไฟล์หลักฐาน</dd></div></dl></section>');
      App.$('#u-new').onclick = function () { edit(null); };
      App.$$('[data-u]').forEach(function (b) { b.onclick = function () { edit(list.filter(function (u) { return u.id === b.getAttribute('data-u'); })[0]); }; });
      function edit(u) {
        u = u || { role: 'AUDITOR', scope_workshop_ids: [], active: true };
        var all = u.scope_workshop_ids.indexOf('*') >= 0;
        App.dialog({ title: u.id ? 'แก้ไขผู้ใช้ ' + u.username : 'เพิ่มผู้ใช้', body: '<form id="u-f" class="form-grid"><label class="field"><span>ชื่อผู้ใช้</span><input name="username" value="' + esc(u.username || '') + '" autocapitalize="none"></label><label class="field"><span>ชื่อที่แสดง</span><input name="display_name" value="' + esc(u.display_name || '') + '"></label>' +
          '<label class="field"><span>อีเมล</span><input name="email" type="email" value="' + esc(u.email || '') + '"></label><label class="field"><span>บทบาท</span><select name="role">' + Object.keys({ ADMIN: 1, AUDITOR: 1, WORKSHOP_OWNER: 1, VIEWER: 1 }).map(function (r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label>' +
          '<fieldset class="field span-2"><legend>ขอบเขต Workshop</legend><label class="check"><input type="checkbox" name="all"' + (all ? ' checked' : '') + '><span>ทุก Workshop</span></label><div class="ev-chips">' + md.workshops.map(function (w) { return '<label class="chip-check"><input type="checkbox" name="ws" value="' + w.id + '"' + (u.scope_workshop_ids.indexOf(w.id) >= 0 ? ' checked' : '') + '><span>' + esc(w.code) + '</span></label>'; }).join('') + '</div></fieldset>' +
          '<label class="check"><input type="checkbox" name="active"' + (u.active ? ' checked' : '') + '><span>ใช้งาน</span></label>' + (u.id ? '<label class="check"><input type="checkbox" name="reset"><span>รีเซ็ตรหัสผ่าน (ออกรหัสชั่วคราวใหม่)</span></label>' : '') + '</form>',
          actions: [{ label: 'ยกเลิก', value: false }, { label: 'บันทึก', kind: 'primary', value: true, onClick: function (w) {
            var f = w.querySelector('#u-f');
            App.WS._u = { id: u.id, version: u.version, username: f.username.value, display_name: f.display_name.value, email: f.email.value, role: f.role.value, active: f.active.checked, reset_password: f.reset ? f.reset.checked : false,
              scope_workshop_ids: f.all.checked ? ['*'] : App.$$('input[name=ws]:checked', f).map(function (x) { return x.value; }) };
          } }] }).then(function (ok) {
          if (!ok) return;
          App.api('apiSaveUser', App.WS._u).then(function (r) {
            if (r.temp_password) App.dialog({ title: 'รหัสผ่านชั่วคราว', body: '<p>แจ้งรหัสนี้กับผู้ใช้ ' + esc(r.user.username) + ' โดยตรง ระบบจะบังคับเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก และจะไม่แสดงซ้ำ</p><p class="big-code">' + esc(r.temp_password) + '</p>' });
            else App.toast('บันทึกผู้ใช้แล้ว', 'ok');
            users();
          }, App.fail);
        });
      }
    }, function (e) { body(App.errorBox(e)); });
  }

  function master() {
    App.loadMaster().then(function (md) {
      var h = '<section class="panel"><header class="panel-h"><h2>Workshop</h2><span class="muted">รหัส BS/PS/GA/PT/VI/KD มาจากไฟล์มาตรฐาน</span></header><ul class="row-list">' + md.workshops.map(function (w) {
        var gs = md.groups.filter(function (g) { return g.workshop_id === w.id; });
        return '<li class="ms-ws"><div class="ms-head"><strong>' + esc(w.code) + '</strong> ' + esc(w.name_th) + (w.is_demo ? ' <span class="chip chip-neutral">ข้อมูลสาธิต</span>' : '') + ' <button class="link-btn" data-addg="' + w.id + '">' + App.icon('plus') + 'เพิ่ม Group</button></div>' +
          (gs.length ? '<ul class="ms-groups">' + gs.map(function (g) {
            var ts = md.teams.filter(function (t) { return t.group_id === g.id; });
            return '<li><span><strong>' + esc(g.name) + '</strong> <small>' + esc(g.code) + (g.leader_name ? ' • ' + esc(g.leader_name) : '') + '</small></span> <button class="link-btn" data-addt="' + g.id + '" data-w="' + w.id + '">' + App.icon('plus') + 'เพิ่ม Team</button>' +
              (ts.length ? '<div class="ev-chips">' + ts.map(function (t) { return '<span class="chip chip-neutral">' + esc(t.name) + '</span>'; }).join('') + '</div>' : '') + '</li>';
          }).join('') + '</ul>' : '<p class="t-muted small">ยังไม่มี Group</p>') + '</li>';
      }).join('') + '</ul></section>';
      body(h);
      App.$$('[data-addg]').forEach(function (b) { b.onclick = function () { add('groups', { workshop_id: b.getAttribute('data-addg') }, 'เพิ่ม Group'); }; });
      App.$$('[data-addt]').forEach(function (b) { b.onclick = function () { add('teams', { workshop_id: b.getAttribute('data-w'), group_id: b.getAttribute('data-addt') }, 'เพิ่ม Team'); }; });
    });
    function add(table, base, title) {
      App.dialog({ title: title, body: '<div class="form-grid"><label class="field"><span>รหัส</span><input id="m-code" autofocus></label><label class="field"><span>ชื่อ</span><input id="m-name"></label><label class="field span-2"><span>ชื่อหัวหน้า</span><input id="m-lead"></label></div>',
        actions: [{ label: 'ยกเลิก', value: false }, { label: 'บันทึก', kind: 'primary', value: true, onClick: function (w) { App.WS._m = Object.assign({}, base, { code: w.querySelector('#m-code').value, name: w.querySelector('#m-name').value || w.querySelector('#m-code').value, leader_name: w.querySelector('#m-lead').value }); if (!App.WS._m.code) return false; } }] })
        .then(function (ok) { if (ok) App.api('apiSaveMaster', table, App.WS._m).then(function () { App.toast('บันทึกแล้ว', 'ok'); master(); }, App.fail); });
    }
  }

  function log() {
    App.api('apiAuditLog', { limit: 300 }).then(function (list) {
      body('<section class="panel"><h2 class="panel-title">ประวัติการใช้งานล่าสุด (' + list.length + ')</h2><div class="table-wrap"><table class="tbl tbl-cards"><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>ข้อมูล</th><th>เหตุผล</th></tr></thead><tbody>' +
        list.map(function (l) { return '<tr><td data-label="เวลา">' + App.fmtDate(l.created_at, true) + '</td><td data-label="ผู้ใช้">' + esc(l.user_name) + '</td><td data-label="การกระทำ">' + esc(l.action) + '</td><td data-label="ข้อมูล" class="small">' + esc(l.entity + ' ' + String(l.entity_id).slice(0, 8)) + '</td><td data-label="เหตุผล">' + esc(l.reason || '') + '</td></tr>'; }).join('') + '</tbody></table></div></section>');
    }, function (e) { body(App.errorBox(e)); });
  }

  function system() {
    App.api('apiGetSettings').then(function (s) {
      body('<section class="panel"><h2 class="panel-title">ข้อมูลระบบ</h2><dl class="facts facts-wide"><div><dt>เวอร์ชันแอป</dt><dd>' + esc(s.app_version) + '</dd></div><div><dt>Schema</dt><dd>' + s.schema_version + '</dd></div><div><dt>Scoring engine</dt><dd>' + esc(s.scoring_engine) + '</dd></div><div><dt>Prompt</dt><dd>' + esc(s.prompt_version) + '</dd></div><div><dt>ตัวอ่านมาตรฐาน</dt><dd>' + esc(s.parser_version) + '</dd></div>' +
        '<div><dt>ฐานข้อมูล</dt><dd><a href="' + esc(s.database_url) + '" target="_blank" rel="noopener">เปิด Google Sheet ฐานข้อมูล (เจ้าของบัญชีเท่านั้น)</a></dd></div></dl>' +
        '<h3 class="sub">ข้อมูลสาธิต</h3><p class="hint">สร้าง Workshop "[ข้อมูลสาธิต]" พร้อม Group/Team สำหรับทดลอง ข้อมูลนี้ติดป้ายชัดเจนและไม่รวมใน Dashboard (เว้นแต่เลือก "รวมข้อมูลสาธิต") ไม่มีผล AI หรือคะแนนจำลอง</p><button class="btn btn-ghost" id="demo">สร้างข้อมูลสาธิต</button></section>');
      App.$('#demo').onclick = function () { App.api('apiSeedDemo').then(function () { App.toast('สร้างข้อมูลสาธิตแล้ว', 'ok'); App.loadMaster(); }, App.fail); };
    }, function (e) { body(App.errorBox(e)); });
  }
})();
