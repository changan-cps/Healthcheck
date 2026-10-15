/**
 * Config — constants and Script Properties access.
 * Secrets (AI API keys) live ONLY in Script Properties, never in code, sheets or logs.
 */
var APP_NAME = 'CPS AI Audit';
var APP_VERSION = '1.0.0';

var LIMITS = {
  IMAGE_MAX_BYTES: 10 * 1024 * 1024,
  AUDIO_MAX_BYTES: 15 * 1024 * 1024,
  DOC_MAX_BYTES: 15 * 1024 * 1024,
  VIDEO_MAX_BYTES: 25 * 1024 * 1024,
  XLSX_MAX_BYTES: 10 * 1024 * 1024,
  AI_CALLS_PER_USER_PER_10MIN: 30,
  AI_INLINE_MAX_BYTES: 18 * 1024 * 1024, // Gemini inline request limit is ~20 MB
  SESSION_HOURS: 12,
  LOGIN_MAX_FAILS: 5,
  LOGIN_LOCK_MINUTES: 15,
  PASSWORD_ITERATIONS: 2000,
  CELL_MAX_CHARS: 49000
};

var EVIDENCE_KINDS = {
  OVERVIEW_PHOTO: { label: 'ภาพรวม', mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], max: LIMITS.IMAGE_MAX_BYTES, analyzable: true },
  ZOOM_PHOTO: { label: 'ภาพซูม', mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], max: LIMITS.IMAGE_MAX_BYTES, analyzable: true },
  AUDIO: { label: 'เสียงสัมภาษณ์', mimes: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg'], max: LIMITS.AUDIO_MAX_BYTES, analyzable: true },
  DOCUMENT: { label: 'เอกสาร', mimes: ['application/pdf', 'text/plain', 'text/csv'], max: LIMITS.DOC_MAX_BYTES, analyzable: true,
    accept_unanalyzable: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  VIDEO: { label: 'วิดีโอ', mimes: ['video/mp4', 'video/quicktime', 'video/webm'], max: LIMITS.VIDEO_MAX_BYTES, analyzable: false }
};

function props_() { return PropertiesService.getScriptProperties(); }
function getProp_(k, dflt) { var v = props_().getProperty(k); return v == null || v === '' ? (dflt === undefined ? null : dflt) : v; }
function setProp_(k, v) { props_().setProperty(k, String(v)); }

/** AI configuration visible to the UI (never returns the key itself). */
function aiConfig_() {
  var provider = getProp_('AI_PROVIDER', 'gemini');
  var keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
  return {
    provider: provider,
    model: getProp_('AI_MODEL', provider === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash'),
    connected: !!getProp_(keyName),
    key_property: keyName,
    free_tier_notice: provider === 'gemini' && getProp_('GEMINI_TIER', 'free') === 'free'
  };
}

function nowIso_() { return new Date().toISOString(); }
function uuid_() { return Utilities.getUuid(); }
