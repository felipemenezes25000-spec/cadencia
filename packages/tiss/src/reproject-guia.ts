// packages/tiss/src/reproject-guia.ts
import type { TxClient } from '@cadencia/db';
import type { Result } from '@cadencia/kernel';
import { ok, err } from '@cadencia/kernel';
import { projectGuiaConsulta } from './project-guia';

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

export type ReprojectAction =
  | { action: 'reprojected'; oldGuiaId: string; newGuiaId: string }
  | { action: 'pendencia_created'; pendenciaId: string; guiaId: string }
  | { action: 'no_guia'; reason: string };

export type ReprojectError = {
  code: 'PROJECTION_FAILED';
  message: string;
};

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

/**
 * Regra de reprojecao apos retificacao ou adendo (design S3.9):
 *
 * 1. Busca a guia VIVA do atendimento.
 * 2. Se nao existe guia -> retorna no_guia (atendimento particular ou guia
 *    nunca foi projetada).
 * 3. Verifica se a guia pertence a um lote JA ENVIADO:
 *    - Se pertence a lote enviado (status IN ('enviado','retornado')) ->
 *      cria pendencia em tiss.guia_pendencia (tipo='reprojecao_pos_envio').
 *    - Se NAO pertence a lote enviado (nenhum lote, ou lote rascunho/pronto) ->
 *      marca a guia antiga como live=false e projeta nova guia da nova versao.
 */
export async function reprojectGuiaOnAmend(
  tx: TxClient,
  encounterId: string,
  encounterVersionId: string,
): Promise<Result<ReprojectAction, ReprojectError>> {
  // 1) Buscar a guia viva do atendimento
  const { rows: guias } = await tx.query<{ id: string }>(
    `SELECT g.id
       FROM tiss.encounter_guia_consulta g
      WHERE g.encounter_id = $1
        AND g.live = true`,
    [encounterId],
  );

  if (guias.length === 0) {
    return ok({ action: 'no_guia' as const, reason: 'nenhuma guia viva para este atendimento' });
  }

  const guiaId = guias[0]!.id;

  // 2) Verificar se a guia pertence a um lote ja enviado.
  // tiss.lote_guia e tiss.lote sao criados pelo bloco 06 (migrations futuras).
  // Usa to_regclass para verificar se a tabela existe antes de consultar,
  // evitando erro quando as migrations de lote ainda nao foram aplicadas.
  let loteEnviado = false;
  const { rows: tableCheck } = await tx.query<{ exists: boolean }>(
    `SELECT to_regclass('tiss.lote_guia') IS NOT NULL AS exists`,
  );
  if (tableCheck[0]?.exists) {
    const { rows: loteRows } = await tx.query<{ lote_status: string | null }>(
      `SELECT l.status AS lote_status
         FROM tiss.lote_guia lg
         JOIN tiss.lote l ON (l.tenant_id, l.id) = (lg.tenant_id, lg.lote_id)
        WHERE lg.guia_id = $1
          AND l.status NOT IN ('cancelado')
        ORDER BY l.created_at DESC
        LIMIT 1`,
      [guiaId],
    );

    loteEnviado = loteRows.length > 0
      && loteRows[0]!.lote_status !== null
      && ['enviado', 'retornado'].includes(loteRows[0]!.lote_status);
  }

  // 3a) Lote ja enviado -> criar pendencia
  if (loteEnviado) {
    const { rows: pendencia } = await tx.query<{ id: string }>(
      `INSERT INTO tiss.guia_pendencia
         (tenant_id, id, guia_id, encounter_version_id, tipo)
       VALUES (
         (SELECT tenant_id FROM tiss.encounter_guia_consulta WHERE id = $1),
         gen_random_uuid(), $1, $2, 'reprojecao_pos_envio'
       )
       RETURNING id`,
      [guiaId, encounterVersionId],
    );
    return ok({
      action: 'pendencia_created' as const,
      pendenciaId: pendencia[0]!.id,
      guiaId,
    });
  }

  // 3b) Sem lote enviado -> reprojetar
  // Marcar a guia antiga como live=false
  await tx.query(
    `UPDATE tiss.encounter_guia_consulta SET live = false WHERE id = $1`,
    [guiaId],
  );

  // Projetar nova guia da nova versao
  const projecao = await projectGuiaConsulta(tx, encounterId, encounterVersionId);
  if (!projecao.ok) {
    return err({
      code: 'PROJECTION_FAILED' as const,
      message: `falha ao projetar nova guia: ${String(projecao.error)}`,
    });
  }

  // Buscar o id da nova guia criada
  const { rows: novaGuia } = await tx.query<{ id: string }>(
    `SELECT id FROM tiss.encounter_guia_consulta
      WHERE encounter_id = $1 AND live = true`,
    [encounterId],
  );

  return ok({
    action: 'reprojected' as const,
    oldGuiaId: guiaId,
    newGuiaId: novaGuia[0]!.id,
  });
}
