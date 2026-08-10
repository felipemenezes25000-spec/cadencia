'use client';

import { useRouter } from 'next/navigation';
import { ConveniosAFaturar, type AFaturarDados } from '../../src/telas/ConveniosAFaturar';
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
    <ConveniosAFaturar
      carregarDados={async (f) => {
        const q = new URLSearchParams();
        if (f.operadoraId !== undefined && f.operadoraId !== '') {
          q.set('operadoraId', f.operadoraId);
        }
        if (f.dataInicio !== undefined && f.dataInicio !== '') q.set('from', f.dataInicio);
        if (f.dataFim !== undefined && f.dataFim !== '') q.set('to', f.dataFim);
        // Sem lote: e essa a definicao de "a faturar". Guia ja loteada saiu da
        // fila de trabalho e aparece em Lotes.
        //
        // O parametro e `status=pendente`, que a rota traduz para
        // `lg.lote_id IS NULL`. Antes ia `semLote=true`, que a rota NAO conhece
        // — e o Zod descarta chave desconhecida em silencio, entao a requisicao
        // voltava 200 com a lista INTEIRA. A tela "A faturar" mostrava guias ja
        // faturadas e convidava a lotea-las de novo.
        q.set('status', 'pendente');

        const [guias, operadoras] = await Promise.all([
          apiFetch<{ itens: GuiaDaApi[] }>(
            `/v1/tiss/guias?${q.toString()}`, { clinicId, csrfToken }),
          apiFetch<{ itens: OperadoraDaApi[] }>(
            '/v1/tiss/operadoras', { clinicId, csrfToken }),
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
            // `tiss.encounter_guia_consulta.valor_procedimento` e numeric em
            // REAIS; a tela formata centavos. Passar o numero direto exibia
            // R$ 150,00 como R$ 1,50 — e o operador conferia o lote inteiro
            // contra valores cem vezes menores do que os reais.
            valorCentavos: Math.round(g.valorProcedimento * 100),
            dataAtendimento: g.dataAtendimento,
            // "incompleta" e a guia cujo procedimento nao casou com nenhum termo
            // TUSS vigente na data — ela seria rejeitada no lote.
            status: g.nomeProcedimento === g.codigoProcedimento ? 'incompleta' : 'completa',
          })),
          operadoras: operadoras.itens.map((o) => ({
            id: o.operadoraId, nome: o.nome, registroAns: o.registroAns })),
        };
        return dados;
      }}
      aoCriarLote={async (guiaIds, operadoraId) => {
        // `POST /v1/tiss/lotes` exige `operadoraId: uuid`. O `null` que ia aqui
        // era recusado na validacao, antes do handler — e como a tela nao
        // tratava a rejeicao, o clique nao produzia lote nem mensagem nenhuma.
        const { loteId } = await apiFetch<{ loteId: string }>('/v1/tiss/lotes', {
          method: 'POST', body: { operadoraId }, clinicId, csrfToken });
        await apiFetch(`/v1/tiss/lotes/${loteId}/guias`, {
          method: 'POST', body: { guiaIds }, clinicId, csrfToken });
        router.push('/convenios/lotes');
      }}
      aoAbrirGuia={(guiaId) => { router.push(`/convenios/guias/${guiaId}`); }}
    />
  );
}
