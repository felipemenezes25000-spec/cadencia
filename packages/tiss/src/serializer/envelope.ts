// packages/tiss/src/serializer/envelope.ts
import type { XmlBuilder } from './xml-builder';
import type { CabecalhoInput, ContratadoInput } from './types';

/**
 * O envelope `ans:mensagemTISS` conforme o XSD 4.03.00 publicado pela ANS.
 *
 * O cabeçalho do padrão NÃO é plano. O que o repositório emitia — versaoPadrao,
 * registroANS, dataGeracao, horaGeracao, sequencialTransacao, um atrás do outro
 * — era o formato de um XSD de amostra escrito a mão, nunca o da norma. Contra o
 * schema oficial o libxml2 recusa na primeira linha:
 *
 *   Element 'versaoPadrao': This element is not expected.
 *   Expected is ( identificacaoTransacao ).
 *
 * A forma real agrupa por propósito: QUE transação é esta (`identificacaoTransacao`),
 * QUEM manda (`origem`), PARA QUEM (`destino`), e em que versão do padrão
 * (`Padrao`). Origem e destino são `choice`: prestador se identifica por CNPJ,
 * CPF ou código na operadora — nunca por mais de um.
 */

/** Um dos três identificadores do prestador. A norma aceita exatamente um. */
function emitirIdentificacaoPrestador(xml: XmlBuilder, c: ContratadoInput): void {
  // Ordem de preferência: CNPJ identifica a pessoa jurídica de forma estável;
  // o código na operadora é local e muda quando o contrato é renegociado.
  if (c.cnpjContratado !== undefined && c.cnpjContratado !== '') {
    xml.tag('ans:CNPJ', c.cnpjContratado);
  } else if (c.cpfContratado !== undefined && c.cpfContratado !== '') {
    xml.tag('ans:CPF', c.cpfContratado);
  } else if (c.codigoPrestadorNaOperadora !== undefined
             && c.codigoPrestadorNaOperadora !== '') {
    xml.tag('ans:codigoPrestadorNaOperadora', c.codigoPrestadorNaOperadora);
  } else {
    // Falhar aqui é melhor que emitir `<identificacaoPrestador/>` vazio: o XSD
    // recusaria de qualquer forma, mas só depois de o lote inteiro ter sido
    // montado, e a mensagem do libxml2 não diria de qual prestador se trata.
    throw new Error('prestador sem CNPJ, CPF ou codigo na operadora');
  }
}

export interface EnvelopeInput {
  readonly cabecalho: CabecalhoInput;
  /** Identificação do prestador que ORIGINA a mensagem. */
  readonly origem: ContratadoInput;
  /** Registro ANS da operadora DESTINO, 6 dígitos. */
  readonly registroANS: string;
}

/** `ans:cabecalho` — tipo `cabecalhoTransacao` do XSD. */
export function emitirCabecalho(xml: XmlBuilder, e: EnvelopeInput): void {
  xml.open('ans:cabecalho');

  xml.open('ans:identificacaoTransacao');
  // Lote de guias enviado pelo prestador. Outras transações (elegibilidade,
  // autorização, recurso de glosa) têm tipo próprio no domínio dm_tipoTransacao.
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

  // `Padrao` com P maiúsculo — é assim no XSD, e o validador diferencia.
  xml.tag('ans:Padrao', e.cabecalho.versaoPadrao);

  xml.close('ans:cabecalho');
}

/** `ans:epilogo` — carrega o hash proprietário do padrão. */
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
