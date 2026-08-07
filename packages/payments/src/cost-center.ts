// packages/payments/src/cost-center.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type CostCenterFailure =
  | { kind: 'centro_nao_encontrado' }
  | { kind: 'codigo_duplicado' }
  | { kind: 'nome_duplicado' }
  | { kind: 'ja_desativado' };

export interface CreateCostCenterInput {
  readonly code: string;
  readonly name: string;
}

export interface CostCenterRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
}

export async function createCostCenter(
  tx: TxClient,
  i: CreateCostCenterInput,
): Promise<Result<CostCenterRow, CostCenterFailure>> {
  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO fin.cost_center
         (tenant_id, id, code, name)
       VALUES (app.require_tenant_id(), $1, $2, $3)`,
      [id, i.code, i.name]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('duplicate key') && msg.includes('code')) {
      return err({ kind: 'codigo_duplicado' });
    }
    if (msg.includes('duplicate key') && msg.includes('name')) {
      return err({ kind: 'nome_duplicado' });
    }
    throw e;
  }

  return ok({ id, code: i.code, name: i.name, active: true });
}

export interface UpdateCostCenterInput {
  readonly id: string;
  readonly code?: string;
  readonly name?: string;
}

export async function updateCostCenter(
  tx: TxClient,
  i: UpdateCostCenterInput,
): Promise<Result<CostCenterRow, CostCenterFailure>> {
  const { rows } = await tx.query<{
    id: string; code: string; name: string; active: boolean;
  }>(
    `SELECT id::text, code, name, active
       FROM fin.cost_center WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'centro_nao_encontrado' });

  const code = i.code ?? existing.code;
  const name = i.name ?? existing.name;

  try {
    await tx.query(
      `UPDATE fin.cost_center SET code = $2, name = $3 WHERE id = $1`,
      [i.id, code, name]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('duplicate key') && msg.includes('code')) {
      return err({ kind: 'codigo_duplicado' });
    }
    if (msg.includes('duplicate key') && msg.includes('name')) {
      return err({ kind: 'nome_duplicado' });
    }
    throw e;
  }

  return ok({ id: existing.id, code, name, active: existing.active });
}

export async function deactivateCostCenter(
  tx: TxClient,
  centerId: string,
): Promise<Result<{ id: string }, CostCenterFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM fin.cost_center WHERE id = $1`, [centerId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'centro_nao_encontrado' });
  if (!existing.active) return err({ kind: 'ja_desativado' });

  await tx.query(
    `UPDATE fin.cost_center SET active = false WHERE id = $1`,
    [centerId]);

  return ok({ id: centerId });
}

export async function listCostCenters(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<CostCenterRow[]> {
  const whereActive = onlyActive ? 'AND active = true' : '';
  const { rows } = await tx.query<{
    id: string; code: string; name: string; active: boolean;
  }>(
    `SELECT id::text, code, name, active
       FROM fin.cost_center
      WHERE 1=1 ${whereActive}
      ORDER BY code`);
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, active: r.active,
  }));
}
