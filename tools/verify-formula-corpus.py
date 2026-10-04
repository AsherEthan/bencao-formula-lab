#!/usr/bin/env python3
"""Verify sealed formula source offsets, public assets and computed split integrity."""
import json,pathlib,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
base=ROOT/'research/formulas-v3'
c=json.loads((base/'formulas.json').read_text());texts={}
for s in c['sources']:
 p=base/s['snapshotFile'];t=p.read_text();assert hashlib.sha256(t.encode()).hexdigest()==s['snapshotSHA256'];texts[s['snapshotFile']]=t
n=0
def span(e):
 global n
 assert e['offsetUnit']=='unicode_code_point'
 assert texts[e['file']][e['start']:e['end']]==e['text'];n+=1
ids=set()
for f in c['formulas']:
 assert f['id'] not in ids;ids.add(f['id'])
 for k in ['nameSpan','recordSpan','ingredientTextSpan']:span(f[k])
 assert f['ingredientTextSpan']['text']==f['rawIngredientText']
 assert '\n'.join(e['text'] for e in f['profileEvidence'])==f['rawIndications']
 for e in f['profileEvidence']:span(e['evidenceSpan'])
 for e in f.get('indicationContextEvidence',[]):span(e['evidenceSpan'])
 refs=f['ingredientRefs'];assert len(refs)==f['parsedIngredientCount']
 assert len({r['sourceElementId'] for r in refs})==len(refs)
 for r in refs:
  span(r['evidenceSpan']);span(r['nameSpan']);assert r['nameSpan']['text']==r['sourceName']
 assert set(f['sourceElementIds'])=={r['sourceElementId'] for r in refs}
assert n==c['qaReport']['validatedSourceSpanCount']
public=json.loads((ROOT/'dist/downloads/formula-corpus.json').read_text());assert c==public
asset=(ROOT/'dist/formula-corpus.js').read_text();assert json.loads(asset[len('window.FORMULA_CORPUS = '):].rstrip(';\n'))==public
r=json.loads((ROOT/'dist/downloads/inference-validation.json').read_text())
assert r['dataset']['sha256']==hashlib.sha256((base/'formulas.json').read_bytes()).hexdigest()
assert r['dataset']['formulaCount']==len(c['formulas'])
for key in ['familyValidation','sourceBookValidation']:
 v=r[key];assert v['performed']
 for fold in v['folds']:
  assert not set(fold['trainIds'])&set(fold['testIds'])
  assert not fold['groupOverlap']
 assert v['coverage']['testRecords']<=len(c['formulas'])
print(json.dumps({'formulas':len(c['formulas']),'sourceElements':len(c['sourceElements']),'verifiedSpans':n,'sourceSnapshots':len(texts),'computedSplitReports':2},ensure_ascii=False))
