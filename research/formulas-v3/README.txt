FORMULA_CORPUS v3 — 可追溯古籍方劑文本語料

這是獨立於既有18方成分節錄校核的自動擷取語料。所有新記錄都標為 automatically_extracted_not_individually_reviewed，並非人工 gold 或臨床標準答案。

範圍與抽樣
只使用此次實際 HTTPS GET 200、書名核對並在研究輪中開啟的三個中醫笈成單頁來源：傷寒論（宋本）、金匱要略方論、太平惠民和劑局方。底本、作者及來源品質百分比沿用網站自述，沒有據此宣稱影印本校勘或研究準確率。
各來源最多100筆，先按章節輪選、章內維持正文順序，再按正文位置輸出；不是隨機或全部收錄。84/100/100共284筆來源記錄，包含262種原名元素集合；同方異版本、份量、註記及主治仍可保留多條。

主要字段
sources：網址、來源自述底本、raw HTML SHA-256 sourceRevision、sourcePlainText snapshot SHA、實際HTTP讀取證據。原HTML僅本地raw/供重現，不必發佈。
sourceElements：id、原樣name/sourceName、catalogHerbId、catalogCandidateIds、mappingStatus、modernIdentity。原名文字元素不是現代物種識別。
formulas：id/name/sourceId/sourceBook/sourceURL/sourceChapter/sourceEdition/sourceRevision；nameSpan、recordSpan、ingredientTextSpan；rawIngredientText與ingredientRefs；rawIndications、profileEvidence；indicationContextEvidence；familyId、lexicalFamilyId、dedupGroupId、textElementSetGroupId；reviewStatus與ingredientParsingComplete。
ingredientRefs：sourceElementId始終保留完整解析的原名詞；id/catalogHerbId只對應舊340條本草的唯一精確字面名字。sourceName、core scope、preparation、annotationText、rawUnits及nameSpan/evidenceSpan均保存。異名、部位、炮製、尺寸與現代基原不自動合併。
profileEvidence：assertionKind=indication，只保存針對該方的主之/治之子句或局方獨立「治」段；成分、方名和服法另欄。indicationContextEvidence是完整上下文，含他方分支或禁忌的可能性，不能直接掃描作銀標籤。containsNegatedCondition僅提示要處理否定，不是完整語義解析。
familyId：文字同名/最早加去合詞幹及原方類suffix的代理，再與完全相同sourceElement集合連通分組，以輔助阻止資料洩漏。lexicalFamilyId保留原代理；沒有完成歷史方族譜系。近似集合仍需另設公開分組規則。
dedupGroupId：成分原名加原文註記指紋，包括原份量差異，只標组而不刪文獻記錄。同名但元素集合不同和同名註記不同分別用sameNameDifferentComposition/sameNameDifferentSourceAnnotation表示。

證據定位
所有 span 都以 snapshots/<sourceId>.txt 這份固定 sourcePlainText 的 Unicode code point 為起訖，end exclusive；不是JavaScript UTF-16索引。
snapshot只取data-sec的div/p和標題，略去來源古版alternate span，以今版显示文字为准；段內空白規整、段間換行。不是對原刻本逐字校勘。
5,120個主要保留記錄 spans 已校對 snapshot 子字串。excluded-candidates.json 另含排除原因與原文片段供審核。

解析與缺值
ingredientParsingComplete=true只表示所選明示成分段符合本解析規則、没有殘片，且有「右X味」時數量一致。這不表示影印本/主治語義/物種身份已人工確認。
排除差分加減、引用他方、巢狀方混入、轉錄缺字或無分隔、印在名稱中的大者/如指/洗等註記，以及缺獨立主治連結的候選；不以常識補原文。
原名元素396種，其中139種唯一精確字面對應舊目錄、3種有同名版本歧義、254種未對應。按1850次成分引用計，catalogMappingCoverage=65.51%；文本元素保留不因未入植物目錄丟棄礦物/動物名。此比例不是現代基原核定率。
大棗、山藥、澤瀉各有兩個歷史版本條目，所以映射null並保留候選ID，不挑一個版本假装唯一。

模型及使用邊界
只把sourceName的core presence作文本特徵；原份量/單位/製法只供原文查閱，不轉克數或服用建議。研究權重1不代表古方比例。
主治原文是歷史聲稱，銀標籤由另行凍結的公開詞典產生，否定/禁忌/他方分支須排除。未命中詞典不代表臨床無效。
同現、標籤模型、逆向關聯不支持單味固有藥性、因果效力、協同、服用安全或實際處方。
所有來源的現代基原與炮製品質未核定。未把主治/方名/本草性味反填作臨床標準答案。

重現
在本項目使用 Python 3：python3 tools/collect-formulas-v3.py。
預設用已存raw/快照重建；--refresh重新HTTPS取得來源，網站變動可改變語料，須重新審核。只用標準庫；Python平台憑證庫不完整時使用仍啟用TLS驗證的system curl。
contentRevision對sources/sourceElements/formulas的固定內容計算SHA-256，排除執行時間；provenance.parserSHA256鎖定解析器。qa-report.json為數量及涵蓋，research-review.json為獨立審核，兩者用途不同。
