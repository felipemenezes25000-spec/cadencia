### Task 64: Rotas de guias TISS (listar pendentes, detalhe, ajustar)

**Arquivos**
- Criar: `apps/api/src/routes/tiss/guias.ts`
- Criar: `apps/api/src/routes/tiss/guias.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Escrever o teste de integracao:

```ts
// apps/api/src/routes/tiss/guias.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let medico: SementeSessao;
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
  medico = await semearSessao({ role: 'profissional' });

  // Semear dados necessarios para a guia
  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    operadoraId = uuidv7();
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, nome, registro_ans, cnpj, tiss_version, transport_mode, created_by)
       VALUES ($1, $2, 'Unimed Guia', '339679', '11111111000190', '3.05.00', 'arquivo', $3)`,
      [admin.tenantId, operadoraId, admin.userId]);

    // Criar encounter_version para FK
    versionId = uuidv7();
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

    // Criar a guia
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
               '339679', 'GP-00001', 'CART123', false,
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
        codigoTabela: '22',
        codigoProcedimento: '10101020',
        valorProcedimento: 180.00,
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
        codigoTabela: '22',
        codigoProcedimento: '10101020',
        valorProcedimento: 200.00,
        motivo: 'Tentativa proibida',
      },
    });
    expect(r2.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/guias.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/guias.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const GuiaResumoSchema = z.object({
  guiaId: z.string().uuid(),
  encounterId: z.string().uuid(),
  operadoraNome: z.string(),
  registroAns: z.string(),
  numeroGuiaPrestador: z.string(),
  numeroCarteira: z.string(),
  dataAtendimento: z.string(),
  codigoProcedimento: z.string(),
  valorProcedimento: z.number(),
  loteId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

const GuiaDetalheSchema = GuiaResumoSchema.extend({
  encounterVersionId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  atendimentoRn: z.boolean(),
  cnes: z.string(),
  conselhoProfissional: z.string(),
  numeroConselho: z.string(),
  ufConselho: z.string(),
  cbos: z.string(),
  indicacaoAcidente: z.string(),
  regimeAtendimento: z.string(),
  tipoConsulta: z.string(),
  codigoTabela: z.string(),
  observacao: z.string().nullable(),
  ajustes: z.array(z.object({
    ajusteId: z.string().uuid(),
    codigoTabela: z.string(),
    codigoProcedimento: z.string(),
    valorProcedimento: z.number(),
    motivo: z.string(),
    createdBy: z.string().uuid(),
    createdAt: z.string(),
  })),
});

export async function guiaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/tiss/guias — listar guias ─────────────────────────────────
  r.get('/v1/tiss/guias', {
    schema: {
      querystring: z.object({
        status: z.enum(['pendente', 'em_lote', 'enviada', 'todas']).optional(),
        operadoraId: z.string().uuid().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(GuiaResumoSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('tiss.guia.read', async (tx, _ctx, req) => {
    const q = req.query as {
      status?: string; operadoraId?: string;
      from?: string; to?: string;
      limit?: number; cursor?: string };
    const limite = q.limit ?? 50;
    const condicoes: string[] = ['g.live = true'];
    const params: unknown[] = [];
    let idx = 1;

    if (q.status === 'pendente') {
      condicoes.push('g.lote_id IS NULL');
    } else if (q.status === 'em_lote') {
      condicoes.push('g.lote_id IS NOT NULL');
      condicoes.push(`EXISTS (SELECT 1 FROM tiss.lote l
        WHERE l.tenant_id = g.tenant_id AND l.id = g.lote_id
          AND l.status = 'aberto')`);
    } else if (q.status === 'enviada') {
      condicoes.push('g.lote_id IS NOT NULL');
      condicoes.push(`EXISTS (SELECT 1 FROM tiss.lote l
        WHERE l.tenant_id = g.tenant_id AND l.id = g.lote_id
          AND l.status = 'enviado')`);
    }

    if (q.operadoraId !== undefined) {
      condicoes.push(`g.operadora_id = $${idx}`);
      params.push(q.operadoraId); idx += 1;
    }
    if (q.from !== undefined) {
      condicoes.push(`g.data_atendimento >= $${idx}::date`);
      params.push(q.from); idx += 1;
    }
    if (q.to !== undefined) {
      condicoes.push(`g.data_atendimento <= $${idx}::date`);
      params.push(q.to); idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`g.created_at < $${idx}`);
      params.push(q.cursor); idx += 1;
    }

    params.push(limite + 1);
    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      id: string; encounter_id: string; operadora_nome: string;
      registro_ans: string; numero_guia_prestador: string;
      numero_carteira: string; data_atendimento: string;
      codigo_procedimento: string; valor_procedimento: string;
      lote_id: string | null; created_at: string;
    }>(
      `SELECT g.id, g.encounter_id, o.nome AS operadora_nome,
              g.registro_ans, g.numero_guia_prestador, g.numero_carteira,
              g.data_atendimento::text,
              g.codigo_procedimento, g.valor_procedimento::text,
              g.lote_id,
              to_char(g.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.encounter_guia_consulta g
         JOIN tiss.operadora o
           ON o.tenant_id = g.tenant_id AND o.id = g.operadora_id
        WHERE ${where}
        ORDER BY g.data_atendimento DESC, g.created_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      guiaId: row.id,
      encounterId: row.encounter_id,
      operadoraNome: row.operadora_nome,
      registroAns: row.registro_ans,
      numeroGuiaPrestador: row.numero_guia_prestador,
      numeroCarteira: row.numero_carteira,
      dataAtendimento: row.data_atendimento,
      codigoProcedimento: row.codigo_procedimento,
      valorProcedimento: Number(row.valor_procedimento),
      loteId: row.lote_id,
      createdAt: row.created_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt
      : null;

    return { itens, nextCursor };
  }));

  // ── GET /v1/tiss/guias/:id — detalhe da guia ─────────────────────────
  r.get('/v1/tiss/guias/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: GuiaDetalheSchema },
    },
  }, rota('tiss.guia.read', async (tx, _ctx, req) => {
    const p = req.params as { id: string };

    const { rows } = await tx.query<{
      id: string; encounter_id: string; encounter_version_id: string;
      operadora_id: string; operadora_nome: string;
      registro_ans: string; numero_guia_prestador: string;
      numero_carteira: string; atendimento_rn: boolean;
      cnes: string; conselho_profissional: string;
      numero_conselho: string; uf_conselho: string; cbos: string;
      indicacao_acidente: string; regime_atendimento: string;
      data_atendimento: string; tipo_consulta: string;
      codigo_tabela: string; codigo_procedimento: string;
      valor_procedimento: string; observacao: string | null;
      lote_id: string | null; created_at: string;
    }>(
      `SELECT g.id, g.encounter_id, g.encounter_version_id,
              g.operadora_id, o.nome AS operadora_nome,
              g.registro_ans, g.numero_guia_prestador, g.numero_carteira,
              g.atendimento_rn, g.cnes,
              g.conselho_profissional, g.numero_conselho, g.uf_conselho, g.cbos,
              g.indicacao_acidente, g.regime_atendimento,
              g.data_atendimento::text, g.tipo_consulta,
              g.codigo_tabela, g.codigo_procedimento,
              g.valor_procedimento::text, g.observacao,
              g.lote_id,
              to_char(g.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.encounter_guia_consulta g
         JOIN tiss.operadora o
           ON o.tenant_id = g.tenant_id AND o.id = g.operadora_id
        WHERE g.id = $1 AND g.live = true`,
      [p.id]);

    if (rows.length === 0) erroDominio('guia_nao_encontrada', 404);
    const row = rows[0]!;

    // Buscar ajustes
    const { rows: ajusteRows } = await tx.query<{
      id: string; codigo_tabela: string; codigo_procedimento: string;
      valor_procedimento: string; motivo: string;
      created_by: string; created_at: string;
    }>(
      `SELECT id, codigo_tabela, codigo_procedimento,
              valor_procedimento::text, motivo, created_by::text,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.guia_ajuste
        WHERE guia_id = $1
        ORDER BY created_at DESC`,
      [p.id]);

    return {
      guiaId: row.id,
      encounterId: row.encounter_id,
      encounterVersionId: row.encounter_version_id,
      operadoraId: row.operadora_id,
      operadoraNome: row.operadora_nome,
      registroAns: row.registro_ans,
      numeroGuiaPrestador: row.numero_guia_prestador,
      numeroCarteira: row.numero_carteira,
      atendimentoRn: row.atendimento_rn,
      cnes: row.cnes,
      conselhoProfissional: row.conselho_profissional,
      numeroConselho: row.numero_conselho,
      ufConselho: row.uf_conselho,
      cbos: row.cbos,
      indicacaoAcidente: row.indicacao_acidente,
      regimeAtendimento: row.regime_atendimento,
      dataAtendimento: row.data_atendimento,
      tipoConsulta: row.tipo_consulta,
      codigoTabela: row.codigo_tabela,
      codigoProcedimento: row.codigo_procedimento,
      valorProcedimento: Number(row.valor_procedimento),
      observacao: row.observacao,
      loteId: row.lote_id,
      createdAt: row.created_at,
      ajustes: ajusteRows.map((a) => ({
        ajusteId: a.id,
        codigoTabela: a.codigo_tabela,
        codigoProcedimento: a.codigo_procedimento,
        valorProcedimento: Number(a.valor_procedimento),
        motivo: a.motivo,
        createdBy: a.created_by,
        createdAt: a.created_at,
      })),
    };
  }));

  // ── POST /v1/tiss/guias/:id/ajuste — criar ajuste de faturamento ──────
  r.post('/v1/tiss/guias/:id/ajuste', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        codigoTabela: z.string().regex(/^[0-9]{2}$/).refine((v) => v !== '18',
          { message: 'Tabela 18 e particular, nao entra em guia' }),
        codigoProcedimento: z.string().min(1).max(10),
        valorProcedimento: z.number().min(0),
        motivo: z.string().min(1).max(500),
      }),
      response: { 201: z.object({ ajusteId: z.string().uuid() }) },
    },
  }, rota('tiss.guia.adjust', async (tx, _ctx, req, reply) => {
    const p = req.params as { id: string };
    const b = req.body as {
      codigoTabela: string; codigoProcedimento: string;
      valorProcedimento: number; motivo: string };

    // Verificar que a guia existe e esta ativa
    const { rowCount } = await tx.query(
      `SELECT 1 FROM tiss.encounter_guia_consulta
        WHERE id = $1 AND live = true`,
      [p.id]);
    if (rowCount === 0) erroDominio('guia_nao_encontrada', 404);

    const ajusteId = uuidv7();
    await tx.query(
      `INSERT INTO tiss.guia_ajuste
         (id, guia_id, codigo_tabela, codigo_procedimento,
          valor_procedimento, motivo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, app.current_user_id())`,
      [ajusteId, p.id, b.codigoTabela, b.codigoProcedimento,
       b.valorProcedimento, b.motivo]);

    void reply.code(201);
    return { ajusteId };
  }));
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import:

```ts
import { guiaRoutes } from './routes/tiss/guias';
```

E registrar apos `await app.register(operadoraRoutes);`:

```ts
  await app.register(guiaRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/guias.int.test.ts
# ESPERADO: PASS — 4 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/guias.ts apps/api/src/routes/tiss/guias.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add TISS guia list/detail/adjust routes

GET /v1/tiss/guias (filter by status/operadora/date range),
GET /v1/tiss/guias/:id (detail with ajustes),
POST /v1/tiss/guias/:id/ajuste (billing adjustment).
RBAC: tiss.guia.read for list/detail, tiss.guia.adjust for adjustments.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---