/* Quick capture during the walk + sorting tray + previous issues + priority + next team. */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;
  var W = function () { return App.WS; };

  // ---------- previous issues of this unit ----------
  App.QC = {};
  App.QC.prevByCode = function () {
    var h = W().data.history, m = {};
    if (!h) return m;
    h.findings.forEach(function (f) { (m[f.criterion_code] = m[f.criterion_code] || []).push(f); });
    return m;
  };
  App.QC.historyBanner = function () {
    var h = W().data.history;
    if (!h || !h.previous) return '<div class="hist hist-none">' + App.icon('clock') + 'ยังไม่มีรอบตรวจที่ยืนยันแล้วของหน่วยนี้ — ไม่มีประเด็นครั้งก่อนให้ตรวจซ้ำ</div>';
    var p = h.previous;
    return '<div class="hist">' + App.icon('clock') + '<span>ครั้งก่อน <a href="#/audit/' + p.id + '/summary">' + esc(p.audit_no) + '</a> (' + esc(p.audit_date) + ') คะแนน ' +
      (p.final_score == null ? '–' : App.num(p.final_score) + '/' + App.num(p.final_of_max)) + (p.scope_mode === 'PARTIAL' ? ' (บางส่วน)' : '') + ' • ประเด็น ' + h.findings.length + ' รายการ' +
      (h.open_count ? ', <strong class="t-bad">ยังไม่ปิด ' + h.open_count + '</strong>' : ', ปิดครบแล้ว') + '</span>' +
      (h.findings.length ? '<button class="link-btn" id="hist-filter">ตรวจซ้ำข้อที่เคยพบ</button>' : '') + '</div>';
  };
  App.QC.prevBlock = function (code) {
    var list = App.QC.prevByCode()[code];
    if (!list || !list.length) return '';
    return '<div class="prev-box"><h3 class="sub">' + App.icon('flag') + 'ประเด็นครั้งก่อนของหน่วยนี้ — ตรวจซ้ำว่าแก้แล้วจริง</h3><ul class="plain-list small">' + list.map(function (f) {
      return '<li><a href="#/issue/' + f.id + '">' + esc(f.issue_no) + '</a> ' + App.chip(f.status) + ' ' + esc(f.description) + ' <span class="t-muted">(' + esc(f.audit_no) + ' ' + esc(f.audit_date) + ')</span></li>';
    }).join('') + '</ul></div>';
  };

  /** Priority order for limited time: previously found (open first) → red-line related → higher points. */
  App.QC.priority = function (items) {
    var prev = App.QC.prevByCode();
    var crit = W().crit;
    return items.map(function (i) {
      var c = crit[i.criterion_id], pl = prev[c.code] || [];
      var open = pl.filter(function (f) { return f.status !== 'CLOSED'; }).length;
      var score = open * 100 + pl.length * 40 + (c.max_points || 0);
      return { i: i, s: score };
    }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.i; });
  };

  // ---------- quick capture ----------
  App.QC.capture = function () {
    var d = W().data, it = W().sel && d.items.filter(function (x) { return x.id === W().sel; })[0];
    var code = it ? W().crit[it.criterion_id].code : '';
    var stop = W().stop ? d.route.stops.filter(function (s) { return s.id === W().stop; })[0] : null;
    var file = null;
    App.dialog({ title: 'จดเร็วหน้างาน', body:
      '<p class="hint">ถ่ายแล้วจดสั้น ๆ ไว้ก่อน ค่อยจัดเข้าข้อทีหลังในถาด "รอจัดเข้าข้อ"' + (stop ? ' • จุด: ' + esc(stop.name) : '') + '</p>' +
      '<label class="btn btn-primary btn-block qc-shot">' + App.icon('camera') + '<span id="qc-shot-l">ถ่ายภาพ</span><input type="file" id="qc-file" accept="image/*" capture="environment" hidden></label>' +
      '<img id="qc-prev" alt="ภาพที่ถ่าย" hidden>' +
      '<label class="field"><span>เห็นอะไร (พิมพ์หรือกดไมค์บนคีย์บอร์ดเพื่อพูด)</span><textarea id="qc-note" rows="3" placeholder="เช่น สมุดส่งกะไม่มีหัวข้อสถานะผิดปกติ"></textarea></label>' +
      '<label class="check"><input type="checkbox" id="qc-flag"><span><strong>เป็นปัญหา</strong> — สร้างร่าง issue ให้อัตโนมัติเมื่อจัดเข้าข้อ</span></label>' +
      (code ? '<label class="check"><input type="checkbox" id="qc-here"><span>ผูกกับข้อ ' + esc(code) + ' ที่เปิดอยู่เลย</span></label>' : '') +
      '<label class="field"><span>สถานี/ตำแหน่งงาน</span><input id="qc-station" value="' + esc(App.store.get('cps_last_station', '')) + '"></label>',
      actions: [{ label: 'ยกเลิก', value: false }, { label: 'บันทึกแล้วถ่ายต่อ', value: 'again', onClick: collect }, { label: 'บันทึก', kind: 'primary', value: true, onClick: collect }],
      onOpen: function (w) {
        App.QC._w = w;
        w.querySelector('#qc-file').onchange = function (e) {
          file = e.target.files[0]; if (!file) return;
          var img = w.querySelector('#qc-prev'); img.src = URL.createObjectURL(file); img.hidden = false;
          w.querySelector('#qc-shot-l').textContent = 'ถ่ายใหม่';
          w.querySelector('#qc-note').focus();
        };
      } }).then(function (v) {
      if (!v || !App.QC._payload) return;
      var p = App.QC._payload; App.QC._payload = null;
      App.store.set('cps_last_station', p.station);
      App.WSupload(p);
      if (v === 'again') setTimeout(App.QC.capture, 150);
    });
    function collect(w) {
      var note = w.querySelector('#qc-note').value.trim();
      if (!file && !note) { w.querySelector('#qc-note').setAttribute('aria-invalid', 'true'); w.querySelector('#qc-note').focus(); return false; }
      var here = w.querySelector('#qc-here');
      App.QC._payload = { kind: file ? 'OVERVIEW_PHOTO' : 'NOTE', blob: file, file_name: file ? file.name : null, mime_type: file ? file.type : null, note_text: note,
        quick: true, flag_issue: w.querySelector('#qc-flag').checked, station: w.querySelector('#qc-station').value, item_ids: here && here.checked ? [it.id] : [] };
    }
  };

  // ---------- sorting tray ----------
  App.QC.unassigned = function () {
    var d = W().data, linked = {};
    d.links.forEach(function (l) { linked[l.evidence_id] = true; });
    return d.evidence.filter(function (e) { return !linked[e.id] && e.phase !== 'AFTER_FIX'; });
  };
  App.QC.renderTray = function () {
    var el = App.$('#ws-tray'); if (!el) return;
    var list = App.QC.unassigned();
    var editable = W().data.permissions.edit;
    if (!list.length) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    var crit = W().crit;
    var inScope = W().data.items.filter(function (i) { return i.in_scope; });
    var opts = inScope.map(function (i) { var c = crit[i.criterion_id]; return '<option value="' + i.id + '">' + esc(c.code + ' ' + App.firstLine(App.lang(c.title)).slice(0, 40)) + '</option>'; }).join('');
    var sug = App.QC._sug || {};
    el.innerHTML = '<details class="tray" open><summary>' + App.icon('upload') + '<strong>รอจัดเข้าข้อ ' + list.length + ' รายการ</strong><span class="t-muted">หลักฐานที่จดเร็วไว้ ยังไม่ผูกกับข้อใด — ข้อที่ไม่มีหลักฐานจะยังไม่ครบ</span></summary>' +
      (editable ? '<div class="btn-row"><button class="btn btn-ghost btn-sm" id="tray-ai"' + (App.state.md.ai.connected && App.state.online ? '' : ' disabled title="ต้องเชื่อมต่อ AI และออนไลน์"') + '>' + App.icon('ai') + 'ให้ AI แนะนำข้อ</button>' +
        (Object.keys(sug).length ? '<button class="btn btn-primary btn-sm" id="tray-accept">ยืนยันตามที่แนะนำทั้งหมด</button>' : '') + '</div>' : '') +
      '<ul class="tray-list">' + list.map(function (e) {
        var s = sug[e.id];
        var thumb = /^image\/(jpeg|png|webp)/.test(e.mime_type || '') ? '<button class="thumb" data-view="' + e.id + '" aria-label="เปิดภาพ"><img data-lazy="' + e.id + '" alt=""></button>' : '<span class="thumb thumb-ic">' + App.icon(e.kind === 'NOTE' ? 'note' : 'file') + '</span>';
        return '<li data-tray="' + e.id + '">' + thumb + '<div class="tray-body"><div><strong>' + esc(e.short_id) + '</strong> ' + (e.flag_issue ? '<span class="chip chip-bad">เป็นปัญหา</span> ' : '') + (e.station ? '<span class="t-muted">' + esc(e.station) + '</span> ' : '') + '<span class="t-muted">' + App.fmtDate(e.captured_at, true) + '</span></div>' +
          (e.note_text ? '<p class="ev-note">' + esc(e.note_text) + '</p>' : '') +
          (s ? '<p class="small t-ok">' + App.icon('ai') + 'AI แนะนำ: ' + (s.criterion_codes.length ? esc(s.criterion_codes.join(', ')) : 'ไม่แน่ใจ — เลือกเอง') + (s.looks_like_issue ? ' • ดูเหมือนเป็นปัญหา: ' + esc(s.issue_summary) : '') + ' <span class="t-muted">(' + esc(s.reason) + ')</span></p>' : '') +
          (editable ? '<div class="tray-assign"><label class="sr-only" for="ta-' + e.id + '">จัดเข้าข้อ</label><select id="ta-' + e.id + '"><option value="">เลือกข้อ…</option>' + opts + '</select><button class="btn btn-primary btn-sm" data-assign="' + e.id + '">จัดเข้าข้อ</button></div>' : '') + '</div></li>';
      }).join('') + '</ul></details>';
    list.forEach(function (e) { var s = sug[e.id]; var sel = App.$('#ta-' + e.id); if (s && sel && s.item_ids[0]) sel.value = s.item_ids[0]; });
    App.$$('[data-view]', el).forEach(function (b) { b.onclick = function () { App.viewEvidence(b.getAttribute('data-view')); }; });
    App.$$('img[data-lazy]', el).forEach(function (img) { App.fetchEvidenceUrl(img.getAttribute('data-lazy')).then(function (u) { img.src = u.url; }); img.removeAttribute('data-lazy'); });
    App.$$('[data-assign]', el).forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-assign'), itemId = App.$('#ta-' + id).value;
        if (!itemId) { App.toast('เลือกข้อก่อน', 'info'); App.$('#ta-' + id).focus(); return; }
        var s = sug[id];
        assign(id, s && s.item_ids.indexOf(itemId) >= 0 ? s.item_ids : [itemId], s);
      };
    });
    var ai = App.$('#tray-ai', el);
    if (ai) ai.onclick = function () {
      ai.disabled = true; ai.innerHTML = '<span class="spinner"></span>AI กำลังจัด…';
      App.api('apiSuggestEvidenceItems', W().data.audit.id, list.map(function (e) { return e.id; })).then(function (r) {
        App.QC._sug = {}; r.suggestions.forEach(function (s) { App.QC._sug[s.evidence_id] = s; });
        if (r.warnings.length) App.toast('AI ตอบบางส่วนไม่ถูกต้องและถูกตัดออก ' + r.warnings.length + ' รายการ', 'warn');
        App.QC.renderTray();
      }, function (e) { App.fail(e); App.QC.renderTray(); });
    };
    var acc = App.$('#tray-accept', el);
    if (acc) acc.onclick = function () {
      var chain = Promise.resolve();
      list.forEach(function (e) { var s = sug[e.id]; if (s && s.item_ids.length) chain = chain.then(function () { return assign(e.id, s.item_ids, s, true); }); });
      chain.then(function () { App.toast('จัดหลักฐานเข้าข้อตามที่แนะนำแล้ว — ตรวจทานในแต่ละข้อ', 'ok'); });
    };
  };

  /** Link evidence to items; if flagged as an issue, add a draft issue to each item (auditor still reviews). */
  function assign(evId, itemIds, sug, quiet) {
    var d = W().data, ev = d.evidence.filter(function (e) { return e.id === evId; })[0];
    var chain = Promise.resolve();
    itemIds.forEach(function (itemId) {
      chain = chain.then(function () {
        return App.api('apiLinkEvidence', itemId, evId, true).then(function (r) {
          d.links.push({ audit_item_id: itemId, evidence_id: evId });
          if (r.score) d.score = r.score;
          if (ev.flag_issue || (sug && sug.looks_like_issue)) App.WSaddDraftIssue(itemId, ev, sug);
        });
      });
    });
    return chain.then(function () {
      if (App.QC._sug) delete App.QC._sug[evId];
      if (!quiet) App.toast('จัด ' + ev.short_id + ' เข้าข้อแล้ว' + (ev.flag_issue ? ' และสร้างร่าง issue' : ''), 'ok');
      App.WSrefresh();
    }, App.fail);
  }

  // ---------- next team ----------
  App.QC.nextTeamHref = function (a) {
    if (a.audit_type !== 'TEAM' || !a.group_id) return null;
    var teams = App.state.md.teams.filter(function (t) { return t.group_id === a.group_id; }).sort(function (x, y) { return String(x.code + x.name).localeCompare(String(y.code + y.name)); });
    var i = teams.map(function (t) { return t.id; }).indexOf(a.team_id);
    var next = teams[i + 1];
    if (!next) return null;
    return { href: '#/audits/new?type=TEAM&v=' + a.standard_version_id + '&ws=' + a.workshop_id + '&g=' + a.group_id + '&t=' + next.id + '&route=' + (a.route_id || '') + '&scope=' + a.scope_mode, name: next.name };
  };
})();
