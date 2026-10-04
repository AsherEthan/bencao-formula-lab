"""Search saved full source-page transcriptions with bibliographic citations.
Example: python3 tools/search-corpus.py --book 黃帝內經素問 --query 陰陽 --limit 3
"""
import argparse,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--book');p.add_argument('--query',required=True);p.add_argument('--limit',type=int,default=5);p.add_argument('--window',type=int,default=180);a=p.parse_args()
ROOT=Path(__file__).resolve().parents[1]
j=json.loads((ROOT/'research/corpus/catalog.json').read_text(encoding='utf-8'))
for b in j['books']:
 if b['status']!='fulltext':continue
 if a.book and a.book!=b['title']:continue
 path=ROOT/'research/corpus'/f"{b['id']}.txt"
 if not path.is_file() and b.get('localTextPath'):
  legacy=Path(b['localTextPath']);path=legacy if legacy.is_absolute() else ROOT/legacy
 if not path.is_file():raise FileNotFoundError('Restore research/corpus/'+b['id']+'.txt to search this source.')
 s=path.read_text(encoding='utf-8');start=0;count=0
 while count<a.limit:
  pos=s.find(a.query,start)
  if pos<0:break
  print(json.dumps({'title':b['title'],'source':b['url'],'offset':pos,'text':s[max(0,pos-a.window):pos+len(a.query)+a.window]},ensure_ascii=False))
  start=pos+len(a.query);count+=1
