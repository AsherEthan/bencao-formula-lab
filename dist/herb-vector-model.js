'use strict';
(function(root){
  const version='herb-vector-ridge-logistic-1.0';
  const defaults={ridge:.03,iterations:1600,tolerance:1e-6,minTrainRecords:30,minTrainGroups:8,minElementSupport:3,minElementGroups:3,minLabelPositive:5,minLabelNegative:5,minLabelGroups:3,minQueryTextCoverage:.8,minQuerySupportedCoverage:.5,threshold:.5,folds:5};
  const limitations=[
    '來源向量是典籍記錄與序位編碼；學習向量是其他共方元素同時入模後的銀詞條件係數，兩者均非實測固有藥性。',
    '學習輸入僅原名成分 presence；方名、主治、來源书、原方量、克數和炮製參數不進入預測輸入。',
    '完全同現材料合為一束；單味係數不予展示。未見完全同現也不能識別單味因果藥效，ridge 只是固定估計約定。',
    '少於三個出現或缺席防洩漏組的元素不學單味係數；未知與未支持元素保持未知，不當作無藥效。',
    '來源主治的固定詞規則為銀標籤；未命中不是臨床陰性，模型分數不是服用概率或個人藥效。',
    '模型忽略交互作用、原方量、工藝與暴露；不能由二值元素模型恢復真實煎服藥性、安全或療效。',
    '三書的固定次序樣本與代理方族仍有選樣、作者及歷史依賴；分組留出與來源書留出只檢查銀詞外推。'
  ];
  const clone=x=>JSON.parse(JSON.stringify(x)),unique=a=>[...new Set(a)],normal=s=>String(s||'').normalize('NFC').replace(/\s+/g,'');
  const caches=new WeakMap();
  function hash(s){let h=2166136261;for(const c of String(s)){h^=c.codePointAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,'0')}
  const sigmoid=x=>1/(1+Math.exp(-Math.max(-35,Math.min(35,x))));
  function linked(h,e,chars){return !!e&&e.basis==='rawText'&&e.offsetUnit==='unicode_code_point'&&Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=0&&e.end>e.start&&typeof e.text==='string'&&(chars||[...String(h.rawText||'')]).slice(e.start,e.end).join('')===e.text}
  function sourceVector(h){
    const chars=[...String(h.rawText||'')],thermal=root.QuantModel.thermal(h),axes=root.QuantModel.lexical(h),valid=(h.evidenceSpans||[]).filter(e=>linked(h,e,chars));
    const field=(name,values)=>{
      const recorded=values||[],evidence=valid.filter(e=>e.field===name),literalLinkedValues=recorded.filter(v=>evidence.some(e=>e.text.includes(v))),unlinkedOrNormalizedValues=recorded.filter(v=>!literalLinkedValues.includes(v));
      const status=!recorded.length?'unknown':literalLinkedValues.length===recorded.length?'linked_literal_values':literalLinkedValues.length?'partly_linked_literal_values':'declared_or_normalized_labels';
      const evidenceStatus=!recorded.length?'unknown':!evidence.length?'declared_unlinked':!unlinkedOrNormalizedValues.length?'linked_literal_values':'field_spans_present_some_values_not_literal_linked';
      return {values:clone(recorded),status,evidenceStatus,literalLinkedValues:clone(literalLinkedValues),unlinkedOrNormalizedValues:clone(unlinkedOrNormalizedValues),linkedValueCount:literalLinkedValues.length,declaredValueCount:recorded.length,evidence:clone(evidence),note:'逐值只核原詞字面包含；異字標準化或編輯歸併保留為宣告／標準化值，不編造原文位置'};
    };
    return {id:h.id,name:h.name,sourceId:h.sourceId,reviewStatus:h.reviewStatus||'未錄',thermal,
      flavors:field('flavors',h.flavors),meridians:field('meridians',h.meridians),
      effects:{recorded:clone(h.effects||[]),status:h.effects?.length?'recorded_source_labels':'unknown',evidenceStatus:!h.effects?.length?'unknown':valid.some(e=>e.field==='effects')?'has_linked_source_spans':'declared_labels_without_linked_field_span',axes,evidence:clone(valid.filter(e=>e.field==='effects'))},
      unknownFields:[...(!thermal.range?['nature']:[]),...(!h.flavors?.length?['flavors']:[]),...(!h.meridians?.length?['meridians']:[]),...(!h.effects?.length?['effects']:[])],
      identityNote:h.identityNote||'',rawText:h.rawText||'',evidenceSpans:clone(h.evidenceSpans||[]),
      scope:'單一目錄來源條目的文獻向量；混合炮製性味保留條件範圍，不視為某一指定飲片'};
  }
  function learn(records,elements){
    const rows=records.filter(r=>r.eligible),N=rows.length,groups=unique(rows.map(r=>r.groupId)),G=groups.length;
    const groupSizes=new Map();for(const r of rows)groupSizes.set(r.groupId,(groupSizes.get(r.groupId)||0)+1);
    const weights=rows.map(r=>1/groupSizes.get(r.groupId)),sets=rows.map(r=>new Set(r.composition.elementIds));
    const reasons=[];if(N<defaults.minTrainRecords)reasons.push('訓練記錄不足 '+defaults.minTrainRecords);if(G<defaults.minTrainGroups)reasons.push('獨立代理分組不足 '+defaults.minTrainGroups);
    const ids=unique([...elements.map(e=>e.id),...rows.flatMap(r=>r.composition.elementIds)]).sort();
    const stats=ids.map(elementId=>{
      const indexes=[];for(let i=0;i<N;i++)if(sets[i].has(elementId))indexes.push(i);
      const presentGroups=unique(indexes.map(i=>rows[i].groupId)).length,absentGroups=unique(rows.filter((r,i)=>!sets[i].has(elementId)).map(r=>r.groupId)).length;
      const support=indexes.length,eligible=support>=defaults.minElementSupport&&N-support>=defaults.minElementSupport&&presentGroups>=defaults.minElementGroups&&absentGroups>=defaults.minElementGroups;
      return {elementId,indexes,support,presentGroups,absentGroups,eligible,pattern:indexes.join(',')};
    });
    const patterns=new Map();for(const s of stats)if(s.support){if(!patterns.has(s.pattern))patterns.set(s.pattern,[]);patterns.get(s.pattern).push(s.elementId)}
    const bundleMap=new Map();for(const s of stats)if(s.eligible){if(!bundleMap.has(s.pattern))bundleMap.set(s.pattern,{id:'bundle-'+hash(s.pattern),elementIds:[],support:s.support,groupSupport:s.presentGroups,absentGroups:s.absentGroups,indexes:s.indexes});bundleMap.get(s.pattern).elementIds.push(s.elementId)}
    const bundles=[...bundleMap.values()].sort((a,b)=>a.elementIds[0].localeCompare(b.elementIds[0]));
    for(const b of bundles)b.individualIdentifiable=b.elementIds.length===1;
    const bundleByElement=new Map();bundles.forEach((b,j)=>b.elementIds.forEach(id=>bundleByElement.set(id,j)));
    const X=rows.map(r=>unique(r.composition.elementIds.map(id=>bundleByElement.get(id)).filter(j=>j!==undefined)).sort((a,b)=>a-b));
    const dictionary=root.InferenceModel.dictionary;
    const labels=dictionary.map(d=>{
      const positive=rows.filter(r=>r.silver.labelIds.includes(d.id)),negative=rows.filter(r=>!r.silver.labelIds.includes(d.id));
      const nPositive=positive.length,nNegative=negative.length,positiveGroups=unique(positive.map(r=>r.groupId)).length,negativeGroups=unique(negative.map(r=>r.groupId)).length;
      const weightedPositive=rows.reduce((s,r,i)=>s+(r.silver.labelIds.includes(d.id)?weights[i]:0),0),prior=(weightedPositive+1)/(G+2);
      const supported=!reasons.length&&bundles.length>0&&nPositive>=defaults.minLabelPositive&&nNegative>=defaults.minLabelNegative&&positiveGroups>=defaults.minLabelGroups&&negativeGroups>=defaults.minLabelGroups;
      return {id:d.id,label:d.label,supported,nPositive,nNegative,positiveGroups,negativeGroups,weightedPositive,weightedNegative:G-weightedPositive,prior,intercept:Math.log(prior/(1-prior)),coefficients:[],unsupportedReason:supported?null:'訓練或此银詞的記錄與分組支持不足'};
    });
    const active=labels.filter(l=>l.supported),F=bundles.length,L=active.length;
    const betas=active.map(()=>new Float64Array(F)),intercepts=active.map(l=>l.intercept);
    const ys=rows.map(r=>active.map(l=>Number(r.silver.labelIds.includes(l.id))));
    const meanActive=G?X.reduce((s,x,i)=>s+weights[i]*x.length,0)/G:0;
    const step=1/(.25*(1+meanActive)+defaults.ridge);
    let iterations=0,maxGradient=null;
    for(let it=0;it<defaults.iterations&&L;it++){
      const gradient=active.map(()=>new Float64Array(F)),interceptGradient=new Float64Array(L);
      for(let i=0;i<N;i++)for(let k=0;k<L;k++){
        let z=intercepts[k];for(const j of X[i])z+=betas[k][j];
        const err=(sigmoid(z)-ys[i][k])*weights[i]/G;interceptGradient[k]+=err;for(const j of X[i])gradient[k][j]+=err;
      }
      maxGradient=0;
      for(let k=0;k<L;k++){
        maxGradient=Math.max(maxGradient,Math.abs(interceptGradient[k]));intercepts[k]-=step*interceptGradient[k];
        for(let j=0;j<F;j++){const g=gradient[k][j]+defaults.ridge*betas[k][j];maxGradient=Math.max(maxGradient,Math.abs(g));betas[k][j]-=step*g}
      }
      iterations=it+1;if(maxGradient<=defaults.tolerance)break;
    }
    for(let k=0;k<L;k++){active[k].intercept=intercepts[k];active[k].coefficients=bundles.map((b,j)=>({bundleId:b.id,coefficient:betas[k][j]}))}
    const loss=(baseline=false)=>{
      if(!L||!G)return null;let value=0;
      for(let i=0;i<N;i++)for(let k=0;k<L;k++){
        let z=baseline?Math.log(active[k].prior/(1-active[k].prior)):intercepts[k];if(!baseline)for(const j of X[i])z+=betas[k][j];
        const p=sigmoid(z);value-=weights[i]/G*(ys[i][k]*Math.log(p)+(1-ys[i][k])*Math.log(1-p));
      }
      if(!baseline)for(const b of betas)for(const x of b)value+=defaults.ridge*x*x/2;
      return value/L;
    };
    const featureBundles=bundles.map(b=>({id:b.id,elementIds:b.elementIds,support:b.support,groupSupport:b.groupSupport,absentGroups:b.absentGroups,individualIdentifiable:b.individualIdentifiable,coefficients:active.map(l=>({id:l.id,coefficient:l.coefficients.find(x=>x.bundleId===b.id).coefficient}))}));
    const elementStats=stats.map(s=>{
      const siblings=(patterns.get(s.pattern)||[]).filter(id=>id!==s.elementId),bundle=bundleByElement.has(s.elementId)?featureBundles[bundleByElement.get(s.elementId)]:null;
      const reportable=!!bundle&&s.eligible&&!siblings.length;
      const reason=!s.eligible?'出現或缺席記錄／獨立分組不足；單味係數未知':siblings.length?'與其他原名完全同現；不能區分單味係數':'沒有完全同現欄位；係數仍是固定ridge條件估計，非因果藥性';
      return {elementId:s.elementId,support:s.support,presentGroups:s.presentGroups,absentGroups:s.absentGroups,reportable,reason,identicalOccurrenceElements:siblings,bundleId:bundle?.id||null,
        coefficients:labels.map(l=>({id:l.id,label:l.label,supported:reportable&&l.supported,coefficient:reportable&&l.supported?l.coefficients.find(x=>x.bundleId===bundle.id).coefficient:null,intercept:l.supported?l.intercept:null,baselineScore:l.prior,reason:!reportable?reason:l.unsupportedReason}))};
    });
    const ready=!reasons.length&&active.length>0;if(!ready&&!reasons.length)reasons.push('没有支持足够的可学习银詞目标或元素');
    return {N,groupCount:G,ready,reasons,trainIds:rows.map(r=>r.id),labels,featureBundles,elementStats,
      weighting:'每個防洩漏組總權重1，組內每條1/組條數；loss按組數平均',optimizer:{algorithm:'deterministic sparse full-batch gradient descent',ridge:defaults.ridge,maxIterations:defaults.iterations,iterations,tolerance:defaults.tolerance,maxGradient,converged:maxGradient!==null&&maxGradient<=defaults.tolerance,step,trainingPenalizedLoss:loss(),baselineLogLoss:loss(true)}};
  }
  function subset(model,q,options={}){
    const excluded=new Set(),formulaId=options.excludeFormulaId||q?.formulaId;
    if(formulaId){const r=model.records.find(r=>r.id===formulaId);if(!r)throw new Error('要排除的原方未收錄');excluded.add(r.groupId)}
    if(q?.complete&&q.elementIds.length){const key=q.elementIds.slice().sort().join('|');for(const r of model.records)if(r.compositionKey===key)excluded.add(r.groupId)}
    const keys=[...excluded].sort(),records=model.records.filter(r=>!excluded.has(r.groupId)),cache=caches.get(model)||new Map();caches.set(model,cache);
    const key=keys.join('|');if(!cache.has(key))cache.set(key,keys.length?learn(records,model.elements):model.training);
    return {records,training:cache.get(key),excludedGroupIds:keys,excludedFormulaIds:model.records.filter(r=>excluded.has(r.groupId)).map(r=>r.id)};
  }
  function learnedFor(model,herbId,training){
    const mapped=model.elements.filter(e=>e.catalogHerbId===herbId);
    return {mappedElements:mapped.map(e=>({...clone(training.elementStats.find(x=>x.elementId===e.id)),elementId:e.id,sourceName:e.sourceName||e.name,mappingStatus:e.mappingStatus,modernIdentity:e.modernIdentity||'未核定'})),
      status:mapped.length?'按來源原名逐一展示；不合併不同古名的條件係數':'沒有唯一目錄映射的來源原名；學習係數未知',optimizer:clone(training.optimizer)};
  }
  function fit(data,corpus){
    const prepared=root.InferenceModel.prepare(data,corpus),training=learn(prepared.records,prepared.elements);
    const sourceVectors=(data.herbs||[]).map(sourceVector),model={...prepared,version,dictionaryVersion:root.InferenceModel.dictionaryVersion,dictionary:clone(root.InferenceModel.dictionary),config:clone(defaults),catalog:(data.herbs||[]).map(h=>({id:h.id,name:h.name})),training,sourceVectors,herbVectors:[],validation:null,
      fingerprint:hash(prepared.records.map(r=>[r.id,r.groupId,r.eligible,r.composition.elementIds.join(','),r.silver.labelIds.join(',')].join('|')).join('\n')),
      frozenParameters:true,inputPolicy:'仅核心原名成分二值presence。方名／主治／來源書／原方量／克數／炮製參數不作輸入',limitations:clone(limitations)};
    model.herbVectors=sourceVectors.map(v=>({...clone(v),learned:learnedFor(model,v.id,training)}));
    caches.set(model,new Map([['',training]]));return model;
  }
  function herbProfile(model,herbId,options={}){
    const vector=model.sourceVectors.find(v=>v.id===herbId);if(!vector)throw new Error('本草身份未收錄');
    const s=subset(model,null,options);return {...clone(vector),learned:{...learnedFor(model,herbId,s.training),trainingSubset:summarySubset(s)},limitations:clone(limitations)};
  }
  function summarySubset(s){return {records:s.training.N,groups:s.training.groupCount,trainIds:clone(s.training.trainIds),excludedGroupIds:clone(s.excludedGroupIds||[]),excludedFormulaIds:clone(s.excludedFormulaIds||[]),scope:'原方查詢重新排除同組與同成分組，再估計係數、共現欄位及支持'} }
  function score(training,q,model){
    const included=new Set(q.elementIds),bundles=training.featureBundles.filter(b=>b.elementIds.some(id=>included.has(id)));
    return training.labels.filter(l=>l.supported).map(l=>{
      const contributions=bundles.map(b=>{const coefficient=l.coefficients.find(c=>c.bundleId===b.id).coefficient;return {bundleId:b.id,elementIds:clone(b.elementIds),sourceNames:b.elementIds.map(id=>model.elements.find(e=>e.id===id)?.sourceName||id),coefficient,contribution:coefficient,individualIdentifiable:b.individualIdentifiable,support:b.support,groupSupport:b.groupSupport}}).sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution)||a.bundleId.localeCompare(b.bundleId));
      const logOdds=l.intercept+contributions.reduce((s,c)=>s+c.contribution,0),modelScore=sigmoid(logOdds);
      return {id:l.id,label:l.label,modelScore,associationScore:modelScore,baselineScore:l.prior,predicted:modelScore>=defaults.threshold,threshold:defaults.threshold,logOdds,intercept:l.intercept,contributions,
        support:{records:training.N,groups:training.groupCount,ruleHit:l.nPositive,ruleNotHit:l.nNegative,ruleHitGroups:l.positiveGroups,ruleNotHitGroups:l.negativeGroups},scoreMeaning:'文獻銀詞模型分數；非服用概率、個人藥效或單味因果藥性'};
    }).sort((a,b)=>b.modelScore-a.modelScore||a.id.localeCompare(b.id));
  }
  function predictWith(model,q,s,options={}){
    const supported=new Set(s.training.featureBundles.flatMap(b=>b.elementIds)),supportedElements=q.elementIds.filter(id=>supported.has(id)),supportedElementCoverage=q.denominator?supportedElements.length/q.denominator:0;
    const partialBundles=s.training.featureBundles.filter(b=>b.elementIds.length>1&&b.elementIds.some(id=>q.elementIds.includes(id))&&!b.elementIds.every(id=>q.elementIds.includes(id))).map(b=>({bundleId:b.id,elementIds:clone(b.elementIds),presentElementIds:b.elementIds.filter(id=>q.elementIds.includes(id))}));
    const reasons=[...s.training.reasons];if(!q.elementIds.length)reasons.push('沒有可解析原名成分');if(q.textElementCoverage<defaults.minQueryTextCoverage)reasons.push('查詢原名文本涵蓋不足');if(supportedElementCoverage<defaults.minQuerySupportedCoverage)reasons.push('查詢元素的訓練支持不足');
    if(partialBundles.length)reasons.push('查詢拆開訓練中完全同現的元素束；單味分離情境無法估計');
    const abstained=reasons.length>0;
    const limit=options.nearestLimit??5;if(!Number.isInteger(limit)||limit<0||limit>30)throw new Error('近似案例數須為0至30整數');
    const nearestCases=s.records.filter(r=>r.eligible).map(r=>{const shared=q.elementIds.filter(id=>r.composition.elementIds.includes(id)),denom=new Set([...q.elementIds,...r.composition.elementIds]).size+q.unknown.length;return {id:r.id,name:r.name,sourceBook:r.sourceBook,sourceURL:r.sourceURL,groupId:r.groupId,similarity:denom?shared.length/denom:0,sharedElementIds:shared,profileEvidence:clone(r.silver.evidence),rawIndications:r.rawIndications,eligibleForTraining:true}}).filter(r=>r.similarity>0).sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id)).slice(0,limit);
    return {version,dictionaryVersion:model.dictionaryVersion,abstained,status:abstained?'停止推估：資料或支持不足':'原名成分加成模型的文獻銀詞推估',reasons:unique(reasons),terms:abstained?[]:score(s.training,q,model),
      elements:clone(q.refs),unknownElements:clone(q.unknown),unsupportedElements:q.elementIds.filter(id=>!supported.has(id)).map(id=>({elementId:id,sourceName:model.elements.find(e=>e.id===id)?.sourceName||id,reason:s.training.elementStats.find(x=>x.elementId===id)?.reason||'训练中未见'})),
      textElementCoverage:q.textElementCoverage,catalogMappingCoverage:q.catalogMappingCoverage,supportedElementCoverage,partialBundles,trainingSubset:summarySubset(s),nearestCases,
      queryFeatureScope:'原名成分二值 presence；克數、研究份數及炮製參數未入已學模型',processingEvidence:{features:[],status:'炮製參數與原方量不進入此模型',unknownIsNotNegative:true},validation:null,limitations:clone(limitations)};
  }
  function predict(model,query,options={}){const q=root.InferenceModel.queryOf(model,query),s=subset(model,q,options);return predictWith(model,q,s,options)}
  function metrics(store){
    const rows=Object.values(store),scored=rows.reduce((s,r)=>s+r.scored,0),weight=rows.reduce((s,r)=>s+r.weightScored,0),tp=rows.reduce((s,r)=>s+r.tp,0),fp=rows.reduce((s,r)=>s+r.fp,0),fn=rows.reduce((s,r)=>s+r.fn,0);
    const perLabel=rows.map(r=>({...r,precision:r.tp+r.fp?r.tp/(r.tp+r.fp):null,recall:r.tp+r.fn?r.tp/(r.tp+r.fn):null,f1:r.positiveTruth&&r.negativeTruth?(2*r.tp+r.fp+r.fn?2*r.tp/(2*r.tp+r.fp+r.fn):0):null,brier:r.weightScored?r.squaredError/r.weightScored:null})),defined=perLabel.filter(r=>r.f1!==null);
    return {scoredDecisions:scored,weightedDecisions:weight,microPrecision:tp+fp?tp/(tp+fp):null,microRecall:tp+fn?tp/(tp+fn):null,microF1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null,macroF1:defined.length?defined.reduce((s,r)=>s+r.f1,0)/defined.length:null,brier:weight?rows.reduce((s,r)=>s+r.squaredError,0)/weight:null,perLabel,weighting:'每折每個測試防洩漏組總權重1；只評估支持足夠且來源標籤合格的同一批決策'};
  }
  function validate(model,options={}){
    const mode=options.mode||'family';if(!['family','sourceBook'].includes(mode))throw new Error('留出模式無效');
    const count=options.folds??defaults.folds;if(!Number.isInteger(count)||count<2)throw new Error('留出折數至少為2');
    const initial=subset(model,null,options),records=initial.records,units=new Map();for(const r of records){const key=mode==='sourceBook'?r.sourceBook:r.groupId;if(!units.has(key))units.set(key,[]);units.get(key).push(r)}
    const k=mode==='sourceBook'?units.size:Math.min(count,units.size);
    if(k<2||records.filter(r=>r.eligible).length<defaults.minTrainRecords)return {version,performed:false,grouping:mode,folds:[],predictions:[],metrics:null,baselineMetrics:null,reasons:['完整來源語料或防洩漏組不足'],limitations:clone(limitations)};
    const splits=Array.from({length:k},()=>[]),sorted=[...units.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
    for(const [,members]of sorted){const j=splits.reduce((best,x,i)=>x.length<splits[best].length?i:best,0);splits[j].push(...members)}
    const accumulator={},baseline={},folds=[],predictions=[];let scoredQueries=0,eligibleTestRecords=0;
    const update=(store,term,actual,value,weight)=>{if(!store[term.id])store[term.id]={id:term.id,label:term.label,tp:0,fp:0,fn:0,tn:0,scored:0,weightScored:0,positiveTruth:0,negativeTruth:0,squaredError:0};const r=store[term.id],p=value>=defaults.threshold;r.scored++;r.weightScored+=weight;r.squaredError+=weight*(value-Number(actual))**2;r[actual?'positiveTruth':'negativeTruth']+=weight;r[actual?p?'tp':'fn':p?'fp':'tn']+=weight};
    for(let i=0;i<k;i++){
      const test=splits[i],testIds=new Set(test.map(r=>r.id)),testGroups=new Set(test.map(r=>r.groupId)),train=records.filter(r=>!testGroups.has(r.groupId)&&!testIds.has(r.id)),training=learn(train,model.elements),s={records:train,training,excludedGroupIds:[...testGroups].sort(),excludedFormulaIds:records.filter(r=>testGroups.has(r.groupId)).map(r=>r.id)};
      const sizes=new Map();for(const r of test.filter(r=>r.eligible))sizes.set(r.groupId,(sizes.get(r.groupId)||0)+1);
      let decisions=0,abstainedQueries=0;
      for(const r of test){
        const q={...r.composition,formulaId:r.id,groupId:r.groupId},p=predictWith(model,q,s,{nearestLimit:0});
        if(p.abstained)abstainedQueries++;if(r.eligible)eligibleTestRecords++;
        const actualLabelIds=r.silver.eligible?clone(r.silver.labelIds):null;
        const terms=p.terms.map(t=>({...t,actual:r.eligible?r.silver.labelIds.includes(t.id):null}));
        predictions.push({id:r.id,name:r.name,sourceBook:r.sourceBook,sourceURL:r.sourceURL,groupId:r.groupId,fold:i+1,actualLabelIds,eligibleForEvaluation:r.eligible,exclusionReasons:clone(r.exclusionReasons),labelStatus:r.silver.status,terms,abstained:p.abstained,reasons:p.reasons,textElementCoverage:p.textElementCoverage,catalogMappingCoverage:p.catalogMappingCoverage,supportedElementCoverage:p.supportedElementCoverage,unknownElements:p.unknownElements,unsupportedElements:p.unsupportedElements,trainingRecords:training.N,trainingGroups:training.groupCount});
        if(r.eligible&&!p.abstained&&terms.length){scoredQueries++;const w=1/sizes.get(r.groupId);for(const t of terms){update(accumulator,t,t.actual,t.modelScore,w);update(baseline,t,t.actual,t.baselineScore,w);decisions++}}
      }
      folds.push({fold:i+1,trainRecords:training.N,trainGroups:training.groupCount,testRecords:test.length,trainIds:clone(training.trainIds),testIds:test.map(r=>r.id),testGroups:[...testGroups].sort(),groupOverlap:unique(train.map(r=>r.groupId)).filter(id=>testGroups.has(id)),sourceBooks:unique(test.map(r=>r.sourceBook)),supportedTargets:training.labels.filter(l=>l.supported).map(l=>l.id),scoredDecisions:decisions,abstainedQueries,reasons:training.reasons,featureBundles:training.featureBundles.map(b=>({id:b.id,elementIds:b.elementIds,support:b.support,groupSupport:b.groupSupport})),trainingBaselines:training.labels.map(l=>({id:l.id,prior:l.prior,weightedPositive:l.weightedPositive,weightedNegative:l.weightedNegative})),optimizer:training.optimizer});
    }
    const m=metrics(accumulator),b=metrics(baseline),performed=true;
    return {version,dictionaryVersion:model.dictionaryVersion,performed,grouping:mode,status:m.scoredDecisions?'已按組重新訓練並計算銀詞留出結果':'留出已執行；支持不足，無可報數值',metrics:m.scoredDecisions?m:null,baselineMetrics:m.scoredDecisions?b:null,
      comparedToBaseline:m.scoredDecisions?{microF1Difference:m.microF1!==null&&b.microF1!==null?m.microF1-b.microF1:null,brierDifference:m.brier-b.brier,meaning:'同一批支持足夠的銀詞決策，按組加權與每折訓練銀詞頻率基線比較；不是療效驗證'}:null,
      folds,predictions:predictions.sort((a,b)=>a.id.localeCompare(b.id)),coverage:{testRecords:records.length,eligibleTestRecords,scoredQueryRecords:scoredQueries,queryCoverage:eligibleTestRecords?scoredQueries/eligibleTestRecords:0,scoredLabelDecisions:m.scoredDecisions,possibleLabelDecisions:eligibleTestRecords*model.dictionary.length,labelDecisionCoverage:eligibleTestRecords?m.scoredDecisions/(eligibleTestRecords*model.dictionary.length):0,allSourcePredictions:predictions.length},
      trainingSubset:summarySubset(initial),protocol:'固定16詞字典與ridge/迭代/支持門檻；每折重新建訓練詞彙、完全同現束、係數與基線；來源書留出額外剔除跨書同族。未作超參數搜尋。',limitations:clone(limitations)};
  }
  function describeCorpus(model){return {...clone(model.summary),version,dictionaryVersion:model.dictionaryVersion,sourceHerbs:model.herbVectors.length,sourceElements:model.elements.length,trainingRecords:model.training.N,trainingGroups:model.training.groupCount,learnedBundles:model.training.featureBundles.length,individuallyReportableElements:model.training.elementStats.filter(s=>s.reportable).length,cooccurrenceUnidentifiableElements:model.training.elementStats.filter(s=>s.identicalOccurrenceElements.length).length,supportedTargets:model.training.labels.filter(l=>l.supported).map(l=>l.id),inputPolicy:model.inputPolicy,parameters:clone(defaults),optimizer:clone(model.training.optimizer),fingerprint:model.fingerprint,limitations:clone(limitations)}}
  root.HerbVectorModel={version,dictionaryVersion:root.InferenceModel?.dictionaryVersion,dictionary:clone(root.InferenceModel?.dictionary||[]),defaults:clone(defaults),sourceVector,fit,herbProfile,predict,validate,evaluateGrouped:validate,describeCorpus,limitations:clone(limitations)};
})(globalThis);
