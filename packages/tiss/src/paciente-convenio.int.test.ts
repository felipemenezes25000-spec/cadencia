// packages/tiss/src/paciente-convenio.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createPacienteConvenio, updatePacienteConvenio,
  deactivatePacienteConvenio, listPacienteConvenios,
  type CreatePacienteConvenioInput,
} from './paciente-convenio';

interface SementePC {
  tenantId: string; clinicId: string; userId: string;
  operadoraId: string; patientId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearPC(): Promise<SementePC> {
  const s: SementePC = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    operadoraId: uuidv7(), patientId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Tiss PacConv', '88ABC99012DE33')`,
      [s.tenantId, `pc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Tiss PacConv', '8888888', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin PacConv')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
       VALUES ($1, $2, '888888', 'Operadora PacConv', '99ABC00011DE22', $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Convenio Teste', 'completo')`,
      [s.tenantId, s.patientId]);
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

let s: SementePC;
let actor: Actor;

beforeAll(async () => {
  s = await semearPC();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createPacienteConvenio — vincula paciente a operadora', () => {
  it('cria vinculo titular com todos os campos', async () => {
    const input: CreatePacienteConvenioInput = {
      patientId: s.patientId,
      operadoraId: s.operadoraId,
      numeroCarteira: '00112233445566',
      validade: '2027-12-31',
      nomePlano: 'Plano Essencial',
      tipoBeneficiario: 'T',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.numeroCarteira).toBe('00112233445566');
    expect(r.value.tipoBeneficiario).toBe('T');
    expect(r.value.active).toBe(true);
  });

  it('cria vinculo dependente com dados do titular', async () => {
    const patientDep = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Dependente Teste', 'completo')`,
        [patientDep]));

    const input: CreatePacienteConvenioInput = {
      patientId: patientDep,
      operadoraId: s.operadoraId,
      numeroCarteira: '99887766554433',
      tipoBeneficiario: 'D',
      titularNome: 'Paciente Convenio Teste',
      titularCarteira: '00112233445566',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tipoBeneficiario).toBe('D');
    expect(r.value.titularNome).toBe('Paciente Convenio Teste');
  });

  it('recusa dependente sem nome do titular', async () => {
    const patientDep2 = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Dep Sem Titular', 'completo')`,
        [patientDep2]));

    const input: CreatePacienteConvenioInput = {
      patientId: patientDep2,
      operadoraId: s.operadoraId,
      numeroCarteira: '77665544332211',
      tipoBeneficiario: 'D',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('dependente_sem_titular');
  });

  it('recusa carteirinha duplicada na mesma operadora', async () => {
    const input: CreatePacienteConvenioInput = {
      patientId: s.patientId,
      operadoraId: s.operadoraId,
      numeroCarteira: '00112233445566',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('carteira_duplicada');
  });
});

describe('updatePacienteConvenio — atualiza vinculo', () => {
  let pcId = '';

  beforeAll(async () => {
    const patientUpd = uuidv7();
    const opUpd = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Pac Para Update Conv', 'completo')`,
        [patientUpd]));
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '999999', 'Op Para Update Conv', '11ABC22233DE99', $2)`,
        [opUpd, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, {
        patientId: patientUpd,
        operadoraId: opUpd,
        numeroCarteira: '55443322110099',
      }, s.userId));
    if (r.ok) pcId = r.value.id;
  });

  it('atualiza validade e nome do plano', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updatePacienteConvenio(tx, {
        id: pcId,
        validade: '2028-06-30',
        nomePlano: 'Plano Premium',
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.validade).toBe('2028-06-30');
    expect(r.value.nomePlano).toBe('Plano Premium');
  });

  it('retorna erro para vinculo inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updatePacienteConvenio(tx, { id: uuidv7(), nomePlano: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('vinculo_nao_encontrado');
  });
});

describe('deactivatePacienteConvenio — desativa vinculo', () => {
  let pcId = '';

  beforeAll(async () => {
    const patientDeact = uuidv7();
    const opDeact = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Pac Para Deact Conv', 'completo')`,
        [patientDeact]));
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '123456', 'Op Para Deact Conv', '44ABC55566DE77', $2)`,
        [opDeact, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, {
        patientId: patientDeact,
        operadoraId: opDeact,
        numeroCarteira: '66554433221100',
      }, s.userId));
    if (r.ok) pcId = r.value.id;
  });

  it('desativa vinculo ativo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivatePacienteConvenio(tx, pcId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar vinculo ja desativado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivatePacienteConvenio(tx, pcId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativado');
  });
});

describe('listPacienteConvenios — lista convenios do paciente', () => {
  it('lista somente ativos por padrao', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listPacienteConvenios(tx, s.patientId));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });
});
