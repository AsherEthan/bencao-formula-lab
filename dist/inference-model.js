'use strict';
(function (root) {
  const version = 'source-element-inference-1.2';
  const dictionaryVersion = 'indication-topic-silver-2026-10-04';
  // These are literal topics in historical indications, not pharmacological effects.
  const dictionary = [
    { id: 'deficiency', label: '虛弱／不足語彙', terms: ['虛弱', '虛損', '虛勞', '不足', '氣虛', '血虛', '陰虛', '陽虛', '虛羸', '羸瘦', '少氣', '乏力', '倦怠'] },
    { id: 'cold', label: '寒／冷語彙', terms: ['惡寒', '畏寒', '風寒', '寒冷', '虛冷', '冷痛', '寒疝', '厥冷', '身冷', '手足冷', '寒氣', '寒濕', '寒熱往來'] },
    { id: 'heat', label: '熱／火語彙', terms: ['發熱', '身熱', '熱病', '煩熱', '壯熱', '潮熱', '熱毒', '積熱', '大熱', '內熱', '火熱', '暑熱', '惡熱', '寒熱往來'] },
    { id: 'phlegm', label: '痰／飲語彙', terms: ['痰飲', '痰涎', '痰濕', '痰熱', '痰氣', '痰嗽', '痰逆', '留飲', '支飲', '懸飲', '溢飲', '水飲'] },
    { id: 'water', label: '水／濕語彙', terms: ['水腫', '浮腫', '水氣', '小便不利', '小便難', '小便澀', '濕氣', '濕痹', '濕熱', '寒濕', '水飲'] },
    { id: 'blood', label: '血相關語彙', terms: ['血虛', '瘀血', '蓄血', '吐血', '衄血', '下血', '便血', '失血', '血崩', '血痢', '血閉', '惡血'] },
    { id: 'qi_flow', label: '氣行／脹滿語彙', terms: ['氣滯', '氣逆', '上氣', '氣結', '氣痞', '氣脹', '腹脹', '脹滿', '胸滿', '胸脅滿', '胸脅苦滿'] },
    { id: 'diarrhea', label: '泄／利語彙', terms: ['泄瀉', '洩瀉', '下利', '下痢', '瀉痢', '泄利', '飧泄', '溏泄', '便溏', '久瀉', '痢疾'] },
    { id: 'cough', label: '咳／喘語彙', terms: ['咳嗽', '咳逆', '咳喘', '咳而', '咳唾', '喘息', '喘滿', '喘急', '短氣', '痰嗽'] },
    { id: 'pain', label: '痛語彙', terms: ['頭痛', '腹痛', '心痛', '胸痛', '脅痛', '腰痛', '骨節疼', '身疼', '疼痛', '絞痛', '冷痛'] },
    { id: 'vomit', label: '嘔／吐語彙', terms: ['嘔吐', '嘔逆', '乾嘔', '吐利', '嘔而', '喜嘔', '吐食', '嘔噦', '反胃'] },
    { id: 'sores', label: '瘡／腫語彙', terms: ['癰腫', '瘡瘍', '惡瘡', '腫毒', '癰疽', '瘰癧', '疔瘡', '乳癰'] },
    { id: 'spirit', label: '神志／睡眠語彙', terms: ['心悸', '怔忡', '驚悸', '不眠', '不得眠', '失眠', '譫語', '神昏', '煩躁', '驚狂', '癲狂'] },
    { id: 'tonify_terms', label: '補／益功用原詞', terms: ['補氣', '益氣', '補中', '補血', '養血', '滋陰', '養陰', '補虛', '補諸虛', '強筋'] },
    { id: 'clear_terms', label: '清／瀉功用原詞', terms: ['清熱', '瀉火', '瀉熱', '清火', '涼血', '清心', '解毒'] },
    { id: 'warm_terms', label: '溫／散功用原詞', terms: ['散寒', '溫中', '回陽', '祛寒', '解肌', '發表', '溫胃'] }
  ];
  const defaults = { alpha: 1, minTrainRecords: 30, minTrainGroups: 8, minLabelPositive: 5,
    minLabelNegative: 5, minLabelPositiveGroups: 3, minLabelNegativeGroups: 3,
    minElementSupport: 3, minElementGroups: 3, minQueryTextCoverage: .8, minQuerySupportedCoverage: .5,
    threshold: .5, familySimilarity: .8, minFamilyShared: 3, folds: 5 };
  const limitations = [
    '輸出描述成分原名與主治銀詞標記的語料關聯，並非單味真實藥性、人體療效、安全或因果。',
    '銀標籤來自公開詞典規則；未命中只表示原文未被此規則標記，不代表無此功效或病證。',
    '原名文本元素可包含礦物、動物及未入本草目錄者；現代基原與物種身份未核定。',
    '元素共現、方族、作者、時代、炮製與未使用的原方量可能混雜；平滑不能創造獨立證據。',
    'presence 模型忽略實際劑量與煎服，不能還原原方曝露，也不提供服用比例。',
    '來源的主治措辭、條件與否定僅用保守詞規則；自動銀標籤仍可能漏標或誤標。',
    '三書正文次序截取的來源樣本並非隨機樣本；來源外推與分數校準未獲證實。',
    '方族為同名與成分近似的防洩漏代理分組，未完成全部歷史方族譜系校訂。'
  ];
  const clone = x => JSON.parse(JSON.stringify(x));
  const normal = s => String(s || '').normalize('NFC').replace(/\s+/g, '');
  const unique = a => [...new Set(a)];
  function hash(text) { let h = 2166136261; for (const c of String(text)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }
  function config(input = {}) {
    const c = { ...defaults, ...input };
    for (const key of ['minTrainRecords', 'minTrainGroups', 'minLabelPositive', 'minLabelNegative', 'minLabelPositiveGroups', 'minLabelNegativeGroups', 'minElementSupport', 'minElementGroups', 'minFamilyShared', 'folds']) {
      if (!Number.isInteger(c[key]) || c[key] < 1) throw new Error('研究樣本門檻須為正整數：' + key);
    }
    for (const key of ['minQueryTextCoverage', 'minQuerySupportedCoverage', 'threshold', 'familySimilarity']) {
      if (!Number.isFinite(c[key]) || c[key] < 0 || c[key] > 1) throw new Error('研究比例設定須在 0 至 1：' + key);
    }
    if (!Number.isFinite(c.alpha) || c.alpha <= 0) throw new Error('平滑參數須大於 0。');
    return c;
  }
  function spanStatus(e, sourceIds, sourceTexts) {
    const s = e && (e.evidenceSpan || e);
    if (!e || !s || !sourceIds.has(e.sourceId) || typeof e.text !== 'string' || !e.text || s.text !== e.text ||
      s.offsetUnit !== 'unicode_code_point' || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 ||
      s.end - s.start !== [...e.text].length || !['sourcePlainText', 'rawText'].includes(s.basis)) return 'invalid';
    const full = sourceTexts && (sourceTexts[s.file] || sourceTexts[e.sourceId]);
    if (typeof full === 'string') return [...full].slice(s.start, s.end).join('') === e.text ? 'verified_snapshot' : 'invalid';
    return 'linked_span_not_runtime_verified';
  }
  function matches(text, term) {
    const found = []; let at = text.indexOf(term);
    while (at >= 0) {
      // Conservative lexical scope, not a semantic negation parser. Explicit
      // contrast boundaries stop an earlier symptom's negation propagating.
      const before = text.slice(Math.max(0, at - 8), at).split(/[，,。；;：:！？!?而但則]/).pop();
      const negated = /(?:不|非|忌|禁|莫|勿|無|无|未)/.test(before);
      found.push({ at, term, negated }); at = text.indexOf(term, at + term.length);
    }
    return found;
  }
  function silverLabels(formula, sources = [], sourceTexts = {}) {
    const sourceIds = new Set(sources.map(s => s.id));
    const evidence = [], rejected = [];
    for (const e of formula.profileEvidence || []) {
      // A name, dosing instruction or a supplied label is never target evidence.
      if (e.assertionKind !== 'indication') { rejected.push({ reason: '未獨立標明主治片段', text: e.text }); continue; }
      const status = spanStatus(e, sourceIds, sourceTexts);
      if (status === 'invalid') { rejected.push({ reason: '主治原文位置無效或缺來源', text: e.text }); continue; }
      let text = e.text, span = clone(e.evidenceSpan);
      const name = String(formula.name || '');
      // A target formula's name cannot manufacture a topic label. For an
      // explicitly named prescription clause, retain only its preceding text.
      const targetAt = name ? text.indexOf(name + '主之') : -1;
      const targetAlsoAt = name ? text.indexOf(name + '亦主之') : -1;
      const at = targetAt >= 0 ? targetAt : targetAlsoAt;
      if (e.extractionMethod === 'explicit_named_target_clause') {
        if (at < 0 || /主之/.test(text.slice(0, at))) { rejected.push({ reason: '主治句未能唯一歸此方；多方分支不得整段入標', text: e.text }); continue; }
        text = text.slice(0, at).replace(/[，,\s]+$/, '');
        span.text = text; span.end = span.start + [...text].length;
      }
      if (!text || /(?:不可服|不得服|不宜服|禁服|服之則)/.test(text)) { rejected.push({ reason: '禁服或服後反應語境未分離；不作正主治標籤', text: e.text }); continue; }
      // Other extraction methods must not retain a named prescription clause.
      if (e.extractionMethod !== 'explicit_named_target_clause' && /(?:湯|丸|散|飲|膏|丹)(?:亦)?主之/.test(text)) { rejected.push({ reason: '含命名主方分支但未標明目標句', text: e.text }); continue; }
      evidence.push({ ...clone(e), text, evidenceSpan: span, originalEvidenceSpan: clone(e.evidenceSpan),
        labelInputPolicy: at >= 0 ? '去除此方名稱與主之及其後文；前文原位子跨度' : '獨立主治原位片段', spanStatus: status });
    }
    const labels = dictionary.map(d => {
      const hits = [], negated = [];
      for (const e of evidence) for (const term of d.terms) for (const m of matches(e.text, term)) {
        const name = String(formula.name || '');
        if (name) { let at = e.text.indexOf(name), inName = false;
          while (at >= 0) { if (m.at >= at && m.at < at + name.length) inName = true; at = e.text.indexOf(name, at + name.length); }
          if (inName) continue;
        }
        const start = e.evidenceSpan.start + [...e.text.slice(0, m.at)].length;
        const hit = { term, text: e.text, sourceId: e.sourceId, sourceSpan: clone(e.evidenceSpan),
          termSpan: { start, end: start + [...term].length, offsetUnit: 'unicode_code_point' }, spanStatus: e.spanStatus };
        (m.negated ? negated : hits).push(hit);
      }
      return { id: d.id, label: d.label, present: hits.length > 0, hits, negated };
    });
    return { dictionaryVersion, labels, labelIds: labels.filter(x => x.present).map(x => x.id), evidence, rejected,
      eligible: evidence.length > 0 && rejected.length === 0, status: evidence.length && !rejected.length ? '原文規則銀標籤；非人工 gold' : '主治來源或目標語境未完整核定；不作訓練',
      negationPolicy: '前八字內保守否定詞規則，句讀及而／但／則截斷；非語義解析，可能漏標或誤標。',
      unmatchedMeaning: '未命中此詞典規則；非臨床陰性' };
  }
  function jac(a, b) { const A = new Set(a), B = new Set(b), U = new Set([...A, ...B]); return U.size ? [...A].filter(x => B.has(x)).length / U.size : 0; }
  function elementsOf(f, registry, sourceIds, sourceTexts) {
    const core = (f.ingredientRefs || []).filter(r => r && r.scope === 'core');
    const elementIds = [], features = [], unknown = [], refs = []; let catalogMapped = 0, traced = 0;
    for (const r of core) {
      const name = normal(r.sourceName);
      const elementId = r.sourceElementId || (name ? 'literal-' + hash(name) : null);
      const registered = elementId && registry.get(elementId);
      const ev = r.nameSpan || r.evidenceSpan;
      const quoted = ev && typeof ev.text === 'string' && normal(ev.text).includes(name);
      const status = ev ? spanStatus({ text: ev.text, sourceId: f.sourceId, evidenceSpan: ev }, sourceIds, sourceTexts) : 'invalid';
      const valid = !!(name && elementId && quoted && status !== 'invalid' && (!registered || normal(registered.sourceName || registered.name) === name));
      if (!valid) { unknown.push({ sourceName: r.sourceName || '', reason: '原名解析或原文位置未完成', sourceElementId: elementId }); continue; }
      if (!registry.has(elementId)) registry.set(elementId, { id: elementId, name: r.sourceName, sourceName: r.sourceName,
        catalogHerbId: r.catalogHerbId || r.id || null, mappingStatus: 'exact_text', modernIdentity: '未核定' });
      traced++; if (r.catalogHerbId || r.id) catalogMapped++;
      elementIds.push(elementId); features.push('element:' + elementId);
      const tokens = [];
      const annotation = String(r.annotationText || '');
      // Processing tokens require an annotation and a linked ingredient span.
      const fullSpan = r.evidenceSpan;
      const fullStatus = fullSpan ? spanStatus({ text: fullSpan.text, sourceId: f.sourceId, evidenceSpan: fullSpan }, sourceIds, sourceTexts) : 'invalid';
      if (annotation && fullStatus !== 'invalid' && String(fullSpan.text).includes(annotation)) {
        for (const token of ['炙', '炒', '煨', '煅', '炮', '蒸', '生用', '酒浸', '酒洗', '醋煮', '去皮', '去心', '去核']) {
          if (annotation.includes(token)) { features.push('processing:' + elementId + ':' + token); tokens.push(token); }
        }
      }
      refs.push({ sourceElementId: elementId, sourceName: r.sourceName, catalogHerbId: r.catalogHerbId || r.id || null,
        preparation: r.preparation || '', processingTokens: tokens, evidenceSpan: clone(ev), spanStatus: status, modernIdentity: '未核定' });
    }
    const fragments = (f.unparsedIngredientFragments || []).filter(Boolean);
    for (const fragment of fragments) unknown.push({ sourceName: typeof fragment === 'string' ? fragment : fragment.text || '', reason: '未解析成分片段' });
    const declared = Number.isInteger(f.declaredIngredientCount) && f.declaredIngredientCount > 0 ? f.declaredIngredientCount : 0;
    const denominator = Math.max(core.length + fragments.length, declared);
    const complete = denominator > 0 && !unknown.length && traced === denominator && f.ingredientParsingComplete !== false;
    return { elementIds: unique(elementIds).sort(), features: unique(features).sort(), refs, unknown,
      textElementCoverage: denominator ? traced / denominator : 0, catalogMappingCoverage: denominator ? catalogMapped / denominator : 0,
      denominator, parsedCoreReferences: traced, complete, declaredCount: declared || null,
      scope: '核心成分；原名文本元素二值 presence，原方量與研究份數不入模型' };
  }
  function groupRecords(records, c) {
    const parent = records.map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const join = (a, b) => { const A = find(a), B = find(b); if (A !== B) parent[Math.max(A, B)] = Math.min(A, B); };
    const keys = new Map();
    records.forEach((r, i) => {
      const entries = ['composition:' + r.compositionKey];
      if (r.familyId) entries.push('family:' + r.familyId);
      if (r.dedupGroupId) entries.push('duplicate:' + r.dedupGroupId);
      for (const key of r.contextGroupKeys || []) entries.push('context:' + key);
      for (const key of entries) { if (key.endsWith(':')) continue; if (keys.has(key)) join(i, keys.get(key)); else keys.set(key, i); }
    });
    for (let i = 0; i < records.length; i++) for (let j = i + 1; j < records.length; j++) {
      const a = records[i].composition.elementIds, b = records[j].composition.elementIds;
      const shared = a.filter(x => b.includes(x)).length;
      if (shared >= c.minFamilyShared && jac(a, b) >= c.familySimilarity) join(i, j);
    }
    const groups = new Map(); records.forEach((r, i) => { const key = find(i); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
    for (const members of groups.values()) { const id = 'group-' + hash(members.map(r => r.id).sort().join('|')); for (const r of members) r.groupId = id; }
  }
  function prepare(data, corpus, options = {}) {
    const c = config(options), input = corpus || data;
    const sources = unique([...(data.sources || []), ...(input.sources || [])].map(s => s.id)).map(id => [...(input.sources || []), ...(data.sources || [])].find(s => s.id === id));
    const sourceIds = new Set(sources.map(s => s.id)), registry = new Map((input.sourceElements || []).map(e => [e.id, clone(e)]));
    const texts = input.sourceTexts || {};
    const records = [], seenIds = new Set();
    for (const f of input.formulas || []) {
      if (!f || typeof f.id !== 'string' || !f.id || seenIds.has(f.id)) continue;
      seenIds.add(f.id);
      const composition = elementsOf(f, registry, sourceIds, texts), silver = silverLabels(f, sources, texts);
      // Shared source context is dependency metadata for splitting only. It is
      // never used to label a target or predict a query. This captures explicit
      // small add/remove branches missed by ingredient Jaccard thresholds.
      const contextGroupKeys = unique((f.indicationContextEvidence || []).filter(e =>
        e.assertionKind === 'indication_context_not_label_input' && spanStatus(e, sourceIds, texts) !== 'invalid').map(e =>
        e.sourceId + ':' + e.evidenceSpan.start + ':' + e.evidenceSpan.end));
      const reasons = []; if (!composition.complete) reasons.push('核心元素文本解析未完成'); if (!silver.eligible) reasons.push('主治來源或目標語境未完整核定');
      records.push({ id: f.id, name: f.name || f.id, sourceId: f.sourceId, sourceBook: f.sourceBook || sources.find(s => s.id === f.sourceId)?.title || '來源書未錄',
        sourceURL: f.sourceURL || sources.find(s => s.id === f.sourceId)?.url || null, sourceChapter: f.sourceChapter || '',
        sourceEdition: f.sourceEdition || '', familyId: f.familyId || null, dedupGroupId: f.dedupGroupId || f.duplicateGroupId || null,
        contextGroupKeys,
        reviewStatus: f.reviewStatus || '未錄審核狀態', rawIndications: f.rawIndications || silver.evidence.map(e => e.text).join('；'),
        rawIngredientText: f.rawIngredientText || '', composition, silver, eligible: reasons.length === 0, exclusionReasons: reasons,
        compositionKey: composition.elementIds.join('|'), groupId: null, duplicateOf: null });
    }
    // Copies with the same inputs and same indication text count once. Different
    // indication texts with identical ingredients share a fold but retain conflict.
    const copies = new Map();
    for (const r of records) if (r.eligible) {
      const key = r.composition.features.join('|') + '\n' + r.silver.evidence.map(e => normal(e.text)).sort().join('|');
      if (copies.has(key)) { r.duplicateOf = copies.get(key); r.eligible = false; r.exclusionReasons.push('相同元素／加工與主治原文重複'); } else copies.set(key, r.id);
    }
    groupRecords(records, c);
    return { version, dictionaryVersion, config: c, sources, elements: [...registry.values()], records,
      summary: { records: records.length, eligible: records.filter(r => r.eligible).length,
        groups: unique(records.filter(r => r.eligible).map(r => r.groupId)).length, duplicates: records.filter(r => r.duplicateOf).length,
        excluded: records.filter(r => !r.eligible).map(r => ({ id: r.id, reasons: r.exclusionReasons })),
        labelSource: '凍結主治原文詞典的自動銀標籤；非人工 gold', modernIdentity: '未核定' },
      inputPolicy: '僅核心原名文本元素 presence 與可核加工註記；方名、主治、書名、年代和銀標籤不進入輸入特徵',
      limitations: clone(limitations) };
  }
  function learn(records, c) {
    const eligible = records.filter(r => r.eligible), N = eligible.length, groupCount = unique(eligible.map(r => r.groupId)).length;
    const reasons = []; if (N < c.minTrainRecords) reasons.push('訓練記錄不足 ' + c.minTrainRecords); if (groupCount < c.minTrainGroups) reasons.push('防洩漏分組不足 ' + c.minTrainGroups);
    const featureSets = eligible.map(r => new Set(r.composition.features));
    const featureIds = unique(eligible.flatMap(r => r.composition.features)).sort();
    const featureInfo = featureIds.map(id => { const rows = eligible.map((r, i) => featureSets[i].has(id) ? i : -1).filter(i => i >= 0);
      return { id, rows, groupSupport: unique(rows.map(i => eligible[i].groupId)).length }; });
    // Perfectly co-occurring columns are one evidence bundle, not two independent votes.
    const bundles = new Map();
    for (const f of featureInfo) if (f.rows.length >= c.minElementSupport && f.groupSupport >= c.minElementGroups) {
      const key = f.rows.join(','); if (!bundles.has(key)) bundles.set(key, { id: f.id, featureIds: [], rows: f.rows, support: f.rows.length, groupSupport: f.groupSupport }); bundles.get(key).featureIds.push(f.id);
    }
    const fittedLabels = dictionary.map(d => {
      const positive = eligible.map((r, i) => r.silver.labelIds.includes(d.id) ? i : -1).filter(i => i >= 0);
      const P = new Set(positive), nPositive = positive.length, nNegative = N - nPositive;
      const positiveGroups = unique(positive.map(i => eligible[i].groupId)).length;
      const negativeGroups = unique(eligible.filter((r, i) => !P.has(i)).map(r => r.groupId)).length;
      const supported = !reasons.length && nPositive >= c.minLabelPositive && nNegative >= c.minLabelNegative && positiveGroups >= c.minLabelPositiveGroups && negativeGroups >= c.minLabelNegativeGroups;
      const prior = (nPositive + c.alpha) / (N + 2 * c.alpha);
      const terms = [...bundles.values()].map(b => {
        const n11 = b.rows.filter(i => P.has(i)).length, n10 = b.support - n11, n01 = nPositive - n11, n00 = nNegative - n10;
        const presentGivenHit = (n11 + c.alpha) / (nPositive + 2 * c.alpha), presentGivenNoHit = (n10 + c.alpha) / (nNegative + 2 * c.alpha);
        return { bundleId: b.id, featureIds: b.featureIds, support: b.support, groupSupport: b.groupSupport, n11, n10, n01, n00,
          logRatio: Math.log(presentGivenHit / presentGivenNoHit), presentGivenHit, presentGivenNoHit };
      });
      return { id: d.id, label: d.label, supported, nPositive, nNegative, positiveGroups, negativeGroups, prior, terms,
        unsupportedReason: supported ? null : '記錄／分組或此銀詞的命中／未命中樣本不足' };
    });
    return { N, groupCount, ready: reasons.length === 0 && fittedLabels.some(x => x.supported), reasons: reasons.length ? reasons : fittedLabels.some(x => x.supported) ? [] : ['沒有支持足夠的銀詞目標'], labels: fittedLabels,
      featureBundles: [...bundles.values()].map(b => ({ id: b.id, featureIds: b.featureIds, support: b.support, groupSupport: b.groupSupport })), trainIds: eligible.map(r => r.id) };
  }
  function fit(data, corpus, options = {}) {
    const prepared = prepare(data, corpus, options);
    const training = learn(prepared.records, prepared.config);
    const catalog = (data.herbs || []).map(h => ({ id: h.id, name: h.name }));
    return { ...prepared, catalog, dictionary: clone(dictionary), training, validation: null,
      status: training.ready ? '可作來源銀詞關聯推估' : '樣本不足；停止推估', frozenParameters: true };
  }
  function queryOf(model, query) {
    if (query && !Array.isArray(query) && query.formulaId) {
      const r = model.records.find(r => r.id === query.formulaId); if (!r) throw new Error('方劑記錄未收錄。');
      return { ...clone(r.composition), formulaId: r.id, groupId: r.groupId };
    }
    const rows = Array.isArray(query) ? query : query?.ingredientRefs || query?.elements || [];
    if (!Array.isArray(rows)) throw new Error('元素輸入須為清單。');
    const known = [], unknown = [], refs = []; let mapped = 0;
    for (const raw of rows) {
      const r = typeof raw === 'string' ? { id: raw } : raw;
      if (!r || typeof r !== 'object') { unknown.push({ sourceName: '', reason: '元素格式無效' }); continue; }
      let e = model.elements.find(e => e.id === (r.sourceElementId || r.elementId || r.id));
      if (!e && r.sourceName) { const candidates = model.elements.filter(e => normal(e.sourceName || e.name) === normal(r.sourceName)); if (candidates.length === 1) e = candidates[0]; }
      if (!e && r.id) {
        const h = model.catalog.find(h => h.id === r.id);
        const candidates = model.elements.filter(e => e.catalogHerbId === r.id);
        const exact = h && candidates.filter(e => normal(e.sourceName || e.name) === normal(h.name));
        if (exact?.length === 1) e = exact[0]; else if (candidates.length === 1) e = candidates[0];
      }
      if (!e) { unknown.push({ sourceName: r.sourceName || r.id || '', reason: '原名元素未收錄或目錄映射不唯一' }); continue; }
      known.push(e.id); if (e.catalogHerbId) mapped++;
      refs.push({ sourceElementId: e.id, sourceName: e.sourceName || e.name, catalogHerbId: e.catalogHerbId || null, modernIdentity: '未核定' });
    }
    const ids = unique(known).sort(), denominator = ids.length + unknown.length;
    return { elementIds: ids, features: ids.map(id => 'element:' + id), refs, unknown,
      textElementCoverage: denominator ? ids.length / denominator : 0,
      catalogMappingCoverage: denominator ? unique(refs.filter(r => r.catalogHerbId).map(r => r.sourceElementId)).length / denominator : 0,
      complete: denominator > 0 && !unknown.length, denominator, formulaId: null, groupId: null,
      scope: '自選元素 presence；份數和未經原文核對的加工指示不入模型' };
  }
  function trainingSubset(model, q, options = {}) {
    const excluded = new Set();
    const formulaId = options.excludeFormulaId || q?.formulaId;
    if (formulaId) { const r = model.records.find(r => r.id === formulaId); if (!r) throw new Error('要排除的方劑未收錄。'); excluded.add(r.groupId); }
    if (q && q.complete && q.elementIds.length) {
      const key = q.elementIds.slice().sort().join('|'); for (const r of model.records) if (r.compositionKey === key) excluded.add(r.groupId);
    }
    const records = model.records.filter(r => !excluded.has(r.groupId));
    return { records, training: learn(records, model.config), excludedGroupIds: [...excluded].sort(),
      excludedFormulaIds: model.records.filter(r => excluded.has(r.groupId)).map(r => r.id), scope: '重新計數時排除查詢方同族及同成分代理組；詞典與參數保持凍結' };
  }
  function scoreLabel(label, features) {
    const contributions = label.terms.filter(t => t.featureIds.some(id => features.has(id)));
    const logOdds = Math.log(label.prior / (1 - label.prior)) + contributions.reduce((s, t) => s + t.logRatio, 0);
    const score = 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, logOdds))));
    return { score, contributions: contributions.slice().sort((a, b) => Math.abs(b.logRatio) - Math.abs(a.logRatio)) };
  }
  function nearest(records, q, limit = 5) {
    if (!Number.isInteger(limit) || limit < 0 || limit > 30) throw new Error('近似案例數須為 0 至 30 的整數。');
    return records.filter(r => r.eligible && r.composition.elementIds.length).map(r => {
      const shared = q.elementIds.filter(id => r.composition.elementIds.includes(id));
      const union = new Set([...q.elementIds, ...r.composition.elementIds]).size + r.composition.unknown.length + q.unknown.length;
      return { id: r.id, name: r.name, sourceId: r.sourceId, sourceBook: r.sourceBook, sourceURL: r.sourceURL,
        similarity: union ? shared.length / union : 0, sharedElementIds: shared, textElementCoverage: r.composition.textElementCoverage,
        catalogMappingCoverage: r.composition.catalogMappingCoverage, rawIndications: r.rawIndications,
        profileEvidence: r.silver.evidence, silverLabelIds: r.silver.labelIds, groupId: r.groupId, eligibleForTraining: r.eligible,
        isQueryOrSameComposition: r.id === q.formulaId || (q.complete && q.elementIds.join('|') === r.compositionKey),
        reviewStatus: r.reviewStatus, kind: '已排除查詢同族的訓練近似案例；非獨立臨床證據' };
    }).filter(r => r.similarity > 0).sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id)).slice(0, limit);
  }
  function predict(model, query, options = {}) {
    const q = queryOf(model, query), subset = trainingSubset(model, q, options), training = subset.training;
    const features = new Set(q.features), supported = new Set(training.featureBundles.flatMap(b => b.featureIds));
    const supportedElements = q.elementIds.filter(id => supported.has('element:' + id));
    const supportedCoverage = q.denominator ? supportedElements.length / q.denominator : 0;
    const reasons = [...training.reasons];
    if (!q.elementIds.length) reasons.push('沒有可解析的原名文本元素');
    if (q.textElementCoverage < model.config.minQueryTextCoverage) reasons.push('查詢文本元素涵蓋不足');
    if (supportedCoverage < model.config.minQuerySupportedCoverage) reasons.push('訓練語料中有支持的查詢元素不足');
    const abstained = reasons.length > 0;
    const terms = abstained ? [] : training.labels.filter(l => l.supported).map(l => {
      const scored = scoreLabel(l, features);
      return { id: l.id, label: l.label, associationScore: scored.score, baselineScore: l.prior,
        predicted: scored.score >= model.config.threshold, threshold: model.config.threshold,
        support: { records: training.N, groups: training.groupCount, ruleHit: l.nPositive, ruleNotHit: l.nNegative,
          ruleHitGroups: l.positiveGroups, ruleNotHitGroups: l.negativeGroups }, contributions: scored.contributions,
        scoreMeaning: 'presence-only 條件關聯模型指標；非臨床功效概率' };
    }).sort((a, b) => b.associationScore - a.associationScore || a.id.localeCompare(b.id));
    return { version, dictionaryVersion, status: abstained ? '停止推估：支持或資料不足' : '主治銀詞的描述性推估', abstained, reasons: unique(reasons),
      textElementCoverage: q.textElementCoverage, catalogMappingCoverage: q.catalogMappingCoverage,
      supportedElementCoverage: supportedCoverage, unknownElements: q.unknown, elements: q.refs, terms,
      queryFeatureScope: q.scope,
      processingEvidence: { features: q.features.filter(id => id.startsWith('processing:')),
        status: q.formulaId ? '只採用此方來源跨度可定位的炮製詞；未載不等於未炮製' : '工作台未核炮製詞，不作缺席或未炮製證據',
        unknownIsNotNegative: true },
      unsupportedTargets: training.labels.filter(l => !l.supported).map(l => ({ id: l.id, label: l.label, reason: l.unsupportedReason, ruleHit: l.nPositive, ruleNotHit: l.nNegative })),
      nearestCases: nearest(subset.records, q, options.nearestLimit ?? 5),
      trainingSubset: { records: training.N, groups: training.groupCount, excludedGroupIds: subset.excludedGroupIds,
        excludedFormulaIds: subset.excludedFormulaIds, scope: subset.scope },
      validation: null, limitations: clone(limitations) };
  }
  function elementAssociations(model, element, options = {}) {
    const q = queryOf(model, [{ sourceElementId: element, id: element }]);
    const id = q.elementIds[0];
    if (!id) return { status: '原名元素未解析', element: null, support: 0, associations: [], notes: ['目錄身份可能有多個古籍原名，不能任選合併。'] };
    // Unlike a formula query, one element's entire occurrence set is not excluded.
    const subset = trainingSubset(model, null, options), rows = subset.records.filter(r => r.eligible), N = rows.length;
    const key = 'element:' + id, present = rows.filter(r => r.composition.features.includes(key)), nElement = present.length;
    const elementPresentGroups = unique(present.map(r => r.groupId)).length;
    const elementAbsentGroups = unique(rows.filter(r => !r.composition.features.includes(key)).map(r => r.groupId)).length;
    const sameColumns = unique(rows.flatMap(r => r.composition.features)).filter(f => f !== key && rows.every(r => r.composition.features.includes(f) === r.composition.features.includes(key)));
    const associations = dictionary.map(d => {
      const n11 = present.filter(r => r.silver.labelIds.includes(d.id)).length;
      const n10 = nElement - n11, n01 = rows.filter(r => !r.composition.features.includes(key) && r.silver.labelIds.includes(d.id)).length;
      const n00 = N - n11 - n10 - n01, alpha = model.config.alpha;
      const supported = subset.training.ready && nElement >= model.config.minElementSupport && N - nElement >= model.config.minElementSupport &&
        elementPresentGroups >= model.config.minElementGroups && elementAbsentGroups >= model.config.minElementGroups && subset.training.labels.find(l => l.id === d.id)?.supported;
      const a = n11 + alpha, b = n10 + alpha, c = n01 + alpha, z = n00 + alpha, denominator = N + 4 * alpha;
      const strata = unique(rows.map(r => r.sourceBook)).map(book => {
        const group = rows.filter(r => r.sourceBook === book); const hit = group.filter(r => r.composition.features.includes(key));
        return { sourceBook: book, records: group.length, elementPresent: hit.length, ruleHitAmongPresent: hit.filter(r => r.silver.labelIds.includes(d.id)).length };
      });
      return { id: d.id, label: d.label, supported: !!supported, N, n11, n10, n01, n00, alpha, elementPresentGroups, elementAbsentGroups,
        conditionalRuleHit: supported ? a / (a + b) : null,
        logLift: supported ? Math.log((a / denominator) / (((a + b) / denominator) * ((a + c) / denominator))) : null,
        sourceStrata: strata, sourceDominance: nElement ? Math.max(0, ...strata.map(s => s.elementPresent)) / nElement : null,
        examples: present.filter(r => r.silver.labelIds.includes(d.id)).slice(0, 5).map(r => ({ id: r.id, name: r.name, sourceURL: r.sourceURL, sourceBook: r.sourceBook, evidence: r.silver.evidence })),
        meaning: '該原名出現時，此詞規則命中的條件頻數；未命中不是無功效' };
    }).sort((a, b) => (b.logLift ?? -Infinity) - (a.logLift ?? -Infinity) || a.id.localeCompare(b.id));
    return { version, element: q.refs[0], support: nElement, elementPresentGroups, elementAbsentGroups, corpusRecords: N, corpusGroups: subset.training.groupCount,
      status: associations.some(a => a.supported) ? '原名元素與主治銀詞的語料關聯' : '樣本不足；只展示頻數', associations,
      identifiability: { uniqueSingleElementEffect: false, identicalOccurrenceColumns: sameColumns,
        notes: [sameColumns.length ? '此元素與所列欄位在本語料完全同現，不能唯一分辨各自貢獻。' : '沒有完全同現欄位，也不能由觀察語料識別單味固有藥性或因果。',
          '條件頻數未控制其他共方元素、作者、來源書、原方量及炮製；來源分層僅展示混雜，不消除混雜。'] },
      trainingSubset: { excludedGroupIds: subset.excludedGroupIds, excludedFormulaIds: subset.excludedFormulaIds }, limitations: clone(limitations) };
  }
  function metric(acc) {
    const rows = Object.values(acc), scored = rows.reduce((s, r) => s + r.scored, 0);
    const tp = rows.reduce((s, r) => s + r.tp, 0), fp = rows.reduce((s, r) => s + r.fp, 0), fn = rows.reduce((s, r) => s + r.fn, 0);
    const perLabel = rows.map(r => ({ ...r, precision: r.tp + r.fp ? r.tp / (r.tp + r.fp) : null,
      recall: r.tp + r.fn ? r.tp / (r.tp + r.fn) : null,
      f1: r.positiveTruth && r.negativeTruth ? (2 * r.tp + r.fp + r.fn ? 2 * r.tp / (2 * r.tp + r.fp + r.fn) : 0) : null,
      brier: r.scored ? r.squaredError / r.scored : null }));
    const defined = perLabel.filter(r => r.f1 !== null);
    return { scoredDecisions: scored, microPrecision: tp + fp ? tp / (tp + fp) : null,
      microRecall: tp + fn ? tp / (tp + fn) : null, microF1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null,
      macroF1: defined.length ? defined.reduce((s, r) => s + r.f1, 0) / defined.length : null,
      brier: scored ? rows.reduce((s, r) => s + r.squaredError, 0) / scored : null, perLabel };
  }
  function validate(model, options = {}) {
    const subset = trainingSubset(model, null, options), records = subset.records.filter(r => r.eligible), c = model.config;
    const mode = options.mode || 'family'; if (!['family', 'sourceBook'].includes(mode)) throw new Error('驗證分組方式無效。');
    const grouped = new Map();
    for (const r of records) { const key = mode === 'sourceBook' ? r.sourceBook : r.groupId; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(r); }
    const count = options.folds ?? c.folds;
    if (!Number.isInteger(count) || count < 2) throw new Error('留出折數至少為 2。');
    const k = Math.min(count, grouped.size);
    if (k < 2 || records.length < c.minTrainRecords) return { status: '樣本不足；未執行留出驗證', performed: false, metrics: null, baselineMetrics: null, folds: [], reasons: ['完整來源語料或分組不足'], limitations: clone(limitations) };
    const folds = Array.from({ length: k }, () => []);
    const groups = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [, members] of groups) { const index = folds.reduce((best, f, i) => f.length < folds[best].length ? i : best, 0); folds[index].push(...members); }
    const accumulator = {}, baseline = {}, reports = []; let evaluatedRows = 0, scoredRows = 0;
    const update = (store, label, actual, score) => {
      if (!store[label.id]) store[label.id] = { id: label.id, label: label.label, tp: 0, fp: 0, fn: 0, tn: 0, scored: 0, positiveTruth: 0, negativeTruth: 0, squaredError: 0 };
      const r = store[label.id], prediction = score >= c.threshold;
      r.scored++; r.squaredError += (score - Number(actual)) ** 2; r[actual ? 'positiveTruth' : 'negativeTruth']++;
      r[actual ? prediction ? 'tp' : 'fn' : prediction ? 'fp' : 'tn']++;
    };
    for (let i = 0; i < folds.length; i++) {
      const test = folds[i], testGroups = new Set(test.map(r => r.groupId));
      // Source-book holdout also excludes any family linking a test book to training.
      const train = records.filter(r => !testGroups.has(r.groupId) && !test.some(t => t.id === r.id));
      const trained = learn(train, c), active = trained.labels.filter(l => l.supported);
      let foldScored = 0, unsupportedQueries = 0;
      const supportedFeatures = new Set(trained.featureBundles.flatMap(b => b.featureIds));
      for (const r of test) {
        evaluatedRows++;
        const elementCoverage = r.composition.elementIds.length ? r.composition.elementIds.filter(id => supportedFeatures.has('element:' + id)).length / r.composition.elementIds.length : 0;
        if (!trained.ready || elementCoverage < c.minQuerySupportedCoverage) { unsupportedQueries++; continue; }
        const features = new Set(r.composition.features); if (active.length) scoredRows++;
        for (const label of active) { const actual = r.silver.labelIds.includes(label.id); update(accumulator, label, actual, scoreLabel(label, features).score); update(baseline, label, actual, label.prior); foldScored++; }
      }
      reports.push({ fold: i + 1, trainRecords: train.length, trainGroups: unique(train.map(r => r.groupId)).length,
        testRecords: test.length, testGroups: [...testGroups], trainIds: train.map(r => r.id), testIds: test.map(r => r.id),
        supportedTargets: active.map(l => l.id), scoredDecisions: foldScored, abstainedQueries: unsupportedQueries, reasons: trained.reasons,
        groupOverlap: unique(train.map(r => r.groupId)).filter(id => testGroups.has(id)) });
    }
    const metrics = metric(accumulator), baselineMetrics = metric(baseline);
    return { version, dictionaryVersion, status: metrics.scoredDecisions ? '已執行分組留出；評估來源銀詞而非療效' : '已執行留出；支持不足，無可報驗證指標', performed: true,
      grouping: mode, metrics: metrics.scoredDecisions ? metrics : null, baselineMetrics: metrics.scoredDecisions ? baselineMetrics : null,
      comparedToBaseline: metrics.scoredDecisions ? { microF1Difference: metrics.microF1 !== null && baselineMetrics.microF1 !== null ? metrics.microF1 - baselineMetrics.microF1 : null,
        brierDifference: metrics.brier - baselineMetrics.brier, meaning: '同一批可評估銀詞決策與每折訓練頻率基線比較；差值不證明臨床能力' } : null,
      folds: reports, coverage: { testRecords: evaluatedRows, scoredQueryRecords: scoredRows, queryCoverage: evaluatedRows ? scoredRows / evaluatedRows : 0,
        scoredLabelDecisions: metrics.scoredDecisions, possibleLabelDecisions: evaluatedRows * dictionary.length,
        labelDecisionCoverage: evaluatedRows ? metrics.scoredDecisions / (evaluatedRows * dictionary.length) : 0 },
      trainingSubset: { excludedGroupIds: subset.excludedGroupIds, excludedFormulaIds: subset.excludedFormulaIds },
      protocol: '固定詞典、參數與門檻；每折重新從訓練方計數與建立詞彙支持；held-out 方義不進輸入或計數；未調參，基線僅用訓練命中率',
      limitations: clone(limitations) };
  }
  function describeCorpus(model) {
    return { ...clone(model.summary), sourceElements: model.elements.length, sourceBooks: unique(model.records.map(r => r.sourceBook)).length,
      trainingRecords: model.training.N, trainingGroups: model.training.groupCount, supportedTargets: model.training.labels.filter(l => l.supported).map(l => l.id),
      dictionaryVersion, version, inputPolicy: model.inputPolicy, limitations: clone(limitations) };
  }
  root.InferenceModel = { version, dictionaryVersion, dictionary: clone(dictionary), defaults: clone(defaults), prepare, fit,
    silverLabels, predict, elementAssociations, elementAssociation: elementAssociations, validate, evaluateGrouped: validate, describeCorpus, queryOf };
})(globalThis);
