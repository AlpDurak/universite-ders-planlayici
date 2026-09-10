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

// The lecture and the lab are two separate pick-one groups at two different
// search depths, so a depth-keyed pair counter reads them as two courses and
// happily lets a student attend both at once.
test('Madde 18 never lets a course overlap its own lab', () => {
  const a = course('A', {
    LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])],
    LAB: [sec('A-L.1', 'A', 'LAB', [[0, 1]])],
  });
  assert.strictEqual(Solver.solve([a], prefs(), { allowOverlap: true }).results.length, 0);
});

// Two sections of the same course overlapping a third course must still count
// as ONE pair, not two, or the 2-pair allowance is silently doubled.
test('Madde 18 counts a lecture and its lab against one shared pair', () => {
  const a = course('A', {
    LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])],
    LAB: [sec('A-L.1', 'A', 'LAB', [[1, 1]])],
  });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 1], [1, 1]])] });
  // A/B share two hours: one pair, two hours — over the one-hour-per-pair cap.
  assert.strictEqual(Solver.solve([a, b], prefs(), { allowOverlap: true }).results.length, 0);
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

// Spec §7.1: memory stays flat regardless of search size because only K results
// are retained. Retaining every leaf and slicing at the end is what crashed the
// tab, so the top-K set has to be maintained DURING the search.
test('a large search retains only the top `limit` results', () => {
  // Four courses of five sections each: 625 leaves, every one conflict-free and
  // every one a distinct timetable — over 15x the limit*4 compaction threshold.
  // Each course owns its own hour band on its own day, so the only thing that
  // separates the schedules is the gap left between the two bands of a day, and
  // exactly one arrangement leaves no gap at all.
  const band = (base, day, from) => course(base, {
    LEC: [0, 1, 2, 3, 4].map(
      (i) => sec(base + '.' + (i + 1), base, 'LEC', [[day, from + i]])),
  });
  const courses = [band('A', 0, 1), band('B', 0, 6), band('C', 1, 1), band('D', 1, 6)];
  const p = prefs({ compactness: 1 });

  const bounded = Solver.solve(courses, p, { limit: 10 });
  // A limit that exceeds the leaf count disables both the floor and compaction,
  // so this run is exactly the unbounded search the bounded one must agree with.
  const unbounded = Solver.solve(courses, p, { limit: 625 });

  assert.strictEqual(bounded.considered, 625, 'every leaf must still be visited');
  assert.strictEqual(unbounded.results.length, 625, 'reference run should keep everything');
  assert.ok(bounded.results.length <= 10,
    'bounded run returned ' + bounded.results.length + ' results, over the limit');
  assert.strictEqual(bounded.results.length, 10);
  // The returned list is sliced either way, so only the retained count can tell
  // a bounded search apart from one that hoarded all 625 leaves and sliced last.
  assert.ok(bounded.retained <= 40,
    'held ' + bounded.retained + ' results during the search; must stay within limit*4');
  assert.strictEqual(unbounded.retained, 625, 'reference run should hold every leaf');

  // A.5 ends at M5 and B.1 starts at M6 (same for C.5/D.1 on Tuesday), so this
  // is the one and only zero-gap schedule — the best result is unambiguous.
  assert.strictEqual(bounded.results[0].rawScore, 0);
  assert.deepStrictEqual(bounded.results[0].sections.map((s) => s.code).sort(),
    ['A.5', 'B.1', 'C.5', 'D.1']);
  assert.deepStrictEqual(bounded.results[0].sections.map((s) => s.code),
    unbounded.results[0].sections.map((s) => s.code),
    'bounded search must return the same best schedule as the unbounded one');
});

test('a course whose every section is unusable is reported in `skipped`', () => {
  const bad = sec('B.1', 'B', 'LEC', [[0, 1]]);
  bad.truncated = true;
  const out = Solver.solve(
    [course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])] }), course('B', { LEC: [bad] })],
    prefs(), {});
  // The old behaviour was to return this schedule with B simply absent.
  assert.deepStrictEqual(out.skipped, ['B']);
  assert.deepStrictEqual(out.results[0].sections.map((s) => s.code), ['A.1']);
});

test('a course with one usable section is not reported in `skipped`', () => {
  const bad = sec('A.1', 'A', 'LEC', [[0, 1]]);
  bad.truncated = true;
  const good = sec('A.2', 'A', 'LEC', [[0, 2]]);
  assert.deepStrictEqual(
    Solver.solve([course('A', { LEC: [bad, good] })], prefs(), {}).skipped, []);
});

test('every course unusable yields no results and a full `skipped` list', () => {
  const mk = (n) => {
    const bad = sec(n + '.1', n, 'LEC', [[0, 1]]);
    bad.unscheduled = true;
    return course(n, { LEC: [bad] });
  };
  const out = Solver.solve([mk('A'), mk('B')], prefs(), {});
  assert.strictEqual(out.results.length, 0);
  assert.deepStrictEqual(out.skipped, ['A', 'B']);
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

// ---------------------------------------------------------------------------
// diagnose(): explain WHY a selection has no conflict-free arrangement.
// ---------------------------------------------------------------------------

test('diagnose names a pair that can never co-exist', () => {
  // A and B both meet Monday hour 1 in their only sections.
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 1]])] });
  const report = Solver.diagnose([a, b], prefs(), {});
  assert.strictEqual(report.blockingPairs.length, 1);
  assert.deepStrictEqual(report.blockingPairs[0].bases.slice().sort(), ['A', 'B']);
  assert.deepStrictEqual(report.blockingPairs[0].cells, ['M1']);
});

test('diagnose does not flag a pair that can co-exist', () => {
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 2]])] });
  const report = Solver.diagnose([a, b], prefs(), {});
  assert.strictEqual(report.blockingPairs.length, 0);
});

test('diagnose reports every clashing cell of a blocking pair', () => {
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[3, 2], [3, 3]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[3, 1], [3, 2], [3, 3]])] });
  const report = Solver.diagnose([a, b], prefs(), {});
  assert.deepStrictEqual(report.blockingPairs[0].cells, ['Th2', 'Th3']);
});

test('diagnose names the course whose removal makes the rest fit', () => {
  // A blocks both B and C; B and C are fine together.
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1], [0, 2]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 1]])] });
  const c = course('C', { LEC: [sec('C.1', 'C', 'LEC', [[0, 2]])] });
  const report = Solver.diagnose([a, b, c], prefs(), {});
  assert.deepStrictEqual(report.dropCandidates, ['A']);
});

test('diagnose reports a higher-order clash when no single pair is blocking', () => {
  // Any two of these three fit; all three cannot, because only two distinct
  // hours exist between them.
  const opts = (n) => [sec(n + '.1', n, 'LEC', [[0, 1]]), sec(n + '.2', n, 'LEC', [[0, 2]])];
  const courses = ['A', 'B', 'C'].map((n) => course(n, { LEC: opts(n) }));
  const report = Solver.diagnose(courses, prefs(), {});
  assert.strictEqual(report.blockingPairs.length, 0, 'no pair alone is impossible');
  assert.strictEqual(report.higherOrder, true);
});

test('diagnose reports nothing to explain when the selection already fits', () => {
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 2]])] });
  const report = Solver.diagnose([a, b], prefs(), {});
  assert.strictEqual(report.solvable, true);
  assert.strictEqual(report.higherOrder, false);
  assert.deepStrictEqual(report.dropCandidates, []);
});

test('diagnose skips the drop analysis when the search was truncated', () => {
  const many = [];
  for (let i = 0; i < 12; i++) {
    const options = [];
    for (let j = 1; j <= 6; j++) options.push(sec('C' + i + '.' + j, 'C' + i, 'LEC', [[i % 5, j]]));
    many.push(course('C' + i, { LEC: options }));
  }
  const report = Solver.diagnose(many, prefs(), { nodeCap: 400 });
  assert.strictEqual(report.truncated, true);
  assert.deepStrictEqual(report.dropCandidates, []);
});

test('diagnose ignores courses with no usable sections', () => {
  const bad = sec('B.1', 'B', 'LEC', [[0, 1]]);
  bad.truncated = true;
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])] });
  const b = course('B', { LEC: [bad] });
  const report = Solver.diagnose([a, b], prefs(), {});
  assert.strictEqual(report.blockingPairs.length, 0, 'an unreadable course is not a clash');
  assert.deepStrictEqual(report.skipped, ['B']);
});

test('diagnose honours the Madde 18 overlap allowance', () => {
  // A and B clash on exactly one hour: forbidden strictly, permitted under
  // the one-hour allowance. The diagnosis must agree with the mode in use.
  const a = course('A', { LEC: [sec('A.1', 'A', 'LEC', [[0, 1]])] });
  const b = course('B', { LEC: [sec('B.1', 'B', 'LEC', [[0, 1]])] });
  assert.strictEqual(Solver.diagnose([a, b], prefs(), {}).blockingPairs.length, 1);
  const relaxed = Solver.diagnose([a, b], prefs(), { allowOverlap: true });
  assert.strictEqual(relaxed.solvable, true, 'one hour is allowed under Madde 18/2');
  assert.strictEqual(relaxed.blockingPairs.length, 0);
});
