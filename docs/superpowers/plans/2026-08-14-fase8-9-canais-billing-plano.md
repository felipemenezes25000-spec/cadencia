# Fases 8-9 — Canais estendidos, teleconsulta, calendar sync e billing — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the final two roadmap phases: transactional email, SMS adapter, teleconsult video calls, calendar sync, and billing workers.

**Architecture:** New integration contracts (email, teleconsult, calendar) follow the existing Provider pattern. Worker jobs use pg-boss queues. Frontend additions are minimal — mostly enhancements to existing pages.

**Tech Stack:** PostgreSQL, Fastify/Zod, React, Vitest, pg-boss, Nodemailer

---

### Task 1: Email transacional — contract, adapters, provider wiring

**Files:**
- Create: `packages/integrations/src/contracts/email.ts`
- Create: `packages/integrations/src/fakes/email-fake.ts`
- Create: `packages/integrations/src/adapters/smtp-email.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `apps/api/src/providers.ts`

- [ ] **Step 1: Write EmailProvider contract**

```typescript
// packages/integrations/src/contracts/email.ts
import type { Provider, ProviderCtx, ProviderResult } from './common';

export interface EmailEnvelope {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
  readonly replyTo?: string;
}

export interface EmailProvider extends Provider {
  send(ctx: ProviderCtx, envelope: EmailEnvelope):
    Promise<ProviderResult<{ messageId: string }>>;
}
```

- [ ] **Step 2: Write email fake**

`email-fake.ts`: accumulates `SentEmail[]` array. Supports modes `ok | indisponivel | timeout`. Returns `messageId = 'email-fake-N'`.

- [ ] **Step 3: Write SMTP adapter**

`smtp-email.ts`: uses `nodemailer.createTransport()`. Reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` from env. Wraps sendMail in ProviderResult.

- [ ] **Step 4: Export from index.ts**

Add exports for `EmailProvider`, `createFakeEmailProvider`, `createSmtpEmailProvider`.

- [ ] **Step 5: Wire into providers.ts**

Add `email: EmailProvider` to `Providers` interface. Mode `real` requires `SMTP_HOST`; otherwise fake.

- [ ] **Step 6: Tests**

Unit test for email-fake (send accumulates, modes work). Unit test for SMTP adapter (mock transport).

- [ ] **Step 7: Commit**

```
git add packages/integrations/src/contracts/email.ts packages/integrations/src/fakes/email-fake.ts packages/integrations/src/adapters/smtp-email.ts packages/integrations/src/index.ts apps/api/src/providers.ts
git commit -m "feat(integrations): email transacional — contract, SMTP adapter, fake"
```

---

### Task 2: Email worker + templates + wire convite

**Files:**
- Create: `packages/integrations/src/email-templates/convite-equipe.ts`
- Create: `packages/integrations/src/email-templates/lembrete-consulta.ts`
- Create: `apps/worker/src/jobs/send-email.ts`
- Modify: `apps/worker/src/queues.ts`
- Modify: `apps/worker/src/worker.ts`

- [ ] **Step 1: Write email templates**

Pure functions `(vars) => { subject: string; html: string; text: string }`.

`convite-equipe.ts`: vars = `{ nomeConvidado, nomeClinica, urlConvite }`.
`lembrete-consulta.ts`: vars = `{ nomePaciente, nomeProfissional, data, hora, nomeClinica }`.

- [ ] **Step 2: Add FILA_EMAIL queue**

In `queues.ts`: `export const FILA_EMAIL = 'email.send' as const;`

- [ ] **Step 3: Write send-email worker job**

Job handler receives `{ template: string; vars: Record<string, string>; to: string }`.
Resolves template, calls `emailProvider.send()`.

- [ ] **Step 4: Register in worker.ts**

Register handler + no cron (event-driven via outbox).

- [ ] **Step 5: Tests**

Unit test for templates (output contains expected vars). Integration test for worker job.

- [ ] **Step 6: Commit**

```
git commit -m "feat(worker): email worker + templates convite e lembrete"
```

---

### Task 3: SMS fake adapter + wire reminders

**Files:**
- Create: `packages/integrations/src/fakes/sms-fake.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `apps/worker/src/jobs/reminder-scheduler.ts`

- [ ] **Step 1: Write SMS fake**

Implements `MessagingProvider` with `channel: 'sms'`, `supportsInbound: false`. Same mode pattern as messaging-fake. Simpler: no webhook, no parseInbound, no fetchMedia (all return unsupported).

- [ ] **Step 2: Export from index.ts**

- [ ] **Step 3: Wire reminder scheduler**

Update `reminder-scheduler.ts` to check `msg.channel_config` for active channels. If SMS active, use SMS provider; if WhatsApp active, use WhatsApp provider. Falls back to WhatsApp.

- [ ] **Step 4: Tests**

Unit test for sms-fake.

- [ ] **Step 5: Commit**

```
git commit -m "feat(integrations): SMS fake adapter + multi-channel reminders"
```

---

### Task 4: Teleconsulta — migration + authz + contract + adapters

**Files:**
- Create: `packages/db/migrations/0178_teleconsulta.sql`
- Create: `packages/integrations/src/contracts/teleconsult.ts`
- Create: `packages/integrations/src/adapters/jitsi-teleconsult.ts`
- Create: `packages/integrations/src/fakes/teleconsult-fake.ts`
- Modify: `packages/authz/src/actions.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `apps/api/src/providers.ts`

- [ ] **Step 1: Write migration 0178**

Create `clin.teleconsulta` table with RLS, FK to appointment, update `audit.meta_keys_ok`.

- [ ] **Step 2: Add authz actions**

`teleconsult.read`, `teleconsult.write` in actions.ts. Grant to `admin_clinico`, `diretor_tecnico`, `profissional`.

- [ ] **Step 3: Write TeleconsultProvider contract**

- [ ] **Step 4: Write Jitsi adapter**

Generates room URL using `https://meet.jit.si/cadencia-{tenantSlug}-{shortId}`. No API call needed — Jitsi rooms are created on join.

- [ ] **Step 5: Write teleconsult fake**

Returns `https://fake-teleconsult/{roomId}`.

- [ ] **Step 6: Export + wire providers**

Add `teleconsult: TeleconsultProvider` to Providers.

- [ ] **Step 7: Apply migration**

`pnpm db:migrate`

- [ ] **Step 8: Commit**

```
git commit -m "feat(db+integrations): teleconsulta — migration 0178, contract, Jitsi adapter"
```

---

### Task 5: Teleconsulta — API routes + integration tests

**Files:**
- Create: `apps/api/src/routes/teleconsultas.ts`
- Create: `apps/api/src/routes/teleconsultas.int.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write teleconsulta routes**

- `POST /v1/teleconsultas` — creates room for appointment, stores in DB, audit logs
- `GET /v1/teleconsultas/:appointmentId` — returns room info
- `PUT /v1/teleconsultas/:id/encerrar` — marks ended_at

- [ ] **Step 2: Register routes in app.ts**

- [ ] **Step 3: Write integration tests**

- cria sala de teleconsulta: 201
- retorna sala existente: 200
- encerra teleconsulta: 200
- rejeita agendamento inexistente: 404

- [ ] **Step 4: Commit**

```
git commit -m "feat(api): teleconsulta routes — create, get, end"
```

---

### Task 6: Teleconsulta — frontend component

**Files:**
- Create: `apps/web/src/ui/PainelDeTeleconsulta.tsx`
- Create: `apps/web/src/ui/PainelDeTeleconsulta.test.tsx`
- Modify: `apps/web/app/atendimento/[id]/page.tsx`

- [ ] **Step 1: Build PainelDeTeleconsulta component**

- Button "Iniciar teleconsulta" when teleconsulta exists
- Opens modal/fullscreen with iframe to Jitsi room URL
- Button "Encerrar" calls PUT /encerrar
- Status display: aguardando, em andamento, encerrada

- [ ] **Step 2: Wire into atendimento page**

Check if appointment has teleconsulta, show panel.

- [ ] **Step 3: Tests**

- renders button when teleconsulta available
- opens iframe on click
- calls encerrar on end button
- accessibility (axe)

- [ ] **Step 4: Commit**

```
git commit -m "feat(web): PainelDeTeleconsulta — video call UI"
```

---

### Task 7: Calendar sync — migration + contract + adapters

**Files:**
- Create: `packages/db/migrations/0179_calendar_sync.sql`
- Create: `packages/integrations/src/contracts/calendar.ts`
- Create: `packages/integrations/src/fakes/calendar-fake.ts`
- Modify: `packages/integrations/src/index.ts`
- Modify: `apps/api/src/providers.ts`

- [ ] **Step 1: Write migration 0179**

Create `app.calendar_sync` table with RLS (own user only), unique constraint on (tenant_id, user_id, provider).

- [ ] **Step 2: Write CalendarProvider contract**

Methods: `createEvent`, `deleteEvent`, `listCalendars`.

- [ ] **Step 3: Write calendar fake**

Accumulates events, returns fake calendar list.

- [ ] **Step 4: Export + wire providers**

Add `calendar: CalendarProvider` to Providers.

- [ ] **Step 5: Apply migration**

- [ ] **Step 6: Commit**

```
git commit -m "feat(db+integrations): calendar sync — migration 0179, contract, fake"
```

---

### Task 8: Calendar sync — API routes + worker + settings UI

**Files:**
- Create: `apps/api/src/routes/calendar.ts`
- Create: `apps/api/src/routes/calendar.int.test.ts`
- Create: `apps/worker/src/jobs/calendar-sync.ts`
- Modify: `apps/worker/src/queues.ts`
- Modify: `apps/worker/src/worker.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/app/configuracoes/perfil/page.tsx`

- [ ] **Step 1: Write calendar API routes**

- `GET /v1/calendar/connections` — user's connected calendars
- `POST /v1/calendar/connect` — save provider + tokens
- `DELETE /v1/calendar/disconnect` — remove connection
- `POST /v1/calendar/sync` — trigger manual sync

- [ ] **Step 2: Write calendar sync worker**

`FILA_CALENDAR_SYNC` — cron `*/15 * * * *`. For each enabled connection, sync recent appointment changes to external calendar.

- [ ] **Step 3: Register routes + worker**

- [ ] **Step 4: Add calendar section to profile page**

Section "Calendarios" with connect/disconnect buttons and sync status.

- [ ] **Step 5: Integration tests**

- conecta calendario: 201
- lista conexoes: 200
- desconecta: 200
- sync manual: 200

- [ ] **Step 6: Commit**

```
git commit -m "feat: calendar sync — routes, worker, profile UI"
```

---

### Task 9: Billing workers — trial expiration + invoice generation

**Files:**
- Create: `apps/worker/src/jobs/trial-expiration.ts`
- Create: `apps/worker/src/jobs/invoice-generation.ts`
- Modify: `apps/worker/src/queues.ts`
- Modify: `apps/worker/src/worker.ts`

- [ ] **Step 1: Write trial expiration worker**

`FILA_TRIAL_EXPIRACAO` — cron `0 6 * * *`. Finds trial subscriptions past expiry. Updates status to `suspensa`, motivo `trial_expirado`. Creates in-app notification.

- [ ] **Step 2: Write invoice generation worker**

`FILA_FATURA_GERACAO` — cron `0 5 1 * *`. For each active subscription, calculates value (professionals x plan price), inserts invoice with status `pendente`.

- [ ] **Step 3: Register queues + handlers**

- [ ] **Step 4: Tests**

Integration tests: trial expires correctly, invoice generated with right amount.

- [ ] **Step 5: Commit**

```
git commit -m "feat(worker): billing workers — trial expiration + invoice generation"
```

---

### Task 10: Quality gate + push

- [ ] Run `pnpm prepush` (typecheck, lint, tests, build, integration tests)
- [ ] Fix any failures
- [ ] `git push origin main`
