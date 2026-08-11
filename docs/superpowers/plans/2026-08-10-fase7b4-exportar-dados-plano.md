# Exportar Dados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Admin can export clinic operational data (patients, team, appointments, financial) as CSV or XLSX from the Configuracoes area.

**Architecture:** New authz action `data.export` gates access. Single API endpoint `POST /v1/configuracoes/exportar` queries the relevant table, formats with the existing `exportReport()` from `@cadencia/reports`, and returns a binary file. Frontend adds a new tab and page with dataset/format selection.

**Tech Stack:** Fastify route, Zod validation, `@cadencia/reports` exportReport(), React component, vitest.

---

### Task 1: Authz action `data.export`

**Files:**
- Modify: `packages/authz/src/actions.ts`
- Regenerate: `packages/authz/actions.lock.json`

- [ ] Add `{ key: 'data.export', description: 'Exportar dados da clinica', roles: ['admin_clinico'], requiresMfa: true }` after `membership.edit` in the actions array.
- [ ] Run `pnpm authz:seed` to regenerate lock file and sync DB.
- [ ] Commit: `feat(authz): data.export action for clinic data export`

---

### Task 2: POST /v1/configuracoes/exportar endpoint + tests

**Files:**
- Modify: `apps/api/src/routes/configuracoes.ts`
- Modify: `apps/api/src/routes/configuracoes.int.test.ts`

**Endpoint body schema (Zod):**
```typescript
const ExportarSchema = z.object({
  dataset: z.enum(['pacientes', 'equipe', 'agendamentos', 'financeiro']),
  format: z.enum(['csv', 'xlsx']),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
```

**Validation:**
- If dataset is `agendamentos` or `financeiro`, `dateFrom` and `dateTo` are required (422 `periodo_obrigatorio`)
- Interval max 365 days (422 `periodo_excedido`)

**Queries per dataset:**
- `pacientes`: SELECT from `clin.patient` LEFT JOIN `clin.patient_identifier` (CPF)
- `equipe`: SELECT from `app.equipe_da_unidade(clinic_id)`
- `agendamentos`: SELECT from `sched.appointment` with JOINs
- `financeiro`: SELECT from `fin.entry` with JOINs

**Response:** Binary buffer from `exportReport()` with appropriate content-type and content-disposition headers.

**Audit:** `DATA_EXPORT` with `{ dataset, format, row_count }`.

**Integration tests:**
- Exports pacientes as CSV (200, check Content-Disposition)
- Exports equipe as XLSX (200)
- Requires period for agendamentos (422 `periodo_obrigatorio`)
- Rejects period > 365 days (422 `periodo_excedido`)
- Recepcao cannot export (403)

- [ ] Add ExportarSchema and endpoint
- [ ] Write queries for each dataset with column definitions and headers
- [ ] Wire audit log
- [ ] Write integration tests
- [ ] Commit: `feat(api): POST /v1/configuracoes/exportar — clinic data export`

---

### Task 3: ExportarDados component + tests

**Files:**
- Create: `apps/web/src/telas/ExportarDados.tsx`
- Create: `apps/web/src/telas/ExportarDados.test.tsx`

**Component props:**
```typescript
interface ExportarDadosProps {
  readonly aoExportar: (req: { dataset: string; format: string; dateFrom?: string; dateTo?: string }) => Promise<void>;
}
```

**UI:**
- Fieldset "Dados" with radio group: Pacientes, Equipe, Agendamentos, Financeiro
- Fieldset "Formato" with radio group: CSV, XLSX
- Fieldset "Periodo" (visible when dataset is agendamentos or financeiro) with date inputs De/Ate
- Botao "Exportar" (primario, disabled until valid selection)

**Tests:**
- Renders all dataset options
- Shows period fields for agendamentos
- Hides period fields for pacientes
- Calls aoExportar with correct payload
- Disables button while exporting
- Accessibility (axe)

- [ ] Create component following existing Exportar pattern
- [ ] Write tests
- [ ] Commit: `feat(web): ExportarDados component with dataset/format selection`

---

### Task 4: Wire configuracoes page + layout tab + quality gate

**Files:**
- Create: `apps/web/app/configuracoes/exportar/page.tsx`
- Modify: `apps/web/app/configuracoes/layout.tsx` (add tab)

**Page:**
- Fetch via `apiFetch` POST to `/v1/configuracoes/exportar` — but since the response is binary, use raw `fetch` to get a blob and trigger download via `URL.createObjectURL`.
- Pass `aoExportar` callback to `ExportarDados`.

**Layout:**
- Add `{ value: 'exportar', rotulo: 'Exportar', href: '/configuracoes/exportar' }` before catalogos entry.

- [ ] Create page with download logic
- [ ] Add tab to layout
- [ ] Run full quality gate: typecheck, authz:check, test, test:web, build:web, test:int, test:iso
- [ ] Commit and push
