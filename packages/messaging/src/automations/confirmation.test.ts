import { describe, expect, it } from 'vitest';
import {
  handleAppointmentCreated,
  type AppointmentCreatedPayload,
  type AutomationRule,
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
