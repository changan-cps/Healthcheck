'use strict';
// Import accuracy: compare parsed standards against values read directly from the original workbooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRuntime } = require('./helpers/fake-gas');
const { unzipToStrings } = require('./helpers/unzip');
const { findStandardFiles } = require('./helpers/files');

const files = findStandardFiles();
const rt = createRuntime();
const plain = (x) => JSON.parse(JSON.stringify(x));

function parse(file) {
  const wb = rt.XlsxReader.read(unzipToStrings(fs.readFileSync(file)));
  return { wb, res: plain(rt.StandardParser.parseWorkbook(wb, { fileName: path.basename(file) })) };
}

test('Health Check workbook: sheets, criteria, points, rules, red lines', { skip: !files.hc && 'no file' }, () => {
  const { wb, res } = parse(files.hc);
  assert.equal(wb.sheets.length, 7);
  const kinds = Object.fromEntries(res.sheets.map((s) => [s.name.trim(), s.kind + ':' + (s.level || '')]));
  assert.equal(kinds['班长 Team Lead'], 'HC_LEVEL:TEAM');
  assert.equal(kinds['区长 Group Lead'], 'HC_LEVEL:GROUP');
  assert.equal(kinds['经理 Manager'], 'HC_LEVEL:MANAGER');
  assert.equal(kinds['Y2026 Score Management'], 'POINTS_SCHEME:');

  const team = res.sheets.find((s) => s.level === 'TEAM').candidate;
  assert.equal(team.criteria.length, 15, '14 numbered rows + 1 unnumbered row (R10)');
  assert.equal(team.total_points, 100);
  assert.deepEqual(team.dimensions.map((d) => d.max_points), [10, 25, 10, 15, 25, 15]);
  const sumItems = team.criteria.reduce((a, c) => a + c.max_points, 0);
  assert.equal(sumItems, 100);
  // spot checks against the original cells (values read by openpyxl during review)
  const t01 = team.criteria.find((c) => c.code === 'T-01');
  assert.equal(t01.source_ref.cells.criteria, 'G4');
  assert.match(t01.criteria_text.zh, /未建立交接班记录，不得分/);
  assert.equal(t01.max_points_source, 'DIMENSION_SINGLE_ITEM');
  const r10 = team.criteria.find((c) => c.code === 'T-R10');
  assert.ok(r10.flags.some((f) => f.code === 'SEQ_MISSING'));
  assert.equal(r10.max_points, 3);
  const shared = team.rules.filter((r) => r.source_ref.cell === 'G8');
  assert.equal(shared.length, 2);
  assert.deepEqual(shared[0].criteria_codes, ['T-05', 'T-06', 'T-R10', 'T-07'], 'merged G8:G11 rules shared by 4 items');
  const t03 = team.rules.filter((r) => r.criteria_codes.includes('T-03'));
  assert.deepEqual(t03.map((r) => r.rule_type + ':' + r.points), ['ONCE:5', 'PER_OCCURRENCE:5', 'PER_OCCURRENCE:3']);
  const t08 = team.criteria.find((c) => c.code === 'T-08');
  assert.ok(t08.flags.some((f) => f.code === 'TRANSLATION_MISMATCH'), 'Thai text of 6S rule differs from Chinese');
  assert.equal(team.criteria.find((c) => c.code === 'T-02').sample.count, 2);
  assert.equal(team.criteria.find((c) => c.code === 'T-11').time_hint, '07:55');

  const group = res.sheets.find((s) => s.level === 'GROUP').candidate;
  assert.equal(group.criteria.length, 17);
  assert.equal(group.total_points, 100);
  const missing = group.criteria.filter((c) => c.max_points == null).map((c) => c.code);
  assert.deepEqual(missing, ['G-10', 'G-11', 'G-12', 'G-13']);
  assert.ok(group.flags.filter((f) => f.code === 'DIMENSION_ITEMS_UNSPLIT').length === 2);
  assert.equal(group.criteria.find((c) => c.code === 'G-06').sample.per, 'TEAM');

  const mgr = res.sheets.find((s) => s.level === 'MANAGER').candidate;
  assert.equal(mgr.criteria.length, 17, 'items 1–15, 17, 18 (16 is missing in the file)');
  assert.ok(mgr.flags.some((f) => f.code === 'SEQ_GAP' && /15 ไป 17/.test(f.message_th)));

  const rl = res.red_lines;
  assert.equal(rl.clauses.length, 4);
  assert.equal(rl.penalty, 20);
  assert.equal(rl.penalty_ref.cell, 'B15');
  assert.match(rl.clauses[0].text.zh, /作业指导书不一致/);
  assert.ok(rl.clauses.every((c) => c.text.th), 'Thai translation attached to each clause');
  assert.ok(rl.flags.some((f) => f.code === 'REDLINE_MODE_UNCLEAR'));
  assert.deepEqual(res.composite_weights.map((w) => w.weight), [0.3, 0.2, 0.2, 0.3]);
});

test('KUP workbook: 46 criteria, 5 bands, weights, hidden duplicate sheet, formula checks', { skip: !files.kup && 'no file' }, () => {
  const { res } = parse(files.kup);
  const main = res.sheets.find((s) => s.level === 'KUP' && !s.hidden);
  const hidden = res.sheets.find((s) => s.level === 'KUP' && s.hidden);
  assert.ok(main && hidden);
  const k = main.candidate;
  assert.equal(k.criteria.length, 46);
  assert.deepEqual(k.bands.map((b) => [b.min, b.max]), [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10]]);
  assert.deepEqual(k.dimensions.map((d) => d.weight), [0.15, 0.15, 0.14, 0.14, 0.14, 0.14, 0.14]);
  assert.deepEqual(k.dimensions.map((d) => d.criteria.length), [5, 6, 5, 8, 6, 9, 7]);
  assert.equal(k.type_weights.C.weight, 0.5);
  assert.equal(k.type_weights.A.weight, 0.5);
  const types = k.criteria.reduce((o, c) => { o[c.kup_type] = (o[c.kup_type] || 0) + 1; return o; }, {});
  assert.deepEqual(types, { C: 26, A: 20 });
  assert.equal(k.criteria[0].source_ref.cells.standard, 'B11');
  assert.match(k.criteria[0].bands[0].text, /^a\) ไม่ได้นำปัญหา/);
  assert.equal(k.criteria[0].bands[0].source_ref.cell, 'M11');
  const bad = k.formula_checks.filter((f) => !f.ok).map((f) => f.ref);
  assert.ok(bad.includes('T6'), 'file formula T6 uses the wrong row range');
  assert.ok(k.flags.some((f) => f.code === 'KUP_AGGREGATION_UNDEFINED'));
  assert.ok(hidden.candidate.flags.some((f) => f.code === 'EXISTING_SCORES_IGNORED'));
  assert.equal(res.similar_groups.length, 1);
  assert.equal(res.similar_groups[0].recommended_index, main.index);
  assert.equal(res.similar_groups[0].diff.changed.length, 1);
  assert.equal(k.levels.length, 4);
  const os = res.sheets.filter((s) => s.kind === 'OS_BAND');
  assert.equal(os.length, 4, 'QOS/MOS/COS/DOS listed as not supported in v1');
});

test('rule classifier never invents a number', () => {
  const c = rt.StandardParser.classify;
  assert.equal(c('发现一个问题扣3分').rule_type, 'PER_OCCURRENCE');
  assert.equal(c('会议未开或时间不正确，扣5分').rule_type, 'ONCE');
  assert.equal(c('未建立交接班记录，不得分').rule_type, 'ZERO_SCORE');
  assert.equal(c('能完整答出且逻辑清楚、正确，不扣分').rule_type, 'NO_DEDUCTION');
  const u = c('情况严重的酌情扣分');
  assert.equal(u.parse_status, 'NEEDS_REVIEW');
  assert.equal(u.points, null);
  assert.equal(c('其他说明'), null);
});
