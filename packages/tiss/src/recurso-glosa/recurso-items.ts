// packages/tiss/src/recurso-glosa/recurso-items.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  AddGlosaFailure,
  AddedGlosaItem,
  RemoveGlosaFailure,
  RemovedGlosaItem,
} from './types';

/**
 * Adiciona uma glosa a um recurso em rascunho. Validacoes:
 * - Recurso existe e esta em rascunho
 * - Glosa existe em tiss.glosa e esta com status pendente
 * - Glosa pertence a mesma operadora do recurso (via guia)
 * - Glosa nao esta ja vinculada a este recurso
 */
export async function addGlosaToRecurso(
  tx: TxClient,
  recursoId: string,
  glosaId: string,
  justificativa: string,
  valorRecursadoCents: number,
): Promise<Result<AddedGlosaItem, AddGlosaFailure>> {
  // 1. Busca o recurso e valida status
  const { rows: recursoRows } = await tx.query<{
    id: string;
    operadora_id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
  }>(
    `SELECT id, operadora_id, status, item_count, total_recursado_cents
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (recursoRows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = recursoRows[0]!;
  if (recurso.status !== 'rascunho') {
    return err({ kind: 'recurso_nao_rascunho', status: recurso.status });
  }

  // 2. Busca a glosa e valida status e operadora
  const { rows: glosaRows } = await tx.query<{
    id: string;
    status: string;
    guia_id: string;
  }>(
    `SELECT id, status, guia_id
       FROM tiss.glosa WHERE id = $1`,
    [glosaId],
  );
  if (glosaRows.length === 0) {
    return err({ kind: 'glosa_nao_encontrada' });
  }
  const glosa = glosaRows[0]!;
  if (glosa.status !== 'pendente') {
    return err({ kind: 'glosa_nao_pendente', status: glosa.status });
  }

  // 3. Valida operadora via guia
  const { rows: guiaRows } = await tx.query<{ operadora_id: string }>(
    `SELECT operadora_id FROM tiss.encounter_guia_consulta WHERE id = $1`,
    [glosa.guia_id],
  );
  if (guiaRows.length === 0 || guiaRows[0]!.operadora_id !== recurso.operadora_id) {
    return err({ kind: 'glosa_operadora_divergente' });
  }

  // 4. Verifica duplicata dentro do mesmo recurso
  const { rows: existeRows } = await tx.query<{ recurso_id: string }>(
    `SELECT recurso_id FROM tiss.recurso_glosa_item
      WHERE recurso_id = $1 AND glosa_id = $2`,
    [recursoId, glosaId],
  );
  if (existeRows.length > 0) {
    return err({ kind: 'glosa_ja_no_recurso' });
  }

  // 5. Insere o item
  await tx.query(
    `INSERT INTO tiss.recurso_glosa_item
       (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), recursoId, glosaId, justificativa, valorRecursadoCents],
  );

  // 6. Atualiza contadores
  const newCount = recurso.item_count + 1;
  const newTotal = Number(recurso.total_recursado_cents) + valorRecursadoCents;
  await tx.query(
    `UPDATE tiss.recurso_glosa SET item_count = $2, total_recursado_cents = $3 WHERE id = $1`,
    [recursoId, newCount, newTotal],
  );

  return ok({ itemCount: newCount, totalRecursadoCents: newTotal });
}

/**
 * Remove uma glosa de um recurso em rascunho. Atualiza contadores.
 */
export async function removeGlosaFromRecurso(
  tx: TxClient,
  recursoId: string,
  glosaId: string,
): Promise<Result<RemovedGlosaItem, RemoveGlosaFailure>> {
  // 1. Busca o recurso e valida status
  const { rows: recursoRows } = await tx.query<{
    id: string;
    status: string;
    item_count: number;
    total_recursado_cents: string;
  }>(
    `SELECT id, status, item_count, total_recursado_cents
       FROM tiss.recurso_glosa WHERE id = $1 FOR UPDATE`,
    [recursoId],
  );
  if (recursoRows.length === 0) {
    return err({ kind: 'recurso_nao_encontrado' });
  }
  const recurso = recursoRows[0]!;
  if (recurso.status !== 'rascunho') {
    return err({ kind: 'recurso_nao_rascunho', status: recurso.status });
  }

  // 2. Remove o item e pega o valor
  const { rows: removedRows } = await tx.query<{ valor_recursado_cents: string }>(
    `DELETE FROM tiss.recurso_glosa_item
      WHERE recurso_id = $1 AND glosa_id = $2
      RETURNING valor_recursado_cents`,
    [recursoId, glosaId],
  );
  if (removedRows.length === 0) {
    return err({ kind: 'vinculo_nao_encontrado' });
  }

  // 3. Atualiza contadores
  const removedCents = Number(removedRows[0]!.valor_recursado_cents);
  const newCount = Math.max(recurso.item_count - 1, 0);
  const newTotal = Math.max(Number(recurso.total_recursado_cents) - removedCents, 0);
  await tx.query(
    `UPDATE tiss.recurso_glosa SET item_count = $2, total_recursado_cents = $3 WHERE id = $1`,
    [recursoId, newCount, newTotal],
  );

  return ok({ itemCount: newCount, totalRecursadoCents: newTotal });
}
