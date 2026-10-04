'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'dist/inference-model.js'),'utf8'),context);
const d=read('research/herbs/herbs-and-formulas.json'),c=read('research/formulas-v3/formulas.json');
const sourceTexts=Object.fromEntries(c.sources.map(s=>[s.id,fs.readFileSync(path.join(root,'research/formulas-v3',s.snapshotFile),'utf8')]));
const model=context.InferenceModel.fit(d,{...c,sourceTexts});
const report={generatedAt:new Date().toISOString(),version:context.InferenceModel.version,dictionaryVersion:context.InferenceModel.dictionaryVersion,
 dataset:{version:c.version,contentRevision:c.contentRevision,formulaCount:c.formulas.length,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'research/formulas-v3/formulas.json'))).digest('hex'),sha256Scope:'sealed research/formulas-v3/formulas.json bytes',sourceSnapshots:c.sources.map(s=>({id:s.id,sha256:s.snapshotSHA256}))},
 parameters:model.config,dictionary:context.InferenceModel.dictionary,eligibility:model.summary,
 familyValidation:context.InferenceModel.validate(model,{folds:5}),
 sourceBookValidation:context.InferenceModel.validate(model,{folds:3,mode:'sourceBook'}),
 meaning:'固定銀詞字典從來源主治取標籤，原名成分presence作輸入；本報告實際重新按組訓練並計算留出結果。不是盲法人工標籤、單味藥性因果辨識或臨床驗證。'};
// Runtime configuration must remain portable; source text snapshots are inputs, not public inline parameters.
if(report.parameters)delete report.parameters.sourceTexts;
fs.mkdirSync(path.join(root,'dist/downloads'),{recursive:true});fs.writeFileSync(path.join(root,'dist/downloads/inference-validation.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(root,'dist/inference-validation.js'),'window.INFERENCE_VALIDATION = '+JSON.stringify(report)+';\n');
process.stdout.write(JSON.stringify({formulas:c.formulas.length,performed:report.familyValidation.performed,metrics:report.familyValidation.metrics&&{microF1:report.familyValidation.metrics.microF1,macroF1:report.familyValidation.metrics.macroF1,brier:report.familyValidation.metrics.brier},baseline:report.familyValidation.baselineMetrics&&{microF1:report.familyValidation.baselineMetrics.microF1,macroF1:report.familyValidation.baselineMetrics.macroF1,brier:report.familyValidation.baselineMetrics.brier},coverage:report.familyValidation.coverage})+'\n');
