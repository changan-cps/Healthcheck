/* Layout shell, navigation, icons, login. */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;

  var ICONS = {
    dashboard: '<path d="M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z"/>',
    audit: '<path d="M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1zm0 2v2h6V4zm-1.3 9.3 1.4-1.4 1.9 1.9 4.4-4.4 1.4 1.4-5.8 5.8z"/>',
    issue: '<path d="M12 2 1 21h22zm1 15h-2v-2h2zm0-4h-2V9h2z"/>',
    book: '<path d="M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm1 3v4h10V5z"/>',
    gear: '<path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.4-2.9a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
    camera: '<path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>',
    zoom: '<path d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm-1 4v3H6v2h3v3h2v-3h3V9h-3V6z"/>',
    mic: '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z"/>',
    file: '<path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5z"/>',
    note: '<path d="M4 4h16v10l-6 6H4zm10 14.5V14h4.5zM7 8v2h10V8zm0 4v2h6v-2z"/>',
    route: '<path d="M6 3a3 3 0 0 1 1 5.8V15a3 3 0 0 0 6 0V9a5 5 0 0 1 10 0v6.2a3 3 0 1 1-2 0V9a3 3 0 0 0-6 0v6a5 5 0 0 1-10 0V8.8A3 3 0 0 1 6 3z"/>',
    check: '<path d="m9 16.2-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
    x: '<path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/>',
    alert: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 5v7h2V7zm0 9v2h2v-2z"/>',
    clock: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3z"/>',
    pause: '<path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM9 8v8h2V8zm4 0v8h2V8z"/>',
    dot: '<circle cx="12" cy="12" r="5"/>',
    plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
    upload: '<path d="M11 16V7.8L7.4 11.4 6 10l6-6 6 6-1.4 1.4L13 7.8V16zM5 18h14v2H5z"/>',
    download: '<path d="M11 4h2v8.2l3.6-3.6L18 10l-6 6-6-6 1.4-1.4 3.6 3.6zM5 18h14v2H5z"/>',
    ai: '<path d="M10 2 12 8l6 2-6 2-2 6-2-6-6-2 6-2zm8 10 1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
    logout: '<path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5zm6.6 4.4L15.2 8.8l2.2 2.2H9v2h8.4l-2.2 2.2 1.4 1.4L21.2 12z"/>',
    menu: '<path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>',
    chevl: '<path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/>',
    chevr: '<path d="M8.6 7.4 10 6l6 6-6 6-1.4-1.4 4.6-4.6z"/>',
    wifi: '<path d="M12 18a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM2 8.8a14 14 0 0 1 20 0l-1.4 1.5a12 12 0 0 0-17.2 0zm3.5 3.5a9 9 0 0 1 13 0l-1.4 1.4a7 7 0 0 0-10.2 0zm3.5 3.5a4 4 0 0 1 6 0L13.6 17a2 2 0 0 0-3.2 0z"/>',
    'wifi-off': '<path d="m3.3 2 18.7 18.7-1.4 1.4-6.8-6.8a4 4 0 0 0-4.8.5l-1.4-1.4a6 6 0 0 1 4.6-1.6L9.6 10.2a9 9 0 0 0-4.1 2.1L4.1 10.9a11 11 0 0 1 3.9-2.3L5.6 6.2a14 14 0 0 0-3.6 2.6L.6 7.4A16 16 0 0 1 4.1 4.8L1.9 3.4zM12 18a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>',
    refresh: '<path d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h7V4z"/>',
    flag: '<path d="M5 2h2v1h11l-2 4 2 4H7v11H5z"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    stop: '<path d="M6 6h12v12H6z"/>',
    trash: '<path d="M9 3h6l1 1h4v2H4V4h4zm-3 5h12l-1 13H7z"/>',
    link: '<path d="M10.6 13.4a1 1 0 0 0 1.4 0l4-4a3 3 0 0 0-4.2-4.2l-1 1 1.4 1.4 1-1a1 1 0 0 1 1.4 1.4l-4 4a1 1 0 0 0 0 1.4zm2.8-2.8a1 1 0 0 0-1.4 0l-4 4a3 3 0 0 0 4.2 4.2l1-1-1.4-1.4-1 1a1 1 0 0 1-1.4-1.4l4-4a1 1 0 0 0 0-1.4z"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    eye: '<path d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>'
  };
  App.icon = function (name, cls) { return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || ICONS.dot) + '</svg>'; };

  var NAV = [
    { href: '#/', key: '/', icon: 'dashboard', label: 'ภาพรวม' },
    { href: '#/audits', key: '/audit', icon: 'audit', label: 'รอบตรวจ' },
    { href: '#/issues', key: '/issue', icon: 'issue', label: 'ปัญหา' },
    { href: '#/standards', key: '/standard', icon: 'book', label: 'มาตรฐาน' },
    { href: '#/settings', key: '/settings', icon: 'gear', label: 'ตั้งค่า', admin: true }
  ];

  function activeKey(path) {
    if (path === '/' || path === '') return '/';
    var best = '/';
    NAV.forEach(function (n) { if (n.key !== '/' && path.indexOf(n.key) === 0) best = n.key; });
    return best;
  }

  /** Render the app frame once; subsequent calls just update active nav. */
  App.shell = function (path) {
    var key = activeKey(path);
    if (!App.$('#main')) {
      var u = App.state.user;
      var items = NAV.filter(function (n) { return !n.admin || App.can('admin'); });
      var navHtml = items.map(function (n) { return '<a class="nav-link" data-key="' + n.key + '" href="' + n.href + '">' + App.icon(n.icon) + '<span>' + n.label + '</span></a>'; }).join('');
      var mobileMain = items.slice(0, 3);
      App.$('#app').innerHTML =
        '<a class="skip" href="#main">ข้ามไปเนื้อหา</a>' +
        '<aside class="sidebar" aria-label="เมนูหลัก"><div class="brand"><span class="brand-mark" aria-hidden="true">' + App.icon('audit') + '</span><span class="brand-text"><strong>CPS AI Audit</strong><small>Rayong Plant</small></span></div>' +
        '<nav class="nav">' + navHtml + '</nav><div class="side-foot"><div class="who"><strong>' + esc(u.display_name) + '</strong><small>' + esc(u.role_name) + '</small></div>' +
        '<button class="nav-link" id="btn-logout">' + App.icon('logout') + '<span>ออกจากระบบ</span></button></div></aside>' +
        '<div class="frame"><header class="topbar"><h1 id="page-title" class="page-title">CPS AI Audit</h1><div class="top-actions"><span id="ai-chip"></span><span id="conn" class="conn" role="status" aria-live="polite"></span></div></header>' +
        '<main id="main" tabindex="-1"></main></div>' +
        '<nav class="bottom-nav" aria-label="เมนูหลัก (มือถือ)">' + mobileMain.map(function (n) { return '<a class="bn-link" data-key="' + n.key + '" href="' + n.href + '">' + App.icon(n.icon) + '<span>' + n.label + '</span></a>'; }).join('') +
        '<button class="bn-link" id="bn-more" aria-haspopup="true" aria-expanded="false">' + App.icon('menu') + '<span>เพิ่มเติม</span></button></nav>' +
        '<div id="more-sheet" class="sheet" hidden><div class="sheet-panel" role="menu">' + items.slice(3).map(function (n) { return '<a role="menuitem" class="sheet-link" href="' + n.href + '">' + App.icon(n.icon) + n.label + '</a>'; }).join('') +
        '<button role="menuitem" class="sheet-link" id="sheet-logout">' + App.icon('logout') + 'ออกจากระบบ (' + esc(u.display_name) + ')</button></div></div>';
      App.$('#btn-logout').onclick = function () { App.logout(); };
      App.$('#sheet-logout').onclick = function () { App.logout(); };
      var sheet = App.$('#more-sheet');
      App.$('#bn-more').onclick = function () { sheet.hidden = !sheet.hidden; this.setAttribute('aria-expanded', String(!sheet.hidden)); };
      sheet.onclick = function (e) { if (e.target === sheet || e.target.closest('a')) { sheet.hidden = true; App.$('#bn-more').setAttribute('aria-expanded', 'false'); } };
      App.renderConn();
      App.renderAiChip();
    }
    App.$$('[data-key]').forEach(function (a) { var on = a.getAttribute('data-key') === key; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.body.classList.remove('has-actionbar');
  };

  App.renderAiChip = function () {
    var el = App.$('#ai-chip'); if (!el || !App.state.md) return;
    var ai = App.state.md.ai;
    el.innerHTML = ai.connected ? '<span class="chip chip-ok">' + App.icon('ai', 'chip-ic') + 'AI เชื่อมต่อแล้ว</span>' : '<span class="chip chip-warn" title="Admin ต้องใส่ API Key ในหน้าตั้งค่า">' + App.icon('ai', 'chip-ic') + 'ยังไม่ได้เชื่อมต่อ AI</span>';
  };

  App.setTitle = function (t) { var el = App.$('#page-title'); if (el) el.textContent = t; document.title = t + ' — CPS AI Audit'; };

  // ---------- login ----------
  App.views.login = function (msg) {
    document.title = 'เข้าสู่ระบบ — CPS AI Audit';
    App.$('#app').innerHTML =
      '<div class="login"><div class="login-panel"><div class="login-brand"><span class="brand-mark" aria-hidden="true">' + App.icon('audit') + '</span><div><strong>CPS AI Audit</strong><small>ระบบตรวจประเมิน CPS Health Check / KUP</small></div></div>' +
      '<form id="login-form" class="stack" novalidate><h1 class="login-h">เข้าสู่ระบบ</h1>' + (msg ? '<p class="notice notice-warn" role="alert">' + esc(msg) + '</p>' : '') +
      '<label class="field"><span>ชื่อผู้ใช้</span><input name="u" autocomplete="username" required autocapitalize="none" spellcheck="false"></label>' +
      '<label class="field"><span>รหัสผ่าน</span><input name="p" type="password" autocomplete="current-password" required></label>' +
      '<p id="login-err" class="field-error" role="alert" hidden></p><button class="btn btn-primary btn-block" type="submit">เข้าสู่ระบบ</button>' +
      '<p class="hint">ลืมรหัสผ่าน ให้ติดต่อ Admin เพื่อรีเซ็ต</p></form></div></div>';
    var f = App.$('#login-form');
    f.u.focus();
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var err = App.$('#login-err'); err.hidden = true;
      if (!f.u.value || !f.p.value) { err.textContent = 'กรอกชื่อผู้ใช้และรหัสผ่าน'; err.hidden = false; return; }
      var btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ…';
      App.rawCall('apiLogin', [f.u.value, f.p.value, navigator.userAgent]).then(function (res) {
        if (!res.ok) throw res.error;
        App.state.token = res.data.token;
        App.store.set('cps_session', { token: res.data.token, exp: Date.now() + 11 * 3600000 });
        return App.loadMaster().then(function () {
          if (res.data.user.must_change_password) return App.views.changePassword(true);
          App.nav(App.hash());
        });
      }).catch(function (e) {
        err.textContent = App.errorText(e); err.hidden = false; btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
      });
    };
  };

  App.views.changePassword = function (forced) {
    App.$('#app').innerHTML = '<div class="login"><div class="login-panel"><form id="pw-form" class="stack" novalidate><h1 class="login-h">ตั้งรหัสผ่านใหม่</h1>' +
      (forced ? '<p class="notice notice-info">ต้องเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งาน</p>' : '') +
      '<label class="field"><span>รหัสผ่านเดิม</span><input name="o" type="password" autocomplete="current-password" required></label>' +
      '<label class="field"><span>รหัสผ่านใหม่</span><input name="n" type="password" autocomplete="new-password" required minlength="8"><small>อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข</small></label>' +
      '<label class="field"><span>ยืนยันรหัสผ่านใหม่</span><input name="c" type="password" autocomplete="new-password" required></label>' +
      '<p id="pw-err" class="field-error" role="alert" hidden></p><button class="btn btn-primary btn-block">บันทึกรหัสผ่าน</button></form></div></div>';
    var f = App.$('#pw-form');
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var err = App.$('#pw-err');
      if (f.n.value !== f.c.value) { err.textContent = 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน'; err.hidden = false; return; }
      App.api('apiChangePassword', f.o.value, f.n.value).then(function () {
        App.toast('เปลี่ยนรหัสผ่านแล้ว', 'ok');
        App.state.user.must_change_password = false;
        App.nav('#/');
      }, function (e) { err.textContent = App.errorText(e); err.hidden = false; });
    };
  };
})();
