import { XmlBuilder } from './xml-builder';
import { encodeIso8859 } from './encode-iso8859';
import { computeTissHash } from './compute-tiss-hash';
import type { LoteConsultaInput, GuiaConsultaInput } from './types';

/**
 * Resultado da serializacao de um lote de consulta TISS.
 */
export interface SerializeLoteResult {
  /** XML completo em bytes ISO-8859-1, pronto para envio. */
  readonly xml: Uint8Array;
  /** Warnings de caracteres nao mapeados para ISO-8859-1. */
  readonly warnings: readonly string[];
}

/**
 * Serializa um lote de guias de consulta TISS em XML ISO-8859-1.
 *
 * Funcao PURA: recebe dados tipados, devolve Uint8Array. ZERO side-effect.
 * O hash MD5 proprietario e calculado e embutido em <ans:hash>.
 * O XML segue o padrao TISS 4.01.00 (ou a versao do lote).
 */
export function serializeLoteConsulta(input: LoteConsultaInput): SerializeLoteResult {
  const { cabecalho, numeroLote, guias } = input;

  // Calcula o hash antes de montar o XML — ele sera embutido no epilogo
  const hash = computeTissHash(cabecalho, numeroLote, guias);

  const xml = new XmlBuilder();

  // Raiz com namespace ANS
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  // ---- Cabecalho ----
  emitCabecalho(xml, cabecalho);

  // ---- Corpo: prestadorParaOperadora > loteGuias ----
  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:loteGuias');
  xml.tag('ans:numeroLote', numeroLote);

  for (const guia of guias) {
    emitGuiaConsulta(xml, guia);
  }

  xml.close('ans:loteGuias');
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

function emitCabecalho(xml: XmlBuilder, cab: LoteConsultaInput['cabecalho']): void {
  xml.open('ans:cabecalho');
  xml.tag('ans:versaoPadrao', cab.versaoPadrao);
  xml.tag('ans:registroANS', cab.registroANS);
  xml.tag('ans:dataGeracao', cab.dataGeracao);
  xml.tag('ans:horaGeracao', cab.horaGeracao);
  xml.tag('ans:sequencialTransacao', cab.sequencialTransacao);
  xml.close('ans:cabecalho');
}

function emitGuiaConsulta(xml: XmlBuilder, guia: GuiaConsultaInput): void {
  xml.open('ans:guiaConsulta');

  xml.tag('ans:numeroGuiaPrestador', guia.numeroGuiaPrestador);
  xml.optionalTag('ans:numeroGuiaOperadora', guia.numeroGuiaOperadora);
  xml.tag('ans:numeroCarteira', guia.numeroCarteira);
  xml.tag('ans:atendimentoRN', guia.atendimentoRN ? 'S' : 'N');

  // Dados do contratado
  xml.open('ans:dadosContratado');
  xml.optionalTag('ans:codigoPrestadorNaOperadora', guia.contratado.codigoPrestadorNaOperadora);
  xml.optionalTag('ans:cpfContratado', guia.contratado.cpfContratado);
  xml.optionalTag('ans:cnpjContratado', guia.contratado.cnpjContratado);
  xml.tag('ans:CNES', guia.contratado.cnes);
  xml.close('ans:dadosContratado');

  // Profissional executante
  xml.open('ans:profissionalExecutante');
  xml.tag('ans:conselhoProfissional', guia.profissionalExecutante.conselhoProfissional);
  xml.tag('ans:numeroConselho', guia.profissionalExecutante.numeroConselho);
  xml.tag('ans:ufConselho', guia.profissionalExecutante.ufConselho);
  xml.tag('ans:CBOS', guia.profissionalExecutante.cbos);
  xml.close('ans:profissionalExecutante');

  // Dados do atendimento
  xml.tag('ans:indicacaoAcidente', guia.indicacaoAcidente);
  xml.tag('ans:regimeAtendimento', guia.regimeAtendimento);
  xml.optionalTag('ans:saudeOcupacional', guia.saudeOcupacional);
  xml.optionalTag('ans:coberturaEspecial', guia.coberturaEspecial);
  xml.tag('ans:dataAtendimento', guia.dataAtendimento);
  xml.tag('ans:tipoConsulta', guia.tipoConsulta);

  // Procedimento
  xml.tag('ans:codigoTabela', guia.codigoTabela);
  xml.tag('ans:codigoProcedimento', guia.codigoProcedimento);
  xml.tag('ans:valorProcedimento', formatValorReais(guia.valorProcedimentoCentavos));
  xml.optionalTag('ans:observacao', guia.observacao);

  xml.close('ans:guiaConsulta');
}

function formatValorReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
