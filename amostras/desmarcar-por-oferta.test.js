'use strict';
// Origem: tests/affiliate-desmarcar-por-oferta.test.js (trecho: os 5 testes da regra pura; os 2 testes que montam o
// serviço com banco em memória foram omitidos). Teste OFFLINE: nenhuma rede, nenhuma pasta real.
// O que mostra: casos de fronteira (exatamente 10% não cancela, 12% cancela), dados ruins nunca cancelam.
const test = require('node:test');
const assert = require('node:assert/strict');
const { avaliarOferta } = require('./desmarcar-por-oferta');

const AGORA = Date.parse('2026-10-11T12:00:00.000Z');
const HORAS = (n) => new Date(AGORA + n * 3600000).toISOString();
const lido = (extra = {}) => ({ status: 'ok', price: 100, currency: 'BRL', checkedAt: HORAS(-2), ...extra });
const produto = (extra = {}) => ({ id: 'p1', name: 'Cadeira', price: { current: 100, currency: 'BRL' }, linkWatch: lido(), ...extra });
const registro = (preco = 100) => ({ id: 'r1', jobId: 'j1', productId: 'p1', productName: 'Cadeira', offer: { price: preco, currency: 'BRL' } });
const linha = (extra = {}) => ({ id: 'l1', jobId: 'j1', platform: 'youtube_shorts', status: 'scheduled', scheduledFor: HORAS(48), ...extra });
const avalia = (p, reg = registro(), pub = linha()) => avaliarOferta({ publication: pub, registro: reg, database: { products: [p] }, now: AGORA });

test('preço confirmado mais de 10% acima do anunciado cancela; até 10% ou menor, não', () => {
  const alto = avalia(produto({ linkWatch: lido({ price: 112 }) }));
  assert.equal(alto.cancelar, true);
  assert.equal(alto.tipo, 'preco_subiu');
  assert.equal(alto.pct, 12);
  assert.equal(avalia(produto({ linkWatch: lido({ price: 110 }) })).cancelar, false);
  assert.equal(avalia(produto({ linkWatch: lido({ price: 105 }) })).cancelar, false);
  assert.equal(avalia(produto({ linkWatch: lido({ price: 60 }) })).cancelar, false);
});

test('sem prova nunca cancela: leitura suspeita, antiga, de outra moeda ou ausente', () => {
  assert.equal(avalia(produto({ linkWatch: lido({ price: 200, status: 'suspect' }) })).cancelar, false);
  assert.equal(avalia(produto({ linkWatch: lido({ price: 200, checkedAt: HORAS(-60) }) })).cancelar, false);
  assert.equal(avalia(produto({ linkWatch: lido({ price: 200, currency: 'USD' }) })).cancelar, false);
  assert.equal(avalia(produto({ linkWatch: undefined })).cancelar, false);
  assert.equal(avalia(produto({ linkWatch: { status: 'ok', price: 200 } })).cancelar, false);
});

test('indisponível ou oferta acabada com prova cancela; vigia broken recente também', () => {
  assert.equal(avalia(produto({ available: false })).tipo, 'indisponivel');
  assert.equal(avalia(produto({ status: 'archived' })).cancelar, true);
  assert.equal(avalia(produto({ oferta: { terminaEm: HORAS(10) } })).tipo, 'oferta_acabou');
  assert.equal(avalia(produto({ oferta: { terminaEm: HORAS(100) } })).cancelar, false);
  assert.equal(avalia(produto({ linkWatch: lido({ status: 'broken' }) })).cancelar, true);
});

test('vídeo sem venda (produto interno) nunca é desmarcado', () => {
  const interno = { id: 'orbix-dancinha', name: 'Dancinha da ET', available: false };
  const reg = { id: 'r2', jobId: 'j2', productId: 'orbix-dancinha' };
  const r = avaliarOferta({ publication: linha({ productId: 'orbix-dancinha', jobId: 'j2' }), registro: reg, database: { products: [interno] }, now: AGORA });
  assert.equal(r.cancelar, false);
});

test('a menos de 30 min da hora, o fluxo normal decide', () => {
  assert.equal(avalia(produto({ available: false }), registro(), linha({ scheduledFor: HORAS(0.2) })).cancelar, false);
});
