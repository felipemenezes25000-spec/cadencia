'use client';

import { FinanceiroVisao, type VisaoDados } from '../../src/telas/FinanceiroVisao';
import type { AReceberDados } from '../../src/telas/FinanceiroAReceber';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';
import { diaNaClinica } from '../../src/lib/fuso';

export default function PaginaFinanceiroVisao() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();

  return (
      <FinanceiroVisao
        carregarDados={() => apiFetch<VisaoDados>(
          '/v1/financeiro/visao', { clinicId, csrfToken })}
        carregarAReceber={() => apiFetch<AReceberDados>(
          '/v1/financeiro/a-receber', { clinicId, csrfToken })}
        aoMarcarPago={(entryId) => apiFetch(`/v1/payments/${entryId}/confirmar`, {
          method: 'POST', clinicId, csrfToken,
        })}
        aoCobrar={(entryId) => apiFetch('/v1/payment-links', {
          method: 'POST', body: { entryId }, clinicId, csrfToken,
        })}
        aoEnviarLink={(entryId) => apiFetch('/v1/payment-links', {
          method: 'POST', body: { entryId }, clinicId, csrfToken,
        })}
        hoje={diaNaClinica(new Date().toISOString(), vinculoAtivo.timezone)}
      />
  );
}
