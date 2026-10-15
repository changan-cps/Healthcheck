/**
 * Scoring — deterministic scoring engine, independent of AI.
 *
 * The engine only applies rules that exist in the published standard version.
 * Whenever a rule is ambiguous (not resolved by an Admin) the engine HOLDS the
 * final score instead of guessing. Missing evidence is never 0 and never pass.
 */
var Scoring = (function () {
  'use strict';

  var ENGINE_VERSION = 'scoring-1.0.0';

  var HOLD = {
    MAX_POINTS_MISSING: 'ข้อนี้ยังไม่มีคะแนนเต็ม (ต้องตรวจทานเกณฑ์)',
    RULE_NOT_IN_CRITERION: 'อ้างกฎที่ไม่ใช่ของข้อนี้',
    RULE_UNKNOWN: 'ไม่พบกฎที่อ้างถึงในมาตรฐานเวอร์ชันนี้',
    RULE_NEEDS_REVIEW: 'กฎที่ใช้ยังรอการตรวจทานจาก Admin',
    ISSUE_RULE_CONFLICT: 'ปัญหาเดียวกันถูกจับคู่กับกฎต่างกัน — ผู้ตรวจต้องเลือกกฎเดียว',
    NEGATIVE_ITEM: 'คะแนนหักเกินคะแนนเต็ม และมาตรฐานยังไม่ได้ยืนยันว่าคะแนนต่ำสุดเป็น 0',
    CONFORM_WITH_ISSUES: 'ผลเป็น "สอดคล้อง" แต่มีรายการปัญหา — ต้องแก้ให้ตรงกัน',
    NONCONFORM_WITHOUT_ISSUE: 'ผลเป็น "ไม่สอดคล้อง" แต่ยังไม่ระบุปัญหา/กฎที่หัก',
    OVERRIDE_REASON_MISSING: 'แก้คะแนนต่างจากที่คำนวณ แต่ยังไม่ระบุเหตุผล',
    OVERRIDE_OUT_OF_RANGE: 'คะแนนที่แก้อยู่นอกช่วง 0 ถึงคะแนนเต็ม',
    BAND_SCORE_MISSING: 'ยังไม่ได้เลือกคะแนนในช่วง (AI เสนอได้เพียงช่วงคะแนน)',
    BAND_SCORE_OUT_OF_BAND: 'คะแนนไม่อยู่ในช่วงที่เลือก',
    BAND_INDEX_INVALID: 'ช่วงคะแนนที่เลือกไม่มีในมาตรฐาน',
    REDLINE_MODE_UNDEFINED: 'พบ Red Line แต่ยังไม่ได้กำหนดวิธีนับการหัก (ครั้งเดียว/ต่อข้อ/ต่อครั้งที่พบ)',
    REDLINE_POINTS_UNDEFINED: 'พบ Red Line แต่ยังไม่มีจำนวนคะแนนที่หัก',
    NEGATIVE_TOTAL: 'คะแนนรวมติดลบหลังหัก Red Line และยังไม่ได้ยืนยันว่าคะแนนต่ำสุดเป็น 0',
    KUP_AGGREGATION_UNDEFINED: 'ยังไม่ได้ยืนยันสูตรรวมคะแนน KUP (ต้องตรวจทานเกณฑ์)',
    KUP_TYPE_WEIGHT_MISSING: 'ไม่พบน้ำหนักประเภท C/A ที่ใช้ในสูตร',
    KUP_CATEGORY_WEIGHT_MISSING: 'ไม่พบน้ำหนักหมวด'
  };

  function round2(x) { return Math.round(x * 100) / 100; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  function indexBy(list, key) {
    var m = {};
    (list || []).forEach(function (x) { m[x[key]] = x; });
    return m;
  }

  /**
   * Score a deduction-mode item (Team / Group / Manager).
   * item.result: CONFORM | NONCONFORM | INSUFFICIENT | null
   * item.issues: [{issue_key, rule_id, evidence_ids}]
   */
  function scoreDeductionItem(item, criterion, rulesById, settings) {
    var out = { criterion_id: criterion.id, code: criterion.code, max_points: criterion.max_points, status: null,
      computed_score: null, score: null, deductions: [], hold_reasons: [], zero_rule_id: null };
    if (item.in_scope === false) { out.status = 'OUT_OF_SCOPE'; return out; }
    if (item.exemption_status === 'APPROVED') { out.status = 'EXEMPT'; return out; }
    if (!item.result) { out.status = 'NOT_STARTED'; return out; }
    if (item.result === 'INSUFFICIENT') { out.status = 'INSUFFICIENT'; return out; }
    if (!isNum(criterion.max_points)) out.hold_reasons.push(HOLD.MAX_POINTS_MISSING);

    var issues = item.issues || [];
    if (item.result === 'CONFORM' && issues.length) out.hold_reasons.push(HOLD.CONFORM_WITH_ISSUES);
    if (item.result === 'NONCONFORM' && !issues.length) out.hold_reasons.push(HOLD.NONCONFORM_WITHOUT_ISSUE);

    // group by issue_key → one issue deducts once regardless of evidence count
    var byKey = {}, order = [];
    issues.forEach(function (is) {
      var k = String(is.issue_key || '').trim();
      if (!k) k = '__noKey_' + order.length;
      if (!byKey[k]) { byKey[k] = { issue_key: k, rule_ids: {}, evidence_ids: {} }; order.push(k); }
      byKey[k].rule_ids[is.rule_id] = true;
      (is.evidence_ids || []).forEach(function (e) { byKey[k].evidence_ids[e] = true; });
    });

    var onceApplied = {};
    var total = 0;
    var zero = false;
    order.forEach(function (k) {
      var g = byKey[k];
      var ruleIds = Object.keys(g.rule_ids);
      if (ruleIds.length > 1) { out.hold_reasons.push(HOLD.ISSUE_RULE_CONFLICT + ' (' + k + ')'); return; }
      var rule = rulesById[ruleIds[0]];
      if (!rule) { out.hold_reasons.push(HOLD.RULE_UNKNOWN + ' (' + ruleIds[0] + ')'); return; }
      if ((rule.criterion_ids || []).indexOf(criterion.id) < 0) { out.hold_reasons.push(HOLD.RULE_NOT_IN_CRITERION + ' (' + rule.rule_code + ')'); return; }
      if (rule.parse_status === 'NEEDS_REVIEW') { out.hold_reasons.push(HOLD.RULE_NEEDS_REVIEW + ' (' + rule.rule_code + ')'); return; }
      var d = { issue_key: k, rule_id: rule.id, rule_code: rule.rule_code, rule_type: rule.rule_type, points: 0, evidence_ids: Object.keys(g.evidence_ids) };
      if (rule.rule_type === 'ZERO_SCORE') { zero = true; out.zero_rule_id = rule.id; }
      else if (rule.rule_type === 'PER_OCCURRENCE') d.points = rule.points;
      else if (rule.rule_type === 'ONCE') {
        if (onceApplied[rule.id]) { d.points = 0; d.note = 'กฎนี้หักครั้งเดียว — นับแล้วในปัญหาก่อนหน้า'; }
        else { d.points = rule.points; onceApplied[rule.id] = true; }
      } else if (rule.rule_type === 'NO_DEDUCTION') d.points = 0;
      else { out.hold_reasons.push(HOLD.RULE_NEEDS_REVIEW + ' (' + rule.rule_code + ')'); return; }
      total += d.points;
      out.deductions.push(d);
    });

    if (isNum(criterion.max_points)) {
      var raw = zero ? 0 : criterion.max_points - total;
      if (raw < 0) {
        if (settings.item_floor_zero === true) { out.computed_score = 0; out.floor_applied = true; }
        else out.hold_reasons.push(HOLD.NEGATIVE_ITEM + ' (' + round2(raw) + ')');
      } else out.computed_score = round2(raw);
    }
    applyOverride(out, item, criterion.max_points);
    out.status = out.hold_reasons.length ? 'HELD' : 'SCORED';
    if (out.status === 'HELD') out.score = null;
    return out;
  }

  function applyOverride(out, item, max) {
    out.score = out.computed_score;
    if (item.override_score == null || item.override_score === '') return;
    var v = Number(item.override_score);
    if (!isNum(v) || v < 0 || (isNum(max) && v > max)) { out.hold_reasons.push(HOLD.OVERRIDE_OUT_OF_RANGE); return; }
    if (out.computed_score !== null && v === out.computed_score) return;
    if (!item.override_reason || !String(item.override_reason).trim()) { out.hold_reasons.push(HOLD.OVERRIDE_REASON_MISSING); return; }
    out.overridden = true;
    out.override_from = out.computed_score;
    out.score = round2(v);
  }

  /** Score a band-mode (KUP) item: auditor picks band + point within band. */
  function scoreBandItem(item, criterion) {
    var out = { criterion_id: criterion.id, code: criterion.code, max_points: criterion.max_points, status: null, score: null,
      band_index: item.band_index, hold_reasons: [], kup_type: criterion.kup_type, dimension_code: criterion.dimension_code };
    if (item.in_scope === false) { out.status = 'OUT_OF_SCOPE'; return out; }
    if (item.exemption_status === 'APPROVED') { out.status = 'EXEMPT'; return out; }
    if (!item.result) { out.status = 'NOT_STARTED'; return out; }
    if (item.result === 'INSUFFICIENT') { out.status = 'INSUFFICIENT'; return out; }
    var bands = criterion.bands || [];
    var b = bands[item.band_index];
    if (item.band_index == null || !b) { out.hold_reasons.push(item.band_index == null ? HOLD.BAND_SCORE_MISSING : HOLD.BAND_INDEX_INVALID); }
    else if (item.band_score == null || item.band_score === '') out.hold_reasons.push(HOLD.BAND_SCORE_MISSING);
    else {
      var v = Number(item.band_score);
      if (!isNum(v) || v < b.min || v > b.max) out.hold_reasons.push(HOLD.BAND_SCORE_OUT_OF_BAND + ' (' + b.min + '–' + b.max + ')');
      else { out.score = round2(v); out.band = { min: b.min, max: b.max }; }
    }
    if (out.hold_reasons.length) { out.status = item.band_index == null || item.band_score == null || item.band_score === '' ? 'PENDING_SCORE' : 'HELD'; out.score = null; }
    else out.status = 'SCORED';
    return out;
  }

  /**
   * Evidence completeness for one item: at least one evidence/note, and sample
   * requirement met when the standard defines one.
   */
  function evidenceStatus(item, criterion) {
    var count = item.evidence_count || 0;
    var hasNote = !!(item.auditor_notes && String(item.auditor_notes).trim());
    var req = item.sample_required != null ? item.sample_required : null;
    var got = item.sample_collected || 0;
    var ok = (count > 0 || hasNote) && (req == null || got >= req);
    return { evidence_count: count, has_note: hasNote, sample_required: req, sample_collected: got, complete: ok };
  }

  /**
   * Compute audit totals.
   * @param {Object} p {mode:'DEDUCTION'|'BAND', settings, criteria, rules, items, red_lines, dimensions}
   */
  function computeAudit(p) {
    var settings = p.settings || {};
    var critById = indexBy(p.criteria, 'id');
    var rulesById = indexBy(p.rules, 'id');
    var itemsByCrit = indexBy(p.items, 'criterion_id');
    var results = [];
    var blockers = [];
    var holdReasons = [];

    (p.criteria || []).forEach(function (c) {
      var item = itemsByCrit[c.id] || { criterion_id: c.id, in_scope: false };
      var r = p.mode === 'BAND' ? scoreBandItem(item, c) : scoreDeductionItem(item, c, rulesById, settings);
      r.evidence = evidenceStatus(item, c);
      r.in_scope = item.in_scope !== false;
      results.push(r);
    });

    var inScope = results.filter(function (r) { return r.in_scope; });
    var counted = inScope.filter(function (r) { return r.status !== 'EXEMPT'; });
    var scored = counted.filter(function (r) { return r.status === 'SCORED'; });
    var covered = inScope.filter(function (r) { return r.status === 'EXEMPT' || (r.status === 'SCORED' && r.evidence.complete); });
    var totalCount = (p.criteria || []).length;

    inScope.forEach(function (r) {
      if (r.status === 'NOT_STARTED') blockers.push({ code: r.code, reason: 'ยังไม่ได้ตรวจ' });
      else if (r.status === 'INSUFFICIENT') blockers.push({ code: r.code, reason: 'หลักฐานไม่พอ — ต้องเก็บเพิ่มหรือขออนุมัติยกเว้น' });
      else if (r.status === 'HELD' || r.status === 'PENDING_SCORE') blockers.push({ code: r.code, reason: r.hold_reasons.join('; ') });
      else if (r.status === 'SCORED' && !r.evidence.complete) {
        var e = r.evidence;
        blockers.push({ code: r.code, reason: e.sample_required != null && e.sample_collected < e.sample_required ?
          'ตัวอย่างยังไม่ครบ (' + e.sample_collected + '/' + e.sample_required + ')' : 'ยังไม่มีหลักฐานหรือบันทึกประกอบ' });
      }
    });

    var sumScore = scored.reduce(function (a, r) { return a + r.score; }, 0);
    var scoredMax = scored.reduce(function (a, r) { return a + (r.max_points || 0); }, 0);
    var countedMax = counted.reduce(function (a, r) { return a + (isNum(r.max_points) ? r.max_points : 0); }, 0);
    var fullMax = (p.criteria || []).reduce(function (a, c) { return a + (isNum(c.max_points) ? c.max_points : 0); }, 0);
    var isPartialScope = inScope.length < totalCount;

    var out = {
      engine_version: ENGINE_VERSION, mode: p.mode,
      items: results,
      counts: { total_criteria: totalCount, in_scope: inScope.length, scored: scored.length, covered: covered.length,
        exempt: inScope.filter(function (r) { return r.status === 'EXEMPT'; }).length,
        not_started: inScope.filter(function (r) { return r.status === 'NOT_STARTED'; }).length,
        insufficient: inScope.filter(function (r) { return r.status === 'INSUFFICIENT'; }).length,
        held: inScope.filter(function (r) { return r.status === 'HELD' || r.status === 'PENDING_SCORE'; }).length },
      coverage: { covered: covered.length, required: inScope.length, pct: inScope.length ? round2(covered.length / inScope.length * 100) : null },
      is_partial_scope: isPartialScope,
      provisional: { score: scored.length ? round2(sumScore) : null, of_max: round2(scoredMax), note: 'คะแนนชั่วคราวจากข้อที่ให้คะแนนแล้ว ' + scored.length + '/' + counted.length + ' ข้อ' },
      in_scope_max: round2(countedMax), full_max: round2(fullMax),
      red_line: null, final_score: null, final_status: 'PROVISIONAL', hold_reasons: holdReasons, blockers: blockers, level: null
    };

    if (p.mode === 'BAND') computeKupTotals(out, p, results, settings);
    else computeDeductionTotals(out, p, settings, sumScore);

    var allCovered = covered.length === inScope.length && inScope.length > 0;
    out.can_confirm = allCovered && !holdReasons.length && blockers.length === 0;
    if (!inScope.length) out.blockers.push({ code: '-', reason: 'ไม่มีข้อที่อยู่ในขอบเขตการตรวจ' });
    if (allCovered && !holdReasons.length && out.final_score != null) out.final_status = 'READY';
    else if (holdReasons.length) out.final_status = 'HELD';
    if (!allCovered) out.final_score = null;
    return out;
  }

  function computeDeductionTotals(out, p, settings, sumScore) {
    var confirmed = (p.red_lines || []).filter(function (r) { return r.status === 'CONFIRMED'; });
    var rl = { confirmed_count: confirmed.length, clauses: {}, deduction: 0, held: false, mode: settings.red_line_mode || null, points: settings.red_line_points };
    confirmed.forEach(function (r) { rl.clauses[r.clause_code] = (rl.clauses[r.clause_code] || 0) + 1; });
    rl.distinct_clauses = Object.keys(rl.clauses).length;
    if (confirmed.length) {
      if (!settings.red_line_mode) { rl.held = true; out.hold_reasons.push(HOLD.REDLINE_MODE_UNDEFINED); }
      else if (!isNum(settings.red_line_points)) { rl.held = true; out.hold_reasons.push(HOLD.REDLINE_POINTS_UNDEFINED); }
      else {
        var n = settings.red_line_mode === 'ONCE' ? 1 : settings.red_line_mode === 'PER_CLAUSE' ? rl.distinct_clauses : confirmed.length;
        rl.deduction = n * settings.red_line_points;
      }
    }
    out.red_line = rl;
    if (rl.held) return;
    var total = round2(sumScore - rl.deduction);
    if (total < 0) {
      if (settings.total_floor_zero === true) total = 0;
      else { out.hold_reasons.push(HOLD.NEGATIVE_TOTAL); return; }
    }
    out.final_score = total;
    out.final_of_max = out.in_scope_max;
  }

  /**
   * KUP totals use only an Admin-confirmed aggregation. The only formula the
   * system offers ('FILE_WEIGHTS_V1') uses weights read from the file:
   *   category = Σ_type w_type × mean(item scores of that type)
   *   total    = Σ_category w_category × category × 10   (0–100)
   */
  function computeKupTotals(out, p, results, settings) {
    var agg = settings.kup_aggregation;
    out.categories = (p.dimensions || []).map(function (d) {
      var its = results.filter(function (r) { return r.dimension_code === d.code && r.in_scope; });
      return { code: d.code, name: d.name, weight: d.weight, items: its.length,
        scored: its.filter(function (r) { return r.status === 'SCORED'; }).length, score: null };
    });
    if (agg !== 'FILE_WEIGHTS_V1' || settings.kup_aggregation_confirmed !== true) { out.hold_reasons.push(HOLD.KUP_AGGREGATION_UNDEFINED); return; }
    var tw = settings.type_weights || {};
    if (!isNum(tw.C) || !isNum(tw.A)) { out.hold_reasons.push(HOLD.KUP_TYPE_WEIGHT_MISSING); return; }
    if (out.is_partial_scope) { out.hold_reasons.push('สูตร KUP ต้องตรวจครบทุกข้อในทุกหมวด — รอบตรวจบางส่วนแสดงได้เฉพาะคะแนนรายข้อ'); return; }
    var total = 0, okAll = true;
    out.categories.forEach(function (cat) {
      var its = results.filter(function (r) { return r.dimension_code === cat.code && r.in_scope && r.status === 'SCORED'; });
      if (its.length !== cat.items) { okAll = false; return; }
      if (!isNum(cat.weight)) { okAll = false; out.hold_reasons.push(HOLD.KUP_CATEGORY_WEIGHT_MISSING + ' (' + cat.code + ')'); return; }
      var s = 0, wsum = 0;
      ['C', 'A'].forEach(function (t) {
        var list = its.filter(function (r) { return r.kup_type === t; });
        if (!list.length) return;
        var mean = list.reduce(function (a, r) { return a + r.score; }, 0) / list.length;
        s += tw[t] * mean; wsum += tw[t];
      });
      if (Math.abs(wsum - 1) > 1e-9) { okAll = false; out.hold_reasons.push('หมวด ' + cat.code + ' ไม่มีข้อครบทั้งประเภท C และ A ตามสูตร'); return; }
      cat.score = round2(s);
      total += cat.weight * s * 10;
    });
    if (!okAll) return;
    out.final_score = round2(total);
    out.final_of_max = 100;
    out.level = kupLevel(out.final_score, settings.levels);
  }

  function kupLevel(score, levels) {
    if (!levels || !isNum(score)) return null;
    for (var i = 0; i < levels.length; i++) {
      var L = levels[i];
      if (isNum(L.min) && isNum(L.max) && score >= L.min && (score < L.max || (L.max >= 100 && score <= L.max))) return L.level;
      if (L.lt != null && score < L.lt) return L.level;
    }
    return null;
  }

  return { ENGINE_VERSION: ENGINE_VERSION, HOLD: HOLD, computeAudit: computeAudit, scoreDeductionItem: scoreDeductionItem, scoreBandItem: scoreBandItem, evidenceStatus: evidenceStatus, kupLevel: kupLevel };
})();
