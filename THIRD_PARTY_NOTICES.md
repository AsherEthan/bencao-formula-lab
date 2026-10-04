# 第三方內容與署名

## Three.js

`dist/vendor/three.core.js` 和 `dist/vendor/three.module.js` 為 Three.js r186，MIT 授權，Copyright © 2010–2026 three.js authors。完整原始聲明保存在 [dist/vendor/LICENSE](dist/vendor/LICENSE)，檔案內原有授權標頭亦保留。

原專案：<https://github.com/mrdoob/three.js>。

## 中醫典籍轉錄

本專案的 14 份完整单頁轉錄及三份方劑語料快照來自 [中醫笈成](https://jicheng.tw/tcm/)。書名、底本、來源 URL、原文雜湊及文字字位見 `research/corpus/catalog.json`、`research/formulas-v3/formulas.json` 及各資料的 `sources` 欄位。對公有領域文本的編輯依 [中醫笈成著作權聲明](https://jicheng.tw/tcm/copyright.html) 為 CC0；其自行創作頁面與整理資料為 CC BY 4.0，個別聲明優先。

部分本草和經方節錄來自 [維基文庫](https://zh.wikisource.org/)，例如 [《本草備要》](https://zh.wikisource.org/wiki/本草備要)。保留來源頁與章節定位，依來源標示使用 CC BY-SA 4.0 等授權；本專案新增編排與文字抽取不改變底層古籍的公有領域地位。

主目錄以外的館藏、現代藥材或工藝來源只保留研究摘要、事實與連結，不複製其現代圖譜或整份文獻。資料的來源品質欄位為來源網站自述，未將它當作本專案準確率。

## 本草圖片

340 個條目的圖片來自明示可展示的古籍圖版、Wikimedia Commons、Wellcome 與開放研究論文。完整逐幅署名清單：[dist/downloads/herb-image-catalog.json](dist/downloads/herb-image-catalog.json)。同一清單亦由網頁詳情頁顯示，其 `assetManifest` 對應 587 個去重後的本地圖檔。

`sourcePage` 指向原始記錄，`sourceImageUrl` 保留原始圖像位置，`author` 和 `licenseUrl` 保留署名與授權。`modifications` 記錄等比例縮小、WebP 轉存、方向校正或經目視核對的古籍格圖裁切；古籍格圖另保留 `fullPageSrc` 供查看完整圖版。沒有生成藥材圖片，也沒有將未核准重發的機構圖鑑圖片封裝進本專案。

神曲樣品照片特別署名：Wang Z et al. (2020), *Microbial Community Structure and Chemical Constituents in Shinkiku, a Fermented Crude Drug Used in Kampo Medicine*, Frontiers in Nutrition 7:115, Figure 1, doi:10.3389/fnut.2020.00115；[論文與原圖](https://www.frontiersin.org/journals/nutrition/articles/10.3389/fnut.2020.00115/full)，CC BY 4.0。全部作者及樣品限制在該條圖片資料內。

圖片不能替代古名考證、現代品種鑑定、藥用部位或炮製狀態核定。依逐幅原授權重發；CC BY-SA 圖片的改作須遵循該授權的相同方式分享要求。
