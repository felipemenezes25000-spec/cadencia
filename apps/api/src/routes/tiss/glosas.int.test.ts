// apps/api/src/routes/tiss/glosas.int.test.ts
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
let demoId: string;
let glosaId: string;

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
       VALUES ($1, $2, '339679', 'Op Glosa', '11111111000190', '3.05',
               'arquivo', true, $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    // encounter_version (FK para tiss.glosa)
    const versionId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               decode(repeat('00', 32), 'hex'), 'test-v1')`,
      [admin.tenantId, versionId, admin.encounterId,
       admin.userId, admin.professionalId]);

    // encounter_guia_consulta (FK para tiss.glosa)
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
               '339679', 'GP-GL-001', 'CART123', false,
               '00000001',
               '2077502', '06', '999888', 'SP', '225125',
               '9', '01',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               '1', '22', '10101012', 150.00,
               $6)`,
      [admin.tenantId, guiaId, admin.encounterId, versionId, operadoraId,
       admin.userId]);

    // demonstrativo
    demoId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, 'PROTO-GLOSA', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               'tiss/demo/glosa-test.xml',
               30000, 15000, 0, 15000, $4)`,
      [admin.tenantId, demoId, operadoraId, admin.userId]);

    // demonstrativo_item (glosado)
    const demoItemId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, 'GP-GL-001',
               15000, 0, 0, 15000,
               '1005', 'Procedimento nao autorizado')`,
      [admin.tenantId, demoItemId, demoId]);

    // demonstrativo_item (pago, sem glosa)
    const demoItemPagoId = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents)
       VALUES ($1, $2, $3, 'GP-GL-002',
               15000, 15000, 15000, 0)`,
      [admin.tenantId, demoItemPagoId, demoId]);

    // tiss.glosa (pendente) — entidade real de glosa
    glosaId = uuidv7();
    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id,
          encounter_version_id, codigo_glosa, descricao_glosa,
          valor_glosado_cents, status)
       VALUES ($1, $2, $3, $4, $5,
               '1005', 'Procedimento nao autorizado',
               15000, 'pendente')`,
      [admin.tenantId, glosaId, demoItemId, guiaId, versionId]);

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

describe('rotas de glosas TISS', () => {
  it('GET /v1/tiss/glosas lista glosas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      itens: Array<{ glosaId: string; status: string }>;
      nextCursor: string | null;
    };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    const ids = body.itens.map((i) => i.glosaId);
    expect(ids).toContain(glosaId);
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('GET /v1/tiss/glosas filtra por operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas?operadoraId=${operadoraId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ glosaId: string }> };
    expect(body.itens.some((i) => i.glosaId === glosaId)).toBe(true);
    await app.close();
  });

  it('GET /v1/tiss/glosas filtra por status pendente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/tiss/glosas?status=pendente',
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ status: string }> };
    for (const item of body.itens) {
      expect(item.status).toBe('pendente');
    }
    await app.close();
  });

  it('GET /v1/tiss/glosas/:id detalhe da glosa', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas/${glosaId}`,
      ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      glosaId: string; codigoGlosa: string;
      descricaoGlosa: string; valorGlosadoCents: number;
    };
    expect(body.glosaId).toBe(glosaId);
    expect(body.codigoGlosa).toBe('1005');
    expect(body.descricaoGlosa).toBe('Procedimento nao autorizado');
    expect(body.valorGlosadoCents).toBe(15000);
    await app.close();
  });

  it('POST /v1/tiss/glosas/:id/aceitar aceita glosa individual', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/tiss/glosas/${glosaId}/aceitar`,
      ...auth(admin),
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { glosaId: string; status: string };
    expect(body.glosaId).toBe(glosaId);
    expect(body.status).toBe('aceita');
    await app.close();
  });

  it('recepcao le glosas mas nao pode aceitar', async () => {
    const app = await buildApp();
    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(recepcao),
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/tiss/glosas/${glosaId}/aceitar`,
      ...auth(recepcao),
      payload: {},
    });
    expect(r2.statusCode).toBe(403);
    await app.close();
  });

  it('medico recebe 403 ao tentar listar glosas', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(medico),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('a lista precisa carregar o que o RECURSO exige', () => {
  it('devolve descricao, paciente e encounterVersionId', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(admin) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      glosaId: string; descricaoGlosa: string | null;
      pacienteNome: string; encounterVersionId: string | null }[] }).itens;
    expect(itens.length).toBeGreaterThan(0);

    // Sem `encounterVersionId` não dá para abrir recurso: `POST /v1/tiss/recursos`
    // exige a versão do atendimento. A tela teria a glosa na mão e nada com que
    // recorrer — e glosa não recorrida no prazo vira perda definitiva.
    expect(itens[0]).toHaveProperty('encounterVersionId');
    // Código sozinho ("1707") não diz nada a quem redige a justificativa.
    expect(itens[0]).toHaveProperty('descricaoGlosa');
    // O nome do paciente é como o faturista confere se a glosa é daquele caso.
    expect(itens[0]?.pacienteNome).toBeTruthy();

    await app.close();
  });
});
