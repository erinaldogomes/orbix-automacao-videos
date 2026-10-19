'use strict';
// Origem: tests/affiliate-preco-para-gravar.test.js (cópia; só o caminho do require mudou).
// O que mostra: teste OFFLINE da decisão de preço (node:test, sem rede, sem pasta real). Rodar: node --test amostras/
const test = require('node:test');
const assert = require('node:assert/strict');
const { avaliar, precisaConfirmar } = require('./preco-para-gravar');

const agora = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const produto = (p = 100) => ({ id: 'p1', marketplace: 'Mercado Livre', price: { current: p, currency: 'BRL' } });
const lw = (price, quando, extra = {}) => ({ status: 'ok', price, currency: 'BRL', checkedAt: iso(quando), ...extra });

test('ML: leitura nova bate com a anterior (5%) e grava', () => {
  const r = avaliar({ produto: produto(100), antes: lw(100, agora - 3600000), agora: lw(103, agora), inicio: agora - 5000 });
  assert.equal(r.ok, true);
});

test('ML: divergência acima de 5% (9,99 para 19,99) não grava', () => {
  const r = avaliar({ produto: produto(9.99), antes: lw(9.99, agora - 3600000), agora: lw(19.99, agora), inicio: agora - 5000 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /divergem/);
});

test('ML: a leitura nova precisa ter acontecido agora e ser boa', () => {
  assert.equal(avaliar({ produto: produto(), antes: lw(100, agora - 7200000), agora: lw(100, agora - 7200000), inicio: agora - 5000 }).ok, false);
  assert.equal(avaliar({ produto: produto(), antes: lw(100, agora - 7200000), agora: lw(100, agora, { status: 'suspect' }), inicio: agora - 5000 }).ok, false);
  assert.equal(avaliar({ produto: produto(), antes: lw(100, agora - 7200000), agora: lw(100, agora, { currency: 'USD' }), inicio: agora - 5000 }).ok, false);
});

test('ML: sem leitura anterior, o preço do cadastro faz o papel da 2a leitura; sem nenhuma, não grava', () => {
  assert.equal(avaliar({ produto: produto(100), antes: null, agora: lw(101, agora), inicio: agora - 5000 }).ok, true);
  assert.equal(avaliar({ produto: { id: 'p1', marketplace: 'Mercado Livre' }, antes: null, agora: lw(101, agora), inicio: agora - 5000 }).ok, false);
});

test('Shopee: compara a leitura do vigia com o cadastro, sem nova consulta', () => {
  const sp = { id: 'p2', marketplace: 'Shopee', price: { current: 50, currency: 'BRL' } };
  assert.equal(avaliar({ produto: sp, antes: null, agora: lw(52, agora - 3600000), inicio: agora, ml: false }).ok, true);
  assert.equal(avaliar({ produto: sp, antes: null, agora: lw(80, agora - 3600000), inicio: agora, ml: false }).ok, false);
});

test('vídeo sem venda e produto da marca não precisam de confirmação', () => {
  assert.equal(precisaConfirmar({ productId: 'orbix-dancinha' }, { id: 'orbix-dancinha' }), false);
  assert.equal(precisaConfirmar({ productId: 'x', origem: 'semVenda' }, { id: 'x' }), false);
  assert.equal(precisaConfirmar({ productId: 'x', danca: {} }, { id: 'x' }), false);
  assert.equal(precisaConfirmar({ productId: 'x' }, { id: 'x', marca: true }), false);
  assert.equal(precisaConfirmar({ productId: 'x' }, { id: 'x' }), true);
});
