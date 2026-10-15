/* Audit workspace: route, criteria, evidence, AI, scoring — one DOM for mobile/tablet/desktop. */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;
  var W = App.WS = { data: null, sel: null, stop: null, filter: 'all', step: 'std', drafts: {}, saving: {}, urls: {} };

  var KIND = { OVERVIEW_PHOTO: ['ภาพรวม', 'camera'], ZOOM_PHOTO: ['ภาพซูม', 'zoom'], AUDIO: ['เสียง', 'mic'], DOCUMENT: ['เอกสาร', 'file'], VIDEO: ['วิดีโอ', 'play'], NOTE: ['บันทึก', 'note'] };
  var OBS = { FACT: 'ข้อเท็จจริงที่เห็น', STATEMENT: 'คำกล่าวผู้ให้สัมภาษณ์', ASSUMPTION: 'ข้อสันนิษฐาน' };
  var RTYPE = { PER_OCCURRENCE: 'หักต่อปัญหา', ONCE: 'หักครั้งเดียว', ZERO_SCORE: '0 คะแนน', NO_DEDUCTION: 'ไม่หัก', UNPARSED: 'รอตรวจทาน' };

  App.route('/audit/:id', function (id) { open(id); });

  function open(id) {
    App.setTitle('ตรวจด้วย AI');
    App.$('#main').innerHTML = App.loading('กำลังโหลดรอบตรวจ…');
    App.api('apiGetAudit', id).then(function (d) {
      W.data = d; W.drafts = {}; W.stop = null;
      W.mode = d.standard.set.scoring_mode;
      W.crit = {}; d.standard.criteria.forEach(function (c) { W.crit[c.id] = c; });
      W.rules = {}; d.standard.rules.forEach(function (r) { W.rules[r.id] = r; });
      restoreLocalDrafts();
      var want = App.store.get('cps_ws_sel_' + id);
      var inScope = d.items.filter(function (i) { return i.in_scope; });
      W.sel = (inScope.filter(function (i) { return i.id === want; })[0] || inScope[0] || d.items[0] || {}).id;
      W.step = App.store.get('cps_ws_step', 'std');
      layout();
      App.beforeLeave = function () { flushAll(); return true; };
    }, function (e) { App.$('#main').innerHTML = App.errorBox(e, 'App.render()'); });
  }
  W.reload = function () { var id = W.data.audit.id; return App.api('apiGetAudit', id).then(function (d) { W.data = d; d.standard.criteria.forEach(function (c) { W.crit[c.id] = c; }); renderHead(); renderRoute(); App.QC.renderTray(); renderList(); renderPanes(); }); };
  App.WSrefresh = function () { renderHead(); renderRoute(); App.QC.renderTray(); renderList(); renderPanes(); };

  function item(id) { return W.data.items.filter(function (i) { return i.id === (id || W.sel); })[0]; }
  function scoreOf(critId) { return (W.data.score.items || []).filter(function (s) { return s.criterion_id === critId; })[0] || {}; }
  function itemEvidence(it) {
    var ids = {}; W.data.links.forEach(function (l) { if (l.audit_item_id === it.id) ids[l.evidence_id] = true; });
    return W.data.evidence.filter(function (e) { return ids[e.id]; });
  }
  function runOf(it) { return W.data.ai_runs.filter(function (r) { return r.audit_item_id === it.id; })[0] || null; }
  function editable() { return W.data.permissions.edit; }
  function view(it) { var d = W.drafts[it.id]; return d ? Object.assign({}, it, d.patch) : it; }

  // ---------- layout ----------
  function layout() {
    var a = W.data.audit;
    App.setTitle(a.audit_no);
    App.$('#main').innerHTML =
      '<div class="ws" id="ws" data-step="' + W.step + '">' +
      '<header class="ws-head" id="ws-head"></header><div id="ws-hist"></div>' +
      '<section class="route" id="ws-route" aria-label="เส้นทางการออดิท"></section><section id="ws-tray" aria-label="หลักฐานรอจัดเข้าข้อ" hidden></section>' +
      '<div class="ws-picker"><button class="btn btn-ghost btn-block" id="ws-pick" aria-controls="ws-list" aria-expanded="false"></button></div>' +
      '<nav class="ws-steps" aria-label="ขั้นตอน">' + [['std', 'มาตรฐาน'], ['ev', 'เก็บหลักฐาน'], ['ai', 'ผล AI'], ['score', 'คะแนน']].map(function (s, i) {
        return '<button class="step" data-step-btn="' + s[0] + '"><span class="step-n">' + (i + 1) + '</span>' + s[1] + '</button>';
      }).join('') + '</nav>' +
      '<div class="ws-grid"><aside class="ws-list" id="ws-list" aria-label="รายการข้อกำหนด"></aside>' +
      '<section class="ws-pane ws-std" data-pane="std" id="p-std" aria-label="มาตรฐาน"></section>' +
      '<section class="ws-pane ws-ev" data-pane="ev" id="p-ev" aria-label="หลักฐานและบันทึกหน้างาน"></section>' +
      '<section class="ws-pane ws-ai" data-pane="ai" id="p-ai" aria-label="ผลวิเคราะห์ AI"></section>' +
      '<section class="ws-pane ws-score" data-pane="score" id="p-score" aria-label="คะแนนและการยืนยัน"></section></div>' +
      '<div class="actionbar" id="ws-bar"><span class="save-state" id="save-state" role="status" aria-live="polite"></span>' +
      '<button class="btn btn-ghost" id="bar-prev">' + App.icon('chevl') + '<span>ก่อนหน้า</span></button>' +
      (W.data.permissions.edit ? '<button class="btn btn-ghost" id="bar-quick">' + App.icon('camera') + '<span>จดเร็ว</span></button>' : '') +
      '<button class="btn btn-ghost" id="bar-save">บันทึกร่าง</button><button class="btn btn-primary" id="bar-next"><span>ข้อถัดไป</span>' + App.icon('chevr') + '</button></div></div>';
    document.body.classList.add('has-actionbar');
    App.$$('[data-step-btn]').forEach(function (b) { b.onclick = function () { setStep(b.getAttribute('data-step-btn')); }; });
    App.$('#bar-prev').onclick = function () { move(-1); };
    App.$('#bar-next').onclick = function () { move(1); };
    App.$('#bar-save').onclick = function () { saveNow(W.sel); };
    var bq = App.$('#bar-quick'); if (bq) bq.onclick = App.QC.capture;
    App.$('#ws-pick').onclick = function () { var l = App.$('#ws-list'); var on = !l.classList.contains('open'); l.classList.toggle('open', on); this.setAttribute('aria-expanded', String(on)); if (on) { var a2 = App.$('.crit-link.on', l); if (a2) a2.focus(); } };
    renderHead(); renderRoute(); App.QC.renderTray(); renderList(); renderPanes(); setStep(W.step);
    renderSave();
  }

  function setStep(s) {
    W.step = s; App.store.set('cps_ws_step', s);
    var ws = App.$('#ws'); if (!ws) return;
    ws.setAttribute('data-step', s);
    App.$$('[data-step-btn]').forEach(function (b) { var on = b.getAttribute('data-step-btn') === s; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'step' : 'false'); });
  }

  function visibleItems() {
    var list = W.data.items.filter(function (i) { return i.in_scope; });
    if (W.stop) { var st = W.data.route.stops.filter(function (s) { return s.id === W.stop; })[0]; var set = {}; (st ? st.criterion_ids : []).forEach(function (x) { set[x] = true; }); list = list.filter(function (i) { return set[i.criterion_id]; }); }
    var todo = function (i) { var s = scoreOf(i.criterion_id); return !(s.status === 'SCORED' && s.evidence && s.evidence.complete) && s.status !== 'EXEMPT'; };
    if (W.filter === 'todo') list = list.filter(todo);
    if (W.filter === 'priority') list = App.QC.priority(list.filter(todo));
    if (W.filter === 'prev') { var pc = App.QC.prevByCode(); list = list.filter(function (i) { return pc[W.crit[i.criterion_id].code]; }); }
    return list;
  }

  function move(dir) {
    var list = visibleItems();
    var i = list.map(function (x) { return x.id; }).indexOf(W.sel);
    var n = list[i + dir];
    if (!n) {
      if (dir > 0) { App.toast(W.stop ? 'ครบทุกข้อของจุดนี้แล้ว — เลือกจุดถัดไปในเส้นทาง' : 'นี่คือข้อสุดท้าย — เปิดหน้าสรุปคะแนนเพื่อตรวจความครบถ้วน', 'info'); }
      return;
    }
    select(n.id);
    setStep('std');
  }

  function select(id) {
    flushAll();
    W.sel = id; App.store.set('cps_ws_sel_' + W.data.audit.id, id);
    App.$('#ws-list').classList.remove('open');
    renderList(); renderPanes();
    var top = App.$('#ws-grid') || App.$('.ws-grid'); if (top && window.innerWidth < 768) top.scrollIntoView({ block: 'start' });
  }

  // ---------- header ----------
  function renderHead() {
    var d = W.data, a = d.audit, s = d.score;
    var unit = [d.workshop && d.workshop.code, d.group && d.group.name, d.team && d.team.name].filter(Boolean).join(' / ');
    var rlCount = d.red_lines.filter(function (r) { return r.status !== 'REJECTED'; }).length;
    var scoreText = a.status === 'CONFIRMED' ? (a.final_score == null ? 'ไม่มีคะแนนสุดท้าย' : 'คะแนนสุดท้าย ' + App.num(a.final_score) + ' / ' + App.num(a.final_of_max))
      : (s.provisional.score == null ? 'ยังไม่มีคะแนน' : 'คะแนนชั่วคราว ' + App.num(s.provisional.score) + ' จาก ' + App.num(s.provisional.of_max));
    App.$('#ws-head').innerHTML = '<div class="wh-main"><div class="wh-title"><strong>' + esc(a.audit_no) + '</strong> ' + App.chip(a.status) + (a.scope_mode === 'PARTIAL' ? ' <span class="chip chip-warn">ตรวจบางส่วน</span>' : '') + (a.is_demo ? ' <span class="chip chip-neutral">ข้อมูลสาธิต</span>' : '') + '</div>' +
      '<div class="wh-meta">' + esc(App.typeLabel[a.audit_type]) + ' • ' + esc(unit) + ' • ' + esc(a.audit_date) + ' • มาตรฐาน ' + esc(d.standard.version.version_label) + '</div></div>' +
      '<div class="wh-score"><div class="meter" role="img" aria-label="ความครบถ้วน ' + (s.coverage.pct || 0) + '%"><span style="width:' + (s.coverage.pct || 0) + '%"></span></div>' +
      '<span>ครบถ้วน ' + s.coverage.covered + '/' + s.coverage.required + ' ข้อ</span><span class="wh-num">' + esc(scoreText) + '</span></div>' +
      '<div class="wh-actions">' + (d.permissions.edit ? '<button class="btn btn-primary only-wide" id="btn-quick">' + App.icon('camera') + 'จดเร็ว</button>' : '') + (d.standard.red_lines.length ? '<button class="btn btn-ghost" id="btn-rl">' + App.icon('flag') + 'Red Line' + (rlCount ? ' (' + rlCount + ')' : '') + '</button>' : '') +
      '<a class="btn btn-ghost" href="#/audit/' + a.id + '/summary">' + App.icon('audit') + 'สรุปคะแนน</a>' +
      (function () { var n = App.QC.nextTeamHref(a); return n ? '<a class="btn btn-ghost" href="' + n.href + '" title="เปิดรอบตรวจใหม่ของ ' + esc(n.name) + ' ด้วยค่าเดิม">' + App.icon('chevr') + 'ตรวจทีมถัดไป</a>' : ''; })() + '</div>';
    var b = App.$('#btn-rl'); if (b) b.onclick = function () { App.redLineDialog(); };
    var q = App.$('#btn-quick'); if (q) q.onclick = App.QC.capture;
    App.$('#ws-hist').innerHTML = App.QC.historyBanner();
    var hf = App.$('#hist-filter'); if (hf) hf.onclick = function () { W.filter = 'prev'; W.stop = null; renderRoute(); renderList(); var f = visibleItems()[0]; if (f) select(f.id); App.toast('แสดงเฉพาะข้อที่เคยพบปัญหาครั้งก่อน', 'info'); };
  }

  // ---------- route ----------
  function stopStats(st) {
    var set = {}; st.criterion_ids.forEach(function (x) { set[x] = true; });
    var its = W.data.items.filter(function (i) { return i.in_scope && set[i.criterion_id]; });
    var done = its.filter(function (i) { var s = scoreOf(i.criterion_id); return (s.status === 'SCORED' && s.evidence && s.evidence.complete) || s.status === 'EXEMPT'; }).length;
    var visits = W.data.visits.filter(function (v) { return v.stop_id === st.id; });
    var visit = visits.filter(function (v) { return v.status === 'IN_PROGRESS'; })[0] || visits.filter(function (v) { return v.status === 'DONE'; }).slice(-1)[0] || null;
    return { total: its.length, done: done, visit: visit, visits: visits };
  }

  function renderRoute() {
    var r = W.data.route, el = App.$('#ws-route');
    if (!r || !r.stops.length) { el.innerHTML = ''; el.hidden = true; return; }
    var stops = r.stops.filter(function (s) { return s.criterion_ids.length; });
    el.innerHTML = '<div class="route-head"><h2>' + App.icon('route') + esc(r.name) + '</h2><div class="seg" role="group" aria-label="มุมมองรายการ">' +
      '<button class="seg-btn' + (!W.stop ? ' on' : '') + '" data-stop="">ทุกจุด</button><button class="seg-btn' + (W.filter === 'todo' ? ' on' : '') + '" data-filter="todo">เฉพาะที่ยังไม่ครบ</button></div></div>' +
      '<ol class="track">' + stops.map(function (st) {
        var s = stopStats(st);
        var state = s.total && s.done === s.total ? 'done' : s.visit && s.visit.status === 'IN_PROGRESS' ? 'active' : s.done ? 'partial' : 'todo';
        var label = { done: 'ครบแล้ว', active: 'กำลังตรวจ', partial: 'ตรวจบางข้อ', todo: 'ยังไม่เริ่ม' }[state];
        return '<li class="station st-' + state + (W.stop === st.id ? ' sel' : '') + '"><button data-stop="' + st.id + '" aria-pressed="' + (W.stop === st.id) + '">' +
          '<span class="st-node" aria-hidden="true">' + (state === 'done' ? App.icon('check') : '') + '</span><span class="st-name">' + esc(st.name) + '</span>' +
          '<span class="st-meta">' + (st.time_hint ? esc(st.time_hint) + ' น. • ' : '') + s.done + '/' + s.total + ' ข้อ • ' + label + '</span></button></li>';
      }).join('') + '</ol><div id="stop-bar"></div>';
    App.$$('[data-stop]', el).forEach(function (b) { b.onclick = function () { W.stop = b.getAttribute('data-stop') || null; if (!W.stop) W.filter = 'all'; renderRoute(); renderList(); var f = visibleItems()[0]; if (f && f.id !== W.sel) select(f.id); }; });
    var fb = App.$('[data-filter]', el); fb.onclick = function () { W.filter = W.filter === 'todo' ? 'all' : 'todo'; renderRoute(); renderList(); };
    renderStopBar();
  }

  function renderStopBar() {
    var bar = App.$('#stop-bar'); if (!bar) return;
    if (!W.stop) { bar.innerHTML = ''; return; }
    var st = W.data.route.stops.filter(function (s) { return s.id === W.stop; })[0];
    var s = stopStats(st);
    var hist = s.visits.map(function (v) { return (v.session_label ? esc(v.session_label) + ': ' : '') + App.fmtDate(v.started_at, true) + (v.finished_at ? ' – ' + App.fmtDate(v.finished_at, true).split(' ').pop() : ' (ยังเปิดอยู่)'); }).join('<br>');
    bar.innerHTML = '<div class="stop-bar"><div><strong>' + esc(st.name) + '</strong>' + (st.instructions ? '<p class="hint">' + esc(st.instructions) + '</p>' : '') + (hist ? '<p class="hint">ประวัติการเข้าตรวจ:<br>' + hist + '</p>' : '<p class="hint">ยังไม่ได้บันทึกการเข้าตรวจจุดนี้ — ตรวจแยกช่วงเวลาได้ ระบบเก็บทุกครั้งที่เข้า</p>') + '</div>' +
      (editable() ? '<div class="stop-actions">' + (s.visit && s.visit.status === 'IN_PROGRESS' ? '<button class="btn btn-primary" data-visit="FINISH">' + App.icon('check') + 'เสร็จจุดนี้</button>' : '<button class="btn btn-ghost" data-visit="START">' + App.icon('play') + 'เริ่มตรวจจุดนี้</button>') + '</div>' : '') + '</div>';
    App.$$('[data-visit]', bar).forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute('data-visit');
        var label = act === 'START' ? (new Date().getHours() < 12 ? 'ช่วงเช้า ' : 'ช่วงบ่าย ') + new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
        b.disabled = true;
        App.api('apiRouteVisit', W.data.audit.id, W.stop, act, label, '').then(function (v) {
          W.data.visits = W.data.visits.filter(function (x) { return x.id !== v.id; }).concat([v]);
          renderRoute();
          App.toast(act === 'START' ? 'เริ่มตรวจ ' + st.name : 'บันทึกว่าเสร็จจุด ' + st.name + ' แล้ว', 'ok');
        }, function (e) { b.disabled = false; App.fail(e); });
      };
    });
  }

  // ---------- criteria list ----------
  function statusIcon(s) {
    if (s.status === 'SCORED' && s.evidence && s.evidence.complete) return '<span class="li-st li-ok" title="ครบ">' + App.icon('check') + '<span class="sr-only">ครบ</span></span>';
    if (s.status === 'SCORED') return '<span class="li-st li-warn" title="หลักฐาน/ตัวอย่างยังไม่ครบ">' + App.icon('clock') + '<span class="sr-only">หลักฐานยังไม่ครบ</span></span>';
    if (s.status === 'HELD' || s.status === 'PENDING_SCORE') return '<span class="li-st li-held" title="ระงับ">' + App.icon('pause') + '<span class="sr-only">ระงับ</span></span>';
    if (s.status === 'INSUFFICIENT') return '<span class="li-st li-warn" title="หลักฐานไม่พอ">' + App.icon('alert') + '<span class="sr-only">หลักฐานไม่พอ</span></span>';
    if (s.status === 'EXEMPT') return '<span class="li-st li-neutral" title="ยกเว้น">–<span class="sr-only">ยกเว้น</span></span>';
    return '<span class="li-st li-todo" title="ยังไม่ตรวจ"><span class="sr-only">ยังไม่ตรวจ</span></span>';
  }

  function renderList() {
    var list = visibleItems();
    var dims = W.data.standard.version.dimensions || [];
    var it = item();
    var c = it && W.crit[it.criterion_id];
    var all = W.data.items.filter(function (i) { return i.in_scope; });
    var pos = all.map(function (x) { return x.id; }).indexOf(W.sel) + 1;
    App.$('#ws-pick').innerHTML = c ? App.icon('menu') + '<span>ข้อ <strong>' + esc(c.code) + '</strong> (' + pos + '/' + all.length + ') — ' + esc(App.firstLine(App.lang(c.title)).slice(0, 40)) + '</span>' : 'เลือกข้อ';
    var prev = App.QC.prevByCode();
    var html = '<div class="list-head"><span>' + list.length + ' ข้อ' + (W.stop ? ' ในจุดนี้' : '') + '</span><label class="sr-only" for="ws-filter">แสดง</label><select id="ws-filter" class="mini-select">' +
      [['all', 'ทุกข้อ'], ['todo', 'ยังไม่ครบ'], ['priority', 'ควรดูก่อน (เวลาน้อย)'], ['prev', 'เคยพบครั้งก่อน']].map(function (o) { return '<option value="' + o[0] + '"' + (W.filter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    if (W.filter === 'priority') html += '<p class="hint list-hint">เรียงข้อที่ยังไม่ครบ: เคยพบปัญหาที่ยังไม่ปิด → เคยพบปัญหา → คะแนนสูง</p>';
    dims.forEach(function (d) {
      var its = list.filter(function (i) { return W.crit[i.criterion_id].dimension_code === d.code; });
      if (!its.length) return;
      html += '<div class="crit-dim"><h3>' + esc(App.firstLine(App.lang(d.name))) + (d.max_points != null ? ' <small>' + d.max_points + ' คะแนน</small>' : d.weight != null ? ' <small>น้ำหนัก ' + d.weight + '</small>' : '') + '</h3><ul>' +
        its.map(function (i) {
          var cc = W.crit[i.criterion_id], s = scoreOf(i.criterion_id);
          var pts = s.score != null ? App.num(s.score) + '/' + App.num(cc.max_points) : (cc.max_points != null ? '–/' + cc.max_points : '');
          return '<li><button class="crit-link' + (i.id === W.sel ? ' on' : '') + '" data-item="' + i.id + '"' + (i.id === W.sel ? ' aria-current="true"' : '') + '>' + statusIcon(s) +
            '<span class="cl-code">' + esc(cc.code) + '</span><span class="cl-title">' + esc(App.firstLine(App.lang(cc.title))) + '</span><span class="cl-pts">' + pts + '</span>' +
            (prev[cc.code] ? '<span class="cl-prev" title="ครั้งก่อนพบปัญหา ' + prev[cc.code].length + ' รายการ">เคยพบ</span>' : '') +
            (W.drafts[i.id] ? '<span class="cl-dirty" title="มีข้อมูลที่ยังไม่ถึงเซิร์ฟเวอร์">●<span class="sr-only">ยังไม่บันทึก</span></span>' : '') + '</button></li>';
        }).join('') + '</ul></div>';
    });
    if (!list.length) html += App.empty('ไม่มีข้อในมุมมองนี้', W.filter === 'todo' ? 'ทุกข้อครบแล้ว' : '');
    var el = App.$('#ws-list');
    if (W.filter === 'priority' || W.filter === 'prev') {
      // flat ordered list (not grouped by dimension)
      html = html.split('<div class="crit-dim">')[0] + '<ul class="flat">' + list.map(function (i) {
        var cc = W.crit[i.criterion_id], s = scoreOf(i.criterion_id);
        return '<li><button class="crit-link' + (i.id === W.sel ? ' on' : '') + '" data-item="' + i.id + '">' + statusIcon(s) + '<span class="cl-code">' + esc(cc.code) + '</span><span class="cl-title">' + esc(App.firstLine(App.lang(cc.title))) + '</span>' +
          (prev[cc.code] ? '<span class="cl-prev">เคยพบ</span>' : '<span class="cl-pts">' + (cc.max_points != null ? cc.max_points + ' คะแนน' : '') + '</span>') + '</button></li>';
      }).join('') + '</ul>' + (list.length ? '' : App.empty('ไม่มีข้อในมุมมองนี้', ''));
    }
    el.innerHTML = html;
    var fsel = App.$('#ws-filter', el); fsel.onchange = function () { W.filter = fsel.value; renderRoute(); renderList(); };
    App.$$('[data-item]', el).forEach(function (b) { b.onclick = function () { select(b.getAttribute('data-item')); if (window.innerWidth < 768) setStep('std'); }; });
  }

  function renderPanes() { renderStd(); renderEv(); renderAi(); renderScore(); }

  // ---------- standard pane ----------
  function langBlock(o) {
    if (!o) return '';
    var out = '';
    if (o.th) out += '<div class="lang lang-th" lang="th">' + App.nl2br(o.th) + '</div>';
    if (o.zh) out += '<details class="lang-alt"><summary>ต้นฉบับภาษาจีน</summary><div lang="zh">' + App.nl2br(o.zh) + '</div></details>';
    if (!o.th && !o.zh) out += '<div class="lang">' + App.nl2br(o.raw || o.en || '') + '</div>';
    return out;
  }
  function srcRef(r) { if (!r) return ''; return esc((r.sheet || '') + (r.cell ? ' ' + r.cell : r.row ? ' แถว ' + r.row : '')); }

  function renderStd() {
    var it = item(), el = App.$('#p-std');
    if (!it) { el.innerHTML = App.empty('ไม่มีข้อในขอบเขต', ''); return; }
    var c = W.crit[it.criterion_id];
    var rules = W.data.standard.rules.filter(function (r) { return r.criterion_ids.indexOf(c.id) >= 0; });
    var h = '<header class="pane-h"><span class="code-badge">' + esc(c.code) + '</span><h2>' + esc(App.firstLine(App.lang(c.title))) + '</h2></header>' + App.QC.prevBlock(c.code);
    h += '<dl class="facts">' + (c.max_points != null ? '<div><dt>คะแนนเต็ม</dt><dd>' + c.max_points + '</dd></div>' : c.max_points_source === 'ITEM_GROUP' ? '<div><dt>คะแนนเต็ม</dt><dd class="t-held">ยังไม่กำหนด</dd></div>' : '') +
      (c.kup_type ? '<div><dt>ประเภท</dt><dd>' + esc(c.kup_type === 'C' ? 'C ความสามารถ' : c.kup_type === 'A' ? 'A การปฏิบัติ' : c.kup_type) + '</dd></div><div><dt>ความสำคัญ</dt><dd>' + esc(c.kup_importance) + '</dd></div>' : '') +
      (it.sample_required ? '<div><dt>ตัวอย่างที่ต้องตรวจ</dt><dd>' + it.sample_required + (c.sample && c.sample.unit ? ' <small>(' + esc(c.sample.unit) + ')</small>' : '') + '</dd></div>' : c.sample ? '<div><dt>ตัวอย่าง</dt><dd>' + esc(c.sample.text || '') + '</dd></div>' : '') +
      (c.time_hint ? '<div><dt>เวลาที่กำหนด</dt><dd>' + esc(c.time_hint) + ' น.</dd></div>' : '') + '</dl>';
    h += '<h3 class="sub">ข้อกำหนด / เนื้อหาการประเมิน</h3>' + langBlock(c.requirement);
    if (c.method && (c.method.th || c.method.zh || c.method.raw)) h += '<h3 class="sub">วิธีตรวจ' + (W.mode === 'BAND' ? ' / สิ่งที่ต้องเตรียม' : '') + '</h3>' + langBlock(c.method);
    if (c.target_role && (c.target_role.th || c.target_role.zh)) h += '<p class="hint">ผู้ถูกประเมิน: ' + esc(c.target_role.th || c.target_role.zh) + '</p>';
    if (W.mode === 'BAND') {
      h += '<h3 class="sub">เกณฑ์ช่วงคะแนน</h3><ol class="bands">' + (c.bands || []).map(function (b, i) {
        return '<li class="band' + (it.ai_band_index === i ? ' band-ai' : '') + (view(it).band_index === i ? ' band-sel' : '') + '"><span class="band-r">' + b.min + '–' + b.max + '</span><div>' + App.nl2br(b.text) + '</div>' + (it.ai_band_index === i ? '<span class="chip chip-info">AI เสนอ</span>' : '') + '</li>';
      }).join('') + '</ol>';
    } else {
      h += '<h3 class="sub">เกณฑ์ให้คะแนน</h3><ul class="rules">' + rules.map(function (r) {
        return '<li><span class="rule-code">' + esc(r.rule_code) + '</span><span class="rule-type">' + esc(RTYPE[r.rule_type] || r.rule_type) + (r.points ? ' ' + r.points + ' คะแนน' : '') + '</span><div class="rule-text">' + esc(r.text.th || r.text.zh) + (r.text.th && r.text.zh ? '<details class="lang-alt"><summary>ภาษาจีน</summary>' + esc(r.text.zh) + '</details>' : '') + '</div></li>';
      }).join('') + '</ul>' + (rules.length > 0 && rules[0].criterion_ids.length > 1 ? '<p class="hint">เกณฑ์ชุดนี้ใช้ร่วมกับข้อ ' + esc(rules[0].criterion_ids.filter(function (x) { return x !== c.id; }).map(function (x) { return W.crit[x] ? W.crit[x].code : ''; }).join(', ')) + ' (เซลล์รวมในไฟล์)</p>' : '');
    }
    var flags = (c.review_flags || []).filter(function (f) { return f.severity !== 'info'; });
    if (flags.length) h += '<details class="flags"><summary>' + App.icon('alert') + 'หมายเหตุจากการนำเข้า (' + flags.length + ')</summary><ul>' + flags.map(function (f) { return '<li>' + esc(f.message_th) + '</li>'; }).join('') + '</ul></details>';
    h += '<p class="src">ต้นทาง: ' + esc(W.data.standard.version.source_file_name) + ' • ' + srcRef({ sheet: c.source_ref.sheet, row: c.source_ref.row }) + '</p>';
    h += '<button class="btn btn-primary btn-block only-mobile" data-goto="ev">เก็บหลักฐาน' + App.icon('chevr') + '</button>';
    el.innerHTML = h;
    wireGoto(el);
  }

  function wireGoto(el) { App.$$('[data-goto]', el).forEach(function (b) { b.onclick = function () { setStep(b.getAttribute('data-goto')); window.scrollTo(0, App.$('.ws-steps').offsetTop - 8); }; }); }

  // ---------- evidence pane ----------
  function renderEv() {
    var it = item(), el = App.$('#p-ev');
    if (!it) { el.innerHTML = ''; return; }
    var v = view(it), evs = itemEvidence(it), s = scoreOf(it.criterion_id), canEd = editable();
    var samples = {}; evs.forEach(function (e) { if (e.sample_label) samples[e.sample_label] = true; });
    var got = Object.keys(samples).length;
    var h = '<header class="pane-h"><h2>หลักฐานและบันทึกหน้างาน</h2><span class="muted">' + evs.length + ' ชิ้น</span></header>';
    if (it.sample_required) h += '<div class="sample ' + (got >= it.sample_required ? 'sample-ok' : 'sample-short') + '"><strong>ตัวอย่าง ' + got + '/' + it.sample_required + '</strong>' +
      '<span>' + (got >= it.sample_required ? 'ครบตามมาตรฐาน' : 'ยังขาดอีก ' + (it.sample_required - got) + ' ตัวอย่าง — ระบุ "ตัวอย่างที่" ตอนแนบหลักฐาน') + '</span></div>';
    if (!W.data.permissions.evidence) h += '<p class="notice notice-info">บทบาทของคุณดูไฟล์หลักฐานไม่ได้</p>';
    if (canEd) {
      h += '<div class="capture">' +
        cap('OVERVIEW_PHOTO', 'camera', 'ถ่ายภาพรวม') + cap('ZOOM_PHOTO', 'zoom', 'ถ่ายภาพซูม') + cap('AUDIO', 'mic', 'บันทึกเสียง') + cap('DOCUMENT', 'file', 'แนบเอกสาร') + cap('NOTE', 'note', 'บันทึกข้อความ') + '</div>' +
        '<div class="ev-meta-row"><label class="field"><span>สถานี/ตำแหน่งงาน</span><input id="ev-station" value="' + esc(App.store.get('cps_last_station', '')) + '" placeholder="เช่น ST-05"></label>' +
        '<label class="field"><span>ตัวอย่างที่</span><select id="ev-sample"><option value="">–</option>' + sampleOptions(it, samples) + '</select></label></div>' +
        '<div class="dropzone" id="dropzone"><span>' + App.icon('upload') + 'ลากไฟล์มาวางที่นี่ หรือ </span><label class="link-btn">เลือกไฟล์<input type="file" id="ev-any" multiple hidden></label>' +
        '<small>ภาพ ≤10 MB • เสียง ≤15 MB • PDF ≤15 MB • วิดีโอ ≤25 MB (ยังไม่วิเคราะห์ด้วย AI)</small></div>' +
        '<div id="up-list" class="up-list"></div>' +
        '<input type="file" id="in-photo" accept="image/*" capture="environment" hidden><input type="file" id="in-doc" accept="application/pdf,image/*,text/plain,.xlsx,.docx" hidden><input type="file" id="in-audio" accept="audio/*" hidden>';
    }
    h += '<ul class="ev-list" id="ev-list">' + (evs.length ? evs.map(evRow).join('') : '<li class="ev-empty">' + App.empty('ยังไม่มีหลักฐานในข้อนี้', canEd ? 'ถ่ายภาพ บันทึกเสียง แนบเอกสาร หรือพิมพ์บันทึกหน้างาน' : '') + '</li>') + '</ul>';
    if (canEd) h += '<button class="btn btn-ghost" id="ev-link">' + App.icon('link') + 'ใช้หลักฐานที่มีอยู่ในรอบนี้</button>';
    h += '<label class="field notes"><span>บันทึกผู้ตรวจ (บันทึกอัตโนมัติ)</span><textarea id="f-notes" rows="4" ' + (canEd ? '' : 'readonly') + ' placeholder="สิ่งที่เห็น คำตอบสัมภาษณ์ หมายเหตุ">' + esc(v.auditor_notes || '') + '</textarea></label>';
    h += '<button class="btn btn-primary btn-block only-mobile" data-goto="ai">ไปที่ผล AI' + App.icon('chevr') + '</button>';
    el.innerHTML = h;
    wireGoto(el);
    var notes = App.$('#f-notes');
    if (canEd) notes.oninput = function () { setDraft(it.id, { auditor_notes: notes.value }); };
    if (!canEd) { lazyThumbs(el); return; }
    App.$$('[data-cap]', el).forEach(function (b) { b.onclick = function () { capture(b.getAttribute('data-cap')); }; });
    App.$('#in-photo').onchange = function (e) { handleFiles(e.target.files, App.$('#in-photo').dataset.kind || 'OVERVIEW_PHOTO'); e.target.value = ''; };
    App.$('#in-doc').onchange = function (e) { handleFiles(e.target.files, 'DOCUMENT'); e.target.value = ''; };
    App.$('#in-audio').onchange = function (e) { handleFiles(e.target.files, 'AUDIO'); e.target.value = ''; };
    App.$('#ev-any').onchange = function (e) { handleFiles(e.target.files, null); e.target.value = ''; };
    App.$('#ev-station').onchange = function (e) { App.store.set('cps_last_station', e.target.value); };
    var dz = App.$('#dropzone');
    ['dragenter', 'dragover'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { handleFiles(e.dataTransfer.files, null); });
    App.$('#ev-link').onclick = linkExisting;
    wireEvRows(el);
    lazyThumbs(el);
    renderUploads();
  }
  function cap(kind, icon, label) { return '<button class="cap-btn" data-cap="' + kind + '">' + App.icon(icon) + '<span>' + label + '</span></button>'; }
  function sampleOptions(it, have) {
    var n = it.sample_required || 0, out = '', next = null;
    for (var i = 1; i <= Math.max(n, 1) + 1; i++) { var k = String(i); if (!next && !have[k] && i <= n) next = k; out += '<option value="' + k + '"' + (k === next ? ' selected' : '') + '>' + k + (have[k] ? ' (มีแล้ว)' : '') + '</option>'; }
    return out;
  }

  function evRow(e) {
    var k = KIND[e.kind] || [e.kind, 'file'];
    var thumb = (e.kind === 'OVERVIEW_PHOTO' || e.kind === 'ZOOM_PHOTO') && /^image\/(jpeg|png|webp)/.test(e.mime_type) ? '<button class="thumb" data-view="' + e.id + '" aria-label="เปิดภาพ ' + esc(e.file_name) + '"><img data-lazy="' + e.id + '" alt=""></button>' : '<span class="thumb thumb-ic">' + App.icon(k[1]) + '</span>';
    var parent = e.parent_evidence_id ? W.data.evidence.filter(function (x) { return x.id === e.parent_evidence_id; })[0] : null;
    var h = '<li class="ev" data-ev="' + e.id + '">' + thumb + '<div class="ev-body"><div class="ev-title"><strong>' + esc(k[0]) + '</strong> <span class="ev-id">' + esc(e.short_id) + '</span>' +
      (e.sample_label ? ' <span class="chip chip-neutral">ตัวอย่างที่ ' + esc(e.sample_label) + '</span>' : '') + (!e.analysis_supported ? ' <span class="chip chip-warn">AI ยังไม่รองรับไฟล์นี้</span>' : '') + '</div>' +
      '<div class="ev-meta">' + esc(e.kind === 'NOTE' ? '' : e.file_name) + (e.station ? ' • ' + esc(e.station) : '') + ' • ' + App.fmtDate(e.captured_at, true) + (parent ? ' • ซูมจาก ' + esc(parent.short_id) : '') + '</div>' +
      (e.kind === 'NOTE' ? '<p class="ev-note">' + App.nl2br(e.note_text) + '</p>' : '');
    if (e.kind === 'AUDIO') h += audioBlock(e);
    h += '<div class="ev-actions">' + (e.kind !== 'NOTE' && e.kind !== 'AUDIO' ? '<button class="link-btn" data-view="' + e.id + '">' + App.icon('eye') + 'เปิด</button>' : '') +
      (editable() ? '<button class="link-btn" data-unlink="' + e.id + '">' + App.icon('link') + 'เอาออกจากข้อนี้</button><button class="link-btn t-bad" data-del="' + e.id + '">' + App.icon('trash') + 'ลบ</button>' : '') + '</div></div></li>';
    return h;
  }

  function audioBlock(e) {
    var t = e.transcript;
    var h = '<div class="audio" data-audio="' + e.id + '"><button class="btn btn-ghost btn-sm" data-play="' + e.id + '">' + App.icon('play') + 'ฟังเสียง</button>' + (e.duration_sec ? ' <span class="t-muted">' + App.fmtTime(e.duration_sec) + '</span>' : '') + '<audio controls preload="none" hidden></audio></div>';
    if (t && t.segments && t.segments.length) {
      h += '<div class="transcript"><div class="tr-head"><strong>ข้อความถอดเสียง</strong> ' + (e.transcript_status === 'EDITED' ? '<span class="chip chip-ok">ผู้ตรวจแก้ไขแล้ว</span>' : '<span class="chip chip-warn">ถอดโดยเครื่อง — ควรตรวจทาน</span>') + '</div><ol>' +
        t.segments.map(function (s, i) { return '<li><button class="ts" data-seek="' + e.id + '" data-t="' + s.start_sec + '">' + App.fmtTime(s.start_sec) + '</button>' + (editable() ? '<span class="tr-text" contenteditable="true" data-seg="' + i + '" role="textbox" aria-label="ข้อความช่วง ' + App.fmtTime(s.start_sec) + '">' + esc(s.text) + '</span>' : '<span>' + esc(s.text) + '</span>') + '</li>'; }).join('') +
        '</ol>' + (editable() ? '<button class="btn btn-ghost btn-sm" data-trsave="' + e.id + '">บันทึกข้อความถอดเสียง</button>' : '') + '</div>';
    } else if (editable()) {
      h += '<div class="transcript-empty">' + (e.transcript_status === 'RUNNING' ? App.loading('กำลังถอดเสียง…') : e.transcript_status === 'FAILED' ? '<p class="t-bad">ถอดเสียงไม่สำเร็จ</p>' : '') +
        '<button class="btn btn-ghost btn-sm" data-transcribe="' + e.id + '"' + (App.state.md.ai.connected ? '' : ' disabled title="ยังไม่ได้เชื่อมต่อ AI"') + '>' + App.icon('ai') + 'ถอดเสียงด้วย AI</button>' +
        '<button class="btn btn-ghost btn-sm" data-trmanual="' + e.id + '">พิมพ์ข้อความเอง</button></div>';
    }
    return h;
  }

  function wireEvRows(el) {
    App.$$('[data-view]', el).forEach(function (b) { b.onclick = function () { App.viewEvidence(b.getAttribute('data-view')); }; });
    App.$$('[data-unlink]', el).forEach(function (b) { b.onclick = function () { var id = b.getAttribute('data-unlink'); App.api('apiLinkEvidence', W.sel, id, false).then(function (r) { W.data.links = W.data.links.filter(function (l) { return !(l.audit_item_id === W.sel && l.evidence_id === id); }); applyScore(r.score); renderEv(); }, App.fail); }; });
    App.$$('[data-del]', el).forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-del');
        App.ask('ลบหลักฐาน', 'เหตุผลการลบ (บันทึกในประวัติ)', { ok: 'ลบหลักฐาน', kind: 'danger' }).then(function (reason) {
          if (!reason) return;
          App.api('apiDeleteEvidence', id, reason).then(function (r) { W.data.evidence = W.data.evidence.filter(function (e) { return e.id !== id; }); applyScore(r.score); renderEv(); App.toast('ลบหลักฐานแล้ว', 'ok'); }, App.fail);
        });
      };
    });
    App.$$('[data-play]', el).forEach(function (b) { b.onclick = function () { loadAudio(b.getAttribute('data-play'), 0); }; });
    App.$$('[data-seek]', el).forEach(function (b) { b.onclick = function () { loadAudio(b.getAttribute('data-seek'), Number(b.getAttribute('data-t'))); }; });
    App.$$('[data-transcribe]', el).forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-transcribe'); b.disabled = true; b.innerHTML = '<span class="spinner"></span>กำลังถอดเสียง…';
        App.api('apiTranscribeAudio', id).then(function (ev) { replaceEv(ev); renderEv(); App.toast('ถอดเสียงแล้ว — ตรวจทานและแก้ข้อความได้', 'ok'); }, function (e) { App.fail(e); renderEv(); });
      };
    });
    App.$$('[data-trmanual]', el).forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-trmanual');
        App.ask('พิมพ์ข้อความจากเสียง', 'ข้อความ (ขึ้นบรรทัดใหม่ตามช่วง หรือใส่ [mm:ss] หน้าบรรทัด)', {}).then(function (txt) {
          if (!txt) return;
          var segs = txt.split('\n').filter(Boolean).map(function (l) { var m = /^\[(\d+):(\d{2})\]\s*(.*)$/.exec(l); return m ? { start_sec: Number(m[1]) * 60 + Number(m[2]), text: m[3] } : { start_sec: 0, text: l }; });
          var ev = W.data.evidence.filter(function (x) { return x.id === id; })[0];
          App.api('apiUpdateTranscript', id, segs, ev.version).then(function (e2) { replaceEv(e2); renderEv(); }, App.fail);
        });
      };
    });
    App.$$('[data-trsave]', el).forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-trsave');
        var ev = W.data.evidence.filter(function (x) { return x.id === id; })[0];
        var segs = ev.transcript.segments.map(function (s, i) { var span = App.$('[data-audio="' + id + '"]').parentNode.querySelector('[data-seg="' + i + '"]'); return Object.assign({}, s, { text: span ? span.textContent : s.text }); });
        App.api('apiUpdateTranscript', id, segs, ev.version).then(function (e2) { replaceEv(e2); renderEv(); App.toast('บันทึกข้อความถอดเสียงแล้ว', 'ok'); }, App.fail);
      };
    });
  }
  function replaceEv(ev) { W.data.evidence = W.data.evidence.map(function (x) { return x.id === ev.id ? ev : x; }); }

  function fetchUrl(id) {
    if (W.urls[id]) return Promise.resolve(W.urls[id]);
    return App.api('apiGetEvidenceContent', id).then(function (f) {
      if (f.text != null) return { text: f.text };
      var bin = atob(f.base64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      W.urls[id] = { url: URL.createObjectURL(new Blob([arr], { type: f.mime_type })), mime: f.mime_type, name: f.file_name };
      return W.urls[id];
    });
  }
  App.fetchEvidenceUrl = fetchUrl;
  function lazyThumbs(el) {
    var imgs = App.$$('img[data-lazy]', el);
    var load = function (img) { fetchUrl(img.getAttribute('data-lazy')).then(function (u) { img.src = u.url; }, function () { img.alt = 'โหลดภาพไม่สำเร็จ'; }); img.removeAttribute('data-lazy'); };
    if (!('IntersectionObserver' in window)) { imgs.forEach(load); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }); });
    imgs.forEach(function (i) { io.observe(i); });
  }
  function loadAudio(id, t) {
    var box = App.$('[data-audio="' + id + '"]'); if (!box) return;
    var au = box.querySelector('audio');
    fetchUrl(id).then(function (u) { if (au.src !== u.url) au.src = u.url; au.hidden = false; au.currentTime = t || 0; au.play().catch(function () {}); }, App.fail);
  }

  App.viewEvidence = function (id) {
    var e = W.data.evidence.filter(function (x) { return x.id === id; })[0];
    App.dialog({ title: (KIND[e.kind] || [e.kind])[0] + ' ' + e.short_id, body: '<div class="viewer" id="viewer">' + App.loading('กำลังเปิดไฟล์…') + '</div><p class="hint">' + esc(e.file_name) + (e.station ? ' • ' + esc(e.station) : '') + ' • ' + App.fmtDate(e.captured_at, true) + '</p>',
      actions: [{ label: 'ปิด' }], onOpen: function (w) {
        fetchUrl(id).then(function (u) {
          var v = w.querySelector('#viewer');
          if (/^image\//.test(u.mime)) v.innerHTML = '<img src="' + u.url + '" alt="' + esc(e.file_name) + '">';
          else if (u.mime === 'application/pdf') v.innerHTML = '<object data="' + u.url + '" type="application/pdf"><a class="btn btn-primary" href="' + u.url + '" download="' + esc(u.name) + '">ดาวน์โหลด PDF</a></object>';
          else if (/^video\//.test(u.mime)) v.innerHTML = '<video controls src="' + u.url + '"></video><p class="notice notice-warn">AI ยังไม่รองรับการวิเคราะห์วิดีโอ</p>';
          else v.innerHTML = '<a class="btn btn-primary" href="' + u.url + '" download="' + esc(u.name) + '">ดาวน์โหลดไฟล์</a>';
        }, function (er) { w.querySelector('#viewer').innerHTML = App.errorBox(er); });
      } });
  };

  // ---------- capture & upload ----------
  var uploads = [];
  function capture(kind) {
    if (kind === 'OVERVIEW_PHOTO' || kind === 'ZOOM_PHOTO') { var inp = App.$('#in-photo'); inp.dataset.kind = kind; inp.click(); return; }
    if (kind === 'DOCUMENT') { App.$('#in-doc').click(); return; }
    if (kind === 'NOTE') {
      App.ask('บันทึกหน้างาน', 'ข้อความ', { ok: 'บันทึกเป็นหลักฐาน' }).then(function (txt) { if (txt) upload({ kind: 'NOTE', note_text: txt }); });
      return;
    }
    if (kind === 'AUDIO') App.recordAudio().then(function (rec) { if (rec) upload({ kind: 'AUDIO', blob: rec.blob, file_name: rec.name, mime_type: rec.mime, duration_sec: rec.duration }); }, function (e) {
      App.toast(e.message + ' — เลือกไฟล์เสียงหรือพิมพ์ข้อความแทนได้', 'error');
      App.$('#in-audio').click();
    });
  }

  function guessKind(file) {
    var t = file.type || '';
    if (/^image\//.test(t)) return 'OVERVIEW_PHOTO';
    if (/^audio\//.test(t)) return 'AUDIO';
    if (/^video\//.test(t)) return 'VIDEO';
    return 'DOCUMENT';
  }
  function handleFiles(files, kind) {
    Array.prototype.slice.call(files || []).forEach(function (f) {
      var k = kind || guessKind(f);
      var mime = f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : /\.xlsx$/i.test(f.name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.docx$/i.test(f.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '');
      var lim = App.state.md.evidence_kinds[k];
      if (lim && f.size > (/^image\//.test(mime) ? 25 * 1048576 : lim.max)) { App.toast('ไฟล์ "' + f.name + '" ใหญ่เกิน ' + (lim.max / 1048576) + ' MB', 'error'); return; }
      if (lim && lim.mimes.indexOf(mime) < 0 && (lim.accept_unanalyzable || []).indexOf(mime) < 0) { App.toast('ไม่รองรับไฟล์ชนิด ' + (mime || f.name.split('.').pop()) + ' สำหรับ' + lim.label, 'error'); return; }
      upload({ kind: k, blob: f, file_name: f.name, mime_type: mime });
    });
  }

  function resizeImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bmp) {
      var max = 2048, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (s === 1 && file.size < 3 * 1048576) return file;
      var c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (res) { c.toBlob(function (b) { res(b || file); }, 'image/jpeg', 0.85); });
    }).catch(function () { return file; });
  }
  function toB64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); }); }

  function upload(o) {
    var it = item(), a = W.data.audit;
    var ref = App.uid();
    var entry = { ref: ref, name: o.file_name || 'บันทึกหน้างาน', kind: o.kind, state: 'กำลังเตรียมไฟล์…' };
    uploads.push(entry); renderUploads();
    var req = { audit_id: a.id, kind: o.kind, item_ids: o.item_ids || (it ? [it.id] : []), station: o.station != null ? o.station : (App.$('#ev-station') || {}).value || '',
      sample_label: o.quick ? '' : (App.$('#ev-sample') || {}).value || '', quick: !!o.quick, flag_issue: !!o.flag_issue,
      stop_id: W.stop || '', client_ref: ref, captured_at: new Date().toISOString(), note_text: o.note_text || '', duration_sec: o.duration_sec || null };
    if (o.kind === 'ZOOM_PHOTO') {
      var parents = W.data.evidence.filter(function (e) { return e.kind === 'OVERVIEW_PHOTO'; });
      if (parents.length) req.parent_evidence_id = parents[parents.length - 1].id;
    }
    var prep = o.blob ? (/^image\//.test(o.mime_type) ? resizeImage(o.blob) : Promise.resolve(o.blob)).then(function (b) {
      req.mime_type = b.type || o.mime_type; req.file_name = (o.file_name || 'file').replace(/\.(heic|heif|png|webp)$/i, b.type === 'image/jpeg' && b !== o.blob ? '.jpg' : '$&');
      return toB64(b).then(function (s) { req.base64 = s; });
    }) : Promise.resolve();
    prep.then(function () {
      entry.state = 'กำลังอัปโหลด…'; renderUploads();
      return App.api('apiUploadEvidence', req);
    }).then(function (r) {
      onUploaded(r, req); uploads = uploads.filter(function (u) { return u !== entry; }); renderUploads();
      App.toast(r.notice || 'บันทึกหลักฐานแล้ว', r.notice ? 'warn' : 'ok');
    }).catch(function (e) {
      if (e && e.network) {
        entry.state = 'ยังไม่ได้ส่ง — เก็บไว้ในเครื่องนี้ จะส่งอัตโนมัติเมื่อออนไลน์'; entry.queued = true; renderUploads();
        App.Queue.add({ key: 'up:' + ref, fn: 'apiUploadEvidence', args: [req], onDone: 'uploaded', label: entry.name });
      } else { entry.state = 'ไม่สำเร็จ: ' + App.errorText(e); entry.failed = true; renderUploads(); }
    });
  }
  function onUploaded(r, req) {
    if (!W.data || W.data.audit.id !== req.audit_id) return;
    if (!W.data.evidence.some(function (e) { return e.id === r.evidence.id; })) W.data.evidence.push(r.evidence);
    (req.item_ids || []).forEach(function (iid) { if (!W.data.links.some(function (l) { return l.audit_item_id === iid && l.evidence_id === r.evidence.id; })) W.data.links.push({ audit_item_id: iid, evidence_id: r.evidence.id }); });
    if (r.score) applyScore(r.score);
    if (req.item_ids && req.item_ids.indexOf(W.sel) >= 0) renderEv();
    if (!req.item_ids || !req.item_ids.length) App.QC.renderTray();
    if (req.flag_issue && req.item_ids && req.item_ids.length) req.item_ids.forEach(function (iid) { App.WSaddDraftIssue(iid, r.evidence, null); });
  }
  App.WSupload = function (o) { upload(o); };
  /** Draft issue from a quick-capture photo/note. The auditor still reviews and confirms the item. */
  App.WSaddDraftIssue = function (itemId, ev, sug) {
    var it = item(itemId); if (!it) return;
    var v = view(it), c = W.crit[it.criterion_id];
    var text = (sug && sug.issue_summary) || ev.note_text || ('ปัญหาจากหลักฐาน ' + ev.short_id);
    if (W.mode === 'BAND') { setDraft(itemId, { auditor_notes: ((v.auditor_notes || '') + '\n[จดเร็ว ' + ev.short_id + '] ' + text).trim() }, true); return; }
    var rules = W.data.standard.rules.filter(function (r) { return r.criterion_ids.indexOf(c.id) >= 0; });
    var rule = rules.filter(function (r) { return r.rule_type === 'PER_OCCURRENCE'; })[0] || rules[0];
    if (!rule) return;
    var issues = JSON.parse(JSON.stringify(v.issues || []));
    if (issues.some(function (x) { return (x.evidence_ids || []).indexOf(ev.id) >= 0; })) return;
    issues.push({ issue_key: text.slice(0, 80), rule_id: rule.id, description: text, evidence_ids: [ev.id], source: 'QUICK' });
    setDraft(itemId, { issues: issues, result: 'NONCONFORM' }, true);
  };
  App.queueHandlers.uploaded = function (r, e) { uploads = uploads.filter(function (u) { return u.ref !== e.args[0].client_ref; }); onUploaded(r, e.args[0]); renderUploads(); App.toast('ส่งหลักฐานที่ค้างไว้แล้ว: ' + (e.label || ''), 'ok'); };
  function renderUploads() {
    var el = App.$('#up-list'); if (!el) return;
    el.innerHTML = uploads.map(function (u) { return '<div class="up' + (u.failed ? ' up-bad' : u.queued ? ' up-wait' : '') + '">' + (u.failed || u.queued ? App.icon(u.failed ? 'alert' : 'clock') : '<span class="spinner"></span>') + '<span><strong>' + esc(u.name) + '</strong> ' + esc(u.state) + '</span>' + (u.failed ? '<button class="link-btn" data-updismiss="' + u.ref + '">ปิด</button>' : '') + '</div>'; }).join('');
    App.$$('[data-updismiss]', el).forEach(function (b) { b.onclick = function () { uploads = uploads.filter(function (u) { return u.ref !== b.getAttribute('data-updismiss'); }); renderUploads(); }; });
  }

  function linkExisting() {
    var it = item();
    var linked = {}; itemEvidence(it).forEach(function (e) { linked[e.id] = true; });
    var others = W.data.evidence.filter(function (e) { return !linked[e.id] && e.phase !== 'AFTER_FIX'; });
    if (!others.length) { App.toast('ยังไม่มีหลักฐานอื่นในรอบตรวจนี้', 'info'); return; }
    App.dialog({ title: 'ใช้หลักฐานที่มีอยู่กับข้อ ' + W.crit[it.criterion_id].code, body: '<p class="hint">หลักฐานหนึ่งชิ้นใช้ได้หลายข้อ</p><div class="pick-list">' + others.map(function (e) {
      return '<label class="check"><input type="checkbox" value="' + e.id + '"><span><strong>' + esc((KIND[e.kind] || [e.kind])[0]) + ' ' + esc(e.short_id) + '</strong> ' + esc(e.kind === 'NOTE' ? String(e.note_text).slice(0, 60) : e.file_name) + (e.station ? ' • ' + esc(e.station) : '') + '</span></label>';
    }).join('') + '</div>', actions: [{ label: 'ยกเลิก', value: false }, { label: 'เชื่อมกับข้อนี้', kind: 'primary', onClick: function (w) {
      var ids = App.$$('input:checked', w).map(function (x) { return x.value; });
      var chain = Promise.resolve();
      ids.forEach(function (id) { chain = chain.then(function () { return App.api('apiLinkEvidence', it.id, id, true).then(function (r) { W.data.links.push({ audit_item_id: it.id, evidence_id: id }); applyScore(r.score); }); }); });
      chain.then(function () { renderEv(); }, App.fail);
    } }] });
  }

  // ---------- AI pane ----------
  function renderAi() {
    var it = item(), el = App.$('#p-ai');
    if (!it) { el.innerHTML = ''; return; }
    var ai = App.state.md.ai, run = runOf(it), c = W.crit[it.criterion_id];
    var h = '<header class="pane-h"><h2>' + App.icon('ai') + 'ผลวิเคราะห์ AI</h2>' + (run ? App.chip(run.status) : '') + '</header>';
    if (!ai.connected) h += '<p class="notice notice-warn">ยังไม่ได้เชื่อมต่อ AI — Admin ต้องใส่ API Key ในหน้าตั้งค่า ระหว่างนี้ผู้ตรวจให้คะแนนเองได้ตามเกณฑ์</p>';
    else if (ai.free_tier_notice) h += '<p class="notice notice-info small">ใช้ Gemini แบบฟรี: Google อาจนำข้อมูลที่ส่งไปใช้ปรับปรุงบริการ — หลีกเลี่ยงภาพที่มีข้อมูลลับ</p>';
    if (!App.state.online) h += '<p class="notice notice-warn">ออฟไลน์อยู่ — การวิเคราะห์ด้วย AI ต้องใช้อินเทอร์เน็ต</p>';
    if (editable()) h += '<div class="ai-actions"><button class="btn btn-primary" id="ai-run"' + (ai.connected && App.state.online ? '' : ' disabled') + '>' + App.icon('ai') + (run && run.status === 'SUCCEEDED' ? 'วิเคราะห์ใหม่' : 'วิเคราะห์ด้วย AI') + '</button>' +
      '<span class="hint">ส่งหลักฐาน ' + itemEvidence(it).filter(function (e) { return e.analysis_supported; }).length + ' ชิ้น' + (it.auditor_notes ? ' + บันทึกผู้ตรวจ' : '') + '</span></div><div id="ai-status" role="status" aria-live="polite"></div>';
    if (!run) h += App.empty('ยังไม่ได้วิเคราะห์', 'แนบหลักฐานแล้วกด "วิเคราะห์ด้วย AI" — AI จะเทียบกับมาตรฐานของข้อนี้และเสนอผล ผู้ตรวจเป็นผู้ยืนยันเสมอ');
    else h += runView(run, it, c);
    h += '<button class="btn btn-primary btn-block only-mobile" data-goto="score">ไปที่คะแนน' + App.icon('chevr') + '</button>';
    el.innerHTML = h;
    wireGoto(el);
    var b = App.$('#ai-run', el);
    if (b) b.onclick = function () { analyze(it, run && run.status === 'SUCCEEDED'); };
    var use = App.$('#ai-use', el); if (use) use.onclick = function () { useAi(it, run); };
    App.$$('[data-ref]', el).forEach(function (x) { x.onclick = function () { var id = x.getAttribute('data-ref'); var e = W.data.evidence.filter(function (y) { return y.id === id; })[0]; if (!e) return; if (e.kind === 'AUDIO') { setStep('ev'); var t = parseLoc(x.getAttribute('data-loc')); setTimeout(function () { loadAudio(id, t); }, 50); } else if (e.kind === 'NOTE') App.dialog({ title: 'บันทึก ' + e.short_id, body: '<p>' + App.nl2br(e.note_text) + '</p>' }); else App.viewEvidence(id); }; });
  }
  function parseLoc(l) { var m = /(\d+):(\d{2})/.exec(l || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }

  function refLinks(refs) {
    return (refs || []).map(function (r) {
      if (r.evidence_id === 'AUDITOR-NOTES') return '<span class="ref">บันทึกผู้ตรวจ' + (r.locator ? ' @ ' + esc(r.locator) : '') + '</span>';
      var e = W.data.evidence.filter(function (x) { return x.id === r.evidence_id; })[0];
      return '<button class="ref" data-ref="' + esc(r.evidence_id) + '" data-loc="' + esc(r.locator || '') + '">' + esc(e ? e.short_id : r.evidence_id) + (r.locator ? ' @ ' + esc(r.locator) : '') + '</button>';
    }).join(' ');
  }

  function runView(run, it, c) {
    var h = '<p class="t-muted small">' + esc(run.provider + ' / ' + run.model) + ' • prompt ' + esc(run.prompt_version) + ' • ' + App.fmtDate(run.finished_at || run.started_at, true) + ' • ครั้งที่ ' + run.attempt + '</p>';
    if (run.skipped_evidence && run.skipped_evidence.length) h += '<p class="notice notice-warn small">ไม่ได้ส่งให้ AI ' + run.skipped_evidence.length + ' ไฟล์: ' + esc(run.skipped_evidence.map(function (s) { var e = W.data.evidence.filter(function (x) { return x.id === s.id; })[0]; return (e ? e.short_id : '') + ' (' + s.reason + ')'; }).join(', ')) + '</p>';
    if (run.status === 'FAILED') return h + '<p class="notice notice-bad">AI ทำงานไม่สำเร็จ: ' + esc(run.error_message) + ' — กดวิเคราะห์ใหม่ได้ ระบบจะไม่สร้างปัญหาหรือคะแนนซ้ำ</p>';
    if (run.status === 'INVALID_OUTPUT') return h + '<p class="notice notice-bad">ผล AI ไม่ผ่านการตรวจสอบจึงไม่นำมาใช้</p><ul class="plain-list small">' + (run.validation_errors || []).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
    if (run.status !== 'SUCCEEDED' || !run.parsed) return h;
    var p = run.parsed, prop = run.engine_proposal || {};
    h += '<div class="ai-result"><div class="ai-verdict">' + App.chip(p.result) + (prop.mode === 'DEDUCTION' && prop.score != null ? '<span class="ai-score">คะแนนเสนอ <strong>' + App.num(prop.score) + '</strong> / ' + App.num(prop.max) + '</span>' : '') +
      (prop.mode === 'BAND' && prop.band ? '<span class="ai-score">ช่วงคะแนนเสนอ <strong>' + prop.band.min + '–' + prop.band.max + '</strong></span>' : '') + '</div>';
    if (prop.hold_reasons && prop.hold_reasons.length) h += '<p class="notice notice-held small">' + esc(prop.hold_reasons.join('; ')) + '</p>';
    if (prop.note) h += '<p class="hint">' + esc(prop.note) + '</p>';
    ['FACT', 'STATEMENT', 'ASSUMPTION'].forEach(function (t) {
      var list = p.observations.filter(function (o) { return o.type === t; });
      if (!list.length) return;
      h += '<h3 class="sub obs-' + t.toLowerCase() + '">' + OBS[t] + '</h3><ul class="obs">' + list.map(function (o) { return '<li>' + esc(o.text) + (o.evidence_references.length ? '<div class="refs">' + refLinks(o.evidence_references) + '</div>' : '') + '</li>'; }).join('') + '</ul>';
    });
    if (p.issues.length) h += '<h3 class="sub">ปัญหาที่พบ (อ้างกฎ)</h3><ul class="obs">' + p.issues.map(function (is) { var r = W.rules[is.rule_id]; return '<li><strong>' + esc(is.issue_key) + '</strong> — ' + esc(is.description) + ' <span class="rule-code">' + esc(r ? r.rule_code : is.rule_code) + '</span>' + (is.evidence_ids.length ? '<div class="refs">' + refLinks(is.evidence_ids.map(function (x) { return { evidence_id: x }; })) + '</div>' : '') + '</li>'; }).join('') + '</ul>';
    if (p.conflicts.length) h += '<h3 class="sub t-bad">ความขัดแย้งระหว่างหลักฐาน</h3><ul class="obs">' + p.conflicts.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (p.missing_evidence.length) h += '<h3 class="sub">หลักฐานที่ควรเก็บเพิ่ม</h3><ul class="checklist">' + p.missing_evidence.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (p.suggested_questions.length) h += '<h3 class="sub">คำถามที่ควรถามเพิ่ม</h3><ul class="checklist">' + p.suggested_questions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (p.red_line_candidates && p.red_line_candidates.length) h += '<p class="notice notice-bad">' + App.icon('flag') + 'AI พบสิ่งที่อาจเป็น Red Line ' + p.red_line_candidates.length + ' รายการ — ต้องให้ผู้ตรวจยืนยันที่ปุ่ม Red Line</p>';
    h += '<details class="rationale"><summary>เหตุผลของ AI</summary><p>' + App.nl2br(p.rationale) + '</p></details>';
    if (editable()) h += '<button class="btn btn-ghost" id="ai-use">ใช้ผลนี้เป็นร่างคะแนน</button><p class="hint">ผลจะถูกคัดลอกไปที่ส่วนคะแนน ผู้ตรวจยังต้องตรวจทานและกดยืนยัน</p>';
    return h + '</div>';
  }

  function analyze(it, force) {
    var st = App.$('#ai-status'), b = App.$('#ai-run');
    b.disabled = true; st.innerHTML = App.loading('AI กำลังวิเคราะห์หลักฐาน… (อาจใช้เวลา 10–60 วินาที)');
    flush(it.id).then(function () {
      return App.api('apiAnalyzeItem', it.id, !!force);
    }).then(function (r) {
      W.data.ai_runs = W.data.ai_runs.filter(function (x) { return x.audit_item_id !== it.id; }).concat([r.run]);
      if (r.item) mergeItem(r.item);
      if (r.message) App.toast(r.message, r.run.status === 'SUCCEEDED' ? 'info' : 'warn');
      return W.reload();
    }).catch(function (e) { st.innerHTML = '<p class="notice notice-bad">' + esc(App.errorText(e)) + '</p>'; b.disabled = false; });
  }

  function useAi(it, run) {
    var p = run.parsed;
    var patch = { result: p.result };
    if (W.mode === 'BAND') patch.band_index = p.proposed_band_index;
    else patch.issues = p.issues.map(function (is) { return { issue_key: is.issue_key, rule_id: is.rule_id, description: is.description, evidence_ids: is.evidence_ids, source: 'AI_PROPOSED' }; });
    setDraft(it.id, patch, true);
    renderScore(); renderStd();
    setStep('score');
    App.toast('คัดลอกผล AI เป็นร่างแล้ว — ตรวจทานก่อนยืนยัน', 'info');
  }

  // ---------- score pane ----------
  function renderScore() {
    var it = item(), el = App.$('#p-score');
    if (!it) { el.innerHTML = ''; return; }
    var v = view(it), c = W.crit[it.criterion_id], s = scoreOf(c.id), canEd = editable();
    var dis = canEd ? '' : ' disabled';
    var h = '<header class="pane-h"><h2>คะแนนและการยืนยัน</h2>' + App.chip(s.status) + '</header>';
    h += '<fieldset class="field"' + dis + '><legend>ผลการตรวจข้อนี้</legend><div class="radio-row tight">' +
      [['CONFORM', 'สอดคล้อง'], ['NONCONFORM', 'ไม่สอดคล้อง'], ['INSUFFICIENT', 'หลักฐานไม่พอ']].map(function (r) { return '<label class="radio-pill r-' + r[0].toLowerCase() + '"><input type="radio" name="f-result" value="' + r[0] + '"' + (v.result === r[0] ? ' checked' : '') + '><span>' + r[1] + '</span></label>'; }).join('') + '</div></fieldset>';
    if (W.mode === 'BAND') {
      var bands = c.bands || [];
      h += '<div class="form-grid"><label class="field"><span>ช่วงคะแนน</span><select id="f-band"' + dis + '><option value="">เลือกช่วง</option>' + bands.map(function (b, i) { return '<option value="' + i + '"' + (v.band_index === i ? ' selected' : '') + '>' + b.min + '–' + b.max + (it.ai_band_index === i ? ' (AI เสนอ)' : '') + '</option>'; }).join('') + '</select></label>' +
        '<label class="field"><span>คะแนนในช่วง</span><input id="f-bscore" type="number" step="0.5" inputmode="decimal"' + (v.band_index != null && bands[v.band_index] ? ' min="' + bands[v.band_index].min + '" max="' + bands[v.band_index].max + '"' : '') + ' value="' + (v.band_score == null ? '' : v.band_score) + '"' + dis + '></label></div>' +
        '<p class="hint">มาตรฐานไม่มีเกณฑ์เลือกคะแนนจุดเดียวภายในช่วง — ผู้ตรวจเป็นผู้ตัดสิน</p>';
    } else {
      var rules = W.data.standard.rules.filter(function (r) { return r.criterion_ids.indexOf(c.id) >= 0; });
      var evs = itemEvidence(it);
      h += '<div class="issues" id="issues"><div class="issues-h"><strong>ปัญหาที่พบ</strong><span class="hint">ปัญหาเดียวกันจากหลายหลักฐานให้ใช้ชื่อเดียวกัน — ระบบหักครั้งเดียว</span></div>' +
        (v.issues || []).map(function (is, i) {
          return '<div class="issue" data-i="' + i + '"><label class="field"><span>ชื่อปัญหา</span><input data-k="issue_key" value="' + esc(is.issue_key) + '" list="issue-keys"' + dis + '></label>' +
            '<label class="field"><span>กฎที่ใช้</span><select data-k="rule_id"' + dis + '>' + rules.map(function (r) { return '<option value="' + r.id + '"' + (r.id === is.rule_id ? ' selected' : '') + '>' + esc(r.rule_code + ' ' + (RTYPE[r.rule_type] || '') + (r.points ? ' ' + r.points : '') + ' — ' + App.firstLine(r.text.th || r.text.zh).slice(0, 50)) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field span-2"><span>รายละเอียด</span><input data-k="description" value="' + esc(is.description || '') + '"' + dis + '></label>' +
            '<div class="field span-2"><span class="lbl">หลักฐาน</span><div class="ev-chips">' + (evs.length ? evs.map(function (e) { return '<label class="chip-check"><input type="checkbox" data-ev="' + e.id + '"' + ((is.evidence_ids || []).indexOf(e.id) >= 0 ? ' checked' : '') + dis + '><span>' + esc(e.short_id) + '</span></label>'; }).join('') : '<span class="t-muted">ยังไม่มีหลักฐานในข้อนี้</span>') + '</div></div>' +
            (is.source === 'AI_PROPOSED' ? '<span class="chip chip-info">จาก AI</span>' : '') + (canEd ? '<button class="link-btn t-bad" data-rm="' + i + '">' + App.icon('trash') + 'ลบปัญหานี้</button>' : '') + '</div>';
        }).join('') + '<datalist id="issue-keys">' + (v.issues || []).map(function (is) { return '<option value="' + esc(is.issue_key) + '">'; }).join('') + '</datalist>' +
        (canEd ? '<button class="btn btn-ghost btn-sm" id="add-issue"' + (rules.length ? '' : ' disabled') + '>' + App.icon('plus') + 'เพิ่มปัญหา</button>' : '') + '</div>';
    }
    // calculation
    h += '<div class="calc">' + calcView(s, c) + '</div>';
    h += '<details class="override"' + (v.override_score != null ? ' open' : '') + '><summary>แก้คะแนนต่างจากที่คำนวณ</summary><div class="form-grid"><label class="field"><span>คะแนนที่ผู้ตรวจกำหนด</span><input id="f-ov" type="number" step="0.5" min="0" max="' + (c.max_points || 10) + '" value="' + (v.override_score == null ? '' : v.override_score) + '"' + dis + '></label>' +
      '<label class="field span-2"><span>เหตุผล (จำเป็น — บันทึกค่าเดิม ค่าใหม่ และผู้แก้)</span><textarea id="f-ovr" rows="2"' + dis + '>' + esc(v.override_reason || '') + '</textarea></label></div></details>';
    if (it.exemption_status) h += '<p class="notice ' + (it.exemption_status === 'APPROVED' ? 'notice-info' : it.exemption_status === 'REJECTED' ? 'notice-bad' : 'notice-warn') + '">ขอยกเว้น: ' + esc({ REQUESTED: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ' }[it.exemption_status]) + ' — ' + esc(it.exemption_reason) +
      (it.exemption_status === 'REQUESTED' && W.data.permissions.approve_exemption ? ' <button class="btn btn-sm btn-primary" data-ex="1">อนุมัติ</button> <button class="btn btn-sm btn-ghost" data-ex="0">ไม่อนุมัติ</button>' : '') + '</p>';
    if (canEd) h += '<div class="score-actions"><button class="btn btn-primary" id="mark-rev">' + App.icon('check') + 'ยืนยันผลข้อนี้</button>' + (it.reviewed_at ? '<span class="hint">ยืนยันล่าสุด ' + App.fmtDate(it.reviewed_at, true) + '</span>' : '') +
      (!it.exemption_status || it.exemption_status === 'REJECTED' ? '<button class="link-btn" id="ask-ex">ขอยกเว้นข้อนี้</button>' : '') + '</div>';
    el.innerHTML = h;
    wireScore(it, el);
  }

  function calcView(s, c) {
    if (!s.status || s.status === 'NOT_STARTED') return '<p class="t-muted">ยังไม่มีผล — เลือกผลการตรวจก่อน</p>';
    if (s.status === 'INSUFFICIENT') return '<p class="t-warn"><strong>หลักฐานไม่พอ</strong> — ไม่นับเป็น 0 และไม่นับเป็นผ่าน ต้องเก็บหลักฐานเพิ่มหรือขอยกเว้น</p>';
    var h = '<div class="calc-row"><span>คะแนนเต็ม</span><strong>' + App.num(c.max_points) + '</strong></div>';
    (s.deductions || []).forEach(function (d) { h += '<div class="calc-row"><span>' + esc(d.rule_code) + ' • ' + esc(d.issue_key) + (d.note ? ' <small>(' + esc(d.note) + ')</small>' : '') + '</span><strong class="t-bad">−' + App.num(d.points) + '</strong></div>'; });
    if (s.zero_rule_id) h += '<div class="calc-row"><span>เข้าเงื่อนไข 0 คะแนน</span><strong class="t-bad">0</strong></div>';
    if (s.floor_applied) h += '<div class="calc-row"><span>ปรับต่ำสุดเป็น 0 ตามที่ Admin ยืนยัน</span><strong>0</strong></div>';
    if (s.overridden) h += '<div class="calc-row"><span>ผู้ตรวจแก้จาก ' + App.num(s.override_from) + '</span><strong>' + App.num(s.score) + '</strong></div>';
    h += '<div class="calc-row total"><span>คะแนนข้อนี้</span><strong>' + (s.score == null ? 'ระงับ' : App.num(s.score)) + '</strong></div>';
    if (s.hold_reasons && s.hold_reasons.length) h += '<p class="notice notice-held small">' + esc(s.hold_reasons.join('; ')) + '</p>';
    if (s.evidence && !s.evidence.complete && s.status === 'SCORED') h += '<p class="notice notice-warn small">' + (s.evidence.sample_required != null && s.evidence.sample_collected < s.evidence.sample_required ? 'ตัวอย่างยังไม่ครบ ' + s.evidence.sample_collected + '/' + s.evidence.sample_required : 'ยังไม่มีหลักฐานหรือบันทึก') + ' — ข้อนี้ยังไม่นับว่าครบ</p>';
    return h;
  }

  function wireScore(it, el) {
    if (!editable()) { App.$$('[data-ex]', el).forEach(wireEx(it)); return; }
    var c = W.crit[it.criterion_id];
    App.$$('input[name=f-result]', el).forEach(function (r) { r.onchange = function () { setDraft(it.id, { result: r.value }, true); }; });
    var band = App.$('#f-band', el); if (band) band.onchange = function () { setDraft(it.id, { band_index: band.value === '' ? null : Number(band.value) }, true); renderScore(); renderStd(); };
    var bs = App.$('#f-bscore', el); if (bs) bs.oninput = function () { setDraft(it.id, { band_score: bs.value === '' ? null : Number(bs.value) }); };
    var ov = App.$('#f-ov', el), ovr = App.$('#f-ovr', el);
    ov.oninput = function () { setDraft(it.id, { override_score: ov.value === '' ? null : Number(ov.value) }); };
    ovr.oninput = function () { setDraft(it.id, { override_reason: ovr.value }); };
    var issues = function () { return JSON.parse(JSON.stringify(view(it).issues || [])); };
    var box = App.$('#issues', el);
    if (box) {
      box.addEventListener('input', function (e) {
        var row = e.target.closest('.issue'); if (!row) return;
        var list = issues(), i = Number(row.getAttribute('data-i'));
        var k = e.target.getAttribute('data-k');
        if (k) list[i][k] = e.target.value;
        if (e.target.hasAttribute('data-ev')) { var id = e.target.getAttribute('data-ev'); var set = list[i].evidence_ids || []; list[i].evidence_ids = e.target.checked ? set.concat([id]) : set.filter(function (x) { return x !== id; }); }
        setDraft(it.id, { issues: list }, e.target.tagName === 'SELECT' || e.target.type === 'checkbox');
      });
      App.$$('[data-rm]', box).forEach(function (b) { b.onclick = function () { var list = issues(); list.splice(Number(b.getAttribute('data-rm')), 1); setDraft(it.id, { issues: list }, true); renderScore(); }; });
      var add = App.$('#add-issue', box);
      if (add) add.onclick = function () {
        var rules = W.data.standard.rules.filter(function (r) { return r.criterion_ids.indexOf(c.id) >= 0; });
        var per = rules.filter(function (r) { return r.rule_type === 'PER_OCCURRENCE'; })[0] || rules[0];
        var list = issues(); list.push({ issue_key: 'ปัญหา ' + (list.length + 1), rule_id: per.id, description: '', evidence_ids: [] });
        var v = view(it);
        setDraft(it.id, { issues: list, result: v.result || 'NONCONFORM' }, false);
        renderScore();
        var inputs = App.$$('.issue input[data-k=issue_key]', App.$('#p-score')); if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
      };
    }
    App.$('#mark-rev', el).onclick = function () {
      var v = view(it);
      if (!v.result) { App.toast('เลือกผลการตรวจก่อนยืนยัน', 'error'); return; }
      if (v.override_score != null && !(v.override_reason || '').trim()) { App.toast('แก้คะแนนต้องระบุเหตุผล', 'error'); ovr.focus(); return; }
      setDraft(it.id, { mark_reviewed: true });
      saveNow(it.id).then(function (ok) { if (ok) { App.toast('ยืนยันผลข้อ ' + c.code + ' แล้ว', 'ok'); } });
    };
    var ex = App.$('#ask-ex', el);
    if (ex) ex.onclick = function () {
      App.ask('ขอยกเว้นข้อ ' + c.code, 'เหตุผล (ต้องได้รับอนุมัติจาก Admin ก่อนปิดรอบตรวจ)', { ok: 'ส่งคำขอ' }).then(function (reason) {
        if (!reason) return;
        App.api('apiRequestExemption', it.id, reason).then(function (r) { mergeItem(r.item); applyScore(r.score); renderScore(); App.toast('ส่งคำขอยกเว้นแล้ว', 'ok'); }, App.fail);
      });
    };
    App.$$('[data-ex]', el).forEach(wireEx(it));
  }
  function wireEx(it) {
    return function (b) {
      b.onclick = function () {
        var ok = b.getAttribute('data-ex') === '1';
        App.api('apiDecideExemption', it.id, ok, '').then(function (r) { mergeItem(r.item); applyScore(r.score); renderScore(); renderList(); App.toast(ok ? 'อนุมัติการยกเว้นแล้ว' : 'ไม่อนุมัติการยกเว้น', 'ok'); }, App.fail);
      };
    };
  }

  // ---------- drafts, autosave, offline, conflicts ----------
  function draftKey(id) { return 'cps_draft_' + id; }
  function setDraft(id, patch, immediate) {
    var d = W.drafts[id] = W.drafts[id] || { patch: {}, base_version: item(id).version, ts: Date.now() };
    Object.keys(patch).forEach(function (k) { d.patch[k] = patch[k]; });
    d.ts = Date.now();
    App.store.set(draftKey(id), { audit_id: W.data.audit.id, patch: d.patch, base_version: d.base_version, ts: d.ts });
    W.saving[id] = 'dirty'; renderSave(); markDirty(id);
    if (immediate) saveNow(id); else debouncedSave(id);
  }
  var timers = {};
  function debouncedSave(id) { clearTimeout(timers[id]); timers[id] = setTimeout(function () { saveNow(id); }, 1200); }
  function flush(id) { clearTimeout(timers[id]); return W.drafts[id] ? saveNow(id) : Promise.resolve(true); }
  function flushAll() { Object.keys(W.drafts).forEach(function (id) { flush(id); }); }

  function saveNow(id) {
    clearTimeout(timers[id]);
    var d = W.drafts[id];
    if (!d) { W.saving[id] = 'saved'; renderSave(); return Promise.resolve(true); }
    if (W.saving[id] === 'saving') { return new Promise(function (res) { setTimeout(function () { res(saveNow(id)); }, 400); }); }
    var sentPatch = JSON.parse(JSON.stringify(d.patch)), sentTs = d.ts;
    W.saving[id] = 'saving'; renderSave();
    return App.api('apiSaveItemDraft', id, sentPatch, item(id).version).then(function (r) {
      mergeItem(r.item); applyScore(r.score);
      var cur = W.drafts[id];
      if (cur && cur.ts === sentTs) { delete W.drafts[id]; App.store.del(draftKey(id)); }
      else if (cur) { Object.keys(sentPatch).forEach(function (k) { if (JSON.stringify(cur.patch[k]) === JSON.stringify(sentPatch[k])) delete cur.patch[k]; }); delete cur.patch.mark_reviewed; debouncedSave(id); }
      W.saving[id] = 'saved'; W.savedAt = new Date(); renderSave();
      if (id === W.sel) {
        var sp = App.$('#p-score');
        if (sp && sp.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') { var calc = App.$('.calc', sp); if (calc) calc.innerHTML = calcView(scoreOf(item(id).criterion_id), W.crit[item(id).criterion_id]); }
        else renderScore();
        if (sentPatch.band_index !== undefined || sentPatch.result) renderStd();
      }
      renderList(); renderRoute(); renderHead();
      return true;
    }, function (e) {
      if (e.network) {
        W.saving[id] = 'queued'; renderSave();
        App.Queue.add({ key: 'item:' + id, fn: 'apiSaveItemDraft', args: [id, sentPatch, item(id).version], onDone: 'itemSaved' });
        return false;
      }
      if (e.code === 'CONFLICT') { W.saving[id] = 'conflict'; renderSave(); conflict(id, e); return false; }
      W.saving[id] = 'error'; W.lastError = App.errorText(e); renderSave();
      if (sentPatch.mark_reviewed) { App.fail(e); if (W.drafts[id]) delete W.drafts[id].patch.mark_reviewed; }
      return false;
    });
  }
  App.queueHandlers.itemSaved = function (r, e) {
    var id = e.args[0];
    App.store.del(draftKey(id));
    if (W.data && W.data.items.some(function (i) { return i.id === id; })) { delete W.drafts[id]; mergeItem(r.item); applyScore(r.score); W.saving[id] = 'saved'; renderSave(); renderList(); if (id === W.sel) renderPanes(); }
    App.toast('ส่งข้อมูลที่ค้างไว้ถึงเซิร์ฟเวอร์แล้ว', 'ok');
  };
  App.queueHandlers.failed = function (err, e) {
    if (err.code === 'CONFLICT' && e.fn === 'apiSaveItemDraft' && W.data) { conflict(e.args[0], err); return; }
    App.toast('ส่งข้อมูลที่ค้างไว้ไม่สำเร็จ: ' + App.errorText(err), 'error');
  };

  function conflict(id, e) {
    var cur = e.current || {}, d = W.drafts[id];
    var c = W.crit[item(id).criterion_id];
    var show = function (o) { return '<ul class="plain-list small"><li>ผล: ' + esc((App.STATUS[o.result] || ['–'])[0]) + '</li><li>บันทึก: ' + esc(String(o.auditor_notes || '–').slice(0, 120)) + '</li><li>จำนวนปัญหา: ' + ((o.issues || []).length) + '</li></ul>'; };
    App.dialog({ title: 'ข้อ ' + c.code + ' ถูกแก้ไขจากอุปกรณ์อื่น', body: '<p>มีการบันทึกข้อนี้จากอุปกรณ์อื่นหลังจากที่คุณเปิดหน้านี้ เลือกข้อมูลที่จะใช้</p><div class="cmp"><div><h3>บนเซิร์ฟเวอร์ (ล่าสุด)</h3>' + show(cur) + '</div><div><h3>ของคุณ (ยังไม่บันทึก)</h3>' + show(Object.assign({}, cur, d ? d.patch : {})) + '</div></div>',
      actions: [{ label: 'ใช้ข้อมูลบนเซิร์ฟเวอร์', value: 'server' }, { label: 'บันทึกทับด้วยข้อมูลของฉัน', kind: 'primary', value: 'mine' }] }).then(function (v) {
      mergeItem(cur);
      if (v === 'mine' && d) { d.base_version = cur.version; W.saving[id] = 'dirty'; saveNow(id); }
      else { delete W.drafts[id]; App.store.del(draftKey(id)); W.saving[id] = 'saved'; renderSave(); W.reload(); }
    });
  }

  function restoreLocalDrafts() {
    var restored = 0;
    W.data.items.forEach(function (i) {
      var d = App.store.get(draftKey(i.id));
      if (d && d.audit_id === W.data.audit.id && d.patch) { W.drafts[i.id] = { patch: d.patch, base_version: d.base_version, ts: d.ts }; W.saving[i.id] = 'dirty'; restored++; }
    });
    if (restored) setTimeout(function () { App.toast('พบข้อมูลที่ยังไม่ได้ส่งจากอุปกรณ์นี้ ' + restored + ' ข้อ — กำลังส่ง', 'warn'); Object.keys(W.drafts).forEach(function (id) { saveNow(id); }); }, 300);
  }

  function mergeItem(it) { if (!it) return; W.data.items = W.data.items.map(function (x) { return x.id === it.id ? it : x; }); }
  function applyScore(s) { if (s) W.data.score = s; }
  function markDirty(id) { var b = App.$('[data-item="' + id + '"]'); if (b && !b.querySelector('.cl-dirty')) b.insertAdjacentHTML('beforeend', '<span class="cl-dirty" title="มีข้อมูลที่ยังไม่ถึงเซิร์ฟเวอร์">●</span>'); }

  function renderSave() {
    var el = App.$('#save-state'); if (!el) return;
    var states = Object.keys(W.saving).map(function (k) { return W.saving[k]; });
    var st = states.indexOf('conflict') >= 0 ? 'conflict' : states.indexOf('error') >= 0 ? 'error' : states.indexOf('queued') >= 0 ? 'queued' : states.indexOf('saving') >= 0 ? 'saving' : states.indexOf('dirty') >= 0 ? 'dirty' : 'saved';
    var map = {
      saved: ['ok', W.savedAt ? 'บันทึกแล้ว ' + W.savedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : 'ข้อมูลเป็นปัจจุบัน'],
      dirty: ['info', 'มีการแก้ไข — กำลังรอบันทึก'], saving: ['info', 'กำลังบันทึก…'],
      queued: ['warn', 'บันทึกไม่สำเร็จ — เก็บไว้ในเครื่อง จะส่งเมื่อออนไลน์'], error: ['bad', 'บันทึกไม่สำเร็จ' + (W.lastError ? ': ' + W.lastError : '')], conflict: ['bad', 'ข้อมูลชนกับอุปกรณ์อื่น — เลือกข้อมูลที่จะใช้']
    };
    var m = map[st];
    el.className = 'save-state s-' + m[0];
    el.innerHTML = (st === 'saving' ? '<span class="spinner"></span>' : App.icon(m[0] === 'ok' ? 'check' : m[0] === 'bad' ? 'alert' : 'clock')) + '<span>' + esc(m[1]) + '</span>';
  }

  window.addEventListener('beforeunload', function (e) {
    if (W.data && Object.keys(W.drafts).length && location.hash.indexOf('#/audit/') === 0) { flushAll(); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && W.data) flushAll(); });
})();
