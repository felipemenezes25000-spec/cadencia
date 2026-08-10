'use client';

import {
  FinanceiroAPagar, type APagarDados, type DespesaPendente,
} from '../../../src/telas/FinanceiroAPagar';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface PayableDaApi {
  payableId: string;
  description: string;
  amountCents: number;
  status: string;
  dueDate: string | null;
  supplierName: string | null;
  categoryName: string | null;
}

/** A API fala 'pending'/'confirmed'; a tela fala em portugues e distingue vencido. */
function statusDaTela(p: PayableDaApi, hoje: string): DespesaPendente['status'] {
  if (p.status === 'confirmed') return 'pago';
  if (p.dueDate !== null && p.dueDate < hoje) return 'vencido';
  return 'pendente';
}

export default function PaginaAPagar() {
  const { clinicId, csrfToken } = useSessao();

  return (
    <FinanceiroAPagar
      carregarDados={async (f) => {
        const q = new URLSearchParams();
        if (f.dataInicio !== undefined && f.dataInicio !== '') q.set('from', f.dataInicio);
        if (f.dataFim !== undefined && f.dataFim !== '') q.set('to', f.dataFim);
        const r = await apiFetch<{ itens: PayableDaApi[] }>(
          `/v1/payables${q.size === 0 ? '' : `?${q.toString()}`}`,
          { clinicId, csrfToken });

        const hoje = new Date().toISOString().slice(0, 10);
        let despesas: DespesaPendente[] = r.itens.map((x) => ({
          id: x.payableId,
          descricao: x.description,
          fornecedor: x.supplierName ?? 'Sem fornecedor',
          amountCents: x.amountCents,
          dueDate: x.dueDate ?? hoje,
          categoryName: x.categoryName ?? 'Sem categoria',
          status: statusDaTela(x, hoje),
        }));

        if (f.fornecedor !== undefined && f.fornecedor !== '') {
          const alvo = f.fornecedor.toLowerCase();
          despesas = despesas.filter((d) => d.fornecedor.toLowerCase().includes(alvo));
        }
        if (f.categoria !== undefined && f.categoria !== '') {
          despesas = despesas.filter((d) => d.categoryName === f.categoria);
        }

        const dados: APagarDados = {
          total: despesas.filter((d) => d.status !== 'pago')
            .reduce((a, d) => a + d.amountCents, 0),
          despesas,
          categorias: [...new Set(despesas.map((d) => d.categoryName))].sort(),
        };
        return dados;
      }}
      aoMarcarPago={async (id) => {
        await apiFetch(`/v1/payables/${id}/pagar`, {
          method: 'POST', clinicId, csrfToken });
      }}
      aoEditar={() => { /* edicao de despesa entra com a tela de lancamento */ }}
      aoParcelar={async () => { /* parcelamento usa fin.installment_plan */ }}
    />
  );
}
