// packages/payments/src/cost-center.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createCostCenter, updateCostCenter, deactivateCostCenter, listCostCenters,
} from './cost-center';

interface Semente {
  tenantId: string; clinicId: string; userId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semear(): Promise<Semente> {
  const s: Semente = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica CC Domain', '66ABC77801DE90')`,
      [s.tenantId, `ccd-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade CC', '6666666', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin CC')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
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

let s: Semente;
let actor: Actor;

beforeAll(async () => {
  s = await semear();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createCostCenter — cria centro de custo', () => {
  it('cria centro de custo com codigo e nome', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'MKT', name: 'Marketing' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.code).toBe('MKT');
    expect(r.value.name).toBe('Marketing');
    expect(r.value.active).toBe(true);
  });

  it('rejeita codigo duplicado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'MKT', name: 'Marketing Novo' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('codigo_duplicado');
  });

  it('rejeita nome duplicado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'MKT2', name: 'Marketing' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('nome_duplicado');
  });
});

describe('updateCostCenter — atualiza centro de custo', () => {
  let centerId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'FIN', name: 'Financeiro' }));
    if (r.ok) centerId = r.value.id;
  });

  it('atualiza nome', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateCostCenter(tx, { id: centerId, name: 'Depto Financeiro' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Depto Financeiro');
    expect(r.value.code).toBe('FIN');
  });

  it('retorna erro para centro inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateCostCenter(tx, { id: uuidv7(), name: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('centro_nao_encontrado');
  });
});

describe('deactivateCostCenter — desativa centro', () => {
  let centerId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createCostCenter(tx, { code: 'RH', name: 'Recursos Humanos' }));
    if (r.ok) centerId = r.value.id;
  });

  it('desativa centro ativo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateCostCenter(tx, centerId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar centro ja desativado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateCostCenter(tx, centerId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativado');
  });
});

describe('listCostCenters — lista centros do tenant', () => {
  it('lista somente ativos por padrao, ordenados por codigo', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listCostCenters(tx));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
    // Ordenacao por codigo
    for (let i = 1; i < lista.length; i++) {
      expect(lista[i]!.code >= lista[i - 1]!.code).toBe(true);
    }
  });

  it('lista todos incluindo desativados', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listCostCenters(tx, false));
    const inativos = lista.filter((c) => !c.active);
    expect(inativos.length).toBeGreaterThanOrEqual(1);
  });
});
