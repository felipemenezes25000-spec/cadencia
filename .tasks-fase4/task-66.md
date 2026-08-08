### Task 66: Convenio do paciente (CRUD vinculado a paciente)

**Arquivos**
- Criar: `apps/api/src/routes/tiss/convenios-paciente.ts`
- Criar: `apps/api/src/routes/tiss/convenios-paciente.int.test.ts`
- Modificar: `apps/api/src/app.ts` (registrar plugin)

**Passos**

- [ ] Escrever o teste de integracao:

```ts
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
         (tenant_id, id, nome, registro_ans, cnpj, tiss_version, transport_mode, created_by)
       VALUES ($1, $2, 'Op Conv', '339679', '11111111000190', '3.05.00', 'arquivo', $3)`,
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
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/convenios-paciente.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado / rota nao existe
```

- [ ] Criar o arquivo de rotas:

```ts
// apps/api/src/routes/tiss/convenios-paciente.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const ConvenioSchema = z.object({
  convenioId: z.string().uuid(),
  patientId: z.string().uuid(),
  operadoraId: z.string().uuid(),
  operadoraNome: z.string(),
  registroAns: z.string(),
  numeroCarteira: z.string(),
  validadeCarteira: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});

export async function convenioPacienteRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/tiss/pacientes/:patientId/convenios — vincular convenio ──
  r.post('/v1/tiss/pacientes/:patientId/convenios', {
    schema: {
      params: z.object({ patientId: z.string().uuid() }),
      body: z.object({
        operadoraId: z.string().uuid(),
        numeroCarteira: z.string().min(1).max(20),
        validadeCarteira: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      response: { 201: z.object({ convenioId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.manage', async (tx, _ctx, req, reply) => {
    const p = req.params as { patientId: string };
    const b = req.body as {
      operadoraId: string; numeroCarteira: string; validadeCarteira?: string };
    const id = uuidv7();

    // Verificar que o paciente existe
    const { rowCount: pacExiste } = await tx.query(
      `SELECT 1 FROM clin.patient WHERE id = $1`, [p.patientId]);
    if (pacExiste === 0) erroDominio('paciente_nao_encontrado', 404);

    // Verificar que a operadora existe
    const { rowCount: opExiste } = await tx.query(
      `SELECT 1 FROM tiss.operadora WHERE id = $1 AND active = true`,
      [b.operadoraId]);
    if (opExiste === 0) erroDominio('operadora_nao_encontrada', 404);

    await tx.query(
      `INSERT INTO tiss.patient_convenio
         (id, patient_id, operadora_id, numero_carteira, validade_carteira, created_by)
       VALUES ($1, $2, $3, $4, $5, app.current_user_id())`,
      [id, p.patientId, b.operadoraId, b.numeroCarteira,
       b.validadeCarteira ?? null]);

    void reply.code(201);
    return { convenioId: id };
  }));

  // ── GET /v1/tiss/pacientes/:patientId/convenios — listar convenios ────
  r.get('/v1/tiss/pacientes/:patientId/convenios', {
    schema: {
      params: z.object({ patientId: z.string().uuid() }),
      response: { 200: z.object({ itens: z.array(ConvenioSchema) }) },
    },
  }, rota('tiss.guia.read', async (tx, _ctx, req) => {
    const p = req.params as { patientId: string };

    const { rows } = await tx.query<{
      id: string; patient_id: string; operadora_id: string;
      operadora_nome: string; registro_ans: string;
      numero_carteira: string; validade_carteira: string | null;
      active: boolean; created_at: string;
    }>(
      `SELECT pc.id, pc.patient_id, pc.operadora_id,
              o.nome AS operadora_nome, o.registro_ans,
              pc.numero_carteira,
              pc.validade_carteira::text,
              pc.active,
              to_char(pc.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM tiss.patient_convenio pc
         JOIN tiss.operadora o
           ON o.tenant_id = pc.tenant_id AND o.id = pc.operadora_id
        WHERE pc.patient_id = $1 AND pc.active = true
        ORDER BY o.nome COLLATE "pt-BR-x-icu"`,
      [p.patientId]);

    return {
      itens: rows.map((row) => ({
        convenioId: row.id,
        patientId: row.patient_id,
        operadoraId: row.operadora_id,
        operadoraNome: row.operadora_nome,
        registroAns: row.registro_ans,
        numeroCarteira: row.numero_carteira,
        validadeCarteira: row.validade_carteira,
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/tiss/pacientes/:patientId/convenios — atualizar convenio ──
  r.put('/v1/tiss/pacientes/:patientId/convenios', {
    schema: {
      params: z.object({ patientId: z.string().uuid() }),
      body: z.object({
        convenioId: z.string().uuid(),
        numeroCarteira: z.string().min(1).max(20).optional(),
        validadeCarteira: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      response: { 200: z.object({ convenioId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.manage', async (tx, _ctx, req) => {
    const p = req.params as { patientId: string };
    const b = req.body as {
      convenioId: string; numeroCarteira?: string; validadeCarteira?: string };
    const sets: string[] = [];
    const params: unknown[] = [b.convenioId, p.patientId];
    let idx = 3;
    if (b.numeroCarteira !== undefined) {
      sets.push(`numero_carteira = $${idx}`); params.push(b.numeroCarteira); idx += 1;
    }
    if (b.validadeCarteira !== undefined) {
      sets.push(`validade_carteira = $${idx}`); params.push(b.validadeCarteira); idx += 1;
    }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE tiss.patient_convenio SET ${sets.join(', ')}
        WHERE id = $1 AND patient_id = $2`,
      params);
    if (rowCount === 0) erroDominio('convenio_nao_encontrado', 404);
    return { convenioId: b.convenioId };
  }));

  // ── DELETE /v1/tiss/pacientes/:patientId/convenios/:id — desativar ────
  r.delete('/v1/tiss/pacientes/:patientId/convenios/:id', {
    schema: {
      params: z.object({
        patientId: z.string().uuid(),
        id: z.string().uuid(),
      }),
      response: { 200: z.object({ convenioId: z.string().uuid() }) },
    },
  }, rota('tiss.operadora.manage', async (tx, _ctx, req) => {
    const p = req.params as { patientId: string; id: string };
    const { rowCount } = await tx.query(
      `UPDATE tiss.patient_convenio SET active = false
        WHERE id = $1 AND patient_id = $2 AND active = true`,
      [p.id, p.patientId]);
    if (rowCount === 0) erroDominio('convenio_nao_encontrado', 404);
    return { convenioId: p.id };
  }));
}
```

- [ ] Registrar o plugin em `apps/api/src/app.ts`. Adicionar o import:

```ts
import { convenioPacienteRoutes } from './routes/tiss/convenios-paciente';
```

E registrar apos `await app.register(loteRoutes);`:

```ts
  await app.register(convenioPacienteRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/convenios-paciente.int.test.ts
# ESPERADO: PASS — 4 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/convenios-paciente.ts apps/api/src/routes/tiss/convenios-paciente.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add patient convenio CRUD routes

POST/GET/PUT/DELETE /v1/tiss/pacientes/:patientId/convenios.
RBAC: tiss.operadora.manage for write, tiss.guia.read for listing.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---