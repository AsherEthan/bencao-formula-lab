"""Check the published image catalog against its actual static files."""
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / 'dist/downloads/herb-image-catalog.json').read_text())
entries = catalog['entries']
assert len(entries) == 340
assert all(record['images'] for record in entries.values()), 'Missing reference image'
types = {'source_photo', 'part_photo', 'material_photo', 'processed_photo', 'food_photo',
         'raw_ingredient_reference', 'botanical_illustration', 'historical_illustration'}
referenced = set()
for herb_id, record in entries.items():
    assert record['name'] and record['status'] == 'illustrated', herb_id
    for picture in record['images']:
        assert picture['type'] in types, herb_id
        assert all(picture.get(key) for key in ['caption', 'mappingNote', 'sourcePage', 'sourceImageUrl',
                                               'author', 'license', 'licenseUrl', 'modifications']), herb_id
        assert picture['sourcePage'].startswith('https://'), herb_id
        assert picture['sourceImageUrl'].startswith('https://'), herb_id
        assert not re.search('permission required|unconfirmed|unknown', picture['license'], re.I), herb_id
        if picture.get('displayCrop'):
            assert picture['displayCrop']['includesPrintedLabel']
            assert picture.get('fullPageSrc'), 'Source page must accompany a historical detail'
        for key in ['src', 'fullPageSrc']:
            if picture.get(key):
                assert re.fullmatch(r'assets/herbs/[0-9a-f]{20}\.webp', picture[key]), herb_id
                referenced.add(picture[key])
        assert picture['sha256'] == catalog['assetManifest'][picture['src']]['sha256']
assert referenced == set(catalog['assetManifest']), 'Untracked or unused image assets'
assert referenced == {'assets/herbs/' + p.name for p in (root / 'dist/assets/herbs').glob('*.webp')}
for relative_path, asset in catalog['assetManifest'].items():
    path = root / 'dist' / relative_path
    data = path.read_bytes()
    assert len(data) == asset['bytes'], relative_path
    assert hashlib.sha256(data).hexdigest() == asset['sha256'], relative_path
    with Image.open(path) as image:
        assert image.format == 'WEBP'
        assert image.size == (asset['width'], asset['height'])
        image.verify()
source = (root / 'dist/herb-images-data.js').read_text()
assert json.loads(source.removeprefix('window.HERB_IMAGE_DATA = ').rstrip(';\n')) == catalog
summary = Counter(picture['type'] for record in entries.values() for picture in record['images'])
print(json.dumps({'illustratedEntries': len(entries), 'verifiedLocalFiles': len(referenced),
                  'imageKinds': dict(summary)}, ensure_ascii=False))
