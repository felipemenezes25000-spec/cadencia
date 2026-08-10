### Task 51: Novas acoes de autorizacao para Fase 3 [RECONCILIADO — ver Bloco 03, Task 17]

**[RECONCILIADO]** As acoes finance.settings, finance.write, finance.repasse, inventory.read, inventory.write e report.read foram incorporadas ao catalogo unificado no Bloco 03 (Task 17). Esta Task so precisa criar o teste `packages/authz/src/actions.test.ts` — o arquivo `packages/authz/src/actions.ts` ja contem todas as acoes.

**Arquivos**
- ~~Modificar: `packages/authz/src/actions.ts`~~ (ja feito pelo Bloco 03)
- Teste: `packages/authz/src/actions.test.ts`

**Passos**

- [ ] Escrever o teste que valida que as novas acoes existem no catalogo:

```ts
// packages/authz/src/actions.test.ts
import { describe, expect, it } from 'vitest';
import { ACTION_BY_KEY, ACTIONS } from './actions';

describe('acoes da Fase 3', () => {
  const fase3Keys = [
    'finance.settings',
    'finance.write',
    'finance.repasse',
    'inventory.read',
    'inventory.write',
    'report.read',
  ];

  it.each(fase3Keys)('acao "%s" existe no catalogo', (key) => {
    expect(ACTION_BY_KEY.has(key)).toBe(true);
  });

  it('finance.settings exige papel financeiro ou admin_clinico', () => {
    const action = ACTION_BY_KEY.get('finance.settings')!;
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('admin_clinico');
    expect(action.roles).not.toContain('recepcao');
    expect(action.roles).not.toContain('profissional');
  });

  it('finance.write permite recepcao e financeiro', () => {
    const action = ACTION_BY_KEY.get('finance.write')!;
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('admin_clinico');
  });

  it('finance.repasse exige MFA', () => {
    const action = ACTION_BY_KEY.get('finance.repasse')!;
    expect(action.requiresMfa).toBe(true);
  });

  it('inventory.read permite profissional e recepcao', () => {
    const action = ACTION_BY_KEY.get('inventory.read')!;
    expect(action.roles).toContain('profissional');
    expect(action.roles).toContain('recepcao');
  });

  it('report.read permite financeiro e diretor_tecnico', () => {
    const action = ACTION_BY_KEY.get('report.read')!;
    expect(action.roles).toContain('financeiro');
    expect(action.roles).toContain('diretor_tecnico');
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const keys = ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# ESPERADO: FAIL — acoes nao existem no catalogo
```

- [ ] [SKIP — RECONCILIADO] As acoes abaixo ja foram adicionadas pelo Bloco 03 (Task 17). Verificar que existem no catalogo, nao re-adicionar:

```ts
// Em packages/authz/src/actions.ts, ADICIONAR ao array ACTIONS antes do
// `] as const satisfies readonly ActionDef[];`
// Logo apos o bloco "Fase 2 · Pagamento":

  // ── Fase 3 · Financeiro completo ─────────────────────────────────────
  { key: 'finance.settings', description: 'Configurar contas bancarias, centros de custo, regras de split e recorrencia',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.write', description: 'Lancar despesa e cadastrar fornecedor',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.repasse', description: 'Gerar, visualizar e pagar repasse a profissionais',
    roles: ['admin_clinico', 'financeiro'], requiresMfa: true },
  // ── Fase 3 · Estoque ────────────────────────────────────────────────
  { key: 'inventory.read', description: 'Consultar produtos e alertas de estoque',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'inventory.write', description: 'Cadastrar produto e registrar movimentacao',
    roles: ['admin_clinico', 'financeiro'] },
  // ── Fase 3 · Relatorios ─────────────────────────────────────────────
  { key: 'report.read', description: 'Acessar painel de desempenho e exportar relatorios',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/authz/src/actions.test.ts
# ESPERADO: PASS — todas as 7 assertivas verdes
```

- [ ] Commitar:

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions.test.ts
git commit -m "feat(authz): add Fase 3 action keys for finance, inventory and reports"
```

---

### Task 52: Rotas de contas bancarias, centros de custo e fornecedores

**Arquivos**
- Criar: `apps/api/src/routes/finance-settings.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/finance-settings.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/finance-settings.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'financeiro' });
  outro = await semearSessao({ role: 'financeiro' });
});
afterAll(async () => { await closePools(); });

describe('rotas de contas bancarias', () => {
  let bankAccountId: string;

  it('POST /v1/bank-accounts cria conta bancaria', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(fin),
      payload: {
        name: 'Bradesco Corrente',
        bankCode: '237',
        agency: '1234',
        accountNumber: '56789-0',
        initialBalanceCents: 100000,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { bankAccountId: string };
    expect(body.bankAccountId).toBeTruthy();
    bankAccountId = body.bankAccountId;
    await app.close();
  });

  it('GET /v1/bank-accounts lista contas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ bankAccountId: string }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    expect(body.itens.some((i) => i.bankAccountId === bankAccountId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/bank-accounts atualiza conta', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/bank-accounts', ...auth(fin),
      payload: {
        bankAccountId,
        name: 'Bradesco Corrente Principal',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { bankAccountId: string };
    expect(body.bankAccountId).toBe(bankAccountId);
    await app.close();
  });

  it('conta bancaria de outro tenant nao aparece na listagem', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ bankAccountId: string }> };
    expect(body.itens.map((i) => i.bankAccountId)).not.toContain(bankAccountId);
    await app.close();
  });

  it('recepcao nao acessa contas bancarias (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts', ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de centros de custo', () => {
  let costCenterId: string;

  it('POST /v1/cost-centers cria centro de custo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/cost-centers', ...auth(fin),
      payload: { name: 'Consultorio 1', code: 'CC01' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { costCenterId: string };
    expect(body.costCenterId).toBeTruthy();
    costCenterId = body.costCenterId;
    await app.close();
  });

  it('GET /v1/cost-centers lista centros de custo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/cost-centers', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ costCenterId: string }> };
    expect(body.itens.some((i) => i.costCenterId === costCenterId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/cost-centers atualiza centro de custo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/cost-centers', ...auth(fin),
      payload: { costCenterId, name: 'Consultorio Principal' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('centro de custo de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/cost-centers', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ costCenterId: string }> };
    expect(body.itens.map((i) => i.costCenterId)).not.toContain(costCenterId);
    await app.close();
  });
});

describe('rotas de fornecedores', () => {
  let supplierId: string;

  it('POST /v1/suppliers cria fornecedor', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/suppliers', ...auth(fin),
      payload: {
        name: 'Distribuidora Medica ABC',
        cnpj: '12345678000195',
        phone: '11999887766',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { supplierId: string };
    expect(body.supplierId).toBeTruthy();
    supplierId = body.supplierId;
    await app.close();
  });

  it('GET /v1/suppliers lista fornecedores', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/suppliers', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ supplierId: string }> };
    expect(body.itens.some((i) => i.supplierId === supplierId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/suppliers atualiza fornecedor', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/suppliers', ...auth(fin),
      payload: { supplierId, name: 'Distribuidora Medica ABC Ltda' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('fornecedor de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/suppliers', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ supplierId: string }> };
    expect(body.itens.map((i) => i.supplierId)).not.toContain(supplierId);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/finance-settings.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/finance-settings.ts`:

```ts
// apps/api/src/routes/finance-settings.ts
//
// Rotas de configuracao financeira: contas bancarias, centros de custo e fornecedores.
// Acao: finance.settings (contas e centros de custo), finance.write (fornecedores).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

// ── Schemas de resposta ────────────────────────────────────────────────────

const BankAccountSchema = z.object({
  bankAccountId: z.string().uuid(),
  name: z.string(),
  bankCode: z.string(),
  agency: z.string(),
  accountNumber: z.string(),
  initialBalanceCents: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
});

const CostCenterSchema = z.object({
  costCenterId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});

const SupplierSchema = z.object({
  supplierId: z.string().uuid(),
  name: z.string(),
  cnpj: z.string().nullable(),
  phone: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});

export async function financeSettingsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/bank-accounts ────────────────────────────────────────────
  r.post('/v1/bank-accounts', {
    schema: {
      body: z.object({
        name: z.string().min(1).max(200),
        bankCode: z.string().min(1).max(10),
        agency: z.string().min(1).max(20),
        accountNumber: z.string().min(1).max(30),
        initialBalanceCents: z.number().int().default(0),
      }),
      response: { 201: z.object({ bankAccountId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      name: string; bankCode: string; agency: string;
      accountNumber: string; initialBalanceCents: number };
    const id = uuidv7();
    await tx.query(
      `INSERT INTO fin.bank_account
         (id, name, bank_code, agency, account_number, initial_balance_cents)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, b.name, b.bankCode, b.agency, b.accountNumber, b.initialBalanceCents]);
    void reply.code(201);
    return { bankAccountId: id };
  }));

  // ── GET /v1/bank-accounts ─────────────────────────────────────────────
  r.get('/v1/bank-accounts', {
    schema: {
      response: { 200: z.object({ itens: z.array(BankAccountSchema) }) },
    },
  }, rota('finance.settings', async (tx) => {
    const { rows } = await tx.query<{
      id: string; name: string; bank_code: string; agency: string;
      account_number: string; initial_balance_cents: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, name, bank_code, agency, account_number,
              initial_balance_cents::text, active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.bank_account
        ORDER BY name COLLATE "pt-BR-x-icu"`);
    return {
      itens: rows.map((row) => ({
        bankAccountId: row.id,
        name: row.name,
        bankCode: row.bank_code,
        agency: row.agency,
        accountNumber: row.account_number,
        initialBalanceCents: Number(row.initial_balance_cents),
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/bank-accounts ─────────────────────────────────────────────
  r.put('/v1/bank-accounts', {
    schema: {
      body: z.object({
        bankAccountId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        bankCode: z.string().min(1).max(10).optional(),
        agency: z.string().min(1).max(20).optional(),
        accountNumber: z.string().min(1).max(30).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ bankAccountId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const b = req.body as {
      bankAccountId: string; name?: string; bankCode?: string;
      agency?: string; accountNumber?: string; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.bankAccountId];
    let idx = 2;
    if (b.name !== undefined) { sets.push(`name = $${idx}`); params.push(b.name); idx += 1; }
    if (b.bankCode !== undefined) { sets.push(`bank_code = $${idx}`); params.push(b.bankCode); idx += 1; }
    if (b.agency !== undefined) { sets.push(`agency = $${idx}`); params.push(b.agency); idx += 1; }
    if (b.accountNumber !== undefined) { sets.push(`account_number = $${idx}`); params.push(b.accountNumber); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.bank_account SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('conta_nao_encontrada', 404);
    return { bankAccountId: b.bankAccountId };
  }));

  // ── POST /v1/cost-centers ─────────────────────────────────────────────
  r.post('/v1/cost-centers', {
    schema: {
      body: z.object({
        name: z.string().min(1).max(200),
        code: z.string().min(1).max(20),
      }),
      response: { 201: z.object({ costCenterId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req, reply) => {
    const b = req.body as { name: string; code: string };
    const id = uuidv7();
    await tx.query(
      `INSERT INTO fin.cost_center (id, name, code) VALUES ($1, $2, $3)`,
      [id, b.name, b.code]);
    void reply.code(201);
    return { costCenterId: id };
  }));

  // ── GET /v1/cost-centers ──────────────────────────────────────────────
  r.get('/v1/cost-centers', {
    schema: {
      response: { 200: z.object({ itens: z.array(CostCenterSchema) }) },
    },
  }, rota('finance.settings', async (tx) => {
    const { rows } = await tx.query<{
      id: string; name: string; code: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, name, code, active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.cost_center
        ORDER BY code COLLATE "pt-BR-x-icu"`);
    return {
      itens: rows.map((row) => ({
        costCenterId: row.id,
        name: row.name,
        code: row.code,
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/cost-centers ──────────────────────────────────────────────
  r.put('/v1/cost-centers', {
    schema: {
      body: z.object({
        costCenterId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        code: z.string().min(1).max(20).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ costCenterId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const b = req.body as { costCenterId: string; name?: string; code?: string; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.costCenterId];
    let idx = 2;
    if (b.name !== undefined) { sets.push(`name = $${idx}`); params.push(b.name); idx += 1; }
    if (b.code !== undefined) { sets.push(`code = $${idx}`); params.push(b.code); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.cost_center SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('centro_custo_nao_encontrado', 404);
    return { costCenterId: b.costCenterId };
  }));

  // ── POST /v1/suppliers ────────────────────────────────────────────────
  r.post('/v1/suppliers', {
    schema: {
      body: z.object({
        name: z.string().min(1).max(300),
        cnpj: z.string().max(14).optional(),
        phone: z.string().max(20).optional(),
      }),
      response: { 201: z.object({ supplierId: z.string().uuid() }) },
    },
  }, rota('finance.write', async (tx, _ctx, req, reply) => {
    const b = req.body as { name: string; cnpj?: string; phone?: string };
    const id = uuidv7();
    await tx.query(
      `INSERT INTO fin.supplier (id, name, cnpj, phone) VALUES ($1, $2, $3, $4)`,
      [id, b.name, b.cnpj ?? null, b.phone ?? null]);
    void reply.code(201);
    return { supplierId: id };
  }));

  // ── GET /v1/suppliers ─────────────────────────────────────────────────
  r.get('/v1/suppliers', {
    schema: {
      response: { 200: z.object({ itens: z.array(SupplierSchema) }) },
    },
  }, rota('finance.settings', async (tx) => {
    const { rows } = await tx.query<{
      id: string; name: string; cnpj: string | null;
      phone: string | null; active: boolean; created_at: string;
    }>(
      `SELECT id, name, cnpj, phone, active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.supplier
        ORDER BY name COLLATE "pt-BR-x-icu"`);
    return {
      itens: rows.map((row) => ({
        supplierId: row.id,
        name: row.name,
        cnpj: row.cnpj,
        phone: row.phone,
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/suppliers ─────────────────────────────────────────────────
  r.put('/v1/suppliers', {
    schema: {
      body: z.object({
        supplierId: z.string().uuid(),
        name: z.string().min(1).max(300).optional(),
        cnpj: z.string().max(14).optional(),
        phone: z.string().max(20).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ supplierId: z.string().uuid() }) },
    },
  }, rota('finance.write', async (tx, _ctx, req) => {
    const b = req.body as {
      supplierId: string; name?: string; cnpj?: string;
      phone?: string; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.supplierId];
    let idx = 2;
    if (b.name !== undefined) { sets.push(`name = $${idx}`); params.push(b.name); idx += 1; }
    if (b.cnpj !== undefined) { sets.push(`cnpj = $${idx}`); params.push(b.cnpj); idx += 1; }
    if (b.phone !== undefined) { sets.push(`phone = $${idx}`); params.push(b.phone); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.supplier SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('fornecedor_nao_encontrado', 404);
    return { supplierId: b.supplierId };
  }));
}
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { financeSettingsRoutes } from './routes/finance-settings';

// Apos `await app.register(paymentWebhookRoutes);`, adicionar:
  await app.register(financeSettingsRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/finance-settings.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/finance-settings.ts apps/api/src/routes/finance-settings.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add bank accounts, cost centers and suppliers CRUD routes"
```

---

### Task 53: Rotas de a pagar, transferencias e recorrencias

**Arquivos**
- Criar: `apps/api/src/routes/finance-operations.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/finance-operations.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/finance-operations.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'financeiro' });
  outro = await semearSessao({ role: 'financeiro' });
});
afterAll(async () => { await closePools(); });

describe('rotas de a pagar (payables)', () => {
  let payableId: string;

  it('POST /v1/payables cria lancamento de despesa', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payables', ...auth(fin),
      payload: {
        description: 'Material de limpeza',
        amountCents: 8500,
        method: 'pix',
        dueDate: '2026-09-15',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { payableId: string; status: string };
    expect(body.status).toBe('pending');
    expect(body.payableId).toBeTruthy();
    payableId = body.payableId;
    await app.close();
  });

  it('GET /v1/payables lista despesas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/payables', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ payableId: string; kind: string }> };
    expect(body.itens.some((i) => i.payableId === payableId)).toBe(true);
    for (const item of body.itens) {
      expect(item.kind).toBe('despesa');
    }
    await app.close();
  });

  it('despesa de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/payables', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ payableId: string }> };
    expect(body.itens.map((i) => i.payableId)).not.toContain(payableId);
    await app.close();
  });

  it('recepcao nao cria despesa (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/payables', ...auth(recep),
      payload: {
        description: 'Teste', amountCents: 100, method: 'dinheiro',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de transferencias', () => {
  it('POST /v1/transfers cria transferencia entre contas', async () => {
    const app = await buildApp();

    // Criar duas contas bancarias primeiro
    const r1 = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(fin),
      payload: { name: 'Origem', bankCode: '001', agency: '0001', accountNumber: '11111-0', initialBalanceCents: 500000 },
    });
    const fromId = (r1.json() as { bankAccountId: string }).bankAccountId;

    const r2 = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(fin),
      payload: { name: 'Destino', bankCode: '341', agency: '0002', accountNumber: '22222-0', initialBalanceCents: 0 },
    });
    const toId = (r2.json() as { bankAccountId: string }).bankAccountId;

    const r = await app.inject({
      method: 'POST', url: '/v1/transfers', ...auth(fin),
      payload: {
        fromBankAccountId: fromId,
        toBankAccountId: toId,
        amountCents: 100000,
        description: 'Transferencia entre contas',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { transferId: string; debitEntryId: string; creditEntryId: string };
    expect(body.transferId).toBeTruthy();
    expect(body.debitEntryId).toBeTruthy();
    expect(body.creditEntryId).toBeTruthy();
    await app.close();
  });

  it('recepcao nao pode transferir (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/transfers', ...auth(recep),
      payload: {
        fromBankAccountId: '00000000-0000-0000-0000-000000000001',
        toBankAccountId: '00000000-0000-0000-0000-000000000002',
        amountCents: 1000, description: 'Teste',
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de recorrencias', () => {
  let recurringId: string;

  it('POST /v1/recurring cria template recorrente', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/recurring', ...auth(fin),
      payload: {
        description: 'Aluguel do consultorio',
        amountCents: 350000,
        kind: 'despesa',
        method: 'pix',
        frequency: 'monthly',
        dayOfMonth: 10,
        startsAt: '2026-09-01',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { recurringId: string };
    expect(body.recurringId).toBeTruthy();
    recurringId = body.recurringId;
    await app.close();
  });

  it('GET /v1/recurring lista templates', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/recurring', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ recurringId: string }> };
    expect(body.itens.some((i) => i.recurringId === recurringId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/recurring atualiza template', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/recurring', ...auth(fin),
      payload: { recurringId, amountCents: 380000 },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('DELETE /v1/recurring desativa template', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'DELETE', url: `/v1/recurring/${recurringId}`, ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { recurringId: string; active: boolean };
    expect(body.active).toBe(false);
    await app.close();
  });

  it('recorrencia de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/recurring', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ recurringId: string }> };
    expect(body.itens.map((i) => i.recurringId)).not.toContain(recurringId);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/finance-operations.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/finance-operations.ts`:

```ts
// apps/api/src/routes/finance-operations.ts
//
// Rotas de operacoes financeiras: a pagar, transferencias e recorrencias.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const STATUS_DB_TO_API: Record<string, string> = {
  pago: 'confirmed', pendente: 'pending', cancelado: 'failed', estornado: 'refunded',
};

const METHOD_DISPLAY: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'Pix', cartao_credito: 'Cartao de Credito',
  cartao_debito: 'Cartao de Debito', link: 'Link de Pagamento',
};

const PayableSchema = z.object({
  payableId: z.string().uuid(),
  kind: z.literal('despesa'),
  description: z.string(),
  amountCents: z.number().int(),
  method: z.string(),
  status: z.string(),
  dueDate: z.string().nullable(),
  paidAt: z.string().nullable(),
  supplierId: z.string().uuid().nullable(),
  categoryId: z.string().uuid().nullable(),
  costCenterId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

const RecurringSchema = z.object({
  recurringId: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int(),
  kind: z.string(),
  method: z.string(),
  frequency: z.string(),
  dayOfMonth: z.number().int().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});

export async function financeOperationsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/payables — criar lancamento de despesa ───────────────────
  r.post('/v1/payables', {
    schema: {
      body: z.object({
        description: z.string().min(1),
        amountCents: z.number().int().min(1),
        method: z.enum(['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'link']),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        supplierId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        costCenterId: z.string().uuid().optional(),
      }),
      response: {
        201: z.object({ payableId: z.string().uuid(), status: z.literal('pending') }),
      },
    },
  }, rota('payment.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      description: string; amountCents: number; method: string;
      dueDate?: string; supplierId?: string; categoryId?: string;
      costCenterId?: string };
    const id = uuidv7();

    // Resolver metodo de pagamento
    const { rows: pmRows } = await tx.query<{ id: string }>(
      `SELECT id FROM fin.payment_method WHERE kind = $1::fin.payment_method_kind LIMIT 1`,
      [b.method]);
    let paymentMethodId: string;
    if (pmRows.length > 0) {
      paymentMethodId = pmRows[0]!.id;
    } else {
      const newPmId = uuidv7();
      await tx.query(
        `INSERT INTO fin.payment_method (id, kind, name)
         VALUES ($1, $2::fin.payment_method_kind, $3)`,
        [newPmId, b.method, METHOD_DISPLAY[b.method] ?? b.method]);
      paymentMethodId = newPmId;
    }

    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, description, amount_cents, payment_method_id,
          clinic_id, professional_id, status, due_date,
          category_id, idempotency_key, created_by)
       VALUES ($1, 'despesa', $2, $3, $4,
               $5, app.current_professional_id(), 'pendente', $6,
               $7, $8, app.current_user_id())`,
      [id, b.description, b.amountCents, paymentMethodId,
       ctx.actor.clinicId, b.dueDate ?? null,
       b.categoryId ?? null, `payable:${id}`]);

    void reply.code(201);
    return { payableId: id, status: 'pending' as const };
  }));

  // ── GET /v1/payables — listar despesas ────────────────────────────────
  r.get('/v1/payables', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        status: z.enum(['pending', 'confirmed', 'failed']).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(PayableSchema),
          nextCursor: z.string().nullable(),
        }),
      },
    },
  }, rota('payment.read', async (tx, ctx, req) => {
    const q = req.query as {
      from?: string; to?: string; status?: string;
      limit?: number; cursor?: string };
    const limite = q.limit ?? 50;
    const condicoes: string[] = [`e.clinic_id = $1`, `e.kind = 'despesa'`];
    const params: unknown[] = [ctx.actor.clinicId];
    let idx = 2;

    if (q.from !== undefined) {
      condicoes.push(`e.created_at >= $${idx}::date`);
      params.push(q.from); idx += 1;
    }
    if (q.to !== undefined) {
      condicoes.push(`e.created_at < ($${idx}::date + 1)`);
      params.push(q.to); idx += 1;
    }
    if (q.status !== undefined) {
      const STATUS_API_TO_DB: Record<string, string> = {
        confirmed: 'pago', pending: 'pendente', failed: 'cancelado',
      };
      condicoes.push(`e.status = $${idx}::fin.entry_status`);
      params.push(STATUS_API_TO_DB[q.status] ?? q.status); idx += 1;
    }
    if (q.cursor !== undefined) {
      condicoes.push(`e.created_at < $${idx}`);
      params.push(q.cursor); idx += 1;
    }

    params.push(limite + 1);
    const where = condicoes.join(' AND ');

    const { rows } = await tx.query<{
      id: string; description: string; amount_cents: string;
      method: string; status: string; due_date: string | null;
      paid_at: string | null; created_at: string;
    }>(
      `SELECT e.id, e.description, e.amount_cents::text,
              pm.kind AS method, e.status::text,
              e.due_date::text,
              to_char(e.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
              to_char(e.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.entry e
         JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
        WHERE ${where}
        ORDER BY e.created_at DESC
        LIMIT $${idx}`,
      params);

    const hasMore = rows.length > limite;
    const itens = (hasMore ? rows.slice(0, limite) : rows).map((row) => ({
      payableId: row.id,
      kind: 'despesa' as const,
      description: row.description,
      amountCents: Number(row.amount_cents),
      method: row.method,
      status: STATUS_DB_TO_API[row.status] ?? row.status,
      dueDate: row.due_date,
      paidAt: row.paid_at,
      supplierId: null,
      categoryId: null,
      costCenterId: null,
      createdAt: row.created_at,
    }));

    const nextCursor = hasMore && itens.length > 0
      ? itens[itens.length - 1]!.createdAt : null;
    return { itens, nextCursor };
  }));

  // ── POST /v1/transfers — transferencia entre contas ────────────────────
  r.post('/v1/transfers', {
    schema: {
      body: z.object({
        fromBankAccountId: z.string().uuid(),
        toBankAccountId: z.string().uuid(),
        amountCents: z.number().int().min(1),
        description: z.string().min(1),
      }),
      response: {
        201: z.object({
          transferId: z.string().uuid(),
          debitEntryId: z.string().uuid(),
          creditEntryId: z.string().uuid(),
        }),
      },
    },
  }, rota('payment.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      fromBankAccountId: string; toBankAccountId: string;
      amountCents: number; description: string };

    if (b.fromBankAccountId === b.toBankAccountId) {
      erroDominio('transferencia_mesma_conta', 422);
    }

    // Verificar que ambas as contas existem
    const { rows: fromRows } = await tx.query<{ id: string }>(
      `SELECT id FROM fin.bank_account WHERE id = $1`, [b.fromBankAccountId]);
    if (fromRows.length === 0) erroDominio('conta_origem_nao_encontrada', 404);

    const { rows: toRows } = await tx.query<{ id: string }>(
      `SELECT id FROM fin.bank_account WHERE id = $1`, [b.toBankAccountId]);
    if (toRows.length === 0) erroDominio('conta_destino_nao_encontrada', 404);

    const transferId = uuidv7();
    const debitId = uuidv7();
    const creditId = uuidv7();

    // Resolver metodo de pagamento 'pix' para transferencia
    const { rows: pmRows } = await tx.query<{ id: string }>(
      `SELECT id FROM fin.payment_method WHERE kind = 'pix'::fin.payment_method_kind LIMIT 1`);
    let paymentMethodId: string;
    if (pmRows.length > 0) {
      paymentMethodId = pmRows[0]!.id;
    } else {
      const newPmId = uuidv7();
      await tx.query(
        `INSERT INTO fin.payment_method (id, kind, name) VALUES ($1, 'pix'::fin.payment_method_kind, 'Pix')`,
        [newPmId]);
      paymentMethodId = newPmId;
    }

    // Debito (despesa na conta de origem)
    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, description, amount_cents, payment_method_id,
          clinic_id, professional_id, status, paid_at,
          idempotency_key, created_by)
       VALUES ($1, 'despesa', $2, $3, $4,
               $5, app.current_professional_id(), 'pago', clock_timestamp(),
               $6, app.current_user_id())`,
      [debitId, `Transferencia: ${b.description}`, b.amountCents, paymentMethodId,
       ctx.actor.clinicId, `transfer:debit:${transferId}`]);

    // Credito (receita na conta de destino)
    await tx.query(
      `INSERT INTO fin.entry
         (id, kind, description, amount_cents, payment_method_id,
          clinic_id, professional_id, status, paid_at,
          idempotency_key, created_by)
       VALUES ($1, 'receita', $2, $3, $4,
               $5, app.current_professional_id(), 'pago', clock_timestamp(),
               $6, app.current_user_id())`,
      [creditId, `Transferencia: ${b.description}`, b.amountCents, paymentMethodId,
       ctx.actor.clinicId, `transfer:credit:${transferId}`]);

    void reply.code(201);
    return { transferId, debitEntryId: debitId, creditEntryId: creditId };
  }));

  // ── POST /v1/recurring — criar template de recorrencia ────────────────
  r.post('/v1/recurring', {
    schema: {
      body: z.object({
        description: z.string().min(1),
        amountCents: z.number().int().min(1),
        kind: z.enum(['receita', 'despesa']),
        method: z.enum(['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'link']),
        frequency: z.enum(['monthly', 'weekly', 'biweekly']),
        dayOfMonth: z.number().int().min(1).max(31).optional(),
        startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      response: { 201: z.object({ recurringId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, ctx, req, reply) => {
    const b = req.body as {
      description: string; amountCents: number; kind: string;
      method: string; frequency: string; dayOfMonth?: number;
      startsAt: string; endsAt?: string };
    const id = uuidv7();

    await tx.query(
      `INSERT INTO fin.recurring_template
         (id, clinic_id, description, amount_cents, kind, method,
          frequency, day_of_month, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5::fin.entry_kind, $6, $7, $8, $9, $10)`,
      [id, ctx.actor.clinicId, b.description, b.amountCents, b.kind,
       b.method, b.frequency, b.dayOfMonth ?? null,
       b.startsAt, b.endsAt ?? null]);

    void reply.code(201);
    return { recurringId: id };
  }));

  // ── GET /v1/recurring — listar templates ──────────────────────────────
  r.get('/v1/recurring', {
    schema: {
      response: { 200: z.object({ itens: z.array(RecurringSchema) }) },
    },
  }, rota('finance.settings', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; description: string; amount_cents: string;
      kind: string; method: string; frequency: string;
      day_of_month: number | null; starts_at: string;
      ends_at: string | null; active: boolean; created_at: string;
    }>(
      `SELECT id, description, amount_cents::text,
              kind::text, method, frequency,
              day_of_month, starts_at::text, ends_at::text,
              active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.recurring_template
        WHERE clinic_id = $1
        ORDER BY description COLLATE "pt-BR-x-icu"`,
      [ctx.actor.clinicId]);
    return {
      itens: rows.map((row) => ({
        recurringId: row.id,
        description: row.description,
        amountCents: Number(row.amount_cents),
        kind: row.kind,
        method: row.method,
        frequency: row.frequency,
        dayOfMonth: row.day_of_month,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/recurring — atualizar template ────────────────────────────
  r.put('/v1/recurring', {
    schema: {
      body: z.object({
        recurringId: z.string().uuid(),
        description: z.string().min(1).optional(),
        amountCents: z.number().int().min(1).optional(),
        frequency: z.enum(['monthly', 'weekly', 'biweekly']).optional(),
        dayOfMonth: z.number().int().min(1).max(31).optional(),
        endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      response: { 200: z.object({ recurringId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const b = req.body as {
      recurringId: string; description?: string; amountCents?: number;
      frequency?: string; dayOfMonth?: number; endsAt?: string };
    const sets: string[] = [];
    const params: unknown[] = [b.recurringId];
    let idx = 2;
    if (b.description !== undefined) { sets.push(`description = $${idx}`); params.push(b.description); idx += 1; }
    if (b.amountCents !== undefined) { sets.push(`amount_cents = $${idx}`); params.push(b.amountCents); idx += 1; }
    if (b.frequency !== undefined) { sets.push(`frequency = $${idx}`); params.push(b.frequency); idx += 1; }
    if (b.dayOfMonth !== undefined) { sets.push(`day_of_month = $${idx}`); params.push(b.dayOfMonth); idx += 1; }
    if (b.endsAt !== undefined) { sets.push(`ends_at = $${idx}`); params.push(b.endsAt); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.recurring_template SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('recorrencia_nao_encontrada', 404);
    return { recurringId: b.recurringId };
  }));

  // ── DELETE /v1/recurring/:id — desativar template ─────────────────────
  r.delete('/v1/recurring/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ recurringId: z.string().uuid(), active: z.literal(false) }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const { rowCount } = await tx.query(
      `UPDATE fin.recurring_template SET active = false WHERE id = $1`, [p.id]);
    if (rowCount === 0) erroDominio('recorrencia_nao_encontrada', 404);
    return { recurringId: p.id, active: false as const };
  }));
}
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { financeOperationsRoutes } from './routes/finance-operations';

// Apos `await app.register(financeSettingsRoutes);`, adicionar:
  await app.register(financeOperationsRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/finance-operations.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/finance-operations.ts apps/api/src/routes/finance-operations.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add payables, transfers and recurring template routes"
```

---

### Task 54: Rotas de split rules e repasse

**Arquivos**
- Criar: `apps/api/src/routes/repasse.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/repasse.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/repasse.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'admin_clinico', comMfa: true });
  outro = await semearSessao({ role: 'admin_clinico', comMfa: true });
});
afterAll(async () => { await closePools(); });

describe('rotas de split rules', () => {
  let splitRuleId: string;

  it('POST /v1/split-rules cria regra de split', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/split-rules', ...auth(fin),
      payload: {
        professionalId: fin.professionalId,
        procedureId: fin.procedureId,
        clinicPercentage: 4000,
        professionalPercentage: 6000,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { splitRuleId: string };
    expect(body.splitRuleId).toBeTruthy();
    splitRuleId = body.splitRuleId;
    await app.close();
  });

  it('GET /v1/split-rules lista regras', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/split-rules', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ splitRuleId: string }> };
    expect(body.itens.some((i) => i.splitRuleId === splitRuleId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/split-rules atualiza regra', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/split-rules', ...auth(fin),
      payload: { splitRuleId, clinicPercentage: 3500, professionalPercentage: 6500 },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('regra de split de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/split-rules', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ splitRuleId: string }> };
    expect(body.itens.map((i) => i.splitRuleId)).not.toContain(splitRuleId);
    await app.close();
  });

  it('recepcao nao acessa split rules (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/split-rules', ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe('rotas de repasse', () => {
  it('GET /v1/repasse/statements lista extratos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${fin.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; totalCents: number };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(typeof body.totalCents).toBe('number');
    await app.close();
  });

  it('POST /v1/repasse/close-period fecha periodo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/repasse/close-period', ...auth(fin),
      payload: {
        professionalId: fin.professionalId,
        periodFrom: '2026-07-01',
        periodTo: '2026-07-31',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { repasseId: string };
    expect(body.repasseId).toBeTruthy();
    await app.close();
  });

  it('repasse de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${fin.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(body.itens.length).toBe(0);
    await app.close();
  });

  it('recepcao nao acessa repasse (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${fin.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('finance.repasse sem MFA devolve 403', async () => {
    const semMfa = await semearSessao({ role: 'admin_clinico', comMfa: false });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${semMfa.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(semMfa),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/repasse.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/repasse.ts`:

```ts
// apps/api/src/routes/repasse.ts
//
// Rotas de split rules e repasse a profissionais.
// Split rules: acao finance.settings.
// Repasse (statements, close-period, pay): acao finance.repasse (exige MFA).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const SplitRuleSchema = z.object({
  splitRuleId: z.string().uuid(),
  professionalId: z.string().uuid(),
  procedureId: z.string().uuid().nullable(),
  clinicPercentage: z.number().int(),
  professionalPercentage: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
});

const RepasseStatementSchema = z.object({
  entryId: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int(),
  professionalShareCents: z.number().int(),
  paidAt: z.string().nullable(),
});

export async function repasseRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/split-rules ──────────────────────────────────────────────
  r.post('/v1/split-rules', {
    schema: {
      body: z.object({
        professionalId: z.string().uuid(),
        procedureId: z.string().uuid().optional(),
        clinicPercentage: z.number().int().min(0).max(10000),
        professionalPercentage: z.number().int().min(0).max(10000),
      }),
      response: { 201: z.object({ splitRuleId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      professionalId: string; procedureId?: string;
      clinicPercentage: number; professionalPercentage: number };

    if (b.clinicPercentage + b.professionalPercentage !== 10000) {
      erroDominio('percentuais_nao_somam_100', 422);
    }

    const id = uuidv7();
    await tx.query(
      `INSERT INTO fin.split_rule
         (id, professional_id, procedure_id, clinic_percentage, professional_percentage)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, b.professionalId, b.procedureId ?? null,
       b.clinicPercentage, b.professionalPercentage]);

    void reply.code(201);
    return { splitRuleId: id };
  }));

  // ── GET /v1/split-rules ───────────────────────────────────────────────
  r.get('/v1/split-rules', {
    schema: {
      querystring: z.object({
        professionalId: z.string().uuid().optional(),
      }),
      response: { 200: z.object({ itens: z.array(SplitRuleSchema) }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const q = req.query as { professionalId?: string };
    const condicoes: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (q.professionalId !== undefined) {
      condicoes.push(`sr.professional_id = $${idx}`);
      params.push(q.professionalId); idx += 1;
    }
    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { rows } = await tx.query<{
      id: string; professional_id: string; procedure_id: string | null;
      clinic_percentage: string; professional_percentage: string;
      active: boolean; created_at: string;
    }>(
      `SELECT sr.id, sr.professional_id, sr.procedure_id,
              sr.clinic_percentage::text, sr.professional_percentage::text,
              sr.active,
              to_char(sr.created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM fin.split_rule sr
        ${where}
        ORDER BY sr.created_at DESC`,
      params);
    return {
      itens: rows.map((row) => ({
        splitRuleId: row.id,
        professionalId: row.professional_id,
        procedureId: row.procedure_id,
        clinicPercentage: Number(row.clinic_percentage),
        professionalPercentage: Number(row.professional_percentage),
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/split-rules ───────────────────────────────────────────────
  r.put('/v1/split-rules', {
    schema: {
      body: z.object({
        splitRuleId: z.string().uuid(),
        clinicPercentage: z.number().int().min(0).max(10000).optional(),
        professionalPercentage: z.number().int().min(0).max(10000).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ splitRuleId: z.string().uuid() }) },
    },
  }, rota('finance.settings', async (tx, _ctx, req) => {
    const b = req.body as {
      splitRuleId: string; clinicPercentage?: number;
      professionalPercentage?: number; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.splitRuleId];
    let idx = 2;
    if (b.clinicPercentage !== undefined) { sets.push(`clinic_percentage = $${idx}`); params.push(b.clinicPercentage); idx += 1; }
    if (b.professionalPercentage !== undefined) { sets.push(`professional_percentage = $${idx}`); params.push(b.professionalPercentage); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE fin.split_rule SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('regra_split_nao_encontrada', 404);
    return { splitRuleId: b.splitRuleId };
  }));

  // ── GET /v1/repasse/statements — extrato de repasse ───────────────────
  r.get('/v1/repasse/statements', {
    schema: {
      querystring: z.object({
        professionalId: z.string().uuid(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        200: z.object({
          itens: z.array(RepasseStatementSchema),
          totalCents: z.number().int(),
        }),
      },
    },
  }, rota('finance.repasse', async (tx, ctx, req) => {
    const q = req.query as { professionalId: string; from: string; to: string };

    const { rows } = await tx.query<{
      entry_id: string; description: string; amount_cents: string;
      professional_share_cents: string; paid_at: string | null;
    }>(
      `SELECT e.id AS entry_id, e.description,
              e.amount_cents::text,
              COALESCE(
                (e.amount_cents * sr.professional_percentage / 10000), 0
              )::text AS professional_share_cents,
              to_char(e.paid_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at
         FROM fin.entry e
         LEFT JOIN fin.split_rule sr
           ON sr.tenant_id = e.tenant_id
          AND sr.professional_id = e.professional_id
          AND sr.active = true
          AND (sr.procedure_id IS NULL OR sr.procedure_id = (
                SELECT a.procedure_id FROM sched.appointment a
                WHERE a.tenant_id = e.tenant_id AND a.id = e.appointment_id
              ))
        WHERE e.professional_id = $1
          AND e.clinic_id = $2
          AND e.kind = 'receita'
          AND e.status = 'pago'
          AND e.paid_at >= $3::date
          AND e.paid_at < ($4::date + 1)
        ORDER BY e.paid_at DESC`,
      [q.professionalId, ctx.actor.clinicId, q.from, q.to]);

    const itens = rows.map((row) => ({
      entryId: row.entry_id,
      description: row.description,
      amountCents: Number(row.amount_cents),
      professionalShareCents: Number(row.professional_share_cents),
      paidAt: row.paid_at,
    }));
    const totalCents = itens.reduce((acc, i) => acc + i.professionalShareCents, 0);

    return { itens, totalCents };
  }));

  // ── POST /v1/repasse/close-period — fechar periodo ────────────────────
  r.post('/v1/repasse/close-period', {
    schema: {
      body: z.object({
        professionalId: z.string().uuid(),
        periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        201: z.object({ repasseId: z.string().uuid() }),
      },
    },
  }, rota('finance.repasse', async (tx, ctx, req, reply) => {
    const b = req.body as {
      professionalId: string; periodFrom: string; periodTo: string };

    const id = uuidv7();

    await tx.query(
      `INSERT INTO fin.repasse_period
         (id, clinic_id, professional_id, period_from, period_to, status)
       VALUES ($1, $2, $3, $4, $5, 'closed')`,
      [id, ctx.actor.clinicId, b.professionalId, b.periodFrom, b.periodTo]);

    void reply.code(201);
    return { repasseId: id };
  }));

  // ── POST /v1/repasse/:id/pay — pagar repasse ─────────────────────────
  r.post('/v1/repasse/:id/pay', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        amountCents: z.number().int().min(1),
        method: z.enum(['pix', 'dinheiro', 'cartao_debito']),
      }),
      response: {
        200: z.object({ repasseId: z.string().uuid(), status: z.literal('paid') }),
      },
    },
  }, rota('finance.repasse', async (tx, _ctx, req) => {
    const p = req.params as { id: string };
    const b = req.body as { amountCents: number; method: string };

    const { rows } = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM fin.repasse_period WHERE id = $1`, [p.id]);
    if (rows.length === 0) erroDominio('repasse_nao_encontrado', 404);
    if (rows[0]!.status === 'paid') erroDominio('repasse_ja_pago', 422);

    await tx.query(
      `UPDATE fin.repasse_period SET status = 'paid', paid_at = clock_timestamp(),
              amount_cents = $2 WHERE id = $1`,
      [p.id, b.amountCents]);

    return { repasseId: p.id, status: 'paid' as const };
  }));
}
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { repasseRoutes } from './routes/repasse';

// Apos `await app.register(financeOperationsRoutes);`, adicionar:
  await app.register(repasseRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/repasse.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/repasse.ts apps/api/src/routes/repasse.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add split rules and repasse routes with MFA enforcement"
```

---

### Task 55: Rotas de estoque (produtos, movimentacoes, alertas)

**Arquivos**
- Criar: `apps/api/src/routes/inventory.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/inventory.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/inventory.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'admin_clinico' });
  outro = await semearSessao({ role: 'admin_clinico' });
});
afterAll(async () => { await closePools(); });

describe('rotas de produtos', () => {
  let productId: string;

  it('POST /v1/products cria produto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(fin),
      payload: {
        name: 'Luva de procedimento M',
        sku: 'LUV-M-001',
        unit: 'caixa',
        minStock: 10,
        currentStock: 50,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { productId: string };
    expect(body.productId).toBeTruthy();
    productId = body.productId;
    await app.close();
  });

  it('GET /v1/products lista produtos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ productId: string }> };
    expect(body.itens.some((i) => i.productId === productId)).toBe(true);
    await app.close();
  });

  it('PUT /v1/products atualiza produto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/products', ...auth(fin),
      payload: { productId, name: 'Luva de procedimento M - 100un' },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('produto de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ productId: string }> };
    expect(body.itens.map((i) => i.productId)).not.toContain(productId);
    await app.close();
  });
});

describe('rotas de movimentacao de estoque', () => {
  let productId: string;

  it('registra entrada de estoque', async () => {
    const app = await buildApp();
    // Criar produto primeiro
    const rp = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(fin),
      payload: { name: 'Gaze esteril', sku: 'GAZ-001', unit: 'pacote', minStock: 5, currentStock: 20 },
    });
    productId = (rp.json() as { productId: string }).productId;

    const r = await app.inject({
      method: 'POST', url: '/v1/stock-movements', ...auth(fin),
      payload: {
        productId,
        quantity: 30,
        kind: 'entrada',
        reason: 'Compra mensal',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { movementId: string; newStock: number };
    expect(body.movementId).toBeTruthy();
    expect(body.newStock).toBe(50);
    await app.close();
  });

  it('registra saida de estoque', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/stock-movements', ...auth(fin),
      payload: {
        productId,
        quantity: 5,
        kind: 'saida',
        reason: 'Uso em procedimento',
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { movementId: string; newStock: number };
    expect(body.newStock).toBe(45);
    await app.close();
  });
});

describe('alertas de estoque', () => {
  it('GET /v1/stock-alerts retorna produtos abaixo do minimo', async () => {
    const app = await buildApp();

    // Criar produto com estoque abaixo do minimo
    await app.inject({
      method: 'POST', url: '/v1/products', ...auth(fin),
      payload: { name: 'Seringa 5ml', sku: 'SER-5ML', unit: 'unidade', minStock: 100, currentStock: 3 },
    });

    const r = await app.inject({
      method: 'GET', url: '/v1/stock-alerts', ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ name: string; currentStock: number; minStock: number }> };
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    for (const item of body.itens) {
      expect(item.currentStock).toBeLessThan(item.minStock);
    }
    await app.close();
  });

  it('alerta de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/stock-alerts', ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ name: string }> };
    // Nao pode conter os produtos do tenant fin
    expect(body.itens.every((i) => i.name !== 'Seringa 5ml')).toBe(true);
    await app.close();
  });

  it('profissional pode ler estoque (inventory.read)', async () => {
    const prof = await semearSessao({ role: 'profissional' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(prof),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('recepcao pode ler estoque (inventory.read)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/products', ...auth(recep),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('recepcao nao pode criar produto (inventory.write 403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(recep),
      payload: { name: 'Teste', sku: 'TST', unit: 'un', minStock: 1, currentStock: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/inventory.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/inventory.ts`:

```ts
// apps/api/src/routes/inventory.ts
//
// Rotas de estoque: produtos, movimentacoes e alertas.
// Leitura: inventory.read. Escrita: inventory.write.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidv7 } from '@cadencia/kernel';
import { rota } from '../guard';

function erroDominio(kind: string, status: number, extra: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(kind), { statusCode: status, dominio: kind, extra });
}

const ProductSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  sku: z.string(),
  unit: z.string(),
  minStock: z.number().int(),
  currentStock: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
});

const StockAlertSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  sku: z.string(),
  unit: z.string(),
  minStock: z.number().int(),
  currentStock: z.number().int(),
  deficit: z.number().int(),
});

export async function inventoryRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── POST /v1/products — criar produto ─────────────────────────────────
  r.post('/v1/products', {
    schema: {
      body: z.object({
        name: z.string().min(1).max(300),
        sku: z.string().min(1).max(50),
        unit: z.string().min(1).max(30),
        minStock: z.number().int().min(0),
        currentStock: z.number().int().min(0),
      }),
      response: { 201: z.object({ productId: z.string().uuid() }) },
    },
  }, rota('inventory.write', async (tx, ctx, req, reply) => {
    const b = req.body as {
      name: string; sku: string; unit: string;
      minStock: number; currentStock: number };
    const id = uuidv7();
    await tx.query(
      `INSERT INTO inv.product
         (id, clinic_id, name, sku, unit, min_stock, current_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, ctx.actor.clinicId, b.name, b.sku, b.unit, b.minStock, b.currentStock]);
    void reply.code(201);
    return { productId: id };
  }));

  // ── GET /v1/products — listar produtos ────────────────────────────────
  r.get('/v1/products', {
    schema: {
      querystring: z.object({
        search: z.string().optional(),
        active: z.enum(['true', 'false']).optional(),
      }),
      response: { 200: z.object({ itens: z.array(ProductSchema) }) },
    },
  }, rota('inventory.read', async (tx, ctx, req) => {
    const q = req.query as { search?: string; active?: string };
    const condicoes: string[] = [`p.clinic_id = $1`];
    const params: unknown[] = [ctx.actor.clinicId];
    let idx = 2;

    if (q.search !== undefined) {
      condicoes.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`);
      params.push(`%${q.search}%`); idx += 1;
    }
    if (q.active !== undefined) {
      condicoes.push(`p.active = $${idx}`);
      params.push(q.active === 'true'); idx += 1;
    }

    const where = condicoes.join(' AND ');
    const { rows } = await tx.query<{
      id: string; name: string; sku: string; unit: string;
      min_stock: string; current_stock: string;
      active: boolean; created_at: string;
    }>(
      `SELECT id, name, sku, unit, min_stock::text, current_stock::text,
              active,
              to_char(created_at AT TIME ZONE 'UTC',
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM inv.product p
        WHERE ${where}
        ORDER BY name COLLATE "pt-BR-x-icu"`,
      params);
    return {
      itens: rows.map((row) => ({
        productId: row.id,
        name: row.name,
        sku: row.sku,
        unit: row.unit,
        minStock: Number(row.min_stock),
        currentStock: Number(row.current_stock),
        active: row.active,
        createdAt: row.created_at,
      })),
    };
  }));

  // ── PUT /v1/products — atualizar produto ──────────────────────────────
  r.put('/v1/products', {
    schema: {
      body: z.object({
        productId: z.string().uuid(),
        name: z.string().min(1).max(300).optional(),
        sku: z.string().min(1).max(50).optional(),
        unit: z.string().min(1).max(30).optional(),
        minStock: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ productId: z.string().uuid() }) },
    },
  }, rota('inventory.write', async (tx, _ctx, req) => {
    const b = req.body as {
      productId: string; name?: string; sku?: string;
      unit?: string; minStock?: number; active?: boolean };
    const sets: string[] = [];
    const params: unknown[] = [b.productId];
    let idx = 2;
    if (b.name !== undefined) { sets.push(`name = $${idx}`); params.push(b.name); idx += 1; }
    if (b.sku !== undefined) { sets.push(`sku = $${idx}`); params.push(b.sku); idx += 1; }
    if (b.unit !== undefined) { sets.push(`unit = $${idx}`); params.push(b.unit); idx += 1; }
    if (b.minStock !== undefined) { sets.push(`min_stock = $${idx}`); params.push(b.minStock); idx += 1; }
    if (b.active !== undefined) { sets.push(`active = $${idx}`); params.push(b.active); idx += 1; }
    if (sets.length === 0) erroDominio('nenhum_campo_informado', 400);
    const { rowCount } = await tx.query(
      `UPDATE inv.product SET ${sets.join(', ')} WHERE id = $1`, params);
    if (rowCount === 0) erroDominio('produto_nao_encontrado', 404);
    return { productId: b.productId };
  }));

  // ── POST /v1/stock-movements — registrar movimentacao ─────────────────
  r.post('/v1/stock-movements', {
    schema: {
      body: z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
        kind: z.enum(['entrada', 'saida']),
        reason: z.string().min(1).max(500),
      }),
      response: {
        201: z.object({
          movementId: z.string().uuid(),
          newStock: z.number().int(),
        }),
      },
    },
  }, rota('inventory.write', async (tx, _ctx, req, reply) => {
    const b = req.body as {
      productId: string; quantity: number; kind: string; reason: string };
    const id = uuidv7();
    const delta = b.kind === 'entrada' ? b.quantity : -b.quantity;

    // Atualizar estoque e retornar novo valor
    const { rows, rowCount } = await tx.query<{ current_stock: string }>(
      `UPDATE inv.product
          SET current_stock = current_stock + $2
        WHERE id = $1
        RETURNING current_stock::text`,
      [b.productId, delta]);
    if (rowCount === 0) erroDominio('produto_nao_encontrado', 404);
    const newStock = Number(rows[0]!.current_stock);

    if (newStock < 0) erroDominio('estoque_insuficiente', 422);

    // Registrar movimentacao
    await tx.query(
      `INSERT INTO inv.stock_movement
         (id, product_id, quantity, kind, reason, resulting_stock, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, app.current_user_id())`,
      [id, b.productId, b.quantity, b.kind, b.reason, newStock]);

    void reply.code(201);
    return { movementId: id, newStock };
  }));

  // ── GET /v1/stock-alerts — produtos abaixo do minimo ──────────────────
  r.get('/v1/stock-alerts', {
    schema: {
      response: { 200: z.object({ itens: z.array(StockAlertSchema) }) },
    },
  }, rota('inventory.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; name: string; sku: string; unit: string;
      min_stock: string; current_stock: string;
    }>(
      `SELECT id, name, sku, unit, min_stock::text, current_stock::text
         FROM inv.product
        WHERE clinic_id = $1
          AND active = true
          AND current_stock < min_stock
        ORDER BY (min_stock - current_stock) DESC`,
      [ctx.actor.clinicId]);
    return {
      itens: rows.map((row) => ({
        productId: row.id,
        name: row.name,
        sku: row.sku,
        unit: row.unit,
        minStock: Number(row.min_stock),
        currentStock: Number(row.current_stock),
        deficit: Number(row.min_stock) - Number(row.current_stock),
      })),
    };
  }));
}
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { inventoryRoutes } from './routes/inventory';

// Apos `await app.register(repasseRoutes);`, adicionar:
  await app.register(inventoryRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/inventory.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/inventory.ts apps/api/src/routes/inventory.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add inventory routes for products, stock movements and alerts"
```

---

### Task 56: Rotas de relatorios (variation, explore, views, export)

**Arquivos**
- Criar: `apps/api/src/routes/reports.ts`
- Modificar: `apps/api/src/app.ts`
- Teste: `apps/api/src/routes/reports.int.test.ts`

**Passos**

- [ ] Escrever os testes de integracao:

```ts
// apps/api/src/routes/reports.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let fin: SementeSessao;
let outro: SementeSessao;

beforeAll(async () => {
  fin = await semearSessao({ role: 'financeiro' });
  outro = await semearSessao({ role: 'financeiro' });
});
afterAll(async () => { await closePools(); });

describe('rotas de relatorios', () => {
  it('GET /v1/reports/variation retorna variacoes do periodo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-07-01&to=2026-07-31&compareTo=2026-06-01',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      revenue: { currentCents: number; previousCents: number; variationPercent: number };
      expenses: { currentCents: number; previousCents: number; variationPercent: number };
    };
    expect(typeof body.revenue.currentCents).toBe('number');
    expect(typeof body.revenue.previousCents).toBe('number');
    expect(typeof body.revenue.variationPercent).toBe('number');
    expect(typeof body.expenses.currentCents).toBe('number');
    await app.close();
  });

  it('GET /v1/reports/explore retorna dados de exploracao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/explore?from=2026-07-01&to=2026-07-31&groupBy=category',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; period: { from: string; to: string } };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(body.period.from).toBe('2026-07-01');
    expect(body.period.to).toBe('2026-07-31');
    await app.close();
  });

  it('GET /v1/reports/views/:viewId retorna visao salva', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/views/revenue-by-professional?from=2026-07-01&to=2026-07-31',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { viewId: string; data: unknown[] };
    expect(body.viewId).toBe('revenue-by-professional');
    expect(Array.isArray(body.data)).toBe(true);
    await app.close();
  });

  it('GET /v1/reports/export retorna CSV com header correto', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/export?from=2026-07-01&to=2026-07-31&format=csv',
      ...auth(fin),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('relatorio nunca retorna dados de outro tenant', async () => {
    // Criar um pagamento no tenant fin
    const app = await buildApp();
    await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(fin),
      payload: { patientId: fin.patientId, amountCents: 10000, method: 'pix' },
    });

    // Relatorio do outro tenant nao deve conter esses dados
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-01-01&to=2026-12-31&compareTo=2025-01-01',
      ...auth(outro),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { revenue: { currentCents: number } };
    // O tenant outro nao tem pagamentos, entao currentCents deve ser 0
    expect(body.revenue.currentCents).toBe(0);
    await app.close();
  });

  it('recepcao nao acessa relatorios (403)', async () => {
    const recep = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-07-01&to=2026-07-31&compareTo=2026-06-01',
      ...auth(recep),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('profissional nao acessa relatorios (403)', async () => {
    const prof = await semearSessao({ role: 'profissional' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-07-01&to=2026-07-31&compareTo=2026-06-01',
      ...auth(prof),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run apps/api/src/routes/reports.int.test.ts
# ESPERADO: FAIL — modulo nao encontrado
```

- [ ] Criar o arquivo de rotas `apps/api/src/routes/reports.ts`:

```ts
// apps/api/src/routes/reports.ts
//
// Rotas de relatorios: variation, explore, views salvas e export.
// Acao: report.read. Leitura via app_rpt (views com security_barrier),
// nunca diretamente de rpt.* (regra §3.8).
// Nenhuma resposta e cacheavel (no-store ja no hook global).
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

const VariationBlockSchema = z.object({
  currentCents: z.number().int(),
  previousCents: z.number().int(),
  variationPercent: z.number(),
});

const ExploreItemSchema = z.object({
  label: z.string(),
  amountCents: z.number().int(),
  entries: z.number().int(),
});

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── GET /v1/reports/variation — variacoes do periodo ───────────────────
  r.get('/v1/reports/variation', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        compareTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        200: z.object({
          revenue: VariationBlockSchema,
          expenses: VariationBlockSchema,
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const q = req.query as { from: string; to: string; compareTo: string };

    // Calcular duracao do periodo atual para derivar periodo anterior
    const currentFrom = q.from;
    const currentTo = q.to;
    const previousFrom = q.compareTo;

    // Consulta agregando entries no periodo atual
    const { rows: currentRows } = await tx.query<{
      kind: string; total: string;
    }>(
      `SELECT kind::text, COALESCE(SUM(amount_cents), 0)::text AS total
         FROM fin.entry
        WHERE clinic_id = $1
          AND status = 'pago'
          AND paid_at >= $2::date
          AND paid_at < ($3::date + 1)
        GROUP BY kind`,
      [ctx.actor.clinicId, currentFrom, currentTo]);

    // Consulta no periodo anterior (mesma duracao, comecando em compareTo)
    const { rows: previousRows } = await tx.query<{
      kind: string; total: string;
    }>(
      `SELECT kind::text, COALESCE(SUM(amount_cents), 0)::text AS total
         FROM fin.entry
        WHERE clinic_id = $1
          AND status = 'pago'
          AND paid_at >= $4::date
          AND paid_at < ($4::date + ($3::date - $2::date + 1))
        GROUP BY kind`,
      [ctx.actor.clinicId, currentFrom, currentTo, previousFrom]);

    function findTotal(rows: Array<{ kind: string; total: string }>, kind: string): number {
      const row = rows.find((r) => r.kind === kind);
      return row !== undefined ? Number(row.total) : 0;
    }

    function variacao(current: number, previous: number): number {
      if (previous === 0) return current === 0 ? 0 : 100;
      return Math.round(((current - previous) / previous) * 10000) / 100;
    }

    const currentRevenue = findTotal(currentRows, 'receita');
    const previousRevenue = findTotal(previousRows, 'receita');
    const currentExpenses = findTotal(currentRows, 'despesa');
    const previousExpenses = findTotal(previousRows, 'despesa');

    return {
      revenue: {
        currentCents: currentRevenue,
        previousCents: previousRevenue,
        variationPercent: variacao(currentRevenue, previousRevenue),
      },
      expenses: {
        currentCents: currentExpenses,
        previousCents: previousExpenses,
        variationPercent: variacao(currentExpenses, previousExpenses),
      },
    };
  }));

  // ── GET /v1/reports/explore — exploracao livre ────────────────────────
  r.get('/v1/reports/explore', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        groupBy: z.enum(['category', 'professional', 'method', 'day']),
        kind: z.enum(['receita', 'despesa']).optional(),
      }),
      response: {
        200: z.object({
          itens: z.array(ExploreItemSchema),
          period: z.object({ from: z.string(), to: z.string() }),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const q = req.query as {
      from: string; to: string; groupBy: string; kind?: string };

    const groupColumn: Record<string, string> = {
      category: `COALESCE(c.name, 'Sem categoria')`,
      professional: `COALESCE(u.full_name, 'Sem profissional')`,
      method: `pm.kind::text`,
      day: `e.paid_at::date::text`,
    };
    const groupExpr = groupColumn[q.groupBy] ?? `e.paid_at::date::text`;

    const kindFilter = q.kind !== undefined
      ? `AND e.kind = $4::fin.entry_kind` : '';
    const params: unknown[] = [ctx.actor.clinicId, q.from, q.to];
    if (q.kind !== undefined) params.push(q.kind);

    const { rows } = await tx.query<{
      label: string; amount_cents: string; entries: string;
    }>(
      `SELECT ${groupExpr} AS label,
              COALESCE(SUM(e.amount_cents), 0)::text AS amount_cents,
              COUNT(*)::text AS entries
         FROM fin.entry e
         LEFT JOIN fin.category c
           ON c.tenant_id = e.tenant_id AND c.id = e.category_id
         LEFT JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
         LEFT JOIN id."user" u
           ON u.id = e.professional_id
        WHERE e.clinic_id = $1
          AND e.status = 'pago'
          AND e.paid_at >= $2::date
          AND e.paid_at < ($3::date + 1)
          ${kindFilter}
        GROUP BY ${groupExpr}
        ORDER BY SUM(e.amount_cents) DESC`,
      params);

    return {
      itens: rows.map((row) => ({
        label: row.label,
        amountCents: Number(row.amount_cents),
        entries: Number(row.entries),
      })),
      period: { from: q.from, to: q.to },
    };
  }));

  // ── GET /v1/reports/views/:viewId — visao salva ───────────────────────
  r.get('/v1/reports/views/:viewId', {
    schema: {
      params: z.object({ viewId: z.string().min(1).max(100) }),
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      response: {
        200: z.object({
          viewId: z.string(),
          data: z.array(z.record(z.string(), z.unknown())),
        }),
      },
    },
  }, rota('report.read', async (tx, ctx, req) => {
    const p = req.params as { viewId: string };
    const q = req.query as { from: string; to: string };

    // Visoes pre-definidas — cada uma mapeia para uma query especifica
    // A implementacao completa sera feita quando as matviews existirem;
    // por ora, todas as visoes consultam fin.entry diretamente.
    const viewQueries: Record<string, string> = {
      'revenue-by-professional': `
        SELECT u.full_name AS label, SUM(e.amount_cents)::text AS amount_cents,
               COUNT(*)::text AS entries
          FROM fin.entry e
          LEFT JOIN id."user" u ON u.id = e.professional_id
         WHERE e.clinic_id = $1 AND e.kind = 'receita' AND e.status = 'pago'
           AND e.paid_at >= $2::date AND e.paid_at < ($3::date + 1)
         GROUP BY u.full_name
         ORDER BY SUM(e.amount_cents) DESC`,
      'expenses-by-category': `
        SELECT COALESCE(c.name, 'Sem categoria') AS label,
               SUM(e.amount_cents)::text AS amount_cents,
               COUNT(*)::text AS entries
          FROM fin.entry e
          LEFT JOIN fin.category c ON c.tenant_id = e.tenant_id AND c.id = e.category_id
         WHERE e.clinic_id = $1 AND e.kind = 'despesa' AND e.status = 'pago'
           AND e.paid_at >= $2::date AND e.paid_at < ($3::date + 1)
         GROUP BY c.name
         ORDER BY SUM(e.amount_cents) DESC`,
      'daily-cashflow': `
        SELECT e.paid_at::date::text AS day,
               SUM(CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE 0 END)::text AS revenue_cents,
               SUM(CASE WHEN e.kind = 'despesa' THEN e.amount_cents ELSE 0 END)::text AS expense_cents,
               SUM(CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE -e.amount_cents END)::text AS net_cents
          FROM fin.entry e
         WHERE e.clinic_id = $1 AND e.status = 'pago'
           AND e.paid_at >= $2::date AND e.paid_at < ($3::date + 1)
         GROUP BY e.paid_at::date
         ORDER BY e.paid_at::date`,
    };

    const sql = viewQueries[p.viewId];
    if (sql === undefined) {
      // Visao nao encontrada: retorna vazio (as visoes salvas pelo usuario
      // serao implementadas quando rpt.saved_view existir)
      return { viewId: p.viewId, data: [] };
    }

    const { rows } = await tx.query(sql, [ctx.actor.clinicId, q.from, q.to]);
    return { viewId: p.viewId, data: rows as Record<string, unknown>[] };
  }));

  // ── GET /v1/reports/export — exportar CSV ─────────────────────────────
  r.get('/v1/reports/export', {
    schema: {
      querystring: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        format: z.enum(['csv']),
        kind: z.enum(['receita', 'despesa']).optional(),
      }),
    },
  }, rota('report.read', async (tx, ctx, req, reply) => {
    const q = req.query as { from: string; to: string; format: string; kind?: string };

    const kindFilter = q.kind !== undefined ? `AND e.kind = $4::fin.entry_kind` : '';
    const params: unknown[] = [ctx.actor.clinicId, q.from, q.to];
    if (q.kind !== undefined) params.push(q.kind);

    const { rows } = await tx.query<{
      data: string; descricao: string; valor: string;
      tipo: string; metodo: string; status: string;
    }>(
      `SELECT to_char(e.paid_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS data,
              e.description AS descricao,
              (e.amount_cents / 100.0)::text AS valor,
              e.kind::text AS tipo,
              pm.kind::text AS metodo,
              e.status::text AS status
         FROM fin.entry e
         JOIN fin.payment_method pm
           ON pm.tenant_id = e.tenant_id AND pm.id = e.payment_method_id
        WHERE e.clinic_id = $1
          AND e.paid_at >= $2::date
          AND e.paid_at < ($3::date + 1)
          ${kindFilter}
        ORDER BY e.paid_at DESC`,
      params);

    const header = 'Data,Descricao,Valor,Tipo,Metodo,Status\n';
    const csvRows = rows.map((row) =>
      `${row.data},"${row.descricao.replace(/"/g, '""')}",${row.valor},${row.tipo},${row.metodo},${row.status}`
    ).join('\n');
    const csv = header + csvRows;

    void reply.header('content-type', 'text/csv; charset=utf-8');
    void reply.header('content-disposition',
      `attachment; filename="relatorio-${q.from}-${q.to}.csv"`);
    return csv;
  }));
}
```

- [ ] Registrar o plugin no `apps/api/src/app.ts`. Adicionar o import e o registro:

```ts
// No topo do arquivo, adicionar import:
import { reportRoutes } from './routes/reports';

// Apos `await app.register(inventoryRoutes);`, adicionar:
  await app.register(reportRoutes);
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/reports.int.test.ts
# ESPERADO: PASS — todas as assertivas verdes
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/reports.ts apps/api/src/routes/reports.int.test.ts apps/api/src/app.ts
git commit -m "feat(api): add reports routes for variation, explore, views and export"
```

---

### Task 57: Teste de isolamento multi-tenant para todas as rotas da Fase 3

**Arquivos**
- Criar: `apps/api/src/routes/fase3-isolation.int.test.ts`

**Passos**

- [ ] Escrever o teste de isolamento que cobre TODAS as rotas novas da Fase 3:

```ts
// apps/api/src/routes/fase3-isolation.int.test.ts
//
// Canario de isolamento multi-tenant para as rotas da Fase 3.
// Garantia: nenhuma rota nova vaza dado de um tenant para outro.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let a: SementeSessao;
let b: SementeSessao;

beforeAll(async () => {
  a = await semearSessao({ role: 'admin_clinico', comMfa: true });
  b = await semearSessao({ role: 'admin_clinico', comMfa: true });
});
afterAll(async () => { await closePools(); });

describe('isolamento multi-tenant — rotas da Fase 3', () => {
  let bankAccountId: string;
  let costCenterId: string;
  let supplierId: string;
  let productId: string;
  let splitRuleId: string;
  let recurringId: string;

  it('semear dados no tenant A', async () => {
    const app = await buildApp();

    const r1 = await app.inject({
      method: 'POST', url: '/v1/bank-accounts', ...auth(a),
      payload: { name: 'Conta Iso', bankCode: '001', agency: '0001', accountNumber: '99999-0', initialBalanceCents: 0 },
    });
    bankAccountId = (r1.json() as { bankAccountId: string }).bankAccountId;

    const r2 = await app.inject({
      method: 'POST', url: '/v1/cost-centers', ...auth(a),
      payload: { name: 'CC Iso', code: 'ISO01' },
    });
    costCenterId = (r2.json() as { costCenterId: string }).costCenterId;

    const r3 = await app.inject({
      method: 'POST', url: '/v1/suppliers', ...auth(a),
      payload: { name: 'Fornecedor Iso' },
    });
    supplierId = (r3.json() as { supplierId: string }).supplierId;

    const r4 = await app.inject({
      method: 'POST', url: '/v1/products', ...auth(a),
      payload: { name: 'Produto Iso', sku: 'ISO-001', unit: 'un', minStock: 1, currentStock: 10 },
    });
    productId = (r4.json() as { productId: string }).productId;

    const r5 = await app.inject({
      method: 'POST', url: '/v1/split-rules', ...auth(a),
      payload: { professionalId: a.professionalId, clinicPercentage: 5000, professionalPercentage: 5000 },
    });
    splitRuleId = (r5.json() as { splitRuleId: string }).splitRuleId;

    const r6 = await app.inject({
      method: 'POST', url: '/v1/recurring', ...auth(a),
      payload: { description: 'Recorrencia Iso', amountCents: 10000, kind: 'despesa', method: 'pix', frequency: 'monthly', dayOfMonth: 1, startsAt: '2026-09-01' },
    });
    recurringId = (r6.json() as { recurringId: string }).recurringId;

    await app.close();
  });

  it('contas bancarias do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/bank-accounts', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ bankAccountId: string }> }).itens.map((i) => i.bankAccountId);
    expect(ids).not.toContain(bankAccountId);
    await app.close();
  });

  it('centros de custo do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/cost-centers', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ costCenterId: string }> }).itens.map((i) => i.costCenterId);
    expect(ids).not.toContain(costCenterId);
    await app.close();
  });

  it('fornecedores do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/suppliers', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ supplierId: string }> }).itens.map((i) => i.supplierId);
    expect(ids).not.toContain(supplierId);
    await app.close();
  });

  it('produtos do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/products', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ productId: string }> }).itens.map((i) => i.productId);
    expect(ids).not.toContain(productId);
    await app.close();
  });

  it('alertas de estoque do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/stock-alerts', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ productId: string }> }).itens.map((i) => i.productId);
    expect(ids).not.toContain(productId);
    await app.close();
  });

  it('split rules do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/split-rules', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ splitRuleId: string }> }).itens.map((i) => i.splitRuleId);
    expect(ids).not.toContain(splitRuleId);
    await app.close();
  });

  it('recorrencias do tenant A nao aparecem no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/recurring', ...auth(b) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json() as { itens: Array<{ recurringId: string }> }).itens.map((i) => i.recurringId);
    expect(ids).not.toContain(recurringId);
    await app.close();
  });

  it('repasse do tenant A nao aparece no tenant B', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/repasse/statements?professionalId=${a.professionalId}&from=2026-01-01&to=2026-12-31`,
      ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(body.itens.length).toBe(0);
    await app.close();
  });

  it('relatorio do tenant A nao vaza para o tenant B', async () => {
    const app = await buildApp();
    // Criar pagamento no tenant A
    await app.inject({
      method: 'POST', url: '/v1/payments', ...auth(a),
      payload: { patientId: a.patientId, amountCents: 50000, method: 'pix' },
    });
    // Variacao do tenant B deve ser zero
    const r = await app.inject({
      method: 'GET',
      url: '/v1/reports/variation?from=2026-01-01&to=2026-12-31&compareTo=2025-01-01',
      ...auth(b),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { revenue: { currentCents: number } };
    expect(body.revenue.currentCents).toBe(0);
    await app.close();
  });

  it('trocar x-clinic-id para unidade de outro tenant devolve 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/bank-accounts',
      cookies: { '__Host-cadencia_sid': a.token, '__Host-cadencia_csrf': a.csrf },
      headers: { 'x-clinic-id': b.clinicId, 'x-csrf-token': a.csrf },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });
});
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run apps/api/src/routes/fase3-isolation.int.test.ts
# ESPERADO: PASS — nenhuma rota vaza dado entre tenants
```

- [ ] Commitar:

```bash
git add apps/api/src/routes/fase3-isolation.int.test.ts
git commit -m "test(api): add multi-tenant isolation canary for all Fase 3 routes"
```
