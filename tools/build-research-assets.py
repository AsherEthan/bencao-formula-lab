#!/usr/bin/env python3
"""Rebuild saved research assets offline; original acquisition/collation is separate."""
import json, pathlib, zipfile, hashlib, csv, re, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
def read(p):return json.loads(pathlib.Path(p).read_text())
def public_metadata(value):
 if isinstance(value,dict):
  out={}
  for key,item in value.items():
   if key.lower().startswith('local') and key.lower().endswith('path'):continue
   if key=='parserFile':item='tools/extract-herbs.py'
   elif key=='formulaParserFile':item='tools/extract-formulas.py'
   out[key]=public_metadata(item)
  return out
 if isinstance(value,list):return [public_metadata(item) for item in value]
 return value
def assert_public_metadata(value,location='$'):
 if isinstance(value,dict):
  for key,item in value.items():assert_public_metadata(item,location+'.'+key)
 elif isinstance(value,list):
  for i,item in enumerate(value):assert_public_metadata(item,location+'['+str(i)+']')
 elif isinstance(value,str) and re.search(r'(?:/Users/|/tmp/|/private/|/home/|file://)',value):
  raise ValueError('Public metadata contains a local storage location at '+location)
def source_text(book):
 saved=ROOT/'research/corpus'/f"{book['id']}.txt"
 candidates=[saved]
 if book.get('localTextPath'):
  legacy=pathlib.Path(book['localTextPath']);candidates.append(legacy if legacy.is_absolute() else ROOT/legacy)
 for path in candidates:
  if path.is_file():
   text=path.read_text(encoding='utf-8')
   if book.get('textSha256') and hashlib.sha256(text.encode()).hexdigest()!=book['textSha256']:
    raise ValueError('Saved text checksum mismatch: '+book['id'])
   return text
 raise FileNotFoundError('Restore research/corpus/'+book['id']+'.txt before rebuilding.')
d=read(ROOT/'research/herbs/herbs-and-formulas.json')
c=read(ROOT/'research/corpus/catalog.json')
m=read(ROOT/'research/methodology/frameworks.json')
fc=public_metadata(read(ROOT/'research/formulas-v3/formulas.json'))
im=public_metadata(read(ROOT/'research/inference-methodology.json'))
processing=public_metadata(read(ROOT/'research/processing/profiles.json'))
processing_method=public_metadata(read(ROOT/'research/processing-model-methodology.json'))
processing_review=public_metadata(read(ROOT/'research/processing/review.json'))
processing_source_checks=public_metadata(read(ROOT/'research/processing/source-checks.json'))
vector_method=public_metadata(read(ROOT/'research/herb-vector-methodology.json'))
vector_review_path=ROOT/'research/herb-vector-review.json'
vector_review=public_metadata(read(vector_review_path)) if vector_review_path.is_file() else None
# Preflight the portable inputs before overwriting public output.
texts={b['id']:source_text(b) for b in c['books'] if b['status']=='fulltext'}
if len(texts)!=c['counts']['fulltextDownloaded']:raise ValueError('Catalogue full-text status/count mismatch')
for h in d['herbs']:
 h['section']=h.get('section') or h.get('sourceSection','')+'・'+h.get('sourceName',h['name'])
 if not h.get('toxic') and h.get('historicalToxicity',{}).get('status')=='source_asserts_toxic':
  h['toxic']={'sourceId':h['sourceId'],'note':'此版本開頭屬性段明載毒性；自動摘錄待逐條核對。歷史分類不替代現代毒理評估。','quote':'；'.join(h['historicalToxicity'].get('statements',[]))}
for f in d['formulas']:
 f['ingredientSummary']=f.get('ingredientSummary') or '、'.join(x['sourceName'] for x in f.get('ingredientRefs',[]))
for s in d['sources']:s['kind']=s.get('kind','classical')
d=public_metadata(d);m=public_metadata(m)
meta=public_metadata(c)
for value in [d,meta,m,fc,im,processing,processing_method,processing_review,processing_source_checks,vector_method,vector_review]:assert_public_metadata(value)
for p in [ROOT/'dist',ROOT/'dist/texts',ROOT/'dist/downloads',ROOT/'research/corpus']:p.mkdir(parents=True,exist_ok=True)
# Preserve code point offsets and original source strings. Never normalize rawText.
(ROOT/'dist/data.js').write_text('window.HERB_DATA = '+json.dumps(d,ensure_ascii=False)+';\n')
for b in meta['books']:
 if b['status']=='fulltext':
  text=texts[b['id']]
  path=ROOT/'research/corpus'/f"{b['id']}.txt";path.write_text(text)
  b['textAsset']='texts/'+b['id']+'.json';b['textSha256']=hashlib.sha256(text.encode()).hexdigest()
  (ROOT/'dist'/b['textAsset']).write_text(json.dumps({'id':b['id'],'title':b['title'],'url':b['url'],'edition':b.get('edition'),'text':text,'sha256':b['textSha256'],'limits':'完整來源單頁轉錄，未對原刻本逐字校勘；全文取得不等於已完成結構化或學習。'},ensure_ascii=False))
(ROOT/'dist/corpus-data.js').write_text('window.CORPUS_DATA = '+json.dumps(meta,ensure_ascii=False)+';\n')
(ROOT/'dist/methodology-data.js').write_text('window.METHODOLOGY_DATA = '+json.dumps(m,ensure_ascii=False)+';\n')
(ROOT/'dist/formula-corpus.js').write_text('window.FORMULA_CORPUS = '+json.dumps(fc,ensure_ascii=False)+';\n')
(ROOT/'dist/processing-data.js').write_text('window.PROCESSING_DATA = '+json.dumps(processing,ensure_ascii=False)+';\n')
for name, value in [('herbs-and-formulas.json',d),('corpus-catalog.json',meta),('methodology.json',m),('formula-corpus.json',fc),('inference-methodology.json',im),('processing-profiles.json',processing),('processing-methodology.json',processing_method),('processing-review.json',processing_review),('processing-source-checks.json',processing_source_checks)]:
 (ROOT/'dist/downloads'/name).write_text(json.dumps(value,ensure_ascii=False,indent=2))
(ROOT/'dist/downloads/herb-vector-methodology.json').write_text(json.dumps(vector_method,ensure_ascii=False,indent=2))
if vector_review is not None:(ROOT/'dist/downloads/herb-vector-review.json').write_text(json.dumps(vector_review,ensure_ascii=False,indent=2))
with (ROOT/'dist/downloads/processing-profiles.csv').open('w',newline='',encoding='utf-8-sig') as f:
 writer=csv.writer(f);writer.writerow(['profileId','分支名稱','適用本草id','類別','分支性味原詞','味原詞','歸經原詞','功用原詞','工藝步驟數','屬性證據數','短句核查狀態','現代標準對應','現代安全','來源短句','來源id','限制'])
 for p in processing['profiles']:
  a=p['attributes'];writer.writerow([p['id'],p['label'],'/'.join(p['herbIds']),p['kind'],a.get('nature') or '未錄','/'.join(a.get('flavors',[])),'/'.join(a.get('meridians',[])),'/'.join(a.get('effects',[])),len(p['workflow']),len(p['propertyEvidence']),p['verificationStatus'],p['modernStandardCorrespondence'],p['modernSafety'],'；'.join(q['text'] for q in p['sourceQuotes']),'/'.join(sorted({q['sourceId'] for q in p['sourceQuotes']})),'；'.join(p['limitations'])])
with (ROOT/'dist/downloads/processing-workflows.csv').open('w',newline='',encoding='utf-8-sig') as f:
 writer=csv.writer(f);writer.writerow(['profileId','分支名稱','步驟序位','工藝原詞','步驟註記','來源id','基底本草id','原文','Unicode起位','Unicode止位','溫度C','分鐘','批量克數','輔料克數'])
 for p in processing['profiles']:
  for i,step in enumerate(p['workflow'],1):
   e=step['evidenceSpan'];params=step.get('parameters',{});writer.writerow([p['id'],p['label'],i,step['label'],step['note'],step['sourceId'],e['herbId'],e['text'],e['start'],e['end'],params.get('temperatureC'),params.get('durationMinutes'),params.get('batchMassGrams'),params.get('auxiliaryMassGrams')])
with (ROOT/'dist/downloads/formulas.csv').open('w',newline='',encoding='utf-8-sig') as f:
 writer=csv.writer(f);writer.writerow(['id','原方名','來源','章節','原名元素','精確映射數','原方元素數','原文主治','詞族標組','元素集合標組','核對狀態','原文URL'])
 for r in fc['formulas']:writer.writerow([r['id'],r['name'],r['sourceBook'],r['sourceChapter'],'/'.join(x['sourceName'] for x in r['ingredientRefs']),sum(bool(x['id']) for x in r['ingredientRefs']),len(r['ingredientRefs']),r['rawIndications'],r['familyId'],r['textElementSetGroupId'],r['reviewStatus'],r['sourceURL']])
with (ROOT/'dist/downloads/formula-elements.csv').open('w',newline='',encoding='utf-8-sig') as f:
 writer=csv.writer(f);elements=fc['sourceElements'];writer.writerow(['formulaId','原方名']+[e['sourceName']+'|'+e['id'] for e in elements])
 for r in fc['formulas']:
  present=set(r['sourceElementIds']);writer.writerow([r['id'],r['name']]+[int(e['id'] in present) for e in elements])
subprocess.run(['node',str(ROOT/'tools/build-inference-report.cjs')],cwd=ROOT,check=True)
inference_report=read(ROOT/'dist/downloads/inference-validation.json');assert_public_metadata(inference_report)
subprocess.run(['node',str(ROOT/'tools/build-herb-vector-report.cjs')],cwd=ROOT,check=True)
vector_report=read(ROOT/'dist/downloads/herb-vector-report.json');assert_public_metadata(vector_report)
json_cell=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':'))
with (ROOT/'dist/downloads/herb-vectors.csv').open('w',newline='',encoding='utf-8-sig') as f:
 writer=csv.writer(f);writer.writerow(['herbId','古籍名稱','來源id','節錄核對','來源文字向量JSON','成分學得向量JSON'])
 herb_by_id={h['id']:h for h in d['herbs']}
 for v in vector_report['herbVectors']:
  h=herb_by_id[v.get('id',v.get('herbId'))];writer.writerow([h['id'],h['name'],h['sourceId'],h.get('reviewStatus'),json_cell({k:value for k,value in v.items() if k!='learned'}),json_cell(v.get('learned',{}))])
with (ROOT/'dist/downloads/element-coefficients.csv').open('w',newline='',encoding='utf-8-sig') as f:
 writer=csv.writer(f);writer.writerow(['elementId','原名元素','本草文字對映id','文字對映狀態','出現方數','出現群數','缺席群數','可報告','限制原因','完全同現元素id','銀詞id','銀詞名稱','維度有支持','個別係數','截距','訓練基率','維度限制'])
 element_by_id={e['id']:e for e in fc['sourceElements']}
 for e in vector_report['elements']:
  literal=element_by_id[e['elementId']]
  for t in e['coefficients']:
   writer.writerow([e['elementId'],literal['sourceName'],literal.get('catalogHerbId'),literal['mappingStatus'],e['support'],e['presentGroups'],e['absentGroups'],e['reportable'],e.get('reason'),'/'.join(e.get('identicalOccurrenceElements',[])),t['id'],t['label'],t['supported'],t.get('coefficient'),t.get('intercept'),t.get('baselineScore'),t.get('reason')])
with (ROOT/'dist/downloads/formula-forward-predictions.csv').open('w',newline='',encoding='utf-8-sig') as f:
 writer=csv.writer(f);writer.writerow(['留出方式','formulaId','原方名','來源書','隔離群','折','未預測','未預測原因','獨立原文主治','原文銀詞id','銀詞id','銀詞名稱','組外模型分數','同折基率','組外logOdds','截距','來源命中','模型命中','文字元素覆蓋','本草對映覆蓋','支持元素覆蓋','原文URL'])
 for mode in ['familyValidation','sourceBookValidation']:
  for p in vector_report[mode]['predictions']:
   for t in p['terms'] or [{}]:
    writer.writerow([mode,p['id'],p['name'],p['sourceBook'],p['groupId'],p['fold'],p['abstained'],'/'.join(p.get('reasons',[])),p['reference']['rawIndications'],'/'.join(p['actualLabelIds'] or []),t.get('id'),t.get('label'),t.get('modelScore'),t.get('baselineScore'),t.get('logOdds'),t.get('intercept'),t.get('actual'),t.get('predicted'),p.get('textElementCoverage'),p.get('catalogMappingCoverage'),p.get('supportedElementCoverage'),p['reference']['sourceURL']])
review=public_metadata(read(ROOT/'research/formulas-v3/research-review.json'));assert_public_metadata(review)
(ROOT/'dist/downloads/formula-research-review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2))
with (ROOT/'dist/downloads/herbs.csv').open('w',newline='',encoding='utf-8-sig') as f:
 writer=csv.writer(f);writer.writerow(['id','古籍名稱','性','味','歸經原詞','功用原詞','節錄核對','現代安全','來源'])
 for h in d['herbs']:writer.writerow([h['id'],h['name'],h.get('nature',''),'/'.join(h.get('flavors',[])),'/'.join(h.get('meridians',[])),'/'.join(h.get('effects',[])),h.get('reviewStatus'),h.get('modernSafety','unknown'),next(s['url'] for s in d['sources'] if s['id']==h['sourceId'])])
processing_counts={'profiles':len(processing['profiles']),'sourceHerbEntries':len({hid for p in processing['profiles'] for hid in p['herbIds']}),'workflowSteps':sum(len(p['workflow']) for p in processing['profiles']),'propertyEvidence':sum(len(p['propertyEvidence']) for p in processing['profiles']),'sourceQuotes':sum(len(p['sourceQuotes']) for p in processing['profiles']),'knownNatureProfiles':sum(bool(p['attributes'].get('nature')) for p in processing['profiles']),'unknownNatureProfiles':sum(not p['attributes'].get('nature') for p in processing['profiles']),'modernStandardCorrespondence':'unresolved','clinicalDoseModel':'not_implemented','historicalUnitConversion':'not_implemented','meaning':'來源限定炮製分支及工藝節錄；克數僅為使用者實錄研究稱量，不代表服用劑量或藥效。'}
report={'clientDate':'2026-10-04','catalogue':meta['counts'],'herbs':d['qaReport'],'curatedFormulaRecords':len(d['formulas']),'newFormulaCorpus':fc['qaReport'],'processing':processing_counts,'inferenceValidation':{'performed':inference_report['familyValidation']['performed'],'grouping':'lexical family / same name / same element set connected groups','metrics':inference_report['familyValidation']['metrics'],'baselineMetrics':inference_report['familyValidation']['baselineMetrics'],'coverage':inference_report['familyValidation']['coverage'],'meaning':'歷史主治銀詞；不是臨床藥性驗證'},'modelMeaning':'文獻特徵編碼、成分至歷史主治詞推估、既有方描述、炮製原詞及實錄質量的文獻標籤分布；不是藥理、療效或安全預測。','notCompleted':['全世界所有中醫典籍與原刻版本盤點','新增本草與方劑逐條雙人校勘與現代身份核定',f"原有{len(d['formulas'])}方與新增語料的獨立盲法人工方義標註",'完整歷史方族譜系核定與外部來源驗證','古代炮製與現代規格的逐項對照、批次檢驗與工藝終點核定','藥代、毒理、化學交互作用及臨床劑量反應驗證'],'reproduction':['以封存研究JSON及research/corpus正文離線重建衍生JSON、JavaScript資產、CSV、分組驗證報告、炮製原詞資產與ZIP，不重新抓取或校勘原典。','來源文本SHA-256已保存；驗證腳本核對正文、引句及Unicode code point evidenceSpans。','定量編碼及詞典在quant-model.js、inference-model.js與processing-model.js公開；目錄條目數不表示已全文閱讀或學習。','原來源HTML取得與解析輸入、轉錄校勘和人工標註另需網絡與研究工作；抓取參考不代表全部原始研究可離線重現。','炮製provenance.inputSha256是最初研究JSON字節快照；離線封存的公開本草JSON經位置資訊清理和格式化，字節不必相同。全部炮製字位仍按未正規化的herb rawText逐字核驗。']}
report['herbVectors']={'herbs':len(vector_report['herbVectors']),'literalElements':len(vector_report['elements']),'trainingRecords':vector_report['training']['N'],'trainingGroups':vector_report['training']['groupCount'],'individualReportableElements':sum(e['reportable'] for e in vector_report['elements']),'provenance':vector_report['provenance'],'familyValidation':{k:vector_report['familyValidation'].get(k) for k in ['performed','metrics','baselineMetrics','coverage']},'sourceBookValidation':{k:vector_report['sourceBookValidation'].get(k) for k in ['performed','metrics','baselineMetrics','coverage']},'meaning':vector_report['meaning']}
report['reproduction'].append('herb-vector-model.js 從原名成分矩陣實際重訓係數，按方族五折與來源書三折分別產生全部原方的組外預測。模型、字典、來源快照與封存公式JSON的SHA-256隨報告公開；本草以明列欄位的語義hash核驗，避免公開排版造成字節差異。')
(ROOT/'dist/downloads/research-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
with zipfile.ZipFile(ROOT/'dist/downloads/tcm-research-library.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for name in ['LICENSE','DATA-LICENSE.md','THIRD_PARTY_NOTICES.md']:
  notice=ROOT/name
  if notice.is_file():z.write(notice,name)
 for p in sorted((ROOT/'dist/downloads').iterdir()):
  if p.suffix in ['.json','.csv']:z.write(p,'data/'+p.name)
 # Canonical input layout lets the packaged build tool work after ZIP extraction.
 for name,value in [('research/herbs/herbs-and-formulas.json',d),('research/corpus/catalog.json',meta),('research/methodology/frameworks.json',m)]:z.writestr(name,json.dumps(value,ensure_ascii=False,indent=2))
 for book_id in sorted(texts):z.write(ROOT/'research/corpus'/f'{book_id}.txt',f'research/corpus/{book_id}.txt')
 for p in sorted((ROOT/'research/herbs/source-snapshots').glob('*.txt')):z.write(p,'research/herbs/source-snapshots/'+p.name)
 for p in sorted((ROOT/'research/formulas-v3').rglob('*')):
  if p.is_file() and 'raw' not in p.relative_to(ROOT/'research/formulas-v3').parts and p.suffix in ['.json','.txt']:z.write(p,str(p.relative_to(ROOT)))
 z.writestr('research/inference-methodology.json',json.dumps(im,ensure_ascii=False,indent=2))
 for p in sorted((ROOT/'research/processing').rglob('*')):
  if p.is_file() and p.suffix in ['.json','.txt']:z.write(p,str(p.relative_to(ROOT)))
 z.write(ROOT/'research/processing-model-methodology.json','research/processing-model-methodology.json')
 z.write(ROOT/'research/herb-vector-methodology.json','research/herb-vector-methodology.json')
 if vector_review_path.is_file():z.write(vector_review_path,'research/herb-vector-review.json')
 z.write(ROOT/'dist/herb-vector-data.js','dist/herb-vector-data.js')
 for p in sorted((ROOT/'tools').iterdir()):
  if p.suffix in ['.py','.cjs'] or p.name=='README.txt':z.write(p,'tools/'+p.name)
 for name in ['model.js','quant-model.js','inference-model.js','processing-model.js','herb-vector-model.js']:
  z.write(ROOT/'dist'/name,'model/'+name);z.write(ROOT/'dist'/name,'dist/'+name)
 for p in sorted((ROOT/'checks').rglob('*')):
  if p.is_file() and p.suffix in ['.cjs','.js','.json','.txt']:z.write(p,str(p.relative_to(ROOT)))
 z.writestr('README.txt',(ROOT/'tools/README.txt').read_text(encoding='utf-8'))
 z.writestr('SOURCE-NOTES.txt','正文為公開來源的古籍轉錄；書目版名與源頁名差異保留。14部全文不等於全部古籍已學習。資料與模型不提供可服用處方、服用劑量或人體藥效／安全結論。古籍可能包含製備與服用記載，僅供歷史文獻研究。工作台克數為使用者實錄稱量，並非古代量制換算；炮製分支為歷史節錄，現代飲片規格對應仍未知。\n中醫笈成文本授權：https://jicheng.tw/tcm/copyright.html\n维基文库古籍轉錄來源見data/herbs-and-formulas.json；版本與逐字校勘需另核。炮製規範與原始研究僅提供自寫摘要和來源連結，未複製現代圖譜與全文。\n')
print(json.dumps({'herbs':len(d['herbs']),'curatedFormulas':len(d['formulas']),'newFormulaCorpus':len(fc['formulas']),'catalogue':len(c['books']),'fulltexts':c['counts']['fulltextDownloaded'],'processing':processing_counts,'bundleBytes':(ROOT/'dist/downloads/tcm-research-library.zip').stat().st_size},ensure_ascii=False))
