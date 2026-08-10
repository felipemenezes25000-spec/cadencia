'use client';

import { useRouter } from 'next/navigation';
import { ConveniosGlosas, type GlosasDados } from '../../../src/telas/ConveniosGlosas';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface GlosaDaApi {
  glosaId: string;
  demonstrativoItemId: string;
  operadoraId: string;
  operadoraNome: string;
  protocolo: string;
  numeroGuiaPrestador: string;
  codigoGlosa: string;
  valorGlosadoCents: number;
  status: string;
  createdAt: string;
}

interface OperadoraDaApi { operadoraId: string; nome: string; registroAns: string }

export default function PaginaGlosas() {
  const { clinicId, csrfToken } = useSessao();
  const router = useRouter();

  return (
    <ConveniosGlosas
      carregarDados={async (f) => {
        const q = new URLSearchParams();
        if (f.operadoraId !== undefined && f.operadoraId !== '') {
          q.set('operadoraId', f.operadoraId);
        }
        if (f.status !== undefined) q.set('status', f.status);

        const [glosas, operadoras] = await Promise.all([
          apiFetch<{ itens: GlosaDaApi[] }>(
            `/v1/tiss/glosas${q.size === 0 ? '' : `?${q.toString()}`}`,
            { clinicId, csrfToken }),
          apiFetch<{ itens: OperadoraDaApi[] }>(
            '/v1/tiss/operadoras', { clinicId, csrfToken }),
        ]);

        const dados: GlosasDados = {
          glosas: glosas.itens.map((g) => ({
            id: g.glosaId,
            demonstrativoId: g.demonstrativoItemId,
            guiaNumero: g.numeroGuiaPrestador,
            pacienteNome: '',
            operadoraNome: g.operadoraNome,
            operadoraId: g.operadoraId,
            codigoProcedimento: '',
            nomeProcedimento: '',
            codigoGlosa: g.codigoGlosa,
            // O motivo em texto vem da TUSS tabela 38, decodificado no detalhe
            // do demonstrativo. Aqui a tela mostra o codigo, que e o que a
            // operadora devolveu — traduzir errado seria pior que nao traduzir.
            descricaoGlosa: '',
            valorApresentadoCentavos: 0,
            valorGlosadoCentavos: g.valorGlosadoCents,
            dataAtendimento: g.createdAt.slice(0, 10),
            // O status da TELA descreve onde a glosa esta no ciclo do recurso,
            // e nao o enum cru do banco: 'aceita' no banco quer dizer que a
            // clinica aceitou a glosa (desistiu), o que na tela e o fim da
            // linha, nao um estado de recurso.
            status: g.status === 'recursada' ? 'recurso_enviado' as const
              : g.status === 'aceita' ? 'recurso_negado' as const
              : 'pendente' as const,
          })),
          operadoras: operadoras.itens.map((o) => ({
            id: o.operadoraId, nome: o.nome, registroAns: o.registroAns })),
          totalGlosadoPendenteCentavos: glosas.itens
            .filter((g) => g.status === 'pendente')
            .reduce((a, g) => a + g.valorGlosadoCents, 0),
        };
        return dados;
      }}
      aoCriarRecurso={(glosaIds) => {
        // `/novo`, e nao `/convenios/recursos?glosas=`: a lista de recursos ignora
        // o parametro e mostrava a lista de sempre, como se o clique nao tivesse
        // acontecido. Agora vai para o formulario que existe.
        router.push(`/convenios/recursos/novo?glosas=${glosaIds.join(',')}`);
      }}
    />
  );
}
