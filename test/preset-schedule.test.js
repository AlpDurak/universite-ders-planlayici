'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Preset = require('../src/preset-schedule.js');
const R = require('../src/xlsx-reader.js');
const P = require('../src/course-parser.js');

const FIXTURE = path.join(__dirname, 'fixtures', '2026_Guz_Haftalik_Ders_Programi.xlsx');

test('preset exposes a label and a file name for the UI', () => {
  assert.strictEqual(typeof Preset.label, 'string');
  assert.ok(Preset.label.length > 0);
  assert.match(Preset.name, /\.xlsx$/);
});

test('preset decodes byte-for-byte to the schedule file it was built from', () => {
  const expected = new Uint8Array(fs.readFileSync(FIXTURE));
  const actual = Preset.toBytes();
  assert.ok(actual instanceof Uint8Array);
  assert.strictEqual(actual.length, expected.length);
  assert.deepStrictEqual(actual, expected);
});

// A regenerated preset that decodes but parses differently would ship a broken
// button silently; pin it to the same numbers the on-disk file produces.
test('preset parses to the same courses as the on-disk file', async () => {
  const { rows } = await R.readWorkbook(Preset.toBytes());
  const { courses, warnings } = P.buildCourses(rows, P.detectColumns(rows));
  assert.strictEqual(courses.length, 799);
  assert.strictEqual(warnings.length, 6);
  assert.ok(courses.find((c) => c.base === 'COMP1111'), 'COMP1111 missing from preset');
});
