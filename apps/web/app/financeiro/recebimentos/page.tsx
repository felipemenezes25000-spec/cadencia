'use client';

import { Recibos, type LinhaDeRecibo, type MetodoRecibo } from '../../../src/telas/Recibos';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface ReciboDaApi {
  receiptId: string;
  receiptNumber: number;
  emitidoEm: string;
  valorCents: number;
  descricao: string;
  patientNome: string | null;
  metodo: string;
  metodoKind: 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix' | 'link' | 'convenio';
}

/**
 * O banco distingue credito de debito; a tela de recibos nao — para quem confere
 * o caixa, os dois sao "cartao". A traducao mora aqui, na borda, e nao no
 * endpoint: outra tela (repasse, taxas) precisa da distincao e a perderia se a
 * API ja entregasse achatado.
 */
const METODO: Record<ReciboDaApi['metodoKind'], MetodoRecibo> = {
  dinheiro: 'dinheiro',
  cartao_credito: 'cartao',
  cartao_debito: 'cartao',
  pix: 'pix',
  link: 'link',
  convenio: 'link',
};

export default function PaginaRecebimentos() {
  const { clinicId, csrfToken } = useSessao();

  return (
    <Recibos
      carregarRecibos={async (f) => {
        const busca = new URLSearchParams();
        if (f.dataInicio !== undefined && f.dataInicio !== '') busca.set('de', f.dataInicio);
        if (f.dataFim !== undefined && f.dataFim !== '') busca.set('ate', f.dataFim);
        const r = await apiFetch<{ itens: ReciboDaApi[] }>(
          `/v1/receipts${busca.size === 0 ? '' : `?${busca.toString()}`}`,
          { clinicId, csrfToken });

        const linhas: LinhaDeRecibo[] = r.itens.map((x) => ({
          receiptId: x.receiptId,
          receiptNumber: x.receiptNumber,
          patientName: x.patientNome ?? 'Sem paciente vinculado',
          description: x.descricao,
          amountCents: x.valorCents,
          method: METODO[x.metodoKind],
          paidAt: x.emitidoEm,
        }));

        // O filtro por paciente e do cliente porque a lista ja vem inteira e
        // curta (um dia de caixa). Virar parametro de rota quando a clinica
        // tiver volume que justifique paginar.
        const p = f.paciente?.trim().toLowerCase() ?? '';
        return p === '' ? linhas
          : linhas.filter((l) => l.patientName.toLowerCase().includes(p));
      }}
      aoImprimirRecibo={async (receiptId) => {
        window.open(`/v1/receipts/${receiptId}/pdf`, '_blank', 'noopener');
      }}
    />
  );
}
