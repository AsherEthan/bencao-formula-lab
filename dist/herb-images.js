'use strict';
window.HerbImages = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {source_photo:'原植物／基原',material_photo:'藥材照片',part_photo:'藥用部位參考',processed_photo:'炮製品照片',food_photo:'食品參考',raw_ingredient_reference:'原料植物參考',botanical_illustration:'植物學圖',historical_illustration:'古籍藥圖'};
  const record = id => window.HERB_IMAGE_DATA?.entries?.[id] || {images:[]};
  const name = id => window.HERB_DATA.herbs.find(h => h.id === id)?.name || id;
  const label = id => labels[record(id).images[0]?.type] || '圖片待核';
  function thumb(id, size='small', interactive=true) {
    const item = record(id).images[0], herbName = name(id), tag = interactive ? 'button' : 'span';
    return `<${tag} class="herb-photo-thumb herb-photo-${esc(size)}${item?'':' is-missing'}" ${interactive?`type="button" data-detail="${esc(id)}" aria-label="查看${esc(herbName)}藥圖與來源"`:''}><span class="herb-photo-fallback" aria-hidden="true">${esc(herbName[0])}<small>${item?'圖片未載入':'待核圖'}</small></span>${item?`<img src="${esc(item.src)}" alt="${esc(item.caption)}" loading="lazy" decoding="async" width="96" height="96" data-herb-image="${esc(id)}">`:''}</${tag}>`;
  }
  function gallery(id) {
    const r = record(id);
    if(!r.images.length) return '<section class="herb-image-gallery"><p>尚未取得可核對並可展示的圖片。</p></section>';
    return `<section class="herb-image-gallery" aria-label="${esc(name(id))}圖片與來源"><div class="herb-gallery-heading"><h3>藥圖與外觀參考</h3><span>${r.images.length} 幅</span></div>${r.images.map((im,i)=>`<figure class="herb-image-figure"><a class="herb-image-full" href="${esc(im.fullPageSrc||im.src)}" target="_blank" rel="noopener" aria-label="開啟${esc(name(id))}第${i+1}幅圖片"><img src="${esc(im.src)}" alt="${esc(im.caption)}" decoding="async" width="${im.width||800}" height="${im.height||800}" ${i?'loading="lazy"':''} data-herb-image="${esc(id)}"><span>${im.fullPageSrc?'完整圖版':'開啟大圖'} ↗</span></a><figcaption><span class="herb-image-kind">${esc(labels[im.type]||'外觀參考')}</span><p>${esc(im.caption)}</p>${im.mappingNote?`<small>${esc(im.mappingNote)}</small>`:''}<details><summary>圖片來源與授權</summary><p>${esc(im.author||im.attribution||'來源作者見原始記錄')}</p>${im.citation?`<p class="herb-image-citation">${esc(im.citation)}</p>`:''}<a href="${esc(im.sourcePage)}" target="_blank" rel="noopener">${esc(im.sourceLabel||'原始圖片與記錄')} ↗</a> · <a href="${esc(im.licenseUrl)}" target="_blank" rel="noopener">${esc(im.license)} ↗</a>${im.identitySource?`<p><a href="${esc(im.identitySource)}" target="_blank" rel="noopener">名稱／基原對應資料 ↗</a></p>`:''}</details></figcaption></figure>`).join('')}<p class="herb-gallery-note">古籍藥圖保留歷史名稱；原植物照片與所選炮製品分開核對。</p></section>`;
  }
  function coverage() {
    const entries = Object.values(window.HERB_IMAGE_DATA?.entries || {});
    const withImage = entries.filter(e => e.images.length);
    return `${withImage.length} / ${HERB_DATA.herbs.length} 條有圖 · ${withImage.filter(e=>e.images.some(im=>['source_photo','material_photo','part_photo','processed_photo','food_photo'].includes(im.type))).length} 條有照片`;
  }
  document.addEventListener('error', event => {
    if(event.target instanceof HTMLImageElement && event.target.hasAttribute('data-herb-image')) {
      event.target.hidden=true;
      event.target.parentElement.classList.add('image-load-failed');
    }
  }, true);
  return {record,thumb,gallery,label,coverage};
})();
