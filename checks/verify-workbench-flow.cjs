'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const Flow = require('../dist/workbench-flow.js');
const siteRoot = process.argv[2] || path.resolve(__dirname,'..');
const context = {console};
context.window = context;
vm.createContext(context);
for (const name of ['data.js', 'model.js', 'quant-model.js', 'processing-data.js', 'processing-model.js']) {
  vm.runInContext(fs.readFileSync(path.join(siteRoot, 'dist', name), 'utf8'), context, {filename: name});
}
const data = context.HERB_DATA;
const p = context.PROCESSING_DATA;
const model = context.ProcessingModel;
const row = (id, patch = {}) => ({id, ratio: 1, grams: null, role: '未標註', processingId: 'source_unspecified',
  sourceProcessingNote: '', processRecord: Flow.normalizeRecord(), ...patch});
const resolve = (rows, basis = 'research') => model.resolveSelection(rows, data, p, {basis});
const snapshot = (rows, basis = 'research', options = {}) => Flow.snapshot(rows, resolve(rows, basis), {basis, ...options});
const deep = x => JSON.parse(JSON.stringify(x));
let checks = 0;
function test(name, body) {body(); checks++;}
const gancao = data.herbs.find(h => h.id === 'gancao');
const renshen = data.herbs.find(h => h.id === 'renshen');
assert(gancao && renshen);

test('empty has no zero gram substitute and remains explorable', () => {
  const s = snapshot([]);
  assert.equal(s.mass.knownGrams, null);
  assert.equal(s.mass.totalGrams, null);
  assert.equal(s.mass.gramsComplete, false);
  assert.equal(s.scene.mode, 'equal_schematic');
  assert.deepEqual(s.navigation.available, [0, 1, 2, 3]);
  assert.equal(s.scene.canExplore, true);
});
test('partial grams cannot produce full mass fractions', () => {
  const s = snapshot([row('gancao', {grams: 4}), row('renshen')], 'grams');
  assert.equal(s.mass.knownGrams, 4);
  assert.equal(s.mass.totalGrams, null);
  assert.equal(s.steps[1].status, 'partial');
  assert.equal(s.scene.mode, 'equal_schematic');
  assert.equal(s.scene.quant, null);
  assert(s.scene.nodes.every(n => n.massFraction === null && n.weightFraction === null));
});
test('complete grams and research ratios remain separate', () => {
  const rows = [row('gancao', {grams: 3, ratio: 4}), row('renshen', {grams: 9, ratio: 1})];
  const mass = snapshot(rows, 'grams');
  const research = snapshot(rows, 'research');
  assert.equal(mass.mass.totalGrams, 12);
  assert.equal(mass.scene.nodes[0].massFraction, 0.25);
  assert.equal(mass.scene.nodes[0].weightFraction, 0.25);
  assert.equal(research.scene.nodes[0].massFraction, 0.25);
  assert.equal(research.scene.nodes[0].weightFraction, 0.8);
  assert.equal(research.scene.mode, 'research_ratio');
});
test('source unspecified never becomes a fabricated raw-process step', () => {
  const s = snapshot([row('gancao', {sourceProcessingNote: '生三兩'})]);
  assert.equal(s.workflows[0].state, 'unspecified');
  assert.equal(s.workflows[0].sourceSteps.length, 0);
  assert.equal(s.workflows[0].sourceAnnotation, '生三兩');
  assert.equal(s.scene.nodes[0].grams, null);
});
test('selected profile preserves exact labels and null parameters', () => {
  const profile = p.profiles.find(p => p.herbIds.includes('gancao') && p.workflow.length);
  assert(profile);
  const rows = [row('gancao', {processingId: profile.id})];
  const s = snapshot(rows);
  assert.deepEqual(s.workflows[0].sourceSteps.map(x => x.label), Array.from(profile.workflow, x => x.label));
  assert(s.workflows[0].sourceSteps.every(x => x.parameters.temperatureC === null && x.parameters.durationMinutes === null));
  assert(s.workflows[0].sourceSteps.every(x => x.evidenceSpan && x.sourceId));
});
test('researcher process parameters do not create source evidence or properties', () => {
  const rows = [row('gancao', {processingId: 'custom_unverified', processRecord: {
    batch: 'A1', stepsNote: '稱量後進行本批實錄工藝', temperatureC: 80, durationMinutes: 0, medium: '未核液體', equipment: '試驗設備'}})];
  const s = snapshot(rows);
  assert.equal(s.workflows[0].state, 'researcher_recorded');
  assert.equal(s.workflows[0].researcherSteps[0].parameters.durationMinutes, 0);
  assert.equal(s.workflows[0].researcherSteps[0].verified, false);
  assert.equal(s.scene.nodes[0].attributes.nature, null);
  assert.equal(s.workflows[0].sourceSteps.length, 0);
});
test('stale material result refuses weighted scene output', () => {
  const rows = [row('gancao', {grams: 3})];
  const resolved = resolve(rows, 'grams');
  const s = Flow.snapshot([row('gancao', {grams: 5})], resolved, {basis: 'grams'});
  assert.equal(s.valid, false);
  assert(s.issues.some(i => i.code === 'stale_processing_result'));
  assert.equal(s.scene.mode, 'equal_schematic');
});
test('stale processing record result refuses derived attributes', () => {
  const rows = [row('gancao')];
  const resolved = resolve(rows);
  const updated = [row('gancao', {processRecord: {...Flow.normalizeRecord(), temperatureC: 99}})];
  const s = Flow.snapshot(updated, resolved);
  assert.equal(s.scene.nodes[0].attributes, null);
  assert.equal(s.valid, false);
});
test('invalid zero mass cannot become a valid complete measure', () => {
  const s = snapshot([row('gancao', {grams: 0})], 'grams');
  assert.equal(s.valid, false);
  assert.equal(s.mass.gramsComplete, false);
  assert.equal(s.scene.nodes[0].grams, null);
});
test('nonfinite gram input remains invalid rather than silently turning unknown', () => {
  const s = snapshot([row('gancao', {grams: Infinity})], 'grams');
  assert(s.issues.some(i => i.code === 'invalid_grams'));
  assert.equal(s.valid, false);
});
test('negative process duration stays invalid', () => {
  const s = snapshot([row('gancao', {processRecord: {...Flow.normalizeRecord(), durationMinutes: -1}})]);
  assert.equal(s.valid, false);
  assert(s.issues.some(i => i.code === 'invalid_duration'));
});
test('material order does not change scene semantic weights or manufacture pair edges', () => {
  const a = [row('gancao', {ratio: 2}), row('renshen', {ratio: 1})];
  const b = a.slice().reverse();
  const sa = snapshot(a), sb = snapshot(b);
  assert.equal(sa.scene.nodes.find(x => x.id === 'gancao').weightFraction, sb.scene.nodes.find(x => x.id === 'gancao').weightFraction);
  assert(sa.scene.relationships.every(x => x.kind === 'composition'));
});
test('flow snapshot does not mutate caller records or resolved evidence', () => {
  const rows = [row('gancao')];
  const r = resolve(rows);
  const beforeRows = deep(rows), beforeResult = deep(r);
  const s = Flow.snapshot(rows, r);
  s.workflows[0].record.stepsNote = 'changed';
  assert.deepEqual(rows, beforeRows);
  assert.deepEqual(deep(r), beforeResult);
});
test('classical compatibility warning links remain traceable after process choices', () => {
  const rule = data.rules.find(rule => rule.a.some(a => rule.b.some(b => a !== b && data.herbs.some(h => h.id === a) && data.herbs.some(h => h.id === b))));
  assert(rule);
  let pair;
  for (const a of rule.a) for (const b of rule.b) if (!pair && a !== b && data.herbs.some(h => h.id === a) && data.herbs.some(h => h.id === b)) pair = [a, b];
  const s = snapshot(pair.map(id => row(id, {processingId: 'custom_unverified'})));
  const link = s.scene.relationships.find(edge => edge.kind === 'source_warning');
  assert(link);
  assert(link.references.some(ref => ref.ruleId === rule.id && ref.sourceId && ref.quote));
});
test('custom processing does not clear original toxicity warning', () => {
  const h = data.herbs.find(h => h.toxic);
  assert(h);
  const s = snapshot([row(h.id, {processingId: 'custom_unverified'})]);
  assert(s.scene.nodes[0].warnings.some(w => w.type === 'toxicity' && w.herbId === h.id));
  assert(s.scene.warnings.some(w => w.type === 'toxicity' && w.herbId === h.id));
});
console.log(JSON.stringify({passed: checks, version: Flow.version, realDataIntegration: true}));
