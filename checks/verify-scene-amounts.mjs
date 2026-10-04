import assert from 'node:assert/strict';
import { describeSceneAmounts } from '../dist/workbench-scene.js';

const source = { rows: [{ id: 'a', grams: 10, ratio: 2 }, { id: 'b', grams: 30, ratio: 1 }], basis: 'grams' };
const before = JSON.stringify(source);
let quantities = describeSceneAmounts(source);
assert.equal(quantities.complete, true);
assert.equal(quantities.total, 40);
assert.deepEqual(quantities.rows.map(row => row.share), [.25, .75]);
assert(quantities.rows[0].radius < quantities.rows[1].radius);
assert.equal(quantities.rows[0].amountText, '10 g');
assert.equal(JSON.stringify(source), before, 'Visualisation must not mutate research amounts.');

quantities = describeSceneAmounts({ ...source, basis: 'research' });
assert.equal(quantities.total, 3, 'Gram values must not enter research-ratio basis.');
assert.deepEqual(quantities.rows.map(row => row.share), [2 / 3, 1 / 3]);
assert.equal(quantities.rows[0].amountText, '2 份');

for (const missing of [null, undefined, 0, -1, NaN, Infinity, '10']) {
  const result = describeSceneAmounts({ basis: 'grams', rows: [{ id: 'a', grams: 10, ratio: 1 }, { id: 'b', grams: missing, ratio: 1 }] });
  assert.equal(result.complete, false);
  assert.equal(result.total, null, 'An incomplete formula must not acquire a made-up gram total.');
  assert(result.rows.every(row => row.share === null && row.unknownSize));
  assert.equal(result.rows[0].radius, result.rows[1].radius, 'Unknown grams must not be drawn as zero or a minority share.');
  assert.equal(result.rows[1].amountText, '量待填');
  assert.equal(result.rows[0].amountText, '10 g', 'Known entered grams remain visible even before all rows are complete.');
}

const empty = describeSceneAmounts({ rows: [], basis: 'grams' });
assert.equal(empty.complete, false);
assert.equal(empty.total, null);
assert.equal(empty.rows.length, 0);

for (const count of [1, 5, 48, 340]) {
  const rows = Array.from({ length: count }, (_, index) => ({ id: String(index), grams: index + .5 }));
  const result = describeSceneAmounts({ rows, basis: 'grams' });
  assert.equal(result.rows.length, count, 'All materials remain represented by the amount contract, regardless of GPU display budget.');
  assert(Math.abs(result.rows.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-12);
  assert(result.rows.every(row => Number.isFinite(row.radius) && row.radius > 0));
}
console.log('Scene amount checks passed: complete shares, separate bases, 7 unknown/invalid states, no input mutation, empty and large formula records.');
