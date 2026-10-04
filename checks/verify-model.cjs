'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const project = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(project, file), 'utf8');
const research = JSON.parse(read('research/herbs/herbs-and-formulas.json'));
const sandbox = {window: {}};
vm.createContext(sandbox);
vm.runInContext(read('dist/data.js'), sandbox, {filename: 'dist/data.js'});
vm.runInContext(read('dist/model.js'), sandbox, {filename: 'dist/model.js'});
const d = JSON.parse(JSON.stringify(sandbox.window.HERB_DATA));
const m = sandbox.HerbModel;
let passed = 0;
let validatedSpans = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('PASS ' + name);
}
const row = (id, ratio = 1) => ({id, ratio, role: '未標註'});
const unresolvedRefs = f => (f.ingredientRefs || []).filter(r => r.mappingStatus === 'unresolved' || !r.id);
const herbById = new Map(d.herbs.map(h => [h.id, h]));
const sourceById = new Map(d.sources.map(s => [s.id, s]));
const reviewedSources = {
  renshen: 'bencao-renshen', baizhu: 'bencao-baizhu', fuling: 'bencao-fuling',
  gancao: 'bencao-gancao', guizhi: 'bencao-guizhi', baishao: 'bencao-baishao',
  shengjiang: 'bencao-shengjiang', dazao: 'shennong-dazao', shudihuang: 'bencao-shudihuang',
  shanzhuyu: 'bencao-shanzhuyu', shanyao: 'shennong-shanyao', zexie: 'shennong-zexie',
  mudanpi: 'bencao-mudanpi', huangqi: 'bencao-huangqi', chenpi: 'bencao-chenpi',
  banxia: 'bencao-banxia', fuzi: 'bencao-fuzi', wutou: 'shennong-wutou',
  beimu: 'bencao-beimu', gualou: 'bencao-gualou', baiji: 'bencao-baiji',
  bailian: 'bencao-bailian', haizao: 'bencao-haizao', gansui: 'bencao-gansui'
};

// Python source offsets count Unicode code points; JS string.slice counts UTF-16 units.
function verifySpan(text, span, expectedBasis, label) {
  assert.equal(span.offsetUnit, 'unicode_code_point', label + ': offset unit');
  assert.equal(span.basis, expectedBasis, label + ': basis');
  assert.ok(Number.isInteger(span.start) && Number.isInteger(span.end), label + ': integer offsets');
  const points = Array.from(text);
  assert.ok(span.start >= 0 && span.end > span.start && span.end <= points.length, label + ': bounds');
  assert.equal(points.slice(span.start, span.end).join(''), span.text, label + ': source excerpt');
  validatedSpans++;
}

check('research and browser datasets retain identical evidence and identities', () => {
  const core = JSON.parse(JSON.stringify(d));
  // These two fields are UI summaries, added from the same research records.
  for (const h of core.herbs) if (!('section' in research.herbs.find(r => r.id === h.id))) delete h.section;
  for (const f of core.formulas) if (!('ingredientSummary' in research.formulas.find(r => r.id === f.id))) delete f.ingredientSummary;
  const original=JSON.parse(JSON.stringify(research));
  // Public metadata rewrites only the two documented parser locations.
  assert.equal(core.provenance.parserFile, "tools/extract-herbs.py");
  assert.equal(core.provenance.formulaParserFile, "tools/extract-formulas.py");
  original.provenance.parserFile=core.provenance.parserFile;
  original.provenance.formulaParserFile=core.provenance.formulaParserFile;
  assert.deepEqual(core, original);
});

check('340 entries, 18 formulas and all source/ingredient references resolve explicitly', () => {
  assert.equal(d.herbs.length, 340);
  assert.equal(d.formulas.length, 18);
  assert.equal(herbById.size, d.herbs.length);
  assert.equal(sourceById.size, d.sources.length);
  assert.equal(new Set(d.formulas.map(f => f.id)).size, d.formulas.length);
  for (const h of d.herbs) {
    assert.ok(sourceById.has(h.sourceId), h.id);
    assert.ok(h.quote && h.rawText.includes(h.quote), h.id + ': display quote');
    assert.equal(h.modernSafety, 'unknown', h.id + ': no inferred modern safety');
  }
  for (const s of d.sources) assert.equal(new URL(s.url).protocol, 'https:', s.id);
  for (const f of d.formulas) {
    assert.ok(sourceById.has(f.sourceId), f.id);
    for (const id of f.herbIds) assert.ok(herbById.has(id), f.id + ': ' + id);
    assert.ok(f.ingredientRefs.length, f.id + ': explicit ingredient identities');
    for (const r of f.ingredientRefs) {
      assert.ok(['exact', 'historical_mapping', 'unresolved'].includes(r.mappingStatus), f.id);
      assert.ok(['core', 'auxiliary'].includes(r.scope), f.id);
      assert.equal(r.researchWeight, 1, f.id + ': equal nonclinical research weights');
      if (r.mappingStatus === 'unresolved') assert.equal(r.id, null, f.id + ': unresolved placeholder');
      else assert.ok(herbById.has(r.id), f.id + ': mapped ingredient');
      if (r.scope === 'core') assert.ok(f.rawIngredientText.includes(r.sourceName), f.id + ': original ingredient name');
    }
    assert.deepEqual(f.herbIds, f.ingredientRefs.filter(r => r.scope === 'core' && r.id).map(r => r.id));
  }
  for (const r of d.rules) {
    assert.ok(sourceById.has(r.sourceId), r.id);
    for (const id of [...r.a, ...r.b]) assert.ok(herbById.has(id), r.id);
  }
  for (const w of d.modernWarnings) assert.ok(sourceById.has(w.sourceId), w.id);
});

check('24 reviewed excerpts and 316 automatic entries remain distinguished', () => {
  const reviewed = d.herbs.filter(h => h.reviewStatus === 'curated_source_excerpt_reviewed');
  const automatic = d.herbs.filter(h => h.reviewStatus === 'automatically_extracted_not_individually_reviewed');
  assert.equal(reviewed.length, 24);
  assert.equal(automatic.length, 316);
  assert.equal(reviewed.length + automatic.length, d.herbs.length);
  assert.deepEqual(reviewed.map(h => h.id).sort(), Object.keys(reviewedSources).sort());
  for (const h of reviewed) assert.equal(h.sourceId, reviewedSources[h.id], h.id + ': preserved source version');
  for (const h of automatic) {
    assert.equal(h.extractionStatus, 'automatic_conservative', h.id);
    assert.ok(h.identityNote && h.materialType && h.materialTypeNote, h.id + ': identity scope');
  }
  assert.deepEqual(d.qaReport.reviewCounts, {
    curated_source_excerpt_reviewed: 24,
    automatically_extracted_not_individually_reviewed: 316
  });
});

check('every herb, toxicity and ingredient span matches its original code points', () => {
  let herbSpans = 0;
  for (const h of d.herbs) {
    assert.ok(Array.isArray(h.evidenceSpans), h.id);
    for (const span of h.evidenceSpans) {
      verifySpan(h.rawText, span, 'rawText', h.id);
      herbSpans++;
    }
    for (const statement of h.historicalToxicity.literalEntryStatements || []) {
      verifySpan(h.rawText, statement.evidenceSpan, 'rawText', h.id + ': toxicity');
      assert.equal(statement.text, statement.evidenceSpan.text, h.id + ': literal statement');
    }
  }
  assert.equal(herbSpans, 1416);
  assert.equal(herbSpans, d.qaReport.validatedHerbEvidenceSpanCount);
  for (const f of d.formulas) for (const span of f.rawEvidenceSpans) {
    verifySpan(f.rawIngredientText, span, 'rawText', f.id);
  }
});

check('span validation handles non-BMP text and rejects altered excerpts', () => {
  const span = {start: 1, end: 2, text: '𠮷', basis: 'rawText', offsetUnit: 'unicode_code_point'};
  verifySpan('甲𠮷乙', span, 'rawText', 'code point fixture');
  assert.throws(() => verifySpan('甲𠮷乙', {...span, text: '乙'}, 'rawText', 'altered fixture'));
  assert.throws(() => verifySpan('甲𠮷乙', {...span, end: 4}, 'rawText', 'invalid bounds'));
});

check('independent formula labels retain exact source snapshots', () => {
  const labeled = d.formulas.filter(f => f.traditionalProfileLabels.length);
  assert.equal(labeled.length, 4);
  for (const f of labeled) {
    assert.ok(f.profileEvidence.length, f.id);
    for (const e of f.profileEvidence) {
      assert.equal(e.sourceId, f.sourceId, f.id + ': label source');
      assert.equal(path.basename(e.evidenceSpan.file), e.evidenceSpan.file, f.id + ': snapshot filename');
      const text = read(path.join('research/herbs/source-snapshots', e.evidenceSpan.file));
      verifySpan(text, e.evidenceSpan, 'sourcePlainText', f.id + ': independent label');
      assert.equal(e.text, e.evidenceSpan.text, f.id);
    }
  }
  for (const f of d.formulas.filter(f => !f.traditionalProfileLabels.length)) assert.equal(f.profileEvidence.length, 0, f.id);
});

check('historical toxicity preserves negative polarity and context without a safety verdict', () => {
  let literalCount = 0;
  let negativeCount = 0;
  for (const h of d.herbs) {
    const toxicity = h.historicalToxicity;
    assert.equal(toxicity.modernSafety, 'unknown', h.id);
    if (toxicity.status === 'source_asserts_toxic') {
      assert.ok(toxicity.statements.some(t => /有(?:大|小|微|劇)?毒|至毒/.test(t)), h.id);
      assert.ok(h.toxic, h.id + ': explicit opening toxicity');
    }
    for (const statement of toxicity.literalEntryStatements || []) {
      literalCount++;
      const positive = /有(?:大|小|微|劇)?毒|至毒/.test(statement.text);
      const negative = /無毒|无毒/.test(statement.text);
      assert.equal(statement.polarity, positive && negative ? 'mixed' : negative ? 'historical_no_toxicity_claim' : 'historical_toxicity_claim', h.id + ': historical polarity');
      assert.ok(positive || negative, h.id + ': explicit toxicity phrase');
      if (negative && !positive) {
        negativeCount++;
        assert.notEqual(toxicity.status, 'source_asserts_toxic', h.id + ': negative phrase is not positive evidence');
        assert.equal(m.analyze([row(h.id)], d).warnings.filter(w => w.type === 'toxicity').length, 0, h.id + ': no warning from 毒 substring alone');
      }
    }
  }
  assert.equal(literalCount, 42);
  assert.ok(negativeCount > 0);
  // This sentence concerns other materials; all-entry mentions must not become a per-herb verdict.
  assert.ok(herbById.get('shengjiang').historicalToxicity.literalEntryStatements.some(s => s.polarity === 'historical_toxicity_claim'));
  assert.equal(m.analyze([row('shengjiang')], d).warnings.filter(w => w.type === 'toxicity').length, 0);
  // Conditional/kernel-specific claims retain their scope instead of becoming automatic flags.
  const peach = d.herbs.find(h => h.name === '桃仁');
  assert.ok(peach.historicalToxicity.literalEntryStatements.some(s => s.text.includes('雙仁者有毒')));
  assert.equal(peach.historicalToxicity.status, 'unknown');
  assert.equal(m.analyze([row(peach.id)], d).warnings.filter(w => w.type === 'toxicity').length, 0);
});

check('absence and negated toxicity wording do not create safety or toxicity scores', () => {
  for (const text of ['無毒', '无毒', '並非有毒', '未見毒性記載']) {
    const herb = {id: 'historical-text-fixture', nature: '此條未明載', flavors: [], meridians: [], quote: text,
      historicalToxicity: {status: 'unknown', statements: [text], modernSafety: 'unknown'}, modernSafety: 'unknown'};
    const result = m.analyze([row(herb.id)], {herbs: [herb], formulas: [], rules: []});
    assert.equal(result.warnings.length, 0, text);
    assert.ok(!('safetyScore' in result) && !('toxicityScore' in result), text);
  }
});

check('unresolved classical ingredients cannot produce 100 percent overlap', () => {
  const incomplete = d.formulas.filter(f => unresolvedRefs(f).length);
  assert.equal(incomplete.length, 3);
  assert.deepEqual(incomplete.flatMap(f => unresolvedRefs(f).map(r => r.sourceName)).sort(), ['株茯苓', '石膏', '芎藭'].sort());
  for (const f of incomplete) {
    const match = m.analyze(f.herbIds.map(id => row(id)), d).matches.find(x => x.id === f.id);
    const unresolvedNames = [...new Set(unresolvedRefs(f).map(r => r.sourceName))];
    const resolvedCount = new Set(f.herbIds).size;
    assert.ok(match.percent < 100, f.id + ': partial source formula');
    assert.equal(match.percent, resolvedCount / (resolvedCount + unresolvedNames.length) * 100, f.id + ': denominator includes unknown ingredients');
    assert.deepEqual(Array.from(match.unresolvedIngredientNames).sort(), unresolvedNames.sort());
    for (const name of unresolvedNames) assert.ok(match.missing.includes('unresolved:' + name), f.id + ': visible missing placeholder');
  }
});

check('historical ingredient names and preparation boundaries remain explicit', () => {
  const guizhi = d.formulas.find(f => f.id === 'guizhitang');
  assert.ok(guizhi.ingredientRefs.some(r => r.sourceName === '芍藥' && r.id === 'shaoyao-historical'));
  assert.ok(!guizhi.herbIds.includes('baishao'));
  assert.notEqual(herbById.get('shaoyao-historical').sourceId, herbById.get('baishao').sourceId);
  const erchen = d.formulas.find(f => f.id === 'erchen');
  assert.ok(erchen.ingredientRefs.some(r => r.sourceName === '橘紅' && r.mappingStatus === 'historical_mapping'));
  assert.deepEqual(erchen.ingredientRefs.filter(r => r.scope === 'auxiliary').map(r => r.sourceName), ['生薑', '烏梅']);
  assert.ok(d.formulas.some(f => f.ingredientRefs.some(r => r.id === 'ganjiang-historical')));
});

check('empty selection has no distribution or warnings', () => {
  const r = m.analyze([], d);
  assert.equal(r.nature.length, 0);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.totalWeight, 0);
});
check('mixed processing labels remain unresolved', () => {
  assert.equal(m.natureGroup('生微涼／熟溫'), '需辨加工');
  assert.equal(m.natureGroup('生平／炙溫'), '需辨加工');
  assert.equal(m.natureGroup('此條未明載'), '未錄');
});
check('invalid and duplicate inputs are rejected', () => {
  for (const ratio of [0, -1, NaN, Infinity, 1.5, 21]) assert.throws(() => m.analyze([row('gancao', ratio)], d));
  assert.throws(() => m.analyze([row('gancao'), row('gancao')], d));
  assert.throws(() => m.analyze([row('unknown')], d));
});
check('sparse safety rules preserve independent toxicity', () => {
  const r = m.analyze([row('wutou'), row('banxia')], d);
  assert.equal(r.warnings.filter(x => x.type === 'compatibility').length, 1);
  assert.equal(r.warnings.find(x => x.type === 'compatibility').references.length, 2);
  assert.equal(r.warnings.filter(x => x.type === 'toxicity').length, 2);
});
check('low relative ratio cannot suppress warning', () => {
  for (const ratio of [1, 20]) {
    const r = m.analyze([row('gancao', ratio), row('gansui')], d);
    assert.equal(r.warnings.filter(x => x.type === 'compatibility').length, 1);
    assert.equal(r.warnings.filter(x => x.type === 'toxicity').length, 1);
  }
});
check('official caution does not invent historical fuzi identity', () => {
  const w = m.analyze([row('fuzi'), row('beimu')], d).warnings.find(x => x.type === 'compatibility');
  assert.equal(w.references.length, 1);
  assert.equal(w.references[0].evidenceType, 'modern_official_guidance');
});
check('missing meridians remain unknown', () => {
  const r = m.analyze([row('dazao')], d);
  assert.equal(r.meridians[0].label, '未錄');
  assert.equal(r.meridians[0].percent, 100);
  assert.equal(d.herbs.filter(h => !h.meridians.length).length, 282);
  assert.equal(d.herbs.filter(h => /未知/.test(h.nature)).length, 87);
});
check('ordering and proportional scaling do not change distributions or overlap', () => {
  const a = m.analyze([row('guizhi', 2), row('dazao', 1)], d);
  const b = m.analyze([row('dazao', 2), row('guizhi', 4)], d);
  for (const key of ['nature', 'flavors', 'meridians', 'matches']) assert.equal(JSON.stringify(a[key]), JSON.stringify(b[key]));
});
check('complete formula overlap does not depend on research weights', () => {
  const f = d.formulas.find(f => f.id === 'sijunzi');
  const r = m.analyze(f.herbIds.map((id, i) => row(id, i + 1)), d);
  assert.equal(r.matches.find(x => x.id === f.id).percent, 100);
});
check('multi-label allocation conserves total weight across all 340 entries', () => {
  const r = m.analyze(d.herbs.map((h, i) => row(h.id, (i % 20) + 1)), d);
  for (const key of ['nature', 'flavors', 'meridians']) assert.ok(Math.abs(r[key].reduce((sum, x) => sum + x.percent, 0) - 100) < 1e-9);
});
check('unrelated herbs produce no compatibility warning', () => {
  assert.equal(m.analyze([row('baizhu'), row('fuling')], d).warnings.length, 0);
});
console.log(passed + ' research model checks passed; ' + validatedSpans + ' source-span validations');
