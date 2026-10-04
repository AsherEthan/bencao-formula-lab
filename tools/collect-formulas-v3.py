#!/usr/bin/env python3
"""Collect bounded, auditable historical formula text, never clinical instructions.
Python 3 standard library only. Writes research/formulas-v3; leaves prior assets untouched.
"""
import argparse, collections, datetime, hashlib, html, json, pathlib, re, subprocess, urllib.request, urllib.error
from html.parser import HTMLParser
from urllib.parse import quote
PROJECT = pathlib.Path(__file__).resolve().parents[1]
OUT = PROJECT / 'research/formulas-v3'
BOOKS = [
 ('jc-6490b1a098ab', '傷寒論（宋本）', 'structured_formula_blocks'),
 ('jc-c0bbb390fb81', '金匱要略方論', 'structured_formula_blocks'),
 ('jc-fc98e5e8b159', '太平惠民和劑局方', 'formula_headings')
]
QUOTA = 100
def digest(s): return hashlib.sha256(s.encode('utf-8')).hexdigest()[:16]
def normal(s): return re.sub(r'\s+', ' ', s).strip()
class Node:
 def __init__(self, tag='', attrs=None, parent=None):
  self.tag=tag; self.attrs=attrs or {}; self.parent=parent; self.children=[]; self.order=0
 def text(self):
  if self.attrs.get('data-rev','').startswith('古版'): return ''
  return ''.join(c if isinstance(c,str) else c.text() for c in self.children)
 def inside_formula(self):
  n=self
  while n:
   if 'h-formula' in n.attrs.get('class','').split():return n
   n=n.parent
  return None
class Tree(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root];self.nodes=[]
 def handle_starttag(self,tag,attrs):
  n=Node(tag,dict(attrs),self.stack[-1]);n.order=len(self.nodes);self.nodes.append(n);self.stack[-1].children.append(n)
  if tag=='br':n.children.append('\n')
  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:self.stack.append(n)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==tag:
    del self.stack[i:];break
 def handle_data(self,data): self.stack[-1].children.append(data)
def span(text,start,end,field,file):
 assert 0<=start<end<=len(text)
 return {'field':field,'text':text[start:end],'start':start,'end':end,
         'basis':'sourcePlainText','offsetUnit':'unicode_code_point','file':file}
def paragraph_snapshot(tree,filename):
 units=[];pieces=[];pos=0;headings={}
 for n in tree.nodes:
  kind=n.attrs.get('data-sec')
  if kind not in {'p','h1','h2','h3','h4','h5','h6'} or n.tag not in {'div','p','h1','h2','h3','h4','h5','h6'}:continue
  t=normal(n.text())
  if not t:continue
  if kind!='p':
   level=int(kind[1:]);headings={k:v for k,v in headings.items() if k<level};headings[level]=t
  u={'node':n,'text':t,'start':pos,'end':pos+len(t),'kind':kind,'headings':[v for _,v in sorted(headings.items())],
     'anchor':n.attrs.get('id'),'formula':n.inside_formula(),'index':len(units)}
  units.append(u);pieces.append(t);pos+=len(t)+1
 text='\n'.join(pieces)
 return text,units
NUM='一二三四五六七八九十百千萬兩零〇廿卅0123456789半'
MEASURES='兩銖錢分斤升合枚個箇片尺寸盞斗撮束丸'
def annotation_parts(s):
 prep=re.findall(r'去(?:皮|節|心|蘆|須|苗|核|殼|白|梗|根|頭足|翅足)|(?:炮|炙|炒|熬|煨|蒸|洗|切|擘|搗|研|生用|不見火|去油|酒浸|水浸)',s)
 units=re.findall(r'['+NUM+r']+['+MEASURES+r']',s)
 return list(dict.fromkeys(prep)),units
def split_outside(t):
 chunks=[];depth=0;start=0
 for i,c in enumerate(t):
  if c in '（(':depth+=1
  elif c in '）)':depth-=1
  if depth<0:return [],[t]
  if c.isspace() and depth==0:
   if i>start:chunks.append((start,i,t[start:i]))
   start=i+1
 if depth:return [],[t]
 if start<len(t):chunks.append((start,len(t),t[start:]))
 return chunks,[]
def ingredient_parse(units):
 refs=[];fragments=[];first=units[0]['start'];last=units[-1]['end']
 for u in units:
  chunks,bad=split_outside(u['text']);fragments+=bad
  for a,b,chunk in chunks:
   # A complete ingredient item: a short literal historical name plus optional dose annotation.
   # Never scan prose for known herb names: this would invent presence from indications or methods.
   mt=re.fullmatch(r'([^（()）]{1,12})(?:[（(](.*)[）)])?',chunk)
   if not mt:fragments.append(chunk);continue
   name=mt.group(1);annotation=mt.group(2) or ''
   bare=re.fullmatch(r'([\u3400-\u9fff𠮷]+?)(['+NUM+r']+['+MEASURES+r'](?:半)?)?',name)
   if not bare:fragments.append(chunk);continue
   name=bare.group(1)
   if bare.group(2):annotation=bare.group(2)+('；'+annotation if annotation else '')
   if (not 1<=len(name)<=9 or re.search(r'右|上為|上件|每服|主之|治之|依法|方內|同上|各等分|共|不用|本云|大者|如指|洗$',name) or name in {'山','川芎甘草','白芨木鱉子仁'}):
    fragments.append(chunk);continue
   # The raw name must not be made of numerals/measure words.
   if all(c in NUM+MEASURES for c in name):fragments.append(chunk);continue
   prep,rawunits=annotation_parts(annotation)
   refs.append({'sourceName':name,'scope':'core','preparation':'、'.join(prep),
                'annotationText':annotation,'rawUnits':rawunits,'localNameStart':u['start']+a,
                'localNameEnd':u['start']+a+len(name),'localItemStart':u['start']+a,'localItemEnd':u['start']+b})
 return refs,fragments,first,last
def plausible_ingredients(u):
 t=u['text']
 if re.search(r'^右|^上|^每服|^治|主之|方內|同上|依前|如前|用前|本云|方見',t):return False
 refs,bad,_,_=ingredient_parse([u])
 return bool(refs) and not bad and (len(refs)>=2 or bool(re.search('['+NUM+']+['+MEASURES+']|等分',t))) and len(t)<1100
def chinese_count(s):
 if s.isdigit():return int(s)
 vals={'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
 if s=='十':return 10
 if '十' in s:
  a,b=s.split('十',1);return vals.get(a,1)*10+vals.get(b,0)
 return vals.get(s)
def declared_count(methods):
 for u in methods:
  mt=re.match(r'^(?:右|上)([一二三四五六七八九十兩0-9]{1,3})味',u['text'])
  if mt:return chinese_count(mt.group(1))
 return None
def candidate_blocks(units,mode):
 if mode=='structured_formula_blocks':
  groups=collections.OrderedDict()
  for u in units:
   if u['formula'] is not None:groups.setdefault(u['formula'].order,[]).append(u)
  for group in groups.values():
   titles=[u for u in group if re.search(r'方[：:]?$',u['text']) and len(u['text'])<=30]
   if not titles:continue
   title=titles[0];name=re.sub(r'方[：:]?$','',title['text']).strip()
   if not re.fullmatch(r'[\u3400-\u9fff𠮷]{2,25}',name):continue
   context=[u for u in units[max(0,title['index']-8):title['index']] if u['kind']=='p' and u['formula'] is None and u['headings']==title['headings']]
   # Explicitly named indication only; proximity alone is insufficient.
   indications=[u for u in context if name in u['text'] and re.search(re.escape(name)+r'(?:方)?(?:主之|治之|主|治)',u['text'])]
   after=[]
   for u in group:
    if u['index']<=title['index']:continue
    if re.fullmatch(r'[\u3400-\u9fff𠮷]{2,25}方[：:]?',u['text']):break
    after.append(u)
   yield title,name,after,indications[-1:]
 else:
  for i,u in enumerate(units):
   if u['kind']!='h3' or not re.fullmatch(r'[\u3400-\u9fff𠮷]{2,24}(?:湯|丸|散|飲|膏|丹|餅|方|煎|酒|子|貼)',u['text']):continue
   after=[]
   for v in units[i+1:]:
    if v['kind']!='p':break
    after.append(v)
   # A literal 治... paragraph before the composition is an independent indication.
   indications=[]
   for v in after:
    if plausible_ingredients(v):break
    if re.match(r'^治',v['text']) and not re.search(r'治證.*(?:同|見)|治證與前|治證並方見',v['text']):indications.append(v)
   yield u,u['text'],after,indications
def map_names(herbs):
 candidates=collections.defaultdict(set)
 for h in herbs:
  # Only exact printed names/source-entry titles. Do not use aliases or historical-mapping edges.
  for n in {h['name'],h.get('sourceName','')}:
   if n:candidates[n].add(h['id'])
 return candidates
def indication_fragments(u,name,mode):
 t=u['text']
 if mode=='formula_headings':return [(u['start'],u['end'])]
 # Keep the full context separately; split branches that explicitly name different formulas.
 anchors=list(re.finditer(r'[\u3400-\u9fff𠮷]{2,20}(?:湯|丸|散|飲|膏|丹)(?:方)?(?:主之|治之)',t))
 if len(anchors)<=1:
  target=re.search(re.escape(name)+r'(?:方)?(?:主之|治之|主|治)',t)
  if not target:return []
  stop=re.search(r'[。；]',t[target.end():])
  end=target.end()+stop.end() if stop else len(t)
  return [(u['start'],u['start']+end)]
 pieces=[];a=0
 for mt in re.finditer(r'[。；]|若(?=少氣|嘔|渴|不|腹|下利|利|大便)',t):
  b=mt.end() if mt.group()!='若' else mt.start()
  if b>a:pieces.append((a,b))
  a=mt.end() if mt.group()!='若' else mt.start()
 if a<len(t):pieces.append((a,len(t)))
 found=[(u['start']+a,u['start']+b) for a,b in pieces if re.search(re.escape(name)+r'(?:方)?(?:主之|治之|主|治)',t[a:b])]
 return found
def assign_family(name):
 # Lexical proxy only. Pick the earliest explicit 加/去/合 rather than marker priority.
 cuts=[name.index(marker) for marker in ['加','去','合'] if marker in name and name.index(marker)>=2]
 base=name[:min(cuts)] if cuts else name
 suffix=re.search(r'(湯|丸|散|飲|膏|丹)$',name)
 if cuts and suffix and not base.endswith(suffix.group()):base+=suffix.group()
 base=re.sub(r'^(?:大|小)(?=承氣湯|青龍湯|柴胡湯)','',base)
 return 'family-name-'+digest(base),base
def select_balanced(records,limit):
 # Chapter round-robin, preserving within-chapter order, instead of selecting only early chapters.
 groups=collections.OrderedDict()
 for r in records:groups.setdefault(r['sourceChapter'],collections.deque()).append(r)
 picked=[]
 while len(picked)<limit and any(groups.values()):
  for q in groups.values():
   if q and len(picked)<limit:picked.append(q.popleft())
 return sorted(picked,key=lambda r:r['nameSpan']['start'])
def main():
 args=argparse.ArgumentParser();args.add_argument('--refresh',action='store_true');opt=args.parse_args()
 OUT.mkdir(parents=True,exist_ok=True);(OUT/'snapshots').mkdir(exist_ok=True);(OUT/'raw').mkdir(exist_ok=True)
 catalog=json.loads((PROJECT/'research/corpus/catalog.json').read_text());known={b['id']:b for b in catalog['books']}
 old=json.loads((PROJECT/'research/herbs/herbs-and-formulas.json').read_text());mapping=map_names(old['herbs'])
 sources=[];all_records=[];excluded=[];eligible_counts={};elements={}
 for bid,title,mode in BOOKS:
  meta=known[bid];rawpath=OUT/'raw'/(bid+'.html')
  if opt.refresh or not rawpath.exists():
   req=urllib.request.Request(meta['url'],headers={'User-Agent':'HistoricalFormulaResearch/3.0'})
   try:
    with urllib.request.urlopen(req,timeout=45) as response:
     assert response.status==200
     rawbytes=response.read()
   except urllib.error.URLError:
    # Keep TLS validation enabled; system curl can use the platform certificate store.
    result=subprocess.run(['curl','--fail','--location','--silent','--show-error','--max-time','45','--write-out','\n%{http_code}',meta['url']],capture_output=True,check=True)
    rawbytes,status=result.stdout.rsplit(b'\n',1);assert status==b'200'
   assert title.encode() in rawbytes
   rawpath.write_bytes(rawbytes)
   rawpath.with_suffix('.fetch.json').write_text(json.dumps({'url':meta['url'],'httpStatus':200,'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tlsVerification':'enabled'},ensure_ascii=False,indent=2))
  raw=rawpath.read_text();tree=Tree();tree.feed(raw)
  snapfile='snapshots/'+bid+'.txt';text,units=paragraph_snapshot(tree,snapfile);(OUT/snapfile).write_text(text)
  source={'id':bid,'title':title,'url':meta['url'],'edition':meta.get('edition','來源未標示'),
          'editionStatus':'source_stated_not_independently_collated','author':meta.get('author'),'sourceQuality':meta.get('sourceQuality'),
          'sourceRevision':hashlib.sha256(rawpath.read_bytes()).hexdigest(),'snapshotFile':snapfile,
          'snapshotSHA256':hashlib.sha256(text.encode()).hexdigest(),'snapshotCharacters':len(text),
          'verification':'HTTPS GET 200 and source title checked; web page opened in research turn',
          'fetchEvidence':json.loads(rawpath.with_suffix('.fetch.json').read_text()),
          'snapshotMethod':'data-sec leaf div/p and heading text; 古版 alternate spans omitted; whitespace normalized within paragraphs; paragraphs separated by newline',
          'modernIdentity':'未核定','licenseScope':'historical public-domain transcription; no claim of modern clinical standard'}
  sources.append(source);eligible=[]
  for titleunit,name,after,indications in candidate_blocks(units,mode):
   reasons=[]
   candidate_end=after[min(len(after)-1,2)]['end'] if after else titleunit['end']
   trace={'sourceId':bid,'name':name,'nameStart':titleunit['start'],'sourceExcerptSpan':span(text,titleunit['start'],candidate_end,'excludedCandidateContext',snapfile)}
   if not indications:reasons.append('no_explicit_indication_link')
   ingredient_units=[]
   for u in after:
    if plausible_ingredients(u):ingredient_units.append(u)
    elif ingredient_units:break
    elif mode=='structured_formula_blocks':break
    elif re.match(r'^(?:右|上|每服)',u['text']):break
   if not ingredient_units:
    reasons.append('missing_or_nonliteral_ingredient_list')
    nearby=' '.join(u['text'] for u in after[:3])
    if re.search(r'川芎甘草|白芨木鱉子仁|(?:^|\s)山[（(]|大者|如指|半夏大者洗',nearby):
     reasons.append('ambiguous_printed_name_or_inline_size_preparation')
   if reasons:
    excluded.append({**trace,'reasons':reasons});continue
   refs,bad,ia,ib=ingredient_parse(ingredient_units)
   methods=[u for u in after if u['start']>=ib];count=declared_count(methods)
   if bad or not refs or (count is not None and len(refs)!=count):
    excluded.append({**trace,'reasons':['incomplete_ingredient_parse_or_declared_count_mismatch'],'unparsedFragments':bad,'parsedIngredientCount':len(refs),'declaredIngredientCount':count});continue
   # Repeated literal ingredients may mean unrecognized annotation or another version; exclude ambiguity.
   if len({r['sourceName'] for r in refs})!=len(refs):
    excluded.append({**trace,'reasons':['repeated_ingredient_name_ambiguous']});continue
   fid='formula-v3-'+digest(bid+'|'+str(titleunit['start'])+'|'+name)
   source_anchor=next((u['anchor'] for u in reversed(indications) if u['anchor']),None)
   chapter=' / '.join(titleunit['headings'][:-1] if mode=='formula_headings' else titleunit['headings'])
   contexts=[{'text':u['text'],'sourceId':bid,'assertionKind':'indication_context_not_label_input','evidenceSpan':span(text,u['start'],u['end'],'indicationContext',snapfile)} for u in indications]
   evidence=[]
   for u in indications:
    for a,b in indication_fragments(u,name,mode):
     evidence.append({'text':text[a:b],'sourceId':bid,'assertionKind':'indication','extractionMethod':'explicit_named_target_clause' if mode=='structured_formula_blocks' else '治_paragraph_before_ingredient_list',
       'containsNegatedCondition':bool(re.search(r'不|無|未|非',text[a:b])),'evidenceSpan':span(text,a,b,'indication',snapfile)})
   if not evidence:
    excluded.append({**trace,'reasons':['target_specific_indication_branch_not_found']});continue
   for ref in refs:
    n=ref['sourceName'];candidates=sorted(mapping.get(n,[]));hid=candidates[0] if len(candidates)==1 else None
    status='exact_text' if hid else 'ambiguous_text' if candidates else 'unresolved'
    eid='historical-element-'+digest(n)
    elements[eid]={'id':eid,'name':n,'sourceName':n,'catalogHerbId':hid,'catalogCandidateIds':candidates,'mappingStatus':status,'modernIdentity':'未核定','identityNote':'原樣古籍藥名文字元素；同名不證明同物種/部位/炮製，異名不自動合併。'}
    ref.update({'id':hid,'catalogHerbId':hid,'sourceElementId':eid,'mappingStatus':status,
                'evidenceSpan':span(text,ref.pop('localItemStart'),ref.pop('localItemEnd'),'ingredient',snapfile),
                'nameSpan':span(text,ref.pop('localNameStart'),ref.pop('localNameEnd'),'ingredientName',snapfile),
                'researchWeight':1,'modernIdentity':'未核定'})
   family,base=assign_family(name)
   end=after[-1]['end'] if after else titleunit['end']
   record={'id':fid,'name':name,'sourceId':bid,'sourceBook':title,'sourceURL':meta['url']+('#'+quote(source_anchor) if source_anchor else ''),
           'sourceChapter':chapter,'sourceEdition':source['edition'],'sourceRevision':source['sourceRevision'],
           'nameSpan':span(text,titleunit['start'],titleunit['end'],'formulaName',snapfile),
           'recordSpan':span(text,titleunit['start'],end,'formulaRecord',snapfile),
           'rawIndications':'\n'.join(e['text'] for e in evidence),'profileEvidence':evidence,'indicationContextEvidence':contexts,
           'rawIngredientText':text[ia:ib],'ingredientTextSpan':span(text,ia,ib,'ingredientList',snapfile),'ingredientRefs':refs,
           'herbIds':[r['id'] for r in refs if r['id']],'sourceElementIds':[r['sourceElementId'] for r in refs],
           'ingredientParsingComplete':True,'unparsedIngredientFragments':[],'declaredIngredientCount':count,'parsedIngredientCount':len(refs),
           'reviewStatus':'automatically_extracted_not_individually_reviewed','evidenceStatus':'source_text_spans_checked_not_human_gold',
           'familyId':family,'familyBaseName':base,'familyAssignmentMethod':'literal name / earliest explicit 加去合 stem heuristic with original suffix; no completed historical genealogy',
           'traditionalProfileLabels':[],'researchWeightPolicy':'equal_nonclinical_text_elements',
           'quantityPolicy':'rawUnits and annotations are historical text only; no conversion or administration model'}
   eligible.append(record)
  eligible_counts[bid]=len(eligible);all_records.extend(select_balanced(eligible,QUOTA))
 used_elements={r['sourceElementId'] for f in all_records for r in f['ingredientRefs']};elements={k:v for k,v in elements.items() if k in used_elements}
 compositions=collections.defaultdict(list);same_names=collections.defaultdict(list)
 for f in all_records:
  composition=sorted((r['sourceName'],r['annotationText']) for r in f['ingredientRefs'])
  # Preparation text is retained in this fingerprint; amounts remain source-only and are not ratios.
  key=digest(json.dumps(composition,ensure_ascii=False));f['dedupGroupId']='source-composition-'+key;compositions[key].append(f)
  f['textElementSetGroupId']='element-set-'+digest('|'.join(sorted(f['sourceElementIds'])))
  same_names[f['name']].append(f)
 for f in all_records:
  f['dedupNote']='同成分原文註記指紋只標組、不刪來源記錄；不同主治/版本保留。'
  f['sameNameRecordIds']=[x['id'] for x in same_names[f['name']] if x['id']!=f['id']]
  f['sameNameDifferentSourceAnnotation']=len({x['dedupGroupId'] for x in same_names[f['name']]})>1
  f['sameNameDifferentComposition']=len({x['textElementSetGroupId'] for x in same_names[f['name']]})>1
  f['sourceCompositionDuplicateCount']=len(compositions[f['dedupGroupId'].removeprefix('source-composition-')])
 # Conservative leakage groups union lexical family proxies and exact text-element sets.
 parent={f['id']:f['id'] for f in all_records}
 def find(x):
  while parent[x]!=x:parent[x]=parent[parent[x]];x=parent[x]
  return x
 def union(a,b):
  a,b=find(a),find(b)
  if a!=b:parent[max(a,b)]=min(a,b)
 seen_family={};seen_set={}
 for f in all_records:
  for seen,key in [(seen_family,f['familyId']),(seen_set,f['textElementSetGroupId'])]:
   if key in seen:union(f['id'],seen[key])
   else:seen[key]=f['id']
 grouped=collections.defaultdict(list)
 for f in all_records:grouped[find(f['id'])].append(f['id'])
 for f in all_records:
  f['lexicalFamilyId']=f['familyId']
  f['familyId']='leakage-group-'+digest('|'.join(sorted(grouped[find(f['id'])])))
  f['familyAssignmentMethod']='union of literal-name/explicit-change stem proxy and identical source-element set; historical genealogy unresolved'
  f['familyGroupingScope']='conservative text split grouping, not proof of independent historical formula families'
 spans=0;snapshots={s['snapshotFile']:(OUT/s['snapshotFile']).read_text() for s in sources}
 def verify(e):
  nonlocal spans
  t=snapshots[e['file']];assert t[e['start']:e['end']]==e['text'];spans+=1
 for f in all_records:
  for k in ['nameSpan','recordSpan','ingredientTextSpan']:verify(f[k])
  for e in f['profileEvidence']+f['indicationContextEvidence']:verify(e['evidenceSpan'])
  for r in f['ingredientRefs']:verify(r['evidenceSpan']);verify(r['nameSpan'])
 refs=[r for f in all_records for r in f['ingredientRefs']]
 qa={'formulaCount':len(all_records),'perSourceSelected':dict(collections.Counter(f['sourceId'] for f in all_records)),
     'perSourceEligibleBeforeLimit':eligible_counts,'perSourceQuota':QUOTA,'selectionPolicy':'deterministic chapter round-robin, preserving paragraph order within chapter; then source order in output',
     'excludedCandidateCount':len(excluded),'excludedReasonCounts':dict(collections.Counter(reason for e in excluded for reason in e['reasons'])),
     'sourceElementCount':len(elements),'ingredientReferenceCount':len(refs),'catalogMappingCounts':dict(collections.Counter(r['mappingStatus'] for r in refs)),
     'catalogElementMappingCounts':dict(collections.Counter(e['mappingStatus'] for e in elements.values())),
     'catalogMappingCoverage':sum(r['catalogHerbId'] is not None for r in refs)/len(refs) if refs else 0,
     'literalElementCoverage':1.0 if refs else 0,'validatedSourceSpanCount':spans,
     'leakageGroupCount':len({f['familyId'] for f in all_records}),
     'independentIndicationRecordCount':sum(bool(f['profileEvidence']) for f in all_records),
     'ingredientParsingCompleteCount':sum(f['ingredientParsingComplete'] for f in all_records),
     'uniqueElementSetCount':len({f['textElementSetGroupId'] for f in all_records}),
     'uniqueSourceCompositionCount':len({f['dedupGroupId'] for f in all_records}),
     'sameNameDifferentCompositionCount':sum(f['sameNameDifferentComposition'] for f in all_records),
     'sameNameDifferentSourceAnnotationCount':sum(f['sameNameDifferentSourceAnnotation'] for f in all_records),
     'familyAssignmentScope':'union of lexical family proxy and exact element-set duplicates; genealogy not verified'}
 output={'version':'formula-corpus-v3','scope':'三部公開古籍各最多100筆，具獨立主治原文與明示成分的有界文本語料；全部自動擷取待逐條審核。',
         'sources':sources,'sourceElements':sorted(elements.values(),key=lambda e:e['sourceName']),'formulas':all_records,'qaReport':qa,
         'limitations':['未逐方對影印本校勘；來源自述版本與品質百分比不當作本研究準確率。','主治原文只是歷史聲稱，不是臨床標準答案；銀標籤須另披露公開詞典規則與否定處理。','原名元素不證明現代物種、藥用部位或炮製等同；未入340條本草目錄仍保留文本元素。','同名、同成分與明示加減詞族標籤只是防洩漏輔助；尚未重建完整方族譜系。','每書100筆的章節輪選仍非隨機樣本，不能推論全典籍或臨床母體。','排除引用/差分/殘缺方，不藉外部知識補全成分或主治。','古籍份量與製法只保留文獻原文，不轉克數、比例或服用建議。','傳統功用/方名/主治不得由草藥屬性反填，不與既有18方人工成分核對基準混淆。'],
         'provenance':{'script':'tools/collect-formulas-v3.py','herbCatalog':'research/herbs/herbs-and-formulas.json','sourceCatalog':'research/corpus/catalog.json','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        'offsetContract':'All spans use sourcePlainText Unicode code points, end exclusive, not JS UTF-16 offsets.'}}
 output['contentRevision']=hashlib.sha256(json.dumps({'sources':sources,'sourceElements':output['sourceElements'],'formulas':all_records},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 output['provenance']['parserSHA256']=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
 (OUT/'formulas.json').write_text(json.dumps(output,ensure_ascii=False,indent=2));(OUT/'excluded-candidates.json').write_text(json.dumps(excluded,ensure_ascii=False,indent=2))
 (OUT/'qa-report.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2));print(json.dumps(qa,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
