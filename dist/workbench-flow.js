'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WorkbenchFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const version = 'workbench-flow-1.0';
  const clone = x => x === undefined ? null : Array.isArray(x) ? Array.from(x, clone) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, clone(v)])) : x;
  const text = x => typeof x === 'string' ? x : '';
  const nullableNumber = x => Number.isFinite(x) ? x : null;
  const limit = [
    '動畫表示已選材料、研究權重及所錄工藝的關係；不是分子結構、化學反應、藥效或減毒模擬。',
    '克數未完整時不計全方質量比例；研究份數與克數分開，古籍單位不自動換算。',
    '動畫的播放進度不是實際加工時間；未錄的溫度、時間及媒介保留未知。',
    '工藝實錄不會補入所選炮製分支未記載的性味或功用。'
  ];
  const defaultRecord = () => ({batch: '', stepsNote: '', temperatureC: null, durationMinutes: null, medium: '', equipment: ''});
  function normalizeRecord(record) {
    return {...defaultRecord(), ...clone(record || {})};
  }
  function materialSignature(row) {
    return JSON.stringify({id: row.id, ratio: row.ratio, grams: row.grams ?? null,
      processingId: row.processingId || 'source_unspecified',
      processNotes: text(row.processNotes), sourceProcessingNote: text(row.sourceProcessingNote),
      record: normalizeRecord(row.processRecord)});
  }
  function issue(code, message, severity = 'information', rowId = null) {
    return {code, message, severity, rowId};
  }
  function recordPresent(record) {
    return Object.values(record).some(v => v !== null && v !== undefined && v !== '');
  }
  function parameterRecord(value) {
    const p = value || {};
    return {temperatureC: nullableNumber(p.temperatureC), durationMinutes: nullableNumber(p.durationMinutes),
      batchMassGrams: nullableNumber(p.batchMassGrams), auxiliaryMassGrams: nullableNumber(p.auxiliaryMassGrams)};
  }
  function materialWorkflow(row, resolved) {
    const record = normalizeRecord(row.processRecord);
    const processingId = row.processingId || 'source_unspecified';
    const recorded = recordPresent(record);
    const sourceSteps = Array.from(resolved?.workflow || [], (step, i) => ({
      index: i + 1, label: text(step.label) || '來源步驟未命名', note: text(step.note),
      kind: 'source_workflow', verified: step.verified === true,
      evidenceStatus: text(step.evidenceStatus) || 'unverified_or_unrecorded_process',
      sourceId: text(step.sourceId) || null, evidenceSpan: clone(step.evidenceSpan),
      parameters: parameterRecord(step.parameters)
    }));
    // Research notes remain one verbatim record. Do not split prose into invented operations.
    const researcherSteps = recorded ? [{index: 1, label: '研究者工藝實錄', kind: 'researcher_record',
      note: text(record.stepsNote), verified: false, evidenceStatus: 'unverified_researcher_record',
      sourceId: null, evidenceSpan: null, parameters: {temperatureC: nullableNumber(record.temperatureC),
        durationMinutes: nullableNumber(record.durationMinutes), batchMassGrams: null, auxiliaryMassGrams: null},
      batch: text(record.batch), medium: text(record.medium), equipment: text(record.equipment)}] : [];
    const state = sourceSteps.length ? (sourceSteps.every(s => s.verified) ? 'source_recorded' : 'source_unverified') :
      recorded ? 'researcher_recorded' : processingId === 'source_unspecified' ? 'unspecified' : 'unrecorded';
    return {rowId: row.id, processingId, label: text(resolved?.processingLabel) ||
      (processingId === 'source_unspecified' ? '來源未指定' : '工藝分支待解析'), state,
      sourceAnnotation: text(row.sourceProcessingNote), sourceSteps, researcherSteps, record,
      completeOperationSpecification: false,
      issues: sourceSteps.length || recorded ? [] : [issue('workflow_unrecorded', '此味工藝流程未錄，動畫保留未知。', 'information', row.id)]};
  }
  function snapshot(rows, processingResult, options = {}) {
    const selected = Array.isArray(rows) ? rows.filter(r => r && typeof r.id === 'string').map(clone) : [];
    const basis = options.basis || processingResult?.basis || 'research';
    const issues = [];
    if (!Array.isArray(rows) || selected.length !== rows.length) issues.push(issue('invalid_rows', '材料清單格式無效。', 'error'));
    if (!['research', 'grams'].includes(basis)) issues.push(issue('invalid_basis', '計量依據無效。', 'error'));
    const ids = new Set();
    for (const row of selected) {
      if (ids.has(row.id)) issues.push(issue('duplicate_material', '同一材料不可重複加入。', 'error', row.id));
      ids.add(row.id);
      if (!Number.isInteger(row.ratio) || row.ratio < 1 || row.ratio > 20) issues.push(issue('invalid_ratio', '研究份數須為 1 至 20 的整數。', 'error', row.id));
      if (row.grams !== undefined && row.grams !== null && (!Number.isFinite(row.grams) || row.grams <= 0)) issues.push(issue('invalid_grams', '克數請填正數或留空。', 'error', row.id));
      const r = row.processRecord;
      if (r !== undefined && (!r || typeof r !== 'object' || Array.isArray(r))) issues.push(issue('invalid_process_record', '工藝實錄格式無效。', 'error', row.id));
      else if (r) {
        if (r.temperatureC !== undefined && r.temperatureC !== null && !Number.isFinite(r.temperatureC)) issues.push(issue('invalid_temperature', '實錄溫度須為有限數值。', 'error', row.id));
        if (r.durationMinutes !== undefined && r.durationMinutes !== null && (!Number.isFinite(r.durationMinutes) || r.durationMinutes < 0)) issues.push(issue('invalid_duration', '實錄時間須為有限非負數。', 'error', row.id));
      }
    }
    let resolved = [];
    if (processingResult?.valid === true) {
      const resultRows = processingResult.resolvedRows || [];
      if (resultRows.length === selected.length && selected.every(row => {
        const r = resultRows.find(x => x.id === row.id);
        return r && materialSignature(row) === materialSignature(r);
      }) && processingResult.basis === basis) resolved = resultRows;
      else issues.push(issue('stale_processing_result', '材料或計量依據已更新，請重算工藝結果。', 'error'));
    } else {
      const errs = processingResult?.errors?.length ? processingResult.errors : ['尚未取得有效的工藝解析結果。'];
      issues.push(...errs.map(m => issue('processing_invalid', text(m), 'error')));
    }
    const valid = !issues.some(x => x.severity === 'error');
    const gramRows = selected.filter(x => Number.isFinite(x.grams) && x.grams > 0);
    const missingGrams = selected.filter(x => x.grams === null || x.grams === undefined).map(x => x.id);
    const sumKnown = gramRows.reduce((s, x) => s + x.grams, 0);
    if (!Number.isFinite(sumKnown)) issues.push(issue('mass_overflow', '已錄克數合計超出有限數值範圍。', 'error'));
    const validNow = valid && Number.isFinite(sumKnown);
    const complete = validNow && selected.length > 0 && gramRows.length === selected.length;
    const mass = {knownGrams: gramRows.length && Number.isFinite(sumKnown) ? sumKnown : null,
      recordedCount: gramRows.length, selectedCount: selected.length, missingIds: missingGrams,
      gramsComplete: complete, totalGrams: complete ? sumKnown : null,
      coverage: selected.length ? gramRows.length / selected.length : 0,
      stage: text(options.massContext?.stage) || 'unrecorded', batch: text(options.massContext?.batch), source: text(options.massContext?.source),
      scope: complete ? '全部材料實錄質量' : gramRows.length ? '僅已錄克數的子集' : '質量未錄'};
    const totalRatio = selected.reduce((s, x) => s + (Number.isInteger(x.ratio) ? x.ratio : 0), 0);
    const workflows = selected.map(row => materialWorkflow(row, resolved.find(r => r.id === row.id)));
    const workflowIssues = workflows.flatMap(w => w.issues);
    const warnings = validNow ? clone(processingResult.analysis?.warnings || []) : [];
    const aggregatable = validNow && selected.length > 0 && (basis === 'research' || complete);
    const sceneMode = aggregatable ? basis === 'grams' ? 'mass' : 'research_ratio' : 'equal_schematic';
    const nodes = selected.map((row, index) => {
      const r = resolved.find(x => x.id === row.id);
      const gram = Number.isFinite(row.grams) && row.grams > 0 ? row.grams : null;
      const weightFraction = sceneMode === 'mass' ? gram / mass.totalGrams : sceneMode === 'research_ratio' ? row.ratio / totalRatio : null;
      return {id: row.id, index, name: text(r?.herbName) || row.id, grams: gram, ratio: row.ratio,
        massFraction: complete ? gram / mass.totalGrams : null, weightFraction,
        weightBasis: sceneMode, processingId: row.processingId || 'source_unspecified',
        processingLabel: text(r?.processingLabel) || '工藝未解析', role: text(row.role) || '未標註',
        attributes: r ? clone(r.attributes) : null, attributeStatus: r ? clone(r.attributeStatus) : null,
        sourceId: text(r?.sourceId) || null, sourceIds: clone(r?.sourceIds || []),
        workflow: workflows[index], warnings: warnings.filter(w => w.herbId === row.id || w.a === row.id || w.b === row.id),
        // Layout is a stable circle; transforms or playback are view controls, not medicine physics.
        angle: selected.length ? index / selected.length * Math.PI * 2 : 0};
    });
    const relationships = nodes.map(n => ({id: `structure:${n.id}`, from: n.id, to: 'formula', kind: 'composition',
      label: '已選成分', evidenceScope: 'researcher_selection'}));
    warnings.filter(w => w.type === 'compatibility' && ids.has(w.a) && ids.has(w.b)).forEach((w, index) =>
      relationships.push({id: `source-warning:${index}`, from: w.a, to: w.b, kind: 'source_warning',
        label: '文獻配伍警示', evidenceScope: 'classical_source', references: clone(w.references || [])}));
    const steps = [
      {id: 'materials', index: 0, label: '選原料', status: !selected.length ? 'empty' : validNow ? 'ready' : 'invalid',
        issues: !selected.length ? [issue('no_materials', '先選擇材料，或載入已錄原方。')] : issues.filter(i => ['invalid_rows', 'duplicate_material', 'processing_invalid'].includes(i.code))},
      {id: 'quantity', index: 1, label: '確定量', status: !selected.length ? 'empty' : !validNow ? 'invalid' : basis === 'research' || complete ? 'ready' : 'partial',
        issues: missingGrams.length ? [issue('missing_grams', basis === 'grams' ? '尚有克數未錄；可查看等大小示意，但不能按全方質量模擬。' : '目前按研究份數比較；克數尚未完整記錄。')] : []},
      {id: 'process', index: 2, label: '工藝流程', status: !selected.length ? 'empty' : !validNow ? 'invalid' : workflowIssues.length ? 'partial' : 'ready',
        issues: workflowIssues},
      {id: 'structure', index: 3, label: '動態結構', status: !selected.length ? 'empty' : aggregatable ? 'ready' : validNow ? 'partial' : 'invalid',
        issues: aggregatable ? [] : [issue('schematic_only', '目前可探索材料結構示意；全方加權分析尚未完整。')]}
    ].map(step => ({...step, ready: step.status === 'ready', canExplore: true}));
    const next = steps.find(s => !s.ready)?.index ?? 3;
    const timeline = [
      {id: 'inspect', label: '檢視原料', stageIndex: 0, rowIds: nodes.map(n => n.id), status: steps[0].status},
      {id: 'measure', label: '稱量／記錄份數', stageIndex: 1, rowIds: nodes.map(n => n.id), status: steps[1].status,
        basis, mass, ratioTotal: basis === 'research' && validNow ? totalRatio : null},
      {id: 'process', label: '各味工藝', stageIndex: 2, rowIds: nodes.map(n => n.id), status: steps[2].status, branches: workflows},
      {id: 'combine', label: '配伍組合', stageIndex: 3, rowIds: nodes.map(n => n.id), status: steps[3].status,
        note: '節點聚合僅示意成分關係，未模擬化學反應。'},
      {id: 'result', label: '文獻輪廓', stageIndex: 3, rowIds: nodes.map(n => n.id), status: steps[3].status,
        analysisAvailable: aggregatable, quantAvailable: aggregatable && !!processingResult.quant}
    ];
    return {version, title: text(options.name) || '配伍研究', valid: validNow, basis, issues,
      steps, navigation: {available: [0, 1, 2, 3], recommended: next}, mass, workflows, timeline,
      scene: {mode: sceneMode, canExplore: true, animationMeaning: '材料與工藝流程的示意變化',
        weightMeaning: sceneMode === 'mass' ? '全部已錄質量占比' : sceneMode === 'research_ratio' ? '相對研究份數占比' : '等大小材料示意，權重未知',
        nodes, relationships, center: {id: 'formula', name: text(options.name) || '配伍研究'},
        warnings, analysisAvailable: aggregatable, quant: aggregatable ? clone(processingResult.quant) : null},
      limitations: limit.slice()};
  }
  return {version, snapshot, normalizeRecord, limitations: limit.slice()};
});
