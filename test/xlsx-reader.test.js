'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/xlsx-reader.js');

const FIXTURE = path.join(__dirname, 'fixtures', '2026_Guz_Haftalik_Ders_Programi.xlsx');
const bytes = () => new Uint8Array(fs.readFileSync(FIXTURE));

test('unzip returns every entry in the container', async () => {
  const files = await R.unzip(bytes());
  assert.ok(files['xl/worksheets/sheet1.xml'], 'deflate entry (sheet1.xml) missing');
  assert.ok(files['_rels/.rels'], 'stored entry (_rels/.rels) missing');
  const relsDecode = new TextDecoder().decode(files['_rels/.rels']);
  assert.ok(relsDecode.includes('<Relationship'), 'stored entry does not contain <Relationship tag');
  assert.ok(relsDecode.includes('officeDocument'), 'stored entry does not contain officeDocument reference');
});

test('readWorkbook parses all rows with Turkish text intact', async () => {
  const { rows } = await R.readWorkbook(bytes());
  assert.strictEqual(rows.length, 1270);
  assert.strictEqual(rows[0].A, 'Ders Kodu');
  assert.strictEqual(rows[1].A, 'AHİZ1111.1');
  assert.strictEqual(rows[1].B, 'AMELİYATHANE TEKNOLOJİLERİ (3)');
  assert.strictEqual(rows[1].D, 'Maslak');
});

// Regression: a self-closing empty cell must not swallow the next cell.
// Row 212 is <c r="F212" .../> followed by <c r="G212">Th2Th3</c>.
test('self-closing empty cell does not consume the following cell', async () => {
  const { rows } = await R.readWorkbook(bytes());
  const lab = rows.find((r) => r.A === 'COMP1111-L.3');
  assert.ok(lab, 'COMP1111-L.3 row not found');
  assert.strictEqual(lab.G, 'Th2Th3');
});

test('parseSheetXml handles both namespaced and bare elements', () => {
  const nsRows = R.parseSheetXml(
    '<x:row><x:c r="A1" t="str"><x:v>hi</x:v></x:c></x:row>', []);
  const bareRows = R.parseSheetXml(
    '<row><c r="A1" t="str"><v>hi</v></c></row>', []);
  assert.strictEqual(nsRows[0].A, 'hi');
  assert.strictEqual(bareRows[0].A, 'hi');
});

test('parseSheetXml resolves all four cell encodings', () => {
  const xml = '<row>' +
    '<c r="A1" t="str"><v>literal</v></c>' +
    '<c r="B1" t="s"><v>0</v></c>' +
    '<c r="C1" t="inlineStr"><is><t>inline</t></is></c>' +
    '<c r="D1"><v>42</v></c>' +
    '</row>';
  const rows = R.parseSheetXml(xml, ['shared0']);
  assert.deepStrictEqual(rows[0], { A: 'literal', B: 'shared0', C: 'inline', D: '42' });
});

test('parseSheetXml unescapes XML entities', () => {
  const rows = R.parseSheetXml('<row><c r="A1" t="str"><v>a &amp; b &#65;</v></c></row>', []);
  assert.strictEqual(rows[0].A, 'a & b A');
});
