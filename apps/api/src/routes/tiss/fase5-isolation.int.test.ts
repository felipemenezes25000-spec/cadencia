// apps/api/src/routes/tiss/fase5-isolation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let a: SementeSessao;
let b: SementeSessao;
let operadoraIdA: string;
let demoIdA: string;
let glosaIdA: string;
let recursoIdA: string;
let versionIdA: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  a = await semearSessao({ role: 'admin_clinico', comMfa: true });
  b = await semearSessao({ role: 'admin_clinico', comMfa: true });

  // Semear dados completos no tenant A
  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version,
          transport_mode, created_by)
       VALUES ($1, $2, '339679', 'Op Iso5 A', '11111111000190', '3.05',
               'arquivo', $3)`,
      [a.tenantId, operadoraIdA, a.userId]);

    // Encounter version — prerequisito para guia, glosa e recurso
    versionIdA = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original',
               $4, $5,
               decode(repeat('00', 32), 'hex'), 'v1')`,
      [a.tenantId, versionIdA, a.encounterId, a.userId, a.professionalId]);

    // Guia — prerequisito para glosa
    const guiaIdA = uuidv7();
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
               '339679', 'GP-ISO5-001', 'CART-ISO5', false,
               '00000000000001',
               '2077502', '06', '999888', 'SP', '225125',
               '9', '01',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               '1', '22', '10101012', 150.00,
               $6)`,
      [a.tenantId, guiaIdA, a.encounterId, versionIdA, operadoraIdA,
       a.userId]);

    // Demonstrativo — colunas reais: protocolo_operadora, kind, data_processamento,
    // total_apresentado_cents, total_liberado_cents, xml_storage_key
    demoIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo
         (tenant_id, id, operadora_id, protocolo_operadora, kind,
          data_processamento, xml_storage_key,
          total_apresentado_cents, total_processado_cents,
          total_liberado_cents, total_glosa_cents, imported_by)
       VALUES ($1, $2, $3, 'PROTO-ISO5', 'analise',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               'tiss/demonstrativo/iso5-test.xml',
               10000, 5000, 0, 5000, $4)`,
      [a.tenantId, demoIdA, operadoraIdA, a.userId]);

    // Demonstrativo item — colunas reais: valor_apresentado_cents, valor_liberado_cents,
    // glosa_codigo, glosa_descricao (sem status/aceite)
    const demoItemIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.demonstrativo_item
         (tenant_id, id, demonstrativo_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, 'GP-ISO5-001',
               10000, 5000, 0, 5000,
               '1005', 'Procedimento nao autorizado')`,
      [a.tenantId, demoItemIdA, demoIdA]);

    // Glosa — vincula demonstrativo_item, guia e encounter_version
    glosaIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.glosa
         (tenant_id, id, demonstrativo_item_id, guia_id,
          encounter_version_id, codigo_glosa, descricao_glosa,
          valor_glosado_cents, status)
       VALUES ($1, $2, $3, $4, $5, '1005',
               'Procedimento nao autorizado', 5000, 'pendente')`,
      [a.tenantId, glosaIdA, demoItemIdA, guiaIdA, versionIdA]);

    // Recurso de glosa — colunas reais: numero_recurso, encounter_version_id
    recursoIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.recurso_glosa
         (tenant_id, id, operadora_id, numero_recurso, status,
          encounter_version_id, item_count, total_recursado_cents, created_by)
       VALUES ($1, $2, $3, 'REC-ISO5-001', 'rascunho',
               $4, 0, 0, $5)`,
      [a.tenantId, recursoIdA, operadoraIdA, versionIdA, a.userId]);

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

describe('isolamento multi-tenant — rotas TISS Fase 5', () => {
  it('demonstrativos do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as {
      itens: Array<{ demonstrativoId: string }>;
    }).itens.map((i) => i.demonstrativoId);
    expect(ids).not.toContain(demoIdA);
    await app.close();
  });

  it('glosas do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as {
      itens: Array<{ glosaId: string }>;
    }).itens.map((i) => i.glosaId);
    expect(ids).not.toContain(glosaIdA);
    await app.close();
  });

  it('recursos do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/recursos', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as {
      itens: Array<{ recursoId: string }>;
    }).itens.map((i) => i.recursoId);
    expect(ids).not.toContain(recursoIdA);
    await app.close();
  });

  it('detalhe de demonstrativo de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/demonstrativos/${demoIdA}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('detalhe de glosa de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/glosas/${glosaIdA}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('detalhe de recurso de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/recursos/${recursoIdA}`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('trocar x-clinic-id para unidade de outro tenant devolve 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos',
      cookies: {
        '__Host-cadencia_sid': a.token,
        '__Host-cadencia_csrf': a.csrf,
      },
      headers: {
        'x-clinic-id': b.clinicId,
        'x-csrf-token': a.csrf,
      },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });

  it('toda resposta Fase 5 TISS tem cache-control: no-store', async () => {
    const app = await buildApp();
    const rotas = [
      { method: 'GET' as const, url: '/v1/tiss/demonstrativos' },
      { method: 'GET' as const, url: '/v1/tiss/glosas' },
      { method: 'GET' as const, url: '/v1/tiss/recursos' },
    ];

    for (const rota of rotas) {
      const r = await app.inject({ ...rota, ...auth(a) });
      expect(r.headers['cache-control']).toBe('no-store');
    }
    await app.close();
  });

  it('medico (profissional) nao acessa demonstrativos, glosas nem recursos', async () => {
    const medicoLocal = await semearSessao({ role: 'profissional' });
    const app = await buildApp();

    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(medicoLocal),
    });
    expect(r1.statusCode).toBe(403);

    const r2 = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(medicoLocal),
    });
    expect(r2.statusCode).toBe(403);

    const r3 = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(medicoLocal),
      payload: {
        operadoraId: operadoraIdA,
        encounterVersionId: versionIdA,
      },
    });
    expect(r3.statusCode).toBe(403);

    await app.close();
  });

  it('recepcao le demonstrativos e glosas mas nao importa, aceita nem cria recurso', async () => {
    const recLocal = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();

    // Pode ler demonstrativos
    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/demonstrativos', ...auth(recLocal),
    });
    expect(r1.statusCode).toBe(200);

    // Pode ler glosas
    const r2 = await app.inject({
      method: 'GET', url: '/v1/tiss/glosas', ...auth(recLocal),
    });
    expect(r2.statusCode).toBe(200);

    // Nao pode aceitar glosa
    const r3 = await app.inject({
      method: 'POST',
      url: `/v1/tiss/glosas/${glosaIdA}/aceitar`,
      ...auth(recLocal),
      payload: {},
    });
    expect(r3.statusCode).toBe(403);

    // Nao pode criar recurso
    const r4 = await app.inject({
      method: 'POST', url: '/v1/tiss/recursos', ...auth(recLocal),
      payload: {
        operadoraId: operadoraIdA,
        encounterVersionId: versionIdA,
        justificativaGeral: 'Proibido',
      },
    });
    expect(r4.statusCode).toBe(403);

    await app.close();
  });
});
