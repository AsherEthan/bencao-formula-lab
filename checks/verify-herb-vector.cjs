'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../dist/model.js');require('../dist/quant-model.js');require('../dist/inference-model.js');require('../dist/herb-vector-model.js');
const M=globalThis.HerbVectorModel,Q=globalThis.QuantModel,cp=x=>[...x].length,copy=x=>JSON.parse(JSON.stringify(x)),close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
let checked=0;function check(name,fn){fn();checked++;console.log('PASS '+name)}
function herb(id,nature='溫',effects=['補氣']){const rawText='🧪'+nature+'；'+effects.join('；'),at=rawText.indexOf(nature);return {id,name:id,sourceId:'book-a',rawText,nature,effects,flavors:['甘'],meridians:[],reviewStatus:'fixture',evidenceSpans:[{field:'nature',text:nature,start:cp(rawText.slice(0,at)),end:cp(rawText.slice(0,at+nature.length)),basis:'rawText',offsetUnit:'unicode_code_point'},...effects.map(t=>{const at=rawText.indexOf(t);return {field:'effects',text:t,start:cp(rawText.slice(0,at)),end:cp(rawText.slice(0,at+t.length)),basis:'rawText',offsetUnit:'unicode_code_point'}})]}}
function corpus(specs){
  const sourceTexts={},sourceElements=new Map(),sources=new Map();
  const span=(sourceId,text,field)=>{const file='snapshots/'+sourceId+'.txt',before=sourceTexts[file]||'',start=cp(before);sourceTexts[file]=before+text+'\n';return {text,start,end:start+cp(text),file,field,basis:'sourcePlainText',offsetUnit:'unicode_code_point'}};
  const formulas=specs.map((s,i)=>{
    const sourceId=s.sourceId||'book-'+(i%3),name=s.name||'測試方'+i,text=s.text||((s.positive?'發熱':'腹痛')+'者，'+name+'主之。');sources.set(sourceId,{id:sourceId,title:sourceId,url:'https://example.invalid/'+sourceId});
    const evidence=span(sourceId,text,'indication'),ingredientRefs=s.names.map(sourceName=>{
      const id='element-'+sourceName,catalogHerbId=sourceName==='甲'?'甲':null;sourceElements.set(id,{id,name:sourceName,sourceName,catalogHerbId,mappingStatus:catalogHerbId?'exact_text':'unresolved'});
      const evidenceSpan=span(sourceId,sourceName+'（三兩，炙）','ingredient'),nameSpan={...evidenceSpan,text:sourceName,end:evidenceSpan.start+cp(sourceName)};
      return {sourceName,sourceElementId:id,catalogHerbId,id:catalogHerbId,scope:'core',preparation:'炙',annotationText:'三兩，炙',rawUnits:['三兩'],evidenceSpan,nameSpan};
    });
    return {id:s.id||'f-'+i,name,sourceId,sourceBook:sourceId,sourceURL:'https://example.invalid/'+sourceId+'/'+i,familyId:s.familyId||'family-'+i,ingredientRefs,declaredIngredientCount:s.names.length,ingredientParsingComplete:s.complete!==false,unparsedIngredientFragments:s.fragments||[],rawIndications:text,profileEvidence:[{text,sourceId,assertionKind:'indication',extractionMethod:'explicit_named_target_clause',evidenceSpan:evidence}]};
  });return {sources:[...sources.values()],sourceElements:[...sourceElements.values()],sourceTexts,formulas};
}
const specs=Array.from({length:72},(_,i)=>({names:[i%4<2?'甲':'丙',i%3===0?'乙':'丁','常','唯'+i],positive:i%4<2})),c=corpus(specs),data={sources:[{id:'book-a'}],herbs:[herb('甲'),herb('unmapped','未錄',[])]},m=M.fit(data,c);
check('ridge learns signed coefficients jointly and reduces a regularized training objective',()=>{
  assert.equal(m.training.ready,true);const a=m.training.elementStats.find(e=>e.elementId==='element-甲');
  assert.equal(a.reportable,true);assert.ok(a.coefficients.find(l=>l.id==='heat').coefficient>0);assert.ok(a.coefficients.find(l=>l.id==='pain').coefficient<0);
  assert.ok(m.training.optimizer.trainingPenalizedLoss<m.training.optimizer.baselineLogLoss);assert.equal(m.training.optimizer.converged,true);
  assert.equal(m.training.elementStats.find(e=>e.elementId==='element-常').reportable,false);
});
check('source vectors preserve unknowns, conditional processing and evidence status separately from learned targets',()=>{
  const v=M.sourceVector(herb('conditional','生平／炙溫')),unknown=M.sourceVector(herb('unknown','未錄',[]));
  assert.deepEqual(v.thermal.range,[0,1]);assert.equal(v.thermal.status,'conditional');assert.equal(unknown.thermal.range,null);
  assert.ok(unknown.unknownFields.includes('nature'));assert.equal(unknown.effects.status,'unknown');
  assert.equal(v.effects.axes.length,8);assert.equal(M.dictionary.length,16);assert.equal(v.flavors.evidenceStatus,'declared_unlinked');
  assert.equal(M.herbProfile(m,'unmapped').learned.mappedElements.length,0);assert.equal(m.herbVectors.length,data.herbs.length);
  const unlinked=herb('unlinked');unlinked.evidenceSpans=[];assert.equal(M.sourceVector(unlinked).thermal.evidenceStatus,'declared_label_without_linked_nature_span');
  const partial=herb('partial');partial.rawText+='；甘';partial.flavors=['甘','淡'];partial.evidenceSpans.push({field:'flavors',text:'甘',start:cp(partial.rawText)-1,end:cp(partial.rawText),basis:'rawText',offsetUnit:'unicode_code_point'});
  const f=M.sourceVector(partial).flavors;assert.equal(f.status,'partly_linked_literal_values');assert.deepEqual(f.literalLinkedValues,['甘']);assert.deepEqual(f.unlinkedOrNormalizedValues,['淡']);
});
check('source input is only original element presence; grams, ratios, process, supplied names and labels have no input effect',()=>{
  const rows=[{sourceElementId:'element-甲',grams:1,ratio:1,processingId:'source_unspecified',name:'發熱湯',labels:['heat']},{sourceElementId:'element-丁'}];
  const a=M.predict(m,rows),b=M.predict(m,rows.map(r=>({...r,grams:999,ratio:20,processingId:'custom_unverified',processRecord:{temperatureC:200},name:'清熱方',labels:['pain']})));
  assert.deepEqual(a.terms,b.terms);assert.deepEqual(a.processingEvidence.features,[]);assert.match(a.queryFeatureScope,/炮製參數未入/);
  const changed=copy(c);for(const f of changed.formulas){f.name='改名'+f.id;f.rawIngredientText='發熱補氣（99克）';for(const e of f.profileEvidence)e.extractionMethod='separate_heading';for(const r of f.ingredientRefs){r.preparation='蒸';r.annotationText='';r.rawUnits=['999克']}}
  // The original indication span remains unchanged, so lexical labels are stable despite other supplied fields.
  const refit=M.fit(data,changed);assert.deepEqual(refit.training.labels,m.training.labels);assert.deepEqual(refit.training.elementStats,m.training.elementStats);
});
check('a forward prediction is sigmoid of one intercept plus the learned contributions',()=>{
  const p=M.predict(m,[{sourceElementId:'element-甲'},{sourceElementId:'element-丁'}]);assert.equal(p.abstained,false);
  for(const t of p.terms){close(t.logOdds,t.intercept+t.contributions.reduce((s,x)=>s+x.contribution,0));close(t.modelScore,1/(1+Math.exp(-t.logOdds)));assert.equal(t.associationScore,t.modelScore)}
});
check('query family removal refits vocabulary, support, coefficients and nearest examples without self leakage',()=>{
  const p=M.predict(m,{formulaId:'f-0'});assert.ok(p.trainingSubset.excludedFormulaIds.includes('f-0'));assert.ok(!p.trainingSubset.trainIds.includes('f-0'));
  assert.ok(p.nearestCases.every(r=>!p.trainingSubset.excludedFormulaIds.includes(r.id)));assert.equal(p.trainingSubset.records,71);
  const staged=M.predict(m,[{id:'甲'},{sourceElementId:'element-乙'}],{excludeFormulaId:'f-0'});assert.deepEqual(staged.trainingSubset.excludedFormulaIds,p.trainingSubset.excludedFormulaIds);
  assert.throws(()=>M.predict(m,['element-甲'],{excludeFormulaId:'absent'}));
});
check('perfectly co-occurring elements have bundle coefficients but their single-element scores stay null',()=>{
  const bundleCorpus=corpus(specs.map((s,i)=>({...s,names:[...s.names,...(i%4<2?['同甲']:[])]}))),model=M.fit(data,bundleCorpus),a=model.training.elementStats.find(e=>e.elementId==='element-甲');
  assert.equal(a.reportable,false);assert.ok(a.identicalOccurrenceElements.includes('element-同甲'));assert.ok(a.coefficients.every(c=>c.coefficient===null));
  const bundle=model.training.featureBundles.find(b=>b.elementIds.includes('element-甲'));assert.equal(bundle.individualIdentifiable,false);assert.ok(bundle.coefficients.length>0);
  assert.equal(M.predict(model,['element-甲','element-丁']).abstained,true);
  const whole=M.predict(model,['element-甲','element-同甲','element-丁']);assert.equal(whole.abstained,false);
  assert.equal(whole.terms.find(t=>t.id==='heat').contributions.filter(x=>x.elementIds.includes('element-甲')).length,1);
});
check('rare elements and single-family repeats do not acquire reportable single-herb coefficients',()=>{
  const cases=specs.map((s,i)=>({...s,names:[...s.names,...(i<3?['罕']:[])],familyId:i<3?'one-family':'family-'+i})),model=M.fit(data,corpus(cases)),r=model.training.elementStats.find(e=>e.elementId==='element-罕');
  assert.equal(r.support,3);assert.equal(r.presentGroups,1);assert.equal(r.reportable,false);assert.ok(r.coefficients.every(x=>x.coefficient===null));
  const sparse=M.predict(model,['element-罕','未見']);assert.equal(sparse.abstained,true);assert.equal(sparse.unknownElements.length,1);assert.equal(sparse.textElementCoverage,.5);
});
check('query-group removal can make a previously supported element unknown',()=>{
  const cases=specs.map((s,i)=>({...s,names:[...s.names,...(i<3?['邊']:[])]})),model=M.fit(data,corpus(cases));
  assert.equal(model.training.elementStats.find(e=>e.elementId==='element-邊').reportable,true);
  const q=M.predict(model,{formulaId:'f-0'});assert.ok(q.unsupportedElements.some(e=>e.elementId==='element-邊'));
  assert.equal(M.herbProfile(model,'甲',{excludeFormulaId:'f-0'}).learned.trainingSubset.records,71);
});
check('unsupported target dimensions stay null instead of acquiring fabricated 16-dimensional efficacy',()=>{
  const a=m.training.elementStats.find(e=>e.elementId==='element-甲');assert.equal(m.training.labels.filter(l=>l.supported).length,2);
  assert.equal(a.coefficients.length,16);assert.ok(a.coefficients.filter(c=>!c.supported).every(c=>c.coefficient===null));
  assert.equal(M.predict(m,[]).abstained,true);assert.equal(M.predict(m,[]).terms.length,0);assert.throws(()=>M.validate(m,{folds:1}));assert.throws(()=>M.validate(m,{mode:'random'}));
});
const v=M.validate(m),book=M.validate(m,{mode:'sourceBook'});
check('each held-out fold refits its coefficient and vocabulary using training groups only',()=>{
  assert.equal(v.performed,true);assert.equal(v.folds.length,5);assert.equal(v.predictions.length,72);
  for(const f of v.folds){assert.deepEqual(f.groupOverlap,[]);assert.ok(!f.trainIds.some(id=>f.testIds.includes(id)));assert.ok(f.optimizer.trainingPenalizedLoss<f.optimizer.baselineLogLoss);assert.ok(f.optimizer.converged)}
  assert.equal(m.validation,null);assert.ok(v.predictions.every(p=>p.terms.every(t=>typeof t.actual==='boolean')));
});
check('baseline and Brier are independently recoverable from training-group frequencies and matching test decisions',()=>{
  let err=0,weight=0;
  for(const f of v.folds){
    const train=m.records.filter(r=>f.trainIds.includes(r.id)),groupSizes=new Map();for(const r of train)groupSizes.set(r.groupId,(groupSizes.get(r.groupId)||0)+1);
    const G=groupSizes.size;
    const preds=v.predictions.filter(p=>p.fold===f.fold&&p.eligibleForEvaluation&&!p.abstained),testSizes=new Map();for(const r of m.records.filter(r=>f.testIds.includes(r.id)&&r.eligible))testSizes.set(r.groupId,(testSizes.get(r.groupId)||0)+1);
    for(const p of preds)for(const t of p.terms){const weightedPos=train.reduce((s,r)=>s+(r.silver.labelIds.includes(t.id)?1/groupSizes.get(r.groupId):0),0),prior=(weightedPos+1)/(G+2);close(t.baselineScore,prior);const w=1/testSizes.get(p.groupId);err+=w*(prior-Number(t.actual))**2;weight+=w}
  }
  close(v.baselineMetrics.brier,err/weight);assert.equal(v.metrics.scoredDecisions,v.baselineMetrics.scoredDecisions);
});
check('source-book holdout removes cross-book relatives and can still emit an unscored source record',()=>{
  const cases=copy(specs);cases[0].familyId='cross';cases[1].familyId='cross';cases[2].complete=false;cases[2].fragments=['未知'];
  const model=M.fit(data,corpus(cases)),b=M.validate(model,{mode:'sourceBook'}),fold=b.folds.find(f=>f.testIds.includes('f-0'));
  assert.ok(!fold.trainIds.includes('f-1'));assert.deepEqual(fold.groupOverlap,[]);
  assert.equal(b.predictions.length,72);assert.equal(b.predictions.find(p=>p.id==='f-2').eligibleForEvaluation,false);
  assert.ok(b.predictions.find(p=>p.id==='f-2').terms.every(t=>t.actual===null));assert.equal(book.folds.length,3);
});
check('group balancing gives every family one total training weight rather than allowing variants to multiply evidence',()=>{
  const cases=specs.map((s,i)=>({...s,familyId:i<12?'one-family':'family-'+i})),model=M.fit(data,corpus(cases));
  const train=model.records.filter(r=>r.eligible),sizes=new Map();for(const r of train)sizes.set(r.groupId,(sizes.get(r.groupId)||0)+1);
  const label=model.training.labels.find(l=>l.id==='heat');let oracle=0;for(const r of train)if(r.silver.labelIds.includes('heat'))oracle+=1/sizes.get(r.groupId);
  close(label.weightedPositive,oracle);close(label.prior,(oracle+1)/(sizes.size+2));
});
check('training and prediction remain deterministic and do not mutate source observations',()=>{
  const before=copy(c),repeat=M.fit(data,c);assert.deepEqual(repeat.training,m.training);assert.deepEqual(c,before);
  assert.deepEqual(M.predict(repeat,['element-甲','element-丁']).terms,M.predict(m,['element-甲','element-丁']).terms);
});
const dir=path.resolve(__dirname,'..'),herbsFile=path.join(dir,'research/herbs/herbs-and-formulas.json'),formulaFile=path.join(dir,'research/formulas-v3/formulas.json');
if(fs.existsSync(herbsFile)&&fs.existsSync(formulaFile)){
  const d=JSON.parse(fs.readFileSync(herbsFile,'utf8')),actual=JSON.parse(fs.readFileSync(formulaFile,'utf8')),model=M.fit(d,actual),out=M.validate(model),sources=M.validate(model,{mode:'sourceBook'});
  check('real collection yields 340 source vectors, 396 original element rows and every source formula OOF record',()=>{
    assert.equal(model.herbVectors.length,340);assert.equal(model.training.elementStats.length,396);assert.equal(out.predictions.length,284);assert.equal(sources.predictions.length,284);
    assert.equal(model.training.labels.filter(l=>l.supported).length,13);assert.equal(model.herbVectors.filter(h=>!h.learned.mappedElements.length).length,201);
    assert.ok(model.training.elementStats.every(e=>e.coefficients.length===16));assert.ok(model.training.optimizer.converged);
  });
  check('real folds keep proxy groups separate and report support coverage alongside baseline performance',()=>{
    assert.ok([...out.folds,...sources.folds].every(f=>!f.groupOverlap.length&&!f.trainIds.some(id=>f.testIds.includes(id))&&f.optimizer.converged));
    assert.equal(out.metrics.scoredDecisions,out.baselineMetrics.scoredDecisions);assert.ok(out.coverage.labelDecisionCoverage<1);assert.ok(out.coverage.queryCoverage<1);
    assert.equal(out.metrics.microF1,0);assert.equal(out.baselineMetrics.microF1,0);
    assert.ok(out.metrics.brier>=0&&out.metrics.brier<=1);assert.ok(out.baselineMetrics.brier>=0&&out.baselineMetrics.brier<=1);
  });
  check('staged four-of-five 桂枝 core catalog subset excludes the original entire family',()=>{
    const f=actual.formulas.find(f=>f.name==='桂枝湯'),p=M.predict(model,f.ingredientRefs.filter(r=>r.catalogHerbId).map(r=>({id:r.catalogHerbId})),{excludeFormulaId:f.id}),r=model.records.find(r=>r.id===f.id);
    assert.ok(p.trainingSubset.excludedFormulaIds.includes(f.id));assert.ok(p.trainingSubset.excludedGroupIds.includes(r.groupId));
    assert.ok(model.records.filter(x=>x.groupId===r.groupId).every(x=>p.trainingSubset.excludedFormulaIds.includes(x.id)));
    assert.ok(p.nearestCases.every(x=>x.groupId!==r.groupId));
  });
}
console.log(`${checked} herb-vector model checks passed`);
