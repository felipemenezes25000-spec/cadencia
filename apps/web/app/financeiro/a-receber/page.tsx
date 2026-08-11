'use client';

import { FinanceiroAReceber, type AReceberDados } from '../../../src/telas/FinanceiroAReceber';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { useQueryState } from 'nuqs';

export default function PaginaAReceber() {
  const { clinicId, csrfToken } = useSessao();
  const [patientId] = useQueryState('patientId');
  // A data de "hoje" vem do fuso do navegador so para DESTACAR linhas na tela.
  // O atraso em si e calculado no banco, contra o fuso da clinica: os dois
  // numeros nao podem divergir, e quem manda e o servidor.
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <FinanceiroAReceber
      hoje={hoje}
      carregarDados={() => apiFetch<AReceberDados>(
        patientId
          ? `/v1/financeiro/a-receber?patientId=${encodeURIComponent(patientId)}`
          : '/v1/financeiro/a-receber',
        { clinicId, csrfToken })}
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
