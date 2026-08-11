'use client';

import { useSessao, lerCsrf } from '../../../src/sessao';
import {
  ExportarDados,
  type ExportarDadosRequest,
} from '../../../src/telas/ExportarDados';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function PaginaExportar() {
  const { clinicId } = useSessao();

  async function exportar(req: ExportarDadosRequest) {
    const resposta = await fetch(`${BASE}/v1/configuracoes/exportar`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-clinic-id': clinicId,
        'x-csrf-token': lerCsrf(),
      },
      credentials: 'include',
      body: JSON.stringify(req),
    });

    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(typeof corpo.erro === 'string' ? corpo.erro : 'erro_exportacao');
    }

    const blob = await resposta.blob();
    const disposition = resposta.headers.get('content-disposition') ?? '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match?.[1] ?? `export.${req.format}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return <ExportarDados aoExportar={exportar} />;
}
