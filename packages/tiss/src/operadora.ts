// packages/tiss/src/operadora.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type OperadoraFailure =
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'registro_ans_duplicado' }
  | { kind: 'registro_ans_invalido' }
  | { kind: 'cnpj_invalido' }
  | { kind: 'ja_desativada' };

export interface CreateOperadoraInput {
  readonly registroAns: string;
  readonly razaoSocial: string;
  readonly nomeFantasia?: string;
  readonly cnpj: string;
  readonly telefone?: string;
  readonly email?: string;
  readonly portalUrl?: string;
  readonly portalLogin?: string;
  readonly portalObs?: string;
}

export interface OperadoraRow {
  readonly id: string;
  readonly registroAns: string;
  readonly razaoSocial: string;
  readonly nomeFantasia: string | null;
  readonly cnpj: string;
  readonly telefone: string | null;
  readonly email: string | null;
  readonly portalUrl: string | null;
  readonly portalLogin: string | null;
  readonly portalObs: string | null;
  readonly active: boolean;
}

export interface UpdateOperadoraInput {
  readonly id: string;
  readonly razaoSocial?: string;
  readonly nomeFantasia?: string | null;
  readonly telefone?: string | null;
  readonly email?: string | null;
  readonly portalUrl?: string | null;
  readonly portalLogin?: string | null;
  readonly portalObs?: string | null;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

const ANS_RE = /^[0-9]{6}$/;
const CNPJ_RE = /^(?=.*[A-Z])[A-Z0-9]{12}[0-9]{2}$/;

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

export async function createOperadora(
  tx: TxClient,
  i: CreateOperadoraInput,
  createdBy: string,
): Promise<Result<OperadoraRow, OperadoraFailure>> {
  if (!ANS_RE.test(i.registroAns)) {
    return err({ kind: 'registro_ans_invalido' });
  }
  if (!CNPJ_RE.test(i.cnpj)) {
    return err({ kind: 'cnpj_invalido' });
  }

  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, nome_fantasia, cnpj,
          telefone, email, portal_url, portal_login, portal_obs, created_by)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10, $11)`,
      [id, i.registroAns, i.razaoSocial, i.nomeFantasia ?? null, i.cnpj,
       i.telefone ?? null, i.email ?? null, i.portalUrl ?? null,
       i.portalLogin ?? null, i.portalObs ?? null, createdBy]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('duplicate key') && msg.includes('registro_ans')) {
      return err({ kind: 'registro_ans_duplicado' });
    }
    throw e;
  }

  return ok({
    id, registroAns: i.registroAns,
    razaoSocial: i.razaoSocial,
    nomeFantasia: i.nomeFantasia ?? null,
    cnpj: i.cnpj,
    telefone: i.telefone ?? null,
    email: i.email ?? null,
    portalUrl: i.portalUrl ?? null,
    portalLogin: i.portalLogin ?? null,
    portalObs: i.portalObs ?? null,
    active: true,
  });
}

export async function updateOperadora(
  tx: TxClient,
  i: UpdateOperadoraInput,
): Promise<Result<OperadoraRow, OperadoraFailure>> {
  const { rows } = await tx.query<{
    id: string; registro_ans: string; razao_social: string;
    nome_fantasia: string | null; cnpj: string;
    telefone: string | null; email: string | null;
    portal_url: string | null; portal_login: string | null;
    portal_obs: string | null; active: boolean;
  }>(
    `SELECT id::text, registro_ans, razao_social, nome_fantasia, cnpj,
            telefone, email, portal_url, portal_login, portal_obs, active
       FROM tiss.operadora WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'operadora_nao_encontrada' });

  const razaoSocial = i.razaoSocial ?? existing.razao_social;
  const nomeFantasia = i.nomeFantasia !== undefined ? i.nomeFantasia : existing.nome_fantasia;
  const telefone = i.telefone !== undefined ? i.telefone : existing.telefone;
  const email = i.email !== undefined ? i.email : existing.email;
  const portalUrl = i.portalUrl !== undefined ? i.portalUrl : existing.portal_url;
  const portalLogin = i.portalLogin !== undefined ? i.portalLogin : existing.portal_login;
  const portalObs = i.portalObs !== undefined ? i.portalObs : existing.portal_obs;

  await tx.query(
    `UPDATE tiss.operadora
        SET razao_social = $2, nome_fantasia = $3,
            telefone = $4, email = $5, portal_url = $6,
            portal_login = $7, portal_obs = $8
      WHERE id = $1`,
    [i.id, razaoSocial, nomeFantasia, telefone, email,
     portalUrl, portalLogin, portalObs]);

  return ok({
    id: existing.id, registroAns: existing.registro_ans,
    razaoSocial, nomeFantasia, cnpj: existing.cnpj,
    telefone, email, portalUrl, portalLogin, portalObs,
    active: existing.active,
  });
}

export async function deactivateOperadora(
  tx: TxClient,
  operadoraId: string,
): Promise<Result<{ id: string }, OperadoraFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM tiss.operadora WHERE id = $1`, [operadoraId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'operadora_nao_encontrada' });
  if (!existing.active) return err({ kind: 'ja_desativada' });

  await tx.query(
    `UPDATE tiss.operadora SET active = false WHERE id = $1`,
    [operadoraId]);

  return ok({ id: operadoraId });
}

export async function listOperadoras(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<OperadoraRow[]> {
  const whereActive = onlyActive ? 'AND active = true' : '';
  const { rows } = await tx.query<{
    id: string; registro_ans: string; razao_social: string;
    nome_fantasia: string | null; cnpj: string;
    telefone: string | null; email: string | null;
    portal_url: string | null; portal_login: string | null;
    portal_obs: string | null; active: boolean;
  }>(
    `SELECT id::text, registro_ans, razao_social, nome_fantasia, cnpj,
            telefone, email, portal_url, portal_login, portal_obs, active
       FROM tiss.operadora
      WHERE 1=1 ${whereActive}
      ORDER BY razao_social COLLATE "pt-BR-x-icu"`);
  return rows.map((r) => ({
    id: r.id, registroAns: r.registro_ans,
    razaoSocial: r.razao_social,
    nomeFantasia: r.nome_fantasia,
    cnpj: r.cnpj,
    telefone: r.telefone, email: r.email,
    portalUrl: r.portal_url, portalLogin: r.portal_login,
    portalObs: r.portal_obs,
    active: r.active,
  }));
}
