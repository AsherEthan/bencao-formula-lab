#!/usr/bin/env python3
"""Verify sealed processing evidence, generated assets and portable packaging.

This verifies research data consistency, not modern material identity, production
standards, clinical dose, detoxification or efficacy.
"""
import csv
import hashlib
import json
import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / 'dist/downloads'

def require(condition, message):
    if not condition:
        raise ValueError(message)

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def public_locations(value, location='$'):
    if isinstance(value, dict):
        for key, item in value.items():
            require(not (key.lower().startswith('local') and key.lower().endswith('path')),
                    'Local path metadata: ' + location + '.' + key)
            public_locations(item, location + '.' + key)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            public_locations(item, location + '[' + str(i) + ']')
    elif isinstance(value, str):
        require(not re.search(r'(?:/Users/|/tmp/|/private/|/home/|file://)', value),
                'Public local storage location: ' + location)

canonical_path = ROOT / 'research/processing/profiles.json'
processing = read(canonical_path)
canonical_herbs = read(ROOT / 'research/herbs/herbs-and-formulas.json')
public_herbs = read(DOWNLOADS / 'herbs-and-formulas.json')
herbs = {h['id']: h for h in canonical_herbs['herbs']}
published_herbs = {h['id']: h for h in public_herbs['herbs']}
sources = {s['id']: s for s in processing['sources']}
require(len(sources) == len(processing['sources']), 'Duplicate processing source identifier')
require(set(herbs) == set(published_herbs), 'Herb identities differ between research and public assets')

documents = [
    ('processing-profiles.json', canonical_path),
    ('processing-methodology.json', ROOT / 'research/processing-model-methodology.json'),
    ('processing-review.json', ROOT / 'research/processing/review.json'),
    ('processing-source-checks.json', ROOT / 'research/processing/source-checks.json'),
]
for public_name, source_path in documents:
    public = read(DOWNLOADS / public_name)
    public_locations(public)
    require(public == read(source_path), 'Public/canonical mismatch: ' + public_name)

asset = (ROOT / 'dist/processing-data.js').read_text(encoding='utf-8')
prefix = 'window.PROCESSING_DATA = '
require(asset.startswith(prefix), 'Unexpected processing global asset')
require(json.loads(asset[len(prefix):].rstrip(';\n')) == processing,
        'JavaScript processing data differs from the canonical register')

verified_spans = 0
property_count = 0
workflow_count = 0
quote_count = 0

def verify_reference(profile, item):
    global verified_spans
    e = item['evidenceSpan']
    require(e['basis'] == 'herbRawText' and e['offsetUnit'] == 'unicode_code_point',
            'Unsupported processing evidence basis: ' + profile['id'])
    hid = e['herbId']
    require(hid in profile['herbIds'] and hid in herbs,
            'Processing evidence points to an inapplicable herb: ' + profile['id'])
    h = herbs[hid]
    require(item['sourceId'] == h['sourceId'] and item['sourceId'] in sources,
            'Processing evidence/source identifier mismatch: ' + profile['id'])
    start, end = e['start'], e['end']
    require(type(start) is int and type(end) is int and 0 <= start < end <= len(h['rawText']),
            'Invalid code point bounds: ' + profile['id'])
    require(h['rawText'][start:end] == e['text'], 'Canonical source span: ' + profile['id'])
    require(published_herbs[hid]['rawText'][start:end] == e['text'],
            'Public source span: ' + profile['id'])
    if 'text' in item:
        require(item['text'] == e['text'], 'Quote differs from its span: ' + profile['id'])
    verified_spans += 1

profile_ids = set()
for p in processing['profiles']:
    require(p['id'] not in profile_ids, 'Duplicate processing profile: ' + p['id'])
    profile_ids.add(p['id'])
    require(p['herbIds'] and len(set(p['herbIds'])) == len(p['herbIds']) and
            all(hid in herbs for hid in p['herbIds']), 'Invalid profile applicability: ' + p['id'])
    require(p['verificationStatus'] == 'source_excerpt_reviewed',
            'Unexpected excerpt review status: ' + p['id'])
    require(p['modernSafety'] == 'unknown' and p['modernStandardCorrespondence'] == 'unresolved',
            'Historical processing cannot assert modern safety or correspondence: ' + p['id'])
    for e in p['propertyEvidence']:
        verify_reference(p, e)
        require(e['field'] in ['nature', 'flavors', 'meridians', 'effects'],
                'Unsupported property field: ' + p['id'])
        require(e['value'] and e['value'] in e['text'], 'Property lacks literal support: ' + p['id'])
        property_count += 1
    for field, values in p['attributes'].items():
        require(field in ['nature', 'flavors', 'meridians', 'effects'], 'Unsupported attribute field')
        if field == 'nature':
            require(values is None or isinstance(values, str), 'Nature must be a source word or null')
            values = [] if values is None else [values]
        else:
            require(isinstance(values, list), 'Attribute field must be a list: ' + p['id'])
        for value in values:
            require(any(e['field'] == field and e['value'] == value for e in p['propertyEvidence']),
                    'Applied attribute has no field evidence: ' + p['id'] + '.' + field)
    for step in p['workflow']:
        verify_reference(p, step)
        require(step['label'] and step['note'], 'Missing workflow label or qualification')
        # v1 records seven days/nine cycles as historical notes, not fabricated
        # converted minutes, operating temperatures, batch or auxiliary grams.
        require(all(v is None for v in step.get('parameters', {}).values()),
                'v1 contains unsupported manufacturing parameters: ' + p['id'])
        workflow_count += 1
    for quote in p['sourceQuotes']:
        verify_reference(p, quote)
        quote_count += 1

review = read(ROOT / 'research/processing/review.json')
audited = review['repositoryAudit']['processingProfiles']
digest = hashlib.sha256(canonical_path.read_bytes()).hexdigest()
require(audited['datasetSha256'] == digest, 'Independent processing review refers to a different dataset')
for key, value in [('profileCount', len(profile_ids)),
                   ('sourceHerbEntryCount', len({hid for p in processing['profiles'] for hid in p['herbIds']})),
                   ('propertyEvidenceCount', property_count), ('workflowStepCount', workflow_count),
                   ('sourceQuoteCount', quote_count), ('checkedReferenceCount', verified_spans)]:
    require(audited[key] == value, 'Independent review count mismatch: ' + key)

checks = read(ROOT / 'research/processing/source-checks.json')
live_classical = [s for s in checks['checks'] if 'wikisource.org' in s['url']]
require(len(live_classical) == 1 and live_classical[0]['httpStatus'] == 200,
        'Classical source retrieval evidence missing')
retrieved = live_classical[0]
require(retrieved['total'] == retrieved['matched'] == quote_count and
        all(c['presentInRetrievedText'] for c in retrieved['excerptChecks']),
        'A processing source quote was not present in the sealed retrieval check')
require({(c['profileId'], c['text']) for c in retrieved['excerptChecks']} ==
        {(p['id'], q['text']) for p in processing['profiles'] for q in p['sourceQuotes']},
        'Retrieval evidence refers to different processing quotes')

with (DOWNLOADS / 'processing-profiles.csv').open(encoding='utf-8-sig', newline='') as stream:
    rows = list(csv.DictReader(stream))
require(len(rows) == len(profile_ids) and {r['profileId'] for r in rows} == profile_ids,
        'Processing CSV rows/identities differ from the source register')
require(all(r['現代標準對應'] == 'unresolved' and r['現代安全'] == 'unknown' for r in rows),
        'Processing CSV has unsupported product/safety assertions')
for row in rows:
    p = next(p for p in processing['profiles'] if p['id'] == row['profileId'])
    a = p['attributes']
    expected = {
        '分支名稱': p['label'], '適用本草id': '/'.join(p['herbIds']), '類別': p['kind'],
        '分支性味原詞': a['nature'] or '未錄', '味原詞': '/'.join(a['flavors']),
        '歸經原詞': '/'.join(a['meridians']), '功用原詞': '/'.join(a['effects']),
        '工藝步驟數': str(len(p['workflow'])), '屬性證據數': str(len(p['propertyEvidence'])),
        '短句核查狀態': p['verificationStatus'],
        '來源短句': '；'.join(q['text'] for q in p['sourceQuotes']),
        '來源id': '/'.join(sorted({q['sourceId'] for q in p['sourceQuotes']})),
        '限制': '；'.join(p['limitations']),
    }
    require(all(row[k] == v for k, v in expected.items()),
            'Processing profile CSV differs from supported source fields: ' + p['id'])
with (DOWNLOADS / 'processing-workflows.csv').open(encoding='utf-8-sig', newline='') as stream:
    rows = list(csv.DictReader(stream))
require(len(rows) == workflow_count, 'Workflow CSV step count mismatch')
for row in rows:
    p = next(p for p in processing['profiles'] if p['id'] == row['profileId'])
    step = p['workflow'][int(row['步驟序位']) - 1]
    require(row['分支名稱'] == p['label'] and row['工藝原詞'] == step['label'] and
            row['步驟註記'] == step['note'] and row['來源id'] == step['sourceId'] and
            row['基底本草id'] == step['evidenceSpan']['herbId'] and
            row['原文'] == step['evidenceSpan']['text'] and
            int(row['Unicode起位']) == step['evidenceSpan']['start'] and
            int(row['Unicode止位']) == step['evidenceSpan']['end'], 'Workflow CSV evidence mismatch')
    require(all(row[k] == '' for k in ['溫度C', '分鐘', '批量克數', '輔料克數']),
            'Workflow CSV turns unknown parameters into numeric values')

with zipfile.ZipFile(DOWNLOADS / 'tcm-research-library.zip') as archive:
    paths = [
        'research/processing/profiles.json', 'research/processing/README.txt',
        'research/processing/source-checks.json', 'research/processing/review.json',
        'research/processing-model-methodology.json', 'dist/processing-model.js',
        'checks/verify-processing.cjs', 'tools/collect-processing.py',
        'tools/verify-processing-assets.py', 'tools/build-research-assets.py', 'tools/README.txt',
    ]
    for name in paths:
        require(name in archive.namelist(), 'Bundle missing processing reproduction input: ' + name)
        require(archive.read(name) == (ROOT / name).read_bytes(), 'Bundle processing input differs: ' + name)
    require(archive.read('model/processing-model.js') == (ROOT / 'dist/processing-model.js').read_bytes(),
            'Archived model copy differs from the browser model')
    for name, _ in documents:
        require(archive.read('data/' + name) == (DOWNLOADS / name).read_bytes(),
                'Bundle/public processing download differs: ' + name)
    for name in ['processing-profiles.csv', 'processing-workflows.csv']:
        require(archive.read('data/' + name) == (DOWNLOADS / name).read_bytes(), 'CSV archive mismatch: ' + name)
    for name in archive.namelist():
        if name.endswith('.json'):
            public_locations(json.loads(archive.read(name)))

print(json.dumps({'processingProfiles': len(profile_ids),
                  'sourceHerbEntries': audited['sourceHerbEntryCount'],
                  'verifiedProcessingReferences': verified_spans,
                  'propertyEvidence': property_count, 'workflowSteps': workflow_count,
                  'sourceQuotes': quote_count,
                  'knownNatureProfiles': sum(bool(p['attributes']['nature']) for p in processing['profiles']),
                  'unknownNatureProfiles': sum(p['attributes']['nature'] is None for p in processing['profiles']),
                  'publicCanonicalConsistency': True, 'publicLocalPaths': 0,
                  'bundleProcessingInputsMatch': True}, ensure_ascii=False))
