#!/usr/bin/env python3
"""Reference parser for separately acquired Wikisource HTML and reviewed seed data.
Original HTML acquisition and transcription/collation are not performed here.
Set TCM_EXTRACTION_DIR to a folder containing the required inputs.
No external dependencies. Does not infer clinical efficacy, identity, safety or dose.
"""
import json,re,html,hashlib,pathlib,collections,os
from urllib.parse import quote,unquote,urlsplit
ROOT=pathlib.Path(os.environ.get('TCM_EXTRACTION_DIR',str(pathlib.Path(__file__).resolve().parents[1]/'research/raw-wikisource'))).expanduser()
BASE='https://zh.wikisource.org/zh-hant/本草備要'
EXCLUDED={'本','草','薺','芎','茹','蓄','萆','庵子','濃朴'}
SECTIONS={'草部','木部','果部','谷菜部'}
EXCLUDE_SUBSTANCE={'琥珀','醋','酒'}
# The excluded drug names above are not adjudications of safety: only catalogue scope.
HEAD=re.compile(r'<h([1-6])([^>]*)>([\s\S]*?)</h[1-6]>')
def clean(s):
 s=re.sub(r'<(?:script|style)[^>]*>[\s\S]*?</(?:script|style)>','',s)
 s=re.sub(r'<[^>]+>','',s)
 s=html.unescape(s).replace('\xa0',' ')
 s=re.sub(r'^\s*\[編輯\]\s*','',s)
 return '\n'.join(x.strip() for x in s.splitlines() if x.strip())
def extract_entries(raw):
 heads=list(HEAD.finditer(raw));sec='';out=[]
 for i,m in enumerate(heads):
  name=clean(m.group(3)); level=int(m.group(1))
  if level==2:sec=name
  if level!=3 or sec not in SECTIONS:continue
  a=re.search(r'id="([^"]+)"',m.group(2));anchor=a.group(1)
  end=heads[i+1].start() if i+1<len(heads) else len(raw)
  txt=clean(raw[m.end():end]);out.append({'name':name,'anchor':anchor,'section':sec,'rawText':txt,'htmlStart':m.start(),'htmlEnd':end})
 return out

def strip_parens_with_map(text):
 out=[];positions=[];depth=0
 for i,ch in enumerate(text):
  if ch in '（(':depth+=1;continue
  if ch in '）)':depth=max(depth-1,0);continue
  if not depth:out.append(ch);positions.append(i)
 return ''.join(out),positions

def span(txt,fragment,field):
 i=txt.find(fragment)
 if i<0:raise ValueError((field,fragment))
 return {'field':field,'text':fragment,'start':i,'end':i+len(fragment),'offsetUnit':'unicode_code_point','basis':'rawText'}

def props(e):
 txt=e['rawText'];lines=txt.splitlines();metadata=[];lead=''
 # Short lines preceding a prose paragraph are the book's textual effect headings.
 for line in lines:
  if len(line)<=28 and not re.search(r'[。；]',line) and not re.match(r'^(?:味|性味|氣味|生|熟)?[甘苦酸辛咸鹹淡澀]|^性[寒熱溫涼平]',line) and not lead:
   metadata.append(line)
  else:lead=line;break
 if not lead:lead=lines[0] if lines else ''
 ep=[];effects=[]
 for line in metadata:
  if re.search(r'^(古名|俗作|一名|又名|即|附)',line):continue
  for token in re.split(r'[，、,]',line):
   token=token.strip()
   if token and token not in {'補','瀉','通','宣','輕','重','澀','燥','潤','寒','熱'} and len(token)<=20:
    effects.append(token);ep.append(span(txt,token,'effects'))
 compressed,indexes=strip_parens_with_map(lead)
 # Restrict nature and flavors to the opening property statement, not subsequent indications.
 region=compressed[:90]
 for delim in ['治','主治','能治','療','入']:
  p=region.find(delim)
  if p>=0:region=region[:p]
 flavor_head=region[:45]
 flavors=[]
 if re.match(r'^(味|生|熟|性味|氣味)?[甘苦酸辛咸鹹淡澀]',flavor_head):
  for m in re.finditer(r'[甘苦酸辛咸鹹淡澀](?=[甘苦酸辛咸鹹淡澀而微溫温寒熱凉涼平補能燥入潤性，。]|$)',flavor_head):
   f='鹹' if m.group()=='咸' else m.group()
   if f not in flavors:flavors.append(f);ep.append(span(txt,lead[indexes[m.start()]],'flavors'))
 nature_hits=[]
 # Nature tokens need an explicit taste/nature qualifier. '溫和中' alone is not a nature declaration.
 for m in re.finditer(r'(?:[甘苦酸辛咸鹹淡澀]+|性|氣|而)(大熱|大寒|微寒|微溫|小寒|小溫|微涼|寒|熱|溫|涼|平)',region):
  val=m.group(1); a=indexes[m.start(1)];b=indexes[m.end(1)-1]+1
  nature_hits.append(val);ep.append(span(txt,lead[a:b],'nature'))
 natures=list(dict.fromkeys(nature_hits))
 nature=natures[0] if len(natures)==1 else '加工／版本條件不明' if len(natures)>1 else '未知（此擷取未明載）'
 meridians=[]
 # Only explicit clauses saying 入/歸/為 ... 經; no inference from '補肺' or effects.
 for m in re.finditer(r'(?:入|歸|為)[^。；\n]{0,90}?經',lead[:350]):
  clause=m.group();ep.append(span(txt,clause,'meridians'))
  for channel in ['心包','膀胱','大腸','小腸','三焦','肺','心','脾','肝','腎','胃','膽']:
   if channel=='心' and '心包' in clause and clause.count('心')==1:continue
   if channel in clause and channel not in meridians:meridians.append(channel)
 # Preserve the full source clause rather than collapse '有毒' and '無毒' into one boolean.
 tox=[]
 for sentence in re.split(r'(?<=[。；])',lead[:250]):
  if re.search(r'有(?:大|小|微|劇)?毒|無毒|至毒',sentence):tox.append(sentence)
 tox_status='unknown'
 joined=' '.join(tox)
 yes=bool(re.search(r'有(?:大|小|微|劇)?毒|至毒',joined)); no='無毒' in joined
 if yes and no:tox_status='conditional_or_conflicting_source_statements'
 elif yes:tox_status='source_asserts_toxic'
 elif no:tox_status='source_asserts_no_toxicity'
 for t in tox:ep.append(span(txt,t,'historicalToxicity'))
 # Quote only the textual header or opening property sentence, never dosage/procedure.
 q=metadata[0] if metadata else re.split(r'(?<=[。])',lead)[0]
 if q.startswith(('古名','俗作','一名','又名')):q=re.split(r'(?<=[。])',lead)[0]
 if len(q)>125:q=q[:125]
 if re.search(r'[一二三四五六七八九十百兩錢斤升合枚丸服煎拌曬]',q) and len(q)>80:q=q[:40]
 return {'nature':nature,'flavors':flavors,'meridians':meridians,'effects':list(dict.fromkeys(effects)),
  'quote':q,'evidenceSpans':ep,'natureCandidates':natures,'propertyLead':lead,
  'historicalToxicity':{'status':tox_status,'statements':tox,'modernSafety':'unknown'}}

raw=(ROOT/'bencao-beiyao.html').read_text();entries=extract_entries(raw)
old=json.loads((ROOT/'seed-reviewed-24.json').read_text())
sources=list(old['sources']);oldSources={s['id']:s for s in sources};by_anchor={e['anchor']:e for e in entries};used=set();herbs=[]
# Keep the 24 manually reviewed IDs and versions. Add raw evidence without silently moving them to a different edition.
SN=(ROOT/'shennong.html').read_text();SNheads=list(HEAD.finditer(SN))
SNentries={}
for i,m in enumerate(SNheads):
 a=re.search(r'id="([^"]+)"',m.group(2))
 if not a:continue
 end=SNheads[i+1].start() if i+1<len(SNheads) else len(SN)
 SNentries[a.group(1)]=clean(SN[m.end():end])
for h0 in old['herbs']:
 h=dict(h0);s=oldSources[h['sourceId']];anchor=unquote(urlsplit(s['url']).fragment)
 if '本草備要' in s['url']:
  e=by_anchor[anchor];used.add(anchor);p=props(e);h['rawText']=e['rawText'];h['effects']=p['effects'];h['evidenceSpans']=p['evidenceSpans'];h['historicalToxicity']=p['historicalToxicity'];h['sourceName']=e['name'];h['sourceSection']=e['section']
 else:
  h['rawText']=SNentries[anchor];h['effects']=[];h['evidenceSpans']=[span(h['rawText'],h['quote'],'quote')];h['historicalToxicity']={'status':'not_normalized','statements':[],'modernSafety':'unknown'};h['sourceName']=anchor;h['sourceSection']=s['section']
 h['reviewStatus']='curated_source_excerpt_reviewed';h['extractionStatus']='curated_identity_with_automatic_annotations';h['modernSafety']='unknown';herbs.append(h)
excluded=[]
for e in entries:
 if e['anchor'] in used:continue
 if e['name'] in EXCLUDED or e['name'] in EXCLUDE_SUBSTANCE:
  excluded.append({'name':e['name'],'anchor':e['anchor'],'reason':'章題缺字／身份疑似轉錄錯誤，待核對影印本' if e['name'] in EXCLUDED else '草藥範圍排除非植物化石材料與飲用液體；不作安全判斷'});continue
 hid='bc-'+hashlib.sha256(e['anchor'].encode()).hexdigest()[:10];sid='source-'+hid;p=props(e)
 sources.append({'id':sid,'title':'《本草備要》','url':BASE+'#'+quote(e['anchor']),'section':e['section']+'・'+e['name'],'note':'古籍條目自動擷取，尚未逐味核對影印本與現代基原。性味、功用及無毒文字均只是歷史記述。','kind':'classical','verification':'source_html_and_anchor_verified'})
 identity='古籍名稱與現代品種、部位、加工品的對應尚未完成核定；此條自動擷取，不能視為現代藥材身份認證。'
 if re.search(r'[、，]|[（(]',e['name']):identity+='章題含多種／多加工條目，保留整條，未拆分為可互換身份。'
 h={'id':hid,'name':e['name'],'sourceName':e['name'],'aliases':[],'sourceId':sid,'sourceSection':e['section'],'rawText':e['rawText'],'nature':p['nature'],'flavors':p['flavors'],'meridians':p['meridians'],'effects':p['effects'],'quote':p['quote'],'summary':'古籍條目自動擷取：'+('、'.join(p['effects']) if p['effects'] else '未擷取到獨立功用標題'),'identityNote':identity,'modernSafety':'unknown','historicalToxicity':p['historicalToxicity'],'evidenceSpans':p['evidenceSpans'],'reviewStatus':'automatically_extracted_not_individually_reviewed','extractionStatus':'automatic_conservative','natureCandidates':p['natureCandidates'],'rawSourcePosition':{'htmlStart':e['htmlStart'],'htmlEnd':e['htmlEnd'],'htmlFile':'bencao-beiyao.html'}}
 # No boolean 'false' toxic field from missing or historical '無毒' statements.
 if p['historicalToxicity']['status']=='source_asserts_toxic':h['toxic']=True
 herbs.append(h)

# Types are catalogue scope labels, not a modern scientific identification of each source species.
fungi={'茯苓','茯神','豬苓','馬勃','雷丸'};algae={'海藻','海帶','昆布'}
fermented={'神曲','紅曲','淡豆豉'}
for h in herbs:
 n=h.get('sourceName',h['name'])
 h['materialType']='fungus_or_sclerotium' if n in fungi else 'algae' if n in algae else 'historical_processed_plant_material' if n in fermented else 'plant_related_historical_material'
 h['materialTypeNote']='編目層級標籤，不代表古籍名稱的現代物種基原已核定。'

provenance={'generatedAtClientDate':'2026-10-04','parserFile':'tools/extract-herbs.py','sourceFiles':[],
 'entrySelection':'草部、木部、果部、谷菜部 h3 章題，保留原部類；不宣稱每一條都是現代已核定植物藥。',
 'attributeMethod':'性味只取開頭屬性段的明示詞；歸經只取明示入／歸／為…經子句；功用只取獨立短標題。未知保持未知。',
 'offsetContract':'evidenceSpans 使用 rawText 的 Unicode code point 起迄，不是 JavaScript UTF-16 offset。'}
for fn in ['bencao-beiyao.html','shennong.html','shanghan.html','jufang.html','xiaoer.html','jinkui.html']:
 b=(ROOT/fn).read_bytes();provenance['sourceFiles'].append({'file':fn,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)})
qa={'selectedHeadingsBeforeExclusions':len(entries),'excludedEntries':excluded,'herbCount':len(herbs),'reviewCounts':dict(collections.Counter(h['reviewStatus'] for h in herbs)),'unknownNatureCount':sum('未知' in h['nature'] for h in herbs),'mixedNatureCount':sum(h['nature']=='加工／版本條件不明' for h in herbs),'meridianUnknownCount':sum(not h['meridians'] for h in herbs),'toxicityStatuses':dict(collections.Counter(h['historicalToxicity']['status'] for h in herbs)), 'sourceAnchorVerification':'all automatic anchor IDs checked against cached live-fetched HTML'}
# Assert every span and quote is byte-for-byte text evidence after HTML entity decoding/whitespace normalization.
for h in herbs:
 assert h['quote'] in h['rawText'],(h['name'],'quote')
 for ev in h['evidenceSpans']:assert h['rawText'][ev['start']:ev['end']]==ev['text'],(h['name'],ev)
assert len({h['id'] for h in herbs})==len(herbs)
output={'version':'expanded-research-2026-10-04','scope':old['scope'],'sources':sources,'herbs':herbs,'formulas':old['formulas'],'rules':old['rules'],'modernWarnings':old['modernWarnings'],'methodNotes':old['methodNotes'],'provenance':provenance,'qaReport':qa}
(ROOT/'herbs-intermediate.json').write_text(json.dumps(output,ensure_ascii=False,indent=2))
print(json.dumps(qa,ensure_ascii=False,indent=2))
