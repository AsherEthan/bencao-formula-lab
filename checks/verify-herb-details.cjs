'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const Details=require('../dist/herb-details.js');
const root=path.resolve(__dirname,'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'dist/downloads/herbs-and-formulas.json'),'utf8'));
const original=JSON.stringify(data);
const herb=name=>data.herbs.find(h=>h.name===name&&/未知/.test(h.nature));
let checks=0;
function test(name,body){body();checks++;}
function entry(rawText,patch={}){return {id:'test',name:'測試',sourceId:'source-test',nature:'未知（此擷取未明載）',rawText,...patch};}
function verifySpan(h,s){
  if(!s)return;
  assert.equal(Array.from(h.rawText).slice(s.start,s.end).join(''),s.text,h.name);
  assert.equal(s.sourceId,h.sourceId);
  assert.equal(s.offsetUnit,'unicode_code_point');
  assert.equal(s.basis,'rawText');
}

test('missed property headings and explicit nature are recovered for reading',()=>{
  for(const [name,nature] of [['五味子','溫'],['地榆','微寒'],['連翹','微寒'],['糯米','溫']]){
    const h=herb(name),p=Details.profile(h);
    assert(h);
    assert.equal(p.nature.value,nature,name);
    assert.equal(p.nature.supplemented,true);
    verifySpan(h,p.nature.evidence);
  }
  assert(Details.profile(herb('五味子')).effects.includes('補肺腎，澀精氣'));
});
test('unknown nature is not inferred from therapeutic actions or cross references',()=>{
  for(const raw of ['平補肝腎\n苦堅腎，甘益血，溫養氣。治腰痛。','功同海藻而少滑，性雄。治水腫。','瀉火\n苦入心，寒勝熱。','澀腸\n酸澀。平胃氣，清虛熱。']){
    const p=Details.profile(entry(raw));
    assert.equal(p.nature.supplemented,false,raw);
    assert(Details.unknownNature(p.nature.value));
  }
});
test('processing and edition qualifications never become one universal nature',()=>{
  for(const raw of ['苦辛。生溫，熟熱。','苦辛（《本草》大寒，藏器曰熱）。','苦寒（一雲微溫）。']){
    assert.equal(Details.profile(entry(raw)).nature.supplemented,false,raw);
  }
  assert.equal(Details.profile(entry('苦寒。',{nature:'生微涼／熟溫'})).nature.value,'生微涼／熟溫');
});
test('properties do not replace existing curated or archived labels',()=>{
  const p=Details.profile(entry('性溫。',{nature:'平（此輯本）'}));
  assert.equal(p.nature.value,'平（此輯本）');
  assert.equal(p.nature.supplemented,false);
});
test('explicit use excerpts exclude nested commentary claims',()=>{
  const h=entry('清熱\n苦寒（旁注治別病）。治頭痛（旁注治其他病），目赤。\n氣虛者慎用。');
  const p=Details.profile(h);
  assert.deepEqual(p.indications.map(s=>s.text),['治頭痛']);
  assert(p.cautions.some(s=>s.text.includes('慎用')));
  for(const s of [p.property,...p.indications,...p.cautions])verifySpan(h,s);
});
test('use excerpts retain direct action wording even without a literal 治 heading',()=>{
  const h=herb('五味子'),p=Details.profile(h);
  assert(p.indications.some(s=>s.text==='益氣生津'));
  for(const s of p.indications)verifySpan(h,s);
  const empty=Details.profile(entry('性溫（旁注治頭痛）。出江南，去皮炒用。'));
  assert.deepEqual(empty.indications,[]);
});
test('astral characters do not corrupt Unicode code point positions',()=>{
  const h=entry('𠀀別名\n性溫。\n治頭痛（含𠀀旁注）。');
  const p=Details.profile(h);
  assert.equal(p.nature.value,'溫');
  for(const s of [p.property,...p.indications])verifySpan(h,s);
});
test('missing text and absent lists retain explicit empty states',()=>{
  const p=Details.profile(entry(''));
  assert.equal(p.property,null);
  assert.equal(p.nature.supplemented,false);
  assert.deepEqual(p.effects,[]);
  assert.deepEqual(p.indications,[]);
  assert.deepEqual(p.relatedFormulas,[]);
});
test('formula examples use IDs rather than names and exclude unresolved mappings',()=>{
  const h=entry('性溫。治頭痛。');
  const examples=[{id:'right',name:'例方',ingredientRefs:[{id:'test',mappingStatus:'exact'}]},
    {id:'same-name',name:'例方',ingredientRefs:[{sourceName:'測試',id:'other'}]},
    {id:'unresolved',ingredientRefs:[{id:'test',mappingStatus:'unresolved'}]}];
  assert.deepEqual(Details.profile(h,examples).relatedFormulas.map(f=>f.id),['right']);
});
test('search includes effects historical uses and exact formula examples',()=>{
  const h=entry('散風\n性溫。治頭痛。');
  const p=Details.profile(h,[{name:'頭痛例方',ingredientRefs:[{id:'test'}]}]);
  const text=Details.searchText(h,p);
  for(const term of ['散風','頭痛','頭痛例方','溫'])assert(text.includes(term));
});

test('all source supplements retain exact evidence and leave archived data unchanged',()=>{
  for(const h of data.herbs){
    const p=Details.profile(h,data.formulas);
    for(const s of [p.property,p.effectEvidence,p.nature.evidence,...p.indications,...p.cautions])verifySpan(h,s);
    if(p.nature.supplemented)assert(Details.unknownNature(h.nature));
    for(const f of p.relatedFormulas)assert(f.ingredientRefs.some(r=>r.id===h.id&&r.mappingStatus!=='unresolved'));
  }
  assert.equal(JSON.stringify(data),original);
});

const elements=new Map();
function element(selector){
  if(!elements.has(selector))elements.set(selector,{innerHTML:'',open:false,
    insertAdjacentHTML(position,html){this.innerHTML+=html},showModal(){this.open=true}});
  return elements.get(selector);
}
const context={console,HERB_DATA:data,HerbDetails:Details,
  HerbModel:{natureGroup:n=>/寒|涼/.test(n)?'寒涼':/溫|熱/.test(n)?'溫熱':/平/.test(n)?'平性':'未錄'},
  WorkstationModel:{defaultPlan:()=>({})},
  HerbImages:{thumb:()=>'',label:()=>'',gallery:()=>''},ResearchUI:{badge:()=>''},
  document:{querySelector:element}};
context.window=context;
vm.createContext(context);
const app=fs.readFileSync(path.join(root,'dist/app.js'),'utf8');
vm.runInContext(app.slice(0,app.indexOf("document.addEventListener('click'")),context,{filename:'app.js'});

test('library cards expose effect and use fields with readable missing states',()=>{
  vm.runInContext('renderLibraryCards()',context);
  const html=element('#library-grid').innerHTML;
  assert(html.includes('功用原詞'));
  assert(html.includes('古籍用途'));
  assert(!html.includes('undefined'));
  assert(html.includes('library-pagination'));
});
test('herb detail renders properties uses formula examples and complete source text',()=>{
  const h=herb('五味子');
  vm.runInContext(`showDetail(${JSON.stringify(h.id)})`,context);
  const html=element('#detail-content').innerHTML;
  for(const text of ['藥性與歸經','溫（原文補充，待核）','功用與古籍使用場景','已收錄方劑中的使用例','查看完整古籍條目','原文 Unicode 字符'])assert(html.includes(text),text);
  assert.equal(element('#detail-dialog').open,true);
});
test('new nature filters and use search reach recovered entries',()=>{
  const h=herb('五味子');
  assert(vm.runInContext(`query='';filter='溫熱';filteredHerbs().some(h=>h.id===${JSON.stringify(h.id)})`,context));
  assert(vm.runInContext("filter='全部';query='風寒濕痹';filteredHerbs().length>0",context));
  assert(vm.runInContext("filtersHTML().includes('未錄')&&filtersHTML().includes('需辨加工')",context));
});
test('dynamic herb quotes and missing source URLs are safely rendered',()=>{
  const h=entry('性溫。\n治<script>alert(1)</script>。',{id:'unsafe',name:'<img onerror="x">'});
  data.herbs.push(h);
  context.testHerb=h;
  vm.runInContext('herbProfiles.set(testHerb.id,HerbDetails.profile(testHerb));showDetail(testHerb.id)',context);
  const html=element('#detail-content').innerHTML;
  assert(!html.includes('<script>'));
  assert(!html.includes('<img onerror='));
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('來源尚未收錄'));
  data.herbs.pop();
});
test('browser script is loaded before application bootstrap',()=>{
  const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
  assert(html.indexOf('src="herb-details.js')>=0);
  assert(html.indexOf('src="herb-details.js')<html.indexOf('src="app.js'));
});
const profiles=data.herbs.map(h=>Details.profile(h,data.formulas));
console.log(JSON.stringify({checks,herbs:profiles.length,
  sourcePropertyExcerpts:profiles.filter(p=>p.property).length,
  supplementalNature:profiles.filter(p=>p.nature.supplemented).length,
  effectHeadings:profiles.filter(p=>p.effects.length).length,
  historicalUseExcerpts:profiles.filter(p=>p.indications.length).length,
  formulaExamples:profiles.filter(p=>p.relatedFormulas.length).length,
  archivedDataUnchanged:JSON.stringify(data)===original}));
