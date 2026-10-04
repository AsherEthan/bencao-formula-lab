const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const base = path.resolve(__dirname, '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of ['data.js', 'model.js', 'quant-model.js']) {
  vm.runInContext(fs.readFileSync(path.join(base, 'dist', file), 'utf8'), sandbox);
}
const model = sandbox.QuantModel;
const real = sandbox.window.HERB_DATA;
const plain = value => JSON.parse(JSON.stringify(value));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const row = (id, ratio = 1) => ({ id, ratio });
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function herb(id, nature = '溫', effect = '補氣', extra = {}) {
  const rawText = nature + '；' + effect;
  const n = [...nature].length;
  return { id, name: id, sourceId: 'fixture', rawText, nature, effects: effect ? [effect] : [],
    flavors: [], meridians: [], toxic: false, identityNote: '',
    reviewStatus: 'curated_source_excerpt_reviewed',
    evidenceSpans: [
      { field: 'nature', text: nature, start: 0, end: n, basis: 'rawText', offsetUnit: 'unicode_code_point' },
      ...(effect ? [{ field: 'effects', text: effect, start: n + 1, end: n + 1 + [...effect].length, basis: 'rawText', offsetUnit: 'unicode_code_point' }] : [])
    ], ...extra };
}
function formula(id, ids, extra = {}) {
  return { id, herbIds: ids, ingredientRefs: ids.map(id => ({ id, sourceName: id, scope: 'core', mappingStatus: 'exact' })), ...extra };
}
function data(herbs, formulas = []) {
  return { herbs, formulas, rules: [], sources: [{ id: 'fixture', url: 'https://example.test/source' }] };
}
function label(text) {
  return { text, sourceId: 'fixture', evidenceSpan: { text, start: 0, end: [...text].length, basis: 'sourcePlainText' } };
}

check('unknown temperature never becomes neutral or a full-formula zero', () => {
  const d = data([herb('warm'), herb('unknown', '未錄')]);
  const r = model.aggregate([row('warm'), row('unknown', 3)], d);
  assert.equal(r.range, null);
  assert.deepEqual(plain(r.knownSubsetRange), [1, 1]);
  close(r.thermalCoverage, .25);
  assert.deepEqual(plain(r.unknownIds), ['unknown']);
  const all = model.aggregate([row('unknown')], d);
  assert.equal(all.range, null);
  assert.equal(all.knownSubsetRange, null);
  assert.equal(model.aggregate([], d).range, null);
});

check('processing alternatives retain uncertainty and editorial restatements do not create it', () => {
  assert.deepEqual(plain(model.thermal(herb('r', '生微涼／熟溫')).range), [-.5, 1]);
  assert.deepEqual(plain(model.thermal(herb('g', '生平／炙溫')).range), [0, 1]);
  assert.equal(model.thermal(herb('same', '生溫／熟溫')).status, 'conditional');
  assert.equal(model.thermal(herb('missing', '生溫／熟未錄')).range, null);
  assert.equal(model.thermal(herb('missing', '生溫／熟')).range, null);
  assert.deepEqual(plain(model.thermal(herb('m', '微寒（原文：寒微）')).range), [-1, -1]);
  assert.equal(model.thermal(herb('m', '微寒（原文：寒微）')).status, 'coded');
  assert.deepEqual(plain(model.thermal(herb('post', '寒微')).range), [-1, -1]);
});

check('a zero mean of opposing labels is flagged rather than called neutral', () => {
  const d = data([herb('cold', '寒'), herb('hot', '熱')]);
  const r = model.aggregate([row('cold'), row('hot')], d);
  assert.deepEqual(plain(r.range), [0, 0]);
  assert.equal(r.oppositeSigns, true);
  assert.equal(r.positiveWeight, 1);
  assert.equal(r.negativeWeight, 1);
});

check('ordinal parameters change scores transparently and reject invalid settings', () => {
  const h = herb('hot', '大熱');
  assert.deepEqual(plain(model.thermal(h).range), [3, 3]);
  assert.deepEqual(plain(model.thermal(h, 'wide', .5, 2).range), [8, 8]);
  for (const args of [['other'], ['base', 0], ['base', NaN], ['base', .5, Infinity]]) {
    assert.throws(() => model.thermal(h, ...args));
  }
  assert.throws(() => model.aggregate([], data([h]), { mild: -1 }));
});

check('lexical matches require correct Unicode source positions and skip negated claims', () => {
  const h = herb('h', '溫', '不宜使用補氣；另記補氣');
  const qi = model.lexical(h).find(x => x.id === 'qi');
  assert.equal(qi.evidence.length, 1);
  assert.equal(qi.evidence[0].term, '補氣');
  const astral = herb('emoji', '🧪溫', '補氣');
  const e = model.lexical(astral).find(x => x.id === 'qi').evidence[0];
  assert.equal([...astral.rawText].slice(e.termStart, e.termEnd).join(''), '補氣');
  h.evidenceSpans[1].start++;
  assert.equal(model.lexical(h).find(x => x.id === 'qi').present, false);
  const wrongUnit = herb('unit'); wrongUnit.evidenceSpans[1].offsetUnit = 'utf16';
  assert.equal(model.lexical(wrongUnit).find(x => x.id === 'qi').present, false);
  assert.equal(model.lexical(herb('none', '溫', '補氣', { evidenceSpans: [] })).find(x => x.id === 'qi').present, false);
});

check('incomplete core materials preserve a full-composition denominator', () => {
  const d = data([herb('a')]);
  const f = formula('partial', ['a'], { ingredientRefs: [
    { id: 'a', sourceName: 'A', scope: 'core', mappingStatus: 'exact' },
    { id: null, sourceName: 'Unresolved', scope: 'core', mappingStatus: 'unresolved' }
  ], profileEvidence: [label('補氣')] });
  const p = model.referenceProfile(f, d);
  assert.equal(p.result.completeComposition, false);
  assert.equal(p.result.range, null);
  assert.equal(p.result.totalWeight, 2);
  close(p.result.thermalCoverage, .5);
  close(p.result.labels.find(x => x.id === 'qi').coverage, .5);
  assert.equal(p.unresolved.length, 1);
  assert.equal(model.uniqueCorpus({ ...d, formulas: [f] }).included.length, 0);
});

check('core versus auxiliary scope, missing parse rows and historical mappings are explicit', () => {
  const d = data([herb('a'), herb('b')]);
  const auxiliary = formula('aux', ['a'], { ingredientRefs: [
    { id: 'a', sourceName: 'A', scope: 'core', mappingStatus: 'exact' },
    { id: null, sourceName: 'Aux', scope: 'auxiliary', mappingStatus: 'unresolved' }
  ] });
  assert.equal(model.composition(auxiliary, d).complete, true);
  assert.equal(model.composition(formula('omitted', ['a'], { ingredientRefs: formula('f', ['a', 'b']).ingredientRefs }), d).complete, false);
  assert.equal(model.composition(formula('unknown', ['ghost']), d).complete, false);
  assert.equal(model.composition({ id: 'legacy', herbIds: ['a'] }, d).complete, false);
  const ambiguous = formula('amb', ['a'], { ingredientRefs: [{ id: 'a', sourceName: 'Alias', scope: 'core', mappingStatus: 'historical_mapping' }] });
  assert.equal(model.composition(ambiguous, d).complete, false);
  assert.equal(model.referenceProfile(ambiguous, d).result.range, null);
});

check('source phrases do not pretend to be independent validation or leak into inputs', () => {
  const d = data([herb('a')]);
  const f = formula('f', ['a'], { name: '清熱方', profileEvidence: [label('補氣')] });
  const a = model.referenceProfile(f, d);
  const b = model.referenceProfile({ ...f, name: '補氣方', profileEvidence: [label('清熱')] }, d);
  assert.equal(a.hasSourceLabel, true);
  assert.equal(a.hasIndependentLabel, false);
  assert.deepEqual(plain(a.result), plain(b.result));
  assert.deepEqual(plain(b.expected), ['heat']);
  assert.equal(model.referenceProfile({ ...f, profileEvidence: [label('不宜使用補氣')] }, d).expected.length, 0);
  const bad = label('補氣'); bad.evidenceSpan.end++;
  assert.equal(model.referenceProfile({ ...f, profileEvidence: [bad] }, d).hasSourceLabel, false);
});

check('pair denominators include formulas containing neither queried herb', () => {
  const herbs = [herb('a'), herb('b')]; const formulas = [];
  const cells = [['ab', 20, ['a', 'b']], ['a', 10, ['a']], ['b', 20, ['b']], ['none', 50, []]];
  for (const [name, count, ids] of cells) for (let i = 0; i < count; i++) {
    const sentinel = name + '-' + i; herbs.push(herb(sentinel));
    formulas.push(formula(sentinel, [...ids, sentinel]));
  }
  const d = data(herbs, formulas);
  const r = model.pairStats('a', 'b', d);
  assert.deepEqual([r.N, r.n11, r.n10, r.n01, r.n00], [100, 20, 10, 20, 50]);
  close(r.phi, (20.5 * 50.5 - 10.5 * 20.5) / Math.sqrt(31 * 71 * 41 * 61));
  close(r.logLift, Math.log((20.5 / 102) / ((31 / 102) * (41 / 102))));
  const reverse = model.pairStats('b', 'a', d);
  close(reverse.phi, r.phi); close(reverse.logLift, r.logLift);
  assert.equal(reverse.n10, r.n01);
  const copy = { ...formulas[0], id: 'mirror' };
  assert.equal(model.pairStats('a', 'b', { ...d, formulas: [...formulas, copy] }).N, 100);
});

check('small and degenerate corpora do not manufacture an association through smoothing', () => {
  const d = data([herb('a'), herb('b'), herb('c')], [formula('f', ['a', 'b']), formula('g', ['a', 'c'])]);
  const r = model.pairStats('a', 'b', d);
  assert.equal(r.N, 2); assert.equal(r.phi, null); assert.equal(r.logLift, null);
  assert.equal(r.status, '無法估計');
  const empty = model.pairStats('a', 'b', { ...d, formulas: [] });
  assert.equal(empty.N, 0); assert.equal(empty.phi, null);
  assert.throws(() => model.pairStats('a', 'a', d));
});

check('known mirrors use duplicate groups and incomplete formulas cannot affect statistics', () => {
  const d = data([herb('a'), herb('b'), herb('c')], [
    formula('first', ['a', 'b'], { duplicateGroupId: 'copy' }),
    formula('mirror', ['a', 'c'], { duplicateGroupId: 'copy' }),
    formula('partial', ['a'], { ingredientRefs: [{ id: null, sourceName: 'Unknown', mappingStatus: 'unresolved' }] })
  ]);
  assert.equal(model.uniqueCorpus(d).included.length, 1);
  assert.equal(model.uniqueCorpus(d).excluded.length, 2);
});

check('candidate admission requires exact core mappings, evidence and resolved historical identity', () => {
  const herbs = [herb('ok'), herb('toxic', '溫', '補氣', { toxic: { sourceId: 'fixture' } }),
    herb('mixed', '生平／炙溫'), herb('unlinked', '溫', '補氣', { evidenceSpans: [] }),
    herb('alias'), herb('identity', '溫', '補氣', { identityNote: '本書分述赤、白芍；不能由原文直接斷定白芍。' })];
  const formulas = herbs.map(h => formula('f-' + h.id, [h.id]));
  formulas.find(f => f.herbIds[0] === 'alias').ingredientRefs[0].mappingStatus = 'historical_mapping';
  assert.deepEqual(plain(model.candidatePool(data(herbs, formulas)).map(h => h.id)), ['ok']);
});

check('generation cannot trade off alerts against target match or novelty', () => {
  const herbs = ['a', 'b', 'c', 'd'].map(id => herb(id));
  const formulas = herbs.map(h => formula(h.id, [h.id]));
  const d = data(herbs, formulas); d.rules = [{ id: 'risk', a: ['a'], b: ['b'], sourceId: 'fixture' }];
  const g = model.generate(d, { noveltyWeight: 1 });
  assert.equal(g.considered, 4); assert.equal(g.rejectedRules, 2);
  assert.ok(g.results.every(x => !x.rows.some(r => r.id === 'a') || !x.rows.some(r => r.id === 'b')));
  for (const x of g.results) assert.ok(x.rows.every(r => r.ratio === 1));
  assert.throws(() => model.generate(d, { goal: 'cure' }));
});

check('real corpus handles every formula, identifies partial data and keeps independent-validation false', () => {
  for (const f of real.formulas) {
    const p = model.referenceProfile(f, real);
    assert.equal(p.hasIndependentLabel, false);
    assert.ok(p.result.thermalCoverage >= 0 && p.result.thermalCoverage <= 1);
  }
  for (const id of ['baihutang', 'wulingsan', 'suanzaoren']) {
    assert.equal(model.referenceProfile(real.formulas.find(f => f.id === id), real).result.completeComposition, false);
  }
  assert.equal(model.thermal(real.herbs.find(h => h.id === 'mudanpi')).status, 'coded');
  const pool = model.candidatePool(real);
  assert.ok(pool.every(h => !h.toxic && model.thermal(h).evidence.length));
  assert.equal(model.generate(real, { goal: 'qi' }).results.length, 0);
});

console.log(`${passed} quantitative research checks passed`);
