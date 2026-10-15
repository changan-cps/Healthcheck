/**
 * Dashboard API — filters: from, to, quarter (YYYY-Qn), workshop_id, group_id, team_id, audit_type, kup_dimension, include_demo.
 */
function quarterRange_(q) {
  var m = /^(\d{4})-Q([1-4])$/.exec(q || '');
  if (!m) return null;
  var y = Number(m[1]), n = Number(m[2]);
  var sm = (n - 1) * 3 + 1, em = sm + 2;
  var last = new Date(y, em, 0).getDate();
  return { from: y + '-' + ('0' + sm).slice(-2) + '-01', to: y + '-' + ('0' + em).slice(-2) + '-' + last };
}

function apiDashboard(token, filters) {
  return guard_(token, function (u) {
    Permissions.assert(u, 'dashboard.view');
    filters = JSON.parse(JSON.stringify(filters || {}));
    var q = quarterRange_(filters.quarter);
    if (q) { filters.from = filters.from && filters.from > q.from ? filters.from : q.from; filters.to = filters.to && filters.to < q.to ? filters.to : q.to; }
    var audits = Db.find('audits', function (a) {
      if (!Permissions.can(u, 'audit.view', { workshop_id: a.workshop_id, audit_status: a.status })) return false;
      if (!filters.include_demo && a.is_demo) return false;
      if (filters.workshop_id && a.workshop_id !== filters.workshop_id) return false;
      if (filters.group_id && a.group_id !== filters.group_id) return false;
      if (filters.team_id && a.team_id !== filters.team_id) return false;
      if (filters.audit_type && a.audit_type !== filters.audit_type) return false;
      if (filters.from && a.audit_date < filters.from) return false;
      if (filters.to && a.audit_date > filters.to) return false;
      return a.status !== 'CANCELLED';
    });
    var findings = visibleFindings_(u, { workshop_id: filters.workshop_id, group_id: filters.group_id, team_id: filters.team_id, audit_type: filters.audit_type,
      from: filters.from, to: filters.to, include_demo: filters.include_demo, dimension_code: filters.kup_dimension || '' });
    var sets = indexById_(Db.all('standard_sets'));
    var versions = {}, dimNames = {};
    Db.all('standard_versions').forEach(function (v) {
      var s = sets[v.standard_set_id] || {};
      versions[v.id] = { label: (s.code || '') + ' ' + v.version_label, level: s.level };
      (v.dimensions || []).forEach(function (d) { dimNames[s.level + '|' + d.code] = d.name ? (d.name.th ? d.name.th.split('\n')[0] : (d.name.zh || d.name.raw || d.code)) : d.code; });
    });
    var soon = Utilities.formatDate(new Date(Date.now() + 7 * 86400000), 'Asia/Bangkok', 'yyyy-MM-dd');
    var calc = DashboardCalc.compute(audits, findings, { today: todayBkk_(), soon: soon, versions: versions, workshops: indexById_(Db.all('workshops')), dimensions: dimNames });
    // score table per team/group (latest confirmed per unit and version)
    var ts = indexById_(Db.all('teams')), gs = indexById_(Db.all('groups')), ws = indexById_(Db.all('workshops'));
    var latest = {};
    audits.filter(function (a) { return a.status === 'CONFIRMED'; }).forEach(function (a) {
      var unit = a.audit_type === 'TEAM' ? a.team_id : a.audit_type === 'GROUP' ? a.group_id : a.workshop_id;
      var k = a.audit_type + '|' + unit + '|' + a.standard_version_id;
      if (!latest[k] || String(a.audit_date) > String(latest[k].audit_date)) latest[k] = a;
    });
    calc.unit_table = Object.keys(latest).map(function (k) {
      var a = latest[k];
      return { audit_id: a.id, audit_no: a.audit_no, audit_type: a.audit_type, workshop: (ws[a.workshop_id] || {}).code, unit: a.audit_type === 'TEAM' ? (ts[a.team_id] || {}).name : a.audit_type === 'GROUP' ? (gs[a.group_id] || {}).name : (ws[a.workshop_id] || {}).code,
        version: versions[a.standard_version_id].label, date: a.audit_date, scope_mode: a.scope_mode, final_score: a.final_score, final_of_max: a.final_of_max,
        pct: DashboardCalc.pct(a.final_score, a.final_of_max), coverage_pct: a.coverage_pct,
        kup_categories: a.audit_type === 'KUP' && a.score_detail ? a.score_detail.categories : null, level: a.score_detail ? a.score_detail.level : null };
    }).sort(function (x, y) { return String(x.workshop + x.unit).localeCompare(String(y.workshop + y.unit)); });
    calc.filters_applied = filters;
    calc.generated_at = nowIso_();
    return calc;
  });
}
