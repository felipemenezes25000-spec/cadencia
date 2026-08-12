'use client';

import { Suspense } from 'react';
import { useQueryState } from 'nuqs';
import { Desempenho } from '../../src/telas/desempenho/Desempenho';
import type {
  DataFreshness, DrillDownResult, Period, SuggestedAction,
  VariationIndicator, WaterfallFactor,
} from '../../src/telas/desempenho/types';
import { apiFetch, ApiError } from '../../src/api';
import { useSessao } from '../../src/sessao';

interface FatorDaApi {
  factor: string;
  label?: string;
  delta_cents?: number;
  deltaCents?: number;
}

function mesAtual(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 'AAAA-MM' do mês imediatamente anterior, virando o ano quando preciso. */
function mesAnterior(mes: string): string {
  const [ano, m] = mes.split('-').map(Number) as [number, number];
  return m === 1
    ? `${ano - 1}-12`
    : `${ano}-${String(m - 1).padStart(2, '0')}`;
}

/** Primeiro e último dia do mês, no formato que /v1/reports/variation espera. */
function limites(mes: string): { inicio: string; fim: string } {
  const [ano, m] = mes.split('-').map(Number) as [number, number];
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimoDia).padStart(2, '0')}` };
}

const ROTULO_FATOR: Record<string, string> = {
  volume: 'Volume de atendimentos',
  mix_procedimento: 'Mix de procedimentos',
  mix_convenio: 'Mix de convênios',
  ticket: 'Ticket médio',
  faltas: 'Faltas',
  glosas: 'Glosas',
};

function DesempenhoInner() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [mes, setMes] = useQueryState('mes', { defaultValue: mesAtual() });

  const periodo: Period = { current: mes, previous: mesAnterior(mes) };

  // A recepção não tem `report.variation.read`, e isso é correto — variação de
  // receita é informação de gestão. O que não pode é a tela ficar em branco:
  // 403 sem explicação parece defeito, e quem vê chama o suporte.
  const podeVer = vinculoAtivo.role === 'admin_clinico'
    || vinculoAtivo.role === 'diretor_tecnico'
    || vinculoAtivo.role === 'financeiro';

  if (!podeVer) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">Desempenho é da gestão</h1>
          <p className="mt-2 text-sm text-text-muted">
            Seu perfil ({vinculoAtivo.role.replace('_', ' ')}) não tem acesso aos
            indicadores de receita. Peça a quem administra a clínica se precisar.
          </p>
        </div>
      </div>
    );
  }

  const fatoresDoPeriodo = async (): Promise<FatorDaApi[]> => {
    const a = limites(periodo.previous);
    const b = limites(periodo.current);
    const q = new URLSearchParams({
      clinic_id: clinicId,
      period_a_start: a.inicio, period_a_end: a.fim,
      period_b_start: b.inicio, period_b_end: b.fim,
    });
    const r = await apiFetch<{ factors: FatorDaApi[] }>(
      `/v1/reports/variation/factors?${q.toString()}`, { clinicId, csrfToken });
    return r.factors;
  };

  return (
    <Desempenho
      period={periodo}
      aoMudarPeriodo={(p) => { void setMes(p.current); }}
      carregarIndicadores={() => apiFetch<{
        indicators: VariationIndicator[]; freshness: DataFreshness }>(
        `/v1/desempenho/indicadores?mes=${periodo.current}`, { clinicId, csrfToken })}
      carregarWaterfall={async () => {
        const fatores = await fatoresDoPeriodo();
        const w: WaterfallFactor[] = fatores.map((f) => ({
          factorId: f.factor,
          label: f.label ?? ROTULO_FATOR[f.factor] ?? f.factor,
          valueCents: f.delta_cents ?? f.deltaCents ?? 0,
        }));
        return w;
      }}
      carregarDrillDown={async (_metric, factorId) => {
        const a = limites(periodo.previous);
        const b = limites(periodo.current);
        const q = new URLSearchParams({
          clinic_id: clinicId, factor: factorId,
          period_a_start: a.inicio, period_a_end: a.fim,
          period_b_start: b.inicio, period_b_end: b.fim,
        });
        const result = await apiFetch<DrillDownResult>(
          `/v1/reports/variation/drill-down?${q.toString()}`, { clinicId, csrfToken })
          .catch((e: unknown) => {
            if (e instanceof ApiError && e.status === 422) {
              return { dimension: 'profissional' as const, groups: [], totalCount: 0 };
            }
            throw e;
          });

        // A ação sugerida aponta para a tela que RESOLVE o fator: falta leva à
        // automação de confirmação, glosa leva ao recurso. Sugestão sem link é
        // conselho, e conselho não muda número.
        const actions: SuggestedAction[] = factorId === 'faltas'
          ? [{ actionId: 'confirmacao', label: 'Rever automação de confirmação',
               href: '/conversas' }]
          : factorId === 'glosas'
            ? [{ actionId: 'recurso', label: 'Abrir glosas pendentes',
                 href: '/convenios/glosas' }]
            : [];

        return { result, actions };
      }}
    />
  );
}

export default function PaginaDesempenho() {
  return <Suspense><DesempenhoInner /></Suspense>;
}
