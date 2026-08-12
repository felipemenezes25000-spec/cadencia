// apps/api/src/routes/tiss/lotes.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let medico: SementeSessao;
let operadoraId: string;
let guiaId: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  medico = await semearSessao({ role: 'profissional' });

  // Semear operadora e guia no tenant do admin
  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, transport_mode, active, created_by)
       VALUES ($1, $2, '339679', 'Op Lote', '11111111000190', '3.05', 'arquivo', true, $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    const versionId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind,
          author_user_id, author_professional_id,
          content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               sha256('lote-test-seed'::bytea), 'test-v1')`,
      [admin.tenantId, versionId, admin.encounterId,
       admin.userId, admin.professionalId]);

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
               '339679', 'GPL-00001', 'CART456', false,
               '900123',
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

describe('rotas de lotes TISS', () => {
  let loteId: string;

  it('POST /v1/tiss/lotes cria lote vazio', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/lotes', ...auth(admin),
      payload: { operadoraId },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { loteId: string };
    expect(body.loteId).toBeTruthy();
    loteId = body.loteId;
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('POST /v1/tiss/lotes/:id/guias adiciona guia ao lote', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/tiss/lotes/${loteId}/guias`, ...auth(admin),
      payload: { guiaIds: [guiaId] },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { adicionadas: number };
    expect(body.adicionadas).toBe(1);
    await app.close();
  });

  it('GET /v1/tiss/lotes lista lotes do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/lotes', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ loteId: string; totalGuias: number }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    const lote = body.itens.find((l) => l.loteId === loteId);
    expect(lote).toBeDefined();
    expect(lote!.totalGuias).toBe(1);
    await app.close();
  });

  it('GET /v1/tiss/lotes/:id detalhe do lote com guias', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/lotes/${loteId}`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { loteId: string; guias: Array<{ guiaId: string }> };
    expect(body.loteId).toBe(loteId);
    expect(body.guias.length).toBe(1);
    expect(body.guias[0]!.guiaId).toBe(guiaId);
    await app.close();
  });

  it('DELETE /v1/tiss/lotes/:id/guias/:guiaId remove guia do lote', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE', url: `/v1/tiss/lotes/${loteId}/guias/${guiaId}`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { removida: boolean }).removida).toBe(true);

    // Re-adicionar para os testes seguintes
    await app.inject({
      method: 'POST', url: `/v1/tiss/lotes/${loteId}/guias`, ...auth(admin),
      payload: { guiaIds: [guiaId] },
    });
    await app.close();
  });

  it('POST /v1/tiss/lotes/:id/enviar dispara serializacao e transport', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: `/v1/tiss/lotes/${loteId}/enviar`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { loteId: string; status: string };
    expect(body.status).toBe('pronto');
    await app.close();
  });

  it('GET /v1/tiss/lotes/:id/xml serializa as guias do lote sob demanda', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/lotes/${loteId}/xml`, ...auth(admin),
    });
    // Antes esta rota devolvia `<lote>0001</lote>` e o teste afirmava 404 "até
    // o worker gerar". Não há worker: o XML é serializado a partir das guias na
    // hora, porque enquanto o lote é rascunho as guias ainda podem mudar e um
    // arquivo congelado antes disso descreveria um lote que não existe mais.
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('ISO-8859-1');
    expect(r.headers['cache-control']).toBe('no-store');

    const texto = r.rawPayload.toString('latin1');
    expect(texto).toContain('<?xml version="1.0" encoding="ISO-8859-1"?>');
    expect(texto).toContain('<ans:tipoTransacao>ENVIO_LOTE_GUIAS</ans:tipoTransacao>');
    expect(texto).toContain('<ans:guiasTISS>');
    await app.close();
  });

  it('GET .../xml recusa lote vazio em vez de entregar envelope sem guia', async () => {
    const app = await buildApp();
    const criado = await app.inject({
      method: 'POST', url: '/v1/tiss/lotes', ...auth(admin),
      payload: { operadoraId },
    });
    const vazioId = (criado.json() as { loteId: string }).loteId;

    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/lotes/${vazioId}/xml`, ...auth(admin),
    });
    // Lote vazio é ACEITO pela operadora e não paga nada: parece sucesso até o
    // demonstrativo chegar zerado semanas depois.
    expect(r.statusCode).toBe(422);
    expect((r.json() as { erro: string }).erro).toBe('lote_sem_guias');
    await app.close();
  });

  it('POST /v1/tiss/lotes/:id/cancelar cancela lote', async () => {
    // Criar um segundo lote para cancelar
    const app = await buildApp();
    const r1 = await app.inject({
      method: 'POST', url: '/v1/tiss/lotes', ...auth(admin),
      payload: { operadoraId },
    });
    const lote2 = (r1.json() as { loteId: string }).loteId;

    const r = await app.inject({
      method: 'POST', url: `/v1/tiss/lotes/${lote2}/cancelar`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { status: string }).status).toBe('cancelado');
    await app.close();
  });

  it('medico recebe 403 ao tentar criar lote', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/lotes', ...auth(medico),
      payload: { operadoraId, },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
