'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SavedView } from '@cadencia/reports';
import { Explorar, type ResultadoConsulta } from '../../src/telas/Explorar';
import { PageHeader } from '../../src/ui/PageHeader';
import { apiFetch, apiFetchBlobUrl } from '../../src/api';
import { useSessao } from '../../src/sessao';

interface VisaoDaApi {
  id: string; name: string; builtIn: boolean; view: string; chartKind: string;
}

export default function PaginaExplorar() {
  const { clinicId, csrfToken } = useSessao();
  const [visoes, setVisoes] = useState<readonly SavedView[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void apiFetch<{ views: VisaoDaApi[] }>('/v1/reports/views', { clinicId, csrfToken })
      .then((r) => {
        if (!vivo) return;
        setVisoes(r.views as unknown as SavedView[]);
      })
      .catch(() => { if (vivo) setErro('Nao foi possivel carregar as visoes.'); });
    return () => { vivo = false; };
  }, [clinicId, csrfToken]);

  const consultar = useCallback(async (q: Parameters<
    React.ComponentProps<typeof Explorar>['aoConsultar']>[0]): Promise<ResultadoConsulta> => {
    return apiFetch<ResultadoConsulta>('/v1/reports/query', {
      method: 'POST', body: q, clinicId, csrfToken,
    });
  }, [clinicId, csrfToken]);

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="Explorar"
        subtitulo="Consulta livre sobre os dados da clinica, com filtros e exportacao."
      />

      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

      <Explorar
        visoesSalvas={visoes}
        aoConsultar={consultar}
        aoExportar={async (p) => {
          // Exportacao passa pelo POST e volta como arquivo. `apiFetchBlobUrl`
          // porque navegacao direta nao carrega `x-clinic-id` e a rota recusaria
          // — o mesmo motivo do PDF de documento.
          const url = await apiFetchBlobUrl(
            `/v1/reports/export?formato=${p.format}`, { clinicId, csrfToken })
            .catch(() => null);
          if (url === null) {
            setErro('Exportacao indisponivel para esta consulta.');
            return;
          }
          window.open(url, '_blank', 'noopener');
        }}
        aoSalvarVisao={async (p) => apiFetch<{ viewId: string }>(
          '/v1/reports/views/custom',
          { method: 'POST', body: p, clinicId, csrfToken })}
      />
    </div>
  );
}
