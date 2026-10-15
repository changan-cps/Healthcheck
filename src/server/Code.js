/**
 * Web app entry point and admin settings APIs.
 */
function doGet(e) {
  var t = HtmlService.createTemplateFromFile('index');
  t.appVersion = APP_VERSION;
  var out = t.evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    // allow embedding in the company CPS System page (iframe); the app has its own login
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  // PNG only (Apps Script rejects SVG). Never let the icon break page load.
  try { out.setFaviconUrl(APP_ICON_URL); } catch (err) { console.warn('favicon: ' + err); }
  return out;
}

var APP_ICON_URL = 'https://changan-cps.github.io/Healthcheck/docs/icons/icon-192.png';

/** HTML partial include for templates. */
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

function apiPing() { return ok_({ at: nowIso_(), version: APP_VERSION, setup: !!getProp_('DB_SPREADSHEET_ID') }); }

function apiGetSettings(token) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'settings.manage');
    return { ai: aiConfig_(), limits: LIMITS, app_version: APP_VERSION, schema_version: SCHEMA_VERSION, scoring_engine: Scoring.ENGINE_VERSION,
      prompt_version: AiSchema.PROMPT_VERSION, parser_version: StandardParser.PARSER_VERSION,
      database_url: 'https://docs.google.com/spreadsheets/d/' + getProp_('DB_SPREADSHEET_ID') };
  });
}

/** Store AI settings. The API key is write-only: it is saved to Script Properties and never returned. */
function apiSetAiConfig(token, cfg) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'settings.manage');
    if (cfg.provider && !AiProviders[cfg.provider]) throw appError_('VALIDATION', 'ไม่รองรับผู้ให้บริการนี้');
    if (cfg.provider) setProp_('AI_PROVIDER', cfg.provider);
    if (cfg.model) {
      if (!/^[A-Za-z0-9._\-]{3,60}$/.test(cfg.model)) throw appError_('VALIDATION', 'ชื่อโมเดลไม่ถูกต้อง');
      setProp_('AI_MODEL', cfg.model);
    }
    if (cfg.tier) setProp_('GEMINI_TIER', cfg.tier === 'paid' ? 'paid' : 'free');
    if (cfg.api_key) {
      var key = String(cfg.api_key).trim();
      if (key.length < 20) throw appError_('VALIDATION', 'API Key สั้นผิดปกติ');
      setProp_(aiConfig_().key_property, key);
    }
    if (cfg.clear_key) props_().deleteProperty(aiConfig_().key_property);
    logAction_(u.id, 'SET_AI_CONFIG', 'settings', 'ai', null, { provider: cfg.provider, model: cfg.model, key_changed: !!cfg.api_key || !!cfg.clear_key }, '');
    return aiConfig_();
  });
}

function apiAuditLog(token, filters) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'settings.manage');
    filters = filters || {};
    var users = indexById_(Db.all('users'));
    return Db.find('audit_logs', function (l) {
      if (filters.entity && l.entity !== filters.entity) return false;
      if (filters.entity_id && l.entity_id !== filters.entity_id) return false;
      return true;
    }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).slice(0, filters.limit || 300)
      .map(function (l) { l.user_name = (users[l.user_id] || {}).display_name || l.user_id; return l; });
  });
}

/** Admin: create clearly-labelled demo master data (no fake AI results, no fake scores). */
function apiSeedDemo(token) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'master.manage');
    var w = Db.findOne('workshops', function (x) { return x.code === 'DEMO'; });
    if (!w) w = Db.insert('workshops', { code: 'DEMO', name_th: '[ข้อมูลสาธิต] Workshop ทดลอง', name_en: '[DEMO] Workshop', name_zh: '[演示]', active: true, is_demo: true });
    var g = Db.findOne('groups', function (x) { return x.workshop_id === w.id; }) || Db.insert('groups', { workshop_id: w.id, code: 'DEMO-G1', name: '[สาธิต] Group 1', leader_name: 'หัวหน้ากลุ่ม (สาธิต)', active: true, is_demo: true });
    if (!Db.findOne('teams', function (x) { return x.group_id === g.id; })) {
      Db.insert('teams', { workshop_id: w.id, group_id: g.id, code: 'DEMO-T1', name: '[สาธิต] Team A', leader_name: 'หัวหน้าทีม (สาธิต)', active: true, is_demo: true });
      Db.insert('teams', { workshop_id: w.id, group_id: g.id, code: 'DEMO-T2', name: '[สาธิต] Team B', leader_name: 'หัวหน้าทีม (สาธิต)', active: true, is_demo: true });
    }
    logAction_(u.id, 'SEED_DEMO', 'workshops', w.id, null, null, '');
    return { workshop_id: w.id };
  });
}
