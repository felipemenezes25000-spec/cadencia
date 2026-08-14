import { describe, expect, it } from 'vitest';
import {
  handleBirthday, handleInactive, handleNoShow, handleOverdue, handleRecall,
} from './retencao';
import type { AutomationRule, AutomationTrigger } from './confirmation';

const TENANT = 't-1';

function regra(trigger: AutomationTrigger, extra: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'r-' + trigger,
    tenantId: TENANT,
    trigger,
    templateId: 'tpl-1',
    timingOffsetMinutes: 0,
    active: true,
    channel: 'whatsapp',
    ...extra,
  };
}

const alvo = {
  tenantId: TENANT,
  patientId: 'p-1',
  patientName: 'Maria de Souza Lima',
  patientPhone: '+5511999990000',
};

/* ── Recusas que valem para todos ─────────────────────────────────────── */

describe('recusas comuns a todos os gatilhos', () => {
  it('sem telefone nao enfileira nada', () => {
    const semTel = { ...alvo, patientPhone: null };
    expect(handleNoShow(
      { ...semTel, appointmentId: 'a-1', appointmentDate: '2026-08-10', professionalName: 'Dra. Ana' },
      [regra('appointment_no_show')],
    )).toEqual([]);
  });

  it('telefone vazio conta como sem telefone', () => {
    expect(handleRecall(
      { ...alvo, patientPhone: '', encounterId: 'e-1', recallDate: '2026-09-01', professionalName: 'Dr. B' },
      [regra('recall_due')],
    )).toEqual([]);
  });

  it('regra inativa nao dispara', () => {
    expect(handleNoShow(
      { ...alvo, appointmentId: 'a-1', appointmentDate: '2026-08-10', professionalName: 'Dra. Ana' },
      [regra('appointment_no_show', { active: false })],
    )).toEqual([]);
  });

  it('regra de OUTRO tenant nao dispara', () => {
    /* O handler recebe regras ja carregadas; se vazasse regra de outro tenant,
       um paciente receberia mensagem com o template da clinica errada. */
    expect(handleNoShow(
      { ...alvo, appointmentId: 'a-1', appointmentDate: '2026-08-10', professionalName: 'Dra. Ana' },
      [regra('appointment_no_show', { tenantId: 'outro' })],
    )).toEqual([]);
  });

  it('regra de outro gatilho nao dispara', () => {
    expect(handleNoShow(
      { ...alvo, appointmentId: 'a-1', appointmentDate: '2026-08-10', professionalName: 'Dra. Ana' },
      [regra('appointment_reminder')],
    )).toEqual([]);
  });
});

/* ── Base legal ───────────────────────────────────────────────────────── */

describe('LGPD — relacionamento exige consentimento', () => {
  it('aniversario NAO sai sem consentimento de marketing', () => {
    expect(handleBirthday(
      { ...alvo, consentiuMarketing: false },
      [regra('patient_birthday')],
    )).toEqual([]);
  });

  it('aniversario sai com consentimento', () => {
    const r = handleBirthday({ ...alvo, consentiuMarketing: true }, [regra('patient_birthday')]);
    expect(r).toHaveLength(1);
    expect(r[0]!.eventType).toBe('SEND_BIRTHDAY');
    expect(r[0]!.payload.variables['primeiroNome']).toBe('Maria');
  });

  it('reativacao NAO sai sem consentimento', () => {
    expect(handleInactive(
      { ...alvo, consentiuMarketing: false, diasSemAtendimento: 180 },
      [regra('patient_inactive', { timingOffsetMinutes: 180 * 24 * 60 })],
    )).toEqual([]);
  });

  it('falta, retorno e cobranca NAO dependem de consentimento', () => {
    /* Sao execucao do atendimento ou do contrato — tutela da saude e
       cumprimento de obrigacao, nao marketing. */
    expect(handleNoShow(
      { ...alvo, appointmentId: 'a-1', appointmentDate: '2026-08-10', professionalName: 'Dra. Ana' },
      [regra('appointment_no_show')],
    )).toHaveLength(1);

    expect(handleRecall(
      { ...alvo, encounterId: 'e-1', recallDate: '2026-09-01', professionalName: 'Dr. B' },
      [regra('recall_due')],
    )).toHaveLength(1);

    expect(handleOverdue(
      { ...alvo, entryId: 'f-1', amountCents: 15000, dueDate: '2026-08-01', diasDeAtraso: 3 },
      [regra('payment_overdue', { timingOffsetMinutes: 3 * 24 * 60 })],
    )).toHaveLength(1);
  });
});

/* ── Régua de cobrança ────────────────────────────────────────────────── */

describe('regua de cobranca', () => {
  const regua = [
    regra('payment_overdue', { id: 'd3', timingOffsetMinutes: 3 * 24 * 60 }),
    regra('payment_overdue', { id: 'd15', timingOffsetMinutes: 15 * 24 * 60 }),
    regra('payment_overdue', { id: 'd30', timingOffsetMinutes: 30 * 24 * 60 }),
  ];

  it('dispara SO a regra do dia exato de atraso', () => {
    /* Sem isso, um titulo com 40 dias de atraso dispararia as tres reguas de
       uma vez — e de novo no dia seguinte, e no outro. */
    const r = handleOverdue(
      { ...alvo, entryId: 'f-1', amountCents: 15000, dueDate: '2026-08-01', diasDeAtraso: 15 },
      regua,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.payload.ruleId).toBe('d15');
  });

  it('dia que nao casa com nenhuma regua nao envia nada', () => {
    expect(handleOverdue(
      { ...alvo, entryId: 'f-1', amountCents: 15000, dueDate: '2026-08-01', diasDeAtraso: 7 },
      regua,
    )).toEqual([]);
  });

  it('formata o valor em reais para a mensagem', () => {
    const r = handleOverdue(
      { ...alvo, entryId: 'f-1', amountCents: 1234567, dueDate: '2026-08-01', diasDeAtraso: 3 },
      regua,
    );
    expect(r[0]!.payload.variables['amount']).toBe('R$ 12.345,67');
  });

  it('centavos abaixo de dez ganham zero a esquerda', () => {
    const r = handleOverdue(
      { ...alvo, entryId: 'f-1', amountCents: 1005, dueDate: '2026-08-01', diasDeAtraso: 3 },
      regua,
    );
    expect(r[0]!.payload.variables['amount']).toBe('R$ 10,05');
  });
});

/* ── Reativação por faixa ─────────────────────────────────────────────── */

describe('reativacao', () => {
  it('so dispara a faixa que casa com os dias sem atendimento', () => {
    const faixas = [
      regra('patient_inactive', { id: 'f180', timingOffsetMinutes: 180 * 24 * 60 }),
      regra('patient_inactive', { id: 'f365', timingOffsetMinutes: 365 * 24 * 60 }),
    ];
    const r = handleInactive({ ...alvo, consentiuMarketing: true, diasSemAtendimento: 365 }, faixas);
    expect(r).toHaveLength(1);
    expect(r[0]!.payload.ruleId).toBe('f365');
  });
});

/* ── Forma da entrada de outbox ───────────────────────────────────────── */

describe('entrada de outbox', () => {
  it('carrega tenant, destino, template, canal e regra', () => {
    const r = handleNoShow(
      { ...alvo, appointmentId: 'a-99', appointmentDate: '2026-08-10', professionalName: 'Dra. Ana' },
      [regra('appointment_no_show', { channel: 'sms' })],
    );
    expect(r[0]).toMatchObject({
      eventType: 'SEND_NO_SHOW_FOLLOWUP',
      aggregateId: 'a-99',
      payload: {
        tenantId: TENANT,
        patientId: 'p-1',
        to: '+5511999990000',
        templateId: 'tpl-1',
        channel: 'sms',
        ruleId: 'r-appointment_no_show',
      },
    });
  });

  it('duas regras ativas do mesmo gatilho geram duas entradas', () => {
    const r = handleRecall(
      { ...alvo, encounterId: 'e-1', recallDate: '2026-09-01', professionalName: 'Dr. B' },
      [
        regra('recall_due', { id: 'wa', channel: 'whatsapp' }),
        regra('recall_due', { id: 'em', channel: 'email' }),
      ],
    );
    expect(r.map((x) => x.payload.ruleId)).toEqual(['wa', 'em']);
  });
});
