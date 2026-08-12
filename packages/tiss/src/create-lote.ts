import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type CreateLoteFailure =
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'operadora_inativa' };

export interface CreateLoteInput {
  readonly operadoraId: string;
  readonly createdBy: string;
}

export interface CreatedLote {
  readonly loteId: string;
  readonly numeroLote: string;
  readonly tissVersion: string;
}

/**
 * Cria um lote TISS em status rascunho para a operadora informada.
 * O número do lote é gerado automaticamente via tiss.next_lote_number(),
 * que se auto-provisiona na primeira chamada. A versão TISS vem do
 * cadastro da operadora (a versão acordada, não a versão vigente hoje).
 */
export async function createLote(
  tx: TxClient,
  i: CreateLoteInput,
): Promise<Result<CreatedLote, CreateLoteFailure>> {
  // 1. Busca a operadora para pegar tiss_version e validar que existe e está ativa
  const { rows: opRows } = await tx.query<{
    id: string;
    tiss_version: string;
    active: boolean;
    tenant_id: string;
  }>(
    `SELECT id, tiss_version, active, tenant_id
       FROM tiss.operadora WHERE id = $1`,
    [i.operadoraId],
  );
  if (opRows.length === 0) {
    return err({ kind: 'operadora_nao_encontrada' });
  }
  const op = opRows[0]!;
  if (!op.active) {
    return err({ kind: 'operadora_inativa' });
  }

  // 2. Gera número sequencial do lote para esta operadora
  const { rows: numRows } = await tx.query<{ n: string }>(
    `SELECT tiss.next_lote_number($1, $2) AS n`,
    [op.tenant_id, i.operadoraId],
  );
  const numeroLote = String(numRows[0]!.n);

  // 3. Insere o lote em status rascunho
  const loteId = uuidv7();
  await tx.query(
    `INSERT INTO tiss.lote
       (id, operadora_id, numero_lote, status, tiss_version,
        guia_count, total_value_cents, created_by)
     VALUES ($1, $2, $3, 'rascunho', $4, 0, 0, $5)`,
    [loteId, i.operadoraId, numeroLote, op.tiss_version, i.createdBy],
  );

  return ok({
    loteId,
    numeroLote,
    tissVersion: op.tiss_version,
  });
}
