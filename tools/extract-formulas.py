#!/usr/bin/env python3
"""Reference parser requiring separately acquired HTML and herbs-intermediate.json.
Set TCM_EXTRACTION_DIR to the same input/output folder as extract-herbs.py.
This does not acquire sources or reproduce manual collation/annotation decisions.
"""
import json,re,html,pathlib,hashlib,collections,os
from urllib.parse import quote
ROOT=pathlib.Path(os.environ.get('TCM_EXTRACTION_DIR',str(pathlib.Path(__file__).resolve().parents[1]/'research/raw-wikisource'))).expanduser()
d=json.loads((ROOT/'herbs-intermediate.json').read_text())
def clean(s):
 s=re.sub(r'<[^>]+>','',s);s=html.unescape(s)
 return '\n'.join(x.strip() for x in s.splitlines() if x.strip())
def ev(txt,label,field):
 p=txt.find(label);assert p>=0,(label,field)
 return {'field':field,'text':label,'start':p,'end':p+len(label),'basis':'rawText','offsetUnit':'unicode_code_point'}
# Add the unqualified historical 芍藥 and uncombined 乾薑 entries; do not collapse them into 白芍 or 乾薑、黑姜.
raw=(ROOT/'shennong.html').read_text();head=list(re.finditer(r'<h([1-6])([^>]*)>([\s\S]*?)</h[1-6]>',raw))
for anchor,hid,name,aliases in [('芍藥','shaoyao-historical','芍藥',[]),('干薑','ganjiang-historical','乾薑',['干薑'])]:
 m=next(x for x in head if re.search('id="'+anchor+'"',x.group(2)));i=head.index(m);end=head[i+1].start();txt=clean(raw[m.end():end]);txt=re.sub(r'^\[編輯\]\n?','',txt)
 sid='shennong-'+hid;first=txt.splitlines()[0];q=first.split('。')[0]+'。'
 flavors=[x for x in ['甘','苦','酸','辛','鹹'] if x in q]
 nature=next((x for x in ['寒','溫','平','熱','涼'] if x in q),'未知（此擷取未明載）')
 d['sources'].append({'id':sid,'title':'《神農本草經（孫星衍輯本）》','url':'https://zh.wikisource.org/zh-hant/神農本草經_(孫星衍)#'+quote(anchor),'section':'卷二・中經・'+anchor,'kind':'classical','note':'自動擷取原名條目；不將不分赤白的芍藥或乾薑與其他加工品合併。'})
 d['herbs'].append({'id':hid,'name':name,'sourceName':anchor,'aliases':aliases,'sourceId':sid,'quote':q,'rawText':txt,'nature':nature,'flavors':flavors,'meridians':[],'effects':[],'summary':'古籍原名條目；尚未核定現代品種、部位與加工身份。','identityNote':'本輯本原名「'+anchor+'」，不推定現代品種、部位或加工；若來源方劑也用此原名，只建立文字身份對應。','extractionStatus':'automatic_conservative','reviewStatus':'automatically_extracted_not_individually_reviewed','evidenceSpans':[ev(txt,q,'quote')],'modernSafety':'unknown','historicalToxicity':{'status':'unknown','statements':[],'modernSafety':'unknown'},'materialType':'plant_related_historical_material','materialTypeNote':'不代表物種基原已核定。'})
byname={h.get('sourceName',h['name']):h['id'] for h in d['herbs']}
# Resolve only exactly identified source-entry names; historical spelling/processing relations are explicit.
preferred={h['name']:h['id'] for h in d['herbs'][:24]}
exact={**byname,**preferred,'芍藥':'shaoyao-historical','乾薑':'ganjiang-historical'}
def ref(name,preparation='',scope='core',force=None):
 hid=exact.get(name);status='exact' if hid else 'unresolved'
 if force is not None:hid,status=force
 return {'id':hid,'sourceName':name,'preparation':preparation,'scope':scope,'mappingStatus':status,'researchWeight':1,'weightNote':'等權研究索引；不是古方比例或服藥劑量。'}
# Upgrade the 4 existing formula records without changing their user-visible IDs/source IDs.
for f in d['formulas']:
 f['traditionalProfileLabels']=[];f['profileEvidence']=[];f['researchWeightPolicy']='equal_nonclinical';f['reviewStatus']='manually_verified_ingredient_names'
 if f['id']=='sijunzi':
  f['ingredientRefs']=[ref('人參','原文：去蘆'),ref('甘草','原文：炙'),ref('茯苓','原文：去皮'),ref('白朮')]
  f['traditionalProfileLabels']=['溫和脾胃','進益飲食'];f['profileEvidence']=[{'text':'常服溫和脾胃，進益飲食','sourceId':f['sourceId']}]
 elif f['id']=='guizhitang':
  f['ingredientRefs']=[ref('桂枝','原文：去皮'),ref('芍藥'),ref('甘草','原文：炙'),ref('生薑','原文：切'),ref('大棗','原文：擘')]
  f['traditionalProfileLabels']=['解肌'];f['profileEvidence']=[{'text':'桂枝本為解肌','sourceId':f['sourceId']}]
  f['note']='原文芍藥未分赤白；本擴充資料以獨立「芍藥」歷史條目對應，保留白芍為另一条目。所示成分是文獻集合，不是處方。'
 elif f['id']=='liuwei':
  f['ingredientRefs']=[ref('熟地黃'),ref('山萸肉','原文部位註記：肉',force=('shanzhuyu','historical_mapping')),ref('乾山藥','原文：乾',force=('shanyao','historical_mapping')),ref('澤瀉'),ref('牡丹皮'),ref('白茯苓','原文：去皮',force=('fuling','historical_mapping'))]
  f['traditionalProfileLabels']=['補肝腎'];f['profileEvidence']=[{'text':'補肝腎，地黃丸','sourceId':f['sourceId']}]
 elif f['id']=='erchen':
  f['ingredientRefs']=[ref('半夏','原文記炮製，詳原典'),ref('橘紅',force=('chenpi','historical_mapping')),ref('白茯苓',force=('fuling','historical_mapping')),ref('甘草','原文：炙'),ref('生薑',scope='auxiliary'),ref('烏梅',scope='auxiliary')]
  f['traditionalProfileLabels']=['痰飲'];f['profileEvidence']=[{'text':'治痰飲為患','sourceId':f['sourceId']}]
 f['herbIds']=[r['id'] for r in f['ingredientRefs'] if r['id'] and r['scope']=='core']
# Source names below were independently checked against the cached original ingredient line.
# No quantity, method or claimed effect is generated from ingredient lists.
SPECS=[
 ('mahuangtang','麻黃湯','shanghan',['麻黃','桂枝','甘草','杏仁'],{'麻黃':'去節','桂枝':'去皮','甘草':'炙','杏仁':'去皮尖'}),
 ('gegentang','葛根湯','shanghan',['葛根','麻黃','桂枝','芍藥','甘草','生薑','大棗'],{'麻黃':'去節','桂枝':'去皮','甘草':'炙','生薑':'切','大棗':'擘'}),
 ('xiaochaihu','小柴胡湯','shanghan',['柴胡','黃芩','人參','半夏','甘草','生薑','大棗'],{'半夏':'洗','甘草':'炙','生薑':'切','大棗':'擘'}),
 ('banxiaxiexin','半夏瀉心湯','shanghan',['半夏','黃芩','乾薑','人參','甘草','黃連','大棗'],{'半夏':'洗','甘草':'炙','大棗':'擘'}),
 ('xiaoqinglong','小青龍湯','shanghan',['麻黃','芍藥','細辛','乾薑','甘草','桂枝','五味子','半夏'],{'麻黃':'去節','甘草':'炙','桂枝':'去皮','半夏':'洗'}),
 ('baihutang','白虎湯','shanghan',['知母','石膏','甘草','粳米'],{'石膏':'碎','甘草':'炙'}),
 ('wulingsan','五苓散','shanghan',['豬苓','澤瀉','白朮','株茯苓','桂枝'],{'豬苓':'去皮','桂枝':'去皮'}),
 ('lizhongwan','理中丸','shanghan',['人參','乾薑','甘草','白朮'],{'甘草':'炙'}),
 ('sinitang','四逆湯','shanghan',['甘草','乾薑','附子'],{'甘草':'炙','附子':'生用；原文有其他加工／部位註記'}),
 ('zhenwutang','真武湯','shanghan',['茯苓','芍藥','生薑','白朮','附子'],{'生薑':'切','附子':'炮；原文有其他加工／部位註記'}),
 ('dangguishini','當歸四逆湯','shanghan',['當歸','桂枝','芍藥','細辛','甘草','通草','大棗'],{'桂枝':'去皮','甘草':'炙','大棗':'擘'}),
 ('shaoyaogancao','芍藥甘草湯','shanghan',['芍藥','甘草'],{'甘草':'炙'}),
 ('suanzaoren','酸棗仁湯','jinkui',['酸棗仁','甘草','知母','茯苓','芎藭'],{}),
 ('lingguizhugan','茯苓桂枝白朮甘草湯','shanghan',['茯苓','桂枝','白朮','甘草'],{'桂枝':'去皮','甘草':'炙；原文註記位置需核對'})
]
records=[]
for fid,name,book,names,prep in SPECS:
 raw=(ROOT/(book+'.html')).read_text();marker=name+'方'
 # Exact dt title excludes 桂枝加葛根湯 and ingredient instructions mentioning other formulas.
 match=re.search(r'<dt>\s*'+re.escape(marker)+r'[：:]?\s*</dt>\s*<dd>([\s\S]*?)</dd>',raw)
 if not match:raise ValueError(('formula not found',name))
 ing=clean(match.group(1));start=match.start()
 heads=list(re.finditer(r'<h([1-6])([^>]*)>([\s\S]*?)</h[1-6]>',raw))
 hs=[x for x in heads if x.start()<start and int(x.group(1)) in [2,3]];h=hs[-1];section=clean(h.group(3));anchor=re.search('id="([^"]+)"',h.group(2)).group(1)
 base='https://zh.wikisource.org/zh-hant/'+('傷寒論' if book=='shanghan' else '金匱要略');sid='formula-source-'+fid
 d['sources'].append({'id':sid,'title':'《'+('傷寒論' if book=='shanghan' else '金匱要略')+'》','url':base+'#'+quote(anchor),'section':section+'・'+marker,'kind':'classical','note':'方名及原文成分逐一核對；份量和製備過程不作模型或操作建議。'})
 for n in names:assert n in ing,(name,n,ing)
 refs=[ref(n,('原文：'+prep[n]) if n in prep else '') for n in names]
 # Transcription '株茯苓' is kept unresolved, not silently repaired to 茯苓.
 note='保留原文藥名和加工註記；研究權重均為 1，與原方比例無關。尚未取得獨立功用標籤證據，故不由藥材性味推導方劑功能。'
 if name=='五苓散':note+='此轉錄將一味記為「株茯苓」，待影印本覆核，暫不替換成茯苓。'
 if name=='當歸四逆湯':note+='古代通草與現代藥材名稱對應仍有版本與基原問題；只建立原名文字關係。'
 aux=[]
 if name=='酸棗仁湯':
  aux=[ref('生薑',scope='auxiliary')];note+='原文另記「深師有生薑」，作版本附加成分保存。芎藭因草藥轉錄章題缺字而保留未解析。'
 f={'id':fid,'name':name,'herbIds':[r['id'] for r in refs if r['id']], 'sourceId':sid,'quote':marker,'note':note,'sourceName':name,'ingredientRefs':refs+aux,'traditionalProfileLabels':[],'profileEvidence':[],'reviewStatus':'manually_verified_ingredient_names','researchWeightPolicy':'equal_nonclinical','rawIngredientText':ing,'rawEvidenceSpans':[ev(ing,n,'ingredientName') for n in names],'ingredientCount':len(names),'sourceSection':section,'sourceHTMLPosition':{'start':match.start(),'end':match.end(),'file':book+'.html'}}
 d['formulas'].append(f);records.append(f)
# Exact raw ingredient lines for the original four, with auxiliary evidence kept separate.
initial_lines={
 'sijunzi':('jufang','人參（去蘆）甘草（炙）茯苓（去皮）白朮（各等分）'),
 'liuwei':('xiaoer','熟地黃（八錢）山萸肉乾山藥（各四錢）澤瀉牡丹皮白茯苓（去皮各三錢）'),
 'erchen':('jufang','半夏（湯洗七次）橘紅（各五兩）白茯苓（三兩）甘草（炙，一兩半）')
}
for f in d['formulas'][:4]:
 if f['id']=='guizhitang':
  rf=(ROOT/'shanghan.html').read_text();mt=re.search(r'<dt>桂枝湯方</dt>\s*<dd>([\s\S]*?)</dd>',rf);txt=clean(mt.group(1));book='shanghan'
 else:
  book,txt=initial_lines[f['id']];assert txt in clean((ROOT/(book+'.html')).read_text())
 f['rawIngredientText']=txt;f['rawEvidenceSpans']=[]
 for r in f['ingredientRefs']:
  if r['scope']=='core':
   assert r['sourceName'] in txt,(f['id'],r)
   f['rawEvidenceSpans'].append(ev(txt,r['sourceName'],'ingredientName'))
 f['ingredientCount']=sum(r['scope']=='core' for r in f['ingredientRefs'])
 f['sourceHTMLPosition']={'file':book+'.html','note':'名稱和成分原句逐一比對；原份量只存文獻原句，不作模型。'}
 if f['id']=='erchen':
  f['rawAuxiliaryEvidenceText']='用水一錢，生薑七片，烏梅一個，同煎六分';assert f['rawAuxiliaryEvidenceText'] in clean((ROOT/'jufang.html').read_text())
# Supplementary material-type sources only support catalogue type, not classical efficacy attributes.
d['sources'] += [
 {'id':'taxonomy-fuling','title':'香港理工大學：茯苓','url':'https://herbaltcm.sn.polyu.edu.hk/tc/herbal/indian-bread','section':'來源／藥用部位','kind':'taxonomy','note':'校方資料庫明述真菌菌核；只支持編目類別，不把現代性味覆寫古籍。','verification':'opened_primary_page'},
 {'id':'taxonomy-zhuling','title':'香港理工大學：豬苓','url':'https://herbaltcm.sn.polyu.edu.hk/herbal/chuling','section':'Source / Part used','kind':'taxonomy','note':'校方頁述真菌菌核；只支持菌類編目。'},
 {'id':'taxonomy-maobo','title':'香港理工大學：馬勃','url':'https://herbaltcm.sn.polyu.edu.hk/tc/herbal/puff-ball','section':'來源／藥用部位','kind':'taxonomy','note':'校方資料庫明述真菌子實體；只支持編目類別，不建立古籍物種身份等同。','verification':'opened_primary_page'},
 {'id':'taxonomy-algae','title':'香港生物多樣性資訊站：海藻','url':'https://bih.gov.hk/sc/hong-kong-species/seaweeds/index.html','section':'海藻','kind':'taxonomy','note':'政府藻類介紹；不建立古籍海藻與任一物種或商品的對應。'}
]
for h in d['herbs']:
 n=h.get('sourceName',h['name'])
 if n=='茯苓':h['materialTypeSourceId']='taxonomy-fuling'
 elif n=='豬苓':h['materialTypeSourceId']='taxonomy-zhuling'
 elif n=='馬勃':h['materialTypeSourceId']='taxonomy-maobo'
 elif n=='海藻':h['materialTypeSourceId']='taxonomy-algae'
 elif n in ['茯神','雷丸','海帶','昆布']:
  h['materialType']='fungal_or_algal_identity_pending';h['materialTypeNote']='疑為菌藻類，古籍名稱之基原尚待逐條來源核定。'
# Literal toxicity statements retain source polarity and complete context even when outside the opening lead.
for h in d['herbs']:
 mentions=[]
 for line in h['rawText'].splitlines():
  for sentence in re.split(r'(?<=[。；])',line):
   if re.search(r'有(?:大|小|微|劇)?毒|無毒|至毒',sentence):
    mentions.append({'text':sentence,'polarity':'mixed' if '無毒' in sentence and re.search(r'有(?:大|小|微|劇)?毒|至毒',sentence) else 'historical_no_toxicity_claim' if '無毒' in sentence else 'historical_toxicity_claim','evidenceSpan':ev(h['rawText'],sentence,'historicalToxicity')})
 h['historicalToxicity']['literalEntryStatements']=mentions
 h['historicalToxicity']['scopeNote']='開頭屬性段的毒性記述另作狀態；全條逐句保留的歷史聲稱可涉及引書、加工或其他材料，未逐句轉成安全結論。歷史無毒不等於現代安全。'
 h['evidenceSpans'].extend(m['evidenceSpan'] for m in mentions)
# Profile evidence for the original four is verified independently in cached texts.
booktexts={fn:clean((ROOT/(fn+'.html')).read_text()) for fn in ['jufang','shanghan','xiaoer']}
for f in d['formulas'][:4]:
 bt='jufang' if f['id'] in ['sijunzi','erchen'] else 'shanghan' if f['id']=='guizhitang' else 'xiaoer'
 for evidence in f['profileEvidence']:
  assert evidence['text'] in booktexts[bt],(f['id'],evidence)
  (ROOT/(bt+'-plain.txt')).write_text(booktexts[bt])
  evidence['evidenceSpan']=ev(booktexts[bt],evidence['text'],'traditionalProfileLabels')
  evidence['evidenceSpan']['basis']='sourcePlainText'
  evidence['evidenceSpan']['file']=bt+'-plain.txt'
# Report exact incomplete mappings, never hide them behind a partial ingredient count.
d['qaReport']['toxicityStatuses']=dict(collections.Counter(h['historicalToxicity']['status'] for h in d['herbs']))
d['qaReport']['unknownNatureCount']=sum('未知' in h['nature'] for h in d['herbs'])
d['qaReport']['meridianUnknownCount']=sum(not h['meridians'] for h in d['herbs'])
d['qaReport']['herbCount']=len(d['herbs']);d['qaReport']['reviewCounts']=dict(collections.Counter(h['reviewStatus'] for h in d['herbs']))
d['qaReport']['formulaCount']=len(d['formulas']);d['qaReport']['formulaUnresolvedIngredientNames']=sorted(set(r['sourceName'] for f in d['formulas'] for r in f['ingredientRefs'] if r['mappingStatus']=='unresolved'))
d['qaReport']['formulaHistoricalMappingNames']=sorted(set(r['sourceName'] for f in d['formulas'] for r in f['ingredientRefs'] if r['mappingStatus']=='historical_mapping'))
d['qaReport']['formulaProfileEvidenceCount']=sum(bool(f['traditionalProfileLabels']) for f in d['formulas'])
d['qaReport']['allIngredientNamesVerifiedAgainstOriginal']=True
d['qaReport']['literalEntryToxicityStatementCount']=sum(len(h['historicalToxicity']['literalEntryStatements']) for h in d['herbs'])
d['provenance']['formulaParserFile']='tools/extract-formulas.py'
d['provenance']['modelMeaning']='古籍屬性、文字索引與成分集合，不是化學反應、人體藥效、劑量或安全模型。'
d['methodNotes'].extend(['自動擷取條目尚未逐味核對影印本、現代基原與不良反應；不稱為全部典籍已學習。','historicalToxicity 保留有毒／無毒／加工條件原句；現代安全狀態一律未知，除非有獨立現代來源。','成分未解析的方劑須展示原名佔位，不得以已解析子集冒充完整原方。'])
for f in d['formulas']:
 for r in f['ingredientRefs']:
  assert r['id'] is None or r['id'] in {h['id'] for h in d['herbs']}
(ROOT/'formula-qa.json').write_text(json.dumps(d['qaReport'],ensure_ascii=False,indent=2))
(ROOT/'herbs-and-formulas.json').write_text(json.dumps(d,ensure_ascii=False,indent=2))
print(json.dumps({'herbs':len(d['herbs']),'formulas':len(d['formulas']),'unresolved':d['qaReport']['formulaUnresolvedIngredientNames'],'profileLabels':d['qaReport']['formulaProfileEvidenceCount']},ensure_ascii=False))
