/**
 * Tipos de entrada do serializador XML TISS.
 *
 * Estes tipos sao PUROS — sem dependencia de banco, sem I/O. Representam
 * exatamente os dados necessarios para gerar o XML de um lote de guias de
 * consulta conforme padrao TISS 4.01.00 (Componente Organizacional).
 *
 * Os campos espelham a tabela tiss.encounter_guia_consulta (design §3.9)
 * e o XSD ans:mensagemTISS > prestadorParaOperadora > loteGuias >
 * guiaConsulta.
 */

/** Cabecalho do lote TISS — tag <ans:cabecalho>. */
export interface CabecalhoInput {
  /** Versao do padrao, ex: '4.01.00'. */
  readonly versaoPadrao: string;
  /** Registro ANS da operadora destino, 6 digitos. */
  readonly registroANS: string;
  /** Data de geracao do lote, formato 'YYYY-MM-DD'. */
  readonly dataGeracao: string;
  /** Hora de geracao do lote, formato 'HH:MM:SS'. */
  readonly horaGeracao: string;
  /** Numero sequencial da transacao, unico por prestador. */
  readonly sequencialTransacao: string;
}

/** Dados do contratado executante — tag <ans:dadosContratado>. */
export interface ContratadoInput {
  /** Codigo do prestador na operadora. Exatamente um dos tres identificadores. */
  readonly codigoPrestadorNaOperadora?: string;
  readonly cpfContratado?: string;
  readonly cnpjContratado?: string;
  /** CNES do estabelecimento, 7 digitos. */
  readonly cnes: string;
}

/** Dados do profissional executante — tag <ans:profissionalExecutante>. */
export interface ProfissionalExecutanteInput {
  /** Conselho profissional do executante, 2 digitos (ex: '06' = CRM). */
  readonly conselhoProfissional: string;
  /** Numero do registro no conselho. */
  readonly numeroConselho: string;
  /** UF do conselho, 2 letras. */
  readonly ufConselho: string;
  /** CBOS do profissional. */
  readonly cbos: string;
}

/** Uma guia de consulta individual — tag <ans:guiaConsulta>. */
export interface GuiaConsultaInput {
  /** Numero da guia atribuido pelo prestador, unico por operadora. */
  readonly numeroGuiaPrestador: string;
  /** Numero da guia atribuido pela operadora (autorizacao), opcional. */
  readonly numeroGuiaOperadora?: string;
  /** Numero da carteira do beneficiario na operadora. */
  readonly numeroCarteira: string;
  /** Indica se e atendimento a recem-nascido. */
  readonly atendimentoRN: boolean;
  /** Dados do contratado (prestador). */
  readonly contratado: ContratadoInput;
  /** Profissional que executou o procedimento. */
  readonly profissionalExecutante: ProfissionalExecutanteInput;
  /** Indicacao de acidente: '0' nao, '1' trabalho, '2' transito, '9' outros. */
  readonly indicacaoAcidente: '0' | '1' | '2' | '9';
  /** Regime de atendimento: '01' ambulatorial, etc. */
  readonly regimeAtendimento: string;
  /** Saude ocupacional, opcional. */
  readonly saudeOcupacional?: string;
  /** Cobertura especial, opcional. */
  readonly coberturaEspecial?: string;
  /** Data do atendimento, formato 'YYYY-MM-DD'. Nunca derivada de timestamp. */
  readonly dataAtendimento: string;
  /** Tipo de consulta: '1' primeira, '2' retorno, '3' pre-natal, '4' por encaminhamento. */
  readonly tipoConsulta: '1' | '2' | '3' | '4';
  /** Tabela de procedimento (ex: '22' TUSS). CHECK <> '18' (particular). */
  readonly codigoTabela: string;
  /** Codigo do procedimento na tabela. */
  readonly codigoProcedimento: string;
  /** Valor do procedimento em centavos inteiros (Money.cents). */
  readonly valorProcedimentoCentavos: number;
  /** Observacao opcional, ate 500 caracteres. */
  readonly observacao?: string;
}

/** Entrada completa para serializar um lote de guias de consulta. */
export interface LoteConsultaInput {
  /** Cabecalho do lote. */
  readonly cabecalho: CabecalhoInput;
  /** Registro ANS da operadora destino, 6 digitos. */
  readonly registroANS: string;
  /** Numero do lote, unico por prestador+operadora. */
  readonly numeroLote: string;
  /** Guias do lote. Minimo 1, maximo 100. */
  readonly guias: readonly GuiaConsultaInput[];
}
