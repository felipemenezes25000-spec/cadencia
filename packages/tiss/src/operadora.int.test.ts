// packages/tiss/src/operadora.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createOperadora, updateOperadora, deactivateOperadora, listOperadoras,
  type CreateOperadoraInput,
} from './operadora';

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
       VALUES ($1, $2, 'Clinica Tiss Operadora', '77ABC88901DE55')`,
      [s.tenantId, `to-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Tiss', '7777777', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Tiss')`,
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

describe('createOperadora — cria operadora de convenio', () => {
  it('cria operadora com todos os campos obrigatorios', async () => {
    const input: CreateOperadoraInput = {
      registroAns: '326305',
      razaoSocial: 'Operadora Meridiano Saude Ltda',
      nomeFantasia: 'Meridiano Saude',
      cnpj: '11ABC22233DE44',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.registroAns).toBe('326305');
    expect(r.value.razaoSocial).toBe('Operadora Meridiano Saude Ltda');
    expect(r.value.cnpj).toBe('11ABC22233DE44');
    expect(r.value.active).toBe(true);
  });

  it('recusa registro ANS duplicado no mesmo tenant', async () => {
    const input: CreateOperadoraInput = {
      registroAns: '326305',
      razaoSocial: 'Outra Operadora',
      cnpj: '99XYZ00011DE22',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('registro_ans_duplicado');
  });

  it('recusa CNPJ com formato invalido', async () => {
    const input: CreateOperadoraInput = {
      registroAns: '999999',
      razaoSocial: 'Operadora Invalida',
      cnpj: '12345678901234',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('cnpj_invalido');
  });

  it('recusa registro ANS com formato invalido', async () => {
    const input: CreateOperadoraInput = {
      registroAns: 'ABCDEF',
      razaoSocial: 'Operadora ANS Invalida',
      cnpj: '33ABC44455DE66',
    };
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('registro_ans_invalido');
  });
});

describe('updateOperadora — atualiza operadora', () => {
  let operadoraId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, {
        registroAns: '111111',
        razaoSocial: 'Para Atualizar',
        cnpj: '44ABC55566DE77',
      }, s.userId));
    if (r.ok) operadoraId = r.value.id;
  });

  it('atualiza nome fantasia e telefone', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateOperadora(tx, {
        id: operadoraId,
        nomeFantasia: 'Novo Nome Fantasia',
        telefone: '11999998888',
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.nomeFantasia).toBe('Novo Nome Fantasia');
    expect(r.value.telefone).toBe('11999998888');
  });

  it('retorna erro para operadora inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateOperadora(tx, { id: uuidv7(), razaoSocial: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('operadora_nao_encontrada');
  });
});

describe('deactivateOperadora — desativa operadora', () => {
  let operadoraId = '';

  beforeAll(async () => {
    const r = await withTenantTx(actor, (tx) =>
      createOperadora(tx, {
        registroAns: '222222',
        razaoSocial: 'Para Desativar',
        cnpj: '55ABC66677DE88',
      }, s.userId));
    if (r.ok) operadoraId = r.value.id;
  });

  it('desativa operadora ativa', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateOperadora(tx, operadoraId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar operadora ja desativada', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateOperadora(tx, operadoraId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativada');
  });
});

describe('listOperadoras — lista operadoras do tenant', () => {
  it('lista somente ativas por padrao', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listOperadoras(tx));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });

  it('lista todas incluindo desativadas', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listOperadoras(tx, false));
    const inativos = lista.filter((a) => !a.active);
    expect(inativos.length).toBeGreaterThanOrEqual(1);
  });
});
