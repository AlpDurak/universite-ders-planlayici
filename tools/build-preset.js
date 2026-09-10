// Regenerates src/preset-schedule.js from a schedule workbook.
//   node tools/build-preset.js [path-to.xlsx] [label]
// The workbook is embedded as base64 because the app must run from file://,
// where fetch() of a local file is blocked — a script tag is the only way in.
'use strict';
const fs = require('fs');
const path = require('path');

const source = process.argv[2] ||
  path.join(__dirname, '..', 'test', 'fixtures', '2026_Guz_Haftalik_Ders_Programi.xlsx');
const label = process.argv[3] || 'Işık 2026 Güz Dönemi Ders Programını kullan';
const bytes = fs.readFileSync(source);
const base64 = bytes.toString('base64');

// Wrap so no single source line is absurdly long.
const lines = (base64.match(/.{1,120}/g) || []).map((chunk) => "    '" + chunk + "'").join(' +\n');

const out = `'use strict';
// GENERATED FILE — do not edit by hand.
// Rebuild with: node tools/build-preset.js [path-to.xlsx] [label]
// Source: ${path.basename(source)} (${bytes.length} bytes)
//
// The workbook is embedded as base64 rather than fetched, because the app is
// opened by double-clicking index.html and fetch() of a local file is blocked
// under the file:// origin.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.PresetSchedule = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const NAME = ${JSON.stringify(path.basename(source))};
  const LABEL = ${JSON.stringify(label)};
  const BASE64 =
${lines};

  function toBytes() {
    const binary = atob(BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  return { name: NAME, label: LABEL, byteLength: ${bytes.length}, toBytes: toBytes };
});
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'preset-schedule.js'), out);
console.log('wrote src/preset-schedule.js from', path.basename(source),
  '(' + bytes.length + ' bytes -> ' + base64.length + ' base64 chars)');
