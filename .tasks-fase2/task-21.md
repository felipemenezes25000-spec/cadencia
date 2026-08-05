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