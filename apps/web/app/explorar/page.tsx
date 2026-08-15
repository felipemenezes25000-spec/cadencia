'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SavedView } from '@cadencia/reports';
import { Explorar, type ResultadoConsulta } from '../../src/telas/Explorar';
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
      .catch(() => { if (vivo) setErro('Não foi possível carregar as visões.'); });
    return () => { vivo = false; };
  }, [clinicId, csrfToken]);

  const consultar = useCallback(async (q: Parameters<
    React.ComponentProps<typeof Explorar>['aoConsultar']>[0]): Promise<ResultadoConsulta> => {
    return apiFetch<ResultadoConsulta>('/v1/reports/query', {
      method: 'POST', body: q, clinicId, csrfToken,
    });
  }, [clinicId, csrfToken]);

  /* A tela ja renderiza o proprio `PageHeader` e o container `.cadencia-page`,
     como as outras 12 telas do produto. Esta rota tambem renderizava os dois:
     saiam DOIS <h1> "Explorar" na pagina e o gutter era aplicado em dobro. */
  return (
    <Explorar
      erro={erro}
      visoesSalvas={visoes}
      aoConsultar={consultar}
      aoExportar={async (p) => {
        // Exportação passa pelo POST e volta como arquivo. `apiFetchBlobUrl`
        // porque navegação direta não carrega `x-clinic-id` e a rota recusaria
        // — o mesmo motivo do PDF de documento.
        const url = await apiFetchBlobUrl(
          `/v1/reports/export?formato=${p.format}`, { clinicId, csrfToken })
          .catch(() => null);
        if (url === null) {
          setErro('Exportação indisponível para esta consulta.');
          return;
        }
        window.open(url, '_blank', 'noopener');
      }}
      aoSalvarVisao={async (p) => apiFetch<{ viewId: string }>(
        '/v1/reports/views/custom',
        { method: 'POST', body: p, clinicId, csrfToken })}
    />
  );
}
