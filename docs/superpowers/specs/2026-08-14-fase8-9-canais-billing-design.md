# Fases 8 e 9 — Canais estendidos, teleconsulta, calendar sync e billing

## Objetivo

Completar as duas fases finais do roadmap: canais de comunicacao estendidos (email transacional, SMS), teleconsulta por video, sincronizacao de agenda com calendarios externos, e workers de billing que fecham o ciclo comercial.

## Contexto

O Cadencia ja possui:
- `MessagingProvider` contract com WhatsApp Cloud adapter real e fake completo
- `msg.channel_config` / `msg.channel_identity` com suporte a whatsapp/sms/email
- Worker de lembretes (`FILA_LEMBRETES`) que agenda envios
- Billing completo: schema `com`, planos, assinaturas, faturas, feature gates, UI
- `packages/integrations` com padrao Provider/ProviderCtx/ProviderResult consolidado
- 10 worker jobs em pg-boss com crons e outbox

## Decomposicao em sub-entregas

| ID | Sub-entrega | Escopo |
|---|---|---|
| 8A | Email transacional | Contract, SMTP adapter, fake, worker, templates, wire convite |
| 8B | SMS adapter | Fake SMS adapter, wire reminders |
| 8C | Teleconsulta | Migration, authz, API, Jitsi adapter, fake, UI |
| 8D | Calendar sync | Migration, contract, fake, worker, API, settings UI |
| 9A | Billing workers | Trial expiration, invoice generation, Asaas adapter fake |

---

## 8A — Email transacional

### Contrato

Novo contract `packages/integrations/src/contracts/email.ts`:

```typescript
export interface EmailProvider extends Provider {
  send(ctx: ProviderCtx, i: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }): Promise<ProviderResult<{ messageId: string }>>;
}
```

Nao reutiliza `MessagingProvider` porque email transacional nao e bidirecional (sem inbound parsing, sem webhook, sem media fetch).

### Adapter real: SMTP (Nodemailer)

`packages/integrations/src/adapters/smtp-email.ts`

Env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

### Fake

`packages/integrations/src/fakes/email-fake.ts` — acumula mensagens em array `sent` para assercoes em teste.

### Worker

Nova fila `FILA_EMAIL` em `apps/worker/src/queues.ts`. Job handler `send-email.ts` consome da outbox e despacha via `EmailProvider`.

### Templates

`packages/integrations/src/email-templates/`:
- `convite-equipe.ts` — convite para novo membro
- `lembrete-consulta.ts` — lembrete 24h antes

Templates sao funcoes puras `(vars) => { subject, html, text }`.

### Wiring

- `POST /v1/configuracoes/equipe` (convite) insere evento na outbox com tipo `EMAIL_CONVITE`
- Worker consome e envia via `EmailProvider`

### Providers

`apps/api/src/providers.ts` ganha campo `email: EmailProvider`. Modo `real` exige `SMTP_HOST`; caso contrario, fake.

---

## 8B — SMS adapter

### Adapter fake

`packages/integrations/src/fakes/sms-fake.ts` — implementa `MessagingProvider` com `channel: 'sms'`. Mesmo padrao do messaging-fake mas sem inbound/webhook (SMS inbound e futuro).

### Wire

- `FILA_LEMBRETES` worker ganha opcao de enviar via SMS alem de WhatsApp, conforme canal configurado da clinica
- Basta consultar `msg.channel_config` para saber qual canal usar

### Sem adapter real

O adapter real (Twilio/Zenvia) fica fora de escopo — so precisa de credenciais. O contrato `MessagingProvider` ja suporta SMS no tipo union.

---

## 8C — Teleconsulta

### Migration 0178

```sql
CREATE TABLE clin.teleconsulta (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  clinic_id        uuid NOT NULL,
  appointment_id   uuid NOT NULL REFERENCES clin.appointment(id),
  provider         text NOT NULL DEFAULT 'jitsi',
  room_id          text NOT NULL,
  room_url         text NOT NULL,
  started_at       timestamptz(3),
  ended_at         timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_teleconsulta_tenant FOREIGN KEY (tenant_id) REFERENCES app.tenant(id)
);
ALTER TABLE clin.teleconsulta ENABLE ROW LEVEL SECURITY;
CREATE POLICY teleconsulta_tenant ON clin.teleconsulta
  USING (tenant_id = app.require_tenant_id());
```

`audit.meta_keys_ok` atualizado com chaves: `room_id`, `provider`.

### Authz

Novas acoes: `teleconsult.write`, `teleconsult.read`.

### Contrato

`packages/integrations/src/contracts/teleconsult.ts`:

```typescript
export interface TeleconsultProvider extends Provider {
  createRoom(ctx: ProviderCtx, i: {
    appointmentId: string;
    professionalName: string;
    patientName: string;
  }): Promise<ProviderResult<{ roomId: string; roomUrl: string }>>;
}
```

### Adapter: Jitsi

`packages/integrations/src/adapters/jitsi-teleconsult.ts` — gera URL `https://meet.jit.si/cadencia-{tenantId}-{appointmentId}` com JWT opcional (self-hosted). Sem conta necessaria.

### Fake

`packages/integrations/src/fakes/teleconsult-fake.ts` — retorna URL `https://fake-teleconsult/{roomId}`.

### API

Novas rotas em `apps/api/src/routes/teleconsultas.ts`:
- `POST /v1/teleconsultas` — cria sala (requer appointment_id)
- `GET /v1/teleconsultas/:appointmentId` — retorna room URL
- `PUT /v1/teleconsultas/:id/encerrar` — marca ended_at

### Frontend

- `apps/web/app/atendimento/[id]/page.tsx` ganha botao "Iniciar teleconsulta" quando o agendamento e do tipo teleconsulta
- Modal com iframe embutido do Jitsi ou link externo
- Componente `PainelDeTeleconsulta.tsx` em `apps/web/src/ui/`

### Scheduling

`clin.appointment` ja tem campo `observacao`. O tipo de agendamento (presencial vs teleconsulta) sera inferido da existencia de registro em `clin.teleconsulta`.

---

## 8D — Calendar sync

### Migration 0179

```sql
CREATE TABLE app.calendar_sync (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES app.tenant(id),
  user_id           uuid NOT NULL REFERENCES app.user_account(id),
  provider          text NOT NULL CHECK (provider IN ('google', 'apple', 'outlook')),
  external_id       text,
  access_token_enc  bytea,
  refresh_token_enc bytea,
  last_sync_at      timestamptz(3),
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, user_id, provider)
);
ALTER TABLE app.calendar_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_sync_own ON app.calendar_sync
  USING (user_id = app.current_user_id());
```

### Contrato

`packages/integrations/src/contracts/calendar.ts`:

```typescript
export interface CalendarProvider extends Provider {
  createEvent(ctx: ProviderCtx, i: {
    accessToken: string;
    calendarId: string;
    summary: string;
    startIso: string;
    endIso: string;
    description?: string;
  }): Promise<ProviderResult<{ externalEventId: string }>>;

  deleteEvent(ctx: ProviderCtx, i: {
    accessToken: string;
    calendarId: string;
    externalEventId: string;
  }): Promise<ProviderResult<{}>>;

  listCalendars(ctx: ProviderCtx, i: {
    accessToken: string;
  }): Promise<ProviderResult<{ calendars: { id: string; name: string }[] }>>;
}
```

### Fake

`packages/integrations/src/fakes/calendar-fake.ts`

### Worker

`FILA_CALENDAR_SYNC` — a cada 15 min, sincroniza agendamentos alterados com calendarios conectados.

### API

Novas rotas em `apps/api/src/routes/calendar.ts`:
- `GET /v1/calendar/connections` — conexoes do usuario
- `POST /v1/calendar/connect` — salva tokens OAuth
- `DELETE /v1/calendar/disconnect` — remove conexao
- `POST /v1/calendar/sync` — forca sync manual

### Frontend

Secao "Calendarios" em `/configuracoes/perfil` — botao conectar Google Calendar, status de sync.

---

## 9A — Billing workers

### Trial expiration

`FILA_TRIAL_EXPIRACAO` — cron `0 6 * * *` (diario 6h). Busca assinaturas com `status = 'trial'` e `trial_termino_em <= today`. Muda status para `suspensa` com motivo `trial_expirado`. Insere notificacao in-app.

### Invoice generation

`FILA_FATURA_GERACAO` — cron `0 5 1 * *` (dia 1 de cada mes, 5h). Para cada assinatura ativa, calcula valor (profissionais x valor do plano) e insere fatura com `status = 'pendente'` e `data_vencimento = dia 10`.

### Payment adapter (fake)

O `payment-fake.ts` existente ja serve. O adapter real (Asaas/Stripe) depende de credenciais externas e fica identico ao padrao existente.

---

## Fora de escopo

- Contratar provedores reais (Twilio, Google OAuth, Asaas)
- Video recording/storage para teleconsultas
- Agendamento publico com opcao de teleconsulta
- SMS inbound (resposta do paciente)
- Apple Calendar adapter real (so fake + contrato)
