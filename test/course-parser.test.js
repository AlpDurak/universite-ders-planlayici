'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/course-parser.js');

test('parseCode splits base, kind and section', () => {
  assert.deepStrictEqual(P.parseCode('COMP1111.2'), { base: 'COMP1111', kind: 'LEC', sectionNo: '2' });
  assert.deepStrictEqual(P.parseCode('COMP1111-L.1'), { base: 'COMP1111', kind: 'LAB', sectionNo: '1' });
  assert.deepStrictEqual(P.parseCode('ARCH2210-PS.1'), { base: 'ARCH2210', kind: 'PS', sectionNo: '1' });
});

test('parseCode handles Turkish letters and dirty codes', () => {
  assert.strictEqual(P.parseCode('AHİZ2132.1').base, 'AHİZ2132');
  assert.strictEqual(P.parseCode('HUSS1003 .1').base, 'HUSS1003');   // trailing space
  assert.strictEqual(P.parseCode('GSKE-250.2.1').base, 'GSKE-250');  // extra dot
  assert.strictEqual(P.parseCode('GSKE-250.2.1').sectionNo, '2.1');
});

test('parseCode returns null for unparseable input', () => {
  assert.strictEqual(P.parseCode(''), null);
  assert.strictEqual(P.parseCode('NOSECTION'), null);
});

test('parseSlots reads day/hour pairs, longest token first', () => {
  assert.deepStrictEqual(P.parseSlots('T2T3T4').slots,
    [{ day: 1, hour: 2 }, { day: 1, hour: 3 }, { day: 1, hour: 4 }]);
  // 'Th' must not parse as 'T' + stray 'h'
  assert.deepStrictEqual(P.parseSlots('Th2Th3').slots, [{ day: 3, hour: 2 }, { day: 3, hour: 3 }]);
  assert.deepStrictEqual(P.parseSlots('St1').slots, [{ day: 5, hour: 1 }]);
});

test('parseSlots reads two-digit hours', () => {
  assert.deepStrictEqual(P.parseSlots('T10T11T12').slots,
    [{ day: 1, hour: 10 }, { day: 1, hour: 11 }, { day: 1, hour: 12 }]);
});

test('parseSlots tolerates trailing punctuation', () => {
  const r = P.parseSlots('M11M12Th11Th12.');
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.slots.length, 4);
});

test('parseSlots flags truncated strings instead of accepting them', () => {
  // Real row: the leading 'M' was cut off by the source system at 23 chars.
  const r = P.parseSlots('1M2M3T5T6W1W2W3Th5Th6F1');
  assert.strictEqual(r.truncated, true);
});

test('parseSlots treats empty input as unscheduled, not truncated', () => {
  assert.deepStrictEqual(P.parseSlots(''), { slots: [], truncated: false });
});

test('parseCredit reads the trailing parenthesis only', () => {
  assert.strictEqual(P.parseCredit('Programlama Temelleri (4)'), 4);
  assert.strictEqual(P.parseCredit('Yapı Teknolojileri I (3)'), 3);
  assert.strictEqual(P.parseCredit('Programlama Temelleri'), 0);   // lab row
  assert.strictEqual(P.parseCredit('SEKTÖR STAJI'), 0);
  assert.strictEqual(P.parseCredit('Global 20.Yüzyıl Sanatı (3)'), 3);
});

const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/xlsx-reader.js');
const FIXTURE = path.join(__dirname, 'fixtures', '2026_Guz_Haftalik_Ders_Programi.xlsx');

test('detectColumns finds the right roles despite mislabeled headers', async () => {
  const { rows } = await R.readWorkbook(new Uint8Array(fs.readFileSync(FIXTURE)));
  const cols = P.detectColumns(rows);
  assert.strictEqual(cols.code, 'A');
  assert.strictEqual(cols.title, 'B');
  assert.strictEqual(cols.quota, 'C');
  assert.strictEqual(cols.campus, 'D');
  assert.strictEqual(cols.slots, 'G');   // header wrongly says 'Ders Saati'
  assert.strictEqual(cols.hours, 'I');   // header wrongly says 'Ders Saati(leri)'
  assert.strictEqual(cols.akts, null);   // this file has no AKTS column
});

test('detectColumns finds both parts of a split instructor name', async () => {
  const { rows } = await R.readWorkbook(new Uint8Array(fs.readFileSync(FIXTURE)));
  const cols = P.detectColumns(rows);
  assert.deepStrictEqual(cols.instructorParts, ['E', 'F']);   // given name, then surname
});

test('detectColumns survives shuffled columns', () => {
  const rows = [
    { Z: 'Ders Kodu', Y: 'Başlık', X: 'Saat' },
    { Z: 'COMP1111.1', Y: 'Programlama Temelleri (4)', X: 'T2T3T4' },
    { Z: 'COMP1111.2', Y: 'Programlama Temelleri (4)', X: 'T1T2T3' },
    { Z: 'MATH1111.1', Y: 'Kalkülüs (4)', X: 'M1M2M3' },
  ];
  const cols = P.detectColumns(rows);
  assert.strictEqual(cols.code, 'Z');
  assert.strictEqual(cols.title, 'Y');
  assert.strictEqual(cols.slots, 'X');
});

test('detectColumns names the role it could not find', () => {
  const rows = [{ A: 'h' }, { A: 'no codes here' }, { A: 'still none' }];
  assert.throws(() => P.detectColumns(rows), /code/i);
});

test('detectColumns names the class-hours role when no column holds slots', () => {
  // Column A is clearly codes; column B has no digits at all, so it can
  // never look like a day/hour slot string — no column can fill the slots role.
  const rows = [
    { A: 'Ders Kodu', B: 'Baslik' },
    { A: 'COMP1111.1', B: 'nonsense text with no slot pattern' },
    { A: 'COMP1111.2', B: 'more plain text here' },
    { A: 'MATH1111.1', B: 'random words without digits' },
  ];
  assert.throws(() => P.detectColumns(rows), /slots|hours|saat/i);
});

test('detectColumns names the title role when no column looks like a title', () => {
  // Only two columns exist: code and slots. Once both are claimed, there is
  // nothing left for the title role to pick from.
  const rows = [
    { A: 'Ders Kodu', B: 'Saat' },
    { A: 'COMP1111.1', B: 'T2T3T4' },
    { A: 'COMP1111.2', B: 'T1T2T3' },
    { A: 'MATH1111.1', B: 'M1M2M3' },
  ];
  assert.throws(() => P.detectColumns(rows), /title/i);
});

test('slotsToMask sets one bit per day/hour', () => {
  const mask = P.slotsToMask([{ day: 1, hour: 1 }, { day: 1, hour: 3 }, { day: 3, hour: 2 }]);
  assert.strictEqual(mask[1], 0b101);
  assert.strictEqual(mask[3], 0b010);
  assert.strictEqual(mask[0], 0);
});

test('buildCourses groups sections by base and kind', async () => {
  const { rows } = await R.readWorkbook(new Uint8Array(fs.readFileSync(FIXTURE)));
  const { courses } = P.buildCourses(rows, P.detectColumns(rows));
  const comp = courses.find((c) => c.base === 'COMP1111');
  assert.strictEqual(comp.groups.LEC.length, 2);
  assert.strictEqual(comp.groups.LAB.length, 3);
  assert.strictEqual(comp.groups.PS.length, 0);
});

test('credit comes from the parent row and is counted once per course', async () => {
  const { rows } = await R.readWorkbook(new Uint8Array(fs.readFileSync(FIXTURE)));
  const { courses } = P.buildCourses(rows, P.detectColumns(rows));
  const comp = courses.find((c) => c.base === 'COMP1111');
  assert.strictEqual(comp.credit, 4);                       // from 'Programlama Temelleri (4)'
  assert.strictEqual(comp.groups.LAB[0].credit, 0);         // lab contributes nothing
  const staj = courses.find((c) => c.base === 'AHİZ2939');
  assert.strictEqual(staj.credit, 0);                       // internship, no (n)
});

test('buildCourses reports truncated sections as warnings', async () => {
  const { rows } = await R.readWorkbook(new Uint8Array(fs.readFileSync(FIXTURE)));
  const cols = P.detectColumns(rows);
  const { courses, warnings } = P.buildCourses(rows, cols);
  assert.ok(warnings.some((w) => w.code.startsWith('PREP1111')),
    'expected PREP1111 to be flagged as truncated');

  // The reason must actually describe the problem, not just carry a code prefix.
  for (const w of warnings) {
    assert.strictEqual(typeof w.reason, 'string');
    assert.ok(w.reason.length > 0, `warning ${w.code} has an empty reason`);
    assert.ok(w.reason.includes('could not be read in full'),
      `warning ${w.code} reason should mention the unreadable meeting times, got: "${w.reason}"`);
  }

  // A row whose meeting-times cell is merely empty is 'unscheduled', not 'truncated',
  // and must never show up as a warning. Verify by tracing every warning back to the
  // section it was raised for and checking it was not simply unscheduled.
  const allSections = courses.flatMap((c) => [...c.groups.LEC, ...c.groups.LAB, ...c.groups.PS]);
  for (const w of warnings) {
    const section = allSections.find((s) => s.code === w.code);
    assert.ok(section, `warning code ${w.code} should correspond to a built section`);
    assert.strictEqual(section.unscheduled, false,
      `section ${w.code} was warned about but is marked unscheduled`);
  }

  // Pinning the count catches a regression where unscheduled rows start warning too.
  assert.strictEqual(warnings.length, 6);
});

test('buildCourses counts credit once even when the credit-bearing LEC row arrives second', () => {
  const rows = [
    { Z: 'Ders Kodu', Y: 'Baslik', X: 'Saat' },              // header, skipped
    { Z: 'ABCD1234.1', Y: 'Test Dersi', X: 'T2T3T4' },        // LEC, no (n) — arrives first
    { Z: 'ABCD1234.2', Y: 'Test Dersi (3)', X: 'W1W2W3' },    // LEC, has (3) — arrives second
    { Z: 'ABCD1234-L.1', Y: 'Test Dersi', X: 'M1M2' },        // LAB, no credit of its own
  ];
  const cols = P.detectColumns(rows);
  const { courses } = P.buildCourses(rows, cols);
  const course = courses.find((c) => c.base === 'ABCD1234');
  assert.ok(course, 'expected ABCD1234 to be built from the synthetic rows');

  // Credit must come from whichever LEC row carries the '(n)' suffix, regardless of
  // row order — not from the first LEC row encountered, and not reset to 0 by it.
  assert.strictEqual(course.credit, 3);
  assert.strictEqual(course.title, 'Test Dersi');   // trailing '(3)' stripped

  // The lab section carries no credit of its own and must not disturb the course credit.
  assert.strictEqual(course.groups.LAB.length, 1);
  assert.strictEqual(course.groups.LAB[0].credit, 0);
  assert.strictEqual(course.credit, 3);
});

test('buildCourses parses the whole reference file without throwing', async () => {
  const { rows } = await R.readWorkbook(new Uint8Array(fs.readFileSync(FIXTURE)));
  const { courses } = P.buildCourses(rows, P.detectColumns(rows));
  // 799 base courses: every one of the 1269 rows parses under the Task 2 regex,
  // including the odd GSKE-250.2.1 and 'HUSS1003 .1' forms.
  assert.strictEqual(courses.length, 799);
  assert.ok(courses.every((c) => c.groups.LEC.length > 0), 'every course needs a lecture group');
  const math = courses.find((c) => c.base === 'MATH1001');
  assert.strictEqual(math.groups.LEC.length, 3);
  assert.strictEqual(math.groups.PS.length, 3);
});
