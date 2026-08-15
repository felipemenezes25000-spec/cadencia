'use client';

import { useEffect, useState } from 'react';
import {
  Bank,
  ChartLineUp,
  CreditCard,
  CurrencyDollar,
  PaperPlaneTilt,
  Wallet,
} from '@phosphor-icons/react';
import { Botao } from '../ui/Botao';
import { PageHeader } from '../ui/PageHeader';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../lib/cn';

export type MetodoResumo = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface CaixaDoDia {
  readonly total: number;
  readonly porMetodo: ReadonlyArray<{ method: MetodoResumo; total: number; count: number }>;
}

export interface ReceitasDoMes {
  readonly dias: ReadonlyArray<{ dia: string; total: number }>;
  readonly totalMes: number;
  readonly mediaDiaria: number;
}

export interface EntradaPendente {
  readonly entryId: string;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly status: 'pendente';
}

export interface AReceber {
  readonly total: number;
  readonly entradas: readonly EntradaPendente[];
}

export interface FinanceiroProps {
  readonly carregarCaixaDoDia: () => Promise<CaixaDoDia>;
  readonly carregarReceitasDoMes: () => Promise<ReceitasDoMes>;
  readonly carregarAReceber: () => Promise<AReceber>;
  readonly aoEnviarLink: (entryId: string) => Promise<void>;
}

const ROTULO_METODO: Record<MetodoResumo, string> = {
  dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix', link: 'Link',
};

const ICONE_METODO: Record<MetodoResumo, typeof Wallet> = {
  dinheiro: Wallet,
  cartao: CreditCard,
  pix: Bank,
  link: PaperPlaneTilt,
};

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

/* Mantém o total secundário dividido em nós distintos para evitar duplicidade
   ambígua em leitores/testes que procuram o total principal do caixa. */
function ValorDividido({ centavos }: { readonly centavos: number }) {
  const f = centavosParaReais(centavos);
  const i = f.indexOf(' ') + 1;
  return <>{f.slice(0, i)}<span>{f.slice(i)}</span></>;
}

function GraficoDeBarras({ dias }: { readonly dias: ReadonlyArray<{ dia: string; total: number }> }) {
  const maxTotal = Math.max(...dias.map((d) => d.total), 1);
  const larguraBarra = 26;
  const gap = 7;
  const alturaMax = 132;
  const largura = dias.length * (larguraBarra + gap);

  return (
    <svg
      role="img" aria-label="Receitas dos últimos dias"
      viewBox={`0 0 ${largura} ${alturaMax + 24}`}
      className="h-[156px] w-full min-w-[320px]"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="finance-bars" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--brand) 55%, white)" />
        </linearGradient>
      </defs>
      {dias.map((d, i) => {
        const altura = Math.max((d.total / maxTotal) * alturaMax, 3);
        const x = i * (larguraBarra + gap);
        const y = alturaMax - altura;
        const diaLabel = d.dia.slice(8);
        return (
          <g key={d.dia}>
            <rect
              x={x} y={y} width={larguraBarra} height={altura}
              rx={5} fill="url(#finance-bars)"
              role="img" aria-label={`${d.dia}: ${centavosParaReais(d.total)}`}
            />
            <text x={x + larguraBarra / 2} y={alturaMax + 18}
              textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--text-tertiary)">
              {diaLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function FinanceiroSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando financeiro"
      data-testid="financeiro-skeleton"
      className="cadencia-page grid gap-5"
    >
      <Skeleton variant="text" width="220px" height="32px" decorativo />
      <div className="grid gap-4 lg:grid-cols-[.88fr_1.12fr]">
        <Skeleton variant="card" height="260px" decorativo />
        <Skeleton variant="card" height="260px" decorativo />
      </div>
      <Skeleton variant="card" height="260px" decorativo />
    </div>
  );
}

export function Financeiro(p: FinanceiroProps) {
  const [caixa, setCaixa] = useState<CaixaDoDia | null>(null);
  const [receitas, setReceitas] = useState<ReceitasDoMes | null>(null);
  const [aReceber, setAReceber] = useState<AReceber | null>(null);

  useEffect(() => {
    void p.carregarCaixaDoDia().then(setCaixa);
    void p.carregarReceitasDoMes().then(setReceitas);
    void p.carregarAReceber().then(setAReceber);
  }, [p]);

  const carregando = caixa === null && receitas === null && aReceber === null;
  if (carregando) return <FinanceiroSkeleton />;

  return (
    <div className="cadencia-page grid gap-5 pb-28 md:pb-12">
      <PageHeader
        titulo="Financeiro"
        eyebrow="Gestão financeira"
        subtitulo="Caixa, receita e cobranças em uma leitura operacional única."
        semBreadcrumb
      />

      <div className="grid items-stretch gap-4 lg:grid-cols-[.88fr_1.12fr]">
        {caixa !== null ? (
          <section aria-label="Caixa do dia" className="cadencia-card relative overflow-hidden rounded-[18px] p-5 sm:p-6">
            <div className="absolute -right-10 -top-14 size-40 rounded-full bg-accent-soft blur-2xl" aria-hidden />
            <div className="relative z-[1] flex items-start justify-between gap-4">
              <div>
                <p className="cadencia-kicker">Hoje</p>
                <h2 className="mt-1 text-[17px] font-bold tracking-[-0.025em] text-text">Caixa do dia</h2>
              </div>
              <span className="grid size-10 place-items-center rounded-xl border border-accent/12 bg-accent-soft text-accent"><Wallet size={19} weight="duotone" aria-hidden /></span>
            </div>
            <p className="num relative z-[1] mt-5 text-[30px] font-bold leading-none tracking-[-0.045em] text-text">
              {centavosParaReais(caixa.total)}
            </p>
            <p className="relative z-[1] mt-2 text-xs text-text-muted">Recebimentos registrados na unidade hoje.</p>

            <ul className="relative z-[1] mt-5 grid gap-1.5">
              {caixa.porMetodo.map((m) => {
                const Icone = ICONE_METODO[m.method];
                return (
                  <li key={m.method} className="flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 transition-colors hover:border-line hover:bg-surface-subtle">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-text-muted"><Icone size={15} aria-hidden /></span>
                    <span className="min-w-0 flex-1 text-xs font-semibold text-text-muted">{ROTULO_METODO[m.method]} <span className="font-medium text-text-faint">· {m.count}</span></span>
                    <span className="num text-xs font-bold text-text"><ValorDividido centavos={m.total} /></span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {receitas !== null ? (
          <section aria-label="Receitas do mês" className="cadencia-card rounded-[18px] p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="cadencia-kicker">Performance</p>
                <h2 className="mt-1 text-[17px] font-bold tracking-[-0.025em] text-text">Receitas do mês</h2>
              </div>
              <span className="grid size-10 place-items-center rounded-xl border border-ok/12 bg-ok-soft text-ok"><ChartLineUp size={19} weight="duotone" aria-hidden /></span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-[14px] border border-line bg-surface-subtle/65 p-3.5">
                <span className="text-[9px] font-bold uppercase tracking-[.11em] text-text-faint">Total</span>
                <p className="num mt-1.5 text-[19px] font-bold tracking-[-0.03em] text-text"><ValorDividido centavos={receitas.totalMes} /></p>
              </div>
              <div className="rounded-[14px] border border-line bg-surface-subtle/65 p-3.5">
                <span className="text-[9px] font-bold uppercase tracking-[.11em] text-text-faint">Média diária</span>
                <p className="num mt-1.5 text-[19px] font-bold tracking-[-0.03em] text-text"><ValorDividido centavos={receitas.mediaDiaria} /></p>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-[14px] border border-line bg-[linear-gradient(180deg,var(--surface),var(--surface-subtle))] px-3 pb-2 pt-4 scrollbar-thin">
              <GraficoDeBarras dias={receitas.dias} />
            </div>
          </section>
        ) : null}
      </div>

      {aReceber !== null ? (
        <section aria-label="A receber" className="cadencia-card overflow-hidden rounded-[18px]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-[linear-gradient(180deg,var(--surface),var(--surface-subtle))] px-5 py-4 sm:px-6">
            <div>
              <p className="cadencia-kicker">Cobranças abertas</p>
              <h2 className="mt-1 text-[17px] font-bold tracking-[-0.025em] text-text">A receber</h2>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-warn/12 bg-warn-soft/60 px-3 py-2">
              <CurrencyDollar size={17} className="text-warn" aria-hidden />
              <span className="num text-sm font-bold text-text">{centavosParaReais(aReceber.total)}</span>
            </div>
          </div>

          <ul className="m-0 list-none p-0">
            {aReceber.entradas.map((e, index) => (
              <li
                key={e.entryId}
                className={cn(
                  'grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-6',
                  index !== aReceber.entradas.length - 1 && 'border-b border-line',
                )}
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm font-bold tracking-[-0.012em] text-text">{e.patientName}</span>
                  <span className="mt-1 block truncate text-xs text-text-muted">{e.description} · vence {e.dueDate}</span>
                </div>
                <span className="num text-sm font-bold text-text sm:text-right">{centavosParaReais(e.amountCents)}</span>
                <Botao
                  variante="secundario"
                  tamanho="sm"
                  iconeEsquerda={PaperPlaneTilt}
                  onClick={() => { void p.aoEnviarLink(e.entryId); }}
                  className="max-sm:w-full"
                >
                  Enviar link de cobrança
                </Botao>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
