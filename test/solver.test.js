'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Solver = require('../src/solver.js');
const S = require('../src/scoring.js');
const P = require('../src/course-parser.js');

function sec(code, base, kind, pairs) {
  const slots = pairs.map(([day, hour]) => ({ day, hour }));
  return { code, base, kind, slots, mask: P.slotsToMask(slots), truncated: false, unscheduled: false };
}
function course(base, groups) {
  return { base, title: base, credit: 3,
    groups: Object.assign({ LEC: [], LAB: [], PS: [] }, groups) };
}
const prefs = (over) => Object.assign({}, S.DEFAULT_PREFS,
  { freeDays: [], compactness: 0, avoidSingleCourseDays: false }, over);

test('solve returns only conflict-free schedules by default', () => {
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1]]), sec('A.2', 'A', 'LEC', [[0, 2]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 1]])] });
  const { results } = Solver.solve([a, b], prefs(), { limit: 10 });
  assert.strictEqual(results.length, 1);
  assert.deepStrictEqual(results[0].sections.map((s) => s.code).sort(), ['A.2', 'B.1']);
});

test('adjacent hours are not a conflict', () => {
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 2]])] });
  assert.strictEqual(Solver.solve([a, b], prefs(), {}).results.length, 1);
});

test('every non-empty group must contribute exactly one section', () => {
  const a = course('A', {
    LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])],
    LAB: [sec('A-L.1', 'A', 'LAB', [[1, 1]])],
  });
  const { results } = Solver.solve([a], prefs(), {});
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].sections.length, 2);
});

test('time-identical sections collapse into one result with alternates', () => {
  // Three labs all meeting at Th2 — the real COMP1111 case.
  const a = course('A', {
    LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])],
    LAB: [sec('A-L.1', 'A', 'LAB', [[3, 2]]),
          sec('A-L.2', 'A', 'LAB', [[3, 2]]),
          sec('A-L.3', 'A', 'LAB', [[3, 2]])],
  });
  const { results } = Solver.solve([a], prefs(), {});
  assert.strictEqual(results.length, 1, 'expected one distinct timetable');
  assert.strictEqual(results[0].alternates.length, 2, 'expected two interchangeable labs');
});

test('Madde 18 mode accepts two pairs overlapping one hour each', () => {
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 1]])] });   // 1h with A
  const c = course('C', { LEC: [sec('C.1', 'C', 'LEC', [[1, 1]])] });
  const d = course('D', { LEC: [sec('D.1', 'D', 'LEC', [[1, 1]])] });   // 1h with C
  assert.strictEqual(Solver.solve([a, b, c, d], prefs(), { allowOverlap: false }).results.length, 0);
  const relaxed = Solver.solve([a, b, c, d], prefs(), { allowOverlap: true });
  assert.strictEqual(relaxed.results.length, 1);
  assert.strictEqual(relaxed.results[0].overlapHours, 2);
});

test('Madde 18 mode rejects a third overlapping pair', () => {
  const mk = (n, day) => course(n, { LEC: [sec(n + '.1', n, 'LEC', [[day, 1]])] });
  const courses = [mk('A', 0), mk('B', 0), mk('C', 1), mk('D', 1), mk('E', 2), mk('F', 2)];
  assert.strictEqual(Solver.solve(courses, prefs(), { allowOverlap: true }).results.length, 0);
});

test('Madde 18 mode rejects a single pair overlapping two hours', () => {
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1], [0, 2]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 1], [0, 2]])] });
  assert.strictEqual(Solver.solve([a, b], prefs(), { allowOverlap: true }).results.length, 0);
});

test('results are ordered best-first', () => {
  const a = course('A', {
    LEC: [sec('A.1', 'A', 'LEC', [[0, 1]]), sec('A.2', 'A', 'LEC', [[4, 1]])] });
  const p = prefs({ freeDays: ['F'], freeDayWeight: 200 });
  const { results } = Solver.solve([a], p, {});
  assert.strictEqual(results[0].sections[0].code, 'A.1', 'the Friday-free option should win');
  assert.ok(results[0].rawScore >= results[1].rawScore);
});

test('the node cap stops the search and reports truncation', () => {
  const many = [];
  for (let i = 0; i < 12; i++) {
    const options = [];
    for (let j = 1; j <= 6; j++) options.push(sec('C' + i + '.' + j, 'C' + i, 'LEC', [[i % 5, j]]));
    many.push(course('C' + i, { LEC: options }));
  }
  const out = Solver.solve(many, prefs(), { nodeCap: 500 });
  assert.strictEqual(out.truncated, true);
  assert.ok(out.explored <= 600);
});

// The truncated section carries real-looking slots, so only the `truncated`
// flag can be what excludes it — an empty slot list would pass this test for
// the wrong reason.
test('a truncated section is excluded even when it has slots', () => {
  const bad = sec('A.1', 'A', 'LEC', [[0, 1]]);
  bad.truncated = true;
  const good = sec('A.2', 'A', 'LEC', [[0, 2]]);
  const { results } = Solver.solve([course('A', { LEC: [bad, good] })], prefs(), {});
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].sections[0].code, 'A.2');
});

test('an unscheduled section is excluded from the search', () => {
  const bad = sec('A.1', 'A', 'LEC', [[0, 1]]);
  bad.unscheduled = true;
  const good = sec('A.2', 'A', 'LEC', [[0, 2]]);
  const { results } = Solver.solve([course('A', { LEC: [bad, good] })], prefs(), {});
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].sections[0].code, 'A.2');
});

const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/xlsx-reader.js');

test('end to end: real file, real courses, conflict-free results', async () => {
  const bytes = new Uint8Array(fs.readFileSync(
    path.join(__dirname, 'fixtures', '2026_Guz_Haftalik_Ders_Programi.xlsx')));
  const { rows } = await R.readWorkbook(bytes);
  const { courses } = P.buildCourses(rows, P.detectColumns(rows));
  // These three genuinely co-exist, and COMP1111 contributes three identical-time
  // lab sections, so this also exercises the dedup path on real data.
  const picked = ['COMP1111', 'ARCH2210', 'ARCH2214']
    .map((base) => courses.find((c) => c.base === base));
  assert.ok(picked.every(Boolean), 'fixture courses missing');

  const { results } = Solver.solve(picked, S.DEFAULT_PREFS, { limit: 10 });
  assert.strictEqual(results.length, 2, 'expected two distinct timetables');
  // COMP1111-L.1/.2/.3 all meet at Th2-Th3, so each result keeps one and carries
  // the other two as interchangeable alternates rather than as duplicate results.
  assert.strictEqual(results[0].alternates.length, 2);
  for (const entry of results) {
    assert.strictEqual(entry.overlapHours, 0, 'strict mode must not use the overlap allowance');
  }

  for (const entry of results) {
    const seen = new Set();
    for (const section of entry.sections) {
      for (const slot of section.slots) {
        const key = slot.day + ':' + slot.hour;
        assert.ok(!seen.has(key), 'conflict at ' + key + ' in a strict-mode result');
        seen.add(key);
      }
    }
  }
});

// A real course set with NO conflict-free arrangement — the 'no results' path
// users will actually hit. COMP1111's three lab sections all meet at Th2-Th3,
// and COMP1113's only lecture occupies Th1-Th3, so the two can never co-exist.
test('end to end: a genuinely impossible course set returns no schedules', async () => {
  const bytes = new Uint8Array(fs.readFileSync(
    path.join(__dirname, 'fixtures', '2026_Guz_Haftalik_Ders_Programi.xlsx')));
  const { rows } = await R.readWorkbook(bytes);
  const { courses } = P.buildCourses(rows, P.detectColumns(rows));
  const picked = ['COMP1111', 'COMP1113'].map((base) => courses.find((c) => c.base === base));

  assert.strictEqual(Solver.solve(picked, S.DEFAULT_PREFS, {}).results.length, 0);
  // Not even the Madde 18 allowance rescues it: the clash is 2 hours on one pair,
  // over the one-hour-per-pair limit.
  assert.strictEqual(
    Solver.solve(picked, S.DEFAULT_PREFS, { allowOverlap: true }).results.length, 0);
});
