'use strict';
(function(root){
  const version='text-model-2.1';
  const axes=[
    {id:'qi',label:'益氣詞',terms:['補氣','益氣','補中','大補元氣','補脾']},
    {id:'heat',label:'清熱詞',terms:['清熱','瀉火','瀉熱','涼血','清火','退熱']},
    {id:'warm',label:'溫散詞',terms:['祛寒','散寒','溫中','回陽','逐寒','發表','解肌']},
    {id:'phlegm',label:'化痰詞',terms:['化痰','祛痰','燥濕痰','消痰','開痰','溫痰']},
    {id:'water',label:'利濕詞',terms:['利水','利尿','滲濕','除濕','燥濕','行水','逐水','瀉水']},
    {id:'blood',label:'養血陰詞',terms:['補血','養血','滋陰','養陰','益血','斂陰']},
    {id:'flow',label:'理氣詞',terms:['理氣','行氣','降氣','疏肝','解鬱','破氣','順氣']},
    {id:'astringent',label:'收澀詞',terms:['收澀','收斂','澀精','止瀉','止汗','固表','斂汗']}
  ];
  const scales={base:{label:'基礎序位',寒:-2,涼:-1,平:0,溫:1,熱:2},wide:{label:'極端詞加權',寒:-4,涼:-1,平:0,溫:1,熱:4}};
  function linkedSpan(h,span){
    if(!span||typeof span.text!=='string'||!span.text||!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<0||span.end<=span.start)return false;
    if(span.basis!=='rawText'||span.offsetUnit!=='unicode_code_point'||typeof h.rawText!=='string')return false;
    const chars=[...h.rawText];
    return chars.slice(span.start,span.end).join('')===span.text;
  }
  function thermal(h,scheme='base',mild=.5,strong=1.5){
    if(!scales[scheme]||!Number.isFinite(mild)||mild<=0||!Number.isFinite(strong)||strong<=0)throw new Error('編碼設定無效');
    const recorded=String(h.nature||'');
    if(/未知|未錄|未明|未載/.test(recorded)||!/[寒涼凉平溫温熱热]/.test(recorded))return {range:null,recorded,status:'unknown'};
    // Editorial restatements such as 微寒（原文：寒微） are not a second condition.
    const codingText=recorded.replace(/[（(](?:原文|此典籍|此輯本|本書|此書)[^）)]*[）)]/g,'').replace(/凉/g,'涼').replace(/温/g,'溫').replace(/热/g,'熱');
    const branches=codingText.split(/[／/]|或/).filter(x=>x.trim());
    if(branches.some(x=>!/[寒涼平溫熱]/.test(x)))return {range:null,recorded,status:'unknown'};
    const matches=[...codingText.matchAll(/(微|小|大)?([寒涼平溫熱])(微|小|大)?/g)];
    const values=matches.map(m=>{const modifier=m[1]||m[3];return scales[scheme][m[2]]*(modifier==='微'||modifier==='小'?mild:modifier==='大'?strong:1)});
    if(!values.length)return {range:null,recorded,status:'unknown'};
    const low=Math.min(...values),high=Math.max(...values);
    const evidence=(h.evidenceSpans||[]).filter(x=>x.field==='nature'&&linkedSpan(h,x));
    return {range:[low,high],recorded,status:low===high&&branches.length===1?'coded':'conditional',evidence,evidenceStatus:evidence.length?'linked_source_span':'declared_label_without_linked_nature_span'};
  }
  function positiveTerms(text,terms){
    const found=[];
    for(const term of terms){let at=text.indexOf(term);while(at>=0){const before=text.slice(Math.max(0,at-8),at).split(/[，,。；;：:]/).pop();if(!/[不非忌禁莫勿無无未]/.test(before))found.push({term,at});at=text.indexOf(term,at+term.length)}}
    return found;
  }
  function lexical(h){
    const texts=(h.effects||[]).map(t=>String(t));
    return axes.map(axis=>{const evidence=[];for(const text of texts){const span=(h.evidenceSpans||[]).find(s=>s.field==='effects'&&s.text===text&&linkedSpan(h,s));if(!span)continue;for(const {term,at} of positiveTerms(text,axis.terms))evidence.push({term,text,sourceId:h.sourceId,span,termStart:span.start+[...text.slice(0,at)].length,termEnd:span.start+[...text.slice(0,at+term.length)].length})}return {id:axis.id,label:axis.label,present:evidence.length>0,evidence}});
  }
  function composition(f,data){
    const known=new Set((data.herbs||[]).map(h=>h.id));
    const declared=[...new Set(Array.isArray(f.herbIds)?f.herbIds:[])];
    const refs=Array.isArray(f.ingredientRefs)?f.ingredientRefs.filter(x=>x&&x.scope!=='auxiliary'):[];
    const unresolved=refs.filter(x=>!x.id||!known.has(x.id)||x.mappingStatus==='unresolved');
    const ambiguous=refs.filter(x=>x.id&&known.has(x.id)&&x.mappingStatus!=='exact'&&x.mappingStatus!=='unresolved');
    const refIds=new Set(refs.filter(x=>x.id).map(x=>x.id));
    const unreferenced=declared.filter(id=>!refIds.has(id));
    const omitted=refs.filter(x=>x.id&&known.has(x.id)&&!declared.includes(x.id));
    const missing=[...unresolved,...unreferenced.map(id=>({id,sourceName:id,mappingStatus:'missing_core_reference'})),...omitted.map(x=>({...x,mappingStatus:'omitted_from_herbIds'}))];
    const ids=declared.filter(id=>known.has(id));
    return {ids,refs,unresolved:missing,ambiguous,complete:refs.length>0&&ids.length>0&&!missing.length&&!ambiguous.length,totalUnits:Math.max(refs.length,declared.length),scope:'core'};
  }
  function uniqueCorpus(data){
    const seen=new Set(),included=[],excluded=[];
    for(const f of data.formulas||[]){
      const c=composition(f,data);
      if(!c.complete){excluded.push({id:f.id,reason:c.ambiguous.length?'核心成分名稱映射仍有歧義':'核心成分身份或解析未完成',names:[...c.unresolved,...c.ambiguous].map(x=>x.sourceName)});continue}
      const key=c.ids.slice().sort().join('|');const duplicate=f.duplicateGroupId?'source:'+f.duplicateGroupId:null;
      if(seen.has(key)||(duplicate&&seen.has(duplicate))){excluded.push({id:f.id,reason:'相同成分集合或來源重抄群去重'});continue}
      seen.add(key);if(duplicate)seen.add(duplicate);included.push(f);
    }
    return {included,excluded,unit:'核心成分身份完整，按成分集合與已知來源重抄群去重；尚未完成方族譜系校訂'};
  }
  function pairStats(a,b,data){
    if(a===b)throw new Error('請選兩個不同本草條目');
    if(!data.herbs.some(h=>h.id===a)||!data.herbs.some(h=>h.id===b))throw new Error('本草條目未收錄');
    const corpus=uniqueCorpus(data);let n11=0,n10=0,n01=0,n00=0;const examples=[];
    for(const f of corpus.included){const A=f.herbIds.includes(a),B=f.herbIds.includes(b);if(A&&B){n11++;examples.push(f.id)}else if(A)n10++;else if(B)n01++;else n00++}
    const N=n11+n10+n01+n00,nA=n11+n10,nB=n11+n01;
    const alpha=.5,A=n11+alpha,B=n10+alpha,C=n01+alpha,D=n00+alpha,Np=N+4*alpha;
    const sufficient=N>=30&&n11>=3&&Math.min(nA,nB,N-nA,N-nB)>=3;
    const defined=N>0&&nA>0&&nB>0&&nA<N&&nB<N;
    return {N,n11,n10,n01,n00,nA,nB,examples,alpha,excluded:corpus.excluded,sufficient,phi:sufficient&&defined?(A*D-B*C)/Math.sqrt((A+B)*(C+D)*(A+C)*(B+D)):null,logLift:sufficient&&defined?Math.log((A/Np)/(((A+B)/Np)*((A+C)/Np))):null,status:!defined?'無法估計':sufficient?'描述性統計；尚未建立推斷與方族獨立性':'樣本不足；只展示頻數',meaning:'同現不代表協同、療效、安全或因果'};
  }
  function aggregate(rows,data,options={}){
    root.HerbModel.validateSelection(rows,data);
    thermal({nature:''},options.scheme||'base',options.mild??.5,options.strong??1.5);
    const total=rows.reduce((s,x)=>s+x.ratio,0);const labels=axes.map(x=>({...x,coverage:0,herbs:[]}));let low=0,high=0,knownWeight=0,positive=0,negative=0,conditional=0;const missing=[];const records=[];
    for(const row of rows){const h=data.herbs.find(h=>h.id===row.id);const t=thermal(h,options.scheme||'base',options.mild??.5,options.strong??1.5);const terms=lexical(h);records.push({id:h.id,name:h.name,ratio:row.ratio,thermal:t,terms,reviewStatus:h.reviewStatus,sourceId:h.sourceId});if(t.range){knownWeight+=row.ratio;low+=row.ratio*t.range[0];high+=row.ratio*t.range[1];if(t.range[0]>0)positive+=row.ratio;if(t.range[1]<0)negative+=row.ratio;if(t.status==='conditional')conditional+=row.ratio}else missing.push(h.id);for(let i=0;i<labels.length;i++)if(terms[i].present){labels[i].coverage+=row.ratio;labels[i].herbs.push(h.id)}}
    const knownRange=knownWeight?[low/knownWeight,high/knownWeight]:null;
    for(const label of labels)label.coverage=total?label.coverage/total:0;
    return {version,totalWeight:total,records,range:total&&knownWeight===total?knownRange:null,knownSubsetRange:knownRange,thermalCoverage:total?knownWeight/total:0,unknownIds:missing,unlinkedThermalIds:records.filter(x=>x.thermal.range&&!x.thermal.evidence.length).map(x=>x.id),conditionalWeight:conditional,positiveWeight:positive,negativeWeight:negative,oppositeSigns:positive>0&&negative>0,labels,options:{scheme:options.scheme||'base',mild:options.mild??.5,strong:options.strong??1.5},warnings:root.HerbModel.analyze(rows,data).warnings};
  }
  function referenceProfile(f,data){
    const c=composition(f,data),rows=c.ids.map(id=>({id,ratio:1}));const result=aggregate(rows,data);
    const unresolved=c.unresolved;
    result.completeComposition=c.complete;
    result.compositionCoverage=c.totalUnits?c.ids.length/c.totalUnits:0;
    result.compositionUnit='核心材料等權索引；未解析材料保留未知';
    if(!c.complete){
      result.range=null;
      // Partial formula results must use the full core composition denominator.
      const denominator=c.totalUnits||rows.length;
      if(denominator){result.thermalCoverage*=rows.length/denominator;for(const label of result.labels)label.coverage*=rows.length/denominator;result.totalWeight=denominator}
    }
    const labelEvidence=(f.profileEvidence||[]).filter(e=>typeof e.text==='string'&&e.sourceId&&data.sources.some(s=>s.id===e.sourceId)&&e.evidenceSpan?.text===e.text&&Number.isInteger(e.evidenceSpan.start)&&Number.isInteger(e.evidenceSpan.end)&&e.evidenceSpan.start>=0&&e.evidenceSpan.end-e.evidenceSpan.start===[...e.text].length);
    const expected=axes.filter(a=>labelEvidence.some(e=>positiveTerms(e.text,a.terms).length)).map(a=>a.id);
    const overlapping=result.labels.filter(a=>a.coverage>0&&expected.includes(a.id)).map(a=>a.id);
    const unexpected=expected.filter(id=>!overlapping.includes(id));
    const independentlyReviewed=f.labelReviewStatus==='independently_annotated'&&f.holdoutStatus==='held_out';
    return {id:f.id,result,unresolved,ambiguous:c.ambiguous,expected,overlapping,unmatched:unexpected,hasSourceLabel:expected.length>0,hasIndependentLabel:expected.length>0&&independentlyReviewed,validationStatus:independentlyReviewed?'標註與留出狀態已声明；仍須外部審核':'未建立獨立標註與方族留出驗證',status:!c.complete?'核心成分身份或解析未完成':expected.length?'可作原文詞覆蓋比較；非獨立驗證':'缺可映射的方義詞；未驗證',inputPolicy:'只聚合具有原文位置的本草功用詞，方名與方義不進入輸入特徵',comparisonPolicy:'凍結詞典的原文詞覆蓋檢查；來源短句存在不能證明獨立留出或外部藥理驗證'};
  }
  function jaccard(a,b){const A=new Set(a),B=new Set(b),U=new Set([...A,...B]);return U.size?[...A].filter(x=>B.has(x)).length/U.size:0}
  function candidatePool(data){
    const known=new Set((data.formulas||[]).flatMap(f=>(f.ingredientRefs||[]).filter(r=>r&&r.scope!=='auxiliary'&&r.mappingStatus==='exact'&&r.id&&f.herbIds?.includes(r.id)).map(r=>r.id)));
    return data.herbs.filter(h=>{
      const t=thermal(h);
      const unresolvedIdentity=/未指定|未確定|泛稱|不確定|未分|未區分|分述(?:白|赤|生|熟)|檢索關聯|名稱關聯|不能由原文.*斷定|不能代表/.test(h.identityNote||'');
      return known.has(h.id)&&data.sources.some(s=>s.id===h.sourceId)&&h.reviewStatus==='curated_source_excerpt_reviewed'&&!h.toxic&&h.historicalToxicity?.status!=='source_asserts_toxic'&&t.status==='coded'&&t.evidence.length>0&&!unresolvedIdentity&&lexical(h).some(x=>x.present);
    });
  }
  function generate(data,config={}){
    const goal=config.goal||'qi',target=config.target??1,size=config.size??3,noveltyWeight=config.noveltyWeight??.25;
    if(!axes.some(x=>x.id===goal)||!Number.isFinite(target)||target<-3||target>3||!Number.isInteger(size)||size<3||size>5||!Number.isFinite(noveltyWeight)||noveltyWeight<0||noveltyWeight>1)throw new Error('探索參數不在允許範圍');
    const pool=candidatePool(data),all=[],formulae=(data.formulas||[]).filter(f=>composition(f,data).complete);let considered=0,rejectedRules=0,excludedExisting=0;
    function add(combination){considered++;const ids=combination.map(h=>h.id);if(formulae.some(f=>jaccard(ids,f.herbIds)===1)){excludedExisting++;return}const rows=ids.map(id=>({id,ratio:1}));const r=aggregate(rows,data);if(r.warnings.length){rejectedRules++;return}const term=r.labels.find(x=>x.id===goal);if(!term?.coverage)return;const overlaps=formulae.map(f=>({id:f.id,value:jaccard(ids,f.herbIds)})).sort((a,b)=>b.value-a.value);const nearest=overlaps[0];const novelty=1-(nearest?.value||0);
      const scenarios=[{scheme:'base',mild:.5,strong:1.5},{scheme:'wide',mild:.5,strong:1.5},{scheme:'base',mild:.25,strong:1},{scheme:'base',mild:.75,strong:2}];
      const scores=scenarios.map(o=>{const x=aggregate(rows,data,o);const mid=(x.range[0]+x.range[1])/2;const thermalMatch=1-Math.min(1,Math.abs(mid-target)/(o.scheme==='wide'?6:3));const align=.7*term.coverage+.3*thermalMatch;return (1-noveltyWeight)*align+noveltyWeight*novelty});
      all.push({id:ids.slice().sort().join('+'),rows,profile:r,goalCoverage:term.coverage,nearest,novelty,scores,score:scores[0],status:'待審文獻組合假設',modernIdentity:'未完成現代基原、品質、炮製及安全審查'});
    }
    function combinations(start,picked){if(picked.length===size){add(picked);return}for(let i=start;i<=pool.length-(size-picked.length);i++)combinations(i+1,[...picked,pool[i]])}
    combinations(0,[]);all.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));const rankMaps=[0,1,2,3].map(i=>new Map([...all].sort((a,b)=>b.scores[i]-a.scores[i]||a.id.localeCompare(b.id)).map((x,n)=>[x.id,n+1])));
    for(const candidate of all){const ranks=rankMaps.map(m=>m.get(candidate.id));candidate.rankRange=[Math.min(...ranks),Math.max(...ranks)];candidate.sensitivityStable=candidate.rankRange[0]===candidate.rankRange[1]}
    const picked=[];for(const x of all){if(picked.every(y=>jaccard(x.rows.map(r=>r.id),y.rows.map(r=>r.id))<=.6)){picked.push(x);if(picked.length===5)break}}
    return {version,poolIds:pool.map(h=>h.id),considered,rejectedRules,excludedExisting,matchingCount:all.length,results:picked,config:{goal,target,size,noveltyWeight},scoreSpec:'(1−新穎權重)×(0.7×目標詞涵蓋+0.3×寒熱編碼接近度)+新穎權重×(1−最高成分重疊)',constraints:['只取已有方劑中核心名稱明確映射且校核節錄的條目','寒熱與至少一項功用詞必須有可核原文位置','排除毒性記載、混合加工性味、未定名稱與已錄配伍警示','各味等權 1；非克數或服用比例','只以核心身份完整的已錄方計算重疊；不完整方不構成新穎性證據','候選間成分重疊不高於 0.6'],limitations:['不是全部可能組合，不證明歷史上從未出現','未知現代身份與安全不被變成安全分數','文獻篩選通過不代表可服用或有效','四種編碼假設的排名變動只描述模型敏感性','少數身份映射與缺原文位置可能令目標沒有合資格候選']};
  }
  root.QuantModel={version,axes,scales,thermal,lexical,aggregate,uniqueCorpus,pairStats,referenceProfile,candidatePool,generate,jaccard,composition};
})(globalThis);
