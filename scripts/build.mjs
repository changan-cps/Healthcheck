#!/usr/bin/env node
/**
 * Build the Apps Script project into dist/ (pushed with clasp).
 *  - src/shared/*.js and src/server/*.js → dist/*.js (server files; Apps Script shares one global scope)
 *  - src/client/*.html                   → dist/*.html
 *  - src/client/js/<name>.js             → dist/js_<name>.html wrapped in <script>
 * Also writes dist-preview/index.html (includes inlined) for local UI testing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const copy = (from, to) => fs.copyFileSync(from, path.join(dist, to));
copy(path.join(root, 'src/appsscript.json'), 'appsscript.json');
for (const dir of ['src/shared', 'src/server']) {
  for (const f of fs.readdirSync(path.join(root, dir)).filter((x) => x.endsWith('.js'))) {
    const target = (dir === 'src/shared' ? '0_' : '') + f; // shared modules load first
    copy(path.join(root, dir, f), target);
  }
}
const includes = {};
for (const f of fs.readdirSync(path.join(root, 'src/client')).filter((x) => x.endsWith('.html'))) {
  const src = fs.readFileSync(path.join(root, 'src/client', f), 'utf8');
  fs.writeFileSync(path.join(dist, f), src);
  includes[f.replace(/\.html$/, '')] = src;
}
for (const f of fs.readdirSync(path.join(root, 'src/client/js')).filter((x) => x.endsWith('.js'))) {
  const js = fs.readFileSync(path.join(root, 'src/client/js', f), 'utf8');
  if (/<\/script/i.test(js)) throw new Error(f + ' contains </script>');
  const name = 'js_' + f.replace(/\.js$/, '');
  const html = '<script>\n' + js + '\n</script>\n';
  fs.writeFileSync(path.join(dist, name + '.html'), html);
  includes[name] = html;
}
// preview page: inline includes (used by scripts/dev-server.mjs and UI tests)
const prev = path.join(root, 'dist-preview');
fs.mkdirSync(prev, { recursive: true });
const page = includes.index.replace(/<\?!=\s*include\('([^']+)'\);?\s*\?>/g, (_, n) => {
  if (!(n in includes)) throw new Error('missing include ' + n);
  return includes[n];
});
fs.writeFileSync(path.join(prev, 'index.html'), page);
console.log('Built', fs.readdirSync(dist).length, 'files into dist/ and dist-preview/index.html');
