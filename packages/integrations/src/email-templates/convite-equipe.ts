export interface ConviteEquipeVars {
  readonly nomeConvidado: string;
  readonly nomeClinica: string;
  readonly urlConvite: string;
}

export function conviteEquipeEmail(vars: ConviteEquipeVars): {
  subject: string; html: string; text: string;
} {
  const { nomeConvidado, nomeClinica, urlConvite } = vars;

  const subject = `Convite para a equipe da ${nomeClinica}`;

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
      Ola, ${nomeConvidado}!
    </p>
    <p style="margin:0 0 24px;font-size:16px;color:#333333">
      Voce foi convidado(a) para fazer parte da equipe da
      <strong>${nomeClinica}</strong> no Cadencia.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
      <tr><td align="center" style="background:#087783;border-radius:6px">
        <a href="${urlConvite}"
           style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none">
          Aceitar convite
        </a>
      </td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:14px;color:#666666">
      Se o botao nao funcionar, copie e cole o link abaixo no seu navegador:
    </p>
    <p style="margin:0;font-size:14px;color:#087783;word-break:break-all">
      ${urlConvite}
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
    `Ola, ${nomeConvidado}!`,
    '',
    `Voce foi convidado(a) para fazer parte da equipe da ${nomeClinica} no Cadencia.`,
    '',
    `Aceite o convite acessando o link: ${urlConvite}`,
    '',
    '-- Cadencia',
  ].join('\n');

  return { subject, html, text };
}
