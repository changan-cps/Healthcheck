/**
 * DashboardCalc — pure aggregation so dashboard numbers can be tested against
 * the underlying rows. Rules:
 *  - averages only from CONFIRMED + FULL-scope audits with a final score
 *  - comparisons only within one standard version (different versions are listed separately)
 *  - "no data" is null, never 0 / 100 %
 */
var DashboardCalc = (function () {
  'use strict';

  function pct(score, of) { return (typeof score === 'number' && of > 0) ? Math.round(score / of * 10000) / 100 : null; }
  function mean(list) { return list.length ? Math.round(list.reduce(function (a, b) { return a + b; }, 0) / list.length * 100) / 100 : null; }

  function compute(audits, findings, opts) {
    opts = opts || {};
    var today = opts.today;
    var versions = opts.versions || {};
    var workshops = opts.workshops || {};
    var dims = opts.dimensions || {};
    var out = {};
    out.audit_counts = {
      total: audits.length,
      in_progress: audits.filter(function (a) { return a.status === 'DRAFT' || a.status === 'IN_PROGRESS'; }).length,
      confirmed: audits.filter(function (a) { return a.status === 'CONFIRMED'; }).length
    };
    var eligible = audits.filter(function (a) { return a.status === 'CONFIRMED' && a.scope_mode === 'FULL' && typeof a.final_score === 'number' && a.final_of_max > 0; });
    out.excluded_from_average = audits.filter(function (a) { return a.status === 'CONFIRMED' && eligible.indexOf(a) < 0; }).length;
    var byVersion = {};
    eligible.forEach(function (a) { (byVersion[a.standard_version_id] = byVersion[a.standard_version_id] || []).push(a); });
    out.by_version = Object.keys(byVersion).map(function (vid) {
      var list = byVersion[vid];
      var v = versions[vid] || {};
      var byWs = {};
      list.forEach(function (a) { (byWs[a.workshop_id] = byWs[a.workshop_id] || []).push(pct(a.final_score, a.final_of_max)); });
      return {
        standard_version_id: vid, label: v.label || vid, level: v.level || '', audits: list.length,
        average_pct: mean(list.map(function (a) { return pct(a.final_score, a.final_of_max); })),
        by_workshop: Object.keys(byWs).map(function (w) { return { workshop_id: w, workshop: (workshops[w] || {}).code || w, average_pct: mean(byWs[w]), audits: byWs[w].length }; })
          .sort(function (x, y) { return String(x.workshop).localeCompare(String(y.workshop)); }),
        trend: list.slice().sort(function (x, y) { return String(x.audit_date + x.confirmed_at).localeCompare(String(y.audit_date + y.confirmed_at)); })
          .map(function (a) { return { audit_id: a.id, audit_no: a.audit_no, date: a.audit_date, pct: pct(a.final_score, a.final_of_max), workshop: (workshops[a.workshop_id] || {}).code || '' }; })
      };
    }).sort(function (a, b) { return b.audits - a.audits; });
    out.comparable = out.by_version.length <= 1;
    out.average_pct = out.by_version.length === 1 ? out.by_version[0].average_pct : null;
    out.average_note = !eligible.length ? 'ยังไม่มีรอบตรวจที่ยืนยันแล้วแบบตรวจเต็ม' : out.by_version.length > 1 ? 'มีหลายมาตรฐาน/เวอร์ชันในตัวกรอง — แสดงค่าเฉลี่ยแยกตามเวอร์ชัน ไม่รวมกัน' : '';

    var open = findings.filter(function (f) { return f.status !== 'CLOSED'; });
    var closed = findings.filter(function (f) { return f.status === 'CLOSED'; });
    var overdue = findings.filter(function (f) { return f.status !== 'CLOSED' && f.due_date && f.due_date < today; });
    out.finding_counts = { total: findings.length, open: open.length, overdue: overdue.length, closed: closed.length,
      pending_verify: findings.filter(function (f) { return f.status === 'FIXED_PENDING_VERIFY'; }).length };
    out.closure_rate = { numerator: closed.length, denominator: findings.length, pct: findings.length ? Math.round(closed.length / findings.length * 10000) / 100 : null };

    var byDim = {};
    findings.forEach(function (f) {
      var key = f.audit_type + '|' + f.dimension_code;
      byDim[key] = byDim[key] || { key: key, audit_type: f.audit_type, dimension_code: f.dimension_code, name: (dims[key] || (f.dimension_code === 'RED_LINE' ? 'Red Line' : f.dimension_code)), count: 0 };
      byDim[key].count++;
    });
    var pareto = Object.keys(byDim).map(function (k) { return byDim[k]; }).sort(function (a, b) { return b.count - a.count; });
    var cum = 0;
    pareto.forEach(function (p) { cum += p.count; p.cumulative_pct = Math.round(cum / findings.length * 10000) / 100; });
    out.pareto = pareto;

    out.urgent = open.filter(function (f) { return f.is_red_line || (f.due_date && f.due_date <= (opts.soon || today)); })
      .sort(function (a, b) { return (b.is_red_line - a.is_red_line) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')); }).slice(0, 20);
    out.unassigned = open.filter(function (f) { return !f.due_date || !f.owner_name; }).length;
    return out;
  }

  return { compute: compute, pct: pct, mean: mean };
})();
