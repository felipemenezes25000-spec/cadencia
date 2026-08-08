// apps/api/src/routes/tiss/fase4-isolation.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let a: SementeSessao;
let b: SementeSessao;
let operadoraIdA: string;
let guiaIdA: string;
let loteIdA: string;
let convenioIdA: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  a = await semearSessao({ role: 'admin_clinico', comMfa: true });
  b = await semearSessao({ role: 'admin_clinico', comMfa: true });

  // Semear dados TISS no tenant A
  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, razao_social, registro_ans, cnpj, tiss_version, transport_mode, created_by)
       VALUES ($1, $2, 'Op Iso A', '339679', '11111111000190', '3.05', 'arquivo', $3)`,
      [a.tenantId, operadoraIdA, a.userId]);

    const versionId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original',
               $4, $5,
               decode(repeat('00', 32), 'hex'), 'v1')`,
      [a.tenantId, versionId, a.encounterId, a.userId, a.professionalId]);

    guiaIdA = uuidv7();
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
               '339679', 'ISO-00001', 'CART-ISO', false,
               '00000000000001',
               '2077502', '06', '999888', 'SP', '225125',
               '9', '01',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               '1', '22', '10101012', 150.00,
               $6)`,
      [a.tenantId, guiaIdA, a.encounterId, versionId, operadoraIdA,
       a.userId]);

    loteIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote_number_counter (tenant_id, operadora_id, next_value)
       VALUES ($1, $2, 2)
       ON CONFLICT (tenant_id, operadora_id) DO NOTHING`,
      [a.tenantId, operadoraIdA]);
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, created_by)
       VALUES ($1, $2, $3, '000000000001', 'rascunho', '3.05', 0, 0, $4)`,
      [a.tenantId, loteIdA, operadoraIdA, a.userId]);

    convenioIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira, created_by)
       VALUES ($1, $2, $3, $4, 'CONV-ISO-123', $5)`,
      [a.tenantId, convenioIdA, a.patientId, operadoraIdA, a.userId]);

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

describe('isolamento multi-tenant — rotas TISS (Fase 4)', () => {
  it('operadoras do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/operadoras', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ operadoraId: string }> })
      .itens.map((i) => i.operadoraId);
    expect(ids).not.toContain(operadoraIdA);
    await app.close();
  });

  it('guias do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/guias', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ guiaId: string }> })
      .itens.map((i) => i.guiaId);
    expect(ids).not.toContain(guiaIdA);
    await app.close();
  });

  it('lotes do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/lotes', ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ loteId: string }> })
      .itens.map((i) => i.loteId);
    expect(ids).not.toContain(loteIdA);
    await app.close();
  });

  it('convenios do paciente A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    // Tenant B tenta listar convenios do paciente de A — retorna vazio por RLS
    const r = await app.inject({
      method: 'GET',
      url: `/v1/tiss/pacientes/${a.patientId}/convenios`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ convenioId: string }> })
      .itens.map((i) => i.convenioId);
    expect(ids).not.toContain(convenioIdA);
    await app.close();
  });

  it('detalhe de operadora de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/operadoras/${operadoraIdA}`, ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('detalhe de guia de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/guias/${guiaIdA}`, ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('detalhe de lote de outro tenant retorna 404', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/lotes/${loteIdA}`, ...auth(b),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('trocar x-clinic-id para unidade de outro tenant devolve 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/operadoras',
      cookies: { '__Host-cadencia_sid': a.token, '__Host-cadencia_csrf': a.csrf },
      headers: { 'x-clinic-id': b.clinicId, 'x-csrf-token': a.csrf },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });

  it('toda resposta TISS tem cache-control: no-store', async () => {
    const app = await buildApp();
    const rotas = [
      { method: 'GET' as const, url: '/v1/tiss/operadoras' },
      { method: 'GET' as const, url: '/v1/tiss/guias' },
      { method: 'GET' as const, url: '/v1/tiss/lotes' },
    ];

    for (const rota of rotas) {
      const r = await app.inject({ ...rota, ...auth(a) });
      expect(r.headers['cache-control']).toBe('no-store');
    }
    await app.close();
  });

  it('medico (profissional) ve guias mas nao cria operadora nem lote', async () => {
    const medicoLocal = await semearSessao({ role: 'profissional' });
    const app = await buildApp();

    // Pode ler guias
    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/guias', ...auth(medicoLocal),
    });
    expect(r1.statusCode).toBe(200);

    // Nao pode criar operadora
    const r2 = await app.inject({
      method: 'POST', url: '/v1/tiss/operadoras', ...auth(medicoLocal),
      payload: {
        nome: 'Proibida', registroAns: '111111',
        cnpj: 'A1B2C3D4E5F601', tissVersion: '3.05',
        transportMode: 'arquivo',
      },
    });
    expect(r2.statusCode).toBe(403);

    // Nao pode criar lote
    const r3 = await app.inject({
      method: 'POST', url: '/v1/tiss/lotes', ...auth(medicoLocal),
      payload: { operadoraId: operadoraIdA },
    });
    expect(r3.statusCode).toBe(403);

    await app.close();
  });

  it('recepcao pode gerenciar lotes mas nao pode enviar', async () => {
    const recepLocal = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();

    // Pode listar lotes (tiss.lote.manage)
    const r1 = await app.inject({
      method: 'GET', url: '/v1/tiss/lotes', ...auth(recepLocal),
    });
    expect(r1.statusCode).toBe(200);

    // Nao pode enviar lote (tiss.lote.send exige admin_clinico ou financeiro)
    const r2 = await app.inject({
      method: 'POST', url: `/v1/tiss/lotes/${loteIdA}/enviar`, ...auth(recepLocal),
    });
    expect(r2.statusCode).toBe(403);

    await app.close();
  });
});
