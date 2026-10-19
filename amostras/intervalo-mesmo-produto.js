'use strict';
// Origem: src/affiliate/automaticSameProductGap.js (cópia; só o caminho do require mudou e o código foi reindentado).
// O que mostra: regra de cadência do agendador automático. Antes de ocupar um horário novo, garante N dias
// (`autopilot.diasSemRepetirProduto`) entre dois vídeos do MESMO produto, olhando publicações e reservas.
// Detalhes que importam: o mesmo vídeo em várias redes não conta como repetição; cancelado/falho não conta, a
// menos que tenha chegado a existir remotamente; horário desconhecido FALHA FECHADO (não agenda às cegas).
// Devolve o próximo horário permitido em vez de só "não". Nunca move nem apaga o que já está agendado.
const { videoProductIds } = require('./video-products');

function evaluate({ item, at, database = {}, settings = {}, reservations = [] }) {
  const days = settings.autopilot?.diasSemRepetirProduto;
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return { allowed: true, nextAt: at };
  const time = Date.parse(at), gap = days * 86400000, ids = new Set(videoProductIds(item));
  if (!Number.isFinite(time) || !ids.size) return { allowed: false, reason: 'missing_product_or_slot' };
  let next = time;
  for (const row of [...(database.publications || []), ...reservations]) {
    if (row.jobId && row.jobId === item.jobId) continue; // One video may go to several networks.
    if (['cancelled', 'canceled', 'cancelado', 'failed', 'deleted', 'removed', 'rejected'].includes(row.status)
      && !((row.remoteId || row.remoteUrl) && !Number.isFinite(Date.parse(row.remoteDeletedAt || '')))) continue;
    const bound = (database.influencerVideos || []).find(v => v.jobId && v.jobId === row.jobId)
      || (database.scripts || []).find(v => v.jobId && v.jobId === row.jobId);
    if (![...videoProductIds(row), ...videoProductIds(bound)].some(id => ids.has(id))) continue;
    const existing = Date.parse(row.status === 'published' ? (row.publishedAt || row.scheduledFor) : (row.scheduledFor || row.reservedFor));
    if (!Number.isFinite(existing)) return { allowed: false, reason: 'same_product_unknown_slot' };
    if (Math.abs(time - existing) < gap) next = Math.max(next, existing + gap);
  }
  return { allowed: next === time, nextAt: new Date(next).toISOString(), reason: next === time ? null : 'same_product_gap' };
}

module.exports = { evaluate };
