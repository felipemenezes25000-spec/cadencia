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
