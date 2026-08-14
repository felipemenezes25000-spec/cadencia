import {
  conviteEquipeEmail, lembreteConsultaEmail,
  type EmailProvider,
} from '@cadencia/integrations';

export interface SendEmailInput {
  readonly template: 'convite-equipe' | 'lembrete-consulta';
  readonly vars: Record<string, string>;
  readonly to: string;
  readonly tenantId: string;
}

const templates: Record<SendEmailInput['template'],
  (vars: Record<string, string>) => { subject: string; html: string; text: string }> = {
  'convite-equipe': (v) => conviteEquipeEmail({
    nomeConvidado: v['nomeConvidado'] ?? '',
    nomeClinica: v['nomeClinica'] ?? '',
    urlConvite: v['urlConvite'] ?? '',
  }),
  'lembrete-consulta': (v) => lembreteConsultaEmail({
    nomePaciente: v['nomePaciente'] ?? '',
    nomeProfissional: v['nomeProfissional'] ?? '',
    data: v['data'] ?? '',
    hora: v['hora'] ?? '',
    nomeClinica: v['nomeClinica'] ?? '',
  }),
};

export async function sendEmail(
  input: SendEmailInput,
  email: EmailProvider,
): Promise<{ status: string; messageId?: string }> {
  const render = templates[input.template];
  const { subject, html, text } = render(input.vars);

  const ctx = {
    tenantId: input.tenantId,
    actorUserId: null,
    requestId: `email-${input.template}-${input.to}`,
    idempotencyKey: `email:${input.template}:${input.to}:${input.tenantId}`,
    deadlineMs: 15_000,
  };

  const resultado = await email.send(ctx, { to: input.to, subject, html, text });

  if (resultado.ok) {
    return { status: 'enviado', messageId: resultado.value.messageId };
  }

  if (resultado.error.kind === 'unavailable') {
    return { status: 'provedor_indisponivel' };
  }

  return { status: `falha:${resultado.error.kind}` };
}
