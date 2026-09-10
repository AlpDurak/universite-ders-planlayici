'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/scoring.js');
const P = require('../src/course-parser.js');

// Helper: a section occupying the given slots, e.g. sec('COMP1111', [[0,1],[0,2]])
function sec(base, pairs) {
  const slots = pairs.map(([day, hour]) => ({ day, hour }));
  return { base, code: base + '.1', slots, mask: P.slotsToMask(slots) };
}

const prefs = (over) => Object.assign({}, S.DEFAULT_PREFS, over);

test('a requested free day that stays empty earns the weight', () => {
  const monOnly = [sec('A', [[0, 1], [0, 2]]), sec('B', [[0, 3], [0, 4]])];
  const withFriday = [sec('A', [[0, 1], [0, 2]]), sec('B', [[4, 3], [4, 4]])];
  const p = prefs({ freeDays: ['F'], freeDayWeight: 200, avoidSingleCourseDays: false });
  assert.strictEqual(S.scoreSchedule(monOnly, p).score, 200);
  assert.strictEqual(S.scoreSchedule(withFriday, p).score, 0);
});

test('gap hours are penalised in proportion to compactness', () => {
  // Monday hours 1 and 5 -> a 3-hour gap.
  const gappy = [sec('A', [[0, 1]]), sec('B', [[0, 5]])];
  const p = prefs({ freeDays: [], compactness: 1, avoidSingleCourseDays: false });
  const result = S.scoreSchedule(gappy, p);
  assert.ok(result.score < 0, 'expected a penalty, got ' + result.score);
  const relaxed = S.scoreSchedule(gappy, prefs({
    freeDays: [], compactness: 0, avoidSingleCourseDays: false }));
  assert.strictEqual(relaxed.score, 0);
});

test('a negative compactness rewards gaps instead', () => {
  const gappy = [sec('A', [[0, 1]]), sec('B', [[0, 5]])];
  const p = prefs({ freeDays: [], compactness: -1, avoidSingleCourseDays: false });
  assert.ok(S.scoreSchedule(gappy, p).score > 0);
});

test('maxGap rejects a schedule outright', () => {
  const gappy = [sec('A', [[0, 1]]), sec('B', [[0, 6]])];   // 4-hour gap
  assert.strictEqual(S.scoreSchedule(gappy, prefs({ maxGap: 2 })).rejected, true);
  assert.strictEqual(S.scoreSchedule(gappy, prefs({ maxGap: 9 })).rejected, false);
});

test('a day holding one distinct course is penalised when enabled', () => {
  const lonely = [sec('A', [[0, 1], [0, 2]])];
  const on = prefs({ freeDays: [], avoidSingleCourseDays: true, singleCourseDayPenalty: 100 });
  const off = prefs({ freeDays: [], avoidSingleCourseDays: false });
  assert.strictEqual(S.scoreSchedule(lonely, on).score, -100);
  assert.strictEqual(S.scoreSchedule(lonely, off).score, 0);
});

test('a lecture and its own lab on one day is still a single-course day', () => {
  const pair = [sec('A', [[0, 1]]), sec('A', [[0, 2]])];   // same base
  const p = prefs({ freeDays: [], avoidSingleCourseDays: true, singleCourseDayPenalty: 100 });
  assert.strictEqual(S.scoreSchedule(pair, p).score, -100);
});

test('the breakdown explains every point awarded', () => {
  const s = [sec('A', [[0, 1]]), sec('B', [[0, 5]])];
  const result = S.scoreSchedule(s, prefs({ freeDays: ['F'] }));
  const total = result.breakdown.reduce((sum, item) => sum + item.points, 0);
  assert.strictEqual(total, result.score);
  assert.ok(result.breakdown.every((item) => typeof item.label === 'string' && item.label.length > 0));
});
