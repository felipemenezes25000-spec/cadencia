import { err, ok, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type AddGuiaFailure =
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'lote_nao_rascunho'; status: string }
  | { kind: 'guia_nao_encontrada' }
  | { kind: 'guia_inativa' }
  | { kind: 'guia_operadora_divergente' }
  | { kind: 'guia_ja_em_lote'; loteId: string };

export type RemoveGuiaFailure =
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'lote_nao_rascunho'; status: string }
  | { kind: 'vinculo_nao_encontrado' };

export interface AddGuiaInput {
  readonly loteId: string;
  readonly guiaId: string;
}

export interface AddedGuia {
  readonly sequencialItem: number;
  readonly guiaCount: number;
  readonly totalValueCents: number;
}

/**
 * Adiciona uma guia a um lote em rascunho. Validações:
 * - Lote existe e está em rascunho
 * - Guia existe e está com live=true
 * - Guia pertence a mesma operadora do lote
 * - Guia não está em outro lote (índice único garante, mas validamos antes)
 */
export async function addGuiaToLote(
  tx: TxClient,
  i: AddGuiaInput,
): Promise<Result<AddedGuia, AddGuiaFailure>> {
  // 1. Busca o lote e valida status
  const { rows: loteRows } = await tx.query<{
    id: string;
    operadora_id: string;
    status: string;
    guia_count: number;
    total_value_cents: string;
  }>(
    `SELECT id, operadora_id, status, guia_count, total_value_cents
       FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [i.loteId],
  );
  if (loteRows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = loteRows[0]!;
  if (lote.status !== 'rascunho') {
    return err({ kind: 'lote_nao_rascunho', status: lote.status });
  }

  // 2. Busca a guia e valida
  const { rows: guiaRows } = await tx.query<{
    id: string;
    operadora_id: string;
    live: boolean;
    valor_procedimento: string;
  }>(
    `SELECT id, operadora_id, live, valor_procedimento
       FROM tiss.encounter_guia_consulta WHERE id = $1`,
    [i.guiaId],
  );
  if (guiaRows.length === 0) {
    return err({ kind: 'guia_nao_encontrada' });
  }
  const guia = guiaRows[0]!;
  if (!guia.live) {
    return err({ kind: 'guia_inativa' });
  }
  if (guia.operadora_id !== lote.operadora_id) {
    return err({ kind: 'guia_operadora_divergente' });
  }

  // 3. Verifica se guia já está em outro lote
  const { rows: existeRows } = await tx.query<{ lote_id: string }>(
    `SELECT lote_id FROM tiss.lote_guia WHERE guia_id = $1`,
    [i.guiaId],
  );
  if (existeRows.length > 0) {
    return err({ kind: 'guia_ja_em_lote', loteId: existeRows[0]!.lote_id });
  }

  // 4. Calcula próximo sequencial_item
  const { rows: seqRows } = await tx.query<{ max_seq: number | null }>(
    `SELECT MAX(sequencial_item) AS max_seq
       FROM tiss.lote_guia WHERE lote_id = $1`,
    [i.loteId],
  );
  const nextSeq = (seqRows[0]?.max_seq ?? 0) + 1;

  // 5. Insere o vínculo
  await tx.query(
    `INSERT INTO tiss.lote_guia (lote_id, guia_id, sequencial_item)
     VALUES ($1, $2, $3)`,
    [i.loteId, i.guiaId, nextSeq],
  );

  // 6. Atualiza contadores no lote
  // valor_procedimento é numeric(12,2) na guia; convertemos para centavos
  const valorCents = Math.round(Number(guia.valor_procedimento) * 100);
  const newCount = lote.guia_count + 1;
  const newTotal = Number(lote.total_value_cents) + valorCents;

  await tx.query(
    `UPDATE tiss.lote SET guia_count = $2, total_value_cents = $3 WHERE id = $1`,
    [i.loteId, newCount, newTotal],
  );

  return ok({
    sequencialItem: nextSeq,
    guiaCount: newCount,
    totalValueCents: newTotal,
  });
}

/**
 * Remove uma guia de um lote em rascunho. Atualiza contadores.
 */
export async function removeGuiaFromLote(
  tx: TxClient,
  i: { loteId: string; guiaId: string },
): Promise<Result<{ guiaCount: number; totalValueCents: number }, RemoveGuiaFailure>> {
  // 1. Busca o lote e valida status
  const { rows: loteRows } = await tx.query<{
    id: string;
    status: string;
    guia_count: number;
    total_value_cents: string;
  }>(
    `SELECT id, status, guia_count, total_value_cents
       FROM tiss.lote WHERE id = $1 FOR UPDATE`,
    [i.loteId],
  );
  if (loteRows.length === 0) {
    return err({ kind: 'lote_nao_encontrado' });
  }
  const lote = loteRows[0]!;
  if (lote.status !== 'rascunho') {
    return err({ kind: 'lote_nao_rascunho', status: lote.status });
  }

  // 2. Remove o vínculo e pega o valor da guia
  const { rows: guiaRows } = await tx.query<{ valor_procedimento: string }>(
    `DELETE FROM tiss.lote_guia lg
      USING tiss.encounter_guia_consulta g
      WHERE lg.lote_id = $1 AND lg.guia_id = $2
        AND g.id = lg.guia_id AND g.tenant_id = lg.tenant_id
      RETURNING g.valor_procedimento`,
    [i.loteId, i.guiaId],
  );
  if (guiaRows.length === 0) {
    return err({ kind: 'vinculo_nao_encontrado' });
  }

  // 3. Atualiza contadores
  const valorCents = Math.round(Number(guiaRows[0]!.valor_procedimento) * 100);
  const newCount = lote.guia_count - 1;
  const newTotal = Number(lote.total_value_cents) - valorCents;

  await tx.query(
    `UPDATE tiss.lote SET guia_count = $2, total_value_cents = $3 WHERE id = $1`,
    [i.loteId, Math.max(newCount, 0), Math.max(newTotal, 0)],
  );

  return ok({
    guiaCount: Math.max(newCount, 0),
    totalValueCents: Math.max(newTotal, 0),
  });
}
