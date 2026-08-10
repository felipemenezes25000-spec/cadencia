import type { Provider, ProviderCtx, ProviderResult } from './common';

/**
 * §6 — ASSISTENCIA POR IA na consulta.
 *
 * O contrato devolve SUGESTAO, nunca registro. Quem escreve no prontuario e o
 * medico: `clin.ai_assistance.clinician_decision` nasce `nao_avaliado` e so sai
 * disso por ato humano. Um modelo que preenchesse a evolucao sozinho colocaria
 * no acervo clinico texto que ninguem leu — e o acervo e assinado pelo medico.
 *
 * `residency` nao e metadado decorativo: dado de saude enviado a um provedor
 * fora do Brasil e transferencia internacional sob a LGPD, e a clinica precisa
 * conseguir responder para onde o audio da consulta foi. Por isso o provedor e
 * obrigado a declarar, e a declaracao vai para a linha de auditoria.
 */

export interface FalaTranscrita {
  /** Quem falou, como o diarizador separou. */
  readonly locutor: string;
  readonly texto: string;
  readonly inicioMs: number;
}

export interface TranscricaoBruta {
  readonly texto: string;
  readonly falas: readonly FalaTranscrita[];
  readonly idioma: string;
  readonly duracaoMs: number;
}

/** O que a IA SUGERE. Cada campo pode ser recusado individualmente. */
export interface SugestaoClinica {
  readonly evolucao: string;
  readonly alergias: string | null;
  readonly pesoKg: string | null;
  readonly alturaCm: string | null;
  readonly paSistolica: string | null;
  readonly paDiastolica: string | null;
  readonly cid: { readonly codigo: string; readonly descricao: string } | null;
  readonly medicamentosEmUso: readonly string[];
  /**
   * De 0 a 1, declarada pelo modelo. Serve para ORDENAR revisao, nunca para
   * decidir sozinho: confianca alta em invencao continua sendo invencao.
   */
  readonly confianca: number;
}

export interface TranscriptionProvider extends Provider {
  /** Pais/regiao onde o audio e processado. Ex.: 'us', 'br', 'eu'. */
  readonly residency: string;
  readonly modelId: string;
  readonly modelVersion: string;

  transcrever(ctx: ProviderCtx, i: {
    readonly audio: Uint8Array;
    readonly contentType: string;
    readonly idioma?: string;
  }): Promise<ProviderResult<TranscricaoBruta>>;

  estruturar(ctx: ProviderCtx, i: {
    readonly transcricao: string;
  }): Promise<ProviderResult<SugestaoClinica>>;
}
