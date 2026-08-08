// apps/api/src/routes/tiss/convenios-paciente.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let operadoraId: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });

  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, razao_social, registro_ans, cnpj, tiss_version, transport_mode, created_by)
       VALUES ($1, $2, 'Op Conv', '339679', '11111111000190', '3.05', 'arquivo', $3)`,
      [admin.tenantId, operadoraId, admin.userId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});
afterAll(async () => { await closePools(); });

describe('rotas de convenio do paciente', () => {
  let convenioId: string;

  it('POST /v1/tiss/pacientes/:patientId/convenios vincula convenio ao paciente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/pacientes/${admin.patientId}/convenios`,
      ...auth(admin),
      payload: {
        operadoraId,
        numeroCarteira: 'CART-987654',
        validadeCarteira: '2027-12-31',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { convenioId: string };
    expect(body.convenioId).toBeTruthy();
    convenioId = body.convenioId;
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('GET /v1/tiss/pacientes/:patientId/convenios lista convenios do paciente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/pacientes/${admin.patientId}/convenios`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ convenioId: string; operadoraNome: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    expect(body.itens.some((c) => c.convenioId === convenioId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/tiss/pacientes/:patientId/convenios atualiza convenio', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT',
      url: `/v1/tiss/pacientes/${admin.patientId}/convenios`,
      ...auth(admin),
      payload: {
        convenioId,
        numeroCarteira: 'CART-111222',
      },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { convenioId: string }).convenioId).toBe(convenioId);
    await app.close();
  });

  it('DELETE desativa convenio do paciente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/tiss/pacientes/${admin.patientId}/convenios/${convenioId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { convenioId: string }).convenioId).toBe(convenioId);
    await app.close();
  });
});
