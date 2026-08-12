'use client';

import { ConveniosOperadoras, type OperadorasDados } from '../../../src/telas/ConveniosOperadoras';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface OperadoraDaApi {
  operadoraId: string;
  nome: string;
  registroAns: string;
  cnpj: string;
  tissVersion: string;
  telefone: string | null;
  email: string | null;
  totalPacientes: number;
  active: boolean;
}

export default function PaginaOperadoras() {
  const { clinicId, csrfToken } = useSessao();

  return (
    <ConveniosOperadoras
      carregarDados={async () => {
        const r = await apiFetch<{ itens: OperadoraDaApi[] }>(
          '/v1/tiss/operadoras', { clinicId, csrfToken });
        const dados: OperadorasDados = {
          operadoras: r.itens.map((o) => ({
            id: o.operadoraId,
            nome: o.nome,
            registroAns: o.registroAns,
            versaoTiss: o.tissVersion,
            cnpj: o.cnpj,
            email: o.email,
            telefone: o.telefone,
            ativa: o.active,
            totalPacientes: o.totalPacientes,
          })),
        };
        return dados;
      }}
      aoSalvar={async (op) => {
        await apiFetch('/v1/tiss/operadoras', {
          method: 'POST',
          body: {
            nome: op.nome,
            registroAns: op.registroAns,
            cnpj: op.cnpj,
            // A versão TISS é por OPERADORA, não global: a ANS publica 4.03.00
            // mas cada operadora migra no seu tempo, e enviar lote na versão
            // errada é rejeição imediata.
            tissVersion: op.versaoTiss,
          },
          clinicId, csrfToken });
      }}
      aoDesativar={async (operadoraId) => {
        await apiFetch(`/v1/tiss/operadoras/${operadoraId}`, {
          method: 'DELETE', clinicId, csrfToken });
      }}
    />
  );
}
