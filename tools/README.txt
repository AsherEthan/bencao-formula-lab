本研究包的重建範圍

1,362 是書目／來源版本條目數；其中 14 個來源版本保存完整單頁轉錄。
下載或編碼不等於模型已全部閱讀、理解或學習，轉錄亦未與原刻本逐字校勘。

離線重建衍生資產（Python 3 與 Node.js，僅用標準程式庫）
在專案或解壓後的 ZIP 根目錄執行：
  python3 tools/build-research-assets.py
  python3 tools/verify-research-assets.py
  python3 tools/verify-formula-corpus.py
  python3 tools/verify-processing-assets.py
  python3 tools/verify-herb-vector-assets.py
  node checks/verify-quant.cjs
  node checks/verify-inference.cjs
  node checks/verify-processing.cjs
  node checks/verify-herb-vector.cjs
輸入為 research/herbs/herbs-and-formulas.json、research/corpus/catalog.json、
research/corpus/<書目id>.txt，以及 research/methodology/frameworks.json。
新增輸入還包括 research/formulas-v3/formulas.json、三份 snapshots、research-review.json
及 research/inference-methodology.json。輸出為 dist 下的公開 JSON、JavaScript 資產、CSV、
14 份正文資產、元素二元矩陣、實際重新計算的方組／來源留出報告及研究 ZIP。
炮製輸入另含 research/processing/profiles.json、source-checks.json、review.json、README.txt
及 research/processing-model-methodology.json；共 15 本草條目、31 分支、45 屬性證據、
37 工藝步驟與 56 來源短句。輸出 processing-data.js、4 份炮製 JSON、分支及流程 CSV。
verify-processing-assets.py 核對全部 138 字位引用、公開/canonical 一致、独立审查的
資料 SHA-256、未知參數與 ZIP 內的炮製資料、方法、模型及驗證工具副本。
炮製來源的 inputSha256 是最初研究 JSON 的字節快照。公開與離線封存本草 JSON
清理了舊取得環境的位置資訊並重新排版，因此字節 hash 不必相同；herb rawText
與所有引用字位保持相同，按原文逐字核驗，不用排版後 JSON 的 hash 取代原字位。
來源方全部為自動擷取待逐條審核，主治固定詞典生成銀標籤；五折字面方族分組驗證
不能視為人工 gold、完整歷史方族校訂或臨床效力／安全驗證。源書留出另報，不能混為方族留出。
模型程式的封存副本位於 model/ 與 dist/；重建不修改模型程式。
此包可重建衍生資料資產，沒有封存整個網站介面或所有原始研究過程。
工具優先讀取專案內正文；localTextPath 只供舊取得環境回退，公開輸出不含本機路徑。
驗證核對正文 SHA-256、目錄／全文狀態、草藥引句及可定位的 Unicode code point 範圍。
四個方義引句的 sourcePlainText 範圍按 research/herbs/source-snapshots 的三份快照核對。
它驗證封存資料的一致性，不能證明轉錄正確、物種身份、藥效或安全。
另執行 node checks/verify-model.cjs；檢查程式隨 ZIP 封存。

本地正文檢索：
  python3 tools/search-corpus.py --book 黃帝內經素問 --query 陰陽 --limit 3

炮製節錄重建：
  python3 tools/collect-processing.py
此工具重建已選定短句與字位，不是自動核定現代藥材或製法。核對原文已錄的七日、
九次；溫度、分鐘、輔料量與製品批量未記即未知。若來源或短句更改，須重新檢查
source-checks.json 和 review.json 的資料摘要，不可以只更改 hash 表示完成審查。

本草來源向量與學得成分係數
新增輸入為 research/herb-vector-methodology.json、herb-vector-review.json、封存的
340 味本草、284 首文獻方、396 個原名文字元素及三份來源正文快照。
  node tools/build-herb-vector-report.cjs
此工具載入公開的 herb-vector-model.js、inference-model.js、quant-model.js，實際
重新訓練固定 ridge 加成 logistic 模型，從成分二元 presence 推估 16 項來源銀詞。
工藝、克數、原方量、方名、主治文字與來源書不作學習輸入。來源主治只作獨立目標；
不把目標文字當作組方特徵。來源文字向量與學得係數分列，未對映、支持不足和
完全同現不能分離的單味係數保留未知，負係數不等於藥物有相反功效。
原名與本草一對一文字對映，不等於已核定現代基原、部位或飲片身份。
每個防洩漏組的總訓練權重為 1，固定參數並公開收斂紀錄；未搜尋超參數。
方族五折與來源書三折各實際重訓，來源書留出另剔除跨書同組。每份報告有全部
284 方的組外預測及原文對照，含支持不足時的停止原因；未知不補作零分。
每項指標只比較同批可評估、支持足夠的決策和同折訓練基率；測試組亦等權。
公開報告為 herb-vector-report.json 與 HERB_VECTOR_DATA，未包含模型內部訓練矩陣。
來源本草 340 行、原名元素係數 396×16 行、兩份組外原方預測各維度另存 CSV；
無可評維度的原方仍有一行未知記錄。未來語料數改變時行數跟隨封存輸入重建。
方劑 JSON、模型及依賴、固定字典、來源快照均保存 SHA-256。本草 hash 按公開列出的
欄位遞歸排序 JSON 計算，缺欄位用 null，保留原始 rawText；本機位置與排版不入 hash。
  node tools/build-herb-vector-report.cjs --verify
此命令不修改輸出，從封存輸入重做全部 fit 和留出，忽略報告產生時間後逐值核對。
verify-herb-vector-assets.py 另外逐字核對向量與目標來源範圍，重算支持、同現身份、
模型加成、組隔離與等權指標；逐欄核對 CSV 和 ZIP 副本，最後再次實際重訓比對。
本報告預設門檻 0.5 可能沒有任何正類預測，F1 必須照實報告；分數排序及稍低 Brier
不構成藥性、臨床外推或可服用配方的驗證。個別原方在頁面查詢時重新排除同组
再訓練，與報告五折留出結果可能不同；兩種訓練範圍均須明示。

來源取得與重新解析另計
extract-herbs.py、extract-formulas.py 是來源解析參考，需先具備各自要求的
來源 HTML、人工核對的 seed-reviewed-24.json 與中間檔；原始 HTML 未全數納入本包。
可用 TCM_EXTRACTION_DIR 指定這些檔案的工作資料夾，再順序執行兩支解析程式。
沒有這些原始輸入時，應按研究 JSON 的 sources/provenance 重新取得對應版本，
核對來源授權、章題、錨點與原文；需要網絡，來源改版、限流或失效會影響結果。
sourceFiles 內的 SHA-256 是當次來源快照標記，不能保證日後重新下載字節相同。
影印本轉錄校勘、現代基原核定及研究標註需要另行完成，不能靠重新跑解析程式替代。
既有的 research JSON 是本包衍生資產重建的封存輸入，不宣稱可從任意新抓來源
自動重做所有人工研究與核對決策。

用途
古籍文字、屬性詞與方劑成分集合僅供歷史文獻研究；不提供服用處方或服用劑量，
亦不推定人體藥效、毒理或安全。授權與來源連結見 data/ 內的資料及 SOURCE-NOTES.txt。
工作台克數為使用者實錄稱量，配合稱量階段、批次及記錄來源；未輸入即 null，
不自動把份數或古代兩、錢、升、枚轉成克。全方克數有缺失時不顯示全方質量比例。
炮製改變只反映有獨立來源的分支性味與功用文字，不以統一倍率預測藥效，亦不清除
原材料毒性或配伍警示。現代飲片基原、製程規格、檢驗終點與安全仍需另行核定。
