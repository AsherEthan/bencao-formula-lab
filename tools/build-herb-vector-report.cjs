'use strict';
/* Refit from frozen source inputs. Never import a previously scored report. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const bytes=p=>fs.readFileSync(path.join(root,p));
const read=p=>JSON.parse(bytes(p).toString('utf8'));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const stable=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(stable).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
const portable=value=>Array.isArray(value)?value.map(portable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!(k.toLowerCase().startsWith('local')&&k.toLowerCase().endsWith('path'))&&k!=='sourceTexts').map(([k,v])=>[k,portable(v)])):value;
const assertPortable=(value,where='$')=>{if(typeof value==='string'&&/(?:\/Users\/|\/tmp\/|\/private\/|\/home\/|file:\/\/)/.test(value))throw new Error('Local path in report '+where);if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))assertPortable(v,where+'.'+k);};
const context={};vm.createContext(context);
for(const name of ['inference-model.js','quant-model.js','herb-vector-model.js'])vm.runInContext(bytes('dist/'+name).toString('utf8'),context,{filename:name});
const api=context.HerbVectorModel;
if(!api||typeof api.fit!=='function'||typeof api.validate!=='function')throw new Error('HerbVectorModel API unavailable');
const data=read('research/herbs/herbs-and-formulas.json'),corpus=read('research/formulas-v3/formulas.json');
const snapshots=corpus.sources.map(s=>{const text=bytes('research/formulas-v3/'+s.snapshotFile);if(sha(text)!==s.snapshotSHA256)throw new Error('Source snapshot checksum mismatch '+s.id);return{id:s.id,sha256:sha(text),file:s.snapshotFile,text:text.toString('utf8')};});
const sourceTexts=Object.fromEntries(snapshots.map(s=>[s.id,s.text]));
const model=api.fit(data,{...corpus,sourceTexts});
const formulas=new Map(corpus.formulas.map(f=>[f.id,f]));
const withReferences=validation=>({...validation,contributionEncoding:'OOF terms retain bundleId and fitted additive contribution; each fold featureBundles supplies elementIds/support, sourceNames remain in the sealed corpus. Runtime predictions expose full details.',predictions:(validation.predictions||[]).map(p=>{const f=formulas.get(p.id);if(!f)throw new Error('OOF prediction has no source formula '+p.id);return{...p,terms:p.terms.map(t=>({...t,contributions:t.contributions.map(({bundleId,contribution})=>({bundleId,contribution}))})),reference:{sourceId:f.sourceId,sourceURL:f.sourceURL,sourceChapter:f.sourceChapter,rawIndications:f.rawIndications,profileEvidence:f.profileEvidence,indicationContextEvidence:f.indicationContextEvidence}};})});
const familyValidation=withReferences(api.validate(model,{folds:5,mode:'family'}));
const sourceBookValidation=withReferences(api.validate(model,{folds:3,mode:'sourceBook'}));
for(const [name,v]of Object.entries({familyValidation,sourceBookValidation})){if(!v.performed||!Array.isArray(v.predictions)||v.predictions.length!==corpus.formulas.length||new Set(v.predictions.map(p=>p.id)).size!==corpus.formulas.length)throw new Error(name+' did not independently predict every source formula');}
if(model.herbVectors.length!==data.herbs.length||model.training.elementStats.length!==corpus.sourceElements.length)throw new Error('Vector/element inventory is incomplete');
const dictionary=api.dictionary||context.InferenceModel.dictionary;
const herbInputFields=['id','name','sourceName','sourceId','rawText','nature','flavors','meridians','effects','evidenceSpans','reviewStatus','extractionStatus','modernSafety','identityNote'];
const inputSemantic={fields:herbInputFields,herbs:data.herbs.map(h=>Object.fromEntries(herbInputFields.map(k=>[k,h[k]===undefined?null:h[k]])))};
const methodologyFile='research/herb-vector-methodology.json';
const report=portable({
 schemaVersion:'herb-vector-report-1',generatedAt:new Date().toISOString(),version:api.version,dictionaryVersion:api.dictionaryVersion||context.InferenceModel.dictionaryVersion,
 provenance:{formulaDataset:{version:corpus.version,contentRevision:corpus.contentRevision,formulaCount:corpus.formulas.length,sha256:sha(bytes('research/formulas-v3/formulas.json')),sha256Scope:'sealed research/formulas-v3/formulas.json bytes'},herbDataset:{herbCount:data.herbs.length,inputFields:herbInputFields,semanticSha256:sha(stable(inputSemantic)),sha256Scope:'UTF-8 recursively sorted JSON of {fields:inputFields,herbs:[field-selected records]}; absent fields are null, rawText unchanged, local paths and JSON layout excluded'},model:{file:'dist/herb-vector-model.js',sha256:sha(bytes('dist/herb-vector-model.js')),dependencies:['inference-model.js','quant-model.js'].map(name=>({file:'dist/'+name,sha256:sha(bytes('dist/'+name))}))},dictionary:{sha256:sha(stable(dictionary)),sha256Scope:'UTF-8 recursively sorted JSON of exported fixed dictionary'},sourceSnapshots:snapshots.map(({id,sha256,file})=>({id,sha256,file}))},
 methodology:fs.existsSync(path.join(root,methodologyFile))?{file:methodologyFile,sha256:sha(bytes(methodologyFile))}:null,
 parameters:model.config,dictionary,eligibility:api.describeCorpus(model),
 herbVectors:model.herbVectors,elements:model.training.elementStats,featureBundles:model.training.featureBundles,
 training:{N:model.training.N,groupCount:model.training.groupCount,ready:model.training.ready,reasons:model.training.reasons,labels:model.training.labels,trainIds:model.training.trainIds,optimizer:model.training.optimizer},
 familyValidation,sourceBookValidation,
 meaning:'來源本草文字向量與由方劑成分學得的主治銀詞係數分列。本報告從封存正文實際重訓，按方族五折及來源書三折留出，將全部原方的組外預測和獨立來源主治對照。克數、炮製、主治文字與書名不作成分模型輸入。共現元素與欠支持維度保留不可辨識／未知；不是單味藥性因果、藥理或人體療效推估。'
});
assertPortable(report);
fs.mkdirSync(path.join(root,'dist/downloads'),{recursive:true});
if(process.argv.includes('--verify')){
 const saved=read('dist/downloads/herb-vector-report.json');
 const withoutTime=value=>{const copy={...value};delete copy.generatedAt;return copy;};
 if(stable(withoutTime(saved))!==stable(withoutTime(report)))throw new Error('Saved herb vector report differs from an actual refit from frozen inputs');
 process.stdout.write(JSON.stringify({actualRefitMatchesSavedReport:true,herbs:report.herbVectors.length,elements:report.elements.length,familyPredictions:familyValidation.predictions.length,sourceBookPredictions:sourceBookValidation.predictions.length})+'\n');
 process.exit(0);
}
fs.writeFileSync(path.join(root,'dist/downloads/herb-vector-report.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(root,'dist/herb-vector-data.js'),'window.HERB_VECTOR_DATA = '+JSON.stringify(report)+';\n');
const metricSummary=m=>m&&Object.fromEntries(['microF1','macroF1','brier'].map(k=>[k,m[k]]));
process.stdout.write(JSON.stringify({herbs:report.herbVectors.length,elements:report.elements.length,trainingRecords:report.training.N,trainingGroups:report.training.groupCount,family:{predictions:familyValidation.predictions.length,metrics:metricSummary(familyValidation.metrics),baseline:metricSummary(familyValidation.baselineMetrics),coverage:familyValidation.coverage},sourceBook:{predictions:sourceBookValidation.predictions.length,metrics:metricSummary(sourceBookValidation.metrics),baseline:metricSummary(sourceBookValidation.baselineMetrics),coverage:sourceBookValidation.coverage}})+'\n');
