// packages/tiss/src/resolve-recurso.ts
import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ResolveResult =
  | { resultado: 'deferido' }
  | { resultado: 'indeferido' }
  | { resultado: 'parcial'; itens: Array<{ recursoItemId: string; deferido: boolean }> };

export type ResolveRecursoFailure =
  | { kind: 'recurso_nao_encontrado' }
  | { kind: 'transicao_invalida'; statusAtual: string }
  | { kind: 'itens_obrigatorios_para_parcial' };

export interface ResolveRecursoResult {
  readonly recursoId: string;
}

// ---------------------------------------------------------------------------
// Funcao principal
// ---------------------------------------------------------------------------

/**
 * Resolve um recurso de glosa com o resultado da operadora.
 *
 * - deferido:   todas as glosas vinculadas transitam para `revertida`
 * - indeferido: todas as glosas vinculadas transitam para `aceita`
 * - parcial:    cada item e marcado individualmente (deferido -> revertida, nao -> aceita)
 *
 * Design §3.9 — recurso de glosa sempre cita a versao usada.
 * O recurso precisa estar em status `enviado` para ser resolvido.
 */
export async function resolveRecurso(
  tx: TxClient,
  recursoId: string,
  resultado: ResolveResult,
  resolvedBy: string,
): Promise<Result<ResolveRecursoResult, ResolveRecursoFailure>> {
  // 1. Busca o recurso e valida que esta em status enviado
  const { rows: recursoRows } = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );

  if (recursoRows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }

  const recurso = recursoRows[0]!;
  if (recurso.status !== 'enviado') {
    return err({ kind: 'transicao_invalida', statusAtual: recurso.status });
  }

  // 2. Atualiza o status do recurso (resolved_at obrigatorio por ck_recurso_glosa_resolved_at)
  await tx.query(
    `UPDATE tiss.recurso_glosa
        SET status = $2::tiss.recurso_glosa_status,
            resolved_at = clock_timestamp()
      WHERE id = $1`,
    [recursoId, resultado.resultado],
  );

  // 3. Atualiza as glosas conforme o resultado
  if (resultado.resultado === 'deferido') {
    // Todas as glosas vinculadas transitam para revertida
    await tx.query(
      `UPDATE tiss.glosa g
          SET status = 'revertida',
              resolved_at = clock_timestamp(),
              resolved_by = $2
        WHERE g.id IN (
          SELECT ri.glosa_id FROM tiss.recurso_glosa_item ri
           WHERE ri.recurso_id = $1
        )`,
      [recursoId, resolvedBy],
    );
  } else if (resultado.resultado === 'indeferido') {
    // Todas as glosas vinculadas transitam para aceita
    await tx.query(
      `UPDATE tiss.glosa g
          SET status = 'aceita',
              resolved_at = clock_timestamp(),
              resolved_by = $2
        WHERE g.id IN (
          SELECT ri.glosa_id FROM tiss.recurso_glosa_item ri
           WHERE ri.recurso_id = $1
        )`,
      [recursoId, resolvedBy],
    );
  } else {
    // parcial: cada item e marcado individualmente
    if (!resultado.itens || resultado.itens.length === 0) {
      return err({ kind: 'itens_obrigatorios_para_parcial' });
    }

    for (const item of resultado.itens) {
      // Busca o glosa_id a partir do recurso_item_id
      const { rows: itemRows } = await tx.query<{ glosa_id: string }>(
        `SELECT glosa_id FROM tiss.recurso_glosa_item
          WHERE id = $1 AND recurso_id = $2`,
        [item.recursoItemId, recursoId],
      );

      if (itemRows.length > 0) {
        const newStatus = item.deferido ? 'revertida' : 'aceita';
        await tx.query(
          `UPDATE tiss.glosa
              SET status = $2::tiss.glosa_status,
                  resolved_at = clock_timestamp(),
                  resolved_by = $3
            WHERE id = $1`,
          [itemRows[0]!.glosa_id, newStatus, resolvedBy],
        );
      }
    }
  }

  return ok({ recursoId });
}
