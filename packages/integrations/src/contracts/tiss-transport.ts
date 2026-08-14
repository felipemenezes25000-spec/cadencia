import type { Provider, ProviderCtx, ProviderResult, Rfc3339 } from './common';

export interface TissGuiaConsulta {
  readonly registroAns: string;
  readonly numeroGuia: string;
  readonly dataAtendimento: string;
  readonly tipoConsulta: '1' | '2' | '3' | '4';
  readonly indicacaoAcidente: '0' | '1' | '2' | '9';
  readonly beneficiario: {
    readonly numeroCarteira: string;
    readonly nomeBeneficiario: string;
    readonly cns?: string;
  };
  readonly profissional: {
    readonly nomeProfissional: string;
    readonly conselhoProfissional: string;
    readonly numeroConselho: string;
    readonly uf: string;
    readonly cbos: string;
  };
  readonly procedimento: {
    readonly codigoTabela: string;
    readonly codigoProcedimento: string;
    readonly quantidadeExecutada: number;
    readonly valorUnitario: number;
  };
}

export interface TissGuiaSadt {
  readonly registroAns: string;
  readonly numeroGuia: string;
  readonly dataAtendimento: string;
  readonly tipoAtendimento: string;
  readonly indicacaoClinica: string;
  readonly beneficiario: TissGuiaConsulta['beneficiario'];
  readonly profissionalSolicitante: TissGuiaConsulta['profissional'];
  readonly profissionalExecutante?: TissGuiaConsulta['profissional'];
  readonly procedimentos: Array<{
    readonly codigoTabela: string;
    readonly codigoProcedimento: string;
    readonly descricaoProcedimento: string;
    readonly quantidadeSolicitada: number;
    readonly quantidadeExecutada: number;
    readonly valorUnitario: number;
  }>;
}

export interface TissLote {
  readonly registroAns: string;
  readonly numeroLote: string;
  readonly guiasConsulta?: readonly TissGuiaConsulta[];
  readonly guiasSadt?: readonly TissGuiaSadt[];
}

export interface TissSubmissaoResult {
  readonly protocolo: string;
  readonly dataRecebimento: Rfc3339;
  readonly hashLote: string;
}

export interface TissTransportProvider extends Provider {
  enviarLote(
    ctx: ProviderCtx,
    i: { lote: TissLote; endpointUrl: string },
  ): Promise<ProviderResult<TissSubmissaoResult>>;

  consultarProtocolo(
    ctx: ProviderCtx,
    i: { protocolo: string; registroAns: string; endpointUrl: string },
  ): Promise<ProviderResult<{
    status: 'processando' | 'aceito' | 'rejeitado' | 'parcial';
    guiasAceitas: number;
    guiasRejeitadas: number;
    erros: Array<{ guia: string; codigo: string; mensagem: string }>;
  }>>;
}
