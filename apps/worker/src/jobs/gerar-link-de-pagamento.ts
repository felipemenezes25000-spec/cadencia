// apps/worker/src/jobs/gerar-link-de-pagamento.ts
import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createPaymentLink } from '@cadencia/payments';
import type { PaymentProvider } from '@cadencia/integrations';

/**
 * Consome `create_payment_link` do outbox e cria o link no provedor.
 *
 * A rota `POST /v1/payment-links` grava o lançamento pendente e ENFILEIRA — não
 * chama o provedor. O motivo é bom: uma chamada HTTP a terceiro dentro da
 * transação segura a conexão do banco pelo tempo do parceiro, e um parceiro
 * lento vira fila de conexões esgotada no banco inteiro.
 *
 * O que faltava era este consumidor. Sem ele o evento ficava na tabela para
 * sempre, o lançamento nascia pendente e nenhum link existia — o botão de
 * cobrança da tela de atendimento não devolvia nada e ninguém via erro.
 */

export interface GerarLinkInput {
  readonly tenantId: string;
  readonly entryId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly expiresInMinutes?: number;
  /** Quem clicou em "gerar link". Vem no evento porque aqui o ator é a fila. */
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
        // Sem usuário: quem executa é a fila, não uma pessoa. Forjar um userId
        // aqui poluiria a trilha de auditoria com uma ação que ninguém tomou.
        actorUserId: null,
        requestId: actor.requestId,
        // Estável POR LANÇAMENTO, e não por execução: é o que faz a reentrega do
        // outbox chegar ao provedor como a mesma intenção, e não como uma
        // segunda cobrança.
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
      // Lançamento inexistente é falha TERMINAL: nunca vai passar a existir, e
      // relançar exceção faria o pg-boss tentar de novo indefinidamente.
      // Provedor fora do ar é falha TRANSITÓRIA — essa sim merece nova tentativa,
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
