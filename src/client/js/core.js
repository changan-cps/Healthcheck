/* CPS AI Audit — client core: state, server calls, offline queue, router, UI helpers. */
(function () {
  'use strict';
  var App = window.App = { state: { token: null, user: null, md: null, online: navigator.onLine }, views: {} };

  // ---------- helpers ----------
  var esc = App.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  App.nl2br = function (s) { return esc(s).replace(/\n/g, '<br>'); };
  App.$ = function (sel, root) { return (root || document).querySelector(sel); };
  App.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  App.fmtDate = function (iso, withTime) {
    if (!iso) return '–';
    var d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    var o = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' };
    if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleString('th-TH', o);
  };
  App.fmtTime = function (sec) { sec = Math.max(0, Math.round(sec || 0)); var m = Math.floor(sec / 60), s = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; };
  App.num = function (x, d) { return x == null || x === '' ? '–' : Number(x).toLocaleString('th-TH', { maximumFractionDigits: d == null ? 2 : d }); };
  App.lang = function (o, prefer) {
    if (!o) return '';
    if (typeof o === 'string') return o;
    var p = prefer || 'th';
    return o[p] || o.th || o.zh || o.en || o.raw || '';
  };
  App.firstLine = function (s) { return String(s || '').split('\n')[0]; };
  App.today = function () { var d = new Date(Date.now() + 7 * 3600000); return d.toISOString().slice(0, 10); };
  App.debounce = function (fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; };
  App.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); };
  App.store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  // ---------- server calls ----------
  function rawCall(fn, args) {
    return new Promise(function (resolve, reject) {
      if (!window.google || !google.script || !google.script.run) { reject({ code: 'NO_RUNTIME', message: 'ไม่พบการเชื่อมต่อเซิร์ฟเวอร์ (เปิดผ่าน URL ของ Web App)' }); return; }
      var runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(function (e) {
        reject({ code: 'NETWORK', message: (e && e.message) || 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', network: true });
      });
      runner[fn].apply(runner, args);
    });
  }
  /** Call an API with the session token. Resolves data or rejects {code,message}. */
  App.api = function (fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return rawCall(fn, [App.state.token].concat(args)).then(function (res) {
      if (res && res.ok) return res.data;
      var err = (res && res.error) || { code: 'ERROR', message: 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ' };
      if (err.code === 'AUTH' && fn !== 'apiLogin') { App.logout(err.message); }
      throw err;
    }, function (e) {
      if (e.network) setOnline(false);
      throw e;
    });
  };
  App.rawCall = rawCall;

  // ---------- connectivity ----------
  function setOnline(v) {
    if (App.state.online === v) return;
    App.state.online = v;
    App.renderConn();
    if (v) App.Queue.flush();
  }
  window.addEventListener('online', function () { setOnline(true); });
  window.addEventListener('offline', function () { setOnline(false); });
  App.setOnline = setOnline;

  // ---------- offline queue (IndexedDB, falls back to memory) ----------
  App.Queue = (function () {
    var DB = 'cps-ai-audit', STORE = 'queue', mem = [], dbp = null, flushing = false;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res) {
        try {
          var r = indexedDB.open(DB, 1);
          r.onupgradeneeded = function () { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        if (!db) return fn(null);
        return new Promise(function (res, rej) {
          var t = db.transaction(STORE, mode); var st = t.objectStore(STORE); var out = fn(st);
          t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { rej(t.error); };
        });
      });
    }
    function all() { return tx('readonly', function (st) { if (!st) return mem.slice(); return st.getAll(); }).then(function (r) { return (r || []).sort(function (a, b) { return a.ts - b.ts; }); }); }
    function put(entry) { return tx('readwrite', function (st) { if (!st) { mem = mem.filter(function (m) { return m.id !== entry.id; }).concat([entry]); return; } st.put(entry); }); }
    function del(id) { return tx('readwrite', function (st) { if (!st) { mem = mem.filter(function (m) { return m.id !== id; }); return; } st.delete(id); }); }
    /** Add a call to the queue. For item drafts, the newest entry per item replaces older ones. */
    function add(entry) {
      entry.ts = Date.now();
      entry.id = entry.key || entry.id || App.uid();
      return put(entry).then(App.renderConn);
    }
    function flush() {
      if (flushing || !App.state.online || !App.state.token) return Promise.resolve();
      flushing = true;
      return all().then(function (list) {
        var chain = Promise.resolve();
        list.forEach(function (e) {
          chain = chain.then(function () {
            return App.api.apply(null, [e.fn].concat(e.args)).then(function (data) {
              return del(e.id).then(function () { if (e.onDone && App.queueHandlers[e.onDone]) App.queueHandlers[e.onDone](data, e); });
            }, function (err) {
              if (err.network) throw err; // stop; still offline
              return del(e.id).then(function () { if (App.queueHandlers.failed) App.queueHandlers.failed(err, e); });
            });
          });
        });
        return chain;
      }).catch(function () { /* still offline */ }).then(function () { flushing = false; App.renderConn(); });
    }
    function count() { return all().then(function (l) { return l.length; }); }
    setInterval(function () { if (App.state.online) flush(); }, 20000);
    return { add: add, flush: flush, count: count, all: all, del: del };
  })();
  App.queueHandlers = {};

  // ---------- toasts / dialogs ----------
  App.toast = function (msg, kind, ms) {
    var box = App.$('#toasts');
    var el = document.createElement('div');
    el.className = 'toast toast-' + (kind || 'info');
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span>' + esc(msg) + '</span><button class="toast-x" aria-label="ปิดข้อความ">' + App.icon('x') + '</button>';
    el.querySelector('button').onclick = function () { el.remove(); };
    box.appendChild(el);
    while (box.children.length > 2) box.removeChild(box.firstChild);
    setTimeout(function () { el.remove(); }, ms || (kind === 'error' ? 9000 : 4000));
  };
  App.errorText = function (e) {
    if (!e) return 'เกิดข้อผิดพลาด';
    var hints = { NETWORK: ' — ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่', BUSY: '', CONFLICT: '', AI_NOT_CONNECTED: '', FORBIDDEN: ' — ติดต่อ Admin หากต้องการสิทธิ์เพิ่ม' };
    return (e.message || String(e)) + (hints[e.code] || '');
  };
  App.fail = function (e) { App.toast(App.errorText(e), 'error'); if (e && e.details) App.dialog({ title: e.message, body: '<ul class="plain-list">' + e.details.map(function (d) { return '<li>' + esc(typeof d === 'string' ? d : (d.code ? d.code + ': ' : '') + d.reason) + '</li>'; }).join('') + '</ul>', actions: [{ label: 'ปิด' }] }); };

  /** Modal dialog. actions: [{label, kind, value, onClick}] → resolves value */
  App.dialog = function (o) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mdl-t"><div class="modal-head"><h2 id="mdl-t">' + esc(o.title || '') + '</h2>' +
        '<button class="icon-btn" data-x aria-label="ปิด">' + App.icon('x') + '</button></div><div class="modal-body">' + (o.body || '') + '</div><div class="modal-foot"></div></div>';
      var foot = wrap.querySelector('.modal-foot');
      var prev = document.activeElement;
      function close(v) { wrap.remove(); if (prev && prev.focus) prev.focus(); resolve(v); }
      (o.actions || [{ label: 'ปิด' }]).forEach(function (a) {
        var b = document.createElement('button');
        b.className = 'btn ' + (a.kind ? 'btn-' + a.kind : 'btn-ghost');
        b.textContent = a.label;
        b.onclick = function () {
          if (a.onClick) { var r = a.onClick(wrap); if (r === false) return; }
          close(a.value === undefined ? a.label : a.value);
        };
        foot.appendChild(b);
      });
      wrap.querySelector('[data-x]').onclick = function () { close(null); };
      wrap.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(null); });
      document.body.appendChild(wrap);
      if (o.onOpen) o.onOpen(wrap);
      var f = wrap.querySelector('[autofocus]') || wrap.querySelector('input,select,textarea,button.btn-primary') || wrap.querySelector('button');
      if (f) f.focus();
    });
  };
  App.confirm = function (title, body, okLabel, kind) {
    return App.dialog({ title: title, body: '<p>' + body + '</p>', actions: [{ label: 'ยกเลิก', value: false }, { label: okLabel || 'ยืนยัน', kind: kind || 'primary', value: true }] });
  };
  App.ask = function (title, label, opts) {
    opts = opts || {};
    var val = null;
    return App.dialog({ title: title, body: '<label class="field"><span>' + esc(label) + '</span><textarea id="dlg-in" rows="3" autofocus>' + esc(opts.value || '') + '</textarea></label>' + (opts.hint ? '<p class="hint">' + esc(opts.hint) + '</p>' : ''),
      actions: [{ label: 'ยกเลิก', value: false }, { label: opts.ok || 'บันทึก', kind: opts.kind || 'primary', value: true, onClick: function (w) {
        var v = w.querySelector('#dlg-in').value.trim();
        if (opts.required !== false && !v) { var t = w.querySelector('#dlg-in'); t.setAttribute('aria-invalid', 'true'); t.focus(); return false; }
        val = v;
      } }] }).then(function (ok) { return ok ? val : null; });
  };

  App.download = function (file) {
    var bin = atob(file.base64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([arr], { type: file.mime_type }));
    var a = document.createElement('a'); a.href = url; a.download = file.file_name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  };

  // ---------- status chips ----------
  var STATUS = {
    DRAFT: ['ร่าง', 'neutral'], IN_PROGRESS: ['กำลังตรวจ', 'info'], CONFIRMED: ['ยืนยันแล้ว', 'ok'], CANCELLED: ['ยกเลิก', 'neutral'],
    PUBLISHED: ['ประกาศใช้', 'ok'], RETIRED: ['เลิกใช้', 'neutral'],
    OPEN: ['เปิด', 'bad'], FIXED_PENDING_VERIFY: ['แก้ไขแล้ว รอตรวจยืนยัน', 'warn'], CLOSED: ['ปิดแล้ว', 'ok'],
    SCORED: ['ให้คะแนนแล้ว', 'ok'], NOT_STARTED: ['ยังไม่ตรวจ', 'neutral'], INSUFFICIENT: ['หลักฐานไม่พอ', 'warn'], HELD: ['ระงับ — ต้องตรวจทาน', 'held'],
    PENDING_SCORE: ['รอเลือกคะแนน', 'warn'], EXEMPT: ['ยกเว้นแล้ว', 'neutral'], OUT_OF_SCOPE: ['ไม่อยู่ในขอบเขต', 'neutral'],
    CONFORM: ['สอดคล้อง', 'ok'], NONCONFORM: ['ไม่สอดคล้อง', 'bad'],
    SUCCEEDED: ['วิเคราะห์สำเร็จ', 'ok'], FAILED: ['ล้มเหลว', 'bad'], INVALID_OUTPUT: ['ผลไม่ผ่านการตรวจสอบ', 'bad'], RUNNING: ['กำลังวิเคราะห์', 'info'],
    READY: ['พร้อมยืนยัน', 'ok'], PROVISIONAL: ['ชั่วคราว', 'warn'], FINAL: ['คะแนนสุดท้าย', 'ok'],
    CANDIDATE: ['รอผู้ตรวจยืนยัน', 'warn'], REJECTED: ['ไม่ใช่ Red Line', 'neutral']
  };
  App.STATUS = STATUS;
  App.chip = function (code, text) {
    var s = STATUS[code] || [text || code, 'neutral'];
    return '<span class="chip chip-' + s[1] + '">' + App.icon(s[1] === 'ok' ? 'check' : s[1] === 'bad' ? 'alert' : s[1] === 'warn' ? 'clock' : s[1] === 'held' ? 'pause' : 'dot', 'chip-ic') + esc(text || s[0]) + '</span>';
  };
  App.typeLabel = { TEAM: 'ระดับทีม (班长)', GROUP: 'ระดับกลุ่ม (区长)', KUP: 'KUP', MANAGER: 'ระดับผู้จัดการ (经理)' };

  App.renderConn = function () {
    var el = App.$('#conn');
    if (!el) return;
    App.Queue.count().then(function (n) {
      var on = App.state.online;
      el.className = 'conn ' + (on ? (n ? 'conn-warn' : 'conn-ok') : 'conn-bad');
      el.innerHTML = App.icon(on ? 'wifi' : 'wifi-off') + '<span>' + (on ? (n ? 'รอส่ง ' + n + ' รายการ' : 'ออนไลน์') : 'ออฟไลน์' + (n ? ' • ค้างส่ง ' + n : '')) + '</span>';
      el.title = on ? (n ? 'มีข้อมูลที่ยังไม่ถึงเซิร์ฟเวอร์ ระบบกำลังส่งใหม่' : 'เชื่อมต่อเซิร์ฟเวอร์แล้ว') : 'ไม่มีอินเทอร์เน็ต — ข้อมูลที่บันทึกจะเก็บไว้ในเครื่องนี้จนกว่าจะส่งสำเร็จ (AI ใช้ไม่ได้)';
    });
  };

  // ---------- router ----------
  var routes = [];
  App.route = function (pattern, view) { routes.push({ re: new RegExp('^' + pattern.replace(/:[a-z]+/g, '([^/]+)') + '$'), view: view }); };
  // Routing keeps its own current-hash so menus work even where the host page (Apps Script sandbox iframe,
  // company portal iframe) never delivers hashchange or blocks location.hash. location.hash is still updated when allowed.
  var vhash = null;
  App.hash = function () { return vhash != null ? vhash : (location.hash || '#/'); };
  App.nav = function (h) {
    vhash = h;
    try { if (location.hash !== h) location.hash = h; } catch (e) { /* sandboxed: ignore */ }
    App.render();
  };
  App.go = function (hash) { App.nav(hash); };
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (!a) return;
    e.preventDefault();
    App.nav(a.getAttribute('href'));
  });
  App.render = function () {
    if (!App.state.token) { App.views.login(); return; }
    var h = App.hash().slice(1) || '/';
    var q = {};
    var qi = h.indexOf('?');
    if (qi >= 0) { h.slice(qi + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); h = h.slice(0, qi); }
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].re.exec(h);
      if (m) {
        if (App.beforeLeave && App.beforeLeave() === false) return;
        App.beforeLeave = null;
        App.shell(h);
        routes[i].view.apply(null, m.slice(1).concat([q]));
        var main = App.$('#main');
        if (main) main.focus({ preventScroll: true });
        window.scrollTo(0, 0);
        return;
      }
    }
    App.shell(h);
    App.$('#main').innerHTML = App.empty('ไม่พบหน้านี้', 'ลิงก์อาจไม่ถูกต้อง', '<a class="btn btn-primary" href="#/">ไปหน้าภาพรวม</a>');
  };
  window.addEventListener('hashchange', function () { var cur = location.hash || '#/'; if (cur === vhash) return; vhash = cur; App.render(); });

  App.loading = function (label) { return '<div class="state state-loading" role="status"><span class="spinner" aria-hidden="true"></span>' + esc(label || 'กำลังโหลดข้อมูล…') + '</div>'; };
  App.empty = function (title, text, action) { return '<div class="state state-empty"><strong>' + esc(title) + '</strong><p>' + esc(text || '') + '</p>' + (action || '') + '</div>'; };
  App.errorBox = function (e, retryJs) { return '<div class="state state-error" role="alert"><strong>โหลดข้อมูลไม่สำเร็จ</strong><p>' + esc(App.errorText(e)) + '</p>' + (retryJs ? '<button class="btn btn-ghost" onclick="' + retryJs + '">ลองใหม่</button>' : '') + '</div>'; };

  // ---------- session ----------
  App.logout = function (msg) {
    var t = App.state.token;
    App.state.token = null; App.state.user = null; App.state.md = null;
    App.store.del('cps_session');
    if (t && !msg) rawCall('apiLogout', [t]).catch(function () {});
    App.views.login(msg);
  };
  App.loadMaster = function () { return App.api('apiMasterData').then(function (md) { App.state.md = md; App.state.user = md.user; return md; }); };
  App.can = function (what) {
    var r = App.state.user && App.state.user.role;
    if (what === 'admin') return r === 'ADMIN';
    if (what === 'audit') return r === 'ADMIN' || r === 'AUDITOR';
    return !!r;
  };
  App.wsName = function (id) { var w = (App.state.md.workshops || []).filter(function (x) { return x.id === id; })[0]; return w ? w.code + ' ' + w.name_th : '–'; };

  App.boot = function () {
    var s = App.store.get('cps_session');
    if (s && s.token && s.exp > Date.now()) {
      App.state.token = s.token;
      App.$('#app').innerHTML = App.loading('กำลังเข้าสู่ระบบ…');
      App.loadMaster().then(function () { App.render(); App.Queue.flush(); }, function (e) { if (e.code !== 'AUTH') { App.$('#app').innerHTML = App.errorBox(e, 'App.boot()'); } });
    } else App.views.login();
  };
})();
