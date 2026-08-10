// apps/worker/src/jobs/gerar-link-de-pagamento.ts
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createPaymentLink } from '@cadencia/payments';
import type { PaymentProvider } from '@cadencia/integrations';

/**
 * Consome `create_payment_link` do outbox e cria o link no provedor.
 *
 * A rota `POST /v1/payment-links` grava o lancamento pendente e ENFILEIRA — nao
 * chama o provedor. O motivo e bom: uma chamada HTTP a terceiro dentro da
 * transacao segura a conexao do banco pelo tempo do parceiro, e um parceiro
 * lento vira fila de conexoes esgotada no banco inteiro.
 *
 * O que faltava era este consumidor. Sem ele o evento ficava na tabela para
 * sempre, o lancamento nascia pendente e nenhum link existia — o botao de
 * cobranca da tela de atendimento nao devolvia nada e ninguem via erro.
 */

export interface GerarLinkInput {
  readonly tenantId: string;
  readonly entryId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly expiresInMinutes?: number;
  /** Quem clicou em "gerar link". Vem no evento porque aqui o ator e a fila. */
  readonly solicitadoPor: string;
}

export type GerarLinkResult =
  | { readonly status: 'criado'; readonly paymentLinkId: string; readonly url: string }
  | { readonly status: 'lancamento_nao_encontrado' }
  | { readonly status: 'provedor_indisponivel'; readonly detalhe: string };

export async function gerarLinkDePagamento(
  input: GerarLinkInput,
  provider: PaymentProvider,
): Promise<GerarLinkResult> {
  const actor: Actor = {
    kind: 'system',
    tenantId: input.tenantId,
    reason: 'gerar-link-de-pagamento',
    requestId: uuidv7(),
  };

  return withTenantTx(actor, async (tx) => {
    const resultado = await createPaymentLink(
      tx, provider,
      {
        tenantId: input.tenantId,
        // Sem usuario: quem executa e a fila, nao uma pessoa. Forjar um userId
        // aqui poluiria a trilha de auditoria com uma acao que ninguem tomou.
        actorUserId: null,
        requestId: actor.requestId,
        // Estavel POR LANCAMENTO, e nao por execucao: e o que faz a reentrega do
        // outbox chegar ao provedor como a mesma intencao, e nao como uma
        // segunda cobranca.
        idempotencyKey: `payment-link:${input.entryId}`,
        deadlineMs: 15_000,
      },
      {
        entryId: input.entryId,
        amountCents: input.amountCents,
        description: input.description,
        ...(input.expiresInMinutes === undefined
          ? {} : { expiresInMinutes: input.expiresInMinutes }),
        providerId: provider.id,
        createdBy: input.solicitadoPor,
      });

    if (!resultado.ok) {
      // Lancamento inexistente e falha TERMINAL: nunca vai passar a existir, e
      // relancar excecao faria o pg-boss tentar de novo indefinidamente.
      // Provedor fora do ar e falha TRANSITORIA — essa sim merece nova tentativa,
      // e por isso sai como status distinto para quem chama decidir.
      if (resultado.error.code === 'payment_link.entry_nao_encontrado') {
        return { status: 'lancamento_nao_encontrado' as const };
      }
      return { status: 'provedor_indisponivel' as const,
               detalhe: resultado.error.message };
    }

    return {
      status: 'criado' as const,
      paymentLinkId: resultado.value.paymentLinkId,
      url: resultado.value.url,
    };
  });
}
