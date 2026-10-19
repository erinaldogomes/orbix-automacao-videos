'use strict';
// Origem: src/affiliate/precoParaGravar.js (trecho: a decisão pura; a função que dispara a leitura nova no
// vigia de links foi omitida).
// O que mostra: um "portão de qualidade" ANTES de gastar GPU/créditos gravando um vídeo de produto. Leitura de
// preço errada obriga a refazer o vídeo inteiro, então o preço precisa de 2 leituras que batem (tolerância de 5%).
// Mercado Livre: leitura nova agora contra a anterior (ou o cadastro). Shopee: não consulta de novo (captcha);
// compara a leitura do vigia com o cadastro. Divergiu, leitura velha, moeda diferente ou só uma leitura: NÃO grava.
const TOLERANCIA = 0.05;
const LEITURA_VALE_MS = 36 * 3600000;
const ESPERA_MS = 30 * 60000;

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const perto = (a, b) => Boolean(num(a) && num(b)) && Math.abs(a - b) / Math.max(a, b) <= TOLERANCIA;
const ehMl = (p) => /mercado ?livre/i.test(String(p?.marketplace || '')) || /mercadolivre\.com/i.test(String(p?.originalUrl || ''));

/** Só vídeo de VENDA: sem produto, produto da marca/interno ou vídeo sem venda não tem preço a confirmar. */
function precisaConfirmar(registro, produto) {
  if (!registro?.productId || !produto) return false;
  if (produto.marca === true || registro.productId === 'orbix-dancinha' || registro.origem === 'semVenda' || registro.danca || registro.dancinha || registro.diaDaEt) return false;
  return true;
}

/**
 * Decide com as leituras já em mão. `antes` = leitura ANTES da consulta nova; `agora` = leitura depois (ML) ou a mesma (Shopee).
 * Devolve { ok, motivo, preco, confirmadoPor }.
 */
function avaliar({ produto, antes = null, agora = null, inicio = Date.now(), ml = true } = {}) {
  const lido = agora && agora.status === 'ok' ? num(agora.price) : null;
  const quando = Date.parse(agora?.checkedAt || '');
  if (!lido) return { ok: false, motivo: 'sem leitura boa do preço agora' };
  if (!Number.isFinite(quando) || Date.now() - quando > LEITURA_VALE_MS) return { ok: false, motivo: 'a leitura do preço está velha' };
  if (String(agora.currency || 'BRL').toUpperCase() !== 'BRL') return { ok: false, motivo: 'moeda diferente de BRL' };
  if (ml && !(quando >= inicio - 1000)) return { ok: false, motivo: 'a leitura nova não aconteceu' };
  const outras = [];
  const anterior = antes && antes.status === 'ok' ? num(antes.price) : null;
  const antesQuando = Date.parse(antes?.checkedAt || '');
  // A leitura "anterior" só vale como 2ª leitura se for de ANTES desta consulta (no ML).
  if (anterior && (!ml || (Number.isFinite(antesQuando) && antesQuando < inicio))) outras.push(['leitura anterior do vigia', anterior]);
  const cadastro = num(produto?.price?.current);
  if (cadastro) outras.push(['preço do cadastro', cadastro]);
  if (!outras.length) return { ok: false, motivo: 'só há uma leitura do preço' };
  const bate = outras.find(([, valor]) => perto(lido, valor));
  if (bate) return { ok: true, preco: lido, confirmadoPor: bate[0] };
  return { ok: false, motivo: `as leituras divergem: agora R$ ${lido.toFixed(2)} contra ${outras.map(([nome, v]) => `${nome} R$ ${v.toFixed(2)}`).join(' e ')}` };
}

module.exports = { avaliar, precisaConfirmar, ehMl, TOLERANCIA, ESPERA_MS };
