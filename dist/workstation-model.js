'use strict';
(function(root, factory) {
  let flow = root && root.WorkbenchFlow;
  if (!flow && typeof module === 'object' && module.exports) {
    try { flow = require('./workbench-flow.js'); } catch (_) { /* Dependency may be loaded globally by a test harness. */ }
  }
  const api = factory(flow);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WorkstationModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Flow) {
  const version = 'real-workstation-1.0';
  const clone = x => x === undefined ? null : Array.isArray(x) ? Array.from(x, clone) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k,v]) => [k,clone(v)])) : x;
  const text = x => typeof x === 'string' ? x : '';
  const has = x => x !== null && x !== undefined && x !== '';
  const methods = ['unrecorded','decoction','powder','pill','other'];
  const instructionLabels = {unrecorded:'投入指令未錄', ordinary:'一般合煎',preboil:'先煎',late_add:'後下',wrapped:'包煎',dissolve:'烊化',separate:'另煎'};
  const planFields = ['batch','waterMl','vessel','soakMinutes','firstMinutes','secondMinutes','temperatureC','filtrateMl','notes'];
  const defaultPlan = () => ({batch:'',waterMl:null,vessel:'',soakMinutes:null,firstMinutes:null,secondMinutes:null,temperatureC:null,filtrateMl:null,notes:''});
  const issue = (code,message,rowId=null) => ({code,message,severity:'error',rowId});
  const limitations = [
    '操作台表示來源核對與研究記錄；播放、節點抵達或參數齊全不表示實際操作已完成。',
    '製備方式與特殊投入指令由研究者明確選擇；不由方名、藥名、毒性或關鍵詞自動指派。',
    '炮製前原料克數不能當作炮製後飲片投入克數；不推估含水率、得率或損耗。',
    '古籍原句、原單位與製法線索原樣保留；未核的身份、製法與參數維持未知。',
    '時間、溫度、水量和濾液量只作研究實錄，不作藥效倍率、濃度、成分萃取或減毒預測。'
  ];
  function normalizePlan(value) {
    return {...defaultPlan(),...(value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {})};
  }
  function recordStatus(fields,record) {
    const count = fields.filter(key => has(record[key])).length;
    return !count ? 'record_missing' : count === fields.length ? 'record_complete' : 'record_partial';
  }
  function normalizePreparation(value) {
    return typeof value === 'string' ? {method:value,notes:''} : value && typeof value === 'object' && !Array.isArray(value) ? {...clone(value),method:text(value.method)||'unrecorded',notes:text(value.notes)} : {method:'unrecorded',notes:''};
  }
  function sourceContext(origin) {
    if (!origin || typeof origin !== 'object') return {sourceId:null,name:'',formHints:[],preparationTexts:[],ingredientRefs:[]};
    // Preserve excerpts as leads for human checking. Never infer a manufacturing method or route from a formula name or full-record keyword.
    const formHints = [origin.sourceName,origin.name].filter(x=>typeof x==='string'&&x).map(value=>({text:value,kind:'source_name_for_manual_check',method:null,verifiedMethod:false}));
    const preparationTexts = ['rawPreparationText','preparationText','methodText','rawAuxiliaryEvidenceText'].filter(key=>typeof origin[key]==='string'&&origin[key]).map(key=>({field:key,text:origin[key],sourceId:text(origin.sourceId)||null,verifiedMethod:false}));
    if (origin.recordSpan && typeof origin.recordSpan.text==='string') preparationTexts.push({field:'recordSpan',text:origin.recordSpan.text,sourceId:text(origin.sourceId)||null,evidenceSpan:clone(origin.recordSpan),verifiedMethod:false});
    return {sourceId:text(origin.sourceId)||null,name:text(origin.sourceName)||text(origin.name),formHints,preparationTexts,ingredientRefs:clone(origin.ingredientRefs||[])};
  }
  function snapshot(rows,processingResult,options={}) {
    if (!Flow || typeof Flow.snapshot !== 'function') throw new Error('WorkstationModel requires WorkbenchFlow to be loaded first.');
    const base = Flow.snapshot(rows,processingResult,options);
    const selected = Array.isArray(rows) ? rows.filter(r=>r&&typeof r.id==='string').map(clone) : [];
    const preparation = normalizePreparation(options.preparation);
    const processPlan = normalizePlan(options.processPlan);
    const operationIssues = [];
    if (!methods.includes(preparation.method)) operationIssues.push(issue('invalid_preparation','製備方式選項無效。'));
    if (options.processPlan!==undefined && (!options.processPlan || typeof options.processPlan!=='object' || Array.isArray(options.processPlan))) operationIssues.push(issue('invalid_process_plan','製備實錄格式無效。'));
    for (const key of ['waterMl','filtrateMl']) if (has(processPlan[key]) && (!Number.isFinite(processPlan[key]) || processPlan[key]<=0)) operationIssues.push(issue('invalid_'+key,'水量與濾液量須為有限正數或留空。'));
    for (const key of ['soakMinutes','firstMinutes','secondMinutes']) if (has(processPlan[key]) && (!Number.isFinite(processPlan[key]) || processPlan[key]<0)) operationIssues.push(issue('invalid_'+key,'實錄時間須為有限非負數或留空。'));
    if (has(processPlan.temperatureC) && !Number.isFinite(processPlan.temperatureC)) operationIssues.push(issue('invalid_temperatureC','實錄溫度須為有限數值或留空。'));
    for (const key of ['batch','vessel','notes']) if (typeof processPlan[key]!=='string') operationIssues.push(issue('invalid_'+key,'實錄文字欄位須為字串。'));
    const source = sourceContext(options.origin);
    const materialEntries = selected.map(row=>{
      const node = base.scene.nodes.find(x=>x.id===row.id);
      const workflow = base.workflows.find(x=>x.rowId===row.id);
      const refs = source.ingredientRefs.filter(x=>x.id===row.id || x.herbId===row.id || x.catalogHerbId===row.id);
      const instruction = row.preparationInstruction ?? 'unrecorded';
      if (!Object.hasOwn(instructionLabels,instruction)) operationIssues.push(issue('invalid_preparation_instruction','投入指令選項無效。',row.id));
      return {...clone(row),name:node?.name||row.id, row:clone(row),
        identity:{catalogueId:row.id,sourceId:node?.sourceId||null,sourceIds:clone(node?.sourceIds||[]),
          sourceIngredientRefs:clone(refs),sourceAnnotation:text(row.sourceAnnotationText),sourceProcessingNote:text(row.sourceProcessingNote),
          verificationStatus:'catalogue_mapping_requires_actual_material_check',actualMaterialVerified:false},
        workflow:clone(workflow),preparationInstruction:instruction,
        preparationInstructionLabel:instructionLabels[instruction]||'無效指令',
        instructionEvidence:{scope:has(row.preparationInstruction)?'researcher_selection':'unrecorded',verified:false,sourceProcessingNote:text(row.sourceProcessingNote)},
        sourceDoseText:text(row.sourceAnnotationText)};
    });
    const operationValid = base.valid && !operationIssues.length;
    const stage = base.mass.stage;
    const inputMassConfirmed = stage==='processed_dry' && base.mass.gramsComplete;
    const inputMass = {stage,scope:stage==='raw_dry'?'炮製前原料質量，炮製後投入量未知':stage==='processed_dry'?'炮製後乾飲片投入前實錄':'稱量階段待核',
      recordedMass:clone(base.mass),gramsComplete:inputMassConfirmed,totalGrams:inputMassConfirmed?base.mass.totalGrams:null,
      rowGrams:materialEntries.map(row=>({id:row.id,recordedGrams:row.grams??null,inputGrams:stage==='processed_dry'&&Number.isFinite(row.grams)&&row.grams>0?row.grams:null})),
      yield:null,lossGrams:null,converted:false};
    const allIds = materialEntries.map(r=>r.id);
    const groups = Object.fromEntries(Object.keys(instructionLabels).map(key=>[key,materialEntries.filter(r=>r.preparationInstruction===key).map(r=>r.id)]));
    groups.unrecorded.push(...materialEntries.filter(r=>!Object.hasOwn(instructionLabels,r.preparationInstruction)).map(r=>r.id));
    const stations = [
      {id:'materials',label:'原料與來源核對',status:!allIds.length?'empty':operationValid?'record_partial':'invalid',rowIds:allIds,
        actualMaterialVerified:false,note:'核對原名、目錄映射、來源及实际飲片規格。'},
      {id:'weighing',label:stage==='raw_dry'?'原料稱量':stage==='processed_dry'?'成品飲片稱量':'稱量階段核對',status:!allIds.length?'empty':!operationValid?'invalid':base.mass.gramsComplete?'record_complete':base.mass.recordedCount?'record_partial':'record_missing',rowIds:allIds,
        basis:base.basis,mass:clone(base.mass),inputMass:clone(inputMass),researchRatioIsPhysicalMass:false},
      {id:'processing',label:'炮製／飲片規格核對',status:!allIds.length?'empty':!operationValid?'invalid':base.workflows.some(w=>w.sourceSteps.length||w.researcherSteps.length)?'record_partial':'record_missing',rowIds:allIds,
        branches:clone(base.workflows),note:'核對已購成品飲片或所錄炮製；來源未指定不表示必須現場炮製。'},
      {id:'assembly',label:'調劑與投入分組',status:!allIds.length?'empty':!operationValid?'invalid':groups.unrecorded.length?'record_partial':'record_complete',rowIds:allIds,groups:clone(groups),note:'組成集合與研究標註；不宣稱身份或藥性已驗證。'},
      {id:'decoction',label:preparation.method==='decoction'?'煎煮實錄':'製備方式核對',status:preparation.method==='decoction'?recordStatus(['vessel','waterMl','soakMinutes','firstMinutes','temperatureC'],processPlan):preparation.method==='unrecorded'?'record_missing':'not_applicable',rowIds:allIds,
        active:preparation.method==='decoction',parameters:clone(processPlan),note:preparation.method==='decoction'?'只保存研究者實錄；特殊投入另列分支。':'未明確選煎劑時不啟動煎煮；丸、散製法需核對來源。'},
      {id:'filtration',label:'濾取與合液',status:preparation.method==='decoction'?recordStatus(['filtrateMl'],processPlan):'not_applicable',rowIds:allIds,active:preparation.method==='decoction',filtrateMl:processPlan.filtrateMl},
      {id:'record',label:'研究記錄與歸檔',status:recordStatus(['batch','notes'],processPlan),rowIds:allIds}
    ].map(s=>({...s,completed:false,statusMeaning:'record_completeness_only',canExplore:true}));
    const operationTimeline = [];
    const push = (id,label,stationId,rowIds,after=[],extra={}) => {
      const item={id,label,stationId,rowIds:clone(rowIds),after:clone(after),status:'record_missing',completed:false,
        evidenceScope:'researcher_process_plan',parameters:{},...extra};
      operationTimeline.push(item);return id;
    };
    const material = push('inspect','核對原料與來源','materials',allIds,[],{status:stations[0].status});
    let weighing,processing;
    if (stage==='raw_dry') {
      weighing=push('measure','炮製前原料稱量','weighing',allIds,[material],{status:stations[1].status,massScope:inputMass.scope});
      processing=push('process','炮製／成品規格核對','processing',allIds,[weighing],{status:stations[2].status,branches:clone(base.workflows)});
    } else {
      processing=push('process','炮製／成品規格核對','processing',allIds,[material],{status:stations[2].status,branches:clone(base.workflows)});
      weighing=push('measure',stage==='processed_dry'?'飲片投入前稱量':'稱量與階段待核','weighing',allIds,[processing],{status:stations[1].status,massScope:inputMass.scope});
    }
    let beforeAssembly=stage==='raw_dry'?processing:weighing;
    if (stage!=='processed_dry') beforeAssembly=push('input_mass_pending','炮製後投入量待錄','weighing',allIds,[beforeAssembly],{status:'record_missing',inputGrams:null,note:'本次原料克數不能轉作炮製後投入克數。'});
    const assembly=push('assemble','調劑與投入分組','assembly',allIds,[beforeAssembly],{status:stations[3].status,groups:clone(groups),massConfirmed:inputMassConfirmed});
    let recordAfter=[assembly];
    if (preparation.method==='decoction') {
      const main = [...groups.ordinary,...groups.wrapped,...groups.preboil];
      const mainWithLate=[...main,...groups.late_add];
      const soakingRows=[...groups.ordinary,...groups.wrapped];
      const prepareAfter=[assembly];
      if(groups.wrapped.length) prepareAfter.push(push('wrap','包煎材料分裝','assembly',groups.wrapped,[assembly],{equipmentId:'wrap_packet',parameters:{wrappingMaterial:null},verifiedInstruction:false}));
      const vessel=push('prepare_vessel','準備主煎器具','decoction',[],prepareAfter,{equipmentId:'main_vessel',status:has(processPlan.vessel)?'record_complete':'record_missing',parameters:{vessel:processPlan.vessel},note:'準備器具不表示材料已投入。'});
      const water=push('add_water','整段水量實錄／分配待核','decoction',[],[vessel],{status:has(processPlan.waterMl)?'record_partial':'record_missing',parameters:{waterMl:processPlan.waterMl,waterAllocation:'unrecorded'},note:'只記錄整段水量；主鍋、浸泡盆與另煎的各次分配未錄，不重複呈現全量。'});
      let firstAfter=[water];
      if(soakingRows.length) {
        const soak=push('soak','普通／包煎材料浸泡','decoction',soakingRows,[water],{equipmentId:'soaking_basin',status:has(processPlan.soakMinutes)?'record_partial':'record_missing',parameters:{durationMinutes:processPlan.soakMinutes,waterMl:null},note:'獨立浸泡盆；用水分配未錄，尚未加入先煎主鍋。'});
        firstAfter=[soak];
      }
      if(groups.preboil.length) firstAfter.push(push('preboil','先煎分支','decoction',groups.preboil,[water],{equipmentId:'main_vessel',parameters:{durationMinutes:null,temperatureC:null,waterMl:null},verifiedInstruction:false,note:'只投入所選先煎材料；普通與包煎材料留於浸泡盆。'}));
      const first=push('first_decoction','普通／包煎材料加入合煎','decoction',main,firstAfter,{equipmentId:'main_vessel',status:recordStatus(['firstMinutes','temperatureC'],processPlan),parameters:{durationMinutes:null,recordedFirstMinutes:processPlan.firstMinutes,durationScope:'entire_first_decoction_not_this_substep',temperatureC:processPlan.temperatureC},excludedRowIds:[...groups.late_add,...groups.dissolve,...groups.separate,...groups.unrecorded],note:'第一煎分鐘為整段實錄，包含後下分支時不推算後下前後的時間。'});
      let filterAfter=first;
      if(groups.late_add.length) {
        const late=push('late_add','後下材料加入','decoction',groups.late_add,[first],{equipmentId:'main_vessel',parameters:{addAtMinute:null,durationMinutes:null},verifiedInstruction:false});
        filterAfter=push('late_finish','後下後續煎','decoction',mainWithLate,[late],{equipmentId:'main_vessel',parameters:{durationMinutes:null,minutes:null,temperatureC:null},verifiedInstruction:false,note:'後下後仍有續煎工序；時長未錄，不由整段第一煎分鐘拆算。'});
      }
      const filter=push('filter_first','濾取第一煎','filtration',mainWithLate,[filterAfter],{equipmentId:'filter_station',status:has(processPlan.filtrateMl)?'record_partial':'record_missing',parameters:{filtrateMl:processPlan.filtrateMl,filterMaterial:null}});
      const liquidEnds=[filter];
      if(has(processPlan.secondMinutes)) {
        const second=push('second_decoction','二煎實錄','decoction',mainWithLate,[filter],{equipmentId:'main_vessel',status:'record_partial',parameters:{durationMinutes:processPlan.secondMinutes,waterMl:null,temperatureC:null}});
        liquidEnds.push(push('filter_second','濾取第二煎','filtration',mainWithLate,[second],{equipmentId:'filter_station',parameters:{filtrateMl:null,filterMaterial:null}}));
      }
      if(groups.separate.length) {
        const separate=push('separate_decoction','另煎分支','decoction',groups.separate,[assembly],{equipmentId:'separate_vessel',parameters:{vessel:null,waterMl:null,durationMinutes:null,temperatureC:null},verifiedInstruction:false});
        liquidEnds.push(push('filter_separate','另煎濾取','filtration',groups.separate,[separate],{equipmentId:'separate_filter',parameters:{filtrateMl:null,filterMaterial:null}}));
      }
      let end=push('merge_liquids','合液與收集','filtration',mainWithLate.concat(groups.separate),liquidEnds,{equipmentId:'collection_vessel',parameters:{collectedMl:null}});
      if(groups.dissolve.length) end=push('dissolve','烊化分支','filtration',groups.dissolve,[end],{equipmentId:'dissolve_vessel',parameters:{vessel:null,mediumMl:null,temperatureC:null,durationMinutes:null},verifiedInstruction:false,note:'於濾取與合液後獨立呈現；實際介質與條件未錄。'});
      recordAfter=[end];
      if(groups.unrecorded.length) recordAfter.push(push('instruction_pending','投入指令待核','assembly',groups.unrecorded,[assembly],{equipmentId:'holding_tray',note:'未知指令材料不自動倒入主煎器具。'}));
    } else if (['powder','pill','other'].includes(preparation.method)) {
      recordAfter=[push('preparation_review',preparation.method==='pill'?'丸劑製法待核':preparation.method==='powder'?'散劑製法待核':'其他製法待核','decoction',allIds,[assembly],{equipmentId:'preparation_review',note:'核對來源的粉碎、混合、成形等製法；不從名稱生成操作參數。',parameters:{method:preparation.method,notes:preparation.notes}})];
    }
    push('record','研究記錄與歸檔','record',allIds,recordAfter,{status:stations[6].status,parameters:{batch:processPlan.batch,notes:processPlan.notes}});
    const edges=operationTimeline.flatMap(step=>step.after.map(from=>({id:from+'→'+step.id,from,to:step.id,kind:'planned_sequence',physicalCompletion:false})));
    const rowRoutes=materialEntries.map(row=>{
      const instruction=row.preparationInstruction;
      const routes=operationTimeline.filter(step=>step.rowIds.includes(row.id)).map(step=>step.id);
      const destination=preparation.method!=='decoction'?'assembly_tray':instruction==='separate'?'separate_vessel':instruction==='dissolve'?'dissolve_vessel':instruction==='unrecorded'||!Object.hasOwn(instructionLabels,instruction)?'holding_tray':instruction==='wrapped'?'wrap_packet':'main_vessel';
      return {id:row.id,instruction,destination,operationIds:routes,sourceProcessingNote:row.identity.sourceProcessingNote,verifiedInstruction:false,inputGrams:inputMass.rowGrams.find(x=>x.id===row.id)?.inputGrams??null};
    });
    return {...base,version,flowVersion:base.version,operationValid,operationIssues,
      materialEntries,sourceContext:source,origin:clone(options.origin),preparation:{...preparation,explicitlySelected:preparation.method!=='unrecorded',sourceFormHints:source.formHints,sourcePreparationTexts:source.preparationTexts,derivedFromSource:false},
      processPlan,processPlanFields:planFields.slice(),inputMass,stations,operationTimeline,
      operationTopology:{nodes:operationTimeline.map(x=>({id:x.id,stationId:x.stationId,rowIds:clone(x.rowIds),equipmentId:x.equipmentId||null})),edges,orderMeaning:'planned_operation_order_not_completion'},
      operationalScene:{mode:preparation.method==='decoction'?'decoction_workstations':'materials_workstations',preparationMethod:preparation.method,rowRoutes,
        equipment:[...new Set(operationTimeline.map(x=>x.equipmentId).filter(Boolean))],timelineIds:operationTimeline.map(x=>x.id),physicalSimulation:false,
        completedOperationIds:[],massConfirmed:inputMassConfirmed},
      operationLimitations:limitations.slice()};
  }
  return {version,snapshot,normalizePlan,normalizePreparation,defaultPlan,instructionLabels:{...instructionLabels},preparationMethods:methods.slice(),limitations:limitations.slice()};
});
