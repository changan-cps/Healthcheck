/* Issue card maker: compose a 1920×1080 "ภาพระบุปัญหา" slide from screenshots, marks and AI-drafted wording. */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;
  var W = 1920, H = 1080;
  var FONT = 'Sarabun, "Noto Sans Thai", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  var C = { bg: '#F4F5F7', red: '#B3121B', ink: '#1D2330', muted: '#5A667A', line: '#E3E5EA', ok: '#1A6B32', okLine: '#1A8A3A', okBg: '#E6F4EA', badBg: '#FFE5E5', card: '#FFFFFF', head: '#1D2330' };
  var MARK = { red: '#E01010', orange: '#FF6A00', blue: '#1F5FBF' };
  var DRAFT_KEY = 'cps_issuecard_draft';

  var S = null; // page state

  function blank() {
    return { section: '', note: '', layout: 'side', title: '', wrongLabel: 'บนบอร์ด ✗', wrong: '', correctLabel: 'ที่ถูกต้อง ✓', correct: '', table: '',
      images: [], marks: [], tool: 'red', numbered: false, busy: false };
  }

  App.route('/issuecard', function () {
    App.setTitle('ภาพระบุปัญหา');
    if (!App.can('audit')) { App.$('#main').innerHTML = App.empty('ไม่มีสิทธิ์ใช้หน้านี้', 'หน้านี้สำหรับผู้ตรวจและ Admin'); return; }
    var keepImages = S ? S.images : [];
    var keepMarks = S ? S.marks : [];
    S = Object.assign(blank(), App.store.get(DRAFT_KEY, {}) || {});
    S.images = keepImages; S.marks = keepMarks; S.busy = false;
    render();
  });

  function saveDraft() {
    App.store.set(DRAFT_KEY, { section: S.section, note: S.note, layout: S.layout, title: S.title, wrongLabel: S.wrongLabel, wrong: S.wrong, correctLabel: S.correctLabel, correct: S.correct, table: S.table });
  }

  // ---------------------------------------------------------------- page
  function render() {
    var aiOn = App.state.md && App.state.md.ai && App.state.md.ai.connected;
    App.$('#main').innerHTML =
      '<div class="ic-page">' +
      '<section class="ic-stage panel" aria-label="ตัวอย่างภาพ">' +
        '<div class="ic-tools" role="toolbar" aria-label="เครื่องมือวาดกรอบ">' +
          '<span class="ic-tools-l">วาดกรอบ:</span>' +
          ['red', 'orange', 'blue'].map(function (k) { return '<button class="ic-color' + (S.tool === k ? ' on' : '') + '" data-color="' + k + '" aria-pressed="' + (S.tool === k) + '" title="กรอบสี' + ({ red: 'แดง', orange: 'ส้ม', blue: 'น้ำเงิน (เส้นประ)' })[k] + '"><span style="background:' + MARK[k] + '"></span></button>'; }).join('') +
          '<label class="check ic-num"><input type="checkbox" id="ic-numbered"' + (S.numbered ? ' checked' : '') + '><span>ใส่หมายเลข</span></label>' +
          '<button class="btn btn-ghost btn-sm" id="ic-undo">ย้อนกลับ</button><button class="btn btn-ghost btn-sm" id="ic-clear-marks">ลบกรอบทั้งหมด</button>' +
        '</div>' +
        '<div class="ic-canvas-wrap" id="ic-drop"><canvas id="ic-canvas" width="' + W + '" height="' + H + '" aria-label="ภาพระบุปัญหา 1920×1080 — ลากบนภาพเพื่อวาดกรอบ"></canvas></div>' +
        '<p class="hint">ลากบนภาพหน้าบอร์ดเพื่อตีกรอบจุดที่เป็นปัญหา · วางภาพได้ด้วย Ctrl+V หรือลากไฟล์มาวาง</p>' +
        '<div class="ic-export"><button class="btn btn-primary" id="ic-download">' + App.icon('download') + 'ดาวน์โหลด PNG</button>' +
          '<button class="btn btn-ghost" id="ic-copy">คัดลอกรูป (วางใน PPT)</button><button class="btn btn-ghost" id="ic-open">เปิดรูปเต็ม</button>' +
          '<button class="link-btn" id="ic-reset">เริ่มภาพใหม่</button></div>' +
      '</section>' +
      '<section class="ic-form panel" aria-label="ข้อมูลภาพ">' +
        '<div class="ic-row"><label class="field"><span>Section / เอกสาร</span><input id="ic-section" placeholder="เช่น QOS-GA Work Plan" value="' + esc(S.section) + '"></label>' +
        '<label class="field"><span>รูปแบบ</span><select id="ic-layout"><option value="side"' + (S.layout === 'side' ? ' selected' : '') + '>ภาพซ้าย · ข้อความขวา</option><option value="top"' + (S.layout === 'top' ? ' selected' : '') + '>ภาพบน · ข้อความล่าง</option></select></label></div>' +
        '<div class="field"><span>ภาพหน้าบอร์ด / เอกสาร (สูงสุด 4)</span><div class="ic-thumbs" id="ic-thumbs"></div>' +
          '<label class="btn btn-ghost ic-add">' + App.icon('upload') + 'เลือกภาพ<input type="file" id="ic-file" accept="image/*" multiple hidden></label></div>' +
        '<label class="field"><span>ปัญหาที่พบ (พิมพ์สั้น ๆ)</span><textarea id="ic-note" rows="3" placeholder="เช่น ข้อมูลที่ยังไม่ถูกติดตามใส่ N/A แทน /">' + esc(S.note) + '</textarea></label>' +
        '<div class="ic-ai"><button class="btn btn-primary" id="ic-ai"' + (aiOn ? '' : ' disabled') + '>' + App.icon('ai') + 'ให้ AI แต่งคำ</button>' +
          '<span id="ic-ai-msg" class="hint">' + (aiOn ? 'AI จะเขียนหัวข้อ สิ่งที่ผิด และที่ถูกต้อง จากบันทึกและภาพ — แก้ไขต่อได้' : 'ยังไม่ได้เชื่อมต่อ AI — พิมพ์ข้อความเองด้านล่างได้') + '</span></div>' +
        '<hr class="ic-hr">' +
        '<label class="field"><span>หัวข้อปัญหา</span><input id="ic-title" value="' + esc(S.title) + '" placeholder="เช่น QOS-GA Work Plan: หัวกระดาษไม่ถูกต้อง"></label>' +
        '<div class="ic-row"><label class="field"><span>หัวการ์ดฝั่งผิด</span><input id="ic-wl" value="' + esc(S.wrongLabel) + '"></label>' +
        '<label class="field"><span>หัวการ์ดฝั่งถูก</span><input id="ic-cl" value="' + esc(S.correctLabel) + '"></label></div>' +
        '<label class="field"><span>สิ่งที่ผิด (1 บรรทัด = 1 ข้อ)</span><textarea id="ic-wrong" rows="3">' + esc(S.wrong) + '</textarea></label>' +
        '<label class="field"><span>ที่ถูกต้อง (1 บรรทัด = 1 ข้อ)</span><textarea id="ic-correct" rows="3">' + esc(S.correct) + '</textarea></label>' +
        '<label class="field"><span>ตารางเทียบ (ไม่บังคับ · คั่นช่องด้วย | · บรรทัดแรกเป็นหัวตาราง)</span><textarea id="ic-table" rows="3" placeholder="รายการ | Scorecard | A3 Report&#10;Target 2026 | 60% | 90%">' + esc(S.table) + '</textarea></label>' +
      '</section></div>';
    bind();
    renderThumbs();
    ensureFonts().then(draw);
  }

  function bind() {
    var fields = { 'ic-section': 'section', 'ic-note': 'note', 'ic-title': 'title', 'ic-wl': 'wrongLabel', 'ic-cl': 'correctLabel', 'ic-wrong': 'wrong', 'ic-correct': 'correct', 'ic-table': 'table' };
    var redraw = App.debounce(function () { draw(); saveDraft(); }, 150);
    Object.keys(fields).forEach(function (id) { App.$('#' + id).addEventListener('input', function () { S[fields[id]] = this.value; redraw(); }); });
    App.$('#ic-layout').onchange = function () { S.layout = this.value; draw(); saveDraft(); };
    App.$$('.ic-color').forEach(function (b) { b.onclick = function () { S.tool = b.getAttribute('data-color'); App.$$('.ic-color').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); }; });
    App.$('#ic-numbered').onchange = function () { S.numbered = this.checked; };
    App.$('#ic-undo').onclick = function () { S.marks.pop(); draw(); };
    App.$('#ic-clear-marks').onclick = function () { S.marks = []; draw(); };
    App.$('#ic-file').onchange = function () { addFiles(this.files); this.value = ''; };
    App.$('#ic-ai').onclick = compose;
    App.$('#ic-download').onclick = download;
    App.$('#ic-copy').onclick = copyImage;
    App.$('#ic-open').onclick = openFull;
    App.$('#ic-reset').onclick = function () {
      App.dialog({ title: 'เริ่มภาพใหม่?', body: '<p>ภาพ กรอบ และข้อความทั้งหมดในหน้านี้จะถูกล้าง</p>', actions: [{ label: 'ยกเลิก', value: false }, { label: 'ล้างและเริ่มใหม่', kind: 'danger', value: true }] })
        .then(function (v) { if (!v) return; S.images.forEach(function (im) { URL.revokeObjectURL(im.url); }); var t = S.tool; S = blank(); S.tool = t; App.store.del(DRAFT_KEY); render(); });
    };
    var drop = App.$('#ic-drop');
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('drag'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
    bindDrawing(App.$('#ic-canvas'));
  }

  // paste images anywhere on this page (but let text fields paste text)
  document.addEventListener('paste', function (e) {
    if (!S || !App.$('#ic-canvas')) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    var files = [];
    for (var i = 0; i < items.length; i++) if (items[i].kind === 'file' && /^image\//.test(items[i].type)) files.push(items[i].getAsFile());
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });

  // ---------------------------------------------------------------- images
  function addFiles(list) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return f && /^image\//.test(f.type); });
    if (!files.length) { App.toast('เลือกไฟล์รูปภาพ (PNG / JPG)', 'error'); return; }
    var room = 4 - S.images.length;
    if (room <= 0) { App.toast('ใส่ภาพได้สูงสุด 4 ภาพ — ลบภาพเดิมก่อน', 'error'); return; }
    if (files.length > room) App.toast('ใส่ได้อีก ' + room + ' ภาพ ระบบใช้ ' + room + ' ภาพแรก', 'info');
    Promise.all(files.slice(0, room).map(loadImage)).then(function (imgs) {
      imgs.forEach(function (im) { if (im) S.images.push(im); });
      renderThumbs(); draw();
    });
  }
  function loadImage(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ id: App.uid(), url: url, el: img, label: '', w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); App.toast('เปิดภาพ ' + (file.name || '') + ' ไม่ได้', 'error'); resolve(null); };
      img.src = url;
    });
  }
  function renderThumbs() {
    var box = App.$('#ic-thumbs'); if (!box) return;
    box.innerHTML = S.images.length ? S.images.map(function (im, i) {
      return '<div class="ic-thumb"><img src="' + im.url + '" alt="ภาพที่ ' + (i + 1) + '"><input data-i="' + i + '" class="ic-lbl" placeholder="ชื่อภาพ เช่น Scorecard" value="' + esc(im.label) + '" aria-label="ชื่อภาพที่ ' + (i + 1) + '">' +
        '<div class="ic-thumb-act">' + (i > 0 ? '<button class="icon-btn" data-up="' + i + '" aria-label="เลื่อนขึ้น">' + App.icon('chevl') + '</button>' : '') +
        '<button class="icon-btn" data-del="' + i + '" aria-label="ลบภาพที่ ' + (i + 1) + '">' + App.icon('trash') + '</button></div></div>';
    }).join('') : '<p class="hint">ยังไม่มีภาพ — กด “เลือกภาพ”, วางด้วย Ctrl+V หรือลากไฟล์มาวางบนตัวอย่าง</p>';
    App.$$('.ic-lbl', box).forEach(function (inp) { inp.oninput = App.debounce(function () { S.images[+inp.getAttribute('data-i')].label = inp.value; draw(); }, 150); });
    App.$$('[data-del]', box).forEach(function (b) { b.onclick = function () {
      var i = +b.getAttribute('data-del'); var im = S.images.splice(i, 1)[0]; URL.revokeObjectURL(im.url);
      S.marks = S.marks.filter(function (m) { return m.img !== im.id; }); renderThumbs(); draw(); }; });
    App.$$('[data-up]', box).forEach(function (b) { b.onclick = function () { var i = +b.getAttribute('data-up'); var t = S.images[i]; S.images[i] = S.images[i - 1]; S.images[i - 1] = t; renderThumbs(); draw(); }; });
  }

  // ---------------------------------------------------------------- AI
  function toJpegBase64(im) {
    var max = 1600, s = Math.min(1, max / Math.max(im.w, im.h));
    var c = document.createElement('canvas'); c.width = Math.round(im.w * s); c.height = Math.round(im.h * s);
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im.el, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
  function compose() {
    if (S.busy) return;
    if (!S.note.trim()) { App.toast('พิมพ์ปัญหาที่พบสั้น ๆ ก่อน', 'error'); App.$('#ic-note').focus(); return; }
    var btn = App.$('#ic-ai'), msg = App.$('#ic-ai-msg');
    S.busy = true; btn.disabled = true; msg.textContent = 'AI กำลังแต่งคำ…';
    var imgs = S.images.map(function (im) { return { mime: 'image/jpeg', data: toJpegBase64(im) }; });
    App.api('apiComposeIssueCard', { section: S.section, note: S.note, images: imgs }).then(function (d) {
      S.title = d.title; S.wrongLabel = d.wrong_label || S.wrongLabel; S.wrong = d.wrong_points.join('\n'); S.correct = d.correct_points.join('\n');
      S.table = d.table ? [d.table.columns].concat(d.table.rows).map(function (r) { return r.join(' | '); }).join('\n') : '';
      ['title', 'wrong', 'correct', 'table'].forEach(function (k) { var el = App.$('#ic-' + k); if (el) el.value = S[k]; });
      App.$('#ic-wl').value = S.wrongLabel;
      msg.textContent = 'AI แต่งคำแล้ว — ตรวจตัวเลขกับภาพจริงก่อนใช้';
      draw(); saveDraft();
    }, function (e) { msg.textContent = App.errorText(e); }).then(function () { S.busy = false; btn.disabled = false; });
  }

  // ---------------------------------------------------------------- drawing marks
  var layoutCache = null;
  function bindDrawing(cv) {
    var start = null, live = null;
    function pt(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
    function hit(p) { return (layoutCache ? layoutCache.imgs : []).filter(function (b) { return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h; })[0]; }
    cv.addEventListener('pointerdown', function (e) {
      var p = pt(e), b = hit(p); if (!b) return;
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      start = { p: p, b: b }; live = null;
    });
    cv.addEventListener('pointermove', function (e) {
      if (!start) return;
      var p = pt(e), b = start.b;
      var x1 = clamp(Math.min(start.p.x, p.x), b.x, b.x + b.w), x2 = clamp(Math.max(start.p.x, p.x), b.x, b.x + b.w);
      var y1 = clamp(Math.min(start.p.y, p.y), b.y, b.y + b.h), y2 = clamp(Math.max(start.p.y, p.y), b.y, b.y + b.h);
      live = { img: b.id, x: (x1 - b.x) / b.w, y: (y1 - b.y) / b.h, w: (x2 - x1) / b.w, h: (y2 - y1) / b.h, color: S.tool, n: null };
      draw(live);
    });
    function end() {
      if (start && live && live.w * start.b.w > 10 && live.h * start.b.h > 10) {
        if (S.numbered) live.n = S.marks.filter(function (m) { return m.n; }).length + 1;
        S.marks.push(live);
      }
      start = null; live = null; draw();
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', function () { start = null; live = null; draw(); });
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------------------------------------------------------------- canvas render
  function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(['700 40px Sarabun', '600 30px Sarabun', '400 30px Sarabun'].map(function (f) { return document.fonts.load(f, 'ภาพ'); })).catch(function () {});
  }
  function lines(s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function parseTable(s) {
    var rows = lines(s).map(function (l) { return l.split('|').map(function (c) { return c.trim(); }); });
    if (rows.length < 2) return null;
    var n = rows[0].length;
    return n >= 2 ? rows.map(function (r) { while (r.length < n) r.push(''); return r.slice(0, n); }) : null;
  }
  var seg = (window.Intl && Intl.Segmenter) ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  function tokens(text) {
    if (seg) return Array.from(seg.segment(text), function (s) { return s.segment; });
    return text.split(/(\s+)/);
  }
  function wrap(ctx, text, maxW) {
    var out = [], cur = '';
    tokens(text).forEach(function (t) {
      var next = cur + t;
      if (ctx.measureText(next).width <= maxW || !cur) { cur = next; return; }
      out.push(cur.replace(/\s+$/, '')); cur = t.replace(/^\s+/, '');
      while (ctx.measureText(cur).width > maxW && cur.length > 1) { // a single token longer than the line
        var k = cur.length; while (k > 1 && ctx.measureText(cur.slice(0, k)).width > maxW) k--;
        out.push(cur.slice(0, k)); cur = cur.slice(k);
      }
    });
    if (cur) out.push(cur);
    return out;
  }
  function font(size, weight) { return (weight || 400) + ' ' + size + 'px ' + FONT; }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function card(ctx, x, y, w, h, stroke) {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.08)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    rrect(ctx, x, y, w, h, 12); ctx.fillStyle = C.card; ctx.fill(); ctx.restore();
    if (stroke) { rrect(ctx, x + 2, y + 2, w - 4, h - 4, 11); ctx.lineWidth = 4; ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  /** Text card: label + bullet lines, font shrinks until it fits. */
  function textCard(ctx, box, label, items, color) {
    card(ctx, box.x, box.y, box.w, box.h, color);
    var pad = 26, iw = box.w - pad * 2;
    for (var s = 40; s >= 16; s -= 2) {
      ctx.font = font(s, 700); var lh = Math.round(s * 1.45);
      var blocks = [{ lines: wrap(ctx, label, iw), size: s * 1.05, weight: 800, color: color }];
      ctx.font = font(s * 0.9, 600);
      items.forEach(function (t) { blocks.push({ lines: wrap(ctx, t, iw - s), size: s * 0.9, weight: 600, color: C.ink, bullet: true }); });
      var total = 0; blocks.forEach(function (b, i) { total += b.lines.length * Math.round(b.size * 1.45) + (i ? s * 0.35 : s * 0.25); });
      if (total <= box.h - pad * 2 || s === 16) {
        var y = box.y + Math.max(pad, (box.h - total) / 2);
        ctx.textBaseline = 'top';
        blocks.forEach(function (b, i) {
          y += i ? s * 0.35 : 0;
          ctx.font = font(b.size, b.weight); ctx.fillStyle = b.color;
          b.lines.forEach(function (l, k) {
            if (b.bullet && k === 0) { ctx.fillStyle = color; ctx.fillText('•', box.x + pad, y); ctx.fillStyle = b.color; }
            ctx.fillText(l, box.x + pad + (b.bullet ? s : 0), y); y += Math.round(b.size * 1.45);
          });
          if (!i) y += s * 0.25;
        });
        return;
      }
    }
  }

  function tableCard(ctx, box, rows) {
    card(ctx, box.x, box.y, box.w, box.h, null);
    var pad = 16, iw = box.w - pad * 2, n = rows[0].length, cellPad = 28;
    for (var s = 44; s >= 14; s -= 2) {
      var rowH = Math.round(s * 1.9), total = rowH * rows.length;
      // column widths follow the widest text in each column at this size
      var need = rows[0].map(function (_, ci) {
        return Math.max.apply(null, rows.map(function (r, ri) { ctx.font = font(ri === 0 ? s * 0.85 : s, ri === 0 || ci === 0 ? 700 : 800); return ctx.measureText(r[ci]).width; })) + cellPad;
      });
      var sum = need.reduce(function (a, b) { return a + b; }, 0);
      if ((sum > iw || total > box.h - pad * 2) && s > 14) continue;
      var extra = (iw - sum) / n, colW = function (i) { return need[i] + extra; };
      var y = box.y + (box.h - total) / 2;
      ctx.textBaseline = 'middle';
      rows.forEach(function (r, ri) {
        var x = box.x + pad;
        if (ri === 0) { ctx.fillStyle = C.head; ctx.fillRect(x, y, iw, rowH); }
        var differs = ri > 0 && n > 2 && r.slice(1).some(function (o) { return o !== r[1]; });
        r.forEach(function (c, ci) {
          var w = colW(ci), diff = differs && ci > 0;
          if (diff) { ctx.fillStyle = C.badBg; ctx.fillRect(x, y, w, rowH); }
          ctx.font = font(ri === 0 ? s * 0.85 : s, ri === 0 || ci === 0 ? 700 : 800);
          ctx.fillStyle = ri === 0 ? '#fff' : (diff ? C.red : C.ink);
          ctx.textAlign = ci === 0 ? 'left' : 'center';
          var t = c; while (ctx.measureText(t).width > w - 12 && t.length > 1) t = t.slice(0, -1);
          ctx.fillText(t, ci === 0 ? x + 12 : x + w / 2, y + rowH / 2);
          x += w;
        });
        ctx.textAlign = 'left';
        if (ri > 0) { ctx.fillStyle = C.line; ctx.fillRect(box.x + pad, y + rowH - 2, iw, 2); }
        y += rowH;
      });
      return;
    }
  }

  /** Fit images into a region (stacked vertically or in a row); returns placed rects. */
  function placeImages(ctx, region, dir) {
    var imgs = S.images, out = [];
    if (!imgs.length) {
      card(ctx, region.x, region.y, region.w, region.h, null);
      ctx.save(); ctx.setLineDash([14, 10]); ctx.lineWidth = 3; ctx.strokeStyle = '#B9C2D0'; rrect(ctx, region.x + 30, region.y + 30, region.w - 60, region.h - 60, 12); ctx.stroke(); ctx.restore();
      ctx.fillStyle = C.muted; ctx.font = font(36, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('วางภาพหน้าบอร์ดที่นี่', region.x + region.w / 2, region.y + region.h / 2 - 26);
      ctx.font = font(26, 400); ctx.fillText('Ctrl+V · ลากไฟล์มาวาง · ปุ่ม “เลือกภาพ”', region.x + region.w / 2, region.y + region.h / 2 + 26);
      ctx.textAlign = 'left';
      return out;
    }
    var gap = 16, n = imgs.length, pad = 12;
    var cells = imgs.map(function (im, i) {
      var cw = dir === 'row' ? (region.w - gap * (n - 1)) / n : region.w;
      var ch = dir === 'row' ? region.h : (region.h - gap * (n - 1)) / n;
      var cx = dir === 'row' ? region.x + i * (cw + gap) : region.x;
      var cy = dir === 'row' ? region.y : region.y + i * (ch + gap);
      return { x: cx, y: cy, w: cw, h: ch, im: im };
    });
    // vertical stacks: share height by aspect so wide strips don't waste space
    if (dir !== 'row' && n > 1) {
      var labelH = function (im) { return im.label ? 40 : 0; };
      var need = imgs.map(function (im) { return (region.w - pad * 2) * im.h / im.w + labelH(im) + pad * 2; });
      var sum = need.reduce(function (a, b) { return a + b; }, 0), avail = region.h - gap * (n - 1);
      var k = Math.min(1, avail / sum), y = region.y;
      cells = imgs.map(function (im, i) { var h = need[i] * k; var c = { x: region.x, y: y, w: region.w, h: h, im: im }; y += h + gap; return c; });
      var used = y - gap - region.y; if (used < region.h) cells.forEach(function (c) { c.y += (region.h - used) / 2; });
    }
    cells.forEach(function (c) {
      var lh = c.im.label ? 40 : 0;
      var aw = c.w - pad * 2, ah = c.h - pad * 2 - lh;
      var sc = Math.min(aw / c.im.w, ah / c.im.h);
      var w = c.im.w * sc, h = c.im.h * sc;
      var cw = Math.min(c.w, w + pad * 2), ch = h + pad * 2 + lh;
      var cx = dir === 'row' ? c.x + (c.w - cw) / 2 : c.x, cy = c.y + (c.h - ch) / 2;
      card(ctx, cx, cy, cw, ch, null);
      if (lh) { ctx.font = font(26, 700); ctx.fillStyle = C.ink; ctx.textBaseline = 'top'; ctx.fillText(c.im.label, cx + pad, cy + pad); }
      var ix = cx + pad, iy = cy + pad + lh;
      ctx.drawImage(c.im.el, ix, iy, w, h);
      ctx.strokeStyle = '#DDD'; ctx.lineWidth = 1; ctx.strokeRect(ix, iy, w, h);
      out.push({ id: c.im.id, x: ix, y: iy, w: w, h: h, right: cx + cw });
    });
    return out;
  }

  function drawMarks(ctx, rects, extra) {
    var byId = {}; rects.forEach(function (r) { byId[r.id] = r; });
    S.marks.concat(extra ? [extra] : []).forEach(function (m) {
      var b = byId[m.img]; if (!b) return;
      var x = b.x + m.x * b.w, y = b.y + m.y * b.h, w = m.w * b.w, h = m.h * b.h;
      var col = MARK[m.color] || MARK.red;
      ctx.save();
      ctx.fillStyle = col; ctx.globalAlpha = 0.13; rrect(ctx, x, y, w, h, 6); ctx.fill(); ctx.globalAlpha = 1;
      if (m.color === 'blue') ctx.setLineDash([14, 8]);
      ctx.lineWidth = 5; ctx.strokeStyle = col; rrect(ctx, x, y, w, h, 6); ctx.stroke();
      ctx.restore();
      if (m.n) {
        var r = 22, cx = Math.min(x + w + r + 4, b.x + b.w + r), cy = Math.max(y, b.y + r);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = font(26, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(m.n), cx, cy + 1); ctx.textAlign = 'left';
      }
    });
  }

  function draw(liveMark) {
    var cv = App.$('#ic-canvas'); if (!cv) return;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    // header
    rrect(ctx, 32, 22, W - 64, 86, 12); ctx.fillStyle = C.red; ctx.fill();
    ctx.font = font(30, 800); var tagW = ctx.measureText('ปัญหา').width + 36;
    rrect(ctx, 58, 38, tagW, 54, 8); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = C.red; ctx.textBaseline = 'middle'; ctx.fillText('ปัญหา', 76, 66);
    var title = S.title || (S.section ? S.section + ': ' : '') + 'หัวข้อปัญหา';
    var maxT = W - 64 - tagW - 70, ts = 40;
    ctx.font = font(ts, 800); while (ctx.measureText(title).width > maxT && ts > 22) { ts -= 2; ctx.font = font(ts, 800); }
    ctx.fillStyle = S.title ? '#fff' : 'rgba(255,255,255,.6)';
    ctx.fillText(title, 58 + tagW + 22, 66);

    var top = 128, bottom = H - 22, left = 32, right = W - 32, gap = 20;
    var wrong = lines(S.wrong), correct = lines(S.correct), table = parseTable(S.table);
    var cards = [];
    if (table) cards.push({ kind: 'table' });
    if (wrong.length) cards.push({ kind: 'wrong' });
    if (correct.length) cards.push({ kind: 'correct' });
    if (!cards.length) cards.push({ kind: 'wrong' }, { kind: 'correct' });
    var imgRegion, cardRegion;
    if (S.layout === 'top') {
      var ch = table ? 330 : 300;
      imgRegion = { x: left, y: top, w: right - left, h: bottom - top - ch - gap };
      cardRegion = { x: left, y: bottom - ch, w: right - left, h: ch };
    } else {
      var cw = 600;
      imgRegion = { x: left, y: top, w: right - left - cw - gap, h: bottom - top };
      cardRegion = { x: right - cw, y: top, w: cw, h: bottom - top };
    }
    var rects = placeImages(ctx, imgRegion, S.layout === 'top' ? 'row' : 'col');
    if (S.layout !== 'top' && rects.length) { // give the text column whatever width the images leave free
      var used = Math.max.apply(null, rects.map(function (r) { return r.right; }));
      cardRegion.x = used + gap; cardRegion.w = right - cardRegion.x;
    }
    layoutCache = { imgs: rects };
    drawMarks(ctx, rects, liveMark);

    // cards
    var n = cards.length, horiz = S.layout === 'top';
    var weights = cards.map(function (c) { return c.kind === 'table' ? (table.length + 0.6) : (c.kind === 'wrong' ? Math.max(2, wrong.length + 1) : Math.max(2, correct.length + 1)); });
    var wsum = weights.reduce(function (a, b) { return a + b; }, 0);
    var space = (horiz ? cardRegion.w : cardRegion.h) - gap * (n - 1), pos = horiz ? cardRegion.x : cardRegion.y;
    cards.forEach(function (c, i) {
      var len = horiz ? space / n : space * weights[i] / wsum;
      var box = horiz ? { x: pos, y: cardRegion.y, w: len, h: cardRegion.h } : { x: cardRegion.x, y: pos, w: cardRegion.w, h: len };
      if (c.kind === 'table') tableCard(ctx, box, table);
      else if (c.kind === 'wrong') textCard(ctx, box, S.wrongLabel || 'บนบอร์ด ✗', wrong.length ? wrong : ['(พิมพ์สิ่งที่ผิด)'], C.red);
      else textCard(ctx, box, S.correctLabel || 'ที่ถูกต้อง ✓', correct.length ? correct : ['(พิมพ์สิ่งที่ถูกต้อง)'], C.ok);
      pos += len + gap;
    });
  }

  // ---------------------------------------------------------------- export
  function fileName() {
    var base = (S.title || S.section || 'issue').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '_').slice(0, 60);
    return base + '_' + App.today() + '.png';
  }
  function pngBlob() { return new Promise(function (res) { draw(); App.$('#ic-canvas').toBlob(res, 'image/png'); }); }
  function download() {
    pngBlob().then(function (blob) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      App.toast('ดาวน์โหลด ' + a.download + ' — ถ้าไม่มีไฟล์ ให้กด “เปิดรูปเต็ม” แล้วกดค้าง/คลิกขวาเพื่อบันทึก', 'ok', 7000);
    });
  }
  function copyImage() {
    if (!navigator.clipboard || !window.ClipboardItem) { App.toast('เบราว์เซอร์นี้คัดลอกรูปไม่ได้ — ใช้ “ดาวน์โหลด PNG” แทน', 'error'); return; }
    navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]).then(function () { App.toast('คัดลอกรูปแล้ว — วางใน PowerPoint ได้เลย', 'ok'); },
      function () { App.toast('คัดลอกรูปไม่ได้ในหน้านี้ — ใช้ “ดาวน์โหลด PNG” หรือ “เปิดรูปเต็ม”', 'error'); });
  }
  function openFull() {
    draw();
    var url = App.$('#ic-canvas').toDataURL('image/png');
    App.dialog({ title: 'ภาพเต็ม 1920×1080', body: '<p class="hint">คลิกขวา (คอมพิวเตอร์) หรือกดค้าง (มือถือ/แท็บเล็ต) ที่รูปเพื่อบันทึกหรือคัดลอก</p><img class="ic-full" src="' + url + '" alt="ภาพระบุปัญหา">', actions: [{ label: 'ปิด' }] });
  }
})();
