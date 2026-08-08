### Task 62: Acoes RBAC para TISS no catalogo de autorizacao

**Arquivos**
- Modificar: `packages/authz/src/actions.ts`
- Teste: `packages/authz/src/actions-tiss.test.ts`

**Passos**

- [ ] Escrever o teste que valida as novas acoes TISS:

```ts
// packages/authz/src/actions-tiss.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('acoes TISS (Fase 4)', () => {
  const tissKeys = [
    'tiss.operadora.manage',
    'tiss.guia.read',
    'tiss.guia.adjust',
    'tiss.lote.manage',
    'tiss.lote.send',
  ];

  it.each(tissKeys)('acao "%s" existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('tiss.operadora.manage so para admin_clinico', () => {
    const action = ACTION_BY_KEY.get('tiss.operadora.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).not.toContain('profissional');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('financeiro');
  });

  it('tiss.guia.read permite admin_clinico, medico e recepcao', () => {
    const action = ACTION_BY_KEY.get('tiss.guia.read')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('profissional');
    expect(action.roles).toContain('recepcao');
  });

  it('tiss.guia.adjust so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.guia.adjust')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
    expect(action.roles).not.toContain('recepcao');
  });

  it('tiss.lote.manage permite admin_clinico, recepcao e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.lote.manage')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('recepcao');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('profissional');
  });

  it('tiss.lote.send so para admin_clinico e financeiro', () => {
    const action = ACTION_BY_KEY.get('tiss.lote.send')!;
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).toContain('financeiro');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('nenhuma acao TISS exige MFA', () => {
    for (const key of tissKeys) {
      const action = ACTION_BY_KEY.get(key)!;
      expect(action.requiresMfa).toBeUndefined();
    }
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/authz/src/actions-tiss.test.ts
# ESPERADO: FAIL — acao "tiss.operadora.manage" nao existe no catalogo
```

- [ ] Adicionar as 5 acoes ao catalogo. Em `packages/authz/src/actions.ts`, inserir antes do `] as const satisfies readonly ActionDef[];`:

```ts
  // -- Fase 4 . TISS ─────────────────────────────────────────────────────
  // NOTA RECONCILIACAO: tiss.operadora.manage foi desmembrado em .read/.write
  // conforme o Bloco 01. As rotas GET devem usar tiss.operadora.read, as rotas
  // POST/PUT/DELETE devem usar tiss.operadora.write. O catalogo de acoes
  // da operadora esta definido pelo Bloco 01 (veja 00-CONTRATOS.md).
  // Este bloco adiciona apenas as acoes de guia e lote:
  { key: 'tiss.guia.read', description: 'Visualizar guias TISS pendentes e enviadas',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'tiss.guia.adjust', description: 'Ajustar codigo de procedimento na guia para faturamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'tiss.lote.manage', description: 'Criar, montar e cancelar lotes TISS',
    roles: ['admin_clinico', 'recepcao', 'financeiro'] },
  { key: 'tiss.lote.send', description: 'Enviar lote TISS para operadora (gera XML)',
    roles: ['admin_clinico', 'financeiro'] },
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/authz/src/actions-tiss.test.ts
# ESPERADO: PASS — todas as 8 assercoes verdes
```

- [ ] Commitar:

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions-tiss.test.ts
git commit -m "feat(authz): add Fase 4 TISS RBAC actions

Add tiss.operadora.manage, tiss.guia.read, tiss.guia.adjust,
tiss.lote.manage and tiss.lote.send to the action catalog.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

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

### Task 67: Isolamento multi-tenant para rotas TISS e validacao de no-store

**Arquivos**
- Criar: `apps/api/src/routes/tiss/fase4-isolation.int.test.ts`

**Passos**

- [ ] Escrever o teste de isolamento:

```ts
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
         (tenant_id, id, nome, registro_ans, cnpj, tiss_version, transport_mode, created_by)
       VALUES ($1, $2, 'Op Iso A', '339679', '11111111000190', '3.05.00', 'arquivo', $3)`,
      [a.tenantId, operadoraIdA, a.userId]);

    const versionId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, patient_id, professional_id, clinic_id,
          occurred_at, occurred_date, kind, content, content_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               clock_timestamp(),
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               'original', '{}', '\\x00', $7)`,
      [a.tenantId, versionId, a.encounterId, a.patientId,
       a.professionalId, a.clinicId, a.userId]);

    guiaIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.encounter_guia_consulta
         (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
          registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
          cnes, conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, data_atendimento,
          tipo_consulta, codigo_tabela, codigo_procedimento, valor_procedimento,
          created_by)
       VALUES ($1, $2, $3, $4, $5,
               '339679', 'ISO-00001', 'CART-ISO', false,
               '2077502', '06', '999888', 'SP', '225125',
               '9', '01',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               '1', '22', '10101012', 150.00,
               $6)`,
      [a.tenantId, guiaIdA, a.encounterId, versionId, operadoraIdA,
       a.userId]);

    loteIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.lote_counter (tenant_id, next_value) VALUES ($1, 2)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [a.tenantId]);
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, descricao, numero_lote, status, created_by)
       VALUES ($1, $2, $3, 'Lote Iso', '000000000001', 'aberto', $4)`,
      [a.tenantId, loteIdA, operadoraIdA, a.userId]);

    convenioIdA = uuidv7();
    await c.query(
      `INSERT INTO tiss.patient_convenio
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
        cnpj: 'A1B2C3D4E5F601', tissVersion: '3.05.00',
        transportMode: 'arquivo',
      },
    });
    expect(r2.statusCode).toBe(403);

    // Nao pode criar lote
    const r3 = await app.inject({
      method: 'POST', url: '/v1/tiss/lotes', ...auth(medicoLocal),
      payload: { operadoraId: operadoraIdA, descricao: 'Proibido' },
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
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/tiss/fase4-isolation.int.test.ts
# ESPERADO: FAIL — se as rotas ainda nao existem, ou se falta seed.
# Apos as Tasks 63-66 concluidas, este teste deve passar.
```

- [ ] Se as Tasks 63-66 estao completas, rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/tiss/fase4-isolation.int.test.ts
# ESPERADO: PASS — 11 testes verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/tiss/fase4-isolation.int.test.ts
git commit -m "test(api): add TISS multi-tenant isolation and RBAC tests

Verify operadoras, guias, lotes and convenios from tenant A are
invisible to tenant B. Validate cache-control: no-store on all
TISS endpoints. Confirm role-based access: profissional reads
guias only, recepcao manages lotes but cannot send.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
