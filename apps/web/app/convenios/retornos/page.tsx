'use client';

import { useRouter } from 'next/navigation';
import { ConveniosRetornos, type RetornosDados } from '../../../src/telas/ConveniosRetornos';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface DemoDaApi {
  demonstrativoId: string;
  operadoraId: string;
  operadoraNome: string;
  protocolo: string;
  kind: 'analise' | 'pagamento';
  dataProcessamento: string;
  totalApresentadoCents: number;
  totalProcessadoCents: number;
  totalLiberadoCents: number;
  totalGlosaCents: number;
  itemCount: number;
  importedAt: string;
}

interface OperadoraDaApi { operadoraId: string; nome: string; registroAns: string }

export default function PaginaRetornos() {
  const { clinicId, csrfToken } = useSessao();
  const router = useRouter();

  return (
    <ConveniosRetornos
      carregarDados={async (f) => {
        const q = new URLSearchParams();
        if (f.operadoraId !== undefined && f.operadoraId !== '') {
          q.set('operadoraId', f.operadoraId);
        }

        const [demos, operadoras] = await Promise.all([
          apiFetch<{ itens: DemoDaApi[] }>(
            `/v1/tiss/demonstrativos${q.size === 0 ? '' : `?${q.toString()}`}`,
            { clinicId, csrfToken }),
          apiFetch<{ itens: OperadoraDaApi[] }>(
            '/v1/tiss/operadoras', { clinicId, csrfToken }),
        ]);

        const dados: RetornosDados = {
          demonstrativos: demos.itens.map((d) => ({
            id: d.demonstrativoId,
            operadoraNome: d.operadoraNome,
            operadoraId: d.operadoraId,
            registroAns: '',
            protocolo: d.protocolo,
            tipo: d.kind,
            // A "data do retorno" e a do PROCESSAMENTO pela operadora, nao a da
            // nossa importacao: importar tres dias depois nao muda quando a
            // operadora decidiu, e e a decisao dela que conta o prazo de recurso.
            dataImportacao: d.dataProcessamento,
            periodoInicio: d.dataProcessamento,
            periodoFim: d.dataProcessamento,
            totalApresentadoCentavos: d.totalApresentadoCents,
            totalProcessadoCentavos: d.totalProcessadoCents,
            totalLiberadoCentavos: d.totalLiberadoCents,
            totalGlosadoCentavos: d.totalGlosaCents,
            totalItens: d.itemCount,
            itensGlosados: d.totalGlosaCents > 0 ? 1 : 0,
          })),
          operadoras: operadoras.itens.map((o) => ({
            id: o.operadoraId, nome: o.nome, registroAns: o.registroAns })),
          // Os totais somam o que a OPERADORA disse, nao o que a clinica
          // esperava: e a diferenca entre apresentado e liberado que vira a
          // fila de glosa, e ela precisa vir do documento dela.
          totais: demos.itens.reduce((a, d) => ({
            apresentadoCentavos: a.apresentadoCentavos + d.totalApresentadoCents,
            processadoCentavos: a.processadoCentavos + d.totalProcessadoCents,
            liberadoCentavos: a.liberadoCentavos + d.totalLiberadoCents,
            glosadoCentavos: a.glosadoCentavos + d.totalGlosaCents,
          }), { apresentadoCentavos: 0, processadoCentavos: 0,
                liberadoCentavos: 0, glosadoCentavos: 0 }),
        };
        return dados;
      }}
      aoImportarXml={async (arquivo) => {
        const texto = await arquivo.text();
        await apiFetch('/v1/tiss/demonstrativos/importar', {
          method: 'POST', body: { xml: texto }, clinicId, csrfToken });
      }}
      aoAbrirDemonstrativo={(id) => { router.push(`/convenios/retornos/${id}`); }}
    />
  );
}
