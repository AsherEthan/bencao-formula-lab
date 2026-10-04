const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..');
const sandbox={window:{}};vm.createContext(sandbox);
for(const file of ['data.js','model.js','quant-model.js','processing-model.js'])vm.runInContext(fs.readFileSync(path.join(base,'dist',file),'utf8'),sandbox);
const P=sandbox.ProcessingModel,Q=sandbox.QuantModel,H=sandbox.HerbModel,real=sandbox.window.HERB_DATA;
const plain=x=>JSON.parse(JSON.stringify(x));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name)}
function herb(id,nature='生平／炙溫',effects=['补氣']){
  const rawText='🧪'+nature+'。'+effects.join('；')+'。原加工：洗，切片。';
  const span=(field,text)=>{const at=rawText.indexOf(text);return {field,text,start:[...rawText.slice(0,at)].length,end:[...rawText.slice(0,at+text.length)].length,basis:'rawText',offsetUnit:'unicode_code_point'}};
  return {id,name:id,sourceId:'fixture',nature,flavors:['甘'],meridians:['肺'],effects,rawText,evidenceSpans:[span('nature',nature),...effects.map(t=>span('effects',t))],toxic:false};
}
const fixtureHerbs=[herb('a','生平／炙溫',['補氣','清熱']),herb('b','寒',['清熱'])];
fixtureHerbs[0].toxic={sourceId:'fixture',quote:'有毒',note:'歷史毒性記載'};
const d={herbs:fixtureHerbs,sources:[{id:'fixture',url:'https://example.test'}],formulas:[{id:'f',name:'f',herbIds:['a','b'],ingredientRefs:[{id:'a',scope:'core',mappingStatus:'exact'},{id:'b',scope:'core',mappingStatus:'exact'}]}],rules:[{id:'r',a:['a'],b:['b'],sourceId:'fixture',quote:'互忌',note:'來源警示'}]};
function origin(h,text){const at=h.rawText.indexOf(text);return {herbId:h.id,text,start:[...h.rawText.slice(0,at)].length,end:[...h.rawText.slice(0,at+text.length)].length,basis:'herbRawText',offsetUnit:'unicode_code_point'}}
function evidence(field,text,h=fixtureHerbs[0]){return {field,text,sourceId:'fixture',evidenceSpan:origin(h,text)}}
function profile(id='a-heated',attributes={nature:'溫',flavors:[],meridians:[],effects:[]},extra={}){return {id,label:'炙用',herbIds:['a'],attributes,propertyEvidence:[evidence('nature','炙溫')],workflow:[{label:'清洗',note:'原文洗',sourceId:'fixture',evidenceSpan:origin(fixtureHerbs[0],'洗')}],verificationStatus:'source_excerpt_reviewed',...extra}}
const processes={profiles:[profile(),profile('a-no-property',{nature:null,flavors:[],meridians:[],effects:[]})]};
const row=(id,extra={})=>({id,ratio:1,role:'未標註',...extra});

check('unspecified source retains conditional nature without pretending to be a raw product',()=>{
  const r=P.resolveSelection([row('a')],d,processes);
  assert.equal(r.valid,true);assert.equal(r.resolvedRows[0].processingId,'source_unspecified');
  assert.equal(r.resolvedRows[0].attributeStatus.nature,'generic_source_unspecified');
  assert.equal(r.derivedData.herbs[0].nature,'生平／炙溫');
  assert.equal(r.quant.records[0].thermal.status,'conditional');
  assert.deepEqual(plain(r.quant.range),[0,1]);
});
check('a verified branch replaces only the fields actually documented for that branch',()=>{
  const r=P.resolveSelection([row('a',{processingId:'a-heated'})],d,processes);
  assert.equal(r.valid,true);assert.equal(r.resolvedRows[0].attributes.nature,'溫');
  assert.deepEqual(plain(r.resolvedRows[0].attributes.effects),[]);
  assert.deepEqual(plain(r.resolvedRows[0].attributes.flavors),[]);
  assert.deepEqual(plain(r.resolvedRows[0].attributes.meridians),[]);
  assert.equal(r.resolvedRows[0].attributeStatus.effects,'unknown_after_processing');
  assert.deepEqual(plain(r.quant.range),[1,1]);
  assert.ok(r.quant.labels.every(x=>x.coverage===0));
  assert.equal(r.quant.records[0].thermal.evidenceStatus,'linked_source_span');
  const h=r.derivedData.herbs[0],e=h.evidenceSpans[0];
  assert.equal([...h.rawText].slice(e.start,e.end).join(''),e.text);
  assert.equal(P.sourceSpanValid(e.originEvidenceSpan,d),true);
});
check('the lack of processed properties remains unknown and cannot become a zero temperature',()=>{
  const r=P.resolveSelection([row('a',{processingId:'a-no-property'}),row('b')],d,processes);
  assert.equal(r.resolvedRows[0].attributes.nature,null);assert.equal(r.quant.range,null);
  assert.deepEqual(plain(r.quant.unknownIds),['a']);close(r.quant.thermalCoverage,.5);
  assert.deepEqual(plain(r.quant.knownSubsetRange),[-2,-2]);
  assert.ok(r.analysis.nature.some(x=>x.label==='未錄'&&x.percent===50));
});
check('profile applicability and unique identity are required before applying any branch',()=>{
  assert.equal(P.resolveSelection([row('b',{processingId:'a-heated'})],d,processes).valid,false);
  assert.equal(P.resolveSelection([row('a',{processingId:'absent'})],d,processes).valid,false);
  assert.equal(P.resolveSelection([row('a',{processingId:'a-heated'})],d,{profiles:[profile(),profile()]}).valid,false);
  assert.equal(P.availableProfiles('b',processes).length,0);
});
check('UTF16 positions and corrupted source identifiers cannot admit processing properties',()=>{
  const p=profile();p.propertyEvidence[0].evidenceSpan.start++;p.propertyEvidence[0].evidenceSpan.end++;
  const r=P.resolveSelection([row('a',{processingId:p.id})],d,{profiles:[p]});
  assert.equal(r.valid,true);assert.equal(r.resolvedRows[0].attributes.nature,null);assert.equal(r.quant.range,null);
  assert.equal(r.resolvedRows[0].rejectedPropertyEvidence.length,1);
  const p2=profile();p2.propertyEvidence[0].sourceId='another-source';
  assert.equal(P.resolveSelection([row('a',{processingId:p2.id})],d,{profiles:[p2]}).resolvedRows[0].attributes.nature,null);
  const e=evidence('nature','炙溫');e.evidenceSpan.offsetUnit='utf16';assert.equal(P.evidenceValid(e,d),false);
});
check('a review flag by itself and unsupported field values are insufficient evidence',()=>{
  const p=profile('p',{nature:'熱',flavors:[],meridians:[],effects:['補氣']});
  const r=P.resolveSelection([row('a',{processingId:'p'})],d,{profiles:[p]});
  assert.equal(r.resolvedRows[0].attributes.nature,null);assert.deepEqual(plain(r.resolvedRows[0].attributes.effects),[]);
  const unreviewed=profile('u',undefined,{verificationStatus:'automatically_extracted'});
  assert.equal(P.resolveSelection([row('a',{processingId:'u'})],d,{profiles:[unreviewed]}).quant.range,null);
  assert.equal(P.resolveSelection([row('a',{nature:'溫'})],d,processes).valid,false);
});
check('workflow claims also need source positions, while user process records have no attribute effect',()=>{
  const p=profile();p.workflow.push({label:'推測烘烤',note:'100 度 10 分鐘'});
  const record={batch:'test',temperatureC:-10,durationMinutes:0,stepsNote:'實錄浸泡',medium:'水',equipment:'罐'};
  const rows=[row('a',{processingId:p.id,processRecord:record,sourceProcessingNote:'原方炙',processNotes:'研究註記'})];
  const r=P.resolveSelection(rows,d,{profiles:[p]});
  assert.equal(r.resolvedRows[0].workflow[0].verified,true);assert.equal(r.resolvedRows[0].workflow[1].verified,false);
  assert.deepEqual(plain(r.analysis.selection),rows);assert.deepEqual(plain(r.modelRows[0].processRecord),record);
  record.stepsNote='後改';assert.equal(r.analysis.selection[0].processRecord.stepsNote,'實錄浸泡');
  const custom=P.resolveSelection([row('a',{processingId:'custom_unverified',processRecord:{temperatureC:200,durationMinutes:50,stepsNote:'烘烤'}})],d,processes);
  assert.equal(custom.valid,true);assert.equal(custom.quant.range,null);assert.equal(custom.resolvedRows[0].attributes.nature,null);
});
check('invalid temperature, duration and record formats cannot enter an exported analysis',()=>{
  for(const processRecord of [{temperatureC:NaN},{temperatureC:'100'},{durationMinutes:-1},{durationMinutes:Infinity},{batch:5},null,[]])assert.equal(P.resolveSelection([row('a',{processRecord})],d,processes).valid,false);
  assert.equal(P.resolveSelection([row('a',{sourceProcessingNote:5})],d,processes).valid,false);
});
check('grams must be measured positive finite values rather than ratios or ancient unit conversions',()=>{
  for(const grams of [0,-1,NaN,Infinity,'5'])assert.equal(P.resolveSelection([row('a',{grams})],d,processes).valid,false);
  assert.equal(P.resolveSelection([row('a',{grams:Number.MAX_VALUE}),row('b',{grams:Number.MAX_VALUE})],d,processes).valid,false);
  assert.equal(P.resolveSelection([row('a',{grams:.125})],d,processes).totalGrams,.125);
  const missing=P.resolveSelection([row('a',{ratio:20})],d,processes);
  assert.equal(missing.resolvedRows[0].grams,null);assert.equal(missing.totalGrams,null);
});
check('one missing mass prevents whole-formula percentages without invalidating composition warnings',()=>{
  const rows=[row('a',{grams:1,processingId:'a-heated'}),row('b',{ratio:10})];
  const r=P.resolveSelection(rows,d,processes,{basis:'grams'});
  assert.equal(r.valid,true);assert.equal(r.gramsComplete,false);assert.equal(r.basisComplete,false);
  assert.equal(r.totalGrams,null);assert.equal(r.knownGrams,1);close(r.gramsCoverage,.5);
  assert.deepEqual(plain(r.missingGrams),['b']);assert.equal(r.massDistribution,null);assert.equal(r.quant,null);
  assert.equal(r.analysis.canAggregate,false);assert.equal(r.analysis.totalWeight,null);assert.deepEqual(plain(r.analysis.nature),[]);
  assert.equal(r.partialMass.totalGrams,1);assert.deepEqual(plain(r.partialMass.excludedIds),['b']);
  close(r.partialMass.nature[0].percent,100);
  assert.deepEqual(plain(r.analysis.warnings),plain(H.analyze(rows,d).warnings));
});
check('complete mass weights the labels by recorded grams independently of research ratios',()=>{
  const rows=[row('a',{ratio:10,grams:1,processingId:'a-heated'}),row('b',{ratio:1,grams:3})];
  const g=P.resolveSelection(rows,d,processes,{basis:'grams'}),r=P.resolveSelection(rows,d,processes,{basis:'research'});
  assert.equal(g.totalGrams,4);assert.equal(g.massComplete,true);assert.equal(g.analysis.weightUnit,'g');
  close(g.analysis.nature.find(x=>x.label==='寒涼').percent,75);close(g.analysis.nature.find(x=>x.label==='溫熱').percent,25);
  close(g.quant.range[0],-1.25);close(g.quant.labels.find(x=>x.id==='heat').coverage,.75);
  close(r.analysis.nature.find(x=>x.label==='溫熱').percent,1000/11);
  assert.equal(g.quant.oppositeSigns,true);assert.deepEqual(plain(g.analysis.selection),rows);
});
check('unknown processed nature consumes mass coverage and does not become neutral',()=>{
  const rows=[row('a',{grams:3,processingId:'a-no-property'}),row('b',{grams:1})];
  const r=P.resolveSelection(rows,d,processes,{basis:'grams'});
  assert.equal(r.quant.range,null);close(r.quant.thermalCoverage,.25);
  assert.deepEqual(plain(r.quant.knownSubsetRange),[-2,-2]);
  close(r.analysis.nature.find(x=>x.label==='未錄').percent,75);
});
check('the same recorded composition changes only its ordinal values across explicit encoding scenarios',()=>{
  const hot=herb('hot','大熱',['補氣']),mild=herb('mild','微寒',['清熱']);
  const textData={herbs:[hot,mild],sources:d.sources,formulas:[],rules:[]};
  const rows=[row('hot',{ratio:1,grams:2}),row('mild',{ratio:9,grams:1})];
  const setting={scheme:'wide',mild:.25,strong:2};
  const basic=P.resolveSelection(rows,textData,{},{}),wide=P.resolveSelection(rows,textData,{},{quantOptions:setting});
  close(basic.quant.range[0],-.6);close(wide.quant.range[0],-.1);
  assert.deepEqual(plain(wide.quant.options),setting);assert.deepEqual(plain(wide.quantOptions),setting);
  assert.deepEqual(plain(wide.quant.labels),plain(basic.quant.labels));assert.deepEqual(plain(wide.analysis.nature),plain(basic.analysis.nature));
  const legacy=Q.aggregate(rows,textData,setting);
  for(const key of ['version','totalWeight','thermalCoverage','unknownIds','unlinkedThermalIds','conditionalWeight','positiveWeight','negativeWeight','oppositeSigns','labels','options'])assert.deepEqual(plain(wide.quant[key]),plain(legacy[key]),key);
  close(wide.quant.range[0],legacy.range[0]);close(wide.quant.range[1],legacy.range[1]);
  const grams=P.resolveSelection(rows,textData,{},{basis:'grams',quantOptions:setting});
  close(grams.quant.range[0],5);assert.deepEqual(plain(grams.quant.options),setting);
  assert.equal(grams.totalGrams,3);assert.deepEqual(plain(grams.massDistribution),plain(P.resolveSelection(rows,textData,{},{basis:'grams'}).massDistribution));
});
check('selected processing branches and partial mass use the same requested ordinal scale',()=>{
  const profileData={profiles:[...processes.profiles,profile('a-conditional',{nature:'生平／炙溫',flavors:[],meridians:[],effects:[]},{propertyEvidence:[evidence('nature','生平／炙溫')]})]};
  const rows=[row('a',{processingId:'a-conditional',grams:2}),row('b')],setting={scheme:'wide',mild:.25,strong:2};
  const r=P.resolveSelection(rows,d,profileData,{basis:'grams',quantOptions:setting});
  assert.equal(r.valid,true);assert.equal(r.quant,null);assert.equal(r.totalGrams,null);
  assert.deepEqual(plain(r.partialMass.quant.options),setting);assert.deepEqual(plain(r.partialMass.quant.range),[0,1]);
  assert.deepEqual(plain(r.changes[0].beforeRange),[0,1]);assert.deepEqual(plain(r.changes[0].afterRange),[0,1]);
  assert.deepEqual(plain(r.analysis.warnings),plain(H.analyze(rows,d).warnings));
  const hot=herb('hot','生熱／炙大熱',[]),hotData={herbs:[hot],sources:d.sources,formulas:[],rules:[]};
  const branch=profile('hot-zhi',{nature:'大熱',flavors:[],meridians:[],effects:[]},{herbIds:['hot'],propertyEvidence:[evidence('nature','炙大熱',hot)],workflow:[]});
  const changed=P.resolveSelection([row('hot',{processingId:branch.id})],hotData,{profiles:[branch]},{quantOptions:setting});
  assert.deepEqual(plain(changed.changes[0].beforeRange),[4,8]);assert.deepEqual(plain(changed.changes[0].afterRange),[8,8]);
  assert.deepEqual(plain(changed.quant.range),[8,8]);
});
check('invalid ordinal settings are rejected even when grams or thermal properties are unavailable',()=>{
  const bad=[null,[],1,{scheme:'unknown'},{scheme:'constructor'},{scheme:'toString'},{scheme:2},{mild:0},{mild:-1},{mild:NaN},{mild:Infinity},{mild:'0.5'},{strong:0},{strong:-1},{strong:NaN},{strong:Infinity},{strong:'2'},{scheme:'wide',strong:Number.MAX_VALUE}];
  for(const quantOptions of bad){
    const missing=P.resolveSelection([row('a',{processingId:'custom_unverified'})],d,processes,{basis:'grams',quantOptions});
    assert.equal(missing.valid,false,JSON.stringify(quantOptions));assert.equal(missing.quant,null);
  }
  const expected={scheme:'base',mild:.5,strong:1.5};
  assert.deepEqual(plain(P.resolveSelection([],d,processes,{quantOptions:{}}).quant.options),expected);
  assert.deepEqual(plain(P.resolveSelection([],d,processes,{quantOptions:{mild:null,strong:null}}).quant.options),expected);
});
check('finite recorded masses cannot overflow the temperature encoding or hide an unknown row',()=>{
  const huge=P.resolveSelection([row('a',{grams:Number.MAX_VALUE/2,processingId:'a-heated'}),row('b',{grams:1})],d,processes,{basis:'grams'});
  assert.equal(huge.valid,true);assert.ok(huge.quant.range.every(Number.isFinite));
  const tinyUnknown=P.resolveSelection([row('a',{grams:Number.MIN_VALUE,processingId:'a-no-property'}),row('b',{grams:100})],d,processes,{basis:'grams'});
  assert.equal(tinyUnknown.quant.range,null);assert.deepEqual(plain(tinyUnknown.quant.unknownIds),['a']);
});
check('toxicity and compatibility survive low mass, custom processes and verified processing',()=>{
  const expected=plain(H.analyze([row('a'),row('b')],d).warnings);
  for(const processingId of ['source_unspecified','a-heated','a-no-property','custom_unverified']){
    const r=P.resolveSelection([row('a',{grams:.0001,processingId}),row('b',{grams:100})],d,processes,{basis:'grams'});
    assert.deepEqual(plain(r.analysis.warnings),expected);assert.deepEqual(plain(r.quant.warnings),expected);
    assert.deepEqual(plain(r.derivedData.herbs[0].toxic),fixtureHerbs[0].toxic);
  }
});
check('an empty workbench produces no fabricated mass or temperature evidence',()=>{
  const r=P.resolveSelection([],d,processes,{basis:'grams'});
  assert.equal(r.valid,true);assert.equal(r.massComplete,false);assert.equal(r.totalGrams,null);
  assert.equal(r.quant,null);assert.equal(r.partialMass,null);assert.equal(r.massDistribution,null);
  const research=P.resolveSelection([],d,processes);assert.equal(research.quant.range,null);assert.equal(research.quant.knownSubsetRange,null);
});
check('analysis resolves isolated copies and does not mutate the source library or recorded process',()=>{
  const before=plain(d),beforeP=plain(processes),rows=[row('a',{processingId:'a-heated',grams:5})],beforeRows=plain(rows);
  const r=P.resolveSelection(rows,d,processes);
  assert.deepEqual(plain(d),before);assert.deepEqual(plain(processes),beforeP);assert.deepEqual(rows,beforeRows);
  r.derivedData.herbs[0].toxic.note='changed';assert.equal(d.herbs[0].toxic.note,'歷史毒性記載');
  r.resolvedRows[0].profile.label='changed';assert.equal(processes.profiles[0].label,'炙用');
});
check('inherited toxicity source positions still point to original material text after branch rebasing',()=>{
  const copied=plain(d),h=copied.herbs[0],span=origin(h,'補氣');
  const originalSpan={...span,basis:'rawText'};delete originalSpan.herbId;
  h.historicalToxicity={status:'source_asserts_toxic',literalEntryStatements:[{quote:'補氣',evidenceSpan:originalSpan}]};
  const r=P.resolveSelection([row('a',{processingId:'a-heated'})],copied,processes),derived=r.derivedData.herbs[0],e=derived.historicalToxicity.literalEntryStatements[0].evidenceSpan;
  assert.equal(e.basis,'originalMaterialRawText');assert.equal(e.herbId,'a');
  assert.equal([...derived.originalMaterialRawText].slice(e.start,e.end).join(''),e.text);
  assert.equal(copied.herbs[0].historicalToxicity.literalEntryStatements[0].evidenceSpan.basis,'rawText');
});

const profilePath=path.join(base,'research/processing/profiles.json');
if(fs.existsSync(profilePath)){
  const collection=JSON.parse(fs.readFileSync(profilePath,'utf8'));
  check('every real processing profile has applicable identity and exact recorded source evidence',()=>{
    assert.ok(collection.profiles.length>0);const seen=new Set();
    for(const p of collection.profiles){
      assert.ok(!seen.has(p.id));seen.add(p.id);assert.ok(p.herbIds.length>0);
      for(const id of p.herbIds){
        assert.ok(real.herbs.some(h=>h.id===id));
        const r=P.resolveSelection([row(id,{processingId:p.id})],real,collection);
        assert.equal(r.valid,true,p.id);assert.equal(r.resolvedRows[0].rejectedPropertyEvidence.length,0,p.id);
        assert.deepEqual(plain(r.analysis.warnings),plain(H.analyze([row(id)],real).warnings),p.id);
      }
      for(const e of p.propertyEvidence||[])assert.equal(P.evidenceValid(e,real),true,p.id+' property evidence');
      for(const step of p.workflow||[])assert.equal(P.evidenceValid(step,real),true,p.id+' workflow evidence');
    }
  });
}
console.log(`${passed} processing and recorded-mass checks passed`);
