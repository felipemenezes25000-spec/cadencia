// apps/api/src/routes/tiss/guias.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let guiaId: string;
let operadoraId: string;
let versionId: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });

  // Semear dados necessarios para a guia
  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, razao_social, registro_ans, cnpj, tiss_version, transport_mode, created_by)
       VALUES ($1, $2, 'Unimed Guia', '339679', '11111111000190', '3.05', 'arquivo', $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    // Criar encounter_version para FK
    versionId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               decode(repeat('00', 32), 'hex'), 'test-v1')`,
      [admin.tenantId, versionId, admin.encounterId,
       admin.userId, admin.professionalId]);

    // Criar a guia
    guiaId = uuidv7();
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          codigo_prestador_na_operadora,
          cnes, conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, data_atendimento,
          tipo_consulta, codigo_tabela, codigo_procedimento, valor_procedimento,
          created_by)
       VALUES ($1, $2, $3, $4, $5,
               '339679', 'GP-00001', 'CART123', false,
               '00000001',
               '2077502', '06', '999888', 'SP', '225125',
               '9', '01',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               '1', '22', '10101012', 150.00,
               $6)`,
      [admin.tenantId, guiaId, admin.encounterId, versionId, operadoraId,
       admin.userId]);

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

describe('rotas de guias TISS', () => {
  it('GET /v1/tiss/guias lista guias pendentes (sem lote)', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/guias?status=pendente', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ guiaId: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    expect(body.itens.some((g) => g.guiaId === guiaId)).toBe(true);
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('GET /v1/tiss/guias/:id detalhe da guia', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/guias/${guiaId}`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      guiaId: string; registroAns: string; codigoProcedimento: string;
      numeroGuiaPrestador: string;
    };
    expect(body.guiaId).toBe(guiaId);
    expect(body.registroAns).toBe('339679');
    expect(body.codigoProcedimento).toBe('10101012');
    expect(body.numeroGuiaPrestador).toBe('GP-00001');
    await app.close();
  });

  it('POST /v1/tiss/guias/:id/ajuste cria ajuste de faturamento', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/tiss/guias/${guiaId}/ajuste`, ...auth(admin),
      payload: {
        campoAlterado: 'valor_procedimento',
        valorAnterior: '150.00',
        valorNovo: '180.00',
        motivo: 'Adequacao a tabela da operadora',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { ajusteId: string };
    expect(body.ajusteId).toBeTruthy();
    await app.close();
  });

  it('medico le guias com tiss.guia.read mas nao ajusta', async () => {
    // medico tem tiss.guia.read mas nao tiss.guia.adjust
    // Nota: medico e de outro tenant, entao nao vera guias deste tenant
    // O teste de RBAC puro e que medico nao pode ajustar
    const medicoAdmin = await semearSessao({ role: 'profissional' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/guias', ...auth(medicoAdmin),
    });
    expect(r.statusCode).toBe(200);

    // Tentar ajustar — deve dar 403
    const r2 = await app.inject({
      method: 'POST', url: `/v1/tiss/guias/${guiaId}/ajuste`, ...auth(medicoAdmin),
      payload: {
        campoAlterado: 'valor_procedimento',
        valorAnterior: '150.00',
        valorNovo: '200.00',
        motivo: 'Tentativa proibida',
      },
    });
    expect(r2.statusCode).toBe(403);
    await app.close();
  });
});
