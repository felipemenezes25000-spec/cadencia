export interface LembreteConsultaVars {
  readonly nomePaciente: string;
  readonly nomeProfissional: string;
  readonly data: string;
  readonly hora: string;
  readonly nomeClinica: string;
}

export function lembreteConsultaEmail(vars: LembreteConsultaVars): {
  subject: string; html: string; text: string;
} {
  const { nomePaciente, nomeProfissional, data, hora, nomeClinica } = vars;

  const subject = `Lembrete de consulta — ${nomeClinica}`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden">
  <tr><td style="background:#087783;padding:24px 32px">
    <span style="color:#ffffff;font-size:20px;font-weight:bold">Cadencia</span>
  </td></tr>
  <tr><td style="padding:32px">
    <p style="margin:0 0 16px;font-size:16px;color:#333333">
      Ola, ${nomePaciente}!
    </p>
    <p style="margin:0 0 24px;font-size:16px;color:#333333">
      Este e um lembrete da sua consulta agendada:
    </p>
    <table width="100%" cellpadding="0" cellspacing="0"
           style="background:#f4f4f7;border-radius:6px;margin:0 0 24px">
      <tr><td style="padding:20px 24px">
        <p style="margin:0 0 8px;font-size:14px;color:#666666">Profissional</p>
        <p style="margin:0 0 16px;font-size:16px;color:#333333;font-weight:bold">
          ${nomeProfissional}
        </p>
        <p style="margin:0 0 8px;font-size:14px;color:#666666">Data e horario</p>
        <p style="margin:0;font-size:16px;color:#333333;font-weight:bold">
          ${data} as ${hora}
        </p>
      </td></tr>
    </table>
    <p style="margin:0;font-size:14px;color:#666666">
      Em caso de duvidas, entre em contato com a ${nomeClinica}.
    </p>
  </td></tr>
  <tr><td style="padding:16px 32px;font-size:12px;color:#999999;text-align:center">
    Cadencia &mdash; Prontuario eletronico
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Ola, ${nomePaciente}!`,
    '',
    'Este e um lembrete da sua consulta agendada:',
    '',
    `Profissional: ${nomeProfissional}`,
    `Data: ${data} as ${hora}`,
    '',
    `Em caso de duvidas, entre em contato com a ${nomeClinica}.`,
    '',
    '-- Cadencia',
  ].join('\n');

  return { subject, html, text };
}
