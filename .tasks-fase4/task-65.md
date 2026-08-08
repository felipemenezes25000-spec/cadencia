### Task 65: Rotas de lotes TISS (criar, montar, enviar, listar, detalhe, cancelar, baixar XML)

**Arquivos**
- Criar: `apps/api/src/routes/tiss/lotes.ts`
- Criar: `apps/api/src/routes/tiss/lotes.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Escrever o teste de integracao:

```ts
// apps/api/src/routes/tiss/lotes.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let recep: SementeSessao;
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
  recep = await semearSessao({ role: 'recepcao' });
  medico = await semearSessao({ role: 'profissional' });

  // Semear operadora e guia no tenant do admin
  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, nome, registro_ans, cnpj, tiss_version, transport_mode, created_by)
       VALUES ($1, $2, 'Op Lote', '339679', '11111111000190', '3.05.00', 'arquivo', $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    const versionId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, kind, content, content_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               clock_timestamp(),
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               'original', '{}', '\\x00', $7)`,
      [admin.tenantId, versionId, admin.encounterId, admin.patientId,
       admin.professionalId, admin.clinicId, admin.userId]);

    guiaId = uuidv7();
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          cnes, conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, data_atendimento,
          tipo_consulta, codigo_tabela, codigo_procedimento, valor_procedimento,
          created_by)
       VALUES ($1, $2, $3, $4, $5,
               '339679', 'GPL-00001', 'CART456', false,
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
      payload: { operadoraId, descricao: 'Lote de testes' },
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
    expect(body.status).toBe('enviado');
    await app.close();
  });

  it('GET /v1/tiss/lotes/:id/xml baixa o XML do lote enviado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/lotes/${loteId}/xml`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/xml');
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('POST /v1/tiss/lotes/:id/cancelar cancela lote', async () => {
    // Criar um segundo lote para cancelar
    const app = await buildApp();
    const r1 = await app.inject({
      method: 'POST', url: '/v1/tiss/lotes', ...auth(admin),
      payload: { operadoraId, descricao: 'Lote para cancelar' },
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
      payload: { operadoraId, descricao: 'Lote proibido' },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/lotes.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/lotes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const LoteResumoSchema = z.object({
  loteId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  descricao: z.string(),
  status: z.string(),
  totalGuias: z.number().int(),
  valorTotalCentavos: z.number().int(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});

export async function loteRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/lotes — criar lote vazio ────────────────────────────
  r.post('/v1/tiss/lotes', {
    schema: {
      body: z.object({
        operadoraId: z.string().uuid(),
        descricao: z.string().min(1).max(500),
      }),
      response: { 201: z.object({ loteId: z.string().uuid() }) },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req, reply) => {
    const b = req.body as { operadoraId: string; descricao: string };
    const id = uuidv7();

    // Verificar que a operadora existe e esta ativa
    const { rowCount: opExiste } = await tx.query(
      `SELECT 1 FROM tiss.operadora WHERE id = $1 AND active = true`,
      [b.operadoraId]);
    if (opExiste === 0) erroDominio('operadora_nao_encontrada', 404);

    // Alocar numero sequencial do lote
    const { rows: counterRows } = await tx.query<{ consumed: string }>(
      `INSERT INTO tiss.lote_counter (tenant_id, next_value)
       VALUES (app.require_tenant_id(), 2)
       ON CONFLICT (tenant_id) DO UPDATE SET next_value = tiss.lote_counter.next_value + 1
       RETURNING next_value - 1 AS consumed`);
    const numeroLote = String(counterRows[0]!.consumed).padStart(12, '0');

    await tx.query(
      `INSERT INTO tiss.lote
         (id, operadora_id, descricao, numero_lote, status, created_by)
       VALUES ($1, $2, $3, $4, 'aberto', app.current_user_id())`,
      [id, b.operadoraId, b.descricao, numeroLote]);

    void reply.code(201);
    return { loteId: id };
  }));

  // ── POST /v1/tiss/lotes/:id/guias — adicionar guias ao lote ──────────
  r.post('/v1/tiss/lotes/:id/guias', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        guiaIds: z.array(z.string().uuid()).min(1).max(100),
      }),
      response: { 200: z.object({ adicionadas: z.number().int() }) },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { guiaIds: string[] };

    // Verificar que o lote existe e esta aberto
    const { rows: loteRows } = await tx.query<{ status: string; operadora_id: string }>(
      `SELECT status::text, operadora_id FROM tiss.lote WHERE id = $1`,
      [p.id]);
    if (loteRows.length === 0) erroDominio('lote_nao_encontrado', 404);
    if (loteRows[0]!.status !== 'aberto') erroDominio('lote_nao_aberto', 422);

    const operadoraId = loteRows[0]!.operadora_id;

    // Vincular guias ao lote (somente guias sem lote e da mesma operadora)
    const { rowCount } = await tx.query(
      `UPDATE tiss.encounter_guia_consulta
          SET lote_id = $1
        WHERE id = ANY($2::uuid[])
          AND lote_id IS NULL
          AND live = true
          AND operadora_id = $3`,
      [p.id, b.guiaIds, operadoraId]);

    return { adicionadas: rowCount ?? 0 };
  }));

  // ── DELETE /v1/tiss/lotes/:id/guias/:guiaId — remover guia do lote ────
  r.delete('/v1/tiss/lotes/:id/guias/:guiaId', {
    schema: {
      params: z.object({
        id: z.string().uuid(),
        guiaId: z.string().uuid(),
      }),
      response: { 200: z.object({ removida: z.boolean() }) },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string; guiaId: string };

    // Verificar que o lote esta aberto
    const { rows: loteRows } = await tx.query<{ status: string }>(
      `SELECT status::text FROM tiss.lote WHERE id = $1`, [p.id]);
    if (loteRows.length === 0) erroDominio('lote_nao_encontrado', 404);
    if (loteRows[0]!.status !== 'aberto') erroDominio('lote_nao_aberto', 422);

    const { rowCount } = await tx.query(
      `UPDATE tiss.encounter_guia_consulta
          SET lote_id = NULL
        WHERE id = $1 AND lote_id = $2`,
      [p.guiaId, p.id]);

    return { removida: (rowCount ?? 0) > 0 };
  }));

  // ── GET /v1/tiss/lotes — listar lotes ─────────────────────────────────
  r.get('/v1/tiss/lotes', {
    schema: {
      querystring: z.object({
        status: z.enum(['aberto', 'enviado', 'cancelado']).optional(),
        operadoraId: z.string().uuid().optional(),
      }),
      response: { 200: z.object({ itens: z.array(LoteResumoSchema) }) },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req) => {
    const q = req.query as { status?: string; operadoraId?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.status !== undefined) {
      condicoes.push(`l.status = $${idx}::tiss.lote_status`);
      params.push(q.status); idx += 1;
    }
    if (q.operadoraId !== undefined) {
      condicoes.push(`l.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      descricao: string; status: string;
      total_guias: string; valor_total: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT l.id, l.operadora_id, o.nome AS operadora_nome,
              l.descricao, l.status::text,
              coalesce(g.cnt, 0)::text AS total_guias,
              coalesce(g.soma, 0)::text AS valor_total,
              to_char(l.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(l.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.lote l
         JOIN tiss.operadora o
           ON o.tenant_id = l.tenant_id AND o.id = l.operadora_id
         LEFT JOIN LATERAL (
           SELECT count(*) AS cnt,
                  sum(valor_procedimento * 100)::bigint AS soma
             FROM tiss.encounter_guia_consulta gc
            WHERE gc.tenant_id = l.tenant_id AND gc.lote_id = l.id AND gc.live = true
         ) g ON true
         ${where}
        ORDER BY l.created_at DESC`,
      params);

    return {
      itens: rows.map((row) => ({
        loteId: row.id,
        operadoraId: row.operadora_id,
        operadoraNome: row.operadora_nome,
        descricao: row.descricao,
        status: row.status,
        totalGuias: Number(row.total_guias),
        valorTotalCentavos: Number(row.valor_total),
        createdAt: row.created_at,
        sentAt: row.sent_at,
      })),
    };
  }));

  // ── GET /v1/tiss/lotes/:id — detalhe do lote ─────────────────────────
  r.get('/v1/tiss/lotes/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: LoteResumoSchema.extend({
          numeroLote: z.string(),
          guias: z.array(z.object({
            guiaId: z.string().uuid(),
            numeroGuiaPrestador: z.string(),
            dataAtendimento: z.string(),
            codigoProcedimento: z.string(),
            valorProcedimento: z.number(),
          })),
        }),
      },
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; operadora_id: string; operadora_nome: string;
      descricao: string; status: string; numero_lote: string;
      created_at: string; sent_at: string | null;
    }>(
      `SELECT l.id, l.operadora_id, o.nome AS operadora_nome,
              l.descricao, l.status::text, l.numero_lote,
              to_char(l.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              to_char(l.sent_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sent_at
         FROM tiss.lote l
         JOIN tiss.operadora o
           ON o.tenant_id = l.tenant_id AND o.id = l.operadora_id
        WHERE l.id = $1`,
      [p.id]);

    if (rows.length === 0) erroDominio('lote_nao_encontrado', 404);
    const lote = rows[0]!;

    const { rows: guiaRows } = await tx.query<{
      id: string; numero_guia_prestador: string;
      data_atendimento: string; codigo_procedimento: string;
      valor_procedimento: string;
    }>(
      `SELECT id, numero_guia_prestador, data_atendimento::text,
              codigo_procedimento, valor_procedimento::text
         FROM tiss.encounter_guia_consulta
        WHERE lote_id = $1 AND live = true
        ORDER BY data_atendimento`,
      [p.id]);

    const totalGuias = guiaRows.length;
    const valorTotalCentavos = guiaRows.reduce(
      (acc, g) => acc + Math.round(Number(g.valor_procedimento) * 100), 0);

    return {
      loteId: lote.id,
      operadoraId: lote.operadora_id,
      operadoraNome: lote.operadora_nome,
      descricao: lote.descricao,
      status: lote.status,
      numeroLote: lote.numero_lote,
      totalGuias,
      valorTotalCentavos,
      createdAt: lote.created_at,
      sentAt: lote.sent_at,
      guias: guiaRows.map((g) => ({
        guiaId: g.id,
        numeroGuiaPrestador: g.numero_guia_prestador,
        dataAtendimento: g.data_atendimento,
        codigoProcedimento: g.codigo_procedimento,
        valorProcedimento: Number(g.valor_procedimento),
      })),
    };
  }));

  // ── POST /v1/tiss/lotes/:id/enviar — enviar lote ─────────────────────
  r.post('/v1/tiss/lotes/:id/enviar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          loteId: z.string().uuid(),
          status: z.literal('enviado'),
        }),
      },
    },
  }, rota('tiss.lote.send', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    // Verificar que o lote esta aberto e tem guias
    const { rows: loteRows } = await tx.query<{
      status: string; operadora_id: string; numero_lote: string;
    }>(
      `SELECT status::text, operadora_id, numero_lote
         FROM tiss.lote WHERE id = $1`, [p.id]);
    if (loteRows.length === 0) erroDominio('lote_nao_encontrado', 404);
    if (loteRows[0]!.status !== 'aberto') erroDominio('lote_nao_aberto', 422);

    const { rowCount: totalGuias } = await tx.query(
      `SELECT 1 FROM tiss.encounter_guia_consulta
        WHERE lote_id = $1 AND live = true`, [p.id]);
    if (totalGuias === 0) erroDominio('lote_sem_guias', 422);

    // Enfileirar no outbox para serializacao XML + transport
    await tx.query(
      `INSERT INTO app.outbox (event_type, aggregate_id, payload)
       VALUES ('tiss_lote_send', $1::uuid,
               jsonb_build_object(
                 'loteId', $2::text,
                 'operadoraId', $3::text,
                 'numeroLote', $4::text,
                 'clinicId', $5::text))`,
      [p.id, p.id, loteRows[0]!.operadora_id,
       loteRows[0]!.numero_lote, ctx.actor.clinicId]);

    // Marcar como enviado
    await tx.query(
      `UPDATE tiss.lote SET status = 'enviado', sent_at = clock_timestamp()
        WHERE id = $1`, [p.id]);

    // Registrar na auditoria
    await tx.query(
      `SELECT audit.log('TISS_LOTE_SEND', 'tiss', 'lote', $1, 'sucesso',
              jsonb_build_object('numero_lote', $2::text,
                                 'total_guias', $3::int), $4)`,
      [p.id, loteRows[0]!.numero_lote, totalGuias, ctx.actor.clinicId]);

    return { loteId: p.id, status: 'enviado' as const };
  }));

  // ── POST /v1/tiss/lotes/:id/cancelar — cancelar lote ─────────────────
  r.post('/v1/tiss/lotes/:id/cancelar', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: {
        200: z.object({
          loteId: z.string().uuid(),
          status: z.literal('cancelado'),
        }),
      },
    },
  }, rota('tiss.lote.manage', async (tx, ctx, req) => {
    const p = req.params as { id: string };

    const { rows: loteRows } = await tx.query<{ status: string }>(
      `SELECT status::text FROM tiss.lote WHERE id = $1`, [p.id]);
    if (loteRows.length === 0) erroDominio('lote_nao_encontrado', 404);
    if (loteRows[0]!.status === 'cancelado') erroDominio('lote_ja_cancelado', 422);

    // Liberar guias do lote
    await tx.query(
      `UPDATE tiss.encounter_guia_consulta SET lote_id = NULL
        WHERE lote_id = $1`, [p.id]);

    // Marcar como cancelado
    await tx.query(
      `UPDATE tiss.lote SET status = 'cancelado' WHERE id = $1`, [p.id]);

    // Registrar na auditoria
    await tx.query(
      `SELECT audit.log('TISS_LOTE_CANCEL', 'tiss', 'lote', $1, 'sucesso',
              jsonb_build_object('status_anterior', $2::text), $3)`,
      [p.id, loteRows[0]!.status, ctx.actor.clinicId]);

    return { loteId: p.id, status: 'cancelado' as const };
  }));

  // ── GET /v1/tiss/lotes/:id/xml — baixar XML do lote ───────────────────
  r.get('/v1/tiss/lotes/:id/xml', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
  }, rota('tiss.lote.manage', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      status: string; xml_content: Buffer | null; numero_lote: string;
    }>(
      `SELECT status::text, xml_content, numero_lote
         FROM tiss.lote WHERE id = $1`, [p.id]);
    if (rows.length === 0) erroDominio('lote_nao_encontrado', 404);
    if (rows[0]!.xml_content === null) erroDominio('xml_nao_disponivel', 404);

    void reply.header('content-type', 'application/xml; charset=ISO-8859-1');
    void reply.header('content-disposition',
      `attachment; filename="lote-${rows[0]!.numero_lote}.xml"`);
    void reply.header('cache-control', 'no-store');
    return rows[0]!.xml_content;
  }));
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import:

```ts
import { loteRoutes } from './routes/tiss/lotes';
```

E registrar apos `await app.register(guiaRoutes);`:

```ts
  await app.register(loteRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/lotes.int.test.ts
# ESPERADO: PASS — 9 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/lotes.ts apps/api/src/routes/tiss/lotes.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add TISS lote CRUD and send routes

POST /v1/tiss/lotes (create), POST /:id/guias (add),
DELETE /:id/guias/:guiaId (remove), GET /v1/tiss/lotes (list),
GET /:id (detail), POST /:id/enviar (send via outbox),
POST /:id/cancelar (cancel), GET /:id/xml (download).
RBAC: tiss.lote.manage for CRUD, tiss.lote.send for send.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---