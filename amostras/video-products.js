'use strict';
// Origem: src/affiliate/videoProducts.js (trecho: só videoProductIds).
// O que mostra: normalização defensiva dos ids de produto de um vídeo. Um vídeo comparativo fala de DOIS produtos,
// e os ids podem vir em campos diferentes conforme a origem do registro; tudo vira uma lista única, sem vazios.

// A comparison is one video about two separate products, not a batch of videos.
function videoProductIds(video = {}) {
  const values = [video.productId, ...(Array.isArray(video.productIds) ? video.productIds : []),
    ...(Array.isArray(video.comparativo?.productIds) ? video.comparativo.productIds : []),
    ...(Array.isArray(video.comparison?.productIds) ? video.comparison.productIds : []),
    ...(Array.isArray(video.affiliateContext?.productIds) ? video.affiliateContext.productIds : [])];
  return [...new Set(values.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))];
}

module.exports = { videoProductIds };
