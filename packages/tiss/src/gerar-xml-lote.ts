// packages/tiss/src/gerar-xml-lote.ts
import type { TxClient } from '@cadencia/db';
import { serializeLoteConsulta } from './serializer/serialize-lote-consulta';
import { serializeLoteSadt } from './serializer/serialize-lote-sadt';
import { ufParaCodigoIbge } from './serializer/uf-ibge';
import type {
  GuiaConsultaInput, GuiaSadtInput, ProcedimentoSadtInput,
} from './serializer/types';

/**
 * Monta o XML de um lote a partir do que está no banco.
 *
 * Este é o único lugar do sistema que traduz linhas em bytes TISS. Até agora a
 * rota `/v1/tiss/lotes/:id/xml` devolvia um placeholder — `<lote>0001</lote>` —
 * e o serializer, que existia e era testado, nunca era chamado em produção.
 *
 * A função é uma leitura pura: não grava nada, não muda status. Quem decide
 * persistir o resultado é o chamador, porque o mesmo XML é gerado tanto para
 * download quanto para envio, e só um dos dois muda o estado do lote.
 */

/** `numeric` volta do node-postgres como STRING; centavos exigem inteiro. */
function centavos(numerico: string): number {
  return Math.round(Number(numerico) * 100);
}

/**
 * A data que o banco guarda, sem passar por `Date`.
 *
 * `date` do Postgres chega como 'YYYY-MM-DD' quando o driver não converte, mas
 * como objeto quando converte. Normalizar por texto evita o deslocamento de um
 * dia: construir uma data a partir de 'YYYY-MM-DD' a interpreta como UTC, e em
 * fuso negativo o dia exibido volta um. Uma guia de 09/08 viraria 08/08 — e a
 * operadora glosa por data de atendimento fora da competência.
 */
function dataIso(valor: string | Date): string {
  return typeof valor === 'string' ? valor.slice(0, 10) : valor.toISOString().slice(0, 10);
}

function horaOuIndefinido(valor: string | null): string | undefined {
  return valor === null ? undefined : valor.slice(0, 8);
}

function textoOuIndefinido(valor: string | null): string | undefined {
  return valor === null || valor === '' ? undefined : valor;
}

export interface LoteParaXml {
  readonly numeroLote: string;
  readonly tissVersion: string;
  readonly registroAns: string;
  readonly tipo: 'consulta' | 'sadt';
}

export interface XmlDoLote {
  readonly xml: Uint8Array;
  readonly warnings: readonly string[];
  readonly tipo: 'consulta' | 'sadt';
  readonly quantidadeDeGuias: number;
}

interface CabecalhoDoBanco {
  readonly dataGeracao: string;
  readonly horaGeracao: string;
  readonly sequencialTransacao: string;
}

/**
 * Data e hora de geração vem do LOTE, não do relógio de ninguém.
 *
 * O carimbo entra no `<ans:hash>` do lote e no protocolo que a operadora
 * devolve. Ler `clock_timestamp()` a cada chamada — que era o que esta função
 * fazia — dava um carimbo diferente por invocação, então o MESMO lote produzia
 * um XML e um hash diferentes a cada download. As consequências: o arquivo que
 * o operador baixa para conferir não é o que foi enviado, `xml_hash_md5`
 * guardado no envio nunca mais bate, e um reenvio depois de falha de rede chega
 * a operadora como documento diferente do primeiro.
 *
 * `l.created_at` é estável por construção: é do lote, não da chamada, e não muda
 * quando o lote é enviado. Mesmo lote, mesmo carimbo, mesmo hash — em qualquer
 * instância da API e em qualquer momento, que era a intenção original.
 */
async function cabecalhoDoBanco(
  tx: TxClient, loteId: string, numeroLote: string,
): Promise<CabecalhoDoBanco> {
  const { rows } = await tx.query<{ d: string; h: string }>(
    `SELECT to_char(l.created_at, 'YYYY-MM-DD') AS d,
            to_char(l.created_at, 'HH24:MI:SS') AS h
       FROM tiss.lote l WHERE l.id = $1`, [loteId]);
  const r = rows[0]!;
  return {
    dataGeracao: r.d,
    horaGeracao: r.h,
    // `st_texto12`: o número do lote serve de sequencial da transação, o que
    // torna o par (prestador, sequencial) único sem inventar contador novo.
    sequencialTransacao: numeroLote.slice(0, 12),
  };
}

interface LinhaGuiaConsulta {
  registro_ans: string; numero_guia_prestador: string;
  numero_guia_operadora: string | null; numero_carteira: string;
  atendimento_rn: boolean; codigo_prestador_na_operadora: string | null;
  cpf_contratado: string | null; cnpj_contratado: string | null; cnes: string;
  conselho_profissional: string; numero_conselho: string; uf_conselho: string;
  cbos: string; indicacao_acidente: string; regime_atendimento: string;
  saude_ocupacional: string | null; cobertura_especial: string | null;
  data_atendimento: string | Date; tipo_consulta: string; codigo_tabela: string;
  codigo_procedimento: string; valor_procedimento: string;
  observacao: string | null;
}

function paraGuiaConsulta(l: LinhaGuiaConsulta): GuiaConsultaInput {
  return {
    registroANSOperadora: l.registro_ans,
    numeroGuiaPrestador: l.numero_guia_prestador,
    ...(l.numero_guia_operadora === null
      ? {} : { numeroGuiaOperadora: l.numero_guia_operadora }),
    numeroCarteira: l.numero_carteira,
    atendimentoRN: l.atendimento_rn,
    contratado: {
      ...(l.codigo_prestador_na_operadora === null
        ? {} : { codigoPrestadorNaOperadora: l.codigo_prestador_na_operadora }),
      ...(l.cpf_contratado === null ? {} : { cpfContratado: l.cpf_contratado }),
      ...(l.cnpj_contratado === null ? {} : { cnpjContratado: l.cnpj_contratado }),
      cnes: l.cnes,
    },
    profissionalExecutante: {
      conselhoProfissional: l.conselho_profissional,
      numeroConselho: l.numero_conselho,
      // O cadastro guarda a SIGLA ('SP'); `dm_UF` do XSD exige o código do
      // IBGE ('35'). Sem esta tradução a operadora recusa o lote inteiro.
      ufConselho: ufParaCodigoIbge(l.uf_conselho),
      cbos: l.cbos,
    },
    indicacaoAcidente: l.indicacao_acidente as GuiaConsultaInput['indicacaoAcidente'],
    regimeAtendimento: l.regime_atendimento,
    ...(l.saude_ocupacional === null ? {} : { saudeOcupacional: l.saude_ocupacional }),
    ...(l.cobertura_especial === null ? {} : { coberturaEspecial: l.cobertura_especial }),
    dataAtendimento: dataIso(l.data_atendimento),
    tipoConsulta: l.tipo_consulta as GuiaConsultaInput['tipoConsulta'],
    codigoTabela: l.codigo_tabela,
    codigoProcedimento: l.codigo_procedimento,
    valorProcedimentoCentavos: centavos(l.valor_procedimento),
    ...(l.observacao === null ? {} : { observacao: l.observacao }),
  };
}

interface LinhaGuiaSadt {
  id: string; registro_ans: string; numero_guia_prestador: string;
  numero_guia_operadora: string | null; guia_principal: string | null;
  numero_carteira: string; atendimento_rn: boolean;
  data_autorizacao: string | Date | null; senha_autorizacao: string | null;
  data_validade_senha: string | Date | null;
  sol_codigo_prestador: string | null; sol_cpf_contratado: string | null;
  sol_cnpj_contratado: string | null; sol_nome_contratado: string;
  sol_conselho_profissional: string; sol_numero_conselho: string;
  sol_uf_conselho: string; sol_cbos: string;
  data_solicitacao: string | Date | null; carater_atendimento: string;
  indicacao_clinica: string | null;
  exe_codigo_prestador: string | null; exe_cpf_contratado: string | null;
  exe_cnpj_contratado: string | null; exe_cnes: string;
  tipo_atendimento: string; indicacao_acidente: string;
  tipo_consulta: string | null; regime_atendimento: string;
  saude_ocupacional: string | null; observacao: string | null;
}

interface LinhaItemSadt {
  guia_id: string; sequencial_item: number; data_execucao: string | Date;
  hora_inicial: string | null; hora_final: string | null;
  codigo_tabela: string; codigo_procedimento: string;
  descricao_procedimento: string; quantidade_executada: number;
  via_acesso: string | null; tecnica_utilizada: string | null;
  reducao_acrescimo: string; valor_unitario: string;
}

function paraItemSadt(i: LinhaItemSadt): ProcedimentoSadtInput {
  return {
    sequencialItem: i.sequencial_item,
    dataExecucao: dataIso(i.data_execucao),
    ...(horaOuIndefinido(i.hora_inicial) === undefined
      ? {} : { horaInicial: horaOuIndefinido(i.hora_inicial)! }),
    ...(horaOuIndefinido(i.hora_final) === undefined
      ? {} : { horaFinal: horaOuIndefinido(i.hora_final)! }),
    codigoTabela: i.codigo_tabela,
    codigoProcedimento: i.codigo_procedimento,
    descricaoProcedimento: i.descricao_procedimento,
    quantidadeExecutada: i.quantidade_executada,
    reducaoAcrescimo: Number(i.reducao_acrescimo),
    valorUnitarioCentavos: centavos(i.valor_unitario),
    ...(i.via_acesso === null ? {} : { viaAcesso: i.via_acesso }),
    ...(i.tecnica_utilizada === null ? {} : { tecnicaUtilizada: i.tecnica_utilizada }),
  };
}

function paraGuiaSadt(
  l: LinhaGuiaSadt, itens: readonly LinhaItemSadt[],
): GuiaSadtInput {
  // Ligado a uma const antes do spread: com `exactOptionalPropertyTypes`, a
  // asserção dentro do ternário faz o campo virar `T | undefined`, que o tipo
  // com propriedade opcional (e não anulável) recusa.
  const tipoConsulta: GuiaSadtInput['tipoConsulta'] | undefined =
    l.tipo_consulta === null
      ? undefined
      : (l.tipo_consulta as NonNullable<GuiaSadtInput['tipoConsulta']>);

  return {
    registroANSOperadora: l.registro_ans,
    numeroGuiaPrestador: l.numero_guia_prestador,
    ...(l.guia_principal === null ? {} : { guiaPrincipal: l.guia_principal }),
    ...(l.data_autorizacao === null ? {} : {
      autorizacao: {
        ...(l.numero_guia_operadora === null
          ? {} : { numeroGuiaOperadora: l.numero_guia_operadora }),
        dataAutorizacao: dataIso(l.data_autorizacao),
        ...(l.senha_autorizacao === null ? {} : { senha: l.senha_autorizacao }),
        ...(l.data_validade_senha === null
          ? {} : { dataValidadeSenha: dataIso(l.data_validade_senha) }),
      },
    }),
    numeroCarteira: l.numero_carteira,
    atendimentoRN: l.atendimento_rn,
    contratadoSolicitante: {
      ...(l.sol_codigo_prestador === null
        ? {} : { codigoPrestadorNaOperadora: l.sol_codigo_prestador }),
      ...(l.sol_cpf_contratado === null ? {} : { cpfContratado: l.sol_cpf_contratado }),
      ...(l.sol_cnpj_contratado === null ? {} : { cnpjContratado: l.sol_cnpj_contratado }),
      // O solicitante não tem CNES próprio na guia — o CNES que a norma pede é
      // o do executante, que é quem realiza. Repetimos para satisfazer o tipo.
      cnes: l.exe_cnes,
    },
    nomeContratadoSolicitante: l.sol_nome_contratado,
    profissionalSolicitante: {
      conselhoProfissional: l.sol_conselho_profissional,
      numeroConselho: l.sol_numero_conselho,
      ufConselho: ufParaCodigoIbge(l.sol_uf_conselho),
      cbos: l.sol_cbos,
    },
    ...(l.data_solicitacao === null
      ? {} : { dataSolicitacao: dataIso(l.data_solicitacao) }),
    caraterAtendimento: l.carater_atendimento as GuiaSadtInput['caraterAtendimento'],
    ...(textoOuIndefinido(l.indicacao_clinica) === undefined
      ? {} : { indicacaoClinica: l.indicacao_clinica! }),
    contratadoExecutante: {
      ...(l.exe_codigo_prestador === null
        ? {} : { codigoPrestadorNaOperadora: l.exe_codigo_prestador }),
      ...(l.exe_cpf_contratado === null ? {} : { cpfContratado: l.exe_cpf_contratado }),
      ...(l.exe_cnpj_contratado === null ? {} : { cnpjContratado: l.exe_cnpj_contratado }),
      cnes: l.exe_cnes,
    },
    tipoAtendimento: l.tipo_atendimento,
    indicacaoAcidente: l.indicacao_acidente as GuiaSadtInput['indicacaoAcidente'],
    ...(tipoConsulta === undefined ? {} : { tipoConsulta }),
    regimeAtendimento: l.regime_atendimento,
    ...(l.saude_ocupacional === null ? {} : { saudeOcupacional: l.saude_ocupacional }),
    procedimentos: itens.filter((i) => i.guia_id === l.id).map(paraItemSadt),
    ...(l.observacao === null ? {} : { observacao: l.observacao }),
  };
}

/**
 * Lê o lote e devolve o XML TISS pronto para envio.
 *
 * Lança `lote_sem_guias` em vez de emitir envelope vazio: um lote sem guia é
 * aceito pela operadora e não paga nada, o que parece sucesso até o
 * demonstrativo chegar zerado semanas depois.
 */
export async function gerarXmlDoLote(
  tx: TxClient, loteId: string,
): Promise<XmlDoLote> {
  const { rows: lotes } = await tx.query<{
    numero_lote: string; tiss_version: string; registro_ans: string;
  }>(
    `SELECT l.numero_lote, l.tiss_version, o.registro_ans
       FROM tiss.lote l
       JOIN tiss.operadora o ON (o.tenant_id, o.id) = (l.tenant_id, l.operadora_id)
      WHERE l.id = $1`, [loteId]);
  const lote = lotes[0];
  if (lote === undefined) throw Object.assign(new Error('lote_nao_encontrado'), {
    dominio: 'lote_nao_encontrado' });

  const cabecalhoBase = await cabecalhoDoBanco(tx, loteId, lote.numero_lote);
  const cabecalho = { ...cabecalhoBase, versaoPadrao: lote.tiss_version,
                      registroANS: lote.registro_ans };

  const { rows: consultas } = await tx.query<LinhaGuiaConsulta>(
    `SELECT g.*
       FROM tiss.lote_guia lg
       JOIN tiss.encounter_guia_consulta g
            ON (g.tenant_id, g.id) = (lg.tenant_id, lg.guia_id)
      WHERE lg.lote_id = $1
      ORDER BY lg.sequencial_item`, [loteId]);

  if (consultas.length > 0) {
    const { xml, warnings } = serializeLoteConsulta({
      cabecalho,
      registroANS: lote.registro_ans,
      numeroLote: lote.numero_lote,
      guias: consultas.map(paraGuiaConsulta),
    });
    return { xml, warnings, tipo: 'consulta', quantidadeDeGuias: consultas.length };
  }

  // Vínculo próprio: `tiss.lote_guia` tem FK para a guia de CONSULTA. Duas
  // tabelas de vínculo tornam o lote misto impossível de montar — que é o que a
  // norma exige, já que `guiasTISS` é um `choice`.
  const { rows: sadts } = await tx.query<LinhaGuiaSadt>(
    `SELECT g.*
       FROM tiss.lote_guia_sadt lg
       JOIN tiss.encounter_guia_sadt g
            ON (g.tenant_id, g.id) = (lg.tenant_id, lg.guia_id)
      WHERE lg.lote_id = $1
      ORDER BY lg.sequencial_item`, [loteId]);

  if (sadts.length === 0) {
    throw Object.assign(new Error('lote_sem_guias'), { dominio: 'lote_sem_guias' });
  }

  const { rows: itens } = await tx.query<LinhaItemSadt>(
    `SELECT i.*
       FROM tiss.encounter_guia_sadt_item i
      WHERE i.guia_id = ANY($1::uuid[])
      ORDER BY i.guia_id, i.sequencial_item`, [sadts.map((g) => g.id)]);

  const { xml, warnings } = serializeLoteSadt({
    cabecalho,
    registroANS: lote.registro_ans,
    numeroLote: lote.numero_lote,
    guias: sadts.map((g) => paraGuiaSadt(g, itens)),
  });
  return { xml, warnings, tipo: 'sadt', quantidadeDeGuias: sadts.length };
}
