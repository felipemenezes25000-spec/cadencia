'use client';

import { FinanceiroRepasse, type RepasseDados } from '../../../src/telas/FinanceiroRepasse';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface StatementDaApi {
  id: string;
  professionalId: string;
  professionalName: string;
  periodStart: string;
  periodEnd: string;
  totalEntries: number;
  totalProfessionalShare: number;
  totalClinicShare: number;
  status: string;
}

export default function PaginaRepasse() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();

  return (
    <FinanceiroRepasse
      // O profissional vê o próprio repasse; quem administra vê o da equipe.
      // Quem decide é o vínculo, não a tela — é o mesmo papel que a policy do
      // banco enxerga, então os dois não divergem.
      // O papel vai INTEIRO: a tela distingue admin de diretor técnico e de
      // financeiro, e achatar tudo em "gestor" apagaria essa distinção.
      // Recepção nem chega aqui — não tem finance.repasse.
      papelAtual={vinculoAtivo.role === 'recepcao' ? 'financeiro' : vinculoAtivo.role}
      carregarDados={async (f) => {
        const q = new URLSearchParams();
        if (f.profissionalId !== undefined && f.profissionalId !== '') {
          q.set('professionalId', f.profissionalId);
        }
        if (f.status !== undefined && f.status !== '' && f.status !== 'todos') {
          q.set('status', f.status);
        }
        const r = await apiFetch<{ statements: StatementDaApi[] }>(
          `/v1/repasse/statements${q.size === 0 ? '' : `?${q.toString()}`}`,
          { clinicId, csrfToken });

        const profissionais = r.statements.map((s) => {
          const bruto = s.totalProfessionalShare + s.totalClinicShare;
          return {
            id: s.professionalId,
            nome: s.professionalName,
            totalBruto: bruto,
            // O percentual é DERIVADO do que foi apurado, não da regra vigente:
            // a regra pode ter mudado depois do fechamento, e o extrato tem que
            // continuar explicando o número que ele mesmo mostra.
            percentual: bruto === 0 ? 0
              : Math.round((s.totalProfessionalShare / bruto) * 1000) / 10,
            totalRepasse: s.totalProfessionalShare,
            status: s.status === 'pago' ? 'pago' as const : 'pendente' as const,
            atendimentos: s.totalEntries,
          };
        });

        const dados: RepasseDados = {
          profissionais,
          totalRepasse: profissionais.reduce((a, p) => a + p.totalRepasse, 0),
          periodo: {
            inicio: r.statements[0]?.periodStart ?? '',
            fim: r.statements[0]?.periodEnd ?? '',
          },
        };
        return dados;
      }}
    />
  );
}
