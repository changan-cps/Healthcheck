/**
 * Schema — table definitions for the Google Sheets database.
 * Column spec "name:type" — s=text, n=number, b=boolean, j=JSON, d=ISO datetime.
 * Foreign keys are declared with "->table" and enforced by Db.insert/update.
 * Every table has id, created_at, updated_at, version (optimistic locking).
 */
var SCHEMA_VERSION = 4;

var SCHEMA = {
  roles: ['code:s', 'name_th:s', 'description:s'],
  users: ['username:s', 'display_name:s', 'email:s', 'role:s', 'password_hash:s', 'password_salt:s', 'must_change_password:b',
    'scope_workshop_ids:j', 'active:b', 'failed_logins:n', 'locked_until:d', 'last_login_at:d'],
  sessions: ['token_hash:s', 'user_id:s->users', 'expires_at:d', 'last_seen_at:d', 'user_agent:s'],
  workshops: ['code:s', 'name_th:s', 'name_en:s', 'name_zh:s', 'active:b', 'is_demo:b'],
  groups: ['workshop_id:s->workshops', 'code:s', 'name:s', 'leader_name:s', 'active:b', 'is_demo:b'],
  teams: ['workshop_id:s->workshops', 'group_id:s->groups', 'code:s', 'name:s', 'leader_name:s', 'active:b', 'is_demo:b'],
  standard_sets: ['code:s', 'level:s', 'name_th:s', 'name_zh:s', 'scoring_mode:s', 'enabled_for_audit:b'],
  standard_versions: ['standard_set_id:s->standard_sets', 'version_label:s', 'effective_date:s', 'status:s', 'source_file_name:s',
    'source_sheet_name:s', 'source_sheet_index:n', 'source_file_hash:s', 'parser_version:s', 'imported_by:s->users', 'imported_at:d',
    'published_by:s', 'published_at:d', 'settings:j', 'dimensions:j', 'review_flags:j', 'review_ack:j', 'content_hash:s', 'notes:s'],
  audit_criteria: ['standard_version_id:s->standard_versions', 'code:s', 'seq:n', 'source_seq:n', 'dimension_code:s', 'title:j', 'requirement:j',
    'method:j', 'target_role:j', 'criteria_text:j', 'max_points:n', 'max_points_source:s', 'group_max_points:n', 'kup_type:s',
    'kup_importance:s', 'category_weight:n', 'bands:j', 'sample:j', 'time_hint:s', 'source_ref:j', 'review_flags:j'],
  scoring_rules: ['standard_version_id:s->standard_versions', 'rule_code:s', 'criterion_ids:j', 'rule_type:s', 'points:n', 'text:j',
    'note:s', 'parse_status:s', 'source_ref:j', 'seq:n'],
  red_line_rules: ['standard_version_id:s->standard_versions', 'clause_code:s', 'text:j', 'source_ref:j', 'seq:n'],
  audit_routes: ['standard_version_id:s->standard_versions', 'name:s', 'is_default:b', 'notes:s'],
  route_stops: ['route_id:s->audit_routes', 'seq:n', 'code:s', 'name:s', 'time_hint:s', 'criterion_ids:j', 'instructions:s'],
  audits: ['audit_no:s', 'audit_type:s', 'standard_version_id:s->standard_versions', 'workshop_id:s->workshops', 'group_id:s', 'team_id:s',
    'route_id:s', 'scope_mode:s', 'scope_note:s', 'auditor_user_id:s->users', 'auditor_name:s', 'auditee_name:s', 'audit_date:s', 'status:s',
    'provisional_score:n', 'provisional_of_max:n', 'final_score:n', 'final_of_max:n', 'coverage_pct:n', 'score_status:s',
    'score_detail:j', 'confirmed_by:s', 'confirmed_at:d', 'team_count:n', 'is_demo:b', 'created_by:s'],
  audit_items: ['audit_id:s->audits', 'criterion_id:s->audit_criteria', 'seq:n', 'in_scope:b', 'status:s', 'auditor_notes:s', 'result:s',
    'issues:j', 'band_index:n', 'band_score:n', 'override_score:n', 'override_reason:s', 'ai_run_id:s', 'ai_result:s', 'ai_proposed_score:n',
    'ai_band_index:n', 'computed_score:n', 'confirmed_score:n', 'sample_required:n', 'sample_collected:n', 'exemption_status:s',
    'exemption_reason:s', 'exemption_requested_by:s', 'exemption_decided_by:s', 'reviewed_by:s', 'reviewed_at:d', 'updated_by:s'],
  route_visits: ['audit_id:s->audits', 'stop_id:s->route_stops', 'status:s', 'started_at:d', 'finished_at:d', 'visited_by:s', 'session_label:s', 'note:s'],
  evidence_files: ['audit_id:s->audits', 'kind:s', 'parent_evidence_id:s', 'drive_file_id:s', 'file_name:s', 'mime_type:s', 'size_bytes:n',
    'duration_sec:n', 'station:s', 'area:s', 'stop_id:s', 'sample_label:s', 'captured_by:s', 'captured_at:d', 'note_text:s',
    'transcript_status:s', 'transcript:j', 'transcript_edited_by:s', 'transcript_edited_at:d', 'locator_hint:s', 'analysis_supported:b',
    'phase:s', 'deleted:b', 'quick:b', 'flag_issue:b'],
  audit_item_evidence: ['audit_item_id:s->audit_items', 'evidence_id:s->evidence_files', 'linked_by:s', 'note:s'],
  ai_analysis_runs: ['audit_item_id:s->audit_items', 'kind:s', 'request_key:s', 'provider:s', 'model:s', 'prompt_version:s', 'status:s',
    'started_at:d', 'finished_at:d', 'requested_by:s', 'input_evidence_ids:j', 'skipped_evidence:j', 'parsed:j', 'validation_errors:j',
    'warnings:j', 'error_message:s', 'raw_excerpt:s', 'tokens_in:n', 'tokens_out:n', 'attempt:n', 'engine_proposal:j'],
  audit_red_lines: ['audit_id:s->audits', 'clause_id:s->red_line_rules', 'clause_code:s', 'status:s', 'description:s', 'evidence_ids:j',
    'source:s', 'confirmed_by:s', 'confirmed_at:d'],
  findings: ['issue_no:s', 'audit_id:s->audits', 'audit_item_id:s', 'criterion_id:s', 'criterion_code:s', 'dimension_code:s', 'workshop_id:s',
    'group_id:s', 'team_id:s', 'audit_type:s', 'rule_id:s', 'issue_key:s', 'description:s', 'is_red_line:b', 'source:s', 'status:s',
    'owner_name:s', 'owner_user_id:s', 'due_date:s', 'closed_at:d', 'is_demo:b'],
  finding_evidence: ['finding_id:s->findings', 'evidence_id:s->evidence_files', 'phase:s'],
  corrective_actions: ['finding_id:s->findings', 'containment:s', 'root_cause:s', 'preventive_action:s', 'submitted_by:s', 'submitted_at:d'],
  closure_reviews: ['finding_id:s->findings', 'result:s', 'comment:s', 'reviewer_user_id:s', 'reviewed_at:d'],
  audit_logs: ['user_id:s', 'action:s', 'entity:s', 'entity_id:s', 'before:j', 'after:j', 'reason:s'],
  settings: ['key:s', 'value:j'],
  schema_meta: ['key:s', 'value:s']
};

/** Parse column specs once. */
var SCHEMA_COLUMNS = (function () {
  var out = {};
  Object.keys(SCHEMA).forEach(function (t) {
    var cols = [{ name: 'id', type: 's' }];
    SCHEMA[t].forEach(function (spec) {
      var m = /^([a-z_0-9]+):([snbjd])(?:->([a-z_]+))?$/.exec(spec);
      if (!m) throw new Error('Bad column spec ' + t + '.' + spec);
      cols.push({ name: m[1], type: m[2], ref: m[3] || null });
    });
    cols.push({ name: 'created_at', type: 'd' }, { name: 'updated_at', type: 'd' }, { name: 'version', type: 'n' });
    out[t] = cols;
  });
  return out;
})();

/**
 * Migrations: each is idempotent. Adding columns/tables is handled
 * generically by Db.ensureSchema(); data migrations go here.
 */
var MIGRATIONS = [
  { version: 1, description: 'initial tables', up: function () {} },
  { version: 2, description: 'audit routes + route visits', up: function () {} },
  { version: 3, description: 'red line rules per standard version', up: function () {} },
  { version: 4, description: 'quick capture flags on evidence (quick, flag_issue)', up: function () {} }
];
