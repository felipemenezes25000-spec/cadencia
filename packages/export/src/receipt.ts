export interface ReceiptInput {
  readonly exportId: string;
  readonly patientNome: string;
  readonly patientCpf: string | null;
  readonly tenantRazaoSocial: string;
  readonly tenantCnpj: string;
  readonly clinicaCnes: string;
  readonly requesterKind: string;
  readonly requestedByNome: string;
  readonly emitidoEm: string;
  readonly periodoDe: string | null;
  readonly periodoAte: string | null;
  readonly totalVersoes: number;
  readonly totalAnexos: number;
  readonly totalDocumentos: number;
  readonly pageCount: number;
  readonly pdfSha256Hex: string;
  readonly softwareNome: string;
  readonly softwareVersao: string;
}

export interface Receipt extends Record<string, string | number | null> {
  readonly exportId: string;
  readonly cnes: string;
}

export function buildReceipt(i: ReceiptInput): Receipt {
  return {
    exportId: i.exportId,
    paciente: i.patientNome,
    cpf: i.patientCpf,
    prestador: i.tenantRazaoSocial,
    cnpj: i.tenantCnpj,
    cnes: i.clinicaCnes,
    solicitanteQualidade: i.requesterKind,
    solicitanteNome: i.requestedByNome,
    emitidoEm: i.emitidoEm,
    periodoDe: i.periodoDe,
    periodoAte: i.periodoAte,
    totalVersoes: i.totalVersoes,
    totalAnexos: i.totalAnexos,
    totalDocumentos: i.totalDocumentos,
    totalPaginas: i.pageCount,
    pdfSha256Hex: i.pdfSha256Hex,
    algoritmoHash: 'SHA-256',
    software: i.softwareNome,
    softwareVersao: i.softwareVersao,
  } as Receipt;
}

function escapeHtml(v: string): string {
  return v
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function receiptHtml(r: Receipt): string {
  const linhas = Object.entries(r)
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td class="mono">${v === null ? '—' : escapeHtml(String(v))}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Recibo de exportação</title><style>
  @page { size: A4; margin: 22mm 18mm; }
  body { font: 400 10pt/1.5 "IBM Plex Serif", Georgia, serif; }
  h1 { font: 600 13pt "IBM Plex Sans", sans-serif; text-transform: uppercase; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; width: 45mm; font: 500 9pt "IBM Plex Sans", sans-serif;
       vertical-align: top; padding: 1.2mm 0; }
  td { padding: 1.2mm 0; }
  .mono { font-family: "IBM Plex Mono", monospace; word-break: break-all; }
</style></head><body>
<h1>Recibo de exportação de prontuário</h1>
<p>Este recibo é parte indissociável do documento exportado.</p>
<table>${linhas}</table>
</body></html>`;
}
