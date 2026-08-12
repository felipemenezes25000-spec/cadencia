'use client';

import { useRouter } from 'next/navigation';
import { ConveniosAFaturar, type AFaturarDados } from '../../src/telas/ConveniosAFaturar';
import { PageHeader } from '../../src/ui/PageHeader';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

interface GuiaDaApi {
  guiaId: string;
  numeroGuiaPrestador: string;
  pacienteNome: string;
  operadoraId: string;
  operadoraNome: string;
  registroAns: string;
  codigoProcedimento: string;
  nomeProcedimento: string;
  valorProcedimento: number;
  dataAtendimento: string;
  loteId: string | null;
}

interface OperadoraDaApi {
  operadoraId: string;
  nome: string;
  registroAns: string;
}

export default function PaginaAFaturar() {
  const { clinicId, csrfToken } = useSessao();
  const router = useRouter();

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="Convênios"
        eyebrow="Ciclo de receita"
        subtitulo="Transforme atendimentos em lotes faturáveis e resolva inconsistências antes do envio."
        semBreadcrumb
      />
      <ConveniosAFaturar
        carregarDados={async (f) => {
          const q = new URLSearchParams();
          if (f.operadoraId !== undefined && f.operadoraId !== '') q.set('operadoraId', f.operadoraId);
          if (f.dataInicio !== undefined && f.dataInicio !== '') q.set('from', f.dataInicio);
          if (f.dataFim !== undefined && f.dataFim !== '') q.set('to', f.dataFim);
          q.set('status', 'pendente');

          const [guias, operadoras] = await Promise.all([
            apiFetch<{ itens: GuiaDaApi[] }>(`/v1/tiss/guias?${q.toString()}`, { clinicId, csrfToken }),
            apiFetch<{ itens: OperadoraDaApi[] }>('/v1/tiss/operadoras', { clinicId, csrfToken }),
          ]);

          const dados: AFaturarDados = {
            guias: guias.itens.map((g) => ({
              id: g.guiaId,
              numeroGuia: g.numeroGuiaPrestador,
              pacienteNome: g.pacienteNome,
              operadoraId: g.operadoraId,
              operadoraNome: g.operadoraNome,
              registroAns: g.registroAns,
              codigoProcedimento: g.codigoProcedimento,
              nomeProcedimento: g.nomeProcedimento,
              valorCentavos: Math.round(g.valorProcedimento * 100),
              dataAtendimento: g.dataAtendimento,
              status: g.nomeProcedimento === g.codigoProcedimento ? 'incompleta' : 'completa',
            })),
            operadoras: operadoras.itens.map((o) => ({
              id: o.operadoraId, nome: o.nome, registroAns: o.registroAns,
            })),
          };
          return dados;
        }}
        aoCriarLote={async (guiaIds, operadoraId) => {
          const { loteId } = await apiFetch<{ loteId: string }>('/v1/tiss/lotes', {
            method: 'POST', body: { operadoraId }, clinicId, csrfToken,
          });
          await apiFetch(`/v1/tiss/lotes/${loteId}/guias`, {
            method: 'POST', body: { guiaIds }, clinicId, csrfToken,
          });
          router.push('/convenios/lotes');
        }}
        aoAbrirGuia={(guiaId) => { router.push(`/convenios/guias/${guiaId}`); }}
      />
    </div>
  );
}
