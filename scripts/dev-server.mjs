#!/usr/bin/env node
/**
 * Local preview server: serves the built UI and executes server functions in
 * the in-memory Apps Script fake (test/helpers/fake-gas.js). For UI development
 * and screen tests only — NOT a production server. Data is lost on restart.
 *
 *   npm run build && CPS_STANDARD_DIR=./standards-local node scripts/dev-server.mjs
 *   → http://localhost:8787  (admin / Admin12345 ; auditor1 / Passw0rd1 …)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRuntime } = require(path.join(root, 'test/helpers/fake-gas.js'));
const { findStandardFiles } = require(path.join(root, 'test/helpers/files.js'));
const PORT = Number(process.env.PORT || 8787);

const rt = createRuntime();
rt.__state.props.ADMIN_INITIAL_PASSWORD = 'Admin12345';
rt.setup();
let offline = false;
let latency = Number(process.env.LATENCY || 120);

function ok(r) { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message + JSON.stringify(r.error.details || '')); return r.data; }

// ---- seed: standards (real files if available), users, master data ----
(function seed() {
  const admin = ok(rt.apiLogin('admin', 'Admin12345')).token;
  const files = findStandardFiles();
  const publish = (file, level, label, decide) => {
    const p = ok(rt.apiParseStandardFile(admin, path.basename(file), fs.readFileSync(file).toString('base64')));
    const sheet = p.preview.sheets.find((s) => s.level === level && !s.hidden);
    const vid = ok(rt.apiCreateDraftVersion(admin, { import_file_id: p.import_file_id, sheet_index: sheet.index, version_label: label, effective_date: '2026-01-01', acknowledge_similar: true })).version_id;
    let b = ok(rt.apiGetStandardVersion(admin, vid));
    if (decide) ok(rt.apiUpdateDraftSettings(admin, vid, decide, b.version.version, '[ทดสอบในเครื่อง] ค่าสำหรับทดลอง UI'));
    b = ok(rt.apiGetStandardVersion(admin, vid));
    for (const c of b.criteria.filter((c) => c.max_points == null && b.set.scoring_mode === 'DEDUCTION')) ok(rt.apiUpdateDraftCriterion(admin, c.id, { max_points: 2.5 }, c.version, '[ทดสอบในเครื่อง]'));
    b = ok(rt.apiGetStandardVersion(admin, vid));
    for (const c of b.criteria.filter((c) => c.sample && c.sample.status === 'NEEDS_REVIEW')) ok(rt.apiUpdateDraftCriterion(admin, c.id, { sample: { count: c.sample.count, per: c.sample.per === 'TEAM' ? 'TEAM' : null, unit: c.sample.unit } }, c.version, '[ทดสอบในเครื่อง]'));
    b = ok(rt.apiGetStandardVersion(admin, vid));
    ok(rt.apiAcknowledgeFlags(admin, vid, b.flags.map((f) => f.key), b.version.version, '[ทดสอบในเครื่อง]'));
    b = ok(rt.apiGetStandardVersion(admin, vid));
    if (b.publish_check.ready) ok(rt.apiPublishVersion(admin, vid, b.version.version));
    return vid;
  };
  if (files.hc) {
    publish(files.hc, 'TEAM', 'Y2026 (ทดสอบ)', { item_floor_zero: true, total_floor_zero: true });
    publish(files.hc, 'GROUP', 'Y2026 (ทดสอบ)', { item_floor_zero: true, total_floor_zero: true });
  }
  if (files.kup) publish(files.kup, 'KUP', 'KUP 2026 (ทดสอบ)', null);
  ok(rt.apiSeedDemo(admin));
  const md = ok(rt.apiMasterData(admin));
  const bs = md.workshops.find((w) => w.code === 'BS');
  const g = ok(rt.apiSaveMaster(admin, 'groups', { workshop_id: bs.id, code: 'BS-G1', name: 'Group Body 1' }));
  ok(rt.apiSaveMaster(admin, 'teams', { workshop_id: bs.id, group_id: g.id, code: 'BS-T1', name: 'Team Underbody A' }));
  ok(rt.apiSaveMaster(admin, 'teams', { workshop_id: bs.id, group_id: g.id, code: 'BS-T2', name: 'Team Side Panel B' }));
  for (const [u, role] of [['auditor1', 'AUDITOR'], ['owner1', 'WORKSHOP_OWNER'], ['viewer1', 'VIEWER']]) ok(rt.apiSaveUser(admin, { username: u, display_name: u, role, scope_workshop_ids: [bs.id], password: 'Passw0rd1' }));
  // admin must change password normally; keep it simple locally
  const adminUser = rt.Db.findOne('users', (x) => x.username === 'admin');
  rt.Db.update('users', adminUser.id, { must_change_password: false });
  for (const u of ['auditor1', 'owner1', 'viewer1']) { const x = rt.Db.findOne('users', (y) => y.username === u); rt.Db.update('users', x.id, { must_change_password: false }); }
  console.log('Seeded. Standards from files:', Object.keys(files).filter((k) => files[k]).join(', ') || 'none');
})();

const SHIM = `<script>
(function(){
  function call(fn,args,ok,fail){
    fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn:fn,args:args})})
      .then(function(r){ if(r.status===503) throw new Error('offline'); return r.json(); })
      .then(function(j){ if(j.__exception) fail&&fail(new Error(j.__exception)); else ok&&ok(j.result); })
      .catch(function(e){ fail&&fail(e); });
  }
  function runner(ok,fail){ return new Proxy({}, { get: function(_,name){
    if(name==='withSuccessHandler') return function(f){ return runner(f,fail); };
    if(name==='withFailureHandler') return function(f){ return runner(ok,f); };
    return function(){ call(name, Array.prototype.slice.call(arguments), ok, fail); };
  }});}
  window.google={script:{run:runner(null,null)}};
})();
</script>`;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (offline) { res.writeHead(503); res.end('offline'); return; }
      const { fn, args } = JSON.parse(body);
      setTimeout(() => {
        try {
          if (!/^api[A-Z]/.test(fn) || typeof rt[fn] !== 'function') throw new Error('Unknown function ' + fn);
          const result = rt[fn](...args);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ result }));
        } catch (e) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ __exception: e.message }));
        }
      }, latency);
    });
    return;
  }
  if (req.url.startsWith('/__offline')) { offline = req.url.includes('on'); res.end('offline=' + offline); return; }
  if (req.url.startsWith('/__ai')) {
    // fake AI responder for UI demos — clearly NOT a real model
    rt.__state.fetchHandler = (url, opt) => {
      const body = JSON.parse(opt.payload);
      const text = body.contents[0].parts.map((p) => p.text || '').join('\n');
      if (/จัดหลักฐาน/.test(body.systemInstruction.parts[0].text)) {
        const codes = (text.match(/\n([A-Z]+-[A-Z0-9-]+): /g) || []).map((x) => x.trim().slice(0, -1));
        const evs = (text.match(/id=(EV-[0-9a-f]{8})/g) || []).map((x) => x.slice(3));
        const suggestions = evs.map((e, i) => ({ evidence_id: e, criterion_codes: [codes[(i + 1) % codes.length]], looks_like_issue: /ปัญหา|ไม่|ขวาง/.test(text), issue_summary: '[จำลอง] สรุปปัญหาจากภาพ', reason: '[ผลจำลองจาก dev-server — ไม่ใช่ AI จริง]' }));
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ suggestions }) }] } }] }) };
      }
      const cid = /criterion_id: (\S+)/.exec(text)[1];
      const ev = (text.match(/id=(EV-[0-9a-f]{8})/g) || []).map((x) => x.slice(3));
      const rule = (/\n([A-Z]-R\d+) \[PER_OCCURRENCE/.exec(text) || [])[1];
      const band = /band 0/.test(text);
      const reply = { criterion_id: cid, result: ev.length ? (band ? 'CONFORM' : rule ? 'NONCONFORM' : 'CONFORM') : 'INSUFFICIENT',
        observations: ev.length ? [{ type: 'FACT', text: '[ผลจำลองสำหรับทดสอบ UI] พบสิ่งที่ต้องตรวจในภาพ', evidence_references: [{ evidence_id: ev[0], locator: 'กลางภาพ' }] }, { type: 'ASSUMPTION', text: '[จำลอง] อาจต้องสัมภาษณ์เพิ่ม', evidence_references: [] }] : [],
        evidence_references: ev.length ? [{ evidence_id: ev[0], locator: 'ทั้งภาพ' }] : [], matched_rule_ids: !band && rule && ev.length ? [rule] : [],
        issues: !band && rule && ev.length ? [{ issue_key: 'ตัวอย่างปัญหา (จำลอง)', rule_id: rule, description: '[จำลอง] ไม่เป็นไปตามมาตรฐาน', evidence_ids: [ev[0]] }] : [],
        proposed_band_index: band && ev.length ? 2 : null, missing_evidence: ['ภาพตำแหน่งงานที่ 2'], suggested_questions: ['ขั้นตอนนี้ทำทุกกะหรือไม่'], conflicts: [], rationale: '[ผลจำลองจาก dev-server — ไม่ใช่ AI จริง]' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }], usageMetadata: {} }) };
    };
    const admin = ok(rt.apiLogin('admin', 'Admin12345')).token;
    ok(rt.apiSetAiConfig(admin, { provider: 'gemini', model: 'fake-local-model', api_key: 'LOCAL_FAKE_KEY_NOT_REAL_000000' }));
    res.end('fake AI enabled (UI testing only)');
    return;
  }
  if (req.url.startsWith('/__latency')) { latency = Number(new URL(req.url, 'http://x').searchParams.get('ms') || 100); res.end('latency=' + latency); return; }
  const file = path.join(root, 'dist-preview/index.html');
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace('<head>', '<head>' + SHIM);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
server.listen(PORT, () => console.log('CPS AI Audit preview on http://localhost:' + PORT));
