'use client';

import { FinanceiroCaixa, type CaixaDados } from '../../../src/telas/FinanceiroCaixa';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

export default function PaginaCaixa() {
  const { clinicId, csrfToken } = useSessao();

  return (
    <FinanceiroCaixa
      carregarDados={(f) => {
        const q = new URLSearchParams();
        if (f.dataInicio !== undefined && f.dataInicio !== '') q.set('de', f.dataInicio);
        if (f.dataFim !== undefined && f.dataFim !== '') q.set('ate', f.dataFim);
        if (f.contaId !== undefined && f.contaId !== '') q.set('contaId', f.contaId);
        return apiFetch<CaixaDados>(
          `/v1/financeiro/caixa${q.size === 0 ? '' : `?${q.toString()}`}`,
          { clinicId, csrfToken });
      }}
    />
  );
}
