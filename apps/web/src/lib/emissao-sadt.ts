// apps/web/src/lib/emissao-sadt.ts
import type { NovaGuiaSadt } from './sadt-tipos';

/**
 * Quando a guia SP/SADT é emitida — e por que não é no clique.
 *
 * A guia documenta o que foi EXECUTADO, e o que foi executado só está fechado
 * quando o atendimento fecha. Além disso ela precisa apontar para uma versão
 * SELADA do registro clínico: sem isso seria cobrança justificada por um texto
 * que ainda pode mudar. Então o painel COMPÕE durante a consulta e quem emite é
 * o finalizar — mesmo instante em que a guia de consulta é projetada.
 *
 * Este módulo existe SEPARADO da página porque a regra acima é a parte que mais
 * erra e a que menos aparece: enquanto morava dentro de
 * `app/atendimento/[id]/page.tsx`, só o typecheck a cobria. Aqui ela é pura —
 * sem React, sem fetch — e cada caso vira um teste.
 */

export interface ResultadoDaSelagem {
  readonly emitida: boolean;
  /** `true` quando o envio falhou. O selar continua válido mesmo assim. */
  readonly erro?: boolean;
}

export interface EmissorDeSadt {
  /**
   * Recebe a guia montada no painel.
   *
   * Em rascunho, guarda. Finalizado, envia na hora — o caso de quem emite uma
   * segunda guia para um atendimento já fechado.
   */
  compor(guia: NovaGuiaSadt, status: 'rascunho' | 'finalizado' | 'anulado'): Promise<void>;
  /** Chamado DEPOIS de o registro ser selado, quando a versão já existe. */
  aoSelar(): Promise<ResultadoDaSelagem>;
  temPendente(): boolean;
}

export interface OpcoesDoEmissor {
  readonly enviar: (guia: NovaGuiaSadt) => Promise<void>;
  /** Chamado quando o envio falha depois de o registro já estar selado. */
  readonly aoFalhar?: (e: unknown) => void;
}

export function criarEmissorDeSadt(o: OpcoesDoEmissor): EmissorDeSadt {
  let pendente: NovaGuiaSadt | null = null;

  return {
    async compor(guia, status) {
      if (status === 'rascunho') {
        // Sobrescreve em vez de acumular: o médico ajustou a guia antes de
        // finalizar, e emitir as duas geraria cobrança dobrada do mesmo exame.
        pendente = guia;
        return;
      }
      await o.enviar(guia);
    },

    async aoSelar() {
      const guia = pendente;
      if (guia === null) return { emitida: false };
      // Limpa ANTES de enviar: se o selar for chamado duas vezes por um clique
      // duplo, a segunda não reenvia a mesma guia.
      pendente = null;
      try {
        await o.enviar(guia);
        return { emitida: true };
      } catch (e) {
        // O registro clínico JÁ foi selado neste ponto, e isso não se desfaz.
        // Propagar faria uma falha de FATURAMENTO parecer falha de prontuário,
        // e o médico tentaria finalizar de novo algo já finalizado.
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
