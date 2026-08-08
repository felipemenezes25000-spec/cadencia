### Task 63: Rotas de operadoras TISS (CRUD) e registro no app

**Arquivos**
- Criar: `apps/api/src/routes/tiss/operadoras.ts`
- Criar: `apps/api/src/routes/tiss/operadoras.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Escrever o teste de integracao:

```ts
// apps/api/src/routes/tiss/operadoras.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let admin: SementeSessao;
let medico: SementeSessao;

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  medico = await semearSessao({ role: 'profissional' });
});
afterAll(async () => { await closePools(); });

describe('rotas de operadoras TISS', () => {
  let operadoraId: string;

  it('POST /v1/tiss/operadoras cria operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/operadoras', ...auth(admin),
      payload: {
        nome: 'Unimed Teste',
        registroAns: '339679',
        cnpj: 'A1B2C3D4E5F601',
        tissVersion: '3.05.00',
        transportMode: 'arquivo',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { operadoraId: string };
    expect(body.operadoraId).toBeTruthy();
    operadoraId = body.operadoraId;
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('GET /v1/tiss/operadoras lista operadoras do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/tiss/operadoras', ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ operadoraId: string; nome: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    expect(body.itens.some((o) => o.operadoraId === operadoraId)).toBe(true);
    await app.close();
  });

  it('GET /v1/tiss/operadoras/:id detalhe da operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/tiss/operadoras/${operadoraId}`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { operadoraId: string; nome: string; registroAns: string };
    expect(body.nome).toBe('Unimed Teste');
    expect(body.registroAns).toBe('339679');
    await app.close();
  });

  it('PUT /v1/tiss/operadoras atualiza operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/tiss/operadoras', ...auth(admin),
      payload: { operadoraId, nome: 'Unimed Atualizada' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { operadoraId: string };
    expect(body.operadoraId).toBe(operadoraId);
    await app.close();
  });

  it('medico recebe 403 ao tentar criar operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/operadoras', ...auth(medico),
      payload: {
        nome: 'Operadora Proibida',
        registroAns: '111111',
        cnpj: 'X1Y2Z3W4V5U601',
        tissVersion: '3.05.00',
        transportMode: 'arquivo',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('DELETE /v1/tiss/operadoras/:id desativa operadora', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE', url: `/v1/tiss/operadoras/${operadoraId}`, ...auth(admin),
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { operadoraId: string }).operadoraId).toBe(operadoraId);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/operadoras.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/operadoras.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const OperadoraSchema = z.object({
  operadoraId: z.string().uuid(),
  nome: z.string(),
  registroAns: z.string(),
  cnpj: z.string(),
  tissVersion: z.string(),
  transportMode: z.enum(['arquivo', 'webservice']),
  active: z.boolean(),
  createdAt: z.string(),
});

export async function operadoraRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/operadoras — cadastrar operadora ────────────────────
  r.post('/v1/tiss/operadoras', {
    schema: {
      body: z.object({
        nome: z.string().min(1).max(300),
        registroAns: z.string().regex(/^[0-9]{6}$/),
        cnpj: z.string().regex(/^[A-Z0-9]{12}[0-9]{2}$/),
        tissVersion: z.string().min(1).max(20),
        transportMode: z.enum(['arquivo', 'webservice']),
      }),
      response: { 201: z.object({ operadoraId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.manage', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      nome: string; registroAns: string; cnpj: string;
      tissVersion: string; transportMode: string };
    const id = uuidv7();

    // Verificar unicidade de registro_ans dentro do tenant
    const { rowCount: existe } = await tx.query(
      `SELECT 1 FROM tiss.operadora
        WHERE registro_ans = $1 AND active = true`,
      [b.registroAns]);
    if (existe !== null && existe > 0) {
      erroDominio('operadora_registro_ans_duplicado', 422);
    }

    await tx.query(
      `INSERT INTO tiss.operadora
         (id, nome, registro_ans, cnpj, tiss_version, transport_mode, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::tiss.transport_mode, app.current_user_id())`,
      [id, b.nome, b.registroAns, b.cnpj, b.tissVersion, b.transportMode]);

    void reply.code(201);
    return { operadoraId: id };
  }));

  // ── GET /v1/tiss/operadoras — listar operadoras ───────────────────────
  r.get('/v1/tiss/operadoras', {
    schema: {
      querystring: z.object({
        search: z.string().optional(),
        active: z.enum(['true', 'false']).optional(),
      }),
      response: { 200: z.object({ itens: z.array(OperadoraSchema) }) },
    },
  }, rota('tiss.operadora.manage', async (tx, _ctx, req) => {
    const q = req.query as { search?: string; active?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.search !== undefined) {
      condicoes.push(`o.nome ILIKE $${idx}`);
      params.push(`%${q.search}%`); idx += 1;
    }
    if (q.active !== undefined) {
      condicoes.push(`o.active = $${idx}`);
      params.push(q.active === 'true'); idx += 1;
    }

    const where = condicoes.length > 0 ? `AND ${condicoes.join(' AND ')}` : '';
    const { rows } = await tx.query<{
      id: string; nome: string; registro_ans: string; cnpj: string;
      tiss_version: string; transport_mode: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, nome, registro_ans, cnpj, tiss_version, transport_mode::text,
              active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.operadora o
        WHERE true ${where}
        ORDER BY nome COLLATE "pt-BR-x-icu"`,
      params);

    return {
      itens: rows.map((row) => ({
        operadoraId: row.id,
        nome: row.nome,
        registroAns: row.registro_ans,
        cnpj: row.cnpj,
        tissVersion: row.tiss_version,
        transportMode: row.transport_mode as 'arquivo' | 'webservice',
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── GET /v1/tiss/operadoras/:id — detalhe ─────────────────────────────
  r.get('/v1/tiss/operadoras/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: OperadoraSchema },
    },
  }, rota('tiss.operadora.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rows } = await tx.query<{
      id: string; nome: string; registro_ans: string; cnpj: string;
      tiss_version: string; transport_mode: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, nome, registro_ans, cnpj, tiss_version, transport_mode::text,
              active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.operadora WHERE id = $1`,
      [p.id]);
    if (rows.length === 0) erroDominio('operadora_nao_encontrada', 404);
    const row = rows[0]!;
    return {
      operadoraId: row.id,
      nome: row.nome,
      registroAns: row.registro_ans,
      cnpj: row.cnpj,
      tissVersion: row.tiss_version,
      transportMode: row.transport_mode as 'arquivo' | 'webservice',
      active: row.active,
      createdAt: row.created_at,
    };
  }));

  // ── PUT /v1/tiss/operadoras — atualizar operadora ─────────────────────
  r.put('/v1/tiss/operadoras', {
    schema: {
      body: z.object({
        operadoraId: z.string().uuid(),
        nome: z.string().min(1).max(300).optional(),
        cnpj: z.string().regex(/^[A-Z0-9]{12}[0-9]{2}$/).optional(),
        tissVersion: z.string().min(1).max(20).optional(),
        transportMode: z.enum(['arquivo', 'webservice']).optional(),
      }),
      response: { 200: z.object({ operadoraId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.manage', async (tx, _ctx, req) => {
    const b = req.body as {
      operadoraId: string; nome?: string; cnpj?: string;
      tissVersion?: string; transportMode?: string };
    const sets: string[] = [];
    const params: unknown[] = [b.operadoraId];
    let idx = 2;
    if (b.nome !== undefined) { sets.push(`nome = $${idx}`); params.push(b.nome); idx += 1; }
    if (b.cnpj !== undefined) { sets.push(`cnpj = $${idx}`); params.push(b.cnpj); idx += 1; }
    if (b.tissVersion !== undefined) { sets.push(`tiss_version = $${idx}`); params.push(b.tissVersion); idx += 1; }
    if (b.transportMode !== undefined) { sets.push(`transport_mode = $${idx}::tiss.transport_mode`); params.push(b.transportMode); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE tiss.operadora SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('operadora_nao_encontrada', 404);
    return { operadoraId: b.operadoraId };
  }));

  // ── DELETE /v1/tiss/operadoras/:id — desativar (soft-delete) ──────────
  r.delete('/v1/tiss/operadoras/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ operadoraId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.manage', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rowCount } = await tx.query(
      `UPDATE tiss.operadora SET active = false WHERE id = $1 AND active = true`,
      [p.id]);
    if (rowCount === 0) erroDominio('operadora_nao_encontrada', 404);
    return { operadoraId: p.id };
  }));
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import no bloco de imports:

```ts
import { operadoraRoutes } from './routes/tiss/operadoras';
```

E adicionar no corpo de `buildApp`, apos `await app.register(reportRoutes);`:

```ts
  await app.register(operadoraRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/operadoras.int.test.ts
# ESPERADO: PASS — 6 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/operadoras.ts apps/api/src/routes/tiss/operadoras.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add TISS operadora CRUD routes

POST/GET/PUT/DELETE /v1/tiss/operadoras with tiss.operadora.manage
RBAC action. no-store header on all responses.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---