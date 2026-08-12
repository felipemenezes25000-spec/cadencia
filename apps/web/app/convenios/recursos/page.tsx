'use client';

import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { ConveniosRecursos, type RecursosDados } from '../../../src/telas/ConveniosRecursos';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface RecursoDaApi {
  recursoId: string;
  operadoraId: string;
  operadoraNome: string;
  numeroRecurso: string;
  status: string;
  justificativaGeral: string | null;
  itemCount: number;
  totalRecursadoCents: number;
  createdAt: string;
  sentAt: string | null;
}

function RecursosInner() {
  const { clinicId, csrfToken } = useSessao();
  const router = useRouter();

  return (
    <ConveniosRecursos
      carregarDados={async () => {
        const r = await apiFetch<{ itens: RecursoDaApi[] }>(
          '/v1/tiss/recursos', { clinicId, csrfToken });
        const dados: RecursosDados = {
          recursos: r.itens.map((x) => ({
            id: x.recursoId,
            operadoraNome: x.operadoraNome,
            operadoraId: x.operadoraId,
            // 'pronto' e 'resolvido' são estados do BANCO; a tela só conhece o
            // ciclo do recurso perante a operadora. Pronto ainda não saiu daqui,
            // então continua rascunho para quem olha.
            status: x.status === 'enviado' ? 'enviado' as const
              : x.status === 'resolvido' ? 'aceito' as const
              : 'rascunho' as const,
            justificativaGeral: x.justificativaGeral ?? '',
            criadoEm: x.createdAt,
            enviadoEm: x.sentAt,
            totalGlosasCentavos: x.totalRecursadoCents,
            // Os itens do recurso saem no detalhe. A listagem só precisa do
            // contador para dizer "3 glosas neste recurso".
            itens: [],
          })),
        };
        return dados;
      }}
      aoEditar={(recursoId) => { router.push(`/convenios/recursos/${recursoId}`); }}
      aoEnviar={async (recursoId) => {
        await apiFetch(`/v1/tiss/recursos/${recursoId}/enviar`, {
          method: 'POST', clinicId, csrfToken });
      }}
      aoVerResultado={(recursoId) => { router.push(`/convenios/recursos/${recursoId}`); }}
    />
  );
}

export default function PaginaRecursos() {
  return <Suspense><RecursosInner /></Suspense>;
}
