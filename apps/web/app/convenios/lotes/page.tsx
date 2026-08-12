'use client';

import { ConveniosLotes, type LotesDados, type StatusLote } from '../../../src/telas/ConveniosLotes';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface LoteDaApi {
  loteId: string;
  operadoraId: string;
  operadoraNome: string;
  numeroLote: string;
  status: string;
  totalGuias: number;
  valorTotalCentavos: number;
  createdAt: string;
  sentAt: string | null;
}

const STATUS: Record<string, StatusLote> = {
  rascunho: 'rascunho', enviado: 'enviado',
  processado: 'processado', glosado: 'glosado', cancelado: 'rascunho',
};

export default function PaginaLotes() {
  const { clinicId, csrfToken } = useSessao();

  return (
    <ConveniosLotes
      carregarDados={async () => {
        const r = await apiFetch<{ itens: LoteDaApi[] }>(
          '/v1/tiss/lotes', { clinicId, csrfToken });
        const dados: LotesDados = {
          lotes: r.itens.map((l) => ({
            id: l.loteId,
            numero: l.numeroLote,
            operadoraNome: l.operadoraNome,
            registroAns: '',
            status: STATUS[l.status] ?? 'rascunho',
            totalGuias: l.totalGuias,
            totalCentavos: l.valorTotalCentavos,
            // A tela formata data pura; mandar ISO completo produzia
            // "09T04:49:13Z/08/2026" na listagem.
            criadoEm: l.createdAt.slice(0, 10),
            enviadoEm: l.sentAt === null ? null : l.sentAt.slice(0, 10),
            // As guias do lote são carregadas ao expandir a linha, não aqui: uma
            // clínica com 40 lotes abertos traria milhares de guias só para
            // desenhar a listagem.
            guias: [],
          })),
        };
        return dados;
      }}
      aoEnviar={async (loteId) => {
        await apiFetch(`/v1/tiss/lotes/${loteId}/enviar`, {
          method: 'POST', clinicId, csrfToken });
      }}
      aoCancelar={async (loteId) => {
        await apiFetch(`/v1/tiss/lotes/${loteId}/cancelar`, {
          method: 'POST', clinicId, csrfToken });
      }}
      aoBaixarXml={async (loteId) => {
        // O XML sai em ISO-8859-1 com hash proprietário (§3.9): baixar pelo
        // navegador preserva os bytes exatos que a operadora vai validar.
        window.open(`/v1/tiss/lotes/${loteId}/xml`, '_blank', 'noopener');
      }}
    />
  );
}
