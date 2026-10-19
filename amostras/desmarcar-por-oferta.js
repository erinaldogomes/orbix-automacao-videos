'use strict';
// Origem: src/affiliate/desmarcarPorOferta.js (cópia; só o caminho do require mudou).
// O que mostra: regra de negócio "fail-safe" sobre a agenda. Um vídeo agendado para daqui a dias é desmarcado
// sozinho quando a oferta MUDOU, mas só com PROVA: produto indisponível/oferta acabada confirmados, ou preço real
// confirmado mais de 10% ACIMA do anunciado (preço menor é aceito). Leitura que falhou, "suspeita", antiga, de
// outra moeda ou ausente NUNCA cancela. Não toca no que já foi publicado.
const { videoProductIds } = require('./video-products');

const PRODUTO_SEM_VENDA = 'orbix-dancinha';
const LIMITE_ALTA = 0.10;                 // preço confirmado > anunciado + 10%
const LEITURA_VALE_MS = 36 * 3600000;     // leitura de preço vale 36 h
const FALTA_MINIMA_MS = 30 * 60000;       // a menos de 30 min da hora deixa o fluxo normal decidir

/** Preço anunciado no vídeo para um produto (vídeo simples ou comparativo). */
function precoAnunciado(registro, productId) {
  const doComparativo = (registro?.comparativo || registro?.comparison)?.products?.find((p) => String(p.productId) === String(productId));
  const valor = doComparativo?.offer?.price ?? (videoProductIds(registro).length <= 1 ? registro?.offer?.price : null);
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** { cancelar, tipo, motivo, pct } para UMA publicação agendada; cancelar só com prova. */
function avaliarOferta({ publication, registro, database, now = Date.now() }) {
  const quando = Date.parse(publication?.scheduledFor || '');
  if (!Number.isFinite(quando) || quando - now < FALTA_MINIMA_MS) return { cancelar: false };
  // Vídeo sem venda usa um produto interno que não tem oferta: nada a conferir.
  const ids = videoProductIds(registro || {}).filter((id) => id !== PRODUTO_SEM_VENDA);
  if (!ids.length || publication?.productId === PRODUTO_SEM_VENDA) return { cancelar: false };
  for (const id of ids) {
    const produto = (database?.products || []).find((p) => p.id === id);
    if (!produto) continue; // sem produto no banco = sem prova
    const nome = String(produto.name || produto.title || id).slice(0, 50);
    const leitura = produto.linkWatch || {};
    const idade = now - Date.parse(leitura.checkedAt || '');
    // 1) Indisponível/oferta acabada, com prova
    const fim = Date.parse(produto.oferta?.terminaEm || '');
    if (produto.status === 'archived' || produto.available === false || produto.availability === false) {
      return { cancelar: true, tipo: 'indisponivel', motivo: `${nome} ficou indisponível` };
    }
    if (Number.isFinite(fim) && fim <= quando) {
      return { cancelar: true, tipo: 'oferta_acabou', motivo: `a oferta de ${nome} acaba antes do post` };
    }
    if (leitura.status === 'broken' && Number.isFinite(idade) && idade >= 0 && idade <= 3 * LEITURA_VALE_MS) {
      return { cancelar: true, tipo: 'indisponivel', motivo: `o anúncio de ${nome} saiu do ar (confirmado pelo vigia)` };
    }
    // 2) Preço real confirmado mais de 10% acima do anunciado
    const anunciado = precoAnunciado(registro, id);
    const vivo = Number(leitura.price);
    const moedaOk = String(leitura.currency || 'BRL').toUpperCase() === String(produto.price?.currency || produto.offer?.currency || 'BRL').toUpperCase();
    if (anunciado && leitura.status === 'ok' && Number.isFinite(idade) && idade >= 0 && idade <= LEITURA_VALE_MS && vivo > 0 && moedaOk
      && vivo > anunciado * (1 + LIMITE_ALTA)) {
      const pct = Math.round(((vivo / anunciado) - 1) * 100);
      return { cancelar: true, tipo: 'preco_subiu', pct, motivo: `o preço de ${nome} subiu ${pct}% (anunciado R$ ${anunciado.toFixed(2)}, agora R$ ${vivo.toFixed(2)})` };
    }
  }
  return { cancelar: false };
}

module.exports = { avaliarOferta, precoAnunciado, LIMITE_ALTA, LEITURA_VALE_MS, FALTA_MINIMA_MS };
