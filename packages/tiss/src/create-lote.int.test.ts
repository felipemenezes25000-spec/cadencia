import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createLote } from './create-lote';

interface SementeLote {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
  operadoraInativaId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearLote(): Promise<SementeLote> {
  const s: SementeLote = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    operadoraId: uuidv7(), operadoraInativaId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Lote', '11ABC22334DE55')`,
      [s.tenantId, `l-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Lote', '1112233', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Lote')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Meridiano Saude', '99XYZ00001DE01', '3.05', true, $4),
              ($1, $3, '999999', 'Operadora Inativa', '88XYZ00002DE02', '3.05', false, $4)`,
      [s.tenantId, s.operadoraId, s.operadoraInativaId, s.userId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}

describe('createLote', () => {
  let s: SementeLote;

  beforeAll(async () => {
    s = await semearLote();
  });

  afterAll(async () => {
    await closePools();
  });

  it('cria lote em status rascunho com numero sequencial', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.numeroLote).toBe('1');
    expect(result.value.tissVersion).toBe('3.05');
    expect(result.value.loteId).toBeTruthy();
  });

  it('segundo lote da mesma operadora recebe numero sequencial incrementado', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const r1 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    const r2 = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraId, createdBy: s.userId }),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    expect(Number(r2.value.numeroLote)).toBe(Number(r1.value.numeroLote) + 1);
  });

  it('recusa operadora inexistente', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: uuidv7(), createdBy: s.userId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('operadora_nao_encontrada');
  });

  it('recusa operadora inativa', async () => {
    const actor: Actor = {
      kind: 'user', tenantId: s.tenantId, userId: s.userId,
      clinicId: s.clinicId, requestId: uuidv7(),
    };
    const result = await withTenantTx(actor, (tx) =>
      createLote(tx, { operadoraId: s.operadoraInativaId, createdBy: s.userId }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('operadora_inativa');
  });
});
