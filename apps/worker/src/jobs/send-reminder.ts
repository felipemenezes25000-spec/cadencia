import { withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import type { EmailProvider, MessagingProvider } from '@cadencia/integrations';

export interface SendReminderInput {
  readonly tenantId: string;
  readonly appointmentId: string;
  readonly patientId: string;
  readonly templateId: string;
  readonly channelIdentityId: string;
  readonly channelKind: 'whatsapp' | 'sms' | 'email';
  readonly ruleId: string;
}

export interface ReminderProviders {
  readonly whatsapp: MessagingProvider;
  readonly sms: MessagingProvider;
  readonly email: EmailProvider;
}

export type SendReminderResult =
  | { readonly status: 'sent'; readonly providerMessageId: string }
  | { readonly status: 'retryable'; readonly detail: string }
  | { readonly status: 'indeterminate'; readonly detail: string }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ignored'; readonly detail: string };

interface ReminderData {
  readonly templateName: string;
  readonly templateLanguage: string;
  readonly templateBody: string;
  readonly templateVariables: string[];
  readonly channelIdentityRef: string;
  readonly startsAt: Date;
  readonly timezone: string;
  readonly patientName: string;
  readonly patientPhone: string | null;
  readonly patientEmail: string | null;
  readonly clinicName: string;
  readonly professionalName: string;
}

function normalizarVariaveis(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

function chaveVariavel(nome: string): string {
  return nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function formatarData(data: Date, timezone: string): { data: string; hora: string } {
  const dataFmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(data);
  const horaFmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(data);
  return { data: dataFmt, hora: horaFmt };
}

function valoresDoTemplate(d: ReminderData): { nomes: string[]; valores: string[] } {
  const { data, hora } = formatarData(d.startsAt, d.timezone);
  const mapa: Record<string, string> = {
    nomepaciente: d.patientName,
    patientname: d.patientName,
    paciente: d.patientName,
    nomeprofissional: d.professionalName,
    professionalname: d.professionalName,
    profissional: d.professionalName,
    nomeclinica: d.clinicName,
    clinicname: d.clinicName,
    clinica: d.clinicName,
    data,
    date: data,
    hora,
    time: hora,
  };
  return {
    nomes: d.templateVariables,
    valores: d.templateVariables.map((nome) => mapa[chaveVariavel(nome)] ?? ''),
  };
}

function escaparRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderizarTexto(template: string, nomes: string[], valores: string[]): string {
  let out = template;
  nomes.forEach((nome, i) => {
    const valor = valores[i] ?? '';
    out = out.replace(new RegExp(`{{\\s*${escaparRegex(nome)}\\s*}}`, 'gi'), valor);
    out = out.replace(new RegExp(`{{\\s*${i + 1}\\s*}}`, 'g'), valor);
  });
  return out;
}

function escaparHtml(v: string): string {
  return v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function carregar(input: SendReminderInput, actor: Actor): Promise<ReminderData | null> {
  return withTenantTx(actor, async (tx) => {
    const { rows: templates } = await tx.query<{
      name: string; language: string; body_template: string; variables: unknown;
      channel_identity_ref: string;
    }>(
      `SELECT t.name, t.language, t.body_template, t.variables,
              coalesce(ci.provider_ref, ci.id::text) AS channel_identity_ref
         FROM msg.template t
         JOIN msg.channel_identity ci
           ON ci.tenant_id = t.tenant_id AND ci.id = t.channel_identity_id
        WHERE t.id = $1
          AND t.channel_identity_id = $2
          AND t.channel = $3
          AND ci.channel = $3
          AND ci.status IN ('active', 'verified')
          AND (t.channel <> 'whatsapp' OR t.status = 'approved')`,
      [input.templateId, input.channelIdentityId, input.channelKind],
    );
    const template = templates[0];
    if (template === undefined) return null;

    const { rows: appointments } = await tx.query<{
      starts_at: Date; patient_id: string; patient_name: string;
      patient_phone: string | null; patient_email: string | null;
      clinic_name: string; timezone: string; professional_name: string | null;
    }>(
      `SELECT a.starts_at, a.patient_id,
              pat.full_name AS patient_name,
              pat.phone_primary AS patient_phone,
              pat.email::text AS patient_email,
              cl.nome AS clinic_name, cl.timezone,
              u.full_name AS professional_name
         FROM sched.appointment a
         JOIN clin.patient pat
           ON pat.tenant_id = a.tenant_id AND pat.id = a.patient_id
         JOIN app.clinic cl
           ON cl.tenant_id = a.tenant_id AND cl.id = a.clinic_id
         LEFT JOIN app.professional prof
           ON prof.tenant_id = a.tenant_id AND prof.id = a.professional_id
         LEFT JOIN id."user" u ON u.id = prof.user_id
        WHERE a.id = $1
          AND a.patient_id = $2
          AND a.status IN ('agendado', 'confirmado')`,
      [input.appointmentId, input.patientId],
    );
    const appt = appointments[0];
    if (appt === undefined) return null;

    return {
      templateName: template.name,
      templateLanguage: template.language,
      templateBody: template.body_template,
      templateVariables: normalizarVariaveis(template.variables),
      channelIdentityRef: template.channel_identity_ref,
      startsAt: appt.starts_at,
      timezone: appt.timezone,
      patientName: appt.patient_name,
      patientPhone: appt.patient_phone,
      patientEmail: appt.patient_email,
      clinicName: appt.clinic_name,
      professionalName: appt.professional_name ?? '',
    };
  });
}

function falhaProvider(error: { kind: string; retrySafe: boolean; detail: string }): SendReminderResult {
  if (error.retrySafe) return { status: 'retryable', detail: error.detail };
  if (error.kind === 'timeout') return { status: 'indeterminate', detail: error.detail };
  return { status: 'failed', detail: error.detail };
}

export async function sendReminder(
  input: SendReminderInput,
  providers: ReminderProviders,
): Promise<SendReminderResult> {
  const actor: Actor = {
    kind: 'system', tenantId: input.tenantId,
    reason: 'send-appointment-reminder', requestId: uuidv7(),
  };
  const dados = await carregar(input, actor);
  if (dados === null) {
    return { status: 'ignored', detail: 'agendamento ou template indisponivel' };
  }

  const { nomes, valores } = valoresDoTemplate(dados);
  const idempotencyKey = `reminder:${input.ruleId}:${input.appointmentId}`;
  const ctx = {
    tenantId: input.tenantId,
    actorUserId: null,
    requestId: actor.requestId,
    idempotencyKey,
    deadlineMs: 15_000,
  };

  if (input.channelKind === 'email') {
    if (dados.patientEmail === null || dados.patientEmail.trim() === '') {
      return { status: 'ignored', detail: 'paciente sem email' };
    }
    const text = renderizarTexto(dados.templateBody, nomes, valores);
    const html = `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escaparHtml(text)}</div>`;
    const r = await providers.email.send(ctx, {
      to: dados.patientEmail,
      subject: `Lembrete de consulta — ${dados.clinicName}`,
      text,
      html,
    });
    if (!r.ok) return falhaProvider(r.error);
    return { status: 'sent', providerMessageId: r.value.messageId };
  }

  if (dados.patientPhone === null || dados.patientPhone.trim() === '') {
    return { status: 'ignored', detail: 'paciente sem telefone' };
  }

  const provider = input.channelKind === 'sms' ? providers.sms : providers.whatsapp;
  const body = input.channelKind === 'whatsapp'
    ? {
        kind: 'template' as const,
        templateName: dados.templateName,
        language: dados.templateLanguage,
        variables: valores,
      }
    : {
        kind: 'text' as const,
        text: renderizarTexto(dados.templateBody, nomes, valores),
      };

  const r = await provider.send(ctx, {
    channelIdentityRef: dados.channelIdentityRef,
    to: dados.patientPhone,
    body,
    conversationId: `reminder:${input.appointmentId}`,
  });
  if (!r.ok) return falhaProvider(r.error);
  return { status: 'sent', providerMessageId: r.value.providerMessageId };
}
