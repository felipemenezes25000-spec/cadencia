// packages/tiss/src/serializer/envelope.ts
import type { XmlBuilder } from './xml-builder';
import type { CabecalhoInput, ContratadoInput } from './types';

/**
 * O envelope `ans:mensagemTISS` conforme o XSD 4.03.00 publicado pela ANS.
 *
 * O cabecalho do padrao NAO e plano. O que o repositorio emitia — versaoPadrao,
 * registroANS, dataGeracao, horaGeracao, sequencialTransacao, um atras do outro
 * — era o formato de um XSD de amostra escrito a mao, nunca o da norma. Contra o
 * schema oficial o libxml2 recusa na primeira linha:
 *
 *   Element 'versaoPadrao': This element is not expected.
 *   Expected is ( identificacaoTransacao ).
 *
 * A forma real agrupa por proposito: QUE transacao e esta (`identificacaoTransacao`),
 * QUEM manda (`origem`), PARA QUEM (`destino`), e em que versao do padrao
 * (`Padrao`). Origem e destino sao `choice`: prestador se identifica por CNPJ,
 * CPF ou codigo na operadora — nunca por mais de um.
 */

/** Um dos tres identificadores do prestador. A norma aceita exatamente um. */
function emitirIdentificacaoPrestador(xml: XmlBuilder, c: ContratadoInput): void {
  // Ordem de preferencia: CNPJ identifica a pessoa juridica de forma estavel;
  // o codigo na operadora e local e muda quando o contrato e renegociado.
  if (c.cnpjContratado !== undefined && c.cnpjContratado !== '') {
    xml.tag('ans:CNPJ', c.cnpjContratado);
  } else if (c.cpfContratado !== undefined && c.cpfContratado !== '') {
    xml.tag('ans:CPF', c.cpfContratado);
  } else if (c.codigoPrestadorNaOperadora !== undefined
             && c.codigoPrestadorNaOperadora !== '') {
    xml.tag('ans:codigoPrestadorNaOperadora', c.codigoPrestadorNaOperadora);
  } else {
    // Falhar aqui e melhor que emitir `<identificacaoPrestador/>` vazio: o XSD
    // recusaria de qualquer forma, mas so depois de o lote inteiro ter sido
    // montado, e a mensagem do libxml2 nao diria de qual prestador se trata.
    throw new Error('prestador sem CNPJ, CPF ou codigo na operadora');
  }
}

export interface EnvelopeInput {
  readonly cabecalho: CabecalhoInput;
  /** Identificacao do prestador que ORIGINA a mensagem. */
  readonly origem: ContratadoInput;
  /** Registro ANS da operadora DESTINO, 6 digitos. */
  readonly registroANS: string;
}

/** `ans:cabecalho` — tipo `cabecalhoTransacao` do XSD. */
export function emitirCabecalho(xml: XmlBuilder, e: EnvelopeInput): void {
  xml.open('ans:cabecalho');

  xml.open('ans:identificacaoTransacao');
  // Lote de guias enviado pelo prestador. Outras transacoes (elegibilidade,
  // autorizacao, recurso de glosa) tem tipo proprio no dominio dm_tipoTransacao.
  xml.tag('ans:tipoTransacao', 'ENVIO_LOTE_GUIAS');
  xml.tag('ans:sequencialTransacao', e.cabecalho.sequencialTransacao);
  xml.tag('ans:dataRegistroTransacao', e.cabecalho.dataGeracao);
  xml.tag('ans:horaRegistroTransacao', e.cabecalho.horaGeracao);
  xml.close('ans:identificacaoTransacao');

  xml.open('ans:origem');
  xml.open('ans:identificacaoPrestador');
  emitirIdentificacaoPrestador(xml, e.origem);
  xml.close('ans:identificacaoPrestador');
  xml.close('ans:origem');

  xml.open('ans:destino');
  xml.tag('ans:registroANS', e.registroANS);
  xml.close('ans:destino');

  // `Padrao` com P maiusculo — e assim no XSD, e o validador diferencia.
  xml.tag('ans:Padrao', e.cabecalho.versaoPadrao);

  xml.close('ans:cabecalho');
}

/** `ans:epilogo` — carrega o hash proprietario do padrao. */
export function emitirEpilogo(xml: XmlBuilder, hash: string): void {
  xml.open('ans:epilogo');
  xml.tag('ans:hash', hash);
  xml.close('ans:epilogo');
}

/** Centavos inteiros para o `st_decimal10-2` que a norma exige. */
export function valorDecimal(centavos: number): string {
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const reais = Math.trunc(abs / 100);
  const cents = abs % 100;
  return `${negativo ? '-' : ''}${reais}.${String(cents).padStart(2, '0')}`;
}
