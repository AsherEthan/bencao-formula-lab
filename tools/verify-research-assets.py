#!/usr/bin/env python3
"""Verify saved research/public consistency; does not verify medical claims."""
import hashlib, json, pathlib, re, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
def require(condition,message):
 if not condition:raise ValueError(message)
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def public_locations(value,location='$'):
 if isinstance(value,dict):
  for key,item in value.items():
   require(not(key.lower().startswith('local') and key.lower().endswith('path')),'Local path metadata: '+location+'.'+key)
   public_locations(item,location+'.'+key)
 elif isinstance(value,list):
  for i,item in enumerate(value):public_locations(item,location+'['+str(i)+']')
 elif isinstance(value,str):require(not re.search(r'(?:/Users/|/tmp/|/private/|/home/|file://)',value),'Public local storage location: '+location)
downloads=ROOT/'dist/downloads'
c=read(downloads/'corpus-catalog.json');d=read(downloads/'herbs-and-formulas.json')
for path in downloads.glob('*.json'):public_locations(read(path))
books=c['books'];full=[b for b in books if b['status']=='fulltext']
require(len({b['id'] for b in books})==len(books),'Duplicate catalogue ID')
require(len({b['url'] for b in books})==len(books),'Duplicate main catalogue URL')
require(len(full)==c['counts']['fulltextDownloaded'],'Full-text count mismatch')
for b in full:
 text=(ROOT/'research/corpus'/f"{b['id']}.txt").read_text(encoding='utf-8');digest=hashlib.sha256(text.encode()).hexdigest()
 require(digest==b['textSha256'],'Source text hash: '+b['id'])
 asset=read(ROOT/'dist'/b['textAsset']);require(asset['text']==text and asset['sha256']==digest,'Public text asset: '+b['id'])
 if b.get('characters') is not None:require(len(re.sub(r'\s','',text))==b['characters'],'Character count: '+b['id'])
checked=0
profile_checked=0
for entry in d['herbs']+d['formulas']:
 text=entry.get('rawText')
 if text is None:continue
 if entry.get('quote'):require(entry['quote'] in text,'Quote not in rawText: '+entry['id'])
 for span in entry.get('evidenceSpans',[]):
  if span.get('basis','rawText')!='rawText':continue
  require(span.get('offsetUnit')=='unicode_code_point','Unsupported offset unit: '+entry['id'])
  require(text[span['start']:span['end']]==span['text'],'Evidence span: '+entry['id']);checked+=1
for formula in d['formulas']:
 for evidence in formula.get('profileEvidence',[]):
  span=evidence.get('evidenceSpan',{})
  if span.get('basis')!='sourcePlainText':continue
  require(pathlib.Path(span['file']).name==span['file'],'Invalid source snapshot filename')
  text=(ROOT/'research/herbs/source-snapshots'/span['file']).read_text(encoding='utf-8')
  require(span.get('offsetUnit')=='unicode_code_point','Unsupported profile offset unit: '+formula['id'])
  require(text[span['start']:span['end']]==span['text']==evidence['text'],'Profile source span: '+formula['id']);profile_checked+=1
with zipfile.ZipFile(downloads/'tcm-research-library.zip') as z:
 for name in ['README.txt','tools/README.txt','tools/build-research-assets.py','tools/verify-research-assets.py','research/herbs/herbs-and-formulas.json','research/corpus/catalog.json','research/methodology/frameworks.json']:
  require(name in z.namelist(),'Bundle missing: '+name)
 for b in full:require(f"research/corpus/{b['id']}.txt" in z.namelist(),'Bundle text missing: '+b['id'])
 for formula in d['formulas']:
  for evidence in formula.get('profileEvidence',[]):
   span=evidence.get('evidenceSpan',{})
   if span.get('basis')=='sourcePlainText':require('research/herbs/source-snapshots/'+span['file'] in z.namelist(),'Bundle profile source missing')
 for name in z.namelist():
  if name.endswith('.json'):public_locations(json.loads(z.read(name)))
print(json.dumps({'catalogueEntries':len(books),'fulltexts':len(full),'verifiedRawTextSpans':checked,'verifiedProfileSourceSpans':profile_checked,'publicLocalPaths':0},ensure_ascii=False))
