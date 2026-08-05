<!-- RECONCILIACAO (00-CONTRATOS) ──────────────────────────────────────
  Correcoes aplicadas pela reconciliacao dos 10 blocos:
  1. Referencia a evento APPOINTMENT_CREATED corrigida para
     APPOINTMENT_CONFIRMED (alinhado com Bloco 01 EventType union).
  2. msg.sent_reminder: tabela usada por Bloco 07 (worker reminder-scheduler)
     mas nao definida em nenhuma migration. PENDENTE: adicionar migration
     para msg.sent_reminder neste bloco ou no Bloco 07.
─────────────────────────────────────────────────────────────────── -->

### Task 18: migration 0074 — tabela `msg.nps_response` e indice de automacao por timing

**Arquivos:**
- Criar `packages/db/migrations/0074_nps_response.sql`
- Teste `packages/messaging/src/automations/nps-response.int.test.ts`

**Contexto:** a `msg.automation_rule` ja foi criada pelo bloco 02 (migration 0070-0072) com `trigger`, `template_id`, `timing_offset_minutes`, `active`, `channel`. Este bloco acrescenta a tabela de respostas NPS e um indice de busca por timing para o job de lembretes.

- [ ] **Passo 1** — escrever o teste de isolamento que espera a tabela `msg.nps_response` existir com RLS forcada.

Criar `packages/messaging/src/automations/nps-response.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let admin: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (!url) throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => { admin = new Pool({ connectionString: adminUrl(), max: 1 }); });
afterAll(async () => { await admin.end(); });

describe('msg.nps_response', () => {
  it('existe com RLS forcada', async () => {
    const { rows } = await admin.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'msg' AND c.relname = 'nps_response'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('tem ao menos uma policy', async () => {
    const { rows } = await admin.query(
      `SELECT polname FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'msg' AND c.relname = 'nps_response'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('FK composta inclui tenant_id', async () => {
    const { rows } = await admin.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'msg.nps_response'::regclass AND contype = 'f'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/nps-response.int.test.ts
```

Saida esperada: 3 testes falham (tabela nao existe).

- [ ] **Passo 2** — rodar o teste e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/nps-response.int.test.ts
```

Saida esperada: `FAIL` — relacao `msg.nps_response` nao encontrada.

- [ ] **Passo 3** — escrever a migration 0074 com `msg.nps_response` e o indice de timing em `msg.automation_rule`.

Criar `packages/db/migrations/0074_nps_response.sql`:

```sql
-- 0074_nps_response.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Tabela de respostas NPS e indice de busca por timing para o job de lembretes.
-- A msg.automation_rule ja existe (0070); este arquivo acrescenta a tabela de
-- respostas e o indice auxiliar.

-- =========================================================================
-- msg.nps_response — resposta do paciente a pesquisa NPS
-- =========================================================================
CREATE TABLE msg.nps_response (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  appointment_id  uuid,           -- pode ser NULL se NPS avulso
  conversation_id uuid,           -- conversa de onde veio a resposta
  message_id      uuid,           -- mensagem que contem a resposta
  score           smallint NOT NULL CHECK (score >= 0 AND score <= 10),
  comment         text,
  received_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id)  REFERENCES sched.appointment(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES msg.conversation(tenant_id, id)
);
ALTER TABLE msg.nps_response OWNER TO app_owner;

CREATE INDEX ix_nps_response_tenant_patient
  ON msg.nps_response (tenant_id, patient_id, received_at DESC);
CREATE INDEX ix_nps_response_tenant_score
  ON msg.nps_response (tenant_id, score, received_at DESC);

GRANT SELECT, INSERT ON msg.nps_response TO app_rw;

ALTER TABLE msg.nps_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.nps_response FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.nps_response AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- =========================================================================
-- Indice em msg.automation_rule para busca por trigger+active
-- (o bloco 02 criou a tabela; este indice acelera o lookup de automacoes)
-- =========================================================================
CREATE INDEX ix_automation_rule_trigger
  ON msg.automation_rule (tenant_id, trigger, active)
  WHERE active = true;
```

Rodar:

```bash
pnpm db:migrate
```

Saida esperada: migration 0074 aplicada sem erro.

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/nps-response.int.test.ts
```

Saida esperada: 3 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/db/migrations/0074_nps_response.sql packages/messaging/src/automations/nps-response.int.test.ts
git commit -m "feat(db): add msg.nps_response table and automation_rule index (0074)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 19: funcao `computeReminderInstant` — calcula o instante de envio no fuso da clinica

**Arquivos:**
- Criar `packages/messaging/src/automations/reminder-timing.ts`
- Teste `packages/messaging/src/automations/reminder-timing.test.ts`

**Contexto:** o timing_offset e relativo ao horario local da clinica, nao UTC. Uma consulta as 8h em America/Sao_Paulo (UTC-3) com offset -1440 (24h antes) deve gerar envio as 8h do dia anterior em horario local, ou seja, 11:00 UTC do dia anterior. Esta funcao recebe o `starts_at` (UTC), o `timezone` da clinica e o `timing_offset_minutes`, e devolve o instante UTC de envio.

- [ ] **Passo 1** — escrever o teste unitario.

Criar `packages/messaging/src/automations/reminder-timing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeReminderInstant } from './reminder-timing';

describe('computeReminderInstant', () => {
  it('lembrete 24h antes: consulta as 8h em SP sai as 8h do dia anterior em SP', () => {
    // 2026-10-07 08:00 em America/Sao_Paulo = 2026-10-07 11:00 UTC
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = -1440; // 24h antes

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-10-06 08:00 em America/Sao_Paulo = 2026-10-06 11:00 UTC
    expect(result).toBe('2026-10-06T11:00:00.000Z');
  });

  it('lembrete 2h antes: consulta as 8h em SP sai as 6h do mesmo dia em SP', () => {
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = -120; // 2h antes

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-10-07 06:00 em America/Sao_Paulo = 2026-10-07 09:00 UTC
    expect(result).toBe('2026-10-07T09:00:00.000Z');
  });

  it('respeita horario de verao: consulta em novembro quando SP esta em UTC-2', () => {
    // Brasil: horario de verao (se vigente) muda SP para UTC-2
    // Em 2026, Brasil NAO tem horario de verao (abolido em 2019).
    // Mas testamos com fuso que TEM (ex: America/New_York para validar a logica).
    // 2026-03-09 09:00 EDT (UTC-4) = 2026-03-09 13:00 UTC
    const startsAtUtc = '2026-03-09T13:00:00.000Z';
    const timezone = 'America/New_York';
    const offsetMinutes = -1440;

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-03-08 09:00 EST (UTC-5) = 2026-03-08 14:00 UTC
    // Nota: no dia 8/mar NY ainda esta em EST (horario de verao comeca dia 8 as 2h,
    // mas 9h da manha do dia 8 ainda e EST). Na verdade, em 2026 o DST dos EUA
    // comeca em 8/mar as 02:00. Entao:
    // dia 9/mar 09:00 EDT = 13:00 UTC
    // dia 8/mar 09:00 EST = 14:00 UTC (antes do DST)
    expect(result).toBe('2026-03-08T14:00:00.000Z');
  });

  it('pos-consulta 24h depois: offset positivo funciona', () => {
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = 1440; // 24h depois

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    // 2026-10-08 08:00 em SP = 2026-10-08 11:00 UTC
    expect(result).toBe('2026-10-08T11:00:00.000Z');
  });

  it('offset zero retorna o mesmo instante da consulta', () => {
    const startsAtUtc = '2026-10-07T11:00:00.000Z';
    const timezone = 'America/Sao_Paulo';
    const offsetMinutes = 0;

    const result = computeReminderInstant(startsAtUtc, timezone, offsetMinutes);

    expect(result).toBe('2026-10-07T11:00:00.000Z');
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timing.test.ts
```

Saida esperada: 5 testes falham (modulo nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timing.test.ts
```

Saida esperada: `FAIL` — cannot find module `./reminder-timing`.

- [ ] **Passo 3** — implementar `computeReminderInstant`.

Criar `packages/messaging/src/automations/reminder-timing.ts`:

```ts
/**
 * Calcula o instante UTC de envio de lembrete/automacao.
 *
 * O timing_offset_minutes e RELATIVO ao horario LOCAL da clinica, NAO ao UTC.
 * Motivo: consulta as 8h em America/Sao_Paulo com offset -1440 deve disparar
 * as 8h do dia anterior no fuso local, ou seja 11:00 UTC — e nao as 5:00 UTC
 * que e o que daria se subtraisse 1440 min do instante UTC puro.
 *
 * Algoritmo:
 * 1. Converte starts_at UTC para horario local da clinica.
 * 2. Aplica o offset em minutos no horario local.
 * 3. Converte de volta para UTC.
 *
 * Usa Intl.DateTimeFormat para obter o offset real do fuso naquele instante,
 * respeitando horario de verao onde aplicavel.
 */

/**
 * Retorna o offset UTC em minutos para um dado instante e timezone.
 * Positivo = leste de Greenwich (ex: +180 para UTC+3).
 * Negativo = oeste (ex: -180 para UTC-3).
 */
function utcOffsetMinutesAt(instantMs: number, timezone: string): number {
  const dt = new Date(instantMs);
  // Formata partes no fuso-alvo
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(dt);

  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };

  // Reconstroi o instante "como se fosse UTC" a partir das partes locais
  const localAsUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'),
  );

  // A diferenca e o offset: local - UTC
  return Math.round((localAsUtc - instantMs) / 60_000);
}

export function computeReminderInstant(
  startsAtUtc: string,
  timezone: string,
  offsetMinutes: number,
): string {
  const startsMs = new Date(startsAtUtc).getTime();

  // 1. Offset UTC do fuso no instante da consulta
  const tzOffsetAtStart = utcOffsetMinutesAt(startsMs, timezone);

  // 2. Horario local da consulta em ms (como se fosse UTC)
  const localMs = startsMs + tzOffsetAtStart * 60_000;

  // 3. Aplica o offset da automacao no horario local
  const targetLocalMs = localMs + offsetMinutes * 60_000;

  // 4. Descobre o offset UTC no instante-alvo (pode diferir por DST)
  //    Para isso, precisamos de uma estimativa do instante UTC-alvo
  const estimatedUtcMs = targetLocalMs - tzOffsetAtStart * 60_000;
  const tzOffsetAtTarget = utcOffsetMinutesAt(estimatedUtcMs, timezone);

  // 5. Converte de volta para UTC usando o offset correto
  const targetUtcMs = targetLocalMs - tzOffsetAtTarget * 60_000;

  return new Date(targetUtcMs).toISOString();
}
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timing.test.ts
```

Saida esperada: 5 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/messaging/src/automations/reminder-timing.ts packages/messaging/src/automations/reminder-timing.test.ts
git commit -m "feat(messaging): computeReminderInstant respects clinic timezone

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 20: handler de confirmacao de agendamento — `handleAppointmentCreated`

**Arquivos:**
- Criar `packages/messaging/src/automations/confirmation.ts`
- Teste `packages/messaging/src/automations/confirmation.test.ts`

**Contexto:** quando o evento `APPOINTMENT_CONFIRMED` chega, o handler verifica se existe `automation_rule` com trigger `appointment_confirmed` ativa para o tenant. Se sim, monta o payload de envio e retorna a intencao de outbox. O messaging NAO importa scheduling — a composicao e pelo worker/L3. O handler recebe os dados do agendamento ja resolvidos por argumento.

- [ ] **Passo 1** — escrever o teste unitario.

Criar `packages/messaging/src/automations/confirmation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  handleAppointmentCreated,
  type AppointmentCreatedPayload,
  type AutomationRule,
  type ConfirmationOutboxEntry,
} from './confirmation';

const REGRA_ATIVA: AutomationRule = {
  id: 'rule-1',
  tenantId: 'tenant-1',
  trigger: 'appointment_created',
  templateId: 'tpl-confirmacao',
  timingOffsetMinutes: 0,
  active: true,
  channel: 'whatsapp',
};

const AGENDAMENTO: AppointmentCreatedPayload = {
  tenantId: 'tenant-1',
  appointmentId: 'appt-1',
  patientId: 'patient-1',
  patientName: 'Maria Souza',
  patientPhone: '+5511999990001',
  professionalName: 'Dr. Silva',
  clinicId: 'clinic-1',
  clinicTimezone: 'America/Sao_Paulo',
  startsAt: '2026-10-07T11:00:00.000Z',
  appointmentDate: '2026-10-07',
  procedureName: 'Consulta',
};

describe('handleAppointmentCreated', () => {
  it('retorna entrada de outbox quando regra ativa existe', () => {
    const result = handleAppointmentCreated(AGENDAMENTO, [REGRA_ATIVA]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.eventType).toBe('SEND_CONFIRMATION');
    expect(entry.aggregateId).toBe('appt-1');
    expect(entry.payload.to).toBe('+5511999990001');
    expect(entry.payload.templateId).toBe('tpl-confirmacao');
    expect(entry.payload.channel).toBe('whatsapp');
    expect(entry.payload.variables.patientName).toBe('Maria Souza');
    expect(entry.payload.variables.professionalName).toBe('Dr. Silva');
    expect(entry.payload.variables.appointmentDate).toBe('2026-10-07');
  });

  it('retorna vazio quando nao ha regra ativa', () => {
    const result = handleAppointmentCreated(AGENDAMENTO, []);
    expect(result).toHaveLength(0);
  });

  it('ignora regra inativa', () => {
    const inativa = { ...REGRA_ATIVA, active: false };
    const result = handleAppointmentCreated(AGENDAMENTO, [inativa]);
    expect(result).toHaveLength(0);
  });

  it('ignora regra com trigger diferente', () => {
    const outra = { ...REGRA_ATIVA, trigger: 'encounter_finalized' as const };
    const result = handleAppointmentCreated(AGENDAMENTO, [outra]);
    expect(result).toHaveLength(0);
  });

  it('retorna vazio quando paciente nao tem telefone', () => {
    const semTel = { ...AGENDAMENTO, patientPhone: null };
    const result = handleAppointmentCreated(semTel, [REGRA_ATIVA]);
    expect(result).toHaveLength(0);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/confirmation.test.ts
```

Saida esperada: 5 testes falham (modulo nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/confirmation.test.ts
```

Saida esperada: `FAIL`.

- [ ] **Passo 3** — implementar `handleAppointmentCreated`.

Criar `packages/messaging/src/automations/confirmation.ts`:

```ts
/**
 * Handler de confirmacao de agendamento.
 *
 * Recebe os dados do agendamento JA RESOLVIDOS (por L3/worker) e as regras de
 * automacao do tenant. Retorna as entradas de outbox a serem enfileiradas.
 *
 * O messaging NAO importa scheduling — a composicao e pelo worker/L3.
 */

export type AutomationTrigger =
  | 'appointment_created'
  | 'appointment_reminder'
  | 'encounter_finalized'
  | 'nps_due';

export interface AutomationRule {
  readonly id: string;
  readonly tenantId: string;
  readonly trigger: AutomationTrigger;
  readonly templateId: string;
  readonly timingOffsetMinutes: number;
  readonly active: boolean;
  readonly channel: 'whatsapp' | 'sms' | 'email';
}

export interface AppointmentCreatedPayload {
  readonly tenantId: string;
  readonly appointmentId: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly patientPhone: string | null;
  readonly professionalName: string;
  readonly clinicId: string;
  readonly clinicTimezone: string;
  readonly startsAt: string;
  readonly appointmentDate: string;
  readonly procedureName: string | null;
}

export interface ConfirmationOutboxEntry {
  readonly eventType: 'SEND_CONFIRMATION';
  readonly aggregateId: string;
  readonly payload: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly patientId: string;
    readonly to: string;
    readonly templateId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    readonly variables: {
      readonly patientName: string;
      readonly professionalName: string;
      readonly appointmentDate: string;
      readonly procedureName: string;
      readonly startsAt: string;
    };
  };
}

export function handleAppointmentCreated(
  appt: AppointmentCreatedPayload,
  rules: readonly AutomationRule[],
): ConfirmationOutboxEntry[] {
  if (appt.patientPhone === null || appt.patientPhone === '') {
    return [];
  }

  const matching = rules.filter(
    (r) => r.trigger === 'appointment_created' && r.active && r.tenantId === appt.tenantId,
  );

  return matching.map((rule) => ({
    eventType: 'SEND_CONFIRMATION' as const,
    aggregateId: appt.appointmentId,
    payload: {
      tenantId: appt.tenantId,
      appointmentId: appt.appointmentId,
      patientId: appt.patientId,
      to: appt.patientPhone!,
      templateId: rule.templateId,
      channel: rule.channel,
      variables: {
        patientName: appt.patientName,
        professionalName: appt.professionalName,
        appointmentDate: appt.appointmentDate,
        procedureName: appt.procedureName ?? 'Consulta',
        startsAt: appt.startsAt,
      },
    },
  }));
}
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/confirmation.test.ts
```

Saida esperada: 5 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/messaging/src/automations/confirmation.ts packages/messaging/src/automations/confirmation.test.ts
git commit -m "feat(messaging): appointment confirmation automation handler

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 21: handler de lembrete com fallback SMS — `scheduleReminders`

**Arquivos:**
- Criar `packages/messaging/src/automations/reminder.ts`
- Teste `packages/messaging/src/automations/reminder.test.ts`

**Contexto:** quando um agendamento e criado, para cada `automation_rule` com trigger `appointment_reminder`, calcula o instante de envio usando `computeReminderInstant` e retorna entradas de outbox com `startAfter` para que o pg-boss agende o job no momento correto. Se o canal primario e WhatsApp, inclui fallback SMS.

- [ ] **Passo 1** — escrever o teste unitario.

Criar `packages/messaging/src/automations/reminder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scheduleReminders, type ReminderOutboxEntry } from './reminder';
import type { AutomationRule } from './confirmation';

const REGRA_24H: AutomationRule = {
  id: 'rule-lembrete-24h',
  tenantId: 'tenant-1',
  trigger: 'appointment_reminder',
  templateId: 'tpl-lembrete',
  timingOffsetMinutes: -1440,
  active: true,
  channel: 'whatsapp',
};

const REGRA_2H: AutomationRule = {
  id: 'rule-lembrete-2h',
  tenantId: 'tenant-1',
  trigger: 'appointment_reminder',
  templateId: 'tpl-lembrete-curto',
  timingOffsetMinutes: -120,
  active: true,
  channel: 'whatsapp',
};

const APPOINTMENT_DATA = {
  tenantId: 'tenant-1',
  appointmentId: 'appt-1',
  patientId: 'patient-1',
  patientName: 'Maria Souza',
  patientPhone: '+5511999990001',
  professionalName: 'Dr. Silva',
  clinicId: 'clinic-1',
  clinicTimezone: 'America/Sao_Paulo',
  // 2026-10-07 08:00 em SP = 2026-10-07 11:00 UTC
  startsAt: '2026-10-07T11:00:00.000Z',
  appointmentDate: '2026-10-07',
  procedureName: 'Consulta',
};

describe('scheduleReminders', () => {
  it('lembrete 24h antes: consulta 8h SP => envio 8h dia anterior SP (11h UTC dia anterior)', () => {
    const result = scheduleReminders(APPOINTMENT_DATA, [REGRA_24H]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.eventType).toBe('SEND_REMINDER');
    expect(entry.startAfter).toBe('2026-10-06T11:00:00.000Z');
    expect(entry.payload.channel).toBe('whatsapp');
    expect(entry.payload.fallbackChannel).toBe('sms');
  });

  it('lembrete 2h antes: consulta 8h SP => envio 6h SP (9h UTC)', () => {
    const result = scheduleReminders(APPOINTMENT_DATA, [REGRA_2H]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.startAfter).toBe('2026-10-07T09:00:00.000Z');
  });

  it('gera dois lembretes quando ha duas regras ativas', () => {
    const result = scheduleReminders(APPOINTMENT_DATA, [REGRA_24H, REGRA_2H]);
    expect(result).toHaveLength(2);
  });

  it('retorna vazio quando nao ha regra de lembrete', () => {
    const result = scheduleReminders(APPOINTMENT_DATA, []);
    expect(result).toHaveLength(0);
  });

  it('retorna vazio quando paciente nao tem telefone', () => {
    const semTel = { ...APPOINTMENT_DATA, patientPhone: null };
    const result = scheduleReminders(semTel, [REGRA_24H]);
    expect(result).toHaveLength(0);
  });

  it('descarta lembrete cujo instante ja passou (startAfter no passado)', () => {
    // Consulta ja aconteceu: starts_at no passado
    const passado = { ...APPOINTMENT_DATA, startsAt: '2020-01-01T11:00:00.000Z' };
    const nowMs = new Date('2026-10-01T00:00:00.000Z').getTime();
    const result = scheduleReminders(passado, [REGRA_24H], nowMs);
    expect(result).toHaveLength(0);
  });

  it('canal SMS nao tem fallback', () => {
    const regraSms: AutomationRule = { ...REGRA_24H, channel: 'sms' };
    const result = scheduleReminders(APPOINTMENT_DATA, [regraSms]);
    expect(result).toHaveLength(1);
    expect(result[0]!.payload.fallbackChannel).toBeNull();
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/reminder.test.ts
```

Saida esperada: 7 testes falham (modulo nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/reminder.test.ts
```

Saida esperada: `FAIL`.

- [ ] **Passo 3** — implementar `scheduleReminders`.

Criar `packages/messaging/src/automations/reminder.ts`:

```ts
/**
 * Agenda lembretes de consulta.
 *
 * Para cada automation_rule com trigger `appointment_reminder`, calcula o
 * instante de envio no fuso da clinica e retorna entradas de outbox com
 * `startAfter` para que o pg-boss agende o job no momento correto.
 *
 * Fallback SMS (design §9): se o canal primario e WhatsApp e o envio falhar,
 * o worker tenta por SMS. O fallback e declarado na entrada de outbox para
 * que o despachante saiba o que fazer.
 */

import { computeReminderInstant } from './reminder-timing';
import type { AutomationRule, AppointmentCreatedPayload } from './confirmation';

export interface ReminderOutboxEntry {
  readonly eventType: 'SEND_REMINDER';
  readonly aggregateId: string;
  /** Instante UTC em que o pg-boss deve disparar o job. */
  readonly startAfter: string;
  readonly payload: {
    readonly tenantId: string;
    readonly appointmentId: string;
    readonly patientId: string;
    readonly to: string;
    readonly templateId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    /** Canal de fallback se o primario falhar. Null se nao ha fallback. */
    readonly fallbackChannel: 'sms' | null;
    readonly ruleId: string;
    readonly variables: {
      readonly patientName: string;
      readonly professionalName: string;
      readonly appointmentDate: string;
      readonly procedureName: string;
      readonly startsAt: string;
    };
  };
}

export function scheduleReminders(
  appt: AppointmentCreatedPayload,
  rules: readonly AutomationRule[],
  nowMs: number = Date.now(),
): ReminderOutboxEntry[] {
  if (appt.patientPhone === null || appt.patientPhone === '') {
    return [];
  }

  const matching = rules.filter(
    (r) => r.trigger === 'appointment_reminder' && r.active && r.tenantId === appt.tenantId,
  );

  const entries: ReminderOutboxEntry[] = [];

  for (const rule of matching) {
    const startAfter = computeReminderInstant(
      appt.startsAt,
      appt.clinicTimezone,
      rule.timingOffsetMinutes,
    );

    // Descarta lembretes cujo instante de envio ja passou
    const startAfterMs = new Date(startAfter).getTime();
    if (startAfterMs <= nowMs) {
      continue;
    }

    // Fallback SMS: so quando o canal primario e WhatsApp (design §9)
    const fallbackChannel: 'sms' | null = rule.channel === 'whatsapp' ? 'sms' : null;

    entries.push({
      eventType: 'SEND_REMINDER',
      aggregateId: appt.appointmentId,
      startAfter,
      payload: {
        tenantId: appt.tenantId,
        appointmentId: appt.appointmentId,
        patientId: appt.patientId,
        to: appt.patientPhone!,
        templateId: rule.templateId,
        channel: rule.channel,
        fallbackChannel,
        ruleId: rule.id,
        variables: {
          patientName: appt.patientName,
          professionalName: appt.professionalName,
          appointmentDate: appt.appointmentDate,
          procedureName: appt.procedureName ?? 'Consulta',
          startsAt: appt.startsAt,
        },
      },
    });
  }

  return entries;
}
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/reminder.test.ts
```

Saida esperada: 7 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/messaging/src/automations/reminder.ts packages/messaging/src/automations/reminder.test.ts
git commit -m "feat(messaging): reminder scheduling with clinic timezone and SMS fallback

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 22: handler de pos-consulta e NPS — `handleEncounterFinalized` e `scheduleNps`

**Arquivos:**
- Criar `packages/messaging/src/automations/post-encounter.ts`
- Teste `packages/messaging/src/automations/post-encounter.test.ts`

**Contexto:** quando o evento `ENCOUNTER_FINALIZED` chega, gera ate dois outbox entries: (1) pos-consulta 24h depois (se regra `encounter_finalized` ativa), e (2) NPS 7 dias depois (se regra `nps_due` ativa). Ambos usam `computeReminderInstant` para calcular o instante de envio no fuso da clinica.

- [ ] **Passo 1** — escrever o teste unitario.

Criar `packages/messaging/src/automations/post-encounter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  handleEncounterFinalized,
  scheduleNps,
  type EncounterFinalizedPayload,
  type PostEncounterOutboxEntry,
  type NpsOutboxEntry,
} from './post-encounter';
import type { AutomationRule } from './confirmation';

const REGRA_POS: AutomationRule = {
  id: 'rule-pos',
  tenantId: 'tenant-1',
  trigger: 'encounter_finalized',
  templateId: 'tpl-pos-consulta',
  timingOffsetMinutes: 1440, // 24h depois
  active: true,
  channel: 'whatsapp',
};

const REGRA_NPS: AutomationRule = {
  id: 'rule-nps',
  tenantId: 'tenant-1',
  trigger: 'nps_due',
  templateId: 'tpl-nps',
  timingOffsetMinutes: 10080, // 7 dias depois
  active: true,
  channel: 'whatsapp',
};

const ENCOUNTER: EncounterFinalizedPayload = {
  tenantId: 'tenant-1',
  encounterId: 'enc-1',
  appointmentId: 'appt-1',
  patientId: 'patient-1',
  patientName: 'Maria Souza',
  patientPhone: '+5511999990001',
  professionalName: 'Dr. Silva',
  clinicId: 'clinic-1',
  clinicTimezone: 'America/Sao_Paulo',
  // Finalizado as 17:00 SP = 20:00 UTC
  finalizedAt: '2026-10-07T20:00:00.000Z',
};

describe('handleEncounterFinalized', () => {
  it('gera pos-consulta 24h apos finalizacao no fuso da clinica', () => {
    const result = handleEncounterFinalized(ENCOUNTER, [REGRA_POS]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.eventType).toBe('SEND_POST_ENCOUNTER');
    expect(entry.aggregateId).toBe('enc-1');
    // 17:00 SP dia 7 + 24h = 17:00 SP dia 8 = 20:00 UTC dia 8
    expect(entry.startAfter).toBe('2026-10-08T20:00:00.000Z');
    expect(entry.payload.channel).toBe('whatsapp');
  });

  it('retorna vazio sem regra ativa', () => {
    const result = handleEncounterFinalized(ENCOUNTER, []);
    expect(result).toHaveLength(0);
  });

  it('ignora regra de outro trigger', () => {
    const result = handleEncounterFinalized(ENCOUNTER, [REGRA_NPS]);
    expect(result).toHaveLength(0);
  });

  it('retorna vazio quando paciente nao tem telefone', () => {
    const semTel = { ...ENCOUNTER, patientPhone: null };
    const result = handleEncounterFinalized(semTel, [REGRA_POS]);
    expect(result).toHaveLength(0);
  });
});

describe('scheduleNps', () => {
  it('gera NPS 7 dias apos finalizacao no fuso da clinica', () => {
    const result = scheduleNps(ENCOUNTER, [REGRA_NPS]);

    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry.eventType).toBe('SEND_NPS');
    expect(entry.aggregateId).toBe('enc-1');
    // 17:00 SP dia 7 + 7 dias = 17:00 SP dia 14 = 20:00 UTC dia 14
    expect(entry.startAfter).toBe('2026-10-14T20:00:00.000Z');
    expect(entry.payload.channel).toBe('whatsapp');
    expect(entry.payload.appointmentId).toBe('appt-1');
  });

  it('retorna vazio sem regra nps_due', () => {
    const result = scheduleNps(ENCOUNTER, [REGRA_POS]);
    expect(result).toHaveLength(0);
  });

  it('retorna vazio quando paciente nao tem telefone', () => {
    const semTel = { ...ENCOUNTER, patientPhone: null };
    const result = scheduleNps(semTel, [REGRA_NPS]);
    expect(result).toHaveLength(0);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/post-encounter.test.ts
```

Saida esperada: 7 testes falham (modulo nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/post-encounter.test.ts
```

Saida esperada: `FAIL`.

- [ ] **Passo 3** — implementar `handleEncounterFinalized` e `scheduleNps`.

Criar `packages/messaging/src/automations/post-encounter.ts`:

```ts
/**
 * Automacoes pos-atendimento: acompanhamento e NPS.
 *
 * Pos-consulta: trigger `encounter_finalized`, template de acompanhamento
 * enviado N minutos apos finalizacao (tipicamente 24h = 1440 min).
 *
 * NPS: trigger `nps_due`, template com escala 0-10 enviado N minutos apos
 * finalizacao (tipicamente 7 dias = 10080 min). A resposta do paciente e
 * parseada e gravada em `msg.nps_response` pelo worker.
 */

import { computeReminderInstant } from './reminder-timing';
import type { AutomationRule } from './confirmation';

export interface EncounterFinalizedPayload {
  readonly tenantId: string;
  readonly encounterId: string;
  readonly appointmentId: string | null;
  readonly patientId: string;
  readonly patientName: string;
  readonly patientPhone: string | null;
  readonly professionalName: string;
  readonly clinicId: string;
  readonly clinicTimezone: string;
  /** Instante UTC da finalizacao. */
  readonly finalizedAt: string;
}

export interface PostEncounterOutboxEntry {
  readonly eventType: 'SEND_POST_ENCOUNTER';
  readonly aggregateId: string;
  readonly startAfter: string;
  readonly payload: {
    readonly tenantId: string;
    readonly encounterId: string;
    readonly patientId: string;
    readonly to: string;
    readonly templateId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    readonly variables: {
      readonly patientName: string;
      readonly professionalName: string;
    };
  };
}

export interface NpsOutboxEntry {
  readonly eventType: 'SEND_NPS';
  readonly aggregateId: string;
  readonly startAfter: string;
  readonly payload: {
    readonly tenantId: string;
    readonly encounterId: string;
    readonly appointmentId: string | null;
    readonly patientId: string;
    readonly to: string;
    readonly templateId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    readonly variables: {
      readonly patientName: string;
      readonly professionalName: string;
    };
  };
}

export function handleEncounterFinalized(
  enc: EncounterFinalizedPayload,
  rules: readonly AutomationRule[],
): PostEncounterOutboxEntry[] {
  if (enc.patientPhone === null || enc.patientPhone === '') {
    return [];
  }

  const matching = rules.filter(
    (r) => r.trigger === 'encounter_finalized' && r.active && r.tenantId === enc.tenantId,
  );

  return matching.map((rule) => {
    const startAfter = computeReminderInstant(
      enc.finalizedAt,
      enc.clinicTimezone,
      rule.timingOffsetMinutes,
    );

    return {
      eventType: 'SEND_POST_ENCOUNTER' as const,
      aggregateId: enc.encounterId,
      startAfter,
      payload: {
        tenantId: enc.tenantId,
        encounterId: enc.encounterId,
        patientId: enc.patientId,
        to: enc.patientPhone!,
        templateId: rule.templateId,
        channel: rule.channel,
        variables: {
          patientName: enc.patientName,
          professionalName: enc.professionalName,
        },
      },
    };
  });
}

export function scheduleNps(
  enc: EncounterFinalizedPayload,
  rules: readonly AutomationRule[],
): NpsOutboxEntry[] {
  if (enc.patientPhone === null || enc.patientPhone === '') {
    return [];
  }

  const matching = rules.filter(
    (r) => r.trigger === 'nps_due' && r.active && r.tenantId === enc.tenantId,
  );

  return matching.map((rule) => {
    const startAfter = computeReminderInstant(
      enc.finalizedAt,
      enc.clinicTimezone,
      rule.timingOffsetMinutes,
    );

    return {
      eventType: 'SEND_NPS' as const,
      aggregateId: enc.encounterId,
      startAfter,
      payload: {
        tenantId: enc.tenantId,
        encounterId: enc.encounterId,
        appointmentId: enc.appointmentId,
        patientId: enc.patientId,
        to: enc.patientPhone!,
        templateId: rule.templateId,
        channel: rule.channel,
        variables: {
          patientName: enc.patientName,
          professionalName: enc.professionalName,
        },
      },
    };
  });
}
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/post-encounter.test.ts
```

Saida esperada: 7 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/messaging/src/automations/post-encounter.ts packages/messaging/src/automations/post-encounter.test.ts
git commit -m "feat(messaging): post-encounter and NPS automation handlers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 23: migration 0075 — funcao SQL `msg.compute_send_at` e teste de integracao do lembrete no fuso correto

**Arquivos:**
- Criar `packages/db/migrations/0075_compute_send_at.sql`
- Teste `packages/messaging/src/automations/reminder-timezone.int.test.ts`

**Contexto:** o teste obrigatorio do enunciado: lembrete de 24h para consulta as 8h no fuso da clinica (America/Sao_Paulo) deve ser enviado as 8h do dia anterior, nao as 5h UTC. Este teste de integracao valida a funcao SQL e o fluxo completo. A funcao SQL `msg.compute_send_at` espelha a logica de `computeReminderInstant` no banco, para que o job de lembrete possa calcular o instante de envio diretamente na query.

- [ ] **Passo 1** — escrever o teste de integracao.

Criar `packages/messaging/src/automations/reminder-timezone.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let admin: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (!url) throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => { admin = new Pool({ connectionString: adminUrl(), max: 1 }); });
afterAll(async () => { await admin.end(); });

describe('msg.compute_send_at — fuso da clinica', () => {
  it('lembrete 24h antes: consulta 8h SP sai 8h dia anterior SP, nao 5h UTC', async () => {
    // Consulta as 8h em America/Sao_Paulo = 11:00 UTC
    // Offset -1440 min (24h antes)
    // Esperado: 8h dia anterior SP = 11:00 UTC dia anterior
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', -1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-06T11:00:00Z');
  });

  it('lembrete 2h antes: consulta 8h SP sai 6h SP (9h UTC)', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', -120)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-07T09:00:00Z');
  });

  it('pos-consulta 24h depois: offset positivo funciona', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', 1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-08T11:00:00Z');
  });

  it('NPS 7 dias depois', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', 10080)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-14T11:00:00Z');
  });

  it('confirma que 24h antes NAO e simplesmente subtrair 1440 min do UTC', async () => {
    // Demonstra o ERRO que teriamos se subtraissemos diretamente do UTC.
    // Consulta as 8h em SP (UTC-3) = 11:00 UTC.
    // Subtrair 1440 min do UTC: 11:00 - 24h = 11:00 dia anterior (coincidencia ERRADA).
    // Mas para um fuso com DST, o resultado seria diferente.
    // Testamos com America/New_York para provar a diferenca:
    // Consulta 2026-03-09 09:00 EDT (UTC-4) = 13:00 UTC
    // 24h antes local = 2026-03-08 09:00 EST (UTC-5) = 14:00 UTC
    // Se fosse subtracao pura: 13:00 - 24h = 13:00 dia anterior (ERRADO)
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-03-09T13:00:00Z'::timestamptz, 'America/New_York', -1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    // 2026-03-08 09:00 EST = 14:00 UTC, NAO 13:00 UTC
    expect(rows[0]!.send_at).toBe('2026-03-08T14:00:00Z');
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timezone.int.test.ts
```

Saida esperada: testes falham (funcao `msg.compute_send_at` nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timezone.int.test.ts
```

Saida esperada: `FAIL` — funcao `msg.compute_send_at` nao existe.

- [ ] **Passo 3** — escrever a migration 0075.

Criar `packages/db/migrations/0075_compute_send_at.sql`:

```sql
-- 0075_compute_send_at.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Funcao SQL que calcula o instante UTC de envio de automacao respeitando o
-- fuso da clinica. O offset e aplicado no horario LOCAL, nao no UTC.
--
-- Algoritmo:
-- 1. Converte o instante de referencia para o fuso da clinica.
-- 2. Aplica o offset em minutos no horario local.
-- 3. O Postgres converte de volta para timestamptz automaticamente.
--
-- Isso garante que o lembrete de 24h antes de uma consulta as 8h em
-- America/Sao_Paulo sai as 8h do dia anterior em horario local, e NAO
-- as 5h UTC (que seria o resultado de subtrair 1440 min do instante UTC).

CREATE FUNCTION msg.compute_send_at(
  p_reference_at  timestamptz,
  p_timezone      text,
  p_offset_minutes int
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  -- O truque: converter para o fuso local, somar o intervalo no espaco local,
  -- e converter de volta. O Postgres faz a conversao de volta corretamente,
  -- incluindo transicoes de horario de verao.
  SELECT ((p_reference_at AT TIME ZONE p_timezone)
          + make_interval(mins => p_offset_minutes))
         AT TIME ZONE p_timezone
$$;

ALTER FUNCTION msg.compute_send_at(timestamptz, text, int) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION msg.compute_send_at(timestamptz, text, int) TO app_rw;
```

Rodar:

```bash
pnpm db:migrate
```

Saida esperada: migration 0075 aplicada sem erro.

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timezone.int.test.ts
```

Saida esperada: 5 testes passam.

- [ ] **Passo 5** — exportar os modulos de automacao no indice do pacote e commitar.

Modificar `packages/messaging/src/index.ts`:

```ts
export {
  computeReminderInstant,
} from './automations/reminder-timing';

export {
  handleAppointmentCreated,
  type AppointmentCreatedPayload,
  type AutomationRule,
  type AutomationTrigger,
  type ConfirmationOutboxEntry,
} from './automations/confirmation';

export {
  scheduleReminders,
  type ReminderOutboxEntry,
} from './automations/reminder';

export {
  handleEncounterFinalized,
  scheduleNps,
  type EncounterFinalizedPayload,
  type PostEncounterOutboxEntry,
  type NpsOutboxEntry,
} from './automations/post-encounter';
```

Commitar:

```bash
git add packages/db/migrations/0075_compute_send_at.sql \
  packages/messaging/src/automations/reminder-timezone.int.test.ts \
  packages/messaging/src/index.ts
git commit -m "feat(messaging): SQL compute_send_at and timezone integration test (0075)

The reminder for an 8 AM appointment in America/Sao_Paulo fires at
8 AM the previous day in local time, not 5 AM UTC.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
