import { XmlBuilder } from './xml-builder';
import { encodeIso8859 } from './encode-iso8859';
import { computeTissHash } from './compute-tiss-hash';
import { emitirCabecalho, emitirEpilogo, valorDecimal } from './envelope';
import type { LoteConsultaInput, GuiaConsultaInput } from './types';

/**
 * Resultado da serialização de um lote de consulta TISS.
 */
export interface SerializeLoteResult {
  /** XML completo em bytes ISO-8859-1, pronto para envio. */
  readonly xml: Uint8Array;
  /** Warnings de caracteres não mapeados para ISO-8859-1. */
  readonly warnings: readonly string[];
}

/**
 * Serializa um lote de guias de consulta TISS em XML ISO-8859-1.
 *
 * Função PURA: recebe dados tipados, devolve Uint8Array. ZERO side-effect.
 * O hash MD5 proprietário é calculado e embutido em <ans:hash>.
 * O XML segue o padrão TISS 4.01.00 (ou a versão do lote).
 */
export function serializeLoteConsulta(input: LoteConsultaInput): SerializeLoteResult {
  const { cabecalho, numeroLote, guias } = input;

  // Calcula o hash antes de montar o XML — ele será embutido no epílogo
  const hash = computeTissHash(cabecalho, numeroLote, guias);

  const xml = new XmlBuilder();

  // Raiz com namespace ANS
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  // ---- Cabeçalho ----
  // A origem sai do contratado da primeira guia: num lote todas as guias são do
  // mesmo prestador, por construção de `tiss.lote`. Sem guia não há lote.
  const primeira = guias[0];
  if (primeira === undefined) throw new Error('lote sem guias');
  emitirCabecalho(xml, {
    cabecalho, origem: primeira.contratado, registroANS: input.registroANS,
  });

  // ---- Corpo: prestadorParaOperadora > loteGuias > guiasTISS ----
  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:loteGuias');
  xml.tag('ans:numeroLote', numeroLote);

  // `guiasTISS` não é decoração: é o `choice` que impede o lote de misturar
  // consulta com SP/SADT. A operadora processa cada tipo por uma esteira
  // diferente, e um lote misto seria recusado inteiro.
  xml.open('ans:guiasTISS');
  for (const guia of guias) {
    emitGuiaConsulta(xml, guia);
  }
  xml.close('ans:guiasTISS');

  xml.close('ans:loteGuias');
  xml.close('ans:prestadorParaOperadora');

  emitirEpilogo(xml, hash);

  xml.close('ans:mensagemTISS');

  // Codifica para ISO-8859-1
  const encoded = encodeIso8859(xml.toString());

  return {
    xml: encoded.bytes,
    warnings: encoded.warnings,
  };
}

/**
 * Uma guia de consulta — tipo `ctm_consultaGuia` do XSD.
 *
 * A ordem dos elementos é normativa: `sequence`, não `all`. Trocar dois campos
 * de lugar produz XML bem-formado que a operadora recusa.
 */
function emitGuiaConsulta(xml: XmlBuilder, guia: GuiaConsultaInput): void {
  xml.open('ans:guiaConsulta');

  xml.open('ans:cabecalhoConsulta');
  xml.tag('ans:registroANS', guia.registroANSOperadora);
  xml.tag('ans:numeroGuiaPrestador', guia.numeroGuiaPrestador);
  xml.close('ans:cabecalhoConsulta');

  xml.optionalTag('ans:numeroGuiaOperadora', guia.numeroGuiaOperadora);

  xml.open('ans:dadosBeneficiario');
  xml.tag('ans:numeroCarteira', guia.numeroCarteira);
  xml.tag('ans:atendimentoRN', guia.atendimentoRN ? 'S' : 'N');
  xml.close('ans:dadosBeneficiario');

  // `ct_contratadoDados` é um CHOICE: exatamente um identificador. O código
  // antigo emitia codigoPrestadorNaOperadora E cnpjContratado juntos.
  xml.open('ans:contratadoExecutante');
  emitIdentificacaoContratado(xml, guia);
  xml.tag('ans:CNES', guia.contratado.cnes);
  xml.close('ans:contratadoExecutante');

  xml.open('ans:profissionalExecutante');
  xml.optionalTag('ans:nomeProfissional', guia.profissionalExecutante.nome);
  xml.tag('ans:conselhoProfissional', guia.profissionalExecutante.conselhoProfissional);
  // O XSD chama `numeroConselhoProfissional` e `UF`, não `numeroConselho`/`ufConselho`.
  xml.tag('ans:numeroConselhoProfissional', guia.profissionalExecutante.numeroConselho);
  xml.tag('ans:UF', guia.profissionalExecutante.ufConselho);
  xml.tag('ans:CBOS', guia.profissionalExecutante.cbos);
  xml.close('ans:profissionalExecutante');

  xml.tag('ans:indicacaoAcidente', guia.indicacaoAcidente);

  xml.open('ans:dadosAtendimento');
  xml.optionalTag('ans:coberturaEspecial', guia.coberturaEspecial);
  xml.tag('ans:regimeAtendimento', guia.regimeAtendimento);
  xml.optionalTag('ans:saudeOcupacional', guia.saudeOcupacional);
  xml.tag('ans:dataAtendimento', guia.dataAtendimento);
  xml.tag('ans:tipoConsulta', guia.tipoConsulta);
  xml.open('ans:procedimento');
  xml.tag('ans:codigoTabela', guia.codigoTabela);
  xml.tag('ans:codigoProcedimento', guia.codigoProcedimento);
  xml.tag('ans:valorProcedimento', valorDecimal(guia.valorProcedimentoCentavos));
  xml.close('ans:procedimento');
  xml.close('ans:dadosAtendimento');

  xml.optionalTag('ans:observacao', guia.observacao);

  xml.close('ans:guiaConsulta');
}

function emitIdentificacaoContratado(xml: XmlBuilder, guia: GuiaConsultaInput): void {
  const c = guia.contratado;
  if (c.cnpjContratado !== undefined && c.cnpjContratado !== '') {
    xml.tag('ans:cnpjContratado', c.cnpjContratado);
  } else if (c.cpfContratado !== undefined && c.cpfContratado !== '') {
    xml.tag('ans:cpfContratado', c.cpfContratado);
  } else if (c.codigoPrestadorNaOperadora !== undefined
             && c.codigoPrestadorNaOperadora !== '') {
    xml.tag('ans:codigoPrestadorNaOperadora', c.codigoPrestadorNaOperadora);
  } else {
    throw new Error('contratado sem CNPJ, CPF ou codigo na operadora');
  }
}
