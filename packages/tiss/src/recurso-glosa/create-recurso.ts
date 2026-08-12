// packages/tiss/src/recurso-glosa/create-recurso.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import type {
  CreateRecursoGlosaInput,
  CreatedRecurso,
  CreateRecursoFailure,
} from './types';

/**
 * Cria um recurso de glosa em status rascunho com os itens informados.
 *
 * Validações:
 * - Ao menos 1 item
 * - Operadora existe
 * - Cada glosa existe em tiss.glosa, está com status 'pendente',
 *   e pertence a mesma operadora do recurso (via guia)
 * - Glosa não está em outro recurso ativo (não-indeferido)
 */
export async function createRecursoGlosa(
  tx: TxClient,
  i: CreateRecursoGlosaInput,
): Promise<Result<CreatedRecurso, CreateRecursoFailure>> {
  if (i.itens.length === 0) {
    return err({ kind: 'sem_itens' });
  }

  // 1. Valida operadora
  const { rows: opRows } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.operadora WHERE id = $1`,
    [i.operadoraId],
  );
  if (opRows.length === 0) {
    return err({ kind: 'operadora_nao_encontrada' });
  }

  // 2. Valida cada glosa
  let encounterVersionId: string | undefined;
  for (const item of i.itens) {
    const { rows: glosaRows } = await tx.query<{
      id: string;
      status: string;
      encounter_version_id: string;
      guia_id: string;
    }>(
      `SELECT g.id, g.status, g.encounter_version_id, g.guia_id
         FROM tiss.glosa g
        WHERE g.id = $1`,
      [item.glosaId],
    );
    if (glosaRows.length === 0) {
      return err({ kind: 'glosa_nao_encontrada', glosaId: item.glosaId });
    }
    const glosa = glosaRows[0]!;

    // Glosa precisa estar em status pendente
    if (glosa.status !== 'pendente') {
      return err({ kind: 'glosa_nao_pendente', glosaId: item.glosaId, status: glosa.status });
    }

    // Valida que a glosa pertence a mesma operadora (via guia)
    const { rows: guiaRows } = await tx.query<{ operadora_id: string }>(
      `SELECT operadora_id FROM tiss.encounter_guia_consulta WHERE id = $1`,
      [glosa.guia_id],
    );
    if (guiaRows.length === 0 || guiaRows[0]!.operadora_id !== i.operadoraId) {
      return err({ kind: 'glosa_operadora_divergente', glosaId: item.glosaId });
    }

    // Verifica se a glosa já está em outro recurso ativo
    const { rows: existeRows } = await tx.query<{ recurso_id: string }>(
      `SELECT rgi.recurso_id
         FROM tiss.recurso_glosa_item rgi
         JOIN tiss.recurso_glosa rg ON rg.id = rgi.recurso_id AND rg.tenant_id = rgi.tenant_id
        WHERE rgi.glosa_id = $1
          AND rg.status NOT IN ('indeferido')`,
      [item.glosaId],
    );
    if (existeRows.length > 0) {
      return err({ kind: 'glosa_nao_pendente', glosaId: item.glosaId, status: 'ja_recursada' });
    }

    // Captura encounter_version_id da primeira glosa
    if (encounterVersionId === undefined) {
      encounterVersionId = glosa.encounter_version_id;
    }
  }

  // 3. Gera numero_recurso via contador auto-provisionante (migration 0126)
  const { rows: nrRows } = await tx.query<{ next_recurso_number: string }>(
    `SELECT tiss.next_recurso_number(app.current_tenant_id(), $1) AS next_recurso_number`,
    [i.operadoraId],
  );
  const numeroRecurso = String(nrRows[0]!.next_recurso_number);

  // 4. Insere o recurso
  const recursoId = uuidv7();
  let totalRecursadoCents = 0;
  for (const item of i.itens) {
    totalRecursadoCents += item.valorRecursadoCents;
  }

  await tx.query(
    `INSERT INTO tiss.recurso_glosa
       (id, operadora_id, numero_recurso, encounter_version_id,
        status, item_count, total_recursado_cents, created_by)
     VALUES ($1, $2, $3, $4, 'rascunho'::tiss.recurso_glosa_status, $5, $6, $7)`,
    [recursoId, i.operadoraId, numeroRecurso, encounterVersionId,
     i.itens.length, totalRecursadoCents, i.createdBy],
  );

  // 5. Insere os itens
  for (const item of i.itens) {
    await tx.query(
      `INSERT INTO tiss.recurso_glosa_item
         (id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv7(), recursoId, item.glosaId, item.justificativa, item.valorRecursadoCents],
    );
  }

  return ok({
    recursoId,
    itemCount: i.itens.length,
    totalRecursadoCents,
  });
}
