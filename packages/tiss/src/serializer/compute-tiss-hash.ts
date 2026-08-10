import { createHash } from 'node:crypto';
import type { CabecalhoInput, ItemRecursoGlosaInput } from './types';

/**
 * Calcula o hash MD5 proprietario do padrao TISS.
 *
 * O hash e construido pela concatenacao de campos especificos do cabecalho
 * e de cada guia, na ordem definida pelo XSD da ANS, seguida de MD5 hex.
 * Este hash e embutido na tag <ans:hash> do XML.
 *
 * Campos concatenados (ordem do XSD):
 *   cabecalho: registroANS + dataGeracao + horaGeracao + sequencialTransacao
 *   lote: numeroLote
 *   por guia: numeroGuiaPrestador + dataAtendimento + codigoProcedimento + valorProcedimento
 *
 * O valor do procedimento e formatado como reais com 2 casas decimais (ex: 15000 centavos -> "150.00").
 */
/**
 * O minimo que uma guia precisa expor para entrar no hash do lote.
 *
 * Nao e `GuiaConsultaInput` porque SP/SADT tambem passa por aqui, e uma guia de
 * SADT tem N procedimentos em vez de um. Aceitar a forma reduzida deixa o hash
 * servir aos dois tipos sem cada um conhecer o outro.
 */
export interface GuiaParaHash {
  readonly numeroGuiaPrestador: string;
  readonly dataAtendimento?: string;
  readonly codigoProcedimento?: string;
  readonly valorProcedimentoCentavos?: number;
  /** SP/SADT: os itens executados, quando a guia os tiver. */
  readonly procedimentos?: readonly {
    readonly dataExecucao: string;
    readonly codigoProcedimento: string;
    readonly valorUnitarioCentavos: number;
    readonly quantidadeExecutada: number;
    readonly reducaoAcrescimo?: number;
  }[];
}

export function computeTissHash(
  cabecalho: CabecalhoInput,
  numeroLote: string,
  guias: readonly GuiaParaHash[],
): string {
  const parts: string[] = [];

  // Campos do cabecalho
  parts.push(cabecalho.registroANS);
  parts.push(cabecalho.dataGeracao);
  parts.push(cabecalho.horaGeracao);
  parts.push(cabecalho.sequencialTransacao);

  // Numero do lote
  parts.push(numeroLote);

  // Campos de cada guia na ordem de insercao no lote
  for (const guia of guias) {
    parts.push(guia.numeroGuiaPrestador);
    if (guia.procedimentos !== undefined) {
      // SP/SADT: cada item entra, na ordem em que aparece na guia. Reduzir a
      // guia a um so procedimento faria duas guias com os mesmos itens em ordem
      // diferente colidirem no hash.
      for (const p of guia.procedimentos) {
        parts.push(p.dataExecucao);
        parts.push(p.codigoProcedimento);
        parts.push(formatValorReais(Math.round(
          p.valorUnitarioCentavos * p.quantidadeExecutada * (p.reducaoAcrescimo ?? 1))));
      }
    } else {
      parts.push(guia.dataAtendimento ?? '');
      parts.push(guia.codigoProcedimento ?? '');
      parts.push(formatValorReais(guia.valorProcedimentoCentavos ?? 0));
    }
  }

  const concatenated = parts.join('');
  return createHash('md5').update(concatenated, 'utf8').digest('hex');
}

/**
 * Calcula o hash MD5 proprietario do recurso de glosa TISS.
 *
 * Campos concatenados (ordem do XSD):
 *   cabecalho: registroANS + dataGeracao + horaGeracao + sequencialTransacao
 *   recurso: numeroLoteOriginal + numeroRecursoGlosa
 *   por item: sequencialItem + codigoProcedimento + valorRecursado
 *
 * O valor recursado e formatado como reais com 2 casas decimais.
 */
export function computeRecursoGlosaHash(
  cabecalho: CabecalhoInput,
  numeroLoteOriginal: string,
  numeroRecursoGlosa: string,
  itens: readonly ItemRecursoGlosaInput[],
): string {
  const parts: string[] = [];

  // Campos do cabecalho
  parts.push(cabecalho.registroANS);
  parts.push(cabecalho.dataGeracao);
  parts.push(cabecalho.horaGeracao);
  parts.push(cabecalho.sequencialTransacao);

  // Identificacao do recurso
  parts.push(numeroLoteOriginal);
  parts.push(numeroRecursoGlosa);

  // Campos de cada item na ordem de insercao
  for (const item of itens) {
    parts.push(item.sequencialItem);
    parts.push(item.codigoProcedimento);
    parts.push(formatValorReais(item.valorRecursadoCentavos));
  }

  const concatenated = parts.join('');
  return createHash('md5').update(concatenated, 'utf8').digest('hex');
}

/**
 * Formata centavos inteiros como reais com 2 casas decimais.
 * Ex: 15000 -> '150.00', 15001 -> '150.01', 99 -> '0.99'
 */
function formatValorReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
