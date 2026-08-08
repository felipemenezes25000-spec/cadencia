// packages/tiss/src/recurso-glosa/recurso-lifecycle.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  MarkReadyFailure,
  RecursoReadyResult,
} from './types';

/**
 * Marca o recurso de glosa como pronto para envio. Validacoes:
 * - Recurso existe
 * - Status atual e 'rascunho' (transicao permitida: rascunho -> pronto)
 * - Tem pelo menos 1 item
 * - justificativa_geral esta preenchida
 */
export async function markRecursoReady(
  tx: TxClient,
  recursoId: string,
): Promise<Result<RecursoReadyResult, MarkReadyFailure>> {
  const { rows } = await tx.query<{
    id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
    justificativa_geral: string | null;
  }>(
    `SELECT id, status, item_count, total_recursado_cents, justificativa_geral
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (rows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = rows[0]!;

  if (recurso.status !== 'rascunho') {
    return err({ kind: 'transicao_invalida', de: recurso.status, para: 'pronto' });
  }
  if (recurso.item_count === 0) {
    return err({ kind: 'sem_itens' });
  }
  if (!recurso.justificativa_geral || recurso.justificativa_geral.trim() === '') {
    return err({ kind: 'justificativa_geral_ausente' });
  }

  await tx.query(
    `UPDATE tiss.recurso_glosa SET status = 'pronto'::tiss.recurso_glosa_status WHERE id = $1`,
    [recursoId],
  );

  return ok({
    recursoId: recurso.id,
    itemCount: recurso.item_count,
    totalRecursadoCents: Number(recurso.total_recursado_cents),
  });
}
