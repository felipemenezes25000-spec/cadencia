'use client';

import { FinanceiroAReceber, type AReceberDados } from '../../../src/telas/FinanceiroAReceber';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

export default function PaginaAReceber() {
  const { clinicId, csrfToken } = useSessao();
  // A data de "hoje" vem do fuso do navegador só para DESTACAR linhas na tela.
  // O atraso em si é calculado no banco, contra o fuso da clínica: os dois
  // números não podem divergir, e quem manda é o servidor.
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <FinanceiroAReceber
      hoje={hoje}
      carregarDados={() => apiFetch<AReceberDados>(
        '/v1/financeiro/a-receber', { clinicId, csrfToken })}
      aoMarcarPago={async (entryId) => {
        await apiFetch(`/v1/payments/${entryId}/confirmar`, {
          method: 'POST', clinicId, csrfToken });
      }}
      aoCobrar={async (entryId) => {
        await apiFetch('/v1/payment-links', {
          method: 'POST', body: { entryId }, clinicId, csrfToken });
      }}
      aoEnviarLink={async (entryId) => {
        await apiFetch('/v1/payment-links', {
          method: 'POST', body: { entryId }, clinicId, csrfToken });
      }}
    />
  );
}
