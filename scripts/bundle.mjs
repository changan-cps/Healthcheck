#!/usr/bin/env node
/**
 * Single-file bundle for installing without clasp (copy/paste into the Apps Script editor):
 *   bundle/Code.gs         all shared + server code
 *   bundle/index.html      the whole UI with every include inlined
 *   bundle/appsscript.json manifest
 * Run `node scripts/build.mjs && node scripts/bundle.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'bundle');
fs.mkdirSync(out, { recursive: true });
const parts = [];
for (const dir of ['src/shared', 'src/server']) {
  // Setup.js first so the editor's "Run" dropdown selects setup() by default
  for (const f of fs.readdirSync(path.join(root, dir)).filter((x) => x.endsWith('.js')).sort((a, b) => (a === 'Setup.js' ? -1 : b === 'Setup.js' ? 1 : a.localeCompare(b)))) {
    parts.push('// ===== ' + dir + '/' + f + ' =====\n' + fs.readFileSync(path.join(root, dir, f), 'utf8'));
  }
}
let code = parts.join('\n\n');
// the bundled index.html has no template includes → serve it as plain HTML
code = code.replace("var t = HtmlService.createTemplateFromFile('index');\n  t.appVersion = APP_VERSION;\n  var out = t.evaluate()", "var out = HtmlService.createHtmlOutputFromFile('index')");
if (!code.includes("createHtmlOutputFromFile('index')")) throw new Error('doGet patch failed');
fs.writeFileSync(path.join(out, 'Code.gs'), '/* CPS AI Audit — generated bundle. Source: https://github.com/changan-cps/healthcheck (do not edit here) */\n' + code);
const page = fs.readFileSync(path.join(root, 'dist-preview/index.html'), 'utf8');
if (/<\?/.test(page.replace(/<\?xml/g, ''))) console.warn('warning: "<?" found in page');
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.copyFileSync(path.join(root, 'src/appsscript.json'), path.join(out, 'appsscript.json'));
for (const f of fs.readdirSync(out)) console.log(f, fs.statSync(path.join(out, f)).size, 'bytes');
