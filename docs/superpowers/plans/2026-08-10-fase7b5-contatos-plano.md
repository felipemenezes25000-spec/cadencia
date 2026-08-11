# Fase 7B-5 — Contatos do Paciente — Plano de Implementacao

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable viewing and editing patient contact info (phone, email, emergency contact) from the patient detail page.

**Architecture:** Migration adds new contact columns to `clin.patient`. New PATCH endpoint updates contact fields with audit logging. Frontend SecaoContato component provides inline editing with save/cancel. Existing GET response expanded.

**Tech Stack:** PostgreSQL, Fastify/Zod, React, Vitest

---

### Task 1: Migration 0163 — contact columns + audit keys

**Files:**
- Create: `packages/db/migrations/0163_patient_contact_fields.sql`

- [ ] **Step 1: Write migration SQL**

Add `phone_secondary`, `emergency_contact_name`, `emergency_contact_phone` to `clin.patient`.
Update `audit.meta_keys_ok` with new keys: `field`, `old_value`, `new_value`.

- [ ] **Step 2: Apply migration**

Run: `pnpm db:migrate`

- [ ] **Step 3: Commit**

```
git add packages/db/migrations/0163_patient_contact_fields.sql
git commit -m "feat(db): migration 0163 — patient contact fields + audit keys"
```

---

### Task 2: PATCH /v1/pacientes/:id/contato + integration tests

**Files:**
- Modify: `apps/api/src/routes/patients.ts`
- Modify: `apps/api/src/routes/patients.int.test.ts`

- [ ] **Step 1: Add PATCH route**

Zod schema: `phonePrimary`, `phoneSecondary`, `email`, `emergencyContactName`, `emergencyContactPhone` — all optional string|null.

Validation: at least one of phonePrimary/email must remain non-empty after update.
Normalize phone digits, min 10 chars.
Update `search_digits` when phonePrimary changes.
Audit log each changed field.

- [ ] **Step 2: Update GET /v1/pacientes/:id response**

Add `phoneSecondary`, `emergencyContactName`, `emergencyContactPhone` to the query SELECT and response schema.

- [ ] **Step 3: Write integration tests**

Tests:
- atualiza telefone primario: 200
- atualiza email: 200
- rejeita remover ambos telefone e email: 422
- atualiza contato de emergencia: 200
- recepcao pode editar contato: 200 (patient.write)
- telefone invalido (<10 digitos): 422

- [ ] **Step 4: Commit**

```
git add apps/api/src/routes/patients.ts apps/api/src/routes/patients.int.test.ts
git commit -m "feat(api): PATCH /v1/pacientes/:id/contato — contact update"
```

---

### Task 3: SecaoContato component + tests

**Files:**
- Create: `apps/web/src/telas/SecaoContato.tsx`
- Create: `apps/web/src/telas/SecaoContato.test.tsx`

- [ ] **Step 1: Build SecaoContato component**

Props:
```typescript
interface SecaoContatoProps {
  readonly phonePrimary: string | null;
  readonly phoneSecondary: string | null;
  readonly email: string | null;
  readonly emergencyContactName: string | null;
  readonly emergencyContactPhone: string | null;
  readonly aoSalvar: (dados: ContatoPayload) => Promise<void>;
  readonly editavel: boolean;
}
```

Display mode: shows all contact fields with formatted values.
Edit mode: input fields with save/cancel buttons.
Validates phone format and canal_obrigatorio rule client-side.

- [ ] **Step 2: Write unit tests**

Tests:
- renders phone and email in display mode
- shows edit button when editavel=true
- toggles to edit mode on click
- calls aoSalvar with updated values
- validates canal_obrigatorio (disables save if both phone and email empty)
- shows emergency contact section
- accessibility (axe)

- [ ] **Step 3: Commit**

```
git add apps/web/src/telas/SecaoContato.tsx apps/web/src/telas/SecaoContato.test.tsx
git commit -m "feat(web): SecaoContato component with inline editing"
```

---

### Task 4: Wire SecaoContato into FichaDoPaciente + page

**Files:**
- Modify: `apps/web/src/telas/FichaDoPaciente.tsx`
- Modify: `apps/web/app/pacientes/[id]/page.tsx`
- Modify: `apps/web/src/ui/ComboboxDePaciente.tsx` (PacienteHit interface)

- [ ] **Step 1: Expand PacienteDaApi and FichaDoPacienteProps**

Add contact fields to the interface chain: PacienteHit or PacienteDaApi gets the new fields; FichaDoPaciente receives them via props.

- [ ] **Step 2: Replace hardcoded Contato section**

Replace the existing static "Contato" section in FichaDoPaciente with the SecaoContato component.

- [ ] **Step 3: Wire aoSalvar in page.tsx**

Call PATCH /v1/pacientes/:id/contato from the page, refresh patient data after save.

- [ ] **Step 4: Commit**

```
git add apps/web/src/telas/FichaDoPaciente.tsx apps/web/app/pacientes/[id]/page.tsx apps/web/src/ui/ComboboxDePaciente.tsx
git commit -m "feat(web): wire contact editing into patient detail page"
```

---

### Task 5: Quality gate + push

- [ ] Run `pnpm prepush` (typecheck, lint, tests, build, integration tests)
- [ ] Fix any failures
- [ ] `git push origin main`
