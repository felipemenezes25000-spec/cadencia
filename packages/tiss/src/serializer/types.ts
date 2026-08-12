/**
 * Tipos de entrada do serializador XML TISS.
 *
 * Estes tipos são PUROS — sem dependência de banco, sem I/O. Representam
 * exatamente os dados necessários para gerar o XML de um lote de guias de
 * consulta conforme padrão TISS 4.01.00 (Componente Organizacional).
 *
 * Os campos espelham a tabela tiss.encounter_guia_consulta (design §3.9)
 * e o XSD ans:mensagemTISS > prestadorParaOperadora > loteGuias >
 * guiaConsulta.
 */

/** Cabeçalho do lote TISS — tag <ans:cabecalho>. */
export interface CabecalhoInput {
  /** Versão do padrão, ex: '4.01.00'. */
  readonly versaoPadrao: string;
  /** Registro ANS da operadora destino, 6 dígitos. */
  readonly registroANS: string;
  /** Data de geração do lote, formato 'YYYY-MM-DD'. */
  readonly dataGeracao: string;
  /** Hora de geração do lote, formato 'HH:MM:SS'. */
  readonly horaGeracao: string;
  /** Número sequencial da transação, único por prestador. */
  readonly sequencialTransacao: string;
}

/** Dados do contratado executante — tag <ans:dadosContratado>. */
export interface ContratadoInput {
  /** Código do prestador na operadora. Exatamente um dos três identificadores. */
  readonly codigoPrestadorNaOperadora?: string;
  readonly cpfContratado?: string;
  readonly cnpjContratado?: string;
  /** CNES do estabelecimento, 7 dígitos. */
  readonly cnes: string;
}

/** Dados do profissional executante — tag <ans:profissionalExecutante>. */
export interface ProfissionalExecutanteInput {
  /** Nome, opcional na norma (`nomeProfissional`, minOccurs=0). */
  readonly nome?: string;
  /** Conselho profissional do executante, 2 dígitos (ex: '06' = CRM). */
  readonly conselhoProfissional: string;
  /** Número do registro no conselho. */
  readonly numeroConselho: string;
  /** UF do conselho, 2 letras. */
  readonly ufConselho: string;
  /** CBOS do profissional. */
  readonly cbos: string;
}

/** Uma guia de consulta individual — tag <ans:guiaConsulta>. */
export interface GuiaConsultaInput {
  /**
   * Registro ANS da operadora, repetido no `cabecalhoConsulta` de CADA guia.
   *
   * Parece redundante com o `destino` do envelope e não é: a operadora
   * desmembra o lote e cada guia segue sozinha pelo processamento dela.
   */
  readonly registroANSOperadora: string;
  /** Número da guia atribuído pelo prestador, único por operadora. */
  readonly numeroGuiaPrestador: string;
  /** Número da guia atribuído pela operadora (autorização), opcional. */
  readonly numeroGuiaOperadora?: string;
  /** Número da carteira do beneficiário na operadora. */
  readonly numeroCarteira: string;
  /** Indica se é atendimento a recém-nascido. */
  readonly atendimentoRN: boolean;
  /** Dados do contratado (prestador). */
  readonly contratado: ContratadoInput;
  /** Profissional que executou o procedimento. */
  readonly profissionalExecutante: ProfissionalExecutanteInput;
  /** Indicação de acidente: '0' não, '1' trabalho, '2' trânsito, '9' outros. */
  readonly indicacaoAcidente: '0' | '1' | '2' | '9';
  /** Regime de atendimento: '01' ambulatorial, etc. */
  readonly regimeAtendimento: string;
  /** Saúde ocupacional, opcional. */
  readonly saudeOcupacional?: string;
  /** Cobertura especial, opcional. */
  readonly coberturaEspecial?: string;
  /** Data do atendimento, formato 'YYYY-MM-DD'. Nunca derivada de timestamp. */
  readonly dataAtendimento: string;
  /** Tipo de consulta: '1' primeira, '2' retorno, '3' pré-natal, '4' por encaminhamento. */
  readonly tipoConsulta: '1' | '2' | '3' | '4';
  /** Tabela de procedimento (ex: '22' TUSS). CHECK <> '18' (particular). */
  readonly codigoTabela: string;
  /** Código do procedimento na tabela. */
  readonly codigoProcedimento: string;
  /** Valor do procedimento em centavos inteiros (Money.cents). */
  readonly valorProcedimentoCentavos: number;
  /** Observação opcional, até 500 caracteres. */
  readonly observacao?: string;
}

/** Entrada completa para serializar um lote de guias de consulta. */
export interface LoteConsultaInput {
  /** Cabeçalho do lote. */
  readonly cabecalho: CabecalhoInput;
  /** Registro ANS da operadora destino, 6 dígitos. */
  readonly registroANS: string;
  /** Número do lote, único por prestador+operadora. */
  readonly numeroLote: string;
  /** Guias do lote. Mínimo 1, máximo 100. */
  readonly guias: readonly GuiaConsultaInput[];
}

/* ── SP/SADT ───────────────────────────────────────────────────────────────
 *
 * Guia de Serviço Profissional / Serviço Auxiliar de Diagnóstico e Terapia: é
 * a guia de exame, procedimento e terapia — tudo que não é consulta simples nem
 * internação. Na prática é a guia que mais fatura numa clínica.
 */

/** Um procedimento executado — tipo `ct_procedimentoExecutadoSadt`. */
export interface ProcedimentoSadtInput {
  /** Ordem do item na guia, começando em 1. */
  readonly sequencialItem: number;
  /** Data de execução, 'YYYY-MM-DD'. Pode diferir da data da guia. */
  readonly dataExecucao: string;
  readonly horaInicial?: string;
  readonly horaFinal?: string;
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly descricaoProcedimento: string;
  readonly quantidadeExecutada: number;
  /**
   * Fator de redução ou acréscimo, ex.: 0.5 para segundo procedimento na mesma
   * via de acesso. Ausente vale 1.00 — que é o caso comum.
   */
  readonly reducaoAcrescimo?: number;
  /** Valor unitário em centavos. O total do item é derivado, nunca recebido. */
  readonly valorUnitarioCentavos: number;
  readonly viaAcesso?: string;
  readonly tecnicaUtilizada?: string;
}

/** Prestador solicitante ou executante da SP/SADT. */
export interface ContratadoSadtInput {
  readonly codigoPrestadorNaOperadora?: string;
  readonly cpfContratado?: string;
  readonly cnpjContratado?: string;
  readonly cnes: string;
}

/** Uma guia SP/SADT — tipo `ctm_sp-sadtGuia`. */
export interface GuiaSadtInput {
  readonly registroANSOperadora: string;
  readonly numeroGuiaPrestador: string;
  /** Guia principal a que esta se vincula, quando houver. */
  readonly guiaPrincipal?: string;
  /** Autorização prévia da operadora, quando o procedimento exigiu. */
  readonly autorizacao?: {
    readonly numeroGuiaOperadora?: string;
    readonly dataAutorizacao: string;
    readonly senha?: string;
    readonly dataValidadeSenha?: string;
  };
  readonly numeroCarteira: string;
  readonly atendimentoRN: boolean;
  readonly contratadoSolicitante: ContratadoSadtInput;
  readonly nomeContratadoSolicitante: string;
  readonly profissionalSolicitante: ProfissionalExecutanteInput;
  readonly dataSolicitacao?: string;
  /** Caráter: '1' eletivo, '2' urgência/emergência. */
  readonly caraterAtendimento: '1' | '2';
  readonly indicacaoClinica?: string;
  readonly contratadoExecutante: ContratadoSadtInput;
  /** Tipo de atendimento, domínio `dm_tipoAtendimento` (ex.: '05' exame). */
  readonly tipoAtendimento: string;
  readonly indicacaoAcidente: '0' | '1' | '2' | '9';
  readonly tipoConsulta?: '1' | '2' | '3' | '4';
  readonly regimeAtendimento: string;
  readonly saudeOcupacional?: string;
  readonly procedimentos: readonly ProcedimentoSadtInput[];
  readonly observacao?: string;
}

/** Entrada completa para serializar um lote de guias SP/SADT. */
export interface LoteSadtInput {
  readonly cabecalho: CabecalhoInput;
  readonly registroANS: string;
  readonly numeroLote: string;
  /** Mínimo 1, máximo 100 — `maxOccurs="100"` no XSD. */
  readonly guias: readonly GuiaSadtInput[];
}

/** Um item de recurso de glosa individual — tag <ans:itemRecursoGlosa>. */
export interface ItemRecursoGlosaInput {
  /** Número sequencial do item dentro do recurso. */
  readonly sequencialItem: string;
  /** Data do atendimento original, formato 'YYYY-MM-DD'. */
  readonly dataAtendimento: string;
  /** Número da guia referenciada pelo recurso (guia do prestador). */
  readonly numeroGuiaPrestador: string;
  /** Número da guia atribuído pela operadora, opcional. */
  readonly numeroGuiaOperadora?: string;
  /** Código do procedimento TUSS contestado. */
  readonly codigoProcedimento: string;
  /** Código da glosa atribuído pela operadora (tabela TUSS de motivo de glosa). */
  readonly codigoGlosa: string;
  /** Valor recursado em centavos inteiros (Money.cents). */
  readonly valorRecursadoCentavos: number;
  /** Justificativa textual do prestador para o recurso, até 500 caracteres. */
  readonly justificativa: string;
}

/** Dados do prestador contratado para o recurso — tag <ans:dadosContratado>. */
export interface ContratadoRecursoInput {
  /** Código do prestador na operadora. Exatamente um dos três identificadores. */
  readonly codigoPrestadorNaOperadora?: string;
  readonly cpfContratado?: string;
  readonly cnpjContratado?: string;
  /** CNES do estabelecimento, 7 dígitos. */
  readonly cnes: string;
}

/** Entrada completa para serializar um recurso de glosa TISS. */
export interface RecursoGlosaInput {
  /** Cabeçalho do XML TISS. Reutiliza o mesmo tipo do lote. */
  readonly cabecalho: CabecalhoInput;
  /** Registro ANS da operadora destino, 6 dígitos. */
  readonly registroANS: string;
  /** Número do lote original que sofreu a glosa. */
  readonly numeroLoteOriginal: string;
  /** Número do recurso de glosa, único por prestador. */
  readonly numeroRecursoGlosa: string;
  /** Dados do prestador contratado. */
  readonly contratado: ContratadoRecursoInput;
  /** Itens do recurso. Mínimo 1. */
  readonly itens: readonly ItemRecursoGlosaInput[];
  /** ID da versão do encounter usada para gerar o recurso (§3.9). Não vai no XML, mas é obrigatório no input. */
  readonly encounterVersionId: string;
}
