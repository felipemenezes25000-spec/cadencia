export interface DocumentTemplateInput {
  readonly titulo: string;
  readonly clinica: {
    readonly nome: string; readonly cnpj: string;
    readonly cnes: string; readonly endereco: string };
  readonly profissional: {
    readonly nome: string; readonly conselho: string;
    readonly numero: string; readonly uf: string };
  readonly paciente: {
    readonly nome: string; readonly nascimento: string | null; readonly cpf: string | null };
  readonly emitidoEm: string;
  /**
   * HTML JÁ CONFIÁVEL. Diferente de todo outro campo deste input, `corpo` NÃO
   * passa por `escapeHtml` — é o único ponto de extensão do template, e o
   * exportador de prontuário depende disso para montar `<ol>`/`<li>`.
   *
   * Quem entrega texto digitado por pessoa (atestado, relatório) escapa ANTES
   * de chamar, como faz `export-record.ts`. Passar texto cru aqui não é só
   * risco de injeção: `saturacao <95%` perde tudo a partir do `<` porque o
   * parser trata como tag aberta, e o médico só descobre no papel impresso.
   */
  readonly corpo: string;
}

export function escapeHtml(v: string): string {
  return v
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function documentHtml(i: DocumentTemplateInput): string {
  const carimbo = `${escapeHtml(i.clinica.nome)} · CNPJ ${escapeHtml(i.clinica.cnpj)} · CNES ${escapeHtml(i.clinica.cnes)}`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>${escapeHtml(i.titulo)}</title>
<style>
  @page {
    size: A4; margin: 22mm 18mm 20mm 18mm;
    @top-center { content: "${carimbo}"; font: 400 8pt "IBM Plex Sans", sans-serif;
                  color: #555; }
    @bottom-right { content: "Página " counter(page) " de " counter(pages);
                    font: 400 8pt "IBM Plex Mono", monospace; color: #555; }
  }
  body { font: 400 11pt/1.6 "IBM Plex Serif", Georgia, serif; color: #111; margin: 0; }
  h1 { font: 600 14pt/1.3 "IBM Plex Sans", sans-serif; letter-spacing: .02em;
       text-transform: uppercase; margin: 0 0 6mm; }
  .meta { font: 400 9pt/1.5 "IBM Plex Sans", sans-serif; color: #444;
          border-bottom: .4pt solid #999; padding-bottom: 3mm; margin-bottom: 6mm; }
  .meta dt { font-weight: 500; display: inline; }
  .meta dd { display: inline; margin: 0 6mm 0 1mm; }
  .corpo { orphans: 3; widows: 3; }
  .assinatura { margin-top: 18mm; font: 400 9pt/1.5 "IBM Plex Sans", sans-serif; }
  .assinatura .linha { border-top: .4pt solid #111; width: 70mm; padding-top: 2mm; }
  .mono { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
</style></head>
<body>
  <h1>${escapeHtml(i.titulo)}</h1>
  <dl class="meta">
    <dt>Paciente:</dt><dd>${escapeHtml(i.paciente.nome)}</dd>
    ${i.paciente.nascimento === null ? '' :
      `<dt>Nascimento:</dt><dd class="mono">${escapeHtml(i.paciente.nascimento)}</dd>`}
    ${i.paciente.cpf === null ? '' :
      `<dt>CPF:</dt><dd class="mono">${escapeHtml(i.paciente.cpf)}</dd>`}
    <dt>Emitido em:</dt><dd class="mono">${escapeHtml(i.emitidoEm)}</dd>
  </dl>
  <div class="corpo">${i.corpo}</div>
  <div class="assinatura">
    <div class="linha">${escapeHtml(i.profissional.nome)}</div>
    <div>${escapeHtml(i.profissional.conselho)} ${escapeHtml(i.profissional.numero)}/${escapeHtml(i.profissional.uf)}</div>
    <div>${escapeHtml(i.clinica.endereco)}</div>
  </div>
</body></html>`;
}
