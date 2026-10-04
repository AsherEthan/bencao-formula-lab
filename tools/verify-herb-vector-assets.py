#!/usr/bin/env python3
"""Verify frozen inputs, source vectors, actual fitted reports, CSVs and ZIP copies."""
import collections, csv, hashlib, json, math, pathlib, re, subprocess, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
def read(path):return json.loads((ROOT/path).read_text(encoding='utf-8'))
def sha(value):return hashlib.sha256(value).hexdigest()
def stable(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def close(a,b):
 if a is None or b is None:assert a is b,(a,b)
 else:assert math.isfinite(a) and math.isfinite(b) and math.isclose(a,b,rel_tol=1e-10,abs_tol=1e-10),(a,b)
def portable(value):
 if isinstance(value,dict):
  for item in value.values():portable(item)
 elif isinstance(value,list):
  for item in value:portable(item)
 elif isinstance(value,str):assert not re.search(r'(?:/Users/|/tmp/|/private/|/home/|file://)',value)
d=read('research/herbs/herbs-and-formulas.json');c=read('research/formulas-v3/formulas.json')
r=read('dist/downloads/herb-vector-report.json');portable(r)
assert r['schemaVersion']=='herb-vector-report-1'
asset=(ROOT/'dist/herb-vector-data.js').read_text(encoding='utf-8');prefix='window.HERB_VECTOR_DATA = '
assert asset.startswith(prefix) and json.loads(asset[len(prefix):].rstrip(';\n'))==r
provenance=r['provenance']
assert provenance['formulaDataset']['sha256']==sha((ROOT/'research/formulas-v3/formulas.json').read_bytes())
fields=provenance['herbDataset']['inputFields']
assert {'id','sourceId','rawText','evidenceSpans','nature','effects','identityNote'}<=set(fields)
semantic={'fields':fields,'herbs':[{k:h.get(k) for k in fields} for h in d['herbs']]}
assert provenance['herbDataset']['semanticSha256']==sha(stable(semantic).encode())
assert provenance['dictionary']['sha256']==sha(stable(r['dictionary']).encode())
for model in [provenance['model']]+provenance['model']['dependencies']:
 assert model['sha256']==sha((ROOT/model['file']).read_bytes())
texts={}
for s in c['sources']:
 raw=(ROOT/'research/formulas-v3'/s['snapshotFile']).read_bytes();assert sha(raw)==s['snapshotSHA256'];texts[s['snapshotFile']]=raw.decode()
 assert next(x for x in provenance['sourceSnapshots'] if x['id']==s['id'])=={'id':s['id'],'sha256':sha(raw),'file':s['snapshotFile']}
herbs={h['id']:h for h in d['herbs']};elements={e['id']:e for e in c['sourceElements']};formulas={f['id']:f for f in c['formulas']}
assert len(r['herbVectors'])==len(herbs) and {v['id'] for v in r['herbVectors']}==set(herbs)
assert len(r['elements'])==len(elements) and {e['elementId'] for e in r['elements']}==set(elements)
assert provenance['herbDataset']['herbCount']==len(herbs) and provenance['formulaDataset']['formulaCount']==len(formulas)
source_span_count=0
def source_spans(value,h):
 global source_span_count
 if isinstance(value,dict):
  if value.get('basis')=='rawText' and 'start' in value:
   assert value['offsetUnit']=='unicode_code_point' and isinstance(value['start'],int) and isinstance(value['end'],int) and 0<=value['start']<value['end']<=len(h['rawText']) and h['rawText'][value['start']:value['end']]==value['text'];source_span_count+=1
  for item in value.values():source_spans(item,h)
 elif isinstance(value,list):
  for item in value:source_spans(item,h)
for v in r['herbVectors']:
 h=herbs[v['id']];assert v['rawText']==h['rawText'] and v['sourceId']==h['sourceId'] and v['evidenceSpans']==h['evidenceSpans']
 assert v['flavors']['values']==h.get('flavors',[]) and v['meridians']['values']==h.get('meridians',[]) and v['effects']['recorded']==h.get('effects',[])
 for name in ['flavors','meridians']:
  field=v[name];values=field['values'];literal=[value for value in values if any(value in e['text'] for e in field['evidence'])]
  assert field['literalLinkedValues']==literal and field['unlinkedOrNormalizedValues']==[value for value in values if value not in literal]
  assert field['linkedValueCount']==len(literal) and field['declaredValueCount']==len(values)
  if not values:assert field['status']==field['evidenceStatus']=='unknown'
  elif not field['evidence']:assert field['evidenceStatus']=='declared_unlinked'
  elif len(literal)!=len(values):assert field['evidenceStatus']=='field_spans_present_some_values_not_literal_linked'
  else:assert field['evidenceStatus']=='linked_literal_values'
 source_spans({k:value for k,value in v.items() if k!='learned'},h)
 mapped=[e['id'] for e in c['sourceElements'] if e.get('catalogHerbId')==h['id']]
 assert {e['elementId'] for e in v['learned']['mappedElements']}==set(mapped)
 for e in v['learned']['mappedElements']:
  assert elements[e['elementId']]['mappingStatus']=='exact_text'
  assert {k:value for k,value in e.items() if k not in ['sourceName','mappingStatus','modernIdentity']}==next(x for x in r['elements'] if x['elementId']==e['elementId'])
dictionary={x['id']:x for x in r['dictionary']};assert len(dictionary)==16
training=r['training'];train_ids=training['trainIds'];assert len(train_ids)==training['N'] and len(set(train_ids))==len(train_ids)
all_predictions={p['id']:p for p in r['familyValidation']['predictions']}
groups={id:p['groupId'] for id,p in all_predictions.items()}
assert len({groups[id] for id in train_ids})==training['groupCount']
bundle_by_id={b['id']:b for b in r['featureBundles']};label_by_id={t['id']:t for t in training['labels']}
occurrences={id:tuple(fid for fid in train_ids if id in formulas[fid]['sourceElementIds']) for id in elements}
for e in r['elements']:
 present=occurrences[e['elementId']];assert e['support']==len(present)
 assert e['presentGroups']==len({groups[id] for id in present}) and e['absentGroups']==len({groups[id] for id in train_ids if id not in present})
 siblings=[id for id,p in occurrences.items() if present and id!=e['elementId'] and p==present]
 assert set(e['identicalOccurrenceElements'])==set(siblings)
 if siblings or e['support']<r['parameters']['minElementSupport'] or min(e['presentGroups'],e['absentGroups'])<r['parameters']['minElementGroups']:assert not e['reportable']
 assert {t['id'] for t in e['coefficients']}==set(dictionary)
 for t in e['coefficients']:
  assert t['supported']==bool(e['reportable'] and label_by_id[t['id']]['supported'])
  if not t['supported']:assert t['coefficient'] is None and t['reason']
  else:
   assert math.isfinite(t['coefficient']) and not siblings
   b=bundle_by_id[e['bundleId']];assert b['individualIdentifiable'] and b['elementIds']==[e['elementId']]
   close(t['coefficient'],next(x['coefficient'] for x in b['coefficients'] if x['id']==t['id']))
for b in r['featureBundles']:
 assert b['individualIdentifiable']==(len(b['elementIds'])==1)
 assert all(occurrences[id]==occurrences[b['elementIds'][0]] for id in b['elementIds'])
 assert b['support']>=r['parameters']['minElementSupport'] and b['groupSupport']>=r['parameters']['minElementGroups']
def check_span(e):
 assert e['offsetUnit']=='unicode_code_point' and isinstance(e['start'],int) and isinstance(e['end'],int) and 0<=e['start']<e['end']<=len(texts[e['file']]) and texts[e['file']][e['start']:e['end']]==e['text']
target_span_count=0;decision_count=0
def recompute(predictions,baseline=False):
 stores={};sizes=collections.Counter((p['fold'],p['groupId']) for p in predictions if p['eligibleForEvaluation'])
 for p in predictions:
  if not p['eligibleForEvaluation'] or p['abstained']:continue
  for t in p['terms']:
   value=t['baselineScore' if baseline else 'modelScore'];actual=t['actual'];weight=1/sizes[p['fold'],p['groupId']]
   out=stores.setdefault(t['id'],{'tp':0.,'fp':0.,'fn':0.,'tn':0.,'scored':0,'weightScored':0.,'positiveTruth':0.,'negativeTruth':0.,'squaredError':0.})
   out['scored']+=1;out['weightScored']+=weight;out['squaredError']+=weight*(value-int(actual))**2
   out['positiveTruth' if actual else 'negativeTruth']+=weight;out['tp' if actual and value>=t['threshold'] else 'fn' if actual else 'fp' if value>=t['threshold'] else 'tn']+=weight
 tp=sum(x['tp'] for x in stores.values());fp=sum(x['fp'] for x in stores.values());fn=sum(x['fn'] for x in stores.values());w=sum(x['weightScored'] for x in stores.values())
 f1s=[2*x['tp']/(2*x['tp']+x['fp']+x['fn']) if 2*x['tp']+x['fp']+x['fn'] else 0 for x in stores.values() if x['positiveTruth'] and x['negativeTruth']]
 return {'microF1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None,'macroF1':sum(f1s)/len(f1s) if f1s else None,'brier':sum(x['squaredError'] for x in stores.values())/w if w else None,'scoredDecisions':sum(x['scored'] for x in stores.values()),'weightedDecisions':w},stores
for key,fold_count in [('familyValidation',5),('sourceBookValidation',len(c['sources']))]:
 validation=r[key];assert validation['performed'] and len(validation['folds'])==fold_count
 predictions=validation['predictions'];assert len(predictions)==len(formulas) and {p['id'] for p in predictions}==set(formulas)
 by_id={p['id']:p for p in predictions};test_ids=[]
 for fold in validation['folds']:
  train=set(fold['trainIds']);test=set(fold['testIds']);test_ids+=fold['testIds']
  assert not train&test and not fold['groupOverlap']
  assert not {groups[id] for id in train}&{groups[id] for id in test}
  if key=='sourceBookValidation':assert not {formulas[id]['sourceBook'] for id in train}&{formulas[id]['sourceBook'] for id in test}
  assert fold['trainRecords']==len(train) and fold['trainGroups']==len({groups[id] for id in train})
  for id in test:assert by_id[id]['fold']==fold['fold'] and by_id[id]['trainingRecords']==len(train) and by_id[id]['trainingGroups']==fold['trainGroups']
 assert len(test_ids)==len(set(test_ids))==len(formulas)
 for p in predictions:
  f=formulas[p['id']];assert p['groupId']==groups[p['id']] and p['sourceBook']==f['sourceBook']
  expected={k:f[k] for k in ['sourceId','sourceURL','sourceChapter','rawIndications','profileEvidence','indicationContextEvidence']};assert p['reference']==expected
  for e in expected['profileEvidence']+expected['indicationContextEvidence']:check_span(e['evidenceSpan']);target_span_count+=1
  assert not p['abstained'] or not p['terms']
  fold=next(fold for fold in validation['folds'] if fold['fold']==p['fold'])
  fold_bundles={b['id']:b for b in fold['featureBundles']}
  for t in p['terms']:
   assert t['id'] in dictionary and 0<=t['modelScore']<=1 and 0<t['baselineScore']<1
   assert t['id'] in fold['supportedTargets'] and t['support']['records']==fold['trainRecords'] and t['support']['groups']==fold['trainGroups']
   close(t['baselineScore'],next(x['prior'] for x in fold['trainingBaselines'] if x['id']==t['id']))
   assert t['predicted']==(t['modelScore']>=t['threshold'])
   assert t['actual']==(t['id'] in p['actualLabelIds']) if p['eligibleForEvaluation'] else t['actual'] is None
   close(t['logOdds'],t['intercept']+sum(x['contribution'] for x in t['contributions']))
   close(t['modelScore'],1/(1+math.exp(-max(-35,min(35,t['logOdds'])))))
   assert len({x['bundleId'] for x in t['contributions']})==len(t['contributions'])
   for contribution in t['contributions']:
    assert contribution['bundleId'] in fold_bundles and set(fold_bundles[contribution['bundleId']]['elementIds'])&set(f['sourceElementIds'])
  decision_count+=len(p['terms']) if p['eligibleForEvaluation'] else 0
 for metric_key,baseline in [('metrics',False),('baselineMetrics',True)]:
  computed,stores=recompute(predictions,baseline)
  if not computed['scoredDecisions']:assert validation[metric_key] is None
  else:
   for k,value in computed.items():close(validation[metric_key][k],value)
   assert {x['id'] for x in validation[metric_key]['perLabel']}==set(stores)
   for per_label in validation[metric_key]['perLabel']:
    for k,value in stores[per_label['id']].items():close(per_label[k],value)
def csv_rows(name):
 with (ROOT/'dist/downloads'/name).open(encoding='utf-8-sig',newline='') as file:return list(csv.reader(file))
def cell(value):return '' if value is None else str(value)
def json_cell(value):return json.dumps(value,ensure_ascii=False,separators=(',',':'))
vectors=csv_rows('herb-vectors.csv');assert len(vectors)==len(herbs)+1 and len(vectors[0])==6
for row,v in zip(vectors[1:],r['herbVectors']):
 h=herbs[v['id']];assert row==[cell(h[k]) for k in ['id','name','sourceId','reviewStatus']]+[json_cell({k:value for k,value in v.items() if k!='learned'}),json_cell(v['learned'])]
coefficients=csv_rows('element-coefficients.csv');expected=[]
for e in r['elements']:
 literal=elements[e['elementId']]
 for t in e['coefficients']:expected.append([cell(x) for x in [e['elementId'],literal['sourceName'],literal.get('catalogHerbId'),literal['mappingStatus'],e['support'],e['presentGroups'],e['absentGroups'],e['reportable'],e.get('reason'),'/'.join(e['identicalOccurrenceElements']),t['id'],t['label'],t['supported'],t.get('coefficient'),t.get('intercept'),t.get('baselineScore'),t.get('reason')]])
assert len(coefficients[0])==17 and coefficients[1:]==expected
forward=csv_rows('formula-forward-predictions.csv');expected=[]
for key in ['familyValidation','sourceBookValidation']:
 for p in r[key]['predictions']:
  for t in p['terms'] or [{}]:expected.append([cell(x) for x in [key,p['id'],p['name'],p['sourceBook'],p['groupId'],p['fold'],p['abstained'],'/'.join(p['reasons']),p['reference']['rawIndications'],'/'.join(p['actualLabelIds'] or []),t.get('id'),t.get('label'),t.get('modelScore'),t.get('baselineScore'),t.get('logOdds'),t.get('intercept'),t.get('actual'),t.get('predicted'),p['textElementCoverage'],p['catalogMappingCoverage'],p['supportedElementCoverage'],p['reference']['sourceURL']]])
assert len(forward[0])==22 and forward[1:]==expected
method=read('research/herb-vector-methodology.json');assert method==read('dist/downloads/herb-vector-methodology.json');portable(method)
assert r['methodology']=={'file':'research/herb-vector-methodology.json','sha256':sha((ROOT/'research/herb-vector-methodology.json').read_bytes())}
review_path=ROOT/'research/herb-vector-review.json'
if review_path.is_file():assert read('research/herb-vector-review.json')==read('dist/downloads/herb-vector-review.json')
manifest=read('dist/downloads/research-manifest.json');assert manifest['herbVectors']['provenance']==provenance
with zipfile.ZipFile(ROOT/'dist/downloads/tcm-research-library.zip') as z:
 for name in ['herb-vector-report.json','herb-vector-methodology.json','herb-vectors.csv','element-coefficients.csv','formula-forward-predictions.csv']:
  assert z.read('data/'+name)==(ROOT/'dist/downloads'/name).read_bytes()
 for name in ['research/herb-vector-methodology.json','dist/herb-vector-data.js','tools/build-herb-vector-report.cjs','tools/verify-herb-vector-assets.py','tools/build-research-assets.py','tools/README.txt','checks/verify-herb-vector.cjs']:
  assert z.read(name)==(ROOT/name).read_bytes()
 if review_path.is_file():
  assert z.read('research/herb-vector-review.json')==review_path.read_bytes()
  assert z.read('data/herb-vector-review.json')==(ROOT/'dist/downloads/herb-vector-review.json').read_bytes()
 assert z.read('research/formulas-v3/formulas.json')==(ROOT/'research/formulas-v3/formulas.json').read_bytes()
 for s in c['sources']:assert z.read('research/formulas-v3/'+s['snapshotFile'])==(ROOT/'research/formulas-v3'/s['snapshotFile']).read_bytes()
 archived_herbs=json.loads(z.read('research/herbs/herbs-and-formulas.json'))
 archived_semantic={'fields':fields,'herbs':[{k:h.get(k) for k in fields} for h in archived_herbs['herbs']]}
 assert archived_semantic==semantic
 for name in ['herb-vector-model.js','inference-model.js','quant-model.js']:
  assert z.read('model/'+name)==z.read('dist/'+name)==(ROOT/'dist'/name).read_bytes()
 for entry in z.namelist():
  if entry.endswith('.json'):portable(json.loads(z.read(entry)))
# This independently reruns every fit. It does not trust a saved score or modify output.
result=subprocess.run(['node',str(ROOT/'tools/build-herb-vector-report.cjs'),'--verify'],cwd=ROOT,check=True,capture_output=True,text=True)
assert json.loads(result.stdout)['actualRefitMatchesSavedReport']
print(json.dumps({'sourceHerbs':len(herbs),'literalElements':len(elements),'individualReportableElements':sum(e['reportable'] for e in r['elements']),'sourceVectorSpanReferences':source_span_count,'independentTargetSpanReferences':target_span_count,'familyOOFPredictions':len(r['familyValidation']['predictions']),'sourceBookOOFPredictions':len(r['sourceBookValidation']['predictions']),'coefficientCSVRows':len(coefficients)-1,'forwardCSVRows':len(forward)-1,'scoredOOFDecisions':decision_count,'actualRefitMatchesSavedReport':True,'publicCanonicalCSVZIPConsistency':True},ensure_ascii=False))
