/**
 * Setup & migrations — run from the Apps Script editor by the deploying account.
 *
 * 1) (optional) Script Property ADMIN_INITIAL_PASSWORD = <temporary password>;
 *    if not set, setup() generates one and prints it once in the execution log
 * 2) Run setup()   (creates the private database spreadsheet + evidence folder)
 * 3) Run migrate() after every code update (idempotent)
 */
function setup() {
  var p = props_();
  if (!p.getProperty('DB_SPREADSHEET_ID')) {
    var ss = SpreadsheetApp.create(APP_NAME + ' — Database (do not share)');
    p.setProperty('DB_SPREADSHEET_ID', ss.getId());
  }
  if (!p.getProperty('EVIDENCE_FOLDER_ID')) {
    var folder = DriveApp.createFolder(APP_NAME + ' — Evidence (private)');
    p.setProperty('EVIDENCE_FOLDER_ID', folder.getId());
  }
  Db.reset();
  migrate();
  seedReferenceData_();
  var adminPw = p.getProperty('ADMIN_INITIAL_PASSWORD');
  if (!Db.findOne('users', function (u) { return u.role === 'ADMIN'; })) {
    var generated = false;
    if (!adminPw) {
      // no property set: generate a one-time password and show it only in this execution log
      var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      adminPw = 'Cps';
      for (var i = 0; i < 9; i++) adminPw += chars.charAt(Math.floor(Math.random() * chars.length));
      adminPw += String(Math.floor(Math.random() * 90) + 10);
      generated = true;
    }
    validatePassword_(adminPw);
    var salt = uuid_();
    Db.insert('users', { username: 'admin', display_name: 'Administrator', role: 'ADMIN', password_salt: salt, password_hash: hashPassword_(adminPw, salt),
      must_change_password: true, scope_workshop_ids: ['*'], active: true, failed_logins: 0 });
    p.deleteProperty('ADMIN_INITIAL_PASSWORD');
    if (generated) console.log('ผู้ใช้: admin  รหัสผ่านชั่วคราว: ' + adminPw + '  (ระบบจะให้เปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก — ข้อความนี้จะไม่แสดงอีก)');
  }
  console.log('Setup complete. Database: ' + p.getProperty('DB_SPREADSHEET_ID'));
  return true;
}

function migrate() {
  Db.ensureSchema();
  var meta = Db.findOne('schema_meta', function (m) { return m.key === 'schema_version'; });
  var current = meta ? Number(meta.value) : 0;
  MIGRATIONS.forEach(function (m) {
    if (m.version > current) {
      m.up();
      console.log('Migration ' + m.version + ': ' + m.description);
    }
  });
  if (meta) Db.update('schema_meta', meta.id, { value: String(SCHEMA_VERSION) });
  else Db.insert('schema_meta', { key: 'schema_version', value: String(SCHEMA_VERSION) });
  return SCHEMA_VERSION;
}

/** Reference data that comes from the standard files (workshops from "Y2026 Score Management", levels from the HC files). */
function seedReferenceData_() {
  var roles = Object.keys(Permissions.ROLES);
  roles.forEach(function (code) {
    if (!Db.findOne('roles', function (r) { return r.code === code; })) Db.insert('roles', { code: code, name_th: Permissions.ROLES[code].name_th, description: '' });
  });
  var sets = [
    { code: 'TEAM', level: 'TEAM', name_th: 'Health Check ระดับหัวหน้าทีม (班长)', name_zh: 'CPS-KUP健康体检表--班组级', scoring_mode: 'DEDUCTION', enabled_for_audit: true },
    { code: 'GROUP', level: 'GROUP', name_th: 'Health Check ระดับหัวหน้ากลุ่ม (区长)', name_zh: 'CPS-KUP健康体检表--区长级', scoring_mode: 'DEDUCTION', enabled_for_audit: true },
    { code: 'KUP', level: 'KUP', name_th: 'มาตรฐานประเมิน CPS (KUP)', name_zh: 'CPS评价标准（KUP）', scoring_mode: 'BAND', enabled_for_audit: true },
    { code: 'MANAGER', level: 'MANAGER', name_th: 'Health Check ระดับผู้จัดการ (经理) — เตรียมโครงสร้าง', name_zh: 'CPS-KUP健康体检表-经理级', scoring_mode: 'DEDUCTION', enabled_for_audit: false }
  ];
  sets.forEach(function (s) { if (!Db.findOne('standard_sets', function (x) { return x.code === s.code; })) Db.insert('standard_sets', s); });
  var ws = [
    { code: 'BS', name_th: 'แผนกงานเชื่อม', name_en: 'Welding Shop', name_zh: '焊装车间' },
    { code: 'PS', name_th: 'แผนกพ่นสี', name_en: 'Painting Shop', name_zh: '涂装车间' },
    { code: 'GA', name_th: 'แผนกประกอบขั้นสุดท้าย', name_en: 'Assembly Shop', name_zh: '总装车间' },
    { code: 'PT', name_th: 'แผนกระบบส่งกำลัง', name_en: 'Powertrain Shop', name_zh: '动力车间' },
    { code: 'VI', name_th: 'VI', name_en: 'VI', name_zh: 'VI' },
    { code: 'KD', name_th: 'KD', name_en: 'KD', name_zh: 'KD' }
  ];
  ws.forEach(function (w) {
    if (!Db.findOne('workshops', function (x) { return x.code === w.code; })) { w.active = true; w.is_demo = false; Db.insert('workshops', w); }
  });
}
