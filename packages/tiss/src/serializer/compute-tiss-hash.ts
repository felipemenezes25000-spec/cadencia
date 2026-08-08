import { createHash } from 'node:crypto';
import type { CabecalhoInput, GuiaConsultaInput } from './types';

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
export function computeTissHash(
  cabecalho: CabecalhoInput,
  numeroLote: string,
  guias: readonly GuiaConsultaInput[],
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
    parts.push(guia.dataAtendimento);
    parts.push(guia.codigoProcedimento);
    parts.push(formatValorReais(guia.valorProcedimentoCentavos));
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
