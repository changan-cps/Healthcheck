'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./helpers/fake-gas');

const rt = createRuntime();
const S = rt.Scoring;
const plain = (x) => JSON.parse(JSON.stringify(x));

const crit = { id: 'c1', code: 'T-03', max_points: 10, dimension_code: 'D2' };
const rules = {
  once5: { id: 'once5', rule_code: 'R1', rule_type: 'ONCE', points: 5, parse_status: 'PARSED', criterion_ids: ['c1'] },
  per5: { id: 'per5', rule_code: 'R2', rule_type: 'PER_OCCURRENCE', points: 5, parse_status: 'PARSED', criterion_ids: ['c1'] },
  per3: { id: 'per3', rule_code: 'R3', rule_type: 'PER_OCCURRENCE', points: 3, parse_status: 'PARSED', criterion_ids: ['c1'] },
  zero: { id: 'zero', rule_code: 'R4', rule_type: 'ZERO_SCORE', points: null, parse_status: 'PARSED', criterion_ids: ['c1'] },
  other: { id: 'other', rule_code: 'R9', rule_type: 'PER_OCCURRENCE', points: 3, parse_status: 'PARSED', criterion_ids: ['c2'] },
  review: { id: 'review', rule_code: 'R5', rule_type: 'UNPARSED', points: null, parse_status: 'NEEDS_REVIEW', criterion_ids: ['c1'] }
};
const item = (o) => Object.assign({ in_scope: true }, o);

test('per-occurrence deducts per unique issue; same issue from many evidence counts once', () => {
  const r = S.scoreDeductionItem(item({ result: 'NONCONFORM', issues: [
    { issue_key: 'A', rule_id: 'per3', evidence_ids: ['e1'] }, { issue_key: 'A', rule_id: 'per3', evidence_ids: ['e2'] }, { issue_key: 'B', rule_id: 'per3' }] }), crit, rules, {});
  assert.equal(r.status, 'SCORED');
  assert.equal(r.score, 4);
  assert.equal(r.deductions.length, 2);
  assert.deepEqual(plain(r.deductions[0].evidence_ids).sort(), ['e1', 'e2']);
});

test('ONCE rule deducts once even with several issues', () => {
  const r = S.scoreDeductionItem(item({ result: 'NONCONFORM', issues: [{ issue_key: 'v1', rule_id: 'once5' }, { issue_key: 'v2', rule_id: 'once5' }] }), crit, rules, {});
  assert.equal(r.score, 5);
});

test('mixed rules match the standard example (T-03): template wrong + 1 key step mismatch', () => {
  const r = S.scoreDeductionItem(item({ result: 'NONCONFORM', issues: [{ issue_key: 'tpl', rule_id: 'once5' }, { issue_key: 'step', rule_id: 'per5' }] }), crit, rules, {});
  assert.equal(r.score, 0);
});

test('negative result is held unless the standard confirms floor 0', () => {
  const issues = [{ issue_key: 'a', rule_id: 'per5' }, { issue_key: 'b', rule_id: 'per5' }, { issue_key: 'c', rule_id: 'per3' }];
  const held = S.scoreDeductionItem(item({ result: 'NONCONFORM', issues }), crit, rules, {});
  assert.equal(held.status, 'HELD');
  assert.equal(held.score, null);
  const floored = S.scoreDeductionItem(item({ result: 'NONCONFORM', issues }), crit, rules, { item_floor_zero: true });
  assert.equal(floored.score, 0);
});

test('zero-score rule, foreign rule, unreviewed rule, issue-rule conflict', () => {
  assert.equal(S.scoreDeductionItem(item({ result: 'NONCONFORM', issues: [{ issue_key: 'x', rule_id: 'zero' }] }), crit, rules, {}).score, 0);
  assert.equal(S.scoreDeductionItem(item({ result: 'NONCONFORM', issues: [{ issue_key: 'x', rule_id: 'other' }] }), crit, rules, {}).status, 'HELD');
  assert.equal(S.scoreDeductionItem(item({ result: 'NONCONFORM', issues: [{ issue_key: 'x', rule_id: 'review' }] }), crit, rules, {}).status, 'HELD');
  const conflict = S.scoreDeductionItem(item({ result: 'NONCONFORM', issues: [{ issue_key: 'x', rule_id: 'per3' }, { issue_key: 'x', rule_id: 'per5' }] }), crit, rules, {});
  assert.equal(conflict.status, 'HELD');
});

test('insufficient evidence is neither 0 nor pass; not started is not scored', () => {
  assert.equal(S.scoreDeductionItem(item({ result: 'INSUFFICIENT' }), crit, rules, {}).score, null);
  assert.equal(S.scoreDeductionItem(item({}), crit, rules, {}).status, 'NOT_STARTED');
});

test('override needs a reason and must stay in range', () => {
  assert.equal(S.scoreDeductionItem(item({ result: 'CONFORM', override_score: 8 }), crit, rules, {}).status, 'HELD');
  const ok = S.scoreDeductionItem(item({ result: 'CONFORM', override_score: 8, override_reason: 'พบข้อสังเกตเล็กน้อย' }), crit, rules, {});
  assert.equal(ok.score, 8); assert.equal(ok.override_from, 10);
  assert.equal(S.scoreDeductionItem(item({ result: 'CONFORM', override_score: 11, override_reason: 'x' }), crit, rules, {}).status, 'HELD');
});

test('audit totals: coverage, provisional vs final, red line modes', () => {
  const criteria = [crit, { id: 'c2', code: 'T-04', max_points: 5 }];
  const allRules = Object.values(rules);
  const base = { mode: 'DEDUCTION', criteria, rules: allRules };
  const items = [item({ criterion_id: 'c1', result: 'CONFORM', evidence_count: 1 }), item({ criterion_id: 'c2', result: null })];
  let o = S.computeAudit(Object.assign({}, base, { items, settings: {} }));
  assert.equal(o.final_score, null);
  assert.equal(o.provisional.score, 10);
  assert.equal(o.coverage.pct, 50);
  assert.equal(o.can_confirm, false);
  const done = [item({ criterion_id: 'c1', result: 'CONFORM', evidence_count: 1 }), item({ criterion_id: 'c2', result: 'CONFORM', auditor_notes: 'สัมภาษณ์แล้ว' })];
  o = S.computeAudit(Object.assign({}, base, { items: done, settings: {} }));
  assert.equal(o.final_score, 15); assert.equal(o.can_confirm, true);
  const rl = [{ status: 'CONFIRMED', clause_code: 'RL1' }, { status: 'CONFIRMED', clause_code: 'RL1' }, { status: 'CONFIRMED', clause_code: 'RL2' }, { status: 'CANDIDATE', clause_code: 'RL3' }];
  o = S.computeAudit(Object.assign({}, base, { items: done, red_lines: rl, settings: { red_line_points: 20 } }));
  assert.equal(o.final_score, null); assert.equal(o.can_confirm, false, 'unknown red line mode holds');
  const t = (mode) => S.computeAudit(Object.assign({}, base, { items: done, red_lines: rl, settings: { red_line_points: 2, red_line_mode: mode } })).final_score;
  assert.equal(t('ONCE'), 13); assert.equal(t('PER_CLAUSE'), 11); assert.equal(t('PER_OCCURRENCE'), 9);
  const neg = S.computeAudit(Object.assign({}, base, { items: done, red_lines: rl, settings: { red_line_points: 20, red_line_mode: 'ONCE' } }));
  assert.equal(neg.final_score, null, 'negative total held without floor decision');
  const floor = S.computeAudit(Object.assign({}, base, { items: done, red_lines: rl, settings: { red_line_points: 20, red_line_mode: 'ONCE', total_floor_zero: true } }));
  assert.equal(floor.final_score, 0);
});

test('sample requirement blocks confirmation until met', () => {
  const o = S.computeAudit({ mode: 'DEDUCTION', criteria: [crit], rules: Object.values(rules), settings: {},
    items: [item({ criterion_id: 'c1', result: 'CONFORM', evidence_count: 1, sample_required: 2, sample_collected: 1 })] });
  assert.equal(o.can_confirm, false);
  assert.match(o.blockers[0].reason, /1\/2/);
});

test('KUP: band score must be inside the chosen band; total only with confirmed formula', () => {
  const bands = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]].map(([min, max]) => ({ min, max }));
  const criteria = [
    { id: 'k1', code: 'K1-1', max_points: 10, dimension_code: 'K1', kup_type: 'C', bands },
    { id: 'k2', code: 'K1-2', max_points: 10, dimension_code: 'K1', kup_type: 'A', bands },
    { id: 'k3', code: 'K2-1', max_points: 10, dimension_code: 'K2', kup_type: 'C', bands },
    { id: 'k4', code: 'K2-2', max_points: 10, dimension_code: 'K2', kup_type: 'A', bands }];
  const dims = [{ code: 'K1', weight: 0.6 }, { code: 'K2', weight: 0.4 }];
  const it = (id, b, s) => item({ criterion_id: id, result: 'CONFORM', band_index: b, band_score: s, evidence_count: 1 });
  const items = [it('k1', 3, 7), it('k2', 2, 5), it('k3', 4, 9), it('k4', 3, 6)];
  assert.equal(S.scoreBandItem(it('k1', 3, 9), criteria[0]).status, 'HELD');
  assert.equal(S.scoreBandItem(item({ result: 'CONFORM', band_index: 3 }), criteria[0]).status, 'PENDING_SCORE');
  let o = S.computeAudit({ mode: 'BAND', criteria, items, dimensions: dims, settings: {} });
  assert.equal(o.final_score, null);
  assert.ok(o.hold_reasons.some((h) => /KUP/.test(h)));
  o = S.computeAudit({ mode: 'BAND', criteria, items, dimensions: dims, settings: { kup_aggregation: 'FILE_WEIGHTS_V1', kup_aggregation_confirmed: true, type_weights: { C: 0.5, A: 0.5 },
    levels: [{ lt: 70, level: 'Basic' }, { min: 70, max: 80, level: 'Standardized' }] } });
  // K1 = 0.5*7+0.5*5 = 6 ; K2 = 0.5*9+0.5*6 = 7.5 ; total = (0.6*6 + 0.4*7.5)*10 = 66
  assert.equal(o.final_score, 66);
  assert.equal(o.level, 'Basic');
});
