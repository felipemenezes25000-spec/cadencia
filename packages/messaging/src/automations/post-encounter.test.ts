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
