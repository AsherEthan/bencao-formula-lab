'use strict';
(function (root) {
  const categories = ['溫熱', '平性', '寒涼', '需辨加工', '未錄'];
  function natureGroup(nature) {
    const matched=[/[寒涼凉]/.test(nature || ''),/[溫温熱热]/.test(nature || ''),/平/.test(nature || '')].filter(Boolean).length;
    if(matched>1)return '需辨加工';
    if (/[寒涼凉]/.test(nature || '')) return '寒涼';
    if (/[溫温熱热]/.test(nature || '')) return '溫熱';
    if (/平/.test(nature || '')) return '平性';
    return '未錄';
  }
  function validateSelection(selection, data) {
    if (!Array.isArray(selection)) throw new Error('組方必須是本草清單。');
    const seen = new Set();
    for (const item of selection) {
      if (!item || !data.herbs.some(h => h.id === item.id)) throw new Error('本草身份未收錄。');
      if (seen.has(item.id)) throw new Error('同味本草不可重複加入。');
      seen.add(item.id);
      if (!Number.isInteger(item.ratio) || item.ratio < 1 || item.ratio > 20) throw new Error('研究份數須為 1 至 20 的整數。');
    }
    return selection;
  }
  function distribution(selection, data, field) {
    const counts = {};
    const total = selection.reduce((sum, x) => sum + x.ratio, 0);
    if (!total) return [];
    for (const item of selection) {
      const herb = data.herbs.find(h => h.id === item.id);
      const values = field === 'nature' ? [natureGroup(herb.nature)] : [...new Set(herb[field] || [])];
      if (!values.length) values.push('未錄');
      for (const label of values) counts[label] = (counts[label] || 0) + item.ratio / values.length;
    }
    return Object.entries(counts).map(([label, value]) => ({label, percent: value / total * 100})).sort((a,b) => b.percent-a.percent || a.label.localeCompare(b.label));
  }
  function analyze(selection, data) {
    validateSelection(selection, data);
    const ids = new Set(selection.map(s=>s.id));
    const warnings=[];
    const pairs = new Map();
    for (const rule of data.rules || []) {
      for (const a of rule.a) for (const b of rule.b) {
        if (a !== b && ids.has(a) && ids.has(b)) {
          const key=[a,b].sort().join('|');
          if(!pairs.has(key))pairs.set(key,{type:'compatibility',a,b,references:[]});
          pairs.get(key).references.push({ruleId:rule.id,sourceId:rule.sourceId,quote:rule.quote,note:rule.note,evidenceType:rule.evidenceType});
        }
      }
    }
    warnings.push(...pairs.values());
    for (const herb of data.herbs) if (ids.has(herb.id) && herb.toxic) warnings.push({type:'toxicity',herbId:herb.id,sourceId:herb.toxic.sourceId,note:herb.toxic.note || herb.toxic,quote:herb.toxic.quote || ''});
    const matches = (data.formulas || []).map(f => {
      const unresolved=(f.ingredientRefs||[]).filter(x=>x.mappingStatus==='unresolved'||!x.id);
      const baseline = new Set([...f.herbIds,...unresolved.map(x=>'unresolved:'+x.sourceName)]);
      const shared = [...ids].filter(id=>baseline.has(id)).sort();
      const union = new Set([...ids,...baseline]);
      return {id:f.id,unresolvedIngredientNames:unresolved.map(x=>x.sourceName),percent:union.size ? shared.length/union.size*100 : 0,shared,missing:[...baseline].filter(id=>!ids.has(id)).sort(),extra:[...ids].filter(id=>!baseline.has(id)).sort()};
    }).sort((a,b)=>b.percent-a.percent);
    return {selection:selection.map(s=>({...s})),totalWeight:selection.reduce((sum,s)=>sum+s.ratio,0),nature:distribution(selection,data,'nature'),flavors:distribution(selection,data,'flavors'),meridians:distribution(selection,data,'meridians'),warnings,matches};
  }
  root.HerbModel={natureGroup,validateSelection,distribution,analyze,categories};
})(typeof globalThis !== 'undefined' ? globalThis : this);
