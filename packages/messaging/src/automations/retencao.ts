/**
 * Handlers dos gatilhos de retenção e cobrança (migration 0182).
 *
 * O motor cobria o ciclo do agendamento e o NPS. Estes cinco leem estado que
 * já existia no banco e ninguém lia:
 *
 *   appointment_no_show  falta registrada       -> convite para remarcar
 *   recall_due           retorno clínico devido -> lembrete de retorno
 *   payment_overdue      título vencido         -> régua de cobrança
 *   patient_birthday     aniversário            -> relacionamento
 *   patient_inactive     sem atendimento há N   -> reativação
 *
 * Mesmo contrato dos handlers existentes: recebe dados JÁ RESOLVIDOS por L3 ou
 * pelo worker e devolve entradas de outbox. O messaging não importa scheduling
 * nem finance — a composição é de quem chama.
 *
 * BASE LEGAL. Aniversário e reativação não se apoiam na tutela da saúde
 * (LGPD art. 7, VIII): são relacionamento, uso secundário, e exigem
 * consentimento com finalidade 'marketing'. Por isso os payloads desses dois
 * carregam `consentiuMarketing` OBRIGATÓRIO — quem chama é forçado pelo tipo a
 * ir buscar a resposta em app.lgpd_consent. Sem consentimento, o handler
 * devolve lista vazia.
 *
 * Falta, retorno e cobrança são execução do atendimento ou do contrato e não
 * dependem de consentimento separado — por isso os payloads deles não têm o
 * campo, e não há como esquecer de checar algo que não existe.
 */

import { systemClock } from '@cadencia/kernel';
import { exigeConsentimentoDeMarketing, type AutomationRule, type AutomationTrigger } from './confirmation';

/* ── Contratos ────────────────────────────────────────────────────────── */

interface Alvo {
  readonly tenantId: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly patientPhone: string | null;
}

export interface NoShowPayload extends Alvo {
  readonly appointmentId: string;
  /** Data da falta, já no fuso da clínica, para aparecer na mensagem. */
  readonly appointmentDate: string;
  readonly professionalName: string;
}

export interface RecallPayload extends Alvo {
  readonly encounterId: string;
  /** Data em que o retorno passa a ser devido, no fuso da clínica. */
  readonly recallDate: string;
  readonly professionalName: string;
}

export interface OverduePayload extends Alvo {
  readonly entryId: string;
  readonly amountCents: number;
  readonly dueDate: string;
  /** Dias corridos de atraso. Regra escolhe a régua pelo offset. */
  readonly diasDeAtraso: number;
}

export interface BirthdayPayload extends Alvo {
  /** De app.lgpd_consent, finalidade 'marketing'. Sem ele não sai nada. */
  readonly consentiuMarketing: boolean;
}

export interface InactivePayload extends Alvo {
  readonly consentiuMarketing: boolean;
  readonly diasSemAtendimento: number;
}

export type EventoDeRetencao =
  | 'SEND_NO_SHOW_FOLLOWUP'
  | 'SEND_RECALL'
  | 'SEND_OVERDUE_NOTICE'
  | 'SEND_BIRTHDAY'
  | 'SEND_REACTIVATION';

export interface RetencaoOutboxEntry {
  readonly eventType: EventoDeRetencao;
  readonly aggregateId: string;
  readonly payload: {
    readonly tenantId: string;
    readonly patientId: string;
    readonly to: string;
    readonly templateId: string;
    readonly channel: 'whatsapp' | 'sms' | 'email';
    readonly ruleId: string;
    readonly variables: Readonly<Record<string, string>>;
  };
}

/* ── Núcleo ───────────────────────────────────────────────────────────── */

/**
 * Regras que valem para este alvo. Centraliza as três recusas que todo handler
 * precisa fazer — e que, espalhadas, alguém esquece numa delas.
 */
function regrasAplicaveis(
  gatilho: AutomationTrigger,
  alvo: Alvo,
  regras: readonly AutomationRule[],
  consentiuMarketing: boolean | null,
): readonly AutomationRule[] {
  // Sem canal de contato não há o que enfileirar.
  if (alvo.patientPhone === null || alvo.patientPhone === '') return [];

  // Base legal antes de qualquer envio de relacionamento.
  if (exigeConsentimentoDeMarketing(gatilho) && consentiuMarketing !== true) return [];

  return regras.filter(
    (r) => r.trigger === gatilho && r.active && r.tenantId === alvo.tenantId,
  );
}

function entrada(
  eventType: EventoDeRetencao,
  aggregateId: string,
  alvo: Alvo,
  regra: AutomationRule,
  variables: Readonly<Record<string, string>>,
): RetencaoOutboxEntry {
  return {
    eventType,
    aggregateId,
    payload: {
      tenantId: alvo.tenantId,
      patientId: alvo.patientId,
      to: alvo.patientPhone as string,
      templateId: regra.templateId,
      channel: regra.channel,
      ruleId: regra.id,
      variables,
    },
  };
}

/* ── Handlers ─────────────────────────────────────────────────────────── */

export function handleNoShow(
  p: NoShowPayload,
  regras: readonly AutomationRule[],
): RetencaoOutboxEntry[] {
  return regrasAplicaveis('appointment_no_show', p, regras, null).map((r) =>
    entrada('SEND_NO_SHOW_FOLLOWUP', p.appointmentId, p, r, {
      patientName: p.patientName,
      professionalName: p.professionalName,
      appointmentDate: p.appointmentDate,
    }));
}

export function handleRecall(
  p: RecallPayload,
  regras: readonly AutomationRule[],
): RetencaoOutboxEntry[] {
  return regrasAplicaveis('recall_due', p, regras, null).map((r) =>
    entrada('SEND_RECALL', p.encounterId, p, r, {
      patientName: p.patientName,
      professionalName: p.professionalName,
      recallDate: p.recallDate,
    }));
}

/**
 * Régua de cobrança. `timingOffsetMinutes` da regra define em QUANTOS DIAS de
 * atraso ela dispara — uma régua de 3/15/30 dias são três regras com offsets
 * diferentes. A regra só vale no dia exato, senão um título com 40 dias de
 * atraso dispararia as três de uma vez, todo dia.
 */
export function handleOverdue(
  p: OverduePayload,
  regras: readonly AutomationRule[],
): RetencaoOutboxEntry[] {
  return regrasAplicaveis('payment_overdue', p, regras, null)
    .filter((r) => Math.round(r.timingOffsetMinutes / (60 * 24)) === p.diasDeAtraso)
    .map((r) =>
      entrada('SEND_OVERDUE_NOTICE', p.entryId, p, r, {
        patientName: p.patientName,
        dueDate: p.dueDate,
        diasDeAtraso: String(p.diasDeAtraso),
        amount: formatarReais(p.amountCents),
      }));
}

export function handleBirthday(
  p: BirthdayPayload,
  regras: readonly AutomationRule[],
): RetencaoOutboxEntry[] {
  return regrasAplicaveis('patient_birthday', p, regras, p.consentiuMarketing).map((r) =>
    entrada('SEND_BIRTHDAY', p.patientId, p, r, {
      patientName: p.patientName,
      primeiroNome: primeiroNome(p.patientName),
    }));
}

export function handleInactive(
  p: InactivePayload,
  regras: readonly AutomationRule[],
): RetencaoOutboxEntry[] {
  return regrasAplicaveis('patient_inactive', p, regras, p.consentiuMarketing)
    /* Offset em dias, como na cobrança: "inativo há 180 dias" e "há 365" são
       duas regras, e só dispara a que casa com a faixa. */
    .filter((r) => Math.round(r.timingOffsetMinutes / (60 * 24)) === p.diasSemAtendimento)
    .map((r) =>
      entrada('SEND_REACTIVATION', p.patientId, p, r, {
        patientName: p.patientName,
        primeiroNome: primeiroNome(p.patientName),
        diasSemAtendimento: String(p.diasSemAtendimento),
      }));
}

/* ── Auxiliares ───────────────────────────────────────────────────────── */

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

function formatarReais(centavos: number): string {
  const sinal = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100).toLocaleString('pt-BR');
  return `R$ ${sinal}${inteiro},${String(abs % 100).padStart(2, '0')}`;
}

/** Reexportado para o worker não precisar importar o kernel só para o relógio. */
export const agoraMs = (): number => systemClock.nowMs();
