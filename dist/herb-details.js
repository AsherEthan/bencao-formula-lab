(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HerbDetails=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const unknownNature=value=>!value||/未知|未明載|未錄/.test(value);
  const taste='[甘苦酸辛咸鹹淡澀]';
  const thermal='(?:大寒|大熱|大溫|微寒|微溫|微涼|小寒|小溫|寒|熱|溫|涼|平|冷)';
  const propertyStart=new RegExp('^(?:味|性味|氣味|性|氣)?(?:'+taste+'|'+thermal+')');
  const naturePattern=new RegExp('(?:性|氣|'+taste+'+(?:有(?:小|微|大)?毒)?[，、而]*|^)('+thermal+')(?=[。，；、而]|純陽|升浮|微?'+taste+'|$)','g');
  function evidence(h,text,start){
    return {text,start,end:start+Array.from(text).length,sourceId:h.sourceId,
      offsetUnit:'unicode_code_point',basis:'rawText'};
  }
  // Split only at top-level punctuation; commentary remains attached to its source clause.
  function sentences(h){
    const chars=Array.from(h.rawText||'');let depth=0,start=0;const out=[];
    function push(end){
      const raw=chars.slice(start,end).join(''),text=raw.trim();
      if(text)out.push(evidence(h,text,start+Array.from(raw.match(/^\s*/)[0]).length));
      start=end;
    }
    chars.forEach((ch,i)=>{
      if(ch==='（'||ch==='(')depth++;
      if(ch==='）'||ch===')')depth=Math.max(0,depth-1);
      if(!depth&&/[。；\n]/.test(ch))push(i+1);
    });
    push(chars.length);return out;
  }
  function outsideParens(text){
    let depth=0,out='';
    for(const ch of text){
      if(ch==='（'||ch==='('){depth++;continue}
      if(ch==='）'||ch===')'){depth=Math.max(0,depth-1);continue}
      if(!depth)out+=ch;
    }
    return out;
  }
  function opening(h){
    let start=0;
    for(const line of (h.rawText||'').split('\n').slice(0,8)){
      const text=line.trim();
      if(propertyStart.test(text)&&/[。；]/.test(text)){
        const offset=start+Array.from(line.match(/^\s*/)[0]).length;
        const part=sentences({...h,rawText:text})[0];
        if(part)return evidence(h,part.text,offset+part.start);
      }
      start+=Array.from(line).length+1;
    }
    return null;
  }
  function compact(h,span){
    const chars=Array.from(span.text),paren=chars.findIndex(ch=>ch==='（'||ch==='(');
    const end=Math.min(paren<0?chars.length:paren,160);
    return evidence(h,chars.slice(0,end).join(''),span.start);
  }
  function profile(h,formulas=[]){
    const clauses=sentences(h),property=opening(h);
    // These supplements are for reading/search only, never inputs to the archived models.
    const nature={value:h.nature||'未錄',supplemented:false,evidence:null};
    if(unknownNature(h.nature)&&property){
      const values=[...new Set(Array.from(outsideParens(property.text).matchAll(naturePattern),m=>m[1]))];
      const conditional=/(?:生|熟|炒|炙|製|制)[^。；]{0,8}(?:寒|熱|溫|涼)|一[雲云]|本經|《/.test(property.text);
      if(values.length&&!conditional){
        nature.value=values.length===1?values[0]:'加工／版本條件不明';
        nature.supplemented=true;nature.evidence=property;
      }
    }
    const effects=[...(h.effects||[])];
    let effectEvidence=null;
    if(!effects.length){
      const first=clauses.find(s=>! /^(?:古名|俗作|一名|又名|即|附|（|\()/.test(s.text));
      if(first&&(!property||first.start<property.start)&&Array.from(first.text).length<=50){
        effectEvidence=first;effects.push(first.text.replace(/[。；]$/,''));
      }
    }
    const explicitUses=clauses.filter(s=>/^(?:主治|治|療|主(?!手|足|入|經|氣|血))/.test(s.text)||/^(?:又|亦|能|兼|專|並|可)(?:治|療)/.test(s.text));
    const actionUses=clauses.filter(s=>(!property||s.start>=property.end)&&
      /^(?:能|又能|亦能|可)?(?:補|益|養|滋|潤|清|瀉|散|解|消|祛|除|止|斂|澀|固|寧|安|利|通|破|行|暖|退|強|殺|收|開|定|調|發|下水)/.test(outsideParens(s.text)));
    const indications=(explicitUses.length?explicitUses:actionUses)
      .map(s=>compact(h,s)).filter(s=>s.text).slice(0,3);
    const cautions=clauses.filter(s=>/忌|慎用|禁用|勿服|不可|不宜|有(?:大|小|微|劇)?毒/.test(outsideParens(s.text)));
    const relatedFormulas=formulas.filter(f=>(f.ingredientRefs||[]).some(r=>r.id===h.id&&r.mappingStatus!=='unresolved'));
    return {nature,property,effects,effectEvidence,indications,cautions,relatedFormulas};
  }
  function searchText(h,p){
    return [h.name,...h.aliases||[],h.nature,p.nature.value,...h.flavors||[],...h.meridians||[],
      h.summary,...p.effects,p.property?.text,...p.indications.map(s=>s.text),...p.relatedFormulas.map(f=>f.name)].filter(Boolean).join(' ').toLocaleLowerCase();
  }
  return {profile,searchText,unknownNature};
});
