'use strict';
// Minimal ZIP reader for tests (stored + deflate entries), returns {path: utf8 string}.
const zlib = require('zlib');

function unzipToStrings(buf, filter) {
  const out = {};
  for (const e of entries(buf)) {
    if (e.name.endsWith('/')) continue;
    if (filter && !filter(e.name)) continue;
    out[e.name] = e.data().toString('utf8');
  }
  return out;
}

function unzipToBuffers(buf) {
  const out = {};
  for (const e of entries(buf)) if (!e.name.endsWith('/')) out[e.name] = e.data();
  return out;
}

function* entries(buf) {
  // find End Of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + csize);
    yield { name, data: () => (method === 0 ? raw : zlib.inflateRawSync(raw)) };
  }
}

module.exports = { unzipToStrings, unzipToBuffers };
