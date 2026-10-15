/* Small accessible SVG charts (no external library). Every chart has a text table fallback. */
(function () {
  'use strict';
  var App = window.App, esc = App.esc;
  var C = App.Charts = {};

  function axisTicks(max) { var step = max <= 20 ? 5 : max <= 50 ? 10 : 20; var out = []; for (var v = 0; v <= max + 1e-9; v += step) out.push(v); return out; }

  /** Horizontal bars: rows [{label, value, note, href}] value 0–max */
  C.hbars = function (rows, opts) {
    opts = opts || {};
    var max = opts.max || Math.max.apply(null, rows.map(function (r) { return r.value || 0; }).concat([1]));
    return '<div class="hbars" role="list" aria-label="' + esc(opts.label || '') + '">' + rows.map(function (r) {
      var w = r.value == null ? 0 : Math.max(0, Math.min(100, r.value / max * 100));
      var inner = '<span class="hb-label">' + esc(r.label) + '</span><span class="hb-track"><span class="hb-fill' + (r.tone ? ' hb-' + r.tone : '') + '" style="width:' + w + '%"></span></span>' +
        '<span class="hb-val">' + (r.value == null ? 'ไม่มีข้อมูล' : App.num(r.value, 1) + (opts.suffix || '')) + (r.note ? '<small>' + esc(r.note) + '</small>' : '') + '</span>';
      return r.href ? '<a role="listitem" class="hb-row" href="' + esc(r.href) + '">' + inner + '</a>' : '<div role="listitem" class="hb-row">' + inner + '</div>';
    }).join('') + '</div>';
  };

  /** Line chart for trend: points [{label, value, href}] */
  C.line = function (points, opts) {
    opts = opts || {};
    if (!points.length) return App.empty('ยังไม่มีข้อมูลแนวโน้ม', 'ต้องมีรอบตรวจที่ยืนยันแล้วแบบตรวจเต็มอย่างน้อย 1 รอบ');
    var W = 640, H = 220, pl = 36, pr = 12, pt = 12, pb = 34;
    var max = opts.max || 100;
    var x = function (i) { return points.length === 1 ? (pl + (W - pl - pr) / 2) : pl + i * (W - pl - pr) / (points.length - 1); };
    var y = function (v) { return pt + (H - pt - pb) * (1 - v / max); };
    var grid = axisTicks(max).map(function (t) { return '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t) + '" y2="' + y(t) + '" class="grid"/><text x="' + (pl - 6) + '" y="' + (y(t) + 4) + '" class="tick" text-anchor="end">' + t + '</text>'; }).join('');
    var path = points.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.value).toFixed(1); }).join(' ');
    var dots = points.map(function (p, i) {
      var c = '<circle cx="' + x(i) + '" cy="' + y(p.value) + '" r="5" class="dot"><title>' + esc(p.label + ': ' + App.num(p.value, 1) + '%') + '</title></circle>';
      return p.href ? '<a href="' + esc(p.href) + '" aria-label="' + esc(p.label + ' ' + App.num(p.value, 1) + '%') + '">' + c + '</a>' : c;
    }).join('');
    var labels = points.map(function (p, i) { return (points.length <= 8 || i % Math.ceil(points.length / 8) === 0) ? '<text x="' + x(i) + '" y="' + (H - 12) + '" class="tick" text-anchor="middle">' + esc(p.short || p.label) + '</text>' : ''; }).join('');
    return '<figure class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'แนวโน้มคะแนน') + '">' + grid + '<path d="' + path + '" class="line"/>' + dots + labels + '</svg>' +
      '<details class="chart-table"><summary>ดูเป็นตาราง</summary><table class="tbl"><thead><tr><th>รอบตรวจ</th><th class="num">คะแนน (%)</th></tr></thead><tbody>' +
      points.map(function (p) { return '<tr><td>' + esc(p.label) + '</td><td class="num">' + App.num(p.value, 1) + '</td></tr>'; }).join('') + '</tbody></table></details></figure>';
  };

  /** Pareto: bars (count) + cumulative % line */
  C.pareto = function (rows, opts) {
    opts = opts || {};
    if (!rows.length) return App.empty('ยังไม่มีปัญหาในตัวกรองนี้', '');
    var W = 640, H = 240, pl = 32, pr = 40, pt = 12, pb = 56;
    var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
    var bw = (W - pl - pr) / rows.length;
    var y = function (v) { return pt + (H - pt - pb) * (1 - v / max); };
    var yp = function (p) { return pt + (H - pt - pb) * (1 - p / 100); };
    var bars = rows.map(function (r, i) {
      var bx = pl + i * bw + bw * 0.15, h = H - pb - y(r.count);
      var rect = '<rect x="' + bx + '" y="' + y(r.count) + '" width="' + (bw * 0.7) + '" height="' + h + '" class="bar"><title>' + esc(r.name + ': ' + r.count + ' รายการ') + '</title></rect>' +
        '<text x="' + (bx + bw * 0.35) + '" y="' + (y(r.count) - 4) + '" class="tick" text-anchor="middle">' + r.count + '</text>';
      var lbl = '<text x="' + (bx + bw * 0.35) + '" y="' + (H - pb + 14) + '" class="tick" text-anchor="middle">' + esc(String(r.name).slice(0, 10)) + '</text>';
      return (r.href ? '<a href="' + esc(r.href) + '">' + rect + '</a>' : rect) + lbl;
    }).join('');
    var line = rows.map(function (r, i) { return (i ? 'L' : 'M') + (pl + i * bw + bw / 2).toFixed(1) + ' ' + yp(r.cumulative_pct).toFixed(1); }).join(' ');
    var pts = rows.map(function (r, i) { return '<circle cx="' + (pl + i * bw + bw / 2) + '" cy="' + yp(r.cumulative_pct) + '" r="3.5" class="dot2"><title>สะสม ' + r.cumulative_pct + '%</title></circle>'; }).join('');
    return '<figure class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Pareto ปัญหาแยกหัวข้อ">' +
      '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '" class="grid"/>' + bars + '<path d="' + line + '" class="line2"/>' + pts +
      '<text x="' + (W - pr + 4) + '" y="' + (yp(100) + 4) + '" class="tick">100%</text><text x="' + (W - pr + 4) + '" y="' + (yp(80) + 4) + '" class="tick">80%</text></svg>' +
      '<details class="chart-table"><summary>ดูเป็นตาราง</summary><table class="tbl"><thead><tr><th>หัวข้อ</th><th class="num">จำนวน</th><th class="num">สะสม</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td class="num">' + r.count + '</td><td class="num">' + r.cumulative_pct + '%</td></tr>'; }).join('') + '</tbody></table></details></figure>';
  };
})();
