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