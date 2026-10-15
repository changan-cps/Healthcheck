'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./helpers/fake-gas');

const rt = createRuntime();
const P = rt.Permissions;
const users = {
  admin: { id: 'a', role: 'ADMIN', scope_workshop_ids: ['*'] },
  auditor: { id: 'b', role: 'AUDITOR', scope_workshop_ids: ['W1'] },
  owner: { id: 'c', role: 'WORKSHOP_OWNER', scope_workshop_ids: ['W1'] },
  viewer: { id: 'd', role: 'VIEWER', scope_workshop_ids: ['W1'] },
  inactive: { id: 'e', role: 'ADMIN', scope_workshop_ids: ['*'], active: false }
};

test('permission matrix', () => {
  const W1 = { workshop_id: 'W1', audit_status: 'IN_PROGRESS' };
  const W2 = { workshop_id: 'W2', audit_status: 'IN_PROGRESS' };
  const C1 = { workshop_id: 'W1', audit_status: 'CONFIRMED' };
  assert.equal(P.can(users.auditor, 'audit.edit', W1), true);
  assert.equal(P.can(users.auditor, 'audit.edit', W2), false, 'outside scope');
  assert.equal(P.can(users.auditor, 'audit.edit', C1), false, 'confirmed is immutable');
  assert.equal(P.can(users.admin, 'audit.edit', C1), false, 'even admin cannot edit confirmed');
  assert.equal(P.can(users.owner, 'audit.view', W1), false);
  assert.equal(P.can(users.owner, 'audit.view', C1), true);
  assert.equal(P.can(users.owner, 'audit.edit', W1), false);
  assert.equal(P.can(users.viewer, 'evidence.view', { workshop_id: 'W1' }), false);
  assert.equal(P.can(users.owner, 'evidence.view', { workshop_id: 'W1', linked_to_finding: true }), true);
  assert.equal(P.can(users.owner, 'evidence.view', { workshop_id: 'W1' }), false);
  assert.equal(P.can(users.owner, 'finding.submit_action', { workshop_id: 'W1' }), true);
  assert.equal(P.can(users.owner, 'finding.verify', { workshop_id: 'W1' }), false);
  assert.equal(P.can(users.auditor, 'finding.verify', { workshop_id: 'W1', submitted_by: 'b' }), false, 'no self-verification');
  assert.equal(P.can(users.auditor, 'standard.manage'), false);
  assert.equal(P.can(users.admin, 'standard.manage'), true);
  assert.equal(P.can(users.inactive, 'dashboard.view'), false);
  assert.equal(P.can(users.owner, 'evidence.upload', { workshop_id: 'W1', audit_status: 'CONFIRMED', phase: 'AFTER_FIX' }), true);
  assert.equal(P.can(users.owner, 'evidence.upload', { workshop_id: 'W1', audit_status: 'IN_PROGRESS' }), false);
  assert.throws(() => P.assert(users.viewer, 'audit.create', { workshop_id: 'W1' }), /ไม่มีสิทธิ์/);
});

test('AI output validation rejects unknown rules/evidence and enforces structure', () => {
  const ctx = { criterion_id: 'T-02', rule_ids: ['T-R03'], evidence_ids: ['EV-1', 'AUDITOR-NOTES'], red_line_codes: ['RL1'], mode: 'DEDUCTION', band_count: 0 };
  const good = { criterion_id: 'T-02', result: 'NONCONFORM', observations: [{ type: 'FACT', text: 'พบ', evidence_references: [{ evidence_id: 'EV-1', locator: 'ซ้าย' }] }],
    evidence_references: [{ evidence_id: 'EV-1' }], matched_rule_ids: ['T-R03'], issues: [{ issue_key: 'x', rule_id: 'T-R03', description: 'd', evidence_ids: ['EV-1'] }],
    missing_evidence: [], suggested_questions: [], rationale: 'r' };
  assert.equal(rt.AiSchema.validate(good, ctx).ok, true);
  const bad = (patch) => rt.AiSchema.validate(Object.assign({}, good, patch), ctx);
  assert.equal(bad({ criterion_id: 'T-01' }).ok, false);
  assert.equal(bad({ matched_rule_ids: ['T-R99'] }).ok, false);
  assert.equal(bad({ evidence_references: [{ evidence_id: 'EV-404' }] }).ok, false);
  assert.equal(bad({ issues: [] }).ok, false, 'NONCONFORM needs issues');
  assert.equal(bad({ result: 'PASS' }).ok, false);
  assert.equal(bad({ result: 'CONFORM' }).ok, false, 'CONFORM with issues');
  assert.equal(bad({ red_line_candidates: [{ clause_code: 'RL9', description: 'x' }] }).ok, false);
  assert.equal(rt.AiSchema.validate('not json', ctx).ok, false);
  const ins = rt.AiSchema.validate({ criterion_id: 'T-02', result: 'INSUFFICIENT', observations: [], evidence_references: [], matched_rule_ids: [], missing_evidence: ['ภาพ'], suggested_questions: ['ถาม'], rationale: 'ไม่พอ' }, ctx);
  assert.equal(ins.ok, true);
  const band = rt.AiSchema.validate(Object.assign({}, good, { result: 'CONFORM', issues: [], matched_rule_ids: [], proposed_band_index: 7 }), Object.assign({}, ctx, { mode: 'BAND', band_count: 5 }));
  assert.equal(band.ok, false);
});

test('dashboard calc: averages only confirmed full audits within one version; empty is null', () => {
  const D = rt.DashboardCalc;
  const empty = D.compute([], [], { today: '2026-10-15' });
  assert.equal(empty.average_pct, null);
  assert.equal(empty.closure_rate.pct, null);
  const audits = [
    { id: '1', status: 'CONFIRMED', scope_mode: 'FULL', final_score: 90, final_of_max: 100, standard_version_id: 'v1', workshop_id: 'W1', audit_date: '2026-10-01' },
    { id: '2', status: 'CONFIRMED', scope_mode: 'FULL', final_score: 80, final_of_max: 100, standard_version_id: 'v1', workshop_id: 'W2', audit_date: '2026-10-02' },
    { id: '3', status: 'CONFIRMED', scope_mode: 'PARTIAL', final_score: 5, final_of_max: 5, standard_version_id: 'v1', workshop_id: 'W1', audit_date: '2026-10-03' },
    { id: '4', status: 'IN_PROGRESS', scope_mode: 'FULL', standard_version_id: 'v1', workshop_id: 'W1', audit_date: '2026-10-04' }];
  const f = [{ status: 'CLOSED', audit_type: 'TEAM', dimension_code: 'D1' }, { status: 'OPEN', due_date: '2026-10-01', audit_type: 'TEAM', dimension_code: 'D1' }, { status: 'FIXED_PENDING_VERIFY', audit_type: 'TEAM', dimension_code: 'D2' }];
  const o = D.compute(audits, f, { today: '2026-10-15' });
  assert.equal(o.average_pct, 85);
  assert.equal(o.excluded_from_average, 1);
  assert.equal(o.audit_counts.in_progress, 1);
  assert.equal(o.finding_counts.overdue, 1);
  assert.equal(o.finding_counts.open, 2, 'pending verification is still open');
  assert.equal(o.closure_rate.numerator, 1); assert.equal(o.closure_rate.denominator, 3);
  assert.equal(o.pareto[0].count, 2);
  const two = D.compute(audits.concat([{ id: '5', status: 'CONFIRMED', scope_mode: 'FULL', final_score: 50, final_of_max: 100, standard_version_id: 'v2', workshop_id: 'W1', audit_date: '2026-10-05' }]), [], { today: '2026-10-15' });
  assert.equal(two.average_pct, null, 'different versions are not averaged together');
  assert.equal(two.by_version.length, 2);
});
