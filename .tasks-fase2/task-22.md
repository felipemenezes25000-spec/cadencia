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