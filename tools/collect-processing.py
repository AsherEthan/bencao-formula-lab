#!/usr/bin/env python3
"""Build a curated, span-linked processing excerpt register; no dose conversion.

This is a deterministic rebuild of reviewed excerpts, not an automatic claim
that a historical operation matches a present-day pharmacopoeial product.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'research/herbs/herbs-and-formulas.json').read_text())
HERBS = {h['id']: h for h in DATA['herbs']}
SOURCES = {s['id']: s for s in DATA['sources']}
OUT = ROOT / 'research/processing'
OUT.mkdir(parents=True, exist_ok=True)

def span(hid, text, field):
    raw = HERBS[hid]['rawText']
    start = raw.index(text)
    return {'basis': 'herbRawText', 'herbId': hid, 'field': field,
            'offsetUnit': 'unicode_code_point', 'start': start,
            'end': start + len(text), 'text': text}

profiles = []
def add(pid, hid, label, steps=(), properties=(), limits=(), kind='classical_processing_variant', terms=()):
    sid = HERBS[hid]['sourceId']
    evidence = []
    attrs = {'nature': None, 'flavors': [], 'meridians': [], 'effects': []}
    for field, value, quote in properties:
        assert value in quote, (pid, field, value, quote)
        if field == 'nature': attrs[field] = value
        else: attrs[field].append(value)
        evidence.append({'field': field, 'value': value, 'text': quote,
                         'sourceId': sid, 'evidenceSpan': span(hid, quote, field),
                         'claimScope': 'historical_text_assertion_not_measured_effect'})
    workflow = [{'label': label, 'note': note, 'sourceId': sid,
                 'evidenceSpan': span(hid, quote, 'processing'),
                 'parameters': {'temperatureC': None, 'durationMinutes': None,
                                'batchMassGrams': None, 'auxiliaryMassGrams': None}}
                for label, note, quote in steps]
    quoted = {item['evidenceSpan']['text']: item for item in workflow + evidence}
    quotes = [{'text': text, 'sourceId': sid, 'evidenceSpan': item['evidenceSpan']}
              for text, item in quoted.items()]
    profiles.append({'id': pid, 'herbIds': [hid], 'label': label, 'kind': kind,
                     'workflow': workflow, 'attributes': attrs,
                     'propertyEvidence': evidence, 'sourceQuotes': quotes,
                     'verificationStatus': 'source_excerpt_reviewed',
                     'modernSafety': 'unknown', 'modernStandardCorrespondence': 'unresolved',
                     'matchTerms': list(terms),
                     'limitations': list(limits) + [
                         '工藝原文與藥性原文分別核對；未記的溫度、時長、輔料量和批量保持未知。',
                         '所錄流程是古籍節錄，尚未對應現行飲片規格、檢驗終點或完整製造標準。',
                         '歷史性味與功用是文獻聲稱，並非現代藥理、減毒或人體療效的驗證。']})

add('gancao-sheng-bby', 'gancao', '生用甘草 · 本草備要',
    properties=[('nature','平','生用氣平'),('flavors','甘','味甘'),
                ('effects','補脾胃不足','生用氣平，補脾胃不足而瀉心火'),
                ('effects','瀉心火','生用氣平，補脾胃不足而瀉心火')],
    limits=['「生用」未展開淨制、切制和乾燥流程。'], terms=['生','生用'])
add('gancao-zhi-bby', 'gancao', '炙用甘草 · 古籍泛稱',
    steps=[('炙用','原文只記炙用，未指明輔料與火候。','補中炙用')],
    properties=[('nature','溫','炙用氣溫'),('flavors','甘','味甘'),
                ('effects','補三焦元氣','炙用氣溫，補三焦元氣而散表寒'),
                ('effects','散表寒','炙用氣溫，補三焦元氣而散表寒')],
    limits=['此處「炙」未明記蜜，不能自動等同現代蜜炙甘草；古籍的炙溫不能覆寫現代標準的性味。'], terms=['炙','炙用'])

add('renshen-sheng-bby','renshen','生人參 · 古籍分支',
    steps=[('去蘆','條目的一般操作；生熟皆未記完整工藝。','去蘆用')],
    properties=[('nature','微涼','生甘苦微涼'),('flavors','甘','生甘苦微涼'),('flavors','苦','生甘苦微涼')],
    limits=['古籍生、熟分支不直接對應白參、紅參等現代商品規格。'], terms=['生','生用'])
add('renshen-shu-bby','renshen','熟人參 · 古籍泛稱',
    steps=[('去蘆','條目的一般操作；原文未展開熟製方法。','去蘆用')],
    properties=[('nature','溫','熟甘溫'),('flavors','甘','熟甘溫')],
    limits=['「熟」製法未詳，不直接標成紅參或套用蒸製參數。'], terms=['熟','熟用'])

add('huangqi-sheng-bby','huangqi','生用黃耆 · 本草備要',
    properties=[('effects','固表','生用固表')],
    limits=['條目總述甘溫未另給生用分支的數值性味；未繼承為加工後差值。'], terms=['生','生用'])
add('huangqi-mizhi-bby','huangqi','槌扁、蜜炙黃耆 · 本草備要',
    steps=[('槌扁','原文未記尺寸。','入補中藥槌扁，蜜炙'),
           ('蜜炙','蜜量、火候和終點未記。','入補中藥槌扁，蜜炙')],
    properties=[('effects','補中','炙用補中，益元氣，溫三焦，壯脾胃'),
                ('effects','益元氣','炙用補中，益元氣，溫三焦，壯脾胃'),
                ('effects','壯脾胃','炙用補中，益元氣，溫三焦，壯脾胃')],
    limits=['炙用功用與條目蜜炙流程並列；未比較生炙之間的定量強度。'], terms=['蜜炙'])

add('baizhu-migan-bby','baizhu','糯米泔浸白朮 · 本草備要',
    steps=[('糯米泔浸','原文未記濃度、浸泡時間和後續乾燥。','用糯米泔浸（借谷氣以和脾）')],
    properties=[('effects','和脾','用糯米泔浸（借谷氣以和脾）')], terms=['糯米泔浸','米泔浸'])
add('baizhu-tuchao-bby','baizhu','陳壁土炒白朮 · 本草備要',
    steps=[('陳壁土炒','土量、火候、篩土與製品標準未記；未換成現代土炒規格。','陳壁土炒（借土氣以助脾）')],
    properties=[('effects','助脾','陳壁土炒（借土氣以助脾）')], terms=['陳壁土炒'])
add('baizhu-mishui-bby','baizhu','蜜水炒白朮 · 本草備要',
    steps=[('蜜水炒','蜜水比例、火候和終點未記。','或蜜水炒')],
    limits=['後接的人乳拌另為操作；不把兩種可選操作強制串成一套流程。'], terms=['蜜水炒'])

add('banxia-jiangban-bby','banxia','浸洗、切片、薑汁拌半夏 · 本草備要',
    steps=[('浸泡','原文記七日，未記溫度、水質和批量。','浸七日'),
           ('每日換水','只保留原文頻率。','逐日換水'),
           ('瀝去涎','未記可量測終點。','瀝去涎'),
           ('切片','未記片厚。','切片'),
           ('薑汁拌','薑汁量和後續乾燥未記。','薑汁拌')],
    limits=['本条的「制其毒」為歷史聲稱，不判定成品安全；不自動對應現代姜半夏、清半夏或法半夏。'], terms=['薑汁拌'])
add('banxia-fanqu-bby','banxia','礬水煮、姜糊造曲 · 本草備要',
    steps=[('礬水煮','原文終點「煮透」，無濃度、溫度和時長。','一礬水煮透，兼姜糊造，名礬曲'),
           ('姜糊造曲','未記配比；曲的後續熟化詳文尚未形成製造規格。','一礬水煮透，兼姜糊造，名礬曲')],
    properties=[('effects','治清水痰','名礬曲，礬最能卻水，治清水痰')],
    limits=['「礬曲」與現代清半夏不是同一個已核定規格。'], terms=['礬曲'])

add('shengjiang-daozhi-bby','shengjiang','搗汁生薑 · 本草備要',
    steps=[('搗汁','只取條目明記操作；該段後續與黃明膠熬為外用配伍，未移作一般內服流程。','搗汁，和黃明膠熬')],
    limits=['原文未比較搗汁前後的性味，分支性味與功用保持未知。'], terms=['搗汁'])

add('shengdi-xian-bby','bc-adcd65b697','鮮生地黃、搗汁 · 本草備要',
    steps=[('取鮮品','此條的生地黃明指「生掘鮮者」。','生掘鮮者'),
           ('搗汁','未記取汁率和貯存條件。','搗汁飲之')],
    properties=[('nature','大寒','甘苦大寒'),('flavors','甘','甘苦大寒'),('flavors','苦','甘苦大寒')],
    limits=['古籍「生地黃」在此指鮮品；不自動等同現代乾燥生地黃，也不轉成干地黃、熟地黃身份。'], terms=['生掘鮮者','鮮品'])
add('shengdi-jiuzhi-bby','bc-adcd65b697','酒製鮮地黃 · 古籍泛稱',
    steps=[('酒製','未詳浸、拌或蒸，未記酒量。','或用酒制')],
    limits=['「則不傷胃」是歷史聲稱；未另給此酒製品性味，且不能當成安全結論。'], terms=['酒制'])
add('gandi-jiuzhi-bby','bc-679861b699','酒製干地黃 · 本草備要',
    steps=[('酒製','未展開工藝與配比。','酒制則上行外行')],
    properties=[('effects','上行外行','酒制則上行外行')],
    limits=['古籍干地黃身份保留；不跨條套用鮮生地或熟地的性味。'], terms=['酒制'])
add('gandi-jiangzhi-bby','bc-679861b699','姜製干地黃 · 本草備要',
    steps=[('姜製','原文只記姜製，不推定為薑汁炒。','姜制則不泥膈')],
    properties=[('effects','不泥膈','姜制則不泥膈')],
    limits=['未把「不泥膈」換成消化耐受的現代測量值。'], terms=['姜制'])
add('shudi-jiusharen-bby','shudihuang','酒、砂仁浸蒸曬熟地黃 · 本草備要',
    steps=[('好酒拌砂仁末','酒質、酒量與砂仁量未記。','以好酒拌砂仁末'),
           ('浸、蒸、曬','原文記九次，單次溫度與時長未記。','浸蒸曬九次用')],
    properties=[('nature','微溫','甘而微溫'),('flavors','甘','甘而微溫'),
                ('effects','養血滋陰','平補肝腎，養血滋陰')],
    limits=['此為本條具體製法；不能代表所有現代熟地黃製法，沒有跨製法等效係數。'], terms=['浸蒸曬九次'])

add('ganjiang-sheng-bby','bc-dd8f815ac9','未炮乾薑 · 本草備要',
    steps=[('曬乾','條目記母姜曬乾為乾薑；未指定鮮生薑條目的現代基原等同。','母姜曬乾者為乾薑')],
    properties=[('nature','溫','生用辛溫'),('flavors','辛','生用辛溫'),
                ('effects','逐寒邪而發表','生用辛溫，逐寒邪而發表')],
    limits=['這裡的生用是乾薑條目未炮分支，不是鮮生薑。'], terms=['生','生用'])
add('ganjiang-pao-bby','bc-dd8f815ac9','炮乾薑 · 古籍泛稱',
    steps=[('炮','原文未詳砂炒、火候和時間；與炮黑分支分開。','炮則辛苦大熱')],
    properties=[('nature','大熱','炮則辛苦大熱'),('flavors','辛','炮則辛苦大熱'),('flavors','苦','炮則辛苦大熱'),
                ('effects','除胃冷而守中','炮則辛苦大熱，除胃冷而守中')],
    limits=['「炮」泛稱不直接對應現代炮姜製法。'], terms=['炮'])
add('ganjiang-hei-bby','bc-dd8f815ac9','炮黑、黑姜 · 本草備要',
    steps=[('炮黑','原文記黑色终點，未記溫度、含水量和火力。','炮黑為黑姜')],
    properties=[('effects','止吐衄諸血','炮黑止吐衄諸血')],
    limits=['炮黑分支未另給性味；不把泛稱炮乾薑的大熱自動繼承給黑姜。'], terms=['炮黑','黑姜'])

add('fuzi-sheng-bby','fuzi','生用附子 · 古籍分支',
    properties=[('effects','發散','生用發散，熟用峻補')],
    limits=['生附子是歷史研究分支；原文未形成現代質量標準或安全結論。'], terms=['生','生用'])
add('fuzi-shu-bby','fuzi','熟用附子 · 古籍泛稱',
    properties=[('effects','峻補','生用發散，熟用峻補')],
    limits=['「熟」未唯一指定炮製法；此分支不自動對應黑順片、白附片或白附子。'], terms=['熟','熟用'])
add('fuzi-wei-bby','fuzi','水浸、麵裹煨附子 · 本草備要',
    steps=[('水浸','未記時長、水量和換水。','水浸，面裹煨，令發坼，乘熱切片，炒黃'),
           ('麵裹煨','原文記「令發坼」；未記溫度和時長。','面裹煨，令發坼'),
           ('乘熱切片','未記片厚。','乘熱切片'),
           ('炒黃','僅保留原文顏色終點。','炒黃')],
    limits=['「去火毒」不是測得毒性消除；此製法未有獨立性味分支证据，也不套用熟用峻補。',
            '附子與白附子、白附片不可因名稱相近而互換；此處沒有現代商品規格映射。'], terms=['面裹煨','麵裹煨'])

add('zhizi-sheng-bby','bc-73c4b5604e','生用梔子 · 本草備要',
    properties=[('effects','瀉火','生用瀉火')],
    limits=['未另給生用分支性味；不以一般苦寒換成加工差值。'], terms=['生','生用'])
add('zhizi-chahei-bby','bc-73c4b5604e','炒黑梔子 · 本草備要',
    steps=[('炒黑','未記溫度、時長或存性檢驗。','炒黑止血')],
    properties=[('effects','止血','炒黑止血')], terms=['炒黑'])
add('zhizi-jiangchao-bby','bc-73c4b5604e','薑汁炒梔子 · 本草備要',
    steps=[('薑汁炒','未記薑汁量和火候。','薑汁炒止煩嘔')],
    properties=[('effects','止煩嘔','薑汁炒止煩嘔')], terms=['薑汁炒'])

add('baishao-jiuchao-bby','baishao','酒炒白芍 · 本草備要',
    steps=[('酒炒','原文称制其寒，但未給加工後性味等級。','酒炒用（制其寒）')],
    limits=['「制其寒」只保留定性說明，不生成升溫或增效係數；芍藥古名不自動等同本條白芍身份。'], terms=['酒炒'])
add('baishao-cuchao-bby','baishao','醋炒白芍 · 本草備要',
    steps=[('醋炒','原文限定婦人血分；未記配比和火候。','婦人血分醋炒')],
    limits=['炮製支的性味與功用未獨立展開，保持未知。'], terms=['醋炒'])

add('dahuang-jiujin-bby','bc-e6da54c15e','酒浸大黃 · 本草備要',
    steps=[('酒浸','未記酒量、浸泡時間和溫度。','若酒浸，亦能引至高之分')],
    properties=[('effects','引至高之分','若酒浸，亦能引至高之分')],
    limits=['此效果為歷史經驗語詞；不是吸收率或分布的定量結果。'], terms=['酒浸'])
add('dahuang-jiuzheng-bby','bc-e6da54c15e','酒蒸大黃 · 本草備要',
    steps=[('酒蒸','原文只列酒蒸與生熟之別，未記參數。','有酒浸、酒蒸、生、熟之不同')],
    limits=['沒有單獨酒蒸後屬性，不繼承大黃的一般大寒。'], terms=['酒蒸'])
add('huangqin-jiuchao-bby','bc-2ab77f9cc9','酒炒黃芩 · 本草備要',
    steps=[('酒炒','酒量、火力和時長未記。','酒炒則上行，瀉肺火，利胸中氣')],
    properties=[('effects','上行','酒炒則上行，瀉肺火，利胸中氣'),
                ('effects','瀉肺火','酒炒則上行，瀉肺火，利胸中氣'),
                ('effects','利胸中氣','酒炒則上行，瀉肺火，利胸中氣')], terms=['酒炒'])

used_ids = sorted({HERBS[p['herbIds'][0]]['sourceId'] for p in profiles})
sources = [dict(SOURCES[sid], verification={
    'status':'source_page_opened_and_excerpt_crosschecked', 'verifiedAt':'2026-10-04',
    'verifiedPageURL':'https://zh.wikisource.org/zh-hant/本草備要',
    'scope':'本次所選短句與現存條目 rawText 核對；未校勘原刊本與全部轉錄字詞。'}) for sid in used_ids]
sources.extend([
    {'id':'official-pharmacopoeia-2025-announcement',
     'title':'國家藥監局、國家衛生健康委：2025年版中國藥典頒布公告',
     'url':'https://app.www.gov.cn/govdata/gov/202503/26/525844/article.html',
     'kind':'official_standard_announcement', 'publicationDate':'2025-03-26',
     'verifiedAt':'2026-10-04', 'verificationStatus':'page_opened',
     'summary':'公告確認2025年版中國藥典自2025年10月1日起施行。公告和目錄不足以核定單味炮製全文。'},
    {'id':'official-hunan-processing-names-2025',
     'title':'湖南省藥監局：規範醫療機構製劑處方藥味名稱（湘藥監函〔2025〕43號）',
     'url':'https://mpa.hunan.gov.cn/mpa/xyjh/202504/t20250414_33711434.html',
     'kind':'official_regional_naming_notice', 'publicationDate':'2025-04-14',
     'verifiedAt':'2026-10-04', 'verificationStatus':'page_opened',
     'summary':'同一藥材可能對應淨切制品或不同炮炙品；原料飲片規格不明時，需要依實際規格明確藥味名稱。地域適用的名稱規範，並非所有古方的身份映射。'}
])
result = {'version':'processing-evidence-v1', 'scope':'歷史炮製分支與原文流程節錄，非生產或臨床用量規格',
          'sources':sources, 'profiles':profiles,
          'methodology':{
              'attributePolicy':'僅填明確歸屬該分支或該專名條目的屬性，工藝未知不推造屬性；證據必須包含字段值並有確切字位。',
              'identityPolicy':'profile只適用herbIds，生地/干地/熟地、生薑/乾薑、芍藥/白芍、附子/白附子不自動互換。',
              'operationPolicy':'只拆出原文已明記的操作；並列可選法各存一個profile，不自動串接；生、熟、炮、炙泛稱保留不完整狀態。',
              'quantityPolicy':'不提供服用克數，不把古代兩、錢、升、枚自動換成克，不把炮製輔料量當飲片實驗質量。',
              'parameterPolicy':'unknown=null；七日和九次保留於注記而不推造分鐘或溫度。',
              'comparisonPolicy':'古籍性味分支可以顯示文本尺度差異，不能解讀為實測藥性倍率、減毒百分比或效應強度。',
              'modernStandardReview':'已開官方2025年藥典公告與同年飲片名稱規範；未取得/逐條核定現行單味炮製全文，因此全部modernStandardCorrespondence為unresolved。'},
          'provenance':{'builder':'tools/collect-processing.py','input':'research/herbs/herbs-and-formulas.json',
                        'inputSha256':hashlib.sha256((ROOT/'research/herbs/herbs-and-formulas.json').read_bytes()).hexdigest(),
                        'verification':'人工選定短句與頁面核對；腳本只生成與核驗字位，未自動判斷臨床屬性。'}}
(OUT / 'profiles.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'profiles':len(profiles), 'herbEntries':len({p['herbIds'][0] for p in profiles}),
                  'propertyEvidence':sum(len(p['propertyEvidence']) for p in profiles),
                  'workflowSteps':sum(len(p['workflow']) for p in profiles)}, ensure_ascii=False))
