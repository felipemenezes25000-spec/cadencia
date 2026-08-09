// apps/web/src/telas/FinanceiroVisao.tsx
'use client';

import { useEffect, useState } from 'react';
import { useQueryState } from 'nuqs';
import { Group } from '@visx/group';
import { Bar } from '@visx/shape';
import { scaleBand, scaleLinear } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { ParentSize } from '@visx/responsive';
import { TrendUp, TrendDown, Wallet, Clock } from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

// -- Tipos ------------------------------------------------------------------

export interface ReceitaVsDespesaItem {
  readonly mes: string;
  readonly receita: number;
  readonly despesa: number;
}

export interface SaldoProjetadoItem {
  readonly dia: string;
  readonly saldo: number;
}

export interface CategoriaItem {
  readonly nome: string;
  readonly total: number;
  readonly percentual: number;
}

export interface AlertaItem {
  readonly tipo: string;
  readonly mensagem: string;
  readonly severidade: 'danger' | 'warn' | 'ok';
}

export interface ResumoMes {
  readonly receitaTotal: number;
  readonly despesaTotal: number;
  readonly saldo: number;
  readonly pendente?: number;
  readonly variacaoReceita?: number;
  readonly variacaoDespesa?: number;
}

export interface DadosReceita {
  readonly label: string;
  readonly valor: number;
}

export interface VisaoDados {
  readonly receitaVsDespesa: readonly ReceitaVsDespesaItem[];
  readonly saldoProjetado: readonly SaldoProjetadoItem[];
  readonly topCategorias: readonly CategoriaItem[];
  readonly alertas: readonly AlertaItem[];
  readonly resumoMes: ResumoMes;
}

export interface FinanceiroVisaoProps {
  readonly dados?: never;
  readonly carregarDados: () => Promise<VisaoDados>;
}

// -- Helpers ----------------------------------------------------------------

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

type CorCard = 'sucesso' | 'erro' | 'aviso' | 'info';

const corBgClasses: Record<CorCard, string> = {
  sucesso: 'bg-ok-soft',
  erro: 'bg-danger-soft',
  aviso: 'bg-warn-soft',
  info: 'bg-accent-soft',
};

const corTextClasses: Record<CorCard, string> = {
  sucesso: 'text-ok',
  erro: 'text-danger',
  aviso: 'text-warn',
  info: 'text-accent',
};

const TOKEN_SEVERIDADE: Record<string, string> = {
  danger: 'text-danger',
  warn: 'text-warn',
  ok: 'text-ok',
};

const BG_SEVERIDADE: Record<string, string> = {
  danger: 'bg-danger-soft',
  warn: 'bg-warn-soft',
  ok: 'bg-ok-soft',
};

const GLIFO_SEVERIDADE: Record<string, string> = {
  danger: '!',
  warn: '!',
  ok: '✓',
};

// -- CardResumo -------------------------------------------------------------

function CardResumo({
  rotulo,
  valor,
  icone: Icon,
  cor,
  variacao,
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly icone: PhosphorIcon;
  readonly cor: CorCard;
  readonly variacao?: number;
}) {
  return (
    <div className="cadencia-metric group relative overflow-hidden p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[.09em] text-text-muted">{rotulo}</span>
        <div className={cn('rounded-md p-1.5', corBgClasses[cor])}>
          <Icone icon={Icon} size="sm" className={corTextClasses[cor]} />
        </div>
      </div>
      <p className="mt-2 text-[clamp(20px,2.4vw,28px)] font-semibold leading-none tracking-[-0.055em] text-text tabular-nums">{valor}</p>
      {variacao != null && (
        <p
          className={cn(
            'mt-1 flex items-center gap-1 text-xs',
            variacao >= 0 ? 'text-ok' : 'text-danger',
          )}
        >
          <Icone icon={variacao >= 0 ? TrendUp : TrendDown} size="sm" />
          {Math.abs(variacao).toFixed(1)}% vs. periodo anterior
        </p>
      )}
    </div>
  );
}

// -- SeletorPeriodo ---------------------------------------------------------

type Periodo = 'dia' | 'semana' | 'mes';

const ROTULOS_PERIODO: Record<Periodo, string> = {
  dia: 'Diario',
  semana: 'Semanal',
  mes: 'Mensal',
};

function SeletorPeriodo({
  periodo,
  onChange,
}: {
  readonly periodo: Periodo;
  readonly onChange: (p: Periodo) => void;
}) {
  return (
    <div className="cadencia-segmented" role="group" aria-label="Seletor de periodo">
      {(['dia', 'semana', 'mes'] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={periodo === p}
          className={cn(
            'rounded-[9px] px-3 py-1.5 text-xs font-semibold transition-all-fast',
            periodo === p
              ? 'bg-surface text-text shadow-elev-1 ring-1 ring-line/70'
              : 'text-text-muted hover:text-text',
          )}
        >
          {ROTULOS_PERIODO[p]}
        </button>
      ))}
    </div>
  );
}

// -- GraficoReceita (visx) --------------------------------------------------

function GraficoReceita({
  dados,
  periodo,
}: {
  readonly dados: readonly ReceitaVsDespesaItem[];
  readonly periodo: string;
}) {
  if (dados.length === 0) return null;

  return (
    <section className="cadencia-panel p-4 sm:p-5" aria-label="Fluxo financeiro">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="cadencia-eyebrow">Pulso financeiro</span>
          <h3 className="m-0 mt-1 text-base font-semibold tracking-[-.025em] text-text">Fluxo financeiro · {periodo}</h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-semibold text-text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" />Receita bruta</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-danger" />Despesa</span>
        </div>
      </div>
      <div className="h-72" data-testid="grafico-receita">
        <ParentSize>
          {({ width, height }) => {
            if (width <= 0 || height <= 0) return null;
            const margin = { top: 14, right: 14, bottom: 32, left: 62 };
            const innerWidth = width - margin.left - margin.right;
            const innerHeight = height - margin.top - margin.bottom;
            if (innerWidth <= 0 || innerHeight <= 0) return null;

            const xScale = scaleBand({ range: [0, innerWidth], domain: dados.map((d) => d.mes.slice(5)), padding: 0.42 });
            const maximo = Math.max(...dados.flatMap((d) => [d.receita, d.despesa]), 1);
            const yScale = scaleLinear({ range: [innerHeight, 0], domain: [0, maximo], nice: true });
            const points = dados.map((d) => {
              const label = d.mes.slice(5);
              const x = (xScale(label) ?? 0) + xScale.bandwidth() / 2;
              return `${x},${yScale(d.despesa)}`;
            }).join(' ');

            return (
              <svg width={width} height={height} role="img" aria-label="Grafico de receita e despesa">
                <defs>
                  <linearGradient id="cadenciaRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.36" />
                  </linearGradient>
                </defs>
                <Group left={margin.left} top={margin.top}>
                  {[0.25, 0.5, 0.75, 1].map((ratio) => (
                    <line key={ratio} x1={0} x2={innerWidth} y1={innerHeight * (1 - ratio)} y2={innerHeight * (1 - ratio)} stroke="var(--line)" strokeOpacity="0.72" strokeDasharray="3 5" />
                  ))}
                  {dados.map((d) => {
                    const label = d.mes.slice(5);
                    return (
                      <Bar key={d.mes} x={xScale(label) ?? 0} y={yScale(d.receita)} width={xScale.bandwidth()} height={innerHeight - yScale(d.receita)} fill="url(#cadenciaRevenueGradient)" rx={7} />
                    );
                  })}
                  <polyline points={points} fill="none" stroke="var(--danger)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
                  {dados.map((d) => {
                    const label = d.mes.slice(5);
                    const x = (xScale(label) ?? 0) + xScale.bandwidth() / 2;
                    return <circle key={`p-${d.mes}`} cx={x} cy={yScale(d.despesa)} r={3.5} fill="var(--surface)" stroke="var(--danger)" strokeWidth={2} />;
                  })}
                  <AxisBottom top={innerHeight} scale={xScale} tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }} stroke="var(--line)" tickStroke="transparent" />
                  <AxisLeft scale={yScale} tickFormat={(v) => `R$${((v as number) / 100).toFixed(0)}`} tickLabelProps={{ fill: 'var(--text-faint)', fontSize: 9 }} stroke="transparent" tickStroke="transparent" numTicks={5} />
                </Group>
              </svg>
            );
          }}
        </ParentSize>
      </div>
    </section>
  );
}

// -- Skeleton ---------------------------------------------------------------

function FinanceiroVisaoSkeleton() {
  return (
    <div className="space-y-6" data-testid="financeiro-visao-skeleton">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="card" height="100px" />
        ))}
      </div>
      <Skeleton variant="text" width="200px" height="36px" />
      <Skeleton variant="card" height="280px" />
    </div>
  );
}

// -- Alertas ----------------------------------------------------------------

function SecaoAlertas({ alertas }: { readonly alertas: readonly AlertaItem[] }) {
  if (alertas.length === 0) return null;

  return (
    <section aria-label="Alertas financeiros" className="grid gap-[var(--s-3)]">
      {alertas.map((a) => (
        <div
          key={a.tipo}
          role="alert"
          className={cn(
            'flex items-center gap-3 rounded-2xl border border-current/10 px-4 py-3 text-[length:var(--fs-13)] font-medium shadow-elev-1',
            BG_SEVERIDADE[a.severidade] ?? 'bg-warn-soft',
            TOKEN_SEVERIDADE[a.severidade] ?? 'text-warn',
          )}
        >
          <span aria-hidden="true" className="font-semibold">
            {GLIFO_SEVERIDADE[a.severidade] ?? '!'}
          </span>
          {a.mensagem}
        </div>
      ))}
    </section>
  );
}

// -- Top Categorias ---------------------------------------------------------

function SecaoCategorias({ categorias }: { readonly categorias: readonly CategoriaItem[] }) {
  return (
    <section
      aria-label="Top categorias"
      className="cadencia-panel p-5"
    >
      <div className="mb-4"><span className="cadencia-eyebrow">Composição</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em]">Top categorias</h2></div>
      <ul className="m-0 grid list-none gap-[var(--s-3)] p-0">
        {categorias.map((c) => (
          <li
            key={c.nome}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2 border-b border-line/65 py-3 text-[length:var(--fs-14)] last:border-b-0"
          >
            <span>{c.nome}</span>
            <span className="tabular-nums text-text-muted">
              {centavosParaReais(c.total)}
            </span>
            <span className="min-w-[3ch] text-right font-semibold tabular-nums">{c.percentual}%</span>
            <span className="col-span-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken"><span className="block h-full rounded-full bg-[var(--aurora)]" style={{ width: `${Math.min(100, Math.max(0, c.percentual))}%` }} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// -- Componente principal ---------------------------------------------------

export function FinanceiroVisao(p: FinanceiroVisaoProps) {
  const [dados, setDados] = useState<VisaoDados | null>(null);
  const [periodo, setPeriodo] = useQueryState('periodo', {
    defaultValue: 'mes',
    parse: (v) => v as Periodo,
  });

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p.carregarDados]);

  if (dados === null) return <FinanceiroVisaoSkeleton />;

  const resumo = dados.resumoMes;

  return (
    <div className="grid gap-6">
      {/* Cards de resumo */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CardResumo
          rotulo="Receita"
          valor={centavosParaReais(resumo.receitaTotal)}
          icone={TrendUp}
          cor="sucesso"
          {...(resumo.variacaoReceita != null ? { variacao: resumo.variacaoReceita } : {})}
        />
        <CardResumo
          rotulo="Despesa"
          valor={centavosParaReais(resumo.despesaTotal)}
          icone={TrendDown}
          cor="erro"
          {...(resumo.variacaoDespesa != null ? { variacao: resumo.variacaoDespesa } : {})}
        />
        <CardResumo
          rotulo="Saldo"
          valor={centavosParaReais(resumo.saldo)}
          icone={Wallet}
          cor={resumo.saldo >= 0 ? 'sucesso' : 'erro'}
        />
        <CardResumo
          rotulo="Pendente"
          valor={centavosParaReais(resumo.pendente ?? 0)}
          icone={Clock}
          cor="aviso"
        />
      </div>

      {/* Alertas */}
      <SecaoAlertas alertas={dados.alertas} />

      {/* Seletor de periodo */}
      <div className="flex items-center justify-between gap-3"><div><span className="cadencia-eyebrow">Janela de leitura</span><p className="m-0 mt-1 text-xs text-text-muted">Troque a granularidade sem perder o contexto.</p></div><SeletorPeriodo
        periodo={periodo as Periodo}
        onChange={(p) => void setPeriodo(p)}
      /></div>

      {/* Grafico de receita (visx) */}
      <GraficoReceita dados={dados.receitaVsDespesa} periodo={ROTULOS_PERIODO[periodo as Periodo] ?? periodo} />

      {/* Top categorias */}
      <SecaoCategorias categorias={dados.topCategorias} />
    </div>
  );
}
