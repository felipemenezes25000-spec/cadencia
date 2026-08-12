// packages/tiss/src/serializer/serialize-lote-sadt.ts
import { XmlBuilder } from './xml-builder';
import { encodeIso8859 } from './encode-iso8859';
import { emitirCabecalho, emitirEpilogo, valorDecimal } from './envelope';
import { computeTissHash } from './compute-tiss-hash';
import type {
  ContratadoSadtInput, GuiaSadtInput, LoteSadtInput, ProcedimentoSadtInput,
} from './types';

export interface SerializeLoteSadtResult {
  readonly xml: Uint8Array;
  readonly warnings: readonly string[];
}

/** `maxOccurs="100"` em `guiasTISS > guiaSP-SADT`. */
const MAX_GUIAS = 100;

/**
 * Valor do item: unitário x quantidade, com redução/acréscimo.
 *
 * DERIVADO, nunca recebido. Aceitar um total vindo de fora deixaria a guia
 * divergir dos próprios itens — e "soma dos itens diferente do valor informado"
 * é o motivo de glosa mais bobo e mais frequente que existe.
 *
 * O arredondamento é para o centavo mais próximo porque o fator de redução
 * (0.5, 0.7) produz fração de centavo, e a operadora compara com duas casas.
 */
function valorDoItem(p: ProcedimentoSadtInput): number {
  const fator = p.reducaoAcrescimo ?? 1;
  return Math.round(p.valorUnitarioCentavos * p.quantidadeExecutada * fator);
}

/** `ct_contratadoDados` é um CHOICE: exatamente um identificador. */
function emitContratado(xml: XmlBuilder, c: ContratadoSadtInput): void {
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

function emitProfissional(
  xml: XmlBuilder, tag: string, p: GuiaSadtInput['profissionalSolicitante'],
): void {
  xml.open(tag);
  xml.optionalTag('ans:nomeProfissional', p.nome);
  xml.tag('ans:conselhoProfissional', p.conselhoProfissional);
  xml.tag('ans:numeroConselhoProfissional', p.numeroConselho);
  // Código IBGE, não sigla — ver `uf-ibge.ts`.
  xml.tag('ans:UF', p.ufConselho);
  xml.tag('ans:CBOS', p.cbos);
  xml.close(tag);
}

function emitProcedimento(xml: XmlBuilder, p: ProcedimentoSadtInput): void {
  xml.open('ans:procedimentoExecutado');
  xml.tag('ans:sequencialItem', String(p.sequencialItem));
  xml.tag('ans:dataExecucao', p.dataExecucao);
  xml.optionalTag('ans:horaInicial', p.horaInicial);
  xml.optionalTag('ans:horaFinal', p.horaFinal);

  xml.open('ans:procedimento');
  xml.tag('ans:codigoTabela', p.codigoTabela);
  xml.tag('ans:codigoProcedimento', p.codigoProcedimento);
  xml.tag('ans:descricaoProcedimento', p.descricaoProcedimento);
  xml.close('ans:procedimento');

  xml.tag('ans:quantidadeExecutada', String(p.quantidadeExecutada));
  xml.optionalTag('ans:viaAcesso', p.viaAcesso);
  xml.optionalTag('ans:tecnicaUtilizada', p.tecnicaUtilizada);
  // `st_decimal3-2`: obrigatório mesmo quando não há redução — 1.00 é o neutro.
  xml.tag('ans:reducaoAcrescimo', (p.reducaoAcrescimo ?? 1).toFixed(2));
  xml.tag('ans:valorUnitario', valorDecimal(p.valorUnitarioCentavos));
  xml.tag('ans:valorTotal', valorDecimal(valorDoItem(p)));
  xml.close('ans:procedimentoExecutado');
}

function emitGuiaSadt(xml: XmlBuilder, g: GuiaSadtInput): void {
  xml.open('ans:guiaSP-SADT');

  xml.open('ans:cabecalhoGuia');
  xml.tag('ans:registroANS', g.registroANSOperadora);
  xml.tag('ans:numeroGuiaPrestador', g.numeroGuiaPrestador);
  xml.optionalTag('ans:guiaPrincipal', g.guiaPrincipal);
  xml.close('ans:cabecalhoGuia');

  if (g.autorizacao !== undefined) {
    xml.open('ans:dadosAutorizacao');
    xml.optionalTag('ans:numeroGuiaOperadora', g.autorizacao.numeroGuiaOperadora);
    xml.tag('ans:dataAutorizacao', g.autorizacao.dataAutorizacao);
    xml.optionalTag('ans:senha', g.autorizacao.senha);
    xml.optionalTag('ans:dataValidadeSenha', g.autorizacao.dataValidadeSenha);
    xml.close('ans:dadosAutorizacao');
  }

  xml.open('ans:dadosBeneficiario');
  xml.tag('ans:numeroCarteira', g.numeroCarteira);
  xml.tag('ans:atendimentoRN', g.atendimentoRN ? 'S' : 'N');
  xml.close('ans:dadosBeneficiario');

  xml.open('ans:dadosSolicitante');
  xml.open('ans:contratadoSolicitante');
  emitContratado(xml, g.contratadoSolicitante);
  xml.close('ans:contratadoSolicitante');
  xml.tag('ans:nomeContratadoSolicitante', g.nomeContratadoSolicitante);
  emitProfissional(xml, 'ans:profissionalSolicitante', g.profissionalSolicitante);
  xml.close('ans:dadosSolicitante');

  xml.open('ans:dadosSolicitacao');
  xml.optionalTag('ans:dataSolicitacao', g.dataSolicitacao);
  xml.tag('ans:caraterAtendimento', g.caraterAtendimento);
  xml.optionalTag('ans:indicacaoClinica', g.indicacaoClinica);
  xml.close('ans:dadosSolicitacao');

  xml.open('ans:dadosExecutante');
  xml.open('ans:contratadoExecutante');
  emitContratado(xml, g.contratadoExecutante);
  xml.close('ans:contratadoExecutante');
  xml.tag('ans:CNES', g.contratadoExecutante.cnes);
  xml.close('ans:dadosExecutante');

  xml.open('ans:dadosAtendimento');
  xml.tag('ans:tipoAtendimento', g.tipoAtendimento);
  xml.tag('ans:indicacaoAcidente', g.indicacaoAcidente);
  xml.optionalTag('ans:tipoConsulta', g.tipoConsulta);
  xml.tag('ans:regimeAtendimento', g.regimeAtendimento);
  xml.optionalTag('ans:saudeOcupacional', g.saudeOcupacional);
  xml.close('ans:dadosAtendimento');

  if (g.procedimentos.length > 0) {
    xml.open('ans:procedimentosExecutados');
    for (const p of g.procedimentos) emitProcedimento(xml, p);
    xml.close('ans:procedimentosExecutados');
  }

  xml.optionalTag('ans:observacao', g.observacao);

  const total = g.procedimentos.reduce((s, p) => s + valorDoItem(p), 0);
  xml.open('ans:valorTotal');
  xml.tag('ans:valorProcedimentos', valorDecimal(total));
  xml.tag('ans:valorTotalGeral', valorDecimal(total));
  xml.close('ans:valorTotal');

  xml.close('ans:guiaSP-SADT');
}

/**
 * Serializa um lote de guias SP/SADT em XML ISO-8859-1, conforme TISS 4.03.00.
 *
 * Função PURA: dados entram, bytes saem. Sem banco, sem relógio, sem I/O — o
 * que permite o teste validar o resultado contra o XSD oficial sem subir nada.
 */
export function serializeLoteSadt(input: LoteSadtInput): SerializeLoteSadtResult {
  const { cabecalho, numeroLote, guias } = input;

  const primeira = guias[0];
  if (primeira === undefined) throw new Error('lote sem guias');
  if (guias.length > MAX_GUIAS) {
    // Recusar aqui evita descobrir dias depois, no retorno da operadora, que o
    // lote inteiro foi rejeitado por exceder o limite da norma.
    throw new Error(`lote com ${guias.length} guias excede o maximo de ${MAX_GUIAS}`);
  }

  // O hash do padrão é calculado sobre os dados, não sobre o XML montado.
  const hash = computeTissHash(cabecalho, numeroLote, guias);

  const xml = new XmlBuilder();
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  emitirCabecalho(xml, {
    cabecalho, origem: primeira.contratadoExecutante, registroANS: input.registroANS,
  });

  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:loteGuias');
  xml.tag('ans:numeroLote', numeroLote);
  xml.open('ans:guiasTISS');
  for (const g of guias) emitGuiaSadt(xml, g);
  xml.close('ans:guiasTISS');
  xml.close('ans:loteGuias');
  xml.close('ans:prestadorParaOperadora');

  emitirEpilogo(xml, hash);
  xml.close('ans:mensagemTISS');

  const encoded = encodeIso8859(xml.toString());
  return { xml: encoded.bytes, warnings: encoded.warnings };
}
