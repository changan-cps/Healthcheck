'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./helpers/fake-gas');

function ok(r) { if (!r.ok) throw new Error(r.error.code + ': ' + r.error.message); return r.data; }

test('issue card: AI drafts wording, output is cleaned, viewers are refused', () => {
  const rt = createRuntime();
  rt.__state.props.ADMIN_INITIAL_PASSWORD = 'Admin12345';
  rt.setup();
  const admin = ok(rt.apiLogin('admin', 'Admin12345')).token;
  const md = ok(rt.apiMasterData(admin));
  const ws = md.workshops[0];
  ok(rt.apiSaveUser(admin, { username: 'viewer9', display_name: 'v', role: 'VIEWER', scope_workshop_ids: [ws.id], password: 'Passw0rd1' }));
  const viewer = ok(rt.apiLogin('viewer9', 'Passw0rd1')).token;

  // AI not connected → clear error
  let r = rt.apiComposeIssueCard(admin, { section: 'QOS-GA', note: 'ใส่ N/A แทน /' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'AI_NOT_CONNECTED');

  rt.__state.props.GEMINI_API_KEY = 'AIza-test-key-xxxxxxxxxxxxxxxxxxxx';
  let sent;
  rt.__state.fetchHandler = (url, opt) => {
    sent = JSON.parse(opt.payload);
    const reply = { title: 'QOS-GA Scorecard: ใช้ “N/A” แทน “/”', wrong_label: 'บน Scorecard ✗', wrong_points: ['BBS Observation Jan–May ใส่ N/A', ''],
      correct_points: ['ข้อมูลที่ยังไม่ถูกติดตามใส่ “/”'], table: { columns: ['ข้อ', 'บอร์ด', 'มาตรฐาน'], rows: [['BBS', 'N/A', '/', 'extra']] } };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }], usageMetadata: {} }) };
  };
  r = rt.apiComposeIssueCard(admin, { section: 'QOS-GA', note: 'ใส่ N/A แทน /', images: [{ mime: 'image/png', data: 'iVBORw0KGgo=' }, { mime: 'text/html', data: 'PGI+' }] });
  const d = ok(r);
  assert.match(d.title, /N\/A/);
  assert.deepEqual(d.wrong_points, ['BBS Observation Jan–May ใส่ N/A'], 'blank lines dropped');
  assert.deepEqual(d.table.rows[0], ['BBS', 'N/A', '/'], 'row trimmed to column count');
  const inline = sent.contents[0].parts.filter((p) => p.inlineData);
  assert.equal(inline.length, 1, 'only image types are forwarded');
  assert.match(sent.systemInstruction.parts[0].text, /"\/"/, 'board standards are in the prompt');

  // empty note is rejected before calling AI
  r = rt.apiComposeIssueCard(admin, { section: 'X', note: '  ' });
  assert.equal(r.error.code, 'VALIDATION');

  r = rt.apiComposeIssueCard(viewer, { section: 'X', note: 'abc' });
  assert.equal(r.error.code, 'FORBIDDEN');
});
