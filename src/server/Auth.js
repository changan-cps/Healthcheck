/**
 * Auth — application login (username + password) and server-side sessions.
 * The web app runs "as the deploying account", so users never get direct
 * access to the database spreadsheet or the evidence folder in Drive.
 */
function hashPassword_(password, salt) {
  var h = Utilities.computeHmacSha256Signature(String(password), String(salt));
  for (var i = 1; i < LIMITS.PASSWORD_ITERATIONS; i++) h = Utilities.computeHmacSha256Signature(h, Utilities.newBlob(String(salt)).getBytes());
  return Utilities.base64Encode(h);
}

function sha256Hex_(s) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return d.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function validatePassword_(pw) {
  if (!pw || String(pw).length < 8) throw appError_('VALIDATION', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw appError_('VALIDATION', 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข');
}

function publicUser_(u) {
  return { id: u.id, username: u.username, display_name: u.display_name, email: u.email, role: u.role,
    role_name: (Permissions.ROLES[u.role] || {}).name_th || u.role, scope_workshop_ids: u.scope_workshop_ids || [],
    active: u.active, must_change_password: u.must_change_password, version: u.version };
}

/** Login: returns {token, user}. Generic error message to avoid user enumeration. */
function apiLogin(username, password, userAgent) {
  try {
    var uname = String(username || '').trim().toLowerCase();
    var u = Db.findOne('users', function (x) { return String(x.username).toLowerCase() === uname; });
    var generic = appError_('AUTH', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    if (!u || !u.active) throw generic;
    if (u.locked_until && new Date(u.locked_until) > new Date())
      throw appError_('LOCKED', 'บัญชีถูกล็อกชั่วคราวเพราะใส่รหัสผิดหลายครั้ง ลองใหม่หลัง ' + Utilities.formatDate(new Date(u.locked_until), 'Asia/Bangkok', 'HH:mm') + ' น.');
    if (hashPassword_(password, u.password_salt) !== u.password_hash) {
      var fails = (u.failed_logins || 0) + 1;
      var patch = { failed_logins: fails };
      if (fails >= LIMITS.LOGIN_MAX_FAILS) { patch.locked_until = new Date(Date.now() + LIMITS.LOGIN_LOCK_MINUTES * 60000).toISOString(); patch.failed_logins = 0; }
      Db.update('users', u.id, patch);
      throw generic;
    }
    var token = uuid_() + uuid_();
    Db.insert('sessions', { token_hash: sha256Hex_(token), user_id: u.id, expires_at: new Date(Date.now() + LIMITS.SESSION_HOURS * 3600000).toISOString(),
      last_seen_at: nowIso_(), user_agent: String(userAgent || '').slice(0, 200) });
    Db.update('users', u.id, { failed_logins: 0, locked_until: null, last_login_at: nowIso_() });
    logAction_(u.id, 'LOGIN', 'users', u.id, null, null, '');
    CacheService.getScriptCache().put('sess_' + sha256Hex_(token), u.id, 1800);
    return ok_({ token: token, user: publicUser_(Db.get('users', u.id)) });
  } catch (e) { return fail_(e); }
}

function apiLogout(token) {
  try {
    var h = sha256Hex_(token || '');
    var s = Db.findOne('sessions', function (x) { return x.token_hash === h; });
    if (s) Db.update('sessions', s.id, { expires_at: nowIso_() });
    CacheService.getScriptCache().remove('sess_' + h);
    return ok_(true);
  } catch (e) { return fail_(e); }
}

/** Resolve the current user from a session token or throw AUTH. */
function requireUser_(token) {
  if (!token) throw appError_('AUTH', 'กรุณาเข้าสู่ระบบ');
  var h = sha256Hex_(token);
  var cache = CacheService.getScriptCache();
  var uid = cache.get('sess_' + h);
  if (!uid) {
    var s = Db.findOne('sessions', function (x) { return x.token_hash === h; });
    if (!s || new Date(s.expires_at) < new Date()) throw appError_('AUTH', 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
    uid = s.user_id;
    cache.put('sess_' + h, uid, 1800);
  }
  var u = Db.get('users', uid);
  if (!u || !u.active) throw appError_('AUTH', 'บัญชีนี้ถูกปิดการใช้งาน');
  return u;
}

function apiChangePassword(token, oldPw, newPw) {
  return guard_(token, function (u) {
    if (hashPassword_(oldPw, u.password_salt) !== u.password_hash) throw appError_('AUTH', 'รหัสผ่านเดิมไม่ถูกต้อง');
    validatePassword_(newPw);
    var salt = uuid_();
    Db.update('users', u.id, { password_salt: salt, password_hash: hashPassword_(newPw, salt), must_change_password: false });
    logAction_(u.id, 'CHANGE_PASSWORD', 'users', u.id, null, null, '');
    return true;
  });
}

// ---------- user management (Admin) ----------
function apiListUsers(token) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'user.manage');
    return Db.all('users').map(publicUser_);
  });
}

function apiSaveUser(token, data) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'user.manage');
    if (!Permissions.ROLES[data.role]) throw appError_('VALIDATION', 'บทบาทไม่ถูกต้อง');
    var scope = Array.isArray(data.scope_workshop_ids) ? data.scope_workshop_ids : [];
    scope.forEach(function (w) { if (w !== '*' && !Db.get('workshops', w)) throw appError_('FK', 'ไม่พบ Workshop ' + w); });
    var uname = String(data.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(uname)) throw appError_('VALIDATION', 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - (3–40 ตัว)');
    var dup = Db.findOne('users', function (x) { return String(x.username).toLowerCase() === uname && x.id !== data.id; });
    if (dup) throw appError_('DUPLICATE', 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
    var rec = { username: uname, display_name: String(data.display_name || uname), email: data.email || '', role: data.role,
      scope_workshop_ids: scope, active: data.active !== false };
    var temp = null;
    if (!data.id || data.reset_password) {
      temp = data.password || ('Cps' + Math.floor(100000 + Math.random() * 899999));
      validatePassword_(temp);
      rec.password_salt = uuid_();
      rec.password_hash = hashPassword_(temp, rec.password_salt);
      rec.must_change_password = true;
    }
    var saved;
    if (data.id) {
      var before = Db.get('users', data.id);
      if (before.id === u.id && rec.role !== 'ADMIN') throw appError_('VALIDATION', 'ไม่สามารถลดสิทธิ์ Admin ของบัญชีตัวเอง');
      saved = Db.update('users', data.id, rec, data.version);
      logAction_(u.id, 'UPDATE_USER', 'users', data.id, publicUser_(before), publicUser_(saved), data.reason || '');
    } else {
      rec.failed_logins = 0;
      saved = Db.insert('users', rec);
      logAction_(u.id, 'CREATE_USER', 'users', saved.id, null, publicUser_(saved), '');
    }
    return { user: publicUser_(saved), temp_password: temp };
  });
}

// ---------- shared API helpers ----------
function ok_(data) { return { ok: true, data: data }; }
function fail_(e) {
  var msg = e && e.message ? e.message : String(e);
  var code = (e && e.code) || 'ERROR';
  if (code === 'ERROR') console.error(e && e.stack ? e.stack : msg);
  var out = { ok: false, error: { code: code, message: msg } };
  if (e && e.current) out.error.current = e.current;
  if (e && e.details) out.error.details = e.details;
  return out;
}

/** Wrap an API: resolve user, run fn(user), standardize the response. */
function guard_(token, fn) {
  try {
    Db.reset();
    var u = requireUser_(token);
    return ok_(fn(u));
  } catch (e) { return fail_(e); }
}

function logAction_(userId, action, entity, entityId, before, after, reason) {
  try {
    Db.insert('audit_logs', { user_id: userId || '', action: action, entity: entity, entity_id: entityId || '', before: trimForLog_(before), after: trimForLog_(after), reason: reason || '' });
  } catch (e) { console.error('log failed: ' + e.message); }
}

function trimForLog_(o) {
  if (o == null) return null;
  var c = JSON.parse(JSON.stringify(o));
  ['password_hash', 'password_salt', 'token_hash'].forEach(function (k) { delete c[k]; });
  var s = JSON.stringify(c);
  return s.length > 20000 ? { truncated: true, excerpt: s.slice(0, 20000) } : c;
}
