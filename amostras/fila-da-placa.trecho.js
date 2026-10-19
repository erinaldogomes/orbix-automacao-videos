'use strict';
// Origem: src/filaDaPlaca.js (TRECHO, não roda sozinho: partes marcadas com "..." foram omitidas; o original tem ~480 linhas).
// O que mostra: um "lock" entre PROCESSOS e entre APLICATIVOS diferentes (todos locais, na mesma máquina) para que
// só um trabalho pesado de GPU rode por vez. Sem servidor: o protocolo é feito de arquivos numa pasta neutra.
//
// Por que existe (medido na máquina do projeto, GPU de 16 GB e 32 GB de RAM): voz neural + transcrição usam ~8 GB
// de placa; gerador de imagem com offload zera a RAM livre; os dois juntos levaram uma imagem de 27 s para 200 s.
//
// Protocolo (os outros apps seguem o mesmo):
//  - vez.json: quem está usando a placa agora { app, pid, token, etapa, desde, renovadoEm }. Criado com
//    exclusividade (flag 'wx') e renovado a cada 15 s por quem tem a vez;
//  - pedido-<token>.json: quem está esperando. A vez vai para o pedido mais antigo (FIFO);
//  - residuo-<app>-<pid>-<nome>.json: modelo que ficou carregado depois do trabalho. Quem pega a vez espera os
//    resíduos dos outros sumirem (até 90 s);
//  - arquivo velho não trava ninguém: pid morto libera na hora; pid vivo só depois de 10 min sem renovar;
//  - quem espera mais que o limite (45 min) segue SEM a vez e isso vira erro explícito para o chamador.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function estaVivo(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const VEZ_VELHA_MS = 10 * 60000;

function criarFila({
  pasta, app = 'orbix', pid = process.pid, pidVivo = estaVivo,
  logger = console, intervaloMs = 1000, renovarMs = 15000, velhoMs = 60000, velhaVezMs = VEZ_VELHA_MS, agora = () => Date.now()
} = {}) {
  const vezArq = path.join(pasta, 'vez.json');
  const iso = () => new Date(agora()).toISOString();

  function ler(arquivo) { try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; } }
  function apagar(arquivo) { try { fs.unlinkSync(arquivo); } catch { /* já saiu */ } }
  // Escrita atômica: arquivo temporário + rename, para nunca existir JSON pela metade.
  function escrever(arquivo, dados) {
    fs.mkdirSync(pasta, { recursive: true });
    const temp = `${arquivo}.${pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(dados), 'utf8');
    try { fs.renameSync(temp, arquivo); } catch (erro) { apagar(temp); throw erro; }
  }
  // Exclusão mútua: 'wx' falha com EEXIST se outro processo criou o arquivo primeiro.
  function criarExclusivo(arquivo, dados) {
    fs.mkdirSync(pasta, { recursive: true });
    try {
      fs.writeFileSync(arquivo, JSON.stringify(dados), { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (erro) {
      if (erro.code === 'EEXIST') return false;
      throw erro;
    }
  }

  function velho(registro) {
    if (!registro || !pidVivo(Number(registro.pid))) return true;
    const quando = new Date(registro.renovadoEm || registro.desde || 0).getTime();
    return !Number.isFinite(quando) || agora() - quando > velhoMs;
  }

  /**
   * A VEZ de um pid VIVO não fica 'velha' em 60 s: com o PC paginando, a renovação de 15 s atrasa, a vez parece
   * abandonada e outro app a pegava no meio do trabalho. Só pid morto libera na hora; pid vivo, após 10 min.
   */
  function velhaAVez(registro) {
    if (!registro || !pidVivo(Number(registro.pid))) return true;
    const quando = new Date(registro.renovadoEm || registro.desde || 0).getTime();
    return !Number.isFinite(quando) || agora() - quando > velhaVezMs;
  }

  /** Pedidos vivos, do mais antigo para o mais novo (o velho é apagado no caminho). */
  function pedidos() {
    // ... lista pedido-*.json, apaga os velhos, ordena por `desde` e desempata por `token`
  }

  async function pegar({ etapa = 'placa', timeoutMs = 45 * 60000 } = {}) {
    const token = crypto.randomBytes(8).toString('hex');
    const pedidoArq = path.join(pasta, `pedido-${token}.json`);
    const pedido = { app, pid, token, etapa, desde: iso(), renovadoEm: iso() };
    const semVez = (motivo) => ({ token: null, etapa, semVez: true, motivo, soltar() {} });
    try { escrever(pedidoArq, pedido); } catch (erro) { return semVez(erro.message); }
    const renovaPedido = setInterval(() => { try { escrever(pedidoArq, { ...pedido, renovadoEm: iso() }); } catch { /* próxima */ } }, renovarMs);
    let limite = agora() + timeoutMs;
    let viuLivre = false;
    try {
      for (;;) {
        const atual = ler(vezArq);
        if (atual && velhaAVez(atual)) {
          // Relê antes de apagar: só apaga se ainda for a MESMA vez abandonada (outro pode ter acabado de pegar).
          const deNovo = ler(vezArq);
          if (deNovo && deNovo.token === atual.token) apagar(vezArq);
        }
        const fila = pedidos();
        /**
         * A vez tem que aparecer LIVRE DUAS VEZES SEGUIDAS. Uma renovação que apaga antes de escrever deixa uma
         * fresta de milissegundos em que a vez parece ausente; quem olha uma vez só entra na fresta e vai para a
         * placa junto com quem já estava lá (aconteceu de madrugada, dois apps na GPU ao mesmo tempo).
         */
        const livreAgora = !ler(vezArq) && (!fila.length || fila[0].token === token);
        if (livreAgora && viuLivre) {
          if (criarExclusivo(vezArq, { app, pid, token, etapa, desde: iso(), renovadoEm: iso() })) break;
        }
        viuLivre = livreAgora;
        // ... enquanto o dono está jogando, a espera não conta no relógio (limite += intervaloMs)
        if (agora() >= limite) return semVez('tempo esgotado');
        await esperar(intervaloMs);
      }
    } finally {
      clearInterval(renovaPedido);
      apagar(pedidoArq);
    }

    // Peguei a vez: renovo e acuso se outro app tomou a vez no meio do trabalho (atropelo ao vivo, que antes passava calado).
    let perdida = false;
    const renovaVez = setInterval(() => {
      const atual = ler(vezArq);
      if (atual && atual.token === token) { try { escrever(vezArq, { ...atual, renovadoEm: iso() }); } catch { /* próxima */ } }
      else if (atual && !perdida) {
        perdida = true;
        logger.warn?.(`[Fila da placa] ${etapa}: perdi a vez no meio do trabalho para ${atual.app}.`);
      }
    }, renovarMs);
    const soltar = () => {
      clearInterval(renovaVez);
      const atual = ler(vezArq);
      if (atual && atual.token === token) apagar(vezArq);
      // ... registra uma linha no diário uso.jsonl (quem pegou, quanto esperou, quanto usou) para medir gargalos
    };
    // ... espera os resíduos (modelos carregados) dos outros apps sumirem, até 90 s
    return { token, etapa, semVez: false, soltar };
  }

  return { pegar /* , alguemEsperando, registrarResiduo, largarTudo, limparSobras, ... */ };
}

/** Sem a vez, sem GPU: vencido o tempo, quem chamou NÃO pode carregar modelo; o trabalho volta para a próxima rodada. */
function exigirAVez(vez) {
  if (vez && vez.semVez === true && vez.motivo === 'tempo esgotado') {
    throw Object.assign(new Error(`não usei a placa sem a vez (${vez.etapa || 'placa'})`), { code: 'SEM_VEZ_DA_PLACA', semVez: true });
  }
  return vez;
}

module.exports = { criarFila, exigirAVez, estaVivo, VEZ_VELHA_MS };
