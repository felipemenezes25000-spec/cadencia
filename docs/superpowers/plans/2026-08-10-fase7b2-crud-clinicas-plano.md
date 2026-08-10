# Fase 7B-2 — CRUD de clinicas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let tenant admins create new clinics and edit CNES/CNPJ of existing ones, through the API and the configuracoes UI.

**Architecture:** Two new API endpoints (GET list + POST create) added to the existing `configuracoes.ts` route file. A migration adds `clinic_id` to the audit meta whitelist. Two new frontend components (ListaClinicas, CriarClinica) wired into the existing configuracoes page. The PUT endpoint already accepts CNES/CNPJ — only the frontend needs updating to send them.

**Tech Stack:** PostgreSQL (migrations), Fastify + Zod (API), React + Tailwind (frontend), Vitest + testing-library (tests)

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `packages/authz/src/actions.ts` | Modify | Add `clinic.create` action |
| `packages/db/migrations/0159_audit_meta_clinic_id.sql` | Create | Add `clinic_id` key to audit whitelist |
| `apps/api/src/routes/configuracoes.ts` | Modify | Add GET/POST clinicas routes |
| `apps/api/src/routes/configuracoes.int.test.ts` | Modify | Add integration tests |
| `apps/web/src/telas/ListaClinicas.tsx` | Create | Table of tenant clinics |
| `apps/web/src/telas/ListaClinicas.test.tsx` | Create | Unit tests |
| `apps/web/src/telas/CriarClinica.tsx` | Create | Modal for creating clinic |
| `apps/web/src/telas/CriarClinica.test.tsx` | Create | Unit tests |
| `apps/web/app/configuracoes/page.tsx` | Modify | Wire components + editable CNES/CNPJ |

---

### Task 1: Add `clinic.create` authz action + migration 0159

**Files:**
- Modify: `packages/authz/src/actions.ts:28-29` (insert new action after `clinic.write`)
- Create: `packages/db/migrations/0159_audit_meta_clinic_id.sql`

- [ ] **Step 1: Add action to authz catalog**

In `packages/authz/src/actions.ts`, insert this entry immediately after the `clinic.write` line (currently around line 29):

```ts
  { key: 'clinic.create', description: 'Criar nova unidade',
    roles: ['admin_clinico'], requiresMfa: true },
```

- [ ] **Step 2: Regenerate authz lock file and verify**

```bash
pnpm authz:seed
pnpm authz:check
```

Expected: both pass, action count goes from 67 to 68.

- [ ] **Step 3: Create migration 0159**

Create `packages/db/migrations/0159_audit_meta_clinic_id.sql`. This migration adds `clinic_id` to the `audit.meta_keys_ok` whitelist. Copy the full function from migration 0158 and add `'clinic_id'` to the NOT IN list (alphabetically, between `'cbos'` and `'corte_retencao'`):

```sql
-- Migration 0159: add clinic_id to audit meta keys whitelist
-- Needed for the CLINIC_CREATE audit event.

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',
              'route',
              'method',
              'status_code',
              'duration_ms',
              'use_case',
              'record_count',
              'version_no',
              'kind',
              'role',
              'grant_id',
              'horas',
              'geradas',
              'puladas',
              'freq',
              'encaixe',
              'pendencias',
              'status',
              'ticket',
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id',
              'standard',
              'verificacao',
              'motivo',
              'paginas',
              'qualidade',
              'ms',
              'provedor',
              'itens',
              'assinatura_valida',
              'acao',
              'amount_cents',
              'payment_method',
              'receipt_number',
              'frequency',
              'total_installments',
              'generated_entries',
              'template_id',
              'supplier_name',
              'from_account',
              'to_account',
              'transfer_id',
              'professional_id',
              'percentage',
              'priority',
              'period_start',
              'period_end',
              'total_entries',
              'total_professional_share',
              'product_name',
              'quantity',
              'movement_kind',
              'reference_type',
              'threshold',
              'current_stock',
              'sku',
              'numero_guia',
              'operadora_nome',
              'registro_ans',
              'guia_status',
              'guia_count',
              'numero_lote',
              'item_count',
              'total_recursado_cents',
              'total_resultados',
              'deferidos',
              'valores_expurgados',
              'anexos_expurgados',
              'corte_retencao',
              'ocorrencias',
              'target_user_id',
              'membership_id',
              'clinic_id'
            )
         );
$fn$;
```

- [ ] **Step 4: Commit**

```bash
git add packages/authz/src/actions.ts packages/authz/src/actions.lock.json packages/db/migrations/0159_audit_meta_clinic_id.sql
git commit -m "feat(authz,db): clinic.create action + migration 0159 audit key clinic_id"
```

---

### Task 2: GET + POST /v1/configuracoes/clinicas routes + integration tests

**Files:**
- Modify: `apps/api/src/routes/configuracoes.ts:1-5` (add import) and after line 100 (add routes)
- Modify: `apps/api/src/routes/configuracoes.int.test.ts` (add test blocks)

**Context:** The existing file has `configuracaoRoutes(app)` registering routes on `r = app.withTypeProvider<ZodTypeProvider>()`. Route handlers use `rota('action.key', async (tx, ctx, req, reply) => { ... })`. The `tx` is a pg client within a transaction that already has `SET LOCAL` for tenant/user context. The `ctx.actor` has `{ tenantId, userId, clinicId }`. RLS on `app.clinic` filters by `tenant_id = current_tenant_id()` automatically.

**Important patterns from existing code:**
- `uuidv7()` from `@cadencia/kernel` for generating IDs
- `reply.code(201)` uses `void reply.code(201)` before return
- Timezone validation queries `pg_timezone_names`
- Audit calls use `audit.log(event, schema, table, entity_id, status, meta_jsonb, clinic_id)`
- Zod body schemas are defined inline in the route schema

- [ ] **Step 1: Add the import for uuidv7**

At the top of `apps/api/src/routes/configuracoes.ts`, add after the existing imports:

```ts
import { uuidv7 } from '@cadencia/kernel';
```

- [ ] **Step 2: Add the ClinicaResumoSchema**

After the existing `ClinicaSchema` definition (around line 25), add:

```ts
const ClinicaResumoSchema = z.object({
  clinicId: z.string().uuid(),
  nome: z.string(),
  cnpj: z.string().nullable(),
  cnes: z.string().nullable(),
  timezone: z.string(),
});
```

- [ ] **Step 3: Add GET /v1/configuracoes/clinicas route**

Inside `configuracaoRoutes`, after the PUT `/v1/configuracoes/clinica` block (after line 100, before the equipe routes), add:

```ts
  // ── Clinicas do tenant ──────────────────────────────────────────────────

  r.get('/v1/configuracoes/clinicas', {
    schema: {
      response: {
        200: z.object({ itens: z.array(ClinicaResumoSchema) }),
      },
    },
  }, rota('clinic.read', async (tx) => {
    const { rows } = await tx.query<{
      id: string; nome: string; cnpj: string | null;
      cnes: string | null; timezone: string;
    }>(`SELECT id, nome, cnpj, cnes, timezone FROM app.clinic ORDER BY nome`);

    return {
      itens: rows.map((c) => ({
        clinicId: c.id, nome: c.nome, cnpj: c.cnpj,
        cnes: c.cnes, timezone: c.timezone,
      })),
    };
  }));

  r.post('/v1/configuracoes/clinicas', {
    schema: {
      body: z.object({
        nome: z.string().min(2).max(120),
        timezone: z.string().min(3).max(60),
        cnpj: z.string().regex(/^[A-Z0-9]{12}[0-9]{2}$/).optional(),
        cnes: z.string().regex(/^\d{7}$/).optional(),
      }),
      response: {
        201: z.object({ clinicId: z.string().uuid() }),
        422: z.object({ erro: z.literal('fuso_invalido') }),
      },
    },
  }, rota('clinic.create', async (tx, ctx, req, reply) => {
    const b = req.body as {
      nome: string; timezone: string; cnpj?: string; cnes?: string;
    };

    const { rows: fuso } = await tx.query<{ existe: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS existe`,
      [b.timezone]);
    if (fuso[0]?.existe !== true) {
      return reply.code(422).send({ erro: 'fuso_invalido' as const });
    }

    const clinicId = uuidv7();

    await tx.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnpj, cnes, timezone)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4, $5)`,
      [clinicId, b.nome, b.cnpj ?? null, b.cnes ?? null, b.timezone]);

    await tx.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role, granted_by)
       VALUES (app.current_tenant_id(), gen_random_uuid(), $1, $2, 'admin_clinico', $1)`,
      [ctx.actor.userId, clinicId]);

    await tx.query(
      `SELECT audit.log('CLINIC_CREATE', 'app', 'clinic', $1, 'sucesso',
              jsonb_build_object('clinic_id', $1::text), $2)`,
      [clinicId, ctx.actor.clinicId]);

    void reply.code(201);
    return { clinicId };
  }));
```

- [ ] **Step 4: Write integration tests**

Append to `apps/api/src/routes/configuracoes.int.test.ts`, inside the existing `describe` structure or as new top-level `describe` blocks:

```ts
describe('lista de clinicas do tenant', () => {
  it('GET /v1/configuracoes/clinicas retorna a clinica da sessao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/clinicas', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.itens).toEqual(expect.arrayContaining([
      expect.objectContaining({ clinicId: s.clinicId, nome: 'Unidade Sessao' }),
    ]));

    await app.close();
  });
});

describe('criacao de clinica', () => {
  it('POST /v1/configuracoes/clinicas cria clinica com auto-membership', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/clinicas',
      payload: { nome: 'Filial Norte', timezone: 'America/Manaus' },
      ...auth(s),
    });

    expect(r.statusCode).toBe(201);
    const { clinicId } = r.json();
    expect(clinicId).toBeDefined();

    const list = await app.inject({
      method: 'GET', url: '/v1/configuracoes/clinicas', ...auth(s) });
    expect(list.json().itens).toEqual(expect.arrayContaining([
      expect.objectContaining({ clinicId, nome: 'Filial Norte', timezone: 'America/Manaus' }),
    ]));

    await app.close();
  });

  it('rejeita timezone invalido com 422', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/clinicas',
      payload: { nome: 'Filial Sul', timezone: 'Nao/Existe' },
      ...auth(s),
    });

    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ erro: 'fuso_invalido' });
    await app.close();
  });

  it('rejeita role sem permissao com 403', async () => {
    const sRec = await semearSessao({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/clinicas',
      payload: { nome: 'Filial Leste', timezone: 'America/Sao_Paulo' },
      ...auth(sRec),
    });

    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('cria clinica com CNPJ e CNES', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/configuracoes/clinicas',
      payload: {
        nome: 'Filial Oeste', timezone: 'America/Cuiaba',
        cnpj: '12345678000190', cnes: '1234567',
      },
      ...auth(s),
    });

    expect(r.statusCode).toBe(201);
    const { clinicId } = r.json();

    const list = await app.inject({
      method: 'GET', url: '/v1/configuracoes/clinicas', ...auth(s) });
    expect(list.json().itens).toEqual(expect.arrayContaining([
      expect.objectContaining({
        clinicId, nome: 'Filial Oeste', cnpj: '12345678000190', cnes: '1234567',
      }),
    ]));

    await app.close();
  });
});

describe('edicao de CNES e CNPJ', () => {
  it('PUT /v1/configuracoes/clinica atualiza CNES e CNPJ', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/configuracoes/clinica',
      payload: { nome: 'Unidade Sessao', timezone: 'America/Sao_Paulo',
                 cnes: '9999999', cnpj: 'AABB00CC000099' },
      ...auth(s),
    });

    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ cnes: '9999999', cnpj: 'AABB00CC000099' });
    await app.close();
  });
});
```

- [ ] **Step 5: Run the integration tests**

```bash
pnpm vitest run apps/api/src/routes/configuracoes.int.test.ts
```

Expected: all tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/configuracoes.ts apps/api/src/routes/configuracoes.int.test.ts
git commit -m "feat(api): GET + POST /v1/configuracoes/clinicas — list and create clinics"
```

---

### Task 3: ListaClinicas component + tests

**Files:**
- Create: `apps/web/src/telas/ListaClinicas.tsx`
- Create: `apps/web/src/telas/ListaClinicas.test.tsx`

**Context:** Follow the pattern of `TabelaEquipe.tsx`. Use Tailwind CSS classes matching the project style (rounded-lg, border-line, bg-surface, text-sm, text-text-muted). The `Botao` component is at `../ui/Botao` and supports `variante`, `tamanho`, `onClick` props.

- [ ] **Step 1: Create ListaClinicas component**

Create `apps/web/src/telas/ListaClinicas.tsx`:

```tsx
'use client';

import { Botao } from '../ui/Botao';

export interface ClinicaResumo {
  readonly clinicId: string;
  readonly nome: string;
  readonly cnpj: string | null;
  readonly cnes: string | null;
  readonly timezone: string;
}

export interface ListaClinicasProps {
  readonly clinicas: ClinicaResumo[];
  readonly clinicaAtivaId: string;
  readonly podeCriar: boolean;
  readonly aoCriar: () => void;
}

const FUSOS_LABEL: Record<string, string> = {
  'America/Sao_Paulo': 'Brasilia',
  'America/Manaus': 'Manaus',
  'America/Cuiaba': 'Cuiaba',
  'America/Belem': 'Belem',
  'America/Fortaleza': 'Fortaleza',
  'America/Recife': 'Recife',
  'America/Rio_Branco': 'Rio Branco',
  'America/Noronha': 'Noronha',
};

export function ListaClinicas({ clinicas, clinicaAtivaId, podeCriar, aoCriar }: ListaClinicasProps) {
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Todas as unidades
        </h2>
        {podeCriar && (
          <Botao variante="primario" tamanho="sm" onClick={aoCriar}>
            Criar unidade
          </Botao>
        )}
      </div>

      {clinicas.length === 0 ? (
        <p className="text-sm text-text-muted">Nenhuma unidade cadastrada.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-text-muted">
                <th className="pb-2 font-medium">Nome</th>
                <th className="pb-2 font-medium">CNES</th>
                <th className="pb-2 font-medium">Fuso</th>
              </tr>
            </thead>
            <tbody>
              {clinicas.map((c) => (
                <tr key={c.clinicId} className="border-b border-line/50">
                  <td className="py-2.5">
                    <span>{c.nome}</span>
                    {c.clinicId === clinicaAtivaId && (
                      <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                        ativa
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 font-mono text-text-muted">
                    {c.cnes ?? '—'}
                  </td>
                  <td className="py-2.5 text-text-muted">
                    {FUSOS_LABEL[c.timezone] ?? c.timezone}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Create ListaClinicas tests**

Create `apps/web/src/telas/ListaClinicas.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ListaClinicas, type ClinicaResumo } from './ListaClinicas';

const CLINICAS: ClinicaResumo[] = [
  { clinicId: 'c1', nome: 'Unidade Centro', cnes: '2077501', cnpj: null, timezone: 'America/Sao_Paulo' },
  { clinicId: 'c2', nome: 'Filial Norte', cnes: null, cnpj: '12345678000190', timezone: 'America/Manaus' },
];

function montar(over: Partial<Parameters<typeof ListaClinicas>[0]> = {}) {
  const props = {
    clinicas: CLINICAS,
    clinicaAtivaId: 'c1',
    podeCriar: true,
    aoCriar: vi.fn(),
    ...over,
  };
  render(<ListaClinicas {...props} />);
  return props;
}

describe('ListaClinicas', () => {
  it('renderiza todas as clinicas com colunas', () => {
    montar();
    expect(screen.getByText('Unidade Centro')).toBeDefined();
    expect(screen.getByText('Filial Norte')).toBeDefined();
    expect(screen.getByText('2077501')).toBeDefined();
    expect(screen.getByText('Brasilia')).toBeDefined();
    expect(screen.getByText('Manaus')).toBeDefined();
  });

  it('destaca a clinica ativa com badge', () => {
    montar();
    expect(screen.getByText('ativa')).toBeDefined();
  });

  it('mostra traco quando CNES e null', () => {
    montar();
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('botao Criar unidade visivel para admin', () => {
    montar({ podeCriar: true });
    expect(screen.getByRole('button', { name: /criar unidade/i })).toBeDefined();
  });

  it('botao Criar unidade oculto para nao-admin', () => {
    montar({ podeCriar: false });
    expect(screen.queryByRole('button', { name: /criar unidade/i })).toBeNull();
  });

  it('chama aoCriar ao clicar no botao', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /criar unidade/i }));
    expect(props.aoCriar).toHaveBeenCalledOnce();
  });

  it('mostra mensagem vazia quando nao ha clinicas', () => {
    montar({ clinicas: [] });
    expect(screen.getByText(/nenhuma unidade/i)).toBeDefined();
  });

  it('passa a11y', async () => {
    const { container } = render(
      <ListaClinicas clinicas={CLINICAS} clinicaAtivaId="c1"
        podeCriar={true} aoCriar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
pnpm vitest run apps/web/src/telas/ListaClinicas.test.tsx
```

Expected: 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/telas/ListaClinicas.tsx apps/web/src/telas/ListaClinicas.test.tsx
git commit -m "feat(web): ListaClinicas component with active badge and a11y tests"
```

---

### Task 4: CriarClinica modal component + tests

**Files:**
- Create: `apps/web/src/telas/CriarClinica.tsx`
- Create: `apps/web/src/telas/CriarClinica.test.tsx`

**Context:** Follow `ConvidarUsuario.tsx` pattern exactly: modal with fixed inset overlay, `role="dialog"` + `aria-modal="true"`, `X` close button from `@phosphor-icons/react`, `Botao` from `../ui/Botao`, returns `null` when `!aberto`. State managed locally, error shown via `role="alert"`, callback receives typed data object.

- [ ] **Step 1: Create CriarClinica component**

Create `apps/web/src/telas/CriarClinica.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { X } from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';

const FUSOS = [
  ['America/Sao_Paulo', 'Brasilia (UTC-3)'],
  ['America/Manaus', 'Manaus (UTC-4)'],
  ['America/Cuiaba', 'Cuiaba (UTC-4)'],
  ['America/Belem', 'Belem (UTC-3)'],
  ['America/Fortaleza', 'Fortaleza (UTC-3)'],
  ['America/Recife', 'Recife (UTC-3)'],
  ['America/Rio_Branco', 'Rio Branco (UTC-5)'],
  ['America/Noronha', 'Fernando de Noronha (UTC-2)'],
] as const;

export interface DadosCriacaoClinica {
  readonly nome: string;
  readonly timezone: string;
  readonly cnpj?: string;
  readonly cnes?: string;
}

export interface CriarClinicaProps {
  readonly aberto: boolean;
  readonly aoFechar: () => void;
  readonly aoCriar: (dados: DadosCriacaoClinica) => Promise<void>;
}

export function CriarClinica({ aberto, aoFechar, aoCriar }: CriarClinicaProps) {
  const [nome, setNome] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [cnpj, setCnpj] = useState('');
  const [cnes, setCnes] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valida = nome.length >= 2;

  function resetar() {
    setNome(''); setTimezone('America/Sao_Paulo');
    setCnpj(''); setCnes(''); setErro(null);
  }

  async function submeter(ev: FormEvent) {
    ev.preventDefault();
    if (!valida || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const dados: DadosCriacaoClinica = {
        nome, timezone,
        ...(cnpj ? { cnpj } : {}),
        ...(cnes ? { cnes } : {}),
      };
      await aoCriar(dados);
      resetar();
      aoFechar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar';
      setErro(
        msg === 'fuso_invalido'
          ? 'Fuso horario invalido.'
          : 'Nao foi possivel criar a unidade.',
      );
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog" aria-modal="true" aria-label="Criar unidade">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Criar unidade</h2>
          <button type="button" onClick={() => { resetar(); aoFechar(); }}
            aria-label="Fechar" className="text-text-muted hover:text-text">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={(ev) => { void submeter(ev); }} className="grid gap-4">
          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Nome da unidade</span>
            <input type="text" required minLength={2}
              value={nome} onChange={(e) => setNome(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Fuso horario</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              {FUSOS.map(([valor, texto]) => (
                <option key={valor} value={valor}>{texto}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">CNPJ (opcional)</span>
            <input type="text" placeholder="12345678000190"
              value={cnpj} onChange={(e) => setCnpj(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono" />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">CNES (opcional)</span>
            <input type="text" placeholder="1234567" maxLength={7}
              value={cnes} onChange={(e) => setCnes(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-mono" />
          </label>

          {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

          <div className="flex gap-3 pt-2">
            <Botao type="submit" variante="primario" tamanho="md"
              disabled={!valida} carregando={enviando}>
              Criar
            </Botao>
            <Botao type="button" variante="secundario" tamanho="md"
              disabled={enviando}
              onClick={() => { resetar(); aoFechar(); }}>
              Cancelar
            </Botao>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CriarClinica tests**

Create `apps/web/src/telas/CriarClinica.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { CriarClinica } from './CriarClinica';

function montar(over: Partial<Parameters<typeof CriarClinica>[0]> = {}) {
  const props = {
    aberto: true,
    aoFechar: vi.fn(),
    aoCriar: vi.fn(async () => {}),
    ...over,
  };
  render(<CriarClinica {...props} />);
  return props;
}

describe('CriarClinica', () => {
  it('renderiza campos quando aberto=true', () => {
    montar();
    expect(screen.getByLabelText(/nome da unidade/i)).toBeDefined();
    expect(screen.getByLabelText(/fuso horario/i)).toBeDefined();
    expect(screen.getByLabelText(/cnpj/i)).toBeDefined();
    expect(screen.getByLabelText(/cnes/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /criar$/i })).toBeDefined();
  });

  it('nao renderiza nada quando aberto=false', () => {
    montar({ aberto: false });
    expect(screen.queryByLabelText(/nome da unidade/i)).toBeNull();
  });

  it('botao desabilitado com nome vazio', () => {
    montar();
    const btn = screen.getByRole('button', { name: /criar$/i });
    expect(btn.getAttribute('disabled')).not.toBeNull();
  });

  it('chama aoCriar com dados minimos (nome + timezone)', async () => {
    const props = montar();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/nome da unidade/i), 'Filial Sul');
    await user.click(screen.getByRole('button', { name: /criar$/i }));

    await waitFor(() => {
      expect(props.aoCriar).toHaveBeenCalledWith({
        nome: 'Filial Sul',
        timezone: 'America/Sao_Paulo',
      });
    });
  });

  it('chama aoCriar com todos os campos preenchidos', async () => {
    const props = montar();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/nome da unidade/i), 'Filial Norte');
    await user.selectOptions(screen.getByLabelText(/fuso horario/i), 'America/Manaus');
    await user.type(screen.getByLabelText(/cnpj/i), '12345678000190');
    await user.type(screen.getByLabelText(/cnes/i), '1234567');
    await user.click(screen.getByRole('button', { name: /criar$/i }));

    await waitFor(() => {
      expect(props.aoCriar).toHaveBeenCalledWith({
        nome: 'Filial Norte',
        timezone: 'America/Manaus',
        cnpj: '12345678000190',
        cnes: '1234567',
      });
    });
  });

  it('exibe erro quando aoCriar rejeita', async () => {
    const props = montar({
      aoCriar: vi.fn(async () => { throw new Error('fuso_invalido'); }),
    });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/nome da unidade/i), 'Filial Oeste');
    await user.click(screen.getByRole('button', { name: /criar$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Fuso horario invalido');
    });
  });

  it('cancelar fecha e reseta', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/nome da unidade/i), 'Teste');
    await user.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(props.aoFechar).toHaveBeenCalledOnce();
  });

  it('passa a11y', async () => {
    const { container } = render(
      <CriarClinica aberto={true} aoFechar={vi.fn()} aoCriar={vi.fn(async () => {})} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 3: Run the tests**

```bash
pnpm vitest run apps/web/src/telas/CriarClinica.test.tsx
```

Expected: 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/telas/CriarClinica.tsx apps/web/src/telas/CriarClinica.test.tsx
git commit -m "feat(web): CriarClinica modal component with validation and a11y tests"
```

---

### Task 5: Wire configuracoes page — list, modal, editable CNES/CNPJ

**Files:**
- Modify: `apps/web/app/configuracoes/page.tsx`

**Context:** The current page has a `Clinica` interface, fetches the current clinic via `GET /v1/configuracoes/clinica`, and renders a form with editable `nome`/`timezone` + read-only CNES/CNPJ `<dl>`. We need to:
1. Add a `ListaClinicas` section above the existing form, fetching all clinics via `GET /v1/configuracoes/clinicas`
2. Wire a `CriarClinica` modal triggered by the list's `aoCriar` callback
3. Replace the read-only `<dl>` CNES/CNPJ with editable inputs (for admin_clinico/diretor_tecnico)
4. Include `cnes` and `cnpj` in the PUT body

The `apiFetch` function is imported from `../../src/api` and works like `apiFetch<T>(url, { method?, body?, clinicId, csrfToken })`. It throws `ApiError` on non-2xx responses.

- [ ] **Step 1: Rewrite page.tsx**

Replace the entire content of `apps/web/app/configuracoes/page.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../src/api';
import { useSessao } from '../../src/sessao';
import { ListaClinicas, type ClinicaResumo } from '../../src/telas/ListaClinicas';
import { CriarClinica, type DadosCriacaoClinica } from '../../src/telas/CriarClinica';

interface Clinica {
  clinicId: string;
  nome: string;
  cnpj: string | null;
  cnes: string | null;
  timezone: string;
  tenantNome: string;
}

const FUSOS = [
  ['America/Sao_Paulo', 'Brasilia (UTC-3)'],
  ['America/Manaus', 'Manaus (UTC-4)'],
  ['America/Cuiaba', 'Cuiaba (UTC-4)'],
  ['America/Belem', 'Belem (UTC-3)'],
  ['America/Fortaleza', 'Fortaleza (UTC-3)'],
  ['America/Recife', 'Recife (UTC-3)'],
  ['America/Rio_Branco', 'Rio Branco (UTC-5)'],
  ['America/Noronha', 'Fernando de Noronha (UTC-2)'],
] as const;

export default function PaginaConfiguracoes() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const podeEditar = vinculoAtivo.role === 'admin_clinico'
    || vinculoAtivo.role === 'diretor_tecnico';
  const podeCriar = vinculoAtivo.role === 'admin_clinico';

  const [clinica, setClinica] = useState<Clinica | null>(null);
  const [nome, setNome] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [cnes, setCnes] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [clinicas, setClinicas] = useState<ClinicaResumo[]>([]);
  const [modalAberto, setModalAberto] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [c, lista] = await Promise.all([
        apiFetch<Clinica>('/v1/configuracoes/clinica', { clinicId, csrfToken }),
        apiFetch<{ itens: ClinicaResumo[] }>('/v1/configuracoes/clinicas', { clinicId, csrfToken }),
      ]);
      if (!vivo) return;
      setClinica(c); setNome(c.nome); setTimezone(c.timezone);
      setCnes(c.cnes ?? ''); setCnpj(c.cnpj ?? '');
      setClinicas(lista.itens);
    })();
    return () => { vivo = false; };
  }, [clinicId, csrfToken]);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setAviso(null);
    setSalvando(true);
    try {
      const body: Record<string, string> = { nome, timezone };
      if (cnes) body['cnes'] = cnes;
      if (cnpj) body['cnpj'] = cnpj;
      const c = await apiFetch<Clinica>('/v1/configuracoes/clinica', {
        method: 'PUT', body, clinicId, csrfToken });
      setClinica(c);
      setCnes(c.cnes ?? ''); setCnpj(c.cnpj ?? '');
      setAviso({ tipo: 'ok', texto: 'Configuracoes salvas.' });
    } catch (e) {
      setAviso({
        tipo: 'erro',
        texto: e instanceof ApiError && e.codigo === 'fuso_invalido'
          ? 'Fuso horario invalido.'
          : 'Nao foi possivel salvar.',
      });
    } finally {
      setSalvando(false);
    }
  }

  async function criarClinica(dados: DadosCriacaoClinica) {
    await apiFetch('/v1/configuracoes/clinicas', {
      method: 'POST', body: dados, clinicId, csrfToken });
    const lista = await apiFetch<{ itens: ClinicaResumo[] }>(
      '/v1/configuracoes/clinicas', { clinicId, csrfToken });
    setClinicas(lista.itens);
  }

  if (clinica === null) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <p className="text-sm text-text-muted">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <ListaClinicas
        clinicas={clinicas}
        clinicaAtivaId={clinicId}
        podeCriar={podeCriar}
        aoCriar={() => setModalAberto(true)}
      />

      <CriarClinica
        aberto={modalAberto}
        aoFechar={() => setModalAberto(false)}
        aoCriar={criarClinica}
      />

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Unidade
        </h2>

        <form onSubmit={(e) => { void salvar(e); }} className="grid max-w-lg gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Nome da unidade</span>
            <input
              value={nome} onChange={(e) => setNome(e.target.value)}
              disabled={!podeEditar} required minLength={2}
              className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Fuso horario</span>
            <select
              value={timezone} onChange={(e) => setTimezone(e.target.value)}
              disabled={!podeEditar}
              className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            >
              {FUSOS.map(([valor, texto]) => (
                <option key={valor} value={valor}>{texto}</option>
              ))}
            </select>
            <span className="text-xs text-text-muted">
              Decide a data de todo agendamento, recibo e lote. Mudar aqui muda
              como o dia e fechado.
            </span>
          </label>

          {podeEditar ? (
            <div className="grid grid-cols-2 gap-4">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">CNES</span>
                <input
                  value={cnes} onChange={(e) => setCnes(e.target.value)}
                  placeholder="1234567" maxLength={7}
                  className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm font-mono outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">CNPJ</span>
                <input
                  value={cnpj} onChange={(e) => setCnpj(e.target.value)}
                  placeholder="12345678000190"
                  className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm font-mono outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </label>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-4 rounded-[var(--r-md)] border border-line bg-surface-2 p-4 text-sm">
              <div>
                <dt className="text-xs text-text-muted">CNES</dt>
                <dd className="font-mono">{clinica.cnes ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">CNPJ</dt>
                <dd className="font-mono">{clinica.cnpj ?? '—'}</dd>
              </div>
            </dl>
          )}

          {podeEditar && (
            <button
              type="submit" disabled={salvando}
              className="h-10 w-fit rounded-[var(--r-md)] bg-accent px-5 text-sm font-medium text-accent-on transition hover:opacity-90 disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )}

          {aviso !== null && (
            <p role="status"
               className={aviso.tipo === 'ok' ? 'text-sm text-success' : 'text-sm text-danger'}>
              {aviso.texto}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Run the type check**

```bash
pnpm typecheck
```

Expected: no errors related to `page.tsx`.

- [ ] **Step 3: Run existing web tests to verify no regressions**

```bash
pnpm vitest run apps/web/
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/configuracoes/page.tsx
git commit -m "feat(web): clinic list, create modal, editable CNES/CNPJ on configuracoes page"
```

---

### Task 6: Quality gate + push

- [ ] **Step 1: Run full quality gate**

```bash
pnpm typecheck
pnpm authz:check
pnpm lint
pnpm lint:routes
pnpm test
pnpm test:web
pnpm build
pnpm test:int
pnpm test:iso
```

All must pass (except pre-existing `lint:routes` failures on catalogos routes which are not our changes).

- [ ] **Step 2: Push**

```bash
git push origin main
```
