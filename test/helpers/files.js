'use strict';
// Locates the real standard workbooks for tests. They are NOT committed (company documents).
// Put them in CPS_STANDARD_DIR (default: ./standards-local) with names containing
// "Health_Check" (file 002) and "CPS_TH" or "KUP" (file 001).
const fs = require('fs');
const path = require('path');

function findStandardFiles() {
  const dir = process.env.CPS_STANDARD_DIR || path.resolve(__dirname, '../../standards-local');
  if (!fs.existsSync(dir)) return {};
  const list = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f));
  const hc = list.find((f) => /health|hc\.xlsx/i.test(f));
  const kup = list.find((f) => /CPS_TH|kup/i.test(f));
  return { hc: hc && path.join(dir, hc), kup: kup && path.join(dir, kup) };
}

module.exports = { findStandardFiles };
