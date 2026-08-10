'use client';

import { FinanceiroVisao, type VisaoDados } from '../../src/telas/FinanceiroVisao';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

export default function PaginaFinanceiroVisao() {
  const { clinicId, csrfToken } = useSessao();

  return (
    <FinanceiroVisao
      carregarDados={() => apiFetch<VisaoDados>(
        '/v1/financeiro/visao', { clinicId, csrfToken })}
    />
  );
}
