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
import { FinanceiroAReceber, type AReceberDados } from './FinanceiroAReceber';

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
  readonly carregarAReceber?: () => Promise<AReceberDados>;
  readonly aoCobrar?: (entryId: string) => Promise<void>;
  readonly aoMarcarPago?: (entryId: string) => Promise<void>;
  readonly aoEnviarLink?: (entryId: string) => Promise<void>;
  readonly hoje?: string;
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
    <div className="group relative overflow-hidden rounded-xl border border-line bg-surface p-4 transition-colors-fast hover:border-line-strong">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">{rotulo}</span>
        <div className={cn('rounded-md p-1.5', corBgClasses[cor])}>
          <Icone icon={Icon} size="sm" className={corTextClasses[cor]} />
        </div>
      </div>
      <p className="text-[22px] font-bold tracking-[-0.04em] text-text tabular-nums">{valor}</p>
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
    <div className="flex items-center gap-2" role="group" aria-label="Seletor de periodo">
      {(['dia', 'semana', 'mes'] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={periodo === p}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors-fast',
            periodo === p
              ? 'bg-accent text-accent-on'
              : 'text-text-muted hover:bg-surface-raised hover:text-text',
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
  readonly dados: readonly DadosReceita[];
  readonly periodo: string;
}) {
  if (dados.length === 0) return null;

  return (
    <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-4">
      <h3 className="mb-4 text-sm font-semibold text-text">Receita por {periodo}</h3>
      <div className="h-64" data-testid="grafico-receita">
        <ParentSize>
          {({ width, height }) => {
            if (width <= 0 || height <= 0) return null;

            const margin = { top: 10, right: 10, bottom: 30, left: 60 };
            const innerWidth = width - margin.left - margin.right;
            const innerHeight = height - margin.top - margin.bottom;

            if (innerWidth <= 0 || innerHeight <= 0) return null;

            const xScale = scaleBand({
              range: [0, innerWidth],
              domain: dados.map((d) => d.label),
              padding: 0.3,
            });

            const yScale = scaleLinear({
              range: [innerHeight, 0],
              domain: [0, Math.max(...dados.map((d) => d.valor))],
              nice: true,
            });

            return (
              <svg width={width} height={height} role="img" aria-label="Grafico de receita">
                <Group left={margin.left} top={margin.top}>
                  {dados.map((d) => (
                    <Bar
                      key={d.label}
                      x={xScale(d.label) ?? 0}
                      y={yScale(d.valor)}
                      width={xScale.bandwidth()}
                      height={innerHeight - yScale(d.valor)}
                      fill="var(--accent)"
                      rx={3}
                    />
                  ))}
                  <AxisBottom
                    top={innerHeight}
                    scale={xScale}
                    tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    stroke="var(--line)"
                    tickStroke="var(--line)"
                  />
                  <AxisLeft
                    scale={yScale}
                    tickFormat={(v) => `R$${((v as number) / 100).toFixed(0)}`}
                    tickLabelProps={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    stroke="var(--line)"
                    tickStroke="var(--line)"
                  />
                </Group>
              </svg>
            );
          }}
        </ParentSize>
      </div>
    </div>
  );
}

// -- Skeleton ---------------------------------------------------------------

function FinanceiroVisaoSkeleton() {
  return (
    <div className="space-y-6" data-testid="financeiro-visao-skeleton">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
            'flex items-center gap-[var(--s-4)] rounded-[var(--r-md)] px-[var(--s-5)] py-[var(--s-4)] text-[length:var(--fs-13)]',
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
      className="rounded-xl border border-line bg-surface shadow-elev-1 p-[var(--s-6)]"
    >
      <h2 className="mb-[var(--s-4)] text-[length:var(--fs-15)] font-semibold">Top categorias</h2>
      <ul className="m-0 grid list-none gap-[var(--s-3)] p-0">
        {categorias.map((c) => (
          <li
            key={c.nome}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-[var(--s-4)] border-b border-line py-[var(--s-2)] text-[length:var(--fs-14)]"
          >
            <span>{c.nome}</span>
            <span className="tabular-nums text-text-muted">
              {centavosParaReais(c.total)}
            </span>
            <span className="min-w-[3ch] text-right font-medium tabular-nums">
              {c.percentual}%
            </span>
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

  // Derivar dados do grafico de receita a partir do receitaVsDespesa
  const dadosGrafico: DadosReceita[] = dados.receitaVsDespesa.map((item) => ({
    label: item.mes.slice(5), // e.g. "06", "07", "08"
    valor: item.receita,
  }));

  return (
    <div className="grid gap-[var(--s-8)]">
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

      {p.carregarAReceber && p.aoCobrar && p.aoMarcarPago && p.aoEnviarLink ? (
        <section aria-label="Contas a receber" className="rounded-2xl border border-line bg-surface p-5">
          <FinanceiroAReceber
            carregarDados={p.carregarAReceber}
            aoCobrar={p.aoCobrar}
            aoMarcarPago={p.aoMarcarPago}
            aoEnviarLink={p.aoEnviarLink}
            hoje={p.hoje ?? new Date().toISOString().slice(0, 10)}
          />
        </section>
      ) : null}

      <details className="rounded-2xl border border-line bg-surface">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-text marker:text-text-faint">
          Análise do período
          <span className="ml-2 font-normal text-text-muted">Receita e categorias</span>
        </summary>
        <div className="grid gap-5 border-t border-line p-5">
          <SeletorPeriodo periodo={periodo as Periodo} onChange={(next) => void setPeriodo(next)} />
          <GraficoReceita dados={dadosGrafico} periodo={ROTULOS_PERIODO[periodo as Periodo] ?? periodo} />
          <SecaoCategorias categorias={dados.topCategorias} />
        </div>
      </details>
    </div>
  );
}
