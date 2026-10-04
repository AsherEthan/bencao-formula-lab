'use strict';
(function(root){
  const version='processing-evidence-model-1.0';
  const fields=['nature','flavors','meridians','effects'];
  const verifiedStatuses=new Set(['source_excerpt_reviewed','curated_source_excerpt_reviewed']);
  const limits=[
    '炮製分支只採用該分支有原文位置的屬性；未記載的性味、歸經與功用維持未知。',
    '「來源未指定」保留原條目泛稱屬性，不能當作生品、原品或指定現代飲片的屬性。',
    '克數為使用者實錄的研究稱量；不由研究份數、古代兩錢或片枚自動換算。',
    '克數只用作材料質量占比與文獻標籤加權，不建立劑量、吸收量、毒性消除或藥效模型。',
    '典籍工藝條件常不完整；未記載的溫度、時間、輔料比例與品質終點保持未錄。',
    '炮製、較少克數與未知屬性不能移除既有毒性及配伍警示。'
  ];
  function copy(x){return JSON.parse(JSON.stringify(x))}
  function sourceSpanValid(span,data){
    if(!span||span.basis!=='herbRawText'||span.offsetUnit!=='unicode_code_point'||typeof span.herbId!=='string'||typeof span.text!=='string'||!span.text||!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<0||span.end<=span.start)return false;
    const h=data.herbs.find(x=>x.id===span.herbId);
    return !!h&&typeof h.rawText==='string'&&[...h.rawText].slice(span.start,span.end).join('')===span.text;
  }
  function evidenceValid(e,data){
    return !!e&&typeof e.sourceId==='string'&&data.sources.some(s=>s.id===e.sourceId)&&sourceSpanValid(e.evidenceSpan,data)&&data.herbs.find(h=>h.id===e.evidenceSpan.herbId)?.sourceId===e.sourceId&&(!e.text||e.text===e.evidenceSpan.text);
  }
  function originalMaterialSpans(value,herbId){
    if(Array.isArray(value))return value.map(x=>originalMaterialSpans(x,herbId));
    if(value&&typeof value==='object'){
      const result={};for(const [key,v] of Object.entries(value))result[key]=originalMaterialSpans(v,herbId);
      if(value.basis==='rawText'&&Number.isInteger(value.start)&&Number.isInteger(value.end)){result.basis='originalMaterialRawText';result.herbId=herbId}
      return result;
    }
    return value;
  }
  function resolveProfile(profile,original,data){
    const reviewed=verifiedStatuses.has(profile.verificationStatus);
    const attributes={nature:null,flavors:[],meridians:[],effects:[]};
    const attributeStatus={};const admitted=[];const rejected=[];
    for(const field of fields){
      const stated=field==='nature'?(typeof profile.attributes?.nature==='string'&&profile.attributes.nature.trim()?[profile.attributes.nature.trim()]:[]):Array.isArray(profile.attributes?.[field])?[...new Set(profile.attributes[field].filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))]:[];
      const valid=[];
      for(const value of stated){
        const e=(profile.propertyEvidence||[]).find(e=>e.field===field&&reviewed&&evidenceValid(e,data)&&e.evidenceSpan.text.includes(value));
        if(e){valid.push(value);admitted.push({field,value,evidence:e})}else rejected.push({field,value,reason:'缺少已核原文位置或分支屬性核查狀態'});
      }
      if(field==='nature')attributes.nature=valid[0]||null;else attributes[field]=valid;
      attributeStatus[field]=valid.length?'linked_processing_source_span':'unknown_after_processing';
    }
    // Each retained attribute points into a verbatim quote, never an invented process effect.
    let rawText='';const evidenceSpans=[];
    for(const item of admitted){
      if(rawText)rawText+='\n';
      const quote=item.evidence.evidenceSpan.text,offset=[...rawText].length,at=quote.indexOf(item.value);
      rawText+=quote;
      const start=offset+[...quote.slice(0,at)].length;
      evidenceSpans.push({field:item.field,text:item.value,start,end:start+[...item.value].length,basis:'rawText',offsetUnit:'unicode_code_point',sourceId:item.evidence.sourceId,processingId:profile.id,originEvidenceSpan:copy(item.evidence.evidenceSpan)});
    }
    const workflow=(profile.workflow||[]).map((step,index)=>({
      ...copy(step),index:index+1,verified:reviewed&&evidenceValid(step,data),
      evidenceStatus:reviewed&&evidenceValid(step,data)?'linked_processing_source_span':'unverified_or_unrecorded_process'
    }));
    const quotes=(profile.sourceQuotes||[]).map(e=>({...copy(e),verified:reviewed&&evidenceValid(e,data)}));
    const sourceIds=[...new Set(admitted.map(x=>x.evidence.sourceId))];
    const derived={...copy(original),nature:attributes.nature||'未錄',flavors:attributes.flavors,meridians:attributes.meridians,effects:attributes.effects,rawText,evidenceSpans,sourceId:sourceIds[0]||original.sourceId,
      processingId:profile.id,processingLabel:profile.label,processingAttributeStatus:attributeStatus,processingEvidence:admitted.map(x=>copy(x.evidence)),processingSourceIds:sourceIds,
      reviewStatus:reviewed?'curated_source_excerpt_reviewed':'processing_source_not_reviewed'};
    // Toxicity and identity belong to the original historical material too; a process choice never clears them.
    derived.originalMaterialRawText=original.rawText||'';derived.originalMaterialSourceId=original.sourceId;
    derived.toxic=originalMaterialSpans(original.toxic,original.id);
    if(original.historicalToxicity)derived.historicalToxicity=originalMaterialSpans(original.historicalToxicity,original.id);
    return {derived,attributes,attributeStatus,workflow,propertyEvidence:admitted.map(x=>copy(x.evidence)),rejectedPropertyEvidence:rejected,sourceQuotes:quotes,reviewed};
  }
  function distribution(rows,data,field,weightField){
    const counts={};const total=rows.reduce((sum,row)=>sum+row[weightField],0);
    if(!total)return [];
    for(const row of rows){
      const h=data.herbs.find(x=>x.id===row.id);
      const values=field==='nature'?[root.HerbModel.natureGroup(h.nature)]:[...new Set(h[field]||[])];
      if(!values.length)values.push('未錄');
      for(const label of values)counts[label]=(counts[label]||0)+row[weightField]/values.length;
    }
    return Object.entries(counts).map(([label,value])=>({label,percent:value/total*100,weight:value})).sort((a,b)=>b.percent-a.percent||a.label.localeCompare(b.label));
  }
  function weightedQuant(rows,data,weightField,quantOptions){
    if(!root.QuantModel)return null;
    const q=root.QuantModel,total=rows.reduce((s,x)=>s+x[weightField],0);
    const labels=q.axes.map(x=>({...x,coverage:0,herbs:[]}));
    const records=[],unknownIds=[];let low=0,high=0,knownWeight=0,positiveWeight=0,negativeWeight=0,conditionalWeight=0;
    for(const row of rows){
      const h=data.herbs.find(x=>x.id===row.id),weight=row[weightField],thermal=q.thermal(h,quantOptions.scheme,quantOptions.mild,quantOptions.strong),terms=q.lexical(h);
      records.push({id:h.id,name:h.name,ratio:row.ratio,grams:row.grams,weight,thermal,terms,sourceId:h.sourceId,processingId:row.processingId,reviewStatus:h.reviewStatus});
      if(thermal.range){knownWeight+=weight;low+=(weight/total)*thermal.range[0];high+=(weight/total)*thermal.range[1];if(thermal.range[0]>0)positiveWeight+=weight;if(thermal.range[1]<0)negativeWeight+=weight;if(thermal.status==='conditional')conditionalWeight+=weight}else unknownIds.push(h.id);
      for(let i=0;i<labels.length;i++)if(terms[i].present){labels[i].coverage+=weight;labels[i].herbs.push(h.id)}
    }
    for(const label of labels)label.coverage=total?label.coverage/total:0;
    const knownSubsetRange=knownWeight?[low/(knownWeight/total),high/(knownWeight/total)]:null;
    return {version:q.version,totalWeight:total,weightUnit:weightField==='grams'?'g':'研究份數',records,range:total&&!unknownIds.length?knownSubsetRange:null,knownSubsetRange,thermalCoverage:total?knownWeight/total:0,unknownIds,unlinkedThermalIds:records.filter(r=>r.thermal.range&&!(r.thermal.evidence||[]).length).map(r=>r.id),conditionalWeight,positiveWeight,negativeWeight,oppositeSigns:positiveWeight>0&&negativeWeight>0,labels,options:copy(quantOptions)};
  }
  function availableProfiles(herbId,processingData){
    return (processingData?.profiles||[]).filter(p=>Array.isArray(p.herbIds)&&p.herbIds.includes(herbId)).map(p=>copy(p));
  }
  function customProfile(herbId){return {id:'custom_unverified',herbIds:[herbId],label:'自訂工藝（未校核）',kind:'researcher_record',workflow:[],attributes:{nature:null,flavors:[],meridians:[],effects:[]},propertyEvidence:[],sourceQuotes:[],verificationStatus:'unverified_researcher_record',limitations:['工藝與稱量由研究者實錄，尚無該加工分支的來源屬性或實驗資料。']}}
  function resolveSelection(rows,data,processingData={},options={}){
    const basis=options.basis||'research';const errors=[];
    const requested=options.quantOptions===undefined?{}:options.quantOptions;
    let quantOptions={scheme:'base',mild:.5,strong:1.5};
    if(!requested||typeof requested!=='object'||Array.isArray(requested))errors.push('寒熱編碼設定須為設定物件。');
    else{
      quantOptions={scheme:requested.scheme||'base',mild:requested.mild??.5,strong:requested.strong??1.5};
      try{
        if(root.QuantModel){
          if(typeof quantOptions.scheme!=='string'||!Object.prototype.hasOwnProperty.call(root.QuantModel.scales,quantOptions.scheme))throw new Error('編碼設定無效');
          root.QuantModel.thermal({nature:''},quantOptions.scheme,quantOptions.mild,quantOptions.strong);
          const magnitude=Math.max(...Object.values(root.QuantModel.scales[quantOptions.scheme]).filter(Number.isFinite).map(Math.abs));
          if(!Number.isFinite(magnitude*quantOptions.mild)||!Number.isFinite(magnitude*quantOptions.strong))throw new Error('編碼設定超出有限數值範圍');
        }
        else if(!['base','wide'].includes(quantOptions.scheme)||!Number.isFinite(quantOptions.mild)||quantOptions.mild<=0||!Number.isFinite(quantOptions.strong)||quantOptions.strong<=0)throw new Error('編碼設定無效');
      }catch(e){errors.push(e.message)}
    }
    if(!['research','grams'].includes(basis))errors.push('分析基準須為 research 或 grams。');
    try{root.HerbModel.validateSelection(rows,data)}catch(e){errors.push(e.message)}
    if(!errors.length){
      for(const row of rows){
        if(['nature','effects','flavors','meridians','toxic','historicalToxicity','attributes'].some(key=>Object.prototype.hasOwnProperty.call(row,key)))errors.push('屬性須由原文證據解析，不接受工作台直接覆寫。');
        if(row.grams!==undefined&&row.grams!==null&&(!Number.isFinite(row.grams)||row.grams<=0))errors.push('克數須為有限的正數；未實錄時請留空。');
        if(row.processNotes!==undefined&&typeof row.processNotes!=='string')errors.push('工藝註記須為文字。');
        if(row.sourceProcessingNote!==undefined&&typeof row.sourceProcessingNote!=='string')errors.push('原方炮製註記須為文字。');
        if(row.processRecord!==undefined){
          const record=row.processRecord;
          if(!record||typeof record!=='object'||Array.isArray(record))errors.push('工藝實錄須為記錄物件。');
          else{
            for(const key of ['batch','stepsNote','medium','equipment'])if(record[key]!==undefined&&record[key]!==null&&typeof record[key]!=='string')errors.push('工藝實錄的文字字段格式無效。');
            if(record.temperatureC!==undefined&&record.temperatureC!==null&&!Number.isFinite(record.temperatureC))errors.push('實錄溫度須為有限數值。');
            if(record.durationMinutes!==undefined&&record.durationMinutes!==null&&(!Number.isFinite(record.durationMinutes)||record.durationMinutes<0))errors.push('實錄時間須為有限非負數值。');
          }
        }
        const pid=row.processingId??'source_unspecified';
        if(typeof pid!=='string'||!pid)errors.push('炮製方式識別碼無效。');
        if(pid!=='source_unspecified'&&pid!=='custom_unverified'){
          const found=(processingData.profiles||[]).filter(p=>p.id===pid);
          if(found.length!==1)errors.push('炮製方式未收錄或識別碼重複。');
          else if(!Array.isArray(found[0].herbIds)||!found[0].herbIds.includes(row.id))errors.push('所選炮製方式不適用於此本草身份。');
        }
      }
      if(rows.reduce((s,x)=>s+(x.grams||0),0)===Infinity)errors.push('克數合計超出可表示的數值範圍。');
    }
    if(errors.length)return {version,valid:false,errors:[...new Set(errors)],basis,limitations:limits.slice(),analysis:null,quant:null,massDistribution:null};
    const originalById=new Map(data.herbs.map(h=>[h.id,h]));const replacements=new Map();const resolvedRows=[];const changes=[];
    for(const input of rows){
      const original=originalById.get(input.id),processingId=input.processingId??'source_unspecified';
      let r;
      if(processingId==='source_unspecified'){
        r={derived:copy(original),attributes:{nature:original.nature||null,flavors:copy(original.flavors||[]),meridians:copy(original.meridians||[]),effects:copy(original.effects||[])},attributeStatus:Object.fromEntries(fields.map(f=>[f,'generic_source_unspecified'])),workflow:[],propertyEvidence:[],rejectedPropertyEvidence:[],sourceQuotes:[],reviewed:null};
      }else{
        const p=processingId==='custom_unverified'?customProfile(original.id):processingData.profiles.find(p=>p.id===processingId);r=resolveProfile(p,original,data);replacements.set(original.id,r.derived);
      }
      const profile=processingId==='source_unspecified'?null:processingId==='custom_unverified'?customProfile(original.id):processingData.profiles.find(p=>p.id===processingId);
      const row={...copy(input),grams:input.grams??null,processingId,processNotes:input.processNotes||'',herbName:original.name,processingLabel:profile?.label||'來源未指定（泛稱條目）',profile:profile?copy(profile):null,attributes:r.attributes,attributeStatus:r.attributeStatus,workflow:r.workflow,propertyEvidence:r.propertyEvidence,rejectedPropertyEvidence:r.rejectedPropertyEvidence,sourceQuotes:r.sourceQuotes,sourceId:r.derived.sourceId,sourceIds:r.derived.processingSourceIds||[original.sourceId],processingUnknown:processingId!=='source_unspecified'&&fields.some(f=>r.attributeStatus[f]==='unknown_after_processing'),verificationStatus:profile?.verificationStatus||'generic_source_unspecified'};
      resolvedRows.push(row);
      if(profile){
        const beforeThermal=root.QuantModel?.thermal(original,quantOptions.scheme,quantOptions.mild,quantOptions.strong),afterThermal=root.QuantModel?.thermal(r.derived,quantOptions.scheme,quantOptions.mild,quantOptions.strong);
        changes.push({id:original.id,name:original.name,processingId,processingLabel:profile.label,before:{nature:original.nature||null,effects:copy(original.effects||[])},after:{nature:r.attributes.nature,effects:copy(r.attributes.effects)},attributeStatus:r.attributeStatus,beforeRange:beforeThermal?.range||null,afterRange:afterThermal?.range||null,comparisonStatus:beforeThermal?.range&&afterThermal?.range?'來源寒熱序位比較；非實測藥效差':'有未知加工屬性；不計差值',propertyEvidence:r.propertyEvidence});
      }
    }
    const derivedData={...data,herbs:data.herbs.map(h=>replacements.get(h.id)||copy(h))};
    const modelRows=rows.map(r=>({...copy(r),processingId:r.processingId??'source_unspecified',grams:r.grams??null,processNotes:r.processNotes||''}));
    const base=root.HerbModel.analyze(modelRows,data);
    const missingGrams=resolvedRows.filter(r=>r.grams===null).map(r=>r.id),gramRows=resolvedRows.filter(r=>r.grams!==null),knownGrams=gramRows.reduce((s,x)=>s+x.grams,0),complete=rows.length>0&&!missingGrams.length;
    const totalGrams=complete?knownGrams:null,gramsCoverage=rows.length?gramRows.length/rows.length:0;
    const partialMass=gramRows.length?{scope:'僅已實錄克數的子集；不是全方質量分布',rowIds:gramRows.map(r=>r.id),excludedIds:missingGrams.slice(),totalGrams:knownGrams,nature:distribution(gramRows,derivedData,'nature','grams'),flavors:distribution(gramRows,derivedData,'flavors','grams'),meridians:distribution(gramRows,derivedData,'meridians','grams'),quant:weightedQuant(gramRows,derivedData,'grams',quantOptions)}:null;
    const massDistribution=complete?{scope:'全部已選材料的實錄質量標籤分布',totalGrams,nature:partialMass.nature,flavors:partialMass.flavors,meridians:partialMass.meridians}:null;
    const canAggregate=basis==='research'||complete;
    const common={...base,selection:rows.map(x=>copy(x)),basis,weightBasis:basis};
    const analysis=basis==='research'?{...common,weightUnit:'研究份數',canAggregate:true,nature:distribution(resolvedRows,derivedData,'nature','ratio'),flavors:distribution(resolvedRows,derivedData,'flavors','ratio'),meridians:distribution(resolvedRows,derivedData,'meridians','ratio')}:complete?{...common,weightUnit:'g',canAggregate:true,totalWeight:totalGrams,nature:massDistribution.nature,flavors:massDistribution.flavors,meridians:massDistribution.meridians}:{...common,weightUnit:'g',canAggregate:false,totalWeight:null,nature:[],flavors:[],meridians:[]};
    const quant=canAggregate?weightedQuant(resolvedRows,derivedData,basis==='grams'?'grams':'ratio',quantOptions):null;
    if(quant)quant.warnings=copy(base.warnings);
    if(partialMass?.quant)partialMass.quant.warnings=copy(base.warnings);
    return {version,valid:true,errors:[],basis,quantOptions:copy(quantOptions),basisComplete:canAggregate,missingGrams,totalGrams,knownGrams,gramsCoverage,gramsComplete:complete,massComplete:complete,resolvedRows,modelRows,derivedData,changes,analysis,quant,massDistribution,partialMass,limitations:limits.slice()};
  }
  root.ProcessingModel={version,sourceSpanValid,evidenceValid,availableProfiles,resolveSelection,limitations:limits.slice()};
})(typeof globalThis!=='undefined'?globalThis:this);
