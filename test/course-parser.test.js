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
