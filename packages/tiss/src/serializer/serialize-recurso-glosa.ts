import { XmlBuilder } from './xml-builder';
import { encodeIso8859 } from './encode-iso8859';
import { computeRecursoGlosaHash } from './compute-tiss-hash';
import type { RecursoGlosaInput, ItemRecursoGlosaInput } from './types';

/**
 * Resultado da serializacao de um recurso de glosa TISS.
 */
export interface SerializeRecursoGlosaResult {
  /** XML completo em bytes ISO-8859-1, pronto para envio. */
  readonly xml: Uint8Array;
  /** Warnings de caracteres nao mapeados para ISO-8859-1. */
  readonly warnings: readonly string[];
}

/**
 * Serializa um recurso de glosa TISS em XML ISO-8859-1.
 *
 * Funcao PURA: recebe dados tipados, devolve Uint8Array. ZERO side-effect.
 * O hash MD5 proprietario e calculado e embutido em <ans:hash>.
 * O XML segue o padrao TISS 4.01.00 (ou a versao do recurso).
 *
 * O encounterVersionId esta no input mas NAO vai no XML — e obrigatorio
 * para rastreabilidade (§3.9: recurso de glosa sempre cita a versao usada).
 */
export function serializeRecursoGlosa(input: RecursoGlosaInput): SerializeRecursoGlosaResult {
  const { cabecalho, numeroLoteOriginal, numeroRecursoGlosa, contratado, itens } = input;

  // Calcula o hash antes de montar o XML — ele sera embutido no epilogo
  const hash = computeRecursoGlosaHash(cabecalho, numeroLoteOriginal, numeroRecursoGlosa, itens);

  const xml = new XmlBuilder();

  // Raiz com namespace ANS
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  // ---- Cabecalho ----
  emitCabecalho(xml, cabecalho);

  // ---- Corpo: prestadorParaOperadora > recursoGlosa ----
  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:recursoGlosa');

  xml.tag('ans:registroANS', input.registroANS);
  xml.tag('ans:numeroLoteOriginal', numeroLoteOriginal);
  xml.tag('ans:numeroRecursoGlosa', numeroRecursoGlosa);

  // Dados do contratado
  xml.open('ans:dadosContratado');
  xml.optionalTag('ans:codigoPrestadorNaOperadora', contratado.codigoPrestadorNaOperadora);
  xml.optionalTag('ans:cpfContratado', contratado.cpfContratado);
  xml.optionalTag('ans:cnpjContratado', contratado.cnpjContratado);
  xml.tag('ans:CNES', contratado.cnes);
  xml.close('ans:dadosContratado');

  // Itens do recurso
  for (const item of itens) {
    emitItemRecurso(xml, item);
  }

  xml.close('ans:recursoGlosa');
  xml.close('ans:prestadorParaOperadora');

  // ---- Epilogo: hash ----
  xml.open('ans:epilogo');
  xml.tag('ans:hash', hash);
  xml.close('ans:epilogo');

  xml.close('ans:mensagemTISS');

  // Codifica para ISO-8859-1
  const encoded = encodeIso8859(xml.toString());

  return {
    xml: encoded.bytes,
    warnings: encoded.warnings,
  };
}

function emitCabecalho(xml: XmlBuilder, cab: RecursoGlosaInput['cabecalho']): void {
  xml.open('ans:cabecalho');
  xml.tag('ans:versaoPadrao', cab.versaoPadrao);
  xml.tag('ans:registroANS', cab.registroANS);
  xml.tag('ans:dataGeracao', cab.dataGeracao);
  xml.tag('ans:horaGeracao', cab.horaGeracao);
  xml.tag('ans:sequencialTransacao', cab.sequencialTransacao);
  xml.close('ans:cabecalho');
}

function emitItemRecurso(xml: XmlBuilder, item: ItemRecursoGlosaInput): void {
  xml.open('ans:itemRecursoGlosa');
  xml.tag('ans:sequencialItem', item.sequencialItem);
  xml.tag('ans:dataAtendimento', item.dataAtendimento);
  xml.tag('ans:numeroGuiaPrestador', item.numeroGuiaPrestador);
  xml.optionalTag('ans:numeroGuiaOperadora', item.numeroGuiaOperadora);
  xml.tag('ans:codigoProcedimento', item.codigoProcedimento);
  xml.tag('ans:codigoGlosa', item.codigoGlosa);
  xml.tag('ans:valorRecursado', formatValorReais(item.valorRecursadoCentavos));
  xml.tag('ans:justificativa', item.justificativa);
  xml.close('ans:itemRecursoGlosa');
}

function formatValorReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
