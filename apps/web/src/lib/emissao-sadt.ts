// apps/web/src/lib/emissao-sadt.ts
import type { NovaGuiaSadt } from './sadt-tipos';

/**
 * Quando a guia SP/SADT e emitida — e por que nao e no clique.
 *
 * A guia documenta o que foi EXECUTADO, e o que foi executado so esta fechado
 * quando o atendimento fecha. Alem disso ela precisa apontar para uma versao
 * SELADA do registro clinico: sem isso seria cobranca justificada por um texto
 * que ainda pode mudar. Entao o painel COMPOE durante a consulta e quem emite e
 * o finalizar — mesmo instante em que a guia de consulta e projetada.
 *
 * Este modulo existe SEPARADO da pagina porque a regra acima e a parte que mais
 * erra e a que menos aparece: enquanto morava dentro de
 * `app/atendimento/[id]/page.tsx`, so o typecheck a cobria. Aqui ela e pura —
 * sem React, sem fetch — e cada caso vira um teste.
 */

export interface ResultadoDaSelagem {
  readonly emitida: boolean;
  /** `true` quando o envio falhou. O selar continua valido mesmo assim. */
  readonly erro?: boolean;
}

export interface EmissorDeSadt {
  /**
   * Recebe a guia montada no painel.
   *
   * Em rascunho, guarda. Finalizado, envia na hora — o caso de quem emite uma
   * segunda guia para um atendimento ja fechado.
   */
  compor(guia: NovaGuiaSadt, status: 'rascunho' | 'finalizado' | 'anulado'): Promise<void>;
  /** Chamado DEPOIS de o registro ser selado, quando a versao ja existe. */
  aoSelar(): Promise<ResultadoDaSelagem>;
  temPendente(): boolean;
}

export interface OpcoesDoEmissor {
  readonly enviar: (guia: NovaGuiaSadt) => Promise<void>;
  /** Chamado quando o envio falha depois de o registro ja estar selado. */
  readonly aoFalhar?: (e: unknown) => void;
}

export function criarEmissorDeSadt(o: OpcoesDoEmissor): EmissorDeSadt {
  let pendente: NovaGuiaSadt | null = null;

  return {
    async compor(guia, status) {
      if (status === 'rascunho') {
        // Sobrescreve em vez de acumular: o medico ajustou a guia antes de
        // finalizar, e emitir as duas geraria cobranca dobrada do mesmo exame.
        pendente = guia;
        return;
      }
      await o.enviar(guia);
    },

    async aoSelar() {
      const guia = pendente;
      if (guia === null) return { emitida: false };
      // Limpa ANTES de enviar: se o selar for chamado duas vezes por um clique
      // duplo, a segunda nao reenvia a mesma guia.
      pendente = null;
      try {
        await o.enviar(guia);
        return { emitida: true };
      } catch (e) {
        // O registro clinico JA foi selado neste ponto, e isso nao se desfaz.
        // Propagar faria uma falha de FATURAMENTO parecer falha de prontuario,
        // e o medico tentaria finalizar de novo algo ja finalizado.
        pendente = guia;
        o.aoFalhar?.(e);
        return { emitida: false, erro: true };
      }
    },

    temPendente() {
      return pendente !== null;
    },
  };
}
