'use strict';
// Assertions use synthetic source text and independent counting, never clinical truth.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../dist/inference-model.js');
const M = globalThis.InferenceModel;
const cp = s => [...s].length;
const copy = x => JSON.parse(JSON.stringify(x));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function corpus(specs) {
  const texts = {}, registry = new Map(), sources = new Map();
  const put = (sourceId, text, field) => {
    const file = 'snapshots/' + sourceId + '.txt';
    const before = texts[file] || '', start = cp(before);
    texts[file] = before + text + '\n';
    return { text, start, end: start + cp(text), file, field, offsetUnit: 'unicode_code_point', basis: 'sourcePlainText' };
  };
  const formulas = specs.map((s, i) => {
    const sourceId = s.sourceId || 'book-' + (i % 3);
    sources.set(sourceId, { id: sourceId, title: sourceId, url: 'https://example.invalid/' + sourceId });
    const name = s.name || '測試方' + i;
    const text = s.text || (s.positive ? '發熱者' : '腹痛者') + '，' + name + '主之。';
    const indication = put(sourceId, text, 'indication');
    const ingredientRefs = s.names.map((sourceName, j) => {
      const elementId = 'text-' + sourceName;
      registry.set(elementId, { id: elementId, name: sourceName, sourceName, catalogHerbId: sourceName === '甲' ? 'catalog-a' : null,
        mappingStatus: sourceName === '乙' ? 'ambiguous_text' : sourceName === '甲' ? 'exact_text' : 'unresolved', modernIdentity: '未核定' });
      const annotationText = s.processing && j === 0 ? '一兩，炙' : '';
      const evidenceSpan = put(sourceId, sourceName + (annotationText ? '（' + annotationText + '）' : ''), 'ingredient');
      const nameSpan = { ...evidenceSpan, field: 'ingredientName', text: sourceName, end: evidenceSpan.start + cp(sourceName) };
      return { sourceName, sourceElementId: elementId, catalogHerbId: sourceName === '甲' ? 'catalog-a' : null,
        id: sourceName === '甲' ? 'catalog-a' : null, mappingStatus: registry.get(elementId).mappingStatus, scope: 'core',
        annotationText, preparation: annotationText ? '炙' : '', evidenceSpan, nameSpan };
    });
    return { id: s.id || 'f-' + i, name, sourceId, sourceBook: sourceId, sourceURL: 'https://example.invalid/' + sourceId + '#' + i,
      familyId: s.familyId || 'family-' + i, ingredientRefs, ingredientParsingComplete: s.complete !== false,
      declaredIngredientCount: s.declared || s.names.length, unparsedIngredientFragments: s.unparsed || [],
      rawIndications: text, profileEvidence: [{ text, sourceId, assertionKind: 'indication', extractionMethod: 'explicit_named_target_clause', evidenceSpan: indication }],
      labels: ['heat'], reviewStatus: 'synthetic_test_fixture' };
  });
  return { sources: [...sources.values()], sourceElements: [...registry.values()], sourceTexts: texts, formulas };
}
const data = { sources: [], herbs: [{ id: 'catalog-a', name: '甲' }] };
const specs = Array.from({ length: 48 }, (_, i) => ({ names: [i < 24 ? '甲' : '丙', '乙', '唯' + i], positive: i < 24, processing: i < 24 }));
const fixture = corpus(specs), model = M.fit(data, fixture);
const small = { minTrainRecords: 8, minTrainGroups: 4, minLabelPositive: 2, minLabelNegative: 2,
  minLabelPositiveGroups: 2, minLabelNegativeGroups: 2, minElementSupport: 2, minElementGroups: 2 };

check('source spans and supplied labels are not targets', () => {
  assert.equal(model.summary.eligible, 48);
  assert.deepEqual(model.records[30].silver.labelIds, ['pain']);
  assert.equal(model.records[0].silver.evidence[0].text, '發熱者');
  assert.equal(model.records[0].silver.evidence[0].spanStatus, 'verified_snapshot');
  const bad = copy(fixture.formulas[0]); bad.profileEvidence[0].evidenceSpan.start++;
  assert.equal(M.silverLabels(bad, fixture.sources, fixture.sourceTexts).eligible, false);
  bad.profileEvidence[0] = { ...fixture.formulas[0].profileEvidence[0], assertionKind: 'indication_context_not_label_input' };
  assert.equal(M.silverLabels(bad, fixture.sources, fixture.sourceTexts).eligible, false);
});
check('snapshot filename and source-id text maps verify the same spans and train the same counts', () => {
  const d = copy(fixture);
  d.sourceTexts = Object.fromEntries(d.sources.map(s => [s.id, fixture.sourceTexts['snapshots/' + s.id + '.txt']]));
  const m = M.fit(data, d);
  assert.deepEqual(m.summary, model.summary); assert.deepEqual(m.training, model.training);
  assert.ok(m.records.every(r => r.silver.evidence.every(e => e.spanStatus === 'verified_snapshot')));
});
check('literal unknown/ambiguous catalog identity remains a known text element', () => {
  const q = M.queryOf(model, [{ sourceElementId: 'text-乙' }, { sourceElementId: 'text-唯0' }]);
  assert.equal(q.textElementCoverage, 1); assert.equal(q.catalogMappingCoverage, 0);
  assert.equal(q.refs[0].modernIdentity, '未核定');
  assert.equal(M.queryOf(model, [{ id: 'catalog-a' }]).elementIds[0], 'text-甲');
});
check('unknown coverage is explicit and incomplete source parsing cannot train', () => {
  const q = M.predict(model, [{ sourceElementId: 'text-甲' }, { sourceName: '未入語料' }]);
  assert.equal(q.textElementCoverage, .5); assert.equal(q.abstained, true); assert.equal(q.terms.length, 0);
  const d = corpus([{ names: ['甲'], positive: true, complete: false, declared: 2, unparsed: ['未知成分'] }]);
  const m = M.fit(data, d, small); assert.equal(m.summary.eligible, 0);
  assert.equal(m.records[0].composition.textElementCoverage, .5);
  assert.equal(M.predict(m, { formulaId: 'f-0' }).abstained, true);
});
check('negation/contrast, names and unrelated branches cannot produce silver positives', () => {
  const d = corpus([
    { name: '清熱湯', names: ['甲'], text: '不發熱而煩躁者，清熱湯主之。' },
    { name: '乙湯', names: ['甲'], text: '發熱者，甲湯主之；腹痛者，乙湯主之。' },
    { name: '丙湯', names: ['甲'], text: '不可服者發熱，丙湯主之。' },
    { name: '丁湯', names: ['甲'], text: '腹痛者，丁湯主之。服之則發熱。' }
  ]);
  const m = M.fit(data, d, small);
  assert.deepEqual(m.records[0].silver.labelIds, ['spirit']);
  assert.equal(m.records[0].silver.labels.find(l => l.id === 'heat').negated.length, 1);
  assert.equal(m.records[0].silver.labels.find(l => l.id === 'clear_terms').present, false);
  assert.equal(m.records[1].silver.eligible, false); assert.equal(m.records[2].silver.eligible, false);
  assert.deepEqual(m.records[3].silver.labelIds, ['pain']);
});
check('workbench weights and unverified processing are ignored, not negative', () => {
  const a = M.predict(model, [{ sourceElementId: 'text-甲', ratio: 1, preparation: '炙' }]);
  const b = M.predict(model, [{ sourceElementId: 'text-甲', ratio: 99999, preparation: '生用' }]);
  assert.deepEqual(a.terms, b.terms); assert.deepEqual(a.processingEvidence.features, []);
  assert.equal(a.processingEvidence.unknownIsNotNegative, true);
  assert.match(a.processingEvidence.status, /未核炮製/);
  assert.equal(M.queryOf(model, { formulaId: 'f-0' }).features.includes('processing:text-甲:炙'), true);
});
check('2x2 counts and smoothing use all eligible records including joint absence', () => {
  const a = M.elementAssociation(model, 'text-甲'), heat = a.associations.find(x => x.id === 'heat');
  assert.deepEqual([heat.n11, heat.n10, heat.n01, heat.n00], [24, 0, 0, 24]);
  assert.equal(heat.n11 + heat.n10 + heat.n01 + heat.n00, 48);
  assert.equal(heat.conditionalRuleHit, 25 / 26);
  assert.ok(Math.abs(heat.logLift - Math.log(25 / 13)) < 1e-12);
  assert.equal(a.elementPresentGroups, 24);
});
check('perfectly co-occurring columns have a single vote and are not identifiable', () => {
  const a = M.elementAssociations(model, 'text-甲');
  assert.ok(a.identifiability.identicalOccurrenceColumns.includes('processing:text-甲:炙'));
  assert.equal(a.identifiability.uniqueSingleElementEffect, false);
  const p = M.predict(model, [{ sourceElementId: 'text-甲' }]);
  const heat = p.terms.find(x => x.id === 'heat');
  assert.equal(heat.contributions.filter(c => c.featureIds.includes('element:text-甲')).length, 1);
  assert.ok(Math.abs(heat.associationScore - 25 / 26) < 1e-12);
});
check('a three-record element in one proxy family has insufficient independent group support', () => {
  const d = corpus(Array.from({ length: 12 }, (_, i) => ({ names: [i < 3 ? '罕' : i < 6 ? '甲' : '丙', '唯' + i],
    positive: i % 2 === 0, familyId: i < 3 ? 'one-family' : 'family-' + i })));
  const m = M.fit(data, d, small), a = M.elementAssociations(m, 'text-罕');
  assert.equal(a.support, 3); assert.equal(a.elementPresentGroups, 1);
  assert.ok(a.associations.every(x => !x.supported && x.logLift === null));
  assert.ok(m.training.featureBundles.every(b => !b.featureIds.includes('element:text-罕')));
});
check('deduplication counts exact copies once; conflicting indications share a holdout group', () => {
  const d = copy(fixture), duplicate = copy(d.formulas[0]); duplicate.id = 'copied-record'; duplicate.familyId = 'different-family';
  d.formulas.push(duplicate);
  const conflict = copy(d.formulas[0]); conflict.id = 'conflict-record'; conflict.familyId = 'another-family';
  conflict.profileEvidence = copy(d.formulas[24].profileEvidence); conflict.sourceId = d.formulas[24].sourceId; conflict.name = d.formulas[24].name;
  // Names in all original ingredient spans remain independently verified.
  d.formulas.push(conflict); const m = M.fit(data, d);
  assert.equal(m.summary.duplicates, 1); assert.equal(m.summary.eligible, 49);
  assert.equal(m.records.find(r => r.id === duplicate.id).duplicateOf, 'f-0');
  assert.equal(m.records.find(r => r.id === conflict.id).groupId, m.records[0].groupId);
});
check('query exclusions refit counts and nearest cases use only that training subset', () => {
  const p = M.predict(model, { formulaId: 'f-0' });
  assert.equal(p.trainingSubset.records, 47); assert.ok(p.trainingSubset.excludedFormulaIds.includes('f-0'));
  assert.ok(p.nearestCases.every(r => r.eligibleForTraining && !p.trainingSubset.excludedFormulaIds.includes(r.id)));
  assert.equal(p.terms.find(t => t.id === 'heat').support.ruleHit, 23);
  const self = M.predict(model, model.records[0].composition.refs);
  assert.ok(self.trainingSubset.excludedFormulaIds.includes('f-0'));
});
check('empty queries and unsupported targets abstain without invented numeric results', () => {
  const p = M.predict(model, []); assert.equal(p.abstained, true); assert.deepEqual(p.terms, []);
  assert.equal(p.textElementCoverage, 0); assert.equal(p.validation, null);
  assert.equal(M.fit(data, corpus([{ names: ['甲'], positive: true }])).training.ready, false);
  assert.equal(M.evaluateGrouped(M.fit(data, corpus([{ names: ['甲'], positive: true }]))).performed, false);
  assert.throws(() => M.fit(data, fixture, { alpha: 0 }));
  assert.throws(() => M.validate(model, { folds: 1 }));
  assert.throws(() => M.predict(model, ['text-甲'], { nearestLimit: -1 }));
});
check('held-out targets and exact/near compositions never train on themselves', () => {
  const a = M.evaluateGrouped(model);
  assert.equal(a.performed, true); assert.ok(a.metrics.scoredDecisions > 0); assert.equal(model.validation, null);
  assert.ok(a.folds.every(f => f.groupOverlap.length === 0 && !f.trainIds.some(id => f.testIds.includes(id))));
  // An independent oracle computes baseline Brier using training rows only.
  let err = 0, count = 0;
  for (const f of a.folds) for (const labelId of f.supportedTargets) {
    const train = model.records.filter(r => f.trainIds.includes(r.id)), test = model.records.filter(r => f.testIds.includes(r.id));
    const prior = (train.filter(r => r.silver.labelIds.includes(labelId)).length + 1) / (train.length + 2);
    assert.equal(f.abstainedQueries, 0);
    for (const r of test) { err += (prior - Number(r.silver.labelIds.includes(labelId))) ** 2; count++; }
  }
  assert.ok(Math.abs(a.baselineMetrics.brier - err / count) < 1e-12);
  const book = M.validate(model, { mode: 'sourceBook' });
  assert.ok(book.folds.every(f => f.groupOverlap.length === 0 && !f.trainIds.some(id => f.testIds.includes(id))));
  const close = corpus([{ names: ['甲', '乙', '丙', '丁'], positive: true },
    { names: ['甲', '乙', '丙', '丁', '戊'], positive: false }]);
  const n = M.prepare(data, close); assert.equal(n.records[0].groupId, n.records[1].groupId);
});
check('book holdout also purges cross-book family members', () => {
  const d = copy(fixture); d.formulas[0].familyId = 'cross-book'; d.formulas[1].familyId = 'cross-book';
  const m = M.fit(data, d), v = M.validate(m, { mode: 'sourceBook' });
  const fold = v.folds.find(f => f.testIds.includes('f-0'));
  assert.ok(!fold.trainIds.includes('f-1'));
});
check('shared indication context groups small explicit variants without leaking context into labels', () => {
  const d = copy(fixture);
  const context = { ...copy(d.formulas[0].profileEvidence[0]), assertionKind: 'indication_context_not_label_input' };
  d.formulas[0].indicationContextEvidence = [context];
  d.formulas[3].indicationContextEvidence = [context];
  const m = M.fit(data, d);
  assert.equal(m.records[0].groupId, m.records[3].groupId);
  assert.equal(m.records[3].silver.evidence.length, 1);
  assert.equal(m.records[3].silver.evidence[0].originalEvidenceSpan.start, d.formulas[3].profileEvidence[0].evidenceSpan.start);
  const p = M.predict(m, { formulaId: 'f-0' }); assert.ok(p.trainingSubset.excludedFormulaIds.includes('f-3'));
});

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'research/formulas-v3/formulas.json');
if (fs.existsSync(file)) {
  const actual = JSON.parse(fs.readFileSync(file, 'utf8'));
  actual.sourceTexts = Object.fromEntries(actual.sources.map(s => [s.snapshotFile, fs.readFileSync(path.join(root, 'research/formulas-v3', s.snapshotFile), 'utf8')]));
  const m = M.fit(data, actual);
  check('actual source spans and all retained lexical targets verify against local snapshots', () => {
    assert.equal(m.records.length, actual.formulas.length);
    assert.ok(m.summary.eligible > 100); assert.ok(m.summary.groups > 8);
    for (const r of m.records.filter(r => r.eligible)) {
      assert.equal(r.composition.textElementCoverage, 1);
      assert.ok(r.composition.refs.every(x => x.spanStatus === 'verified_snapshot'));
      assert.ok(r.silver.evidence.every(x => x.spanStatus === 'verified_snapshot'));
      for (const label of r.silver.labels) for (const hit of label.hits) {
        const text = actual.sourceTexts[hit.sourceSpan.file];
        assert.equal([...text].slice(hit.termSpan.start, hit.termSpan.end).join(''), hit.term);
      }
    }
  });
  check('actual source branch fixes and catalog ambiguity have the intended meaning', () => {
    const f = m.records.find(r => r.name === '茯苓甘草湯' && /不渴者/.test(r.rawIndications));
    assert.ok(f); assert.equal(f.silver.eligible, true); assert.deepEqual(f.silver.labelIds, []);
    const dragon = m.records.find(r => r.name === '大青龍湯' && r.sourceBook.includes('傷寒'));
    assert.ok(dragon.silver.labelIds.includes('spirit'));
    assert.ok(dragon.silver.evidence.every(e => !e.text.includes('不可服')));
    const dates = m.elements.find(e => e.sourceName === '大棗');
    assert.ok(dates); assert.equal(M.queryOf(m, [{ sourceElementId: dates.id }]).textElementCoverage, 1);
    const gardenias = m.records.filter(r => ['梔子豉湯', '梔子甘草豉湯', '梔子生薑豉湯'].includes(r.name) && r.sourceBook.includes('傷寒'));
    assert.equal(gardenias.length, 3); assert.equal(new Set(gardenias.map(r => r.groupId)).size, 1);
  });
  check('actual grouped and book validations genuinely execute with no shared proxy groups', () => {
    for (const mode of ['family', 'sourceBook']) {
      const v = M.validate(m, { mode }); assert.equal(v.performed, true);
      assert.ok(v.folds.every(f => f.groupOverlap.length === 0));
      assert.ok(v.coverage.scoredQueryRecords <= v.coverage.testRecords);
      assert.equal(v.metrics.scoredDecisions, v.baselineMetrics.scoredDecisions);
      assert.ok(Number.isFinite(v.metrics.brier) && Number.isFinite(v.baselineMetrics.brier));
      console.log(JSON.stringify({ validation: mode, corpusRecords: m.summary.records, eligible: m.summary.eligible,
        groups: m.summary.groups, scoredQueries: v.coverage.scoredQueryRecords, microF1: v.metrics.microF1,
        baselineMicroF1: v.baselineMetrics.microF1, brier: v.metrics.brier, baselineBrier: v.baselineMetrics.brier }));
    }
  });
}
console.log('Verified ' + checks + ' inference research checks.');
