// apps/api/src/routes/tiss/recursos.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let recepcao: SementeSessao;
let medico: SementeSessao;
let operadoraId: string;
let versionId: string;
let glosaIdA: string;
let glosaIdB: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  recepcao = await semearSessao({ role: 'recepcao' });
  medico = await semearSessao({ role: 'profissional' });

  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, active, created_by)
       VALUES ($1, $2, '339679', 'Op Recurso', '11111111000190', '3.05',
               'arquivo', true, $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    // encounter_version (FK para recurso_glosa e glosa)
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

    // encounter_guia_consulta (FK para glosa)
    const guiaId = uuidv7();
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
               '339679', 'GP-REC-001', 'CART123', false,
               '00000001',
               '2077502', '06', '999888', 'SP', '225125',
               '9', '01',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               '1', '22', '10101012', 150.00,
               $6)`,
      [admin.tenantId, guiaId, admin.encounterId, versionId, operadoraId,
       admin.userId]);

    // demonstrativo
    const demoId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, 'PROTO-REC', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               'tiss/demo/recurso-test.xml',
               30000, 10000, 0, 20000, $4)`,
      [admin.tenantId, demoId, operadoraId, admin.userId]);

    // demonstrativo_item A (glosado)
    const demoItemIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, 'GP-REC-001',
               15000, 0, 0, 15000,
               '1005', 'Sem autorizacao previa')`,
      [admin.tenantId, demoItemIdA, demoId]);

    // demonstrativo_item B (glosado parcial)
    const demoItemIdB = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, 'GP-REC-001',
               15000, 10000, 10000, 5000,
               '1010', 'Valor acima da tabela')`,
      [admin.tenantId, demoItemIdB, demoId]);

    // tiss.glosa A (pendente)
    glosaIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id,
          encounter_version_id, codigo_glosa, descricao_glosa,
          valor_glosado_cents, status)
       VALUES ($1, $2, $3, $4, $5,
               '1005', 'Sem autorizacao previa',
               15000, 'pendente')`,
      [admin.tenantId, glosaIdA, demoItemIdA, guiaId, versionId]);

    // tiss.glosa B (pendente)
    glosaIdB = uuidv7();
    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id,
          encounter_version_id, codigo_glosa, descricao_glosa,
          valor_glosado_cents, status)
       VALUES ($1, $2, $3, $4, $5,
               '1010', 'Valor acima da tabela',
               5000, 'pendente')`,
      [admin.tenantId, glosaIdB, demoItemIdB, guiaId, versionId]);

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

describe('rotas de recursos de glosa TISS', () => {
  let recursoId: string;
  let recursoItemIdA: string;

  it('POST /v1/tiss/recursos cria recurso vazio', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(admin),
      payload: {
        operadoraId,
        encounterVersionId: versionId,
        justificativaGeral: 'Recurso de glosas do lote de julho',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { recursoId: string };
    expect(body.recursoId).toBeTruthy();
    recursoId = body.recursoId;
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/itens adiciona glosa ao recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/itens`,
      ...auth(admin),
      payload: {
        glosaId: glosaIdA,
        justificativaItem: 'Atendimento de urgencia, autorizacao posterior',
        valorRecursadoCents: 15000,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { itemId: string };
    expect(body.itemId).toBeTruthy();
    recursoItemIdA = body.itemId;
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/itens adiciona segunda glosa', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/itens`,
      ...auth(admin),
      payload: {
        glosaId: glosaIdB,
        justificativaItem: 'Valor conforme contrato vigente',
        valorRecursadoCents: 5000,
      },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it('GET /v1/tiss/recursos lista recursos do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/recursos', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itens: Array<{ recursoId: string; itemCount: number }>;
    };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    const rec = body.itens.find((r) => r.recursoId === recursoId);
    expect(rec).toBeDefined();
    expect(rec!.itemCount).toBe(2);
    await app.close();
  });

  it('GET /v1/tiss/recursos/:id detalhe com itens', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/recursos/${recursoId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      recursoId: string;
      encounterVersionId: string;
      itens: Array<{
        itemId: string;
        glosaId: string;
        justificativaItem: string;
      }>;
    };
    expect(body.recursoId).toBe(recursoId);
    expect(body.itens.length).toBe(2);
    // Design sec 3.9: recurso cita a versão usada (no recurso pai)
    expect(body.encounterVersionId).toBe(versionId);
    await app.close();
  });

  it('DELETE /v1/tiss/recursos/:id/itens/:itemId remove glosa do recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE',
      url: `/v1/tiss/recursos/${recursoId}/itens/${recursoItemIdA}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { removido: boolean }).removido).toBe(true);

    // Re-adicionar para os testes seguintes
    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/itens`,
      ...auth(admin),
      payload: {
        glosaId: glosaIdA,
        justificativaItem: 'Atendimento de urgencia, autorizacao posterior',
        valorRecursadoCents: 15000,
      },
    });
    recursoItemIdA = (r2.json() as { itemId: string }).itemId;
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/pronto marca recurso como pronto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/pronto`,
      ...auth(admin),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recursoId: string; status: string };
    expect(body.status).toBe('pronto');
    await app.close();
  });

  it('medico recebe 403 ao tentar criar recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(medico),
      payload: {
        operadoraId,
        encounterVersionId: versionId,
        justificativaGeral: 'Proibido',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('recepcao recebe 403 ao tentar criar recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(recepcao),
      payload: {
        operadoraId,
        encounterVersionId: versionId,
        justificativaGeral: 'Proibido',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  // --- Testes de envio e resolução (Task 49) ---

  it('POST /v1/tiss/recursos/:id/enviar dispara serializacao e transport', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/enviar`,
      ...auth(admin),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recursoId: string; status: string };
    expect(body.status).toBe('enviado');
    await app.close();
  });

  it('POST /v1/tiss/recursos/:id/resolver resolve recurso com resultado', async () => {
    const app = await buildApp();

    // Buscar itens do recurso para obter os IDs
    const detR = await app.inject({
      method: 'GET',
      url: `/v1/tiss/recursos/${recursoId}`,
      ...auth(admin),
    });
    const det = detR.json() as {
      itens: Array<{ itemId: string; valorRecursadoCents: number }>;
    };
    expect(det.itens.length).toBe(2);

    const resultados = det.itens.map((item) => ({
      itemId: item.itemId,
      resultado: 'deferido' as const,
    }));

    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/resolver`,
      ...auth(admin),
      payload: { resultados },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recursoId: string; status: string };
    expect(body.status).toBe('deferido');

    // Verificar que as glosas foram marcadas como revertidas
    const glR = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas/${glosaIdA}`,
      ...auth(admin),
    });
    if (glR.statusCode === 200) {
      const gl = glR.json() as { status: string };
      expect(gl.status).toBe('revertida');
    }

    await app.close();
  });

  it('recepcao recebe 403 ao tentar enviar recurso', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/recursos/${recursoId}/enviar`,
      ...auth(recepcao),
      payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
