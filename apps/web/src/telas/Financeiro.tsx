'use client';

import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Money, PixLogo, TrendUp, ArrowUpRight, Wallet } from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { Botao } from '../ui/Botao';
import { Skeleton } from '../ui/Skeleton';
import { PageHeader } from '../ui/PageHeader';

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

const ROTULO_METODO: Record<MetodoResumo, string> = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix', link: 'Link' };
const ICONE_METODO: Record<MetodoResumo, PhosphorIcon> = { dinheiro: Money, cartao: CreditCard, pix: PixLogo, link: ArrowUpRight };

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function ValorDividido({ centavos }: { readonly centavos: number }) {
  const f = centavosParaReais(centavos);
  const i = f.indexOf(' ') + 1;
  return <>{f.slice(0, i)}<span>{f.slice(i)}</span></>;
}

function GraficoDeBarras({ dias }: { readonly dias: ReadonlyArray<{ dia: string; total: number }> }) {
  const maxTotal = Math.max(...dias.map((d) => d.total), 1);
  const larguraBarra = 30;
  const gap = 9;
  const alturaMax = 132;
  const largura = Math.max(dias.length * (larguraBarra + gap), 260);

  return (
    <svg role="img" aria-label="Receitas dos últimos dias" viewBox={`0 0 ${largura} ${alturaMax + 28}`} className="h-[160px] min-w-[320px] w-full overflow-visible">
      <defs>
        <linearGradient id="financeiro-bars" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--brand-cyan)" stopOpacity=".42" />
        </linearGradient>
      </defs>
      {[.25, .5, .75, 1].map((n) => <line key={n} x1="0" x2={largura} y1={alturaMax * (1 - n)} y2={alturaMax * (1 - n)} stroke="var(--line)" strokeOpacity=".5" strokeDasharray="3 5" />)}
      {dias.map((d, i) => {
        const altura = Math.max((d.total / maxTotal) * alturaMax, 3);
        const x = i * (larguraBarra + gap) + 4;
        const y = alturaMax - altura;
        return (
          <g key={d.dia}>
            <rect x={x} y={y} width={larguraBarra} height={altura} rx={7} fill="url(#financeiro-bars)" role="img" aria-label={`${d.dia}: ${centavosParaReais(d.total)}`} />
            <text x={x + larguraBarra / 2} y={alturaMax + 18} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--text-faint)">{d.dia.slice(8)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function FinanceiroSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Carregando financeiro" data-testid="financeiro-skeleton" className="cadencia-page mx-auto grid max-w-6xl gap-6">
      <Skeleton variant="text" width="180px" height="30px" />
      <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} variant="card" height="132px" />)}</div>
      <Skeleton variant="card" height="270px" />
    </div>
  );
}

export function Financeiro(p: FinanceiroProps) {
  const [caixa, setCaixa] = useState<CaixaDoDia | null>(null);
  const [receitas, setReceitas] = useState<ReceitasDoMes | null>(null);
  const [aReceber, setAReceber] = useState<AReceber | null>(null);

  useEffect(() => {
    let ativo = true;
    void Promise.all([p.carregarCaixaDoDia(), p.carregarReceitasDoMes(), p.carregarAReceber()]).then(([novoCaixa, novasReceitas, novosReceber]) => {
      if (!ativo) return;
      setCaixa(novoCaixa); setReceitas(novasReceitas); setAReceber(novosReceber);
    });
    return () => { ativo = false; };
  }, [p.carregarCaixaDoDia, p.carregarReceitasDoMes, p.carregarAReceber]);

  const participacao = useMemo(() => {
    if (!caixa || caixa.total <= 0) return new Map<MetodoResumo, number>();
    return new Map(caixa.porMetodo.map((m) => [m.method, Math.round((m.total / caixa.total) * 100)]));
  }, [caixa]);

  if (caixa === null && receitas === null && aReceber === null) return <FinanceiroSkeleton />;

  return (
    <div className="cadencia-page mx-auto grid max-w-6xl gap-6">
      <PageHeader titulo="Financeiro" subtitulo="Caixa, receitas e pendências organizados como sinais de decisão." semBreadcrumb />

      {caixa !== null && (
        <section aria-label="Caixa do dia" className="cadencia-panel cadencia-panel-hero p-5 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(220px,.72fr)_minmax(0,1.28fr)] lg:items-stretch">
            <div className="flex min-h-[178px] flex-col justify-between rounded-[20px] border border-accent/10 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--accent)_9%,var(--surface)),var(--surface))] p-5 shadow-elev-1">
              <div className="flex items-start justify-between gap-3"><div><span className="cadencia-eyebrow">Liquidez hoje</span><h2 className="m-0 mt-2 text-sm font-semibold text-text">Caixa do dia</h2></div><span className="cadencia-icon-orb h-10 w-10"><Wallet size={19} weight="duotone" /></span></div>
              <div><p className="num m-0 text-[clamp(1.8rem,4vw,2.7rem)] font-semibold tracking-[-.055em] text-text">{centavosParaReais(caixa.total)}</p><div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-ok"><TrendUp size={13} weight="bold" /> fluxo consolidado</div></div>
            </div>
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
              {caixa.porMetodo.map((m, index) => {
                const Icon = ICONE_METODO[m.method];
                return (
                  <motion.li key={m.method} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .045 }} className="cadencia-metric flex items-center gap-3 p-3.5">
                    <span className="cadencia-icon-orb h-9 w-9 shrink-0"><Icon size={17} weight="duotone" /></span>
                    <div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2"><span className="text-xs font-semibold text-text">{ROTULO_METODO[m.method]} <span className="font-normal text-text-faint">({m.count})</span></span><span className="num text-xs font-bold text-text">{index === 0 ? centavosParaReais(m.total) : <ValorDividido centavos={m.total} />}</span></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-[var(--aurora)]" style={{ width: `${participacao.get(m.method) ?? 0}%` }} /></div></div>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {receitas !== null && (
        <section aria-label="Receitas do mês" className="cadencia-panel p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><span className="cadencia-eyebrow">Cadência de receita</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em] text-text">Receitas do mês</h2></div><div className="flex gap-5"><div><span className="text-[9px] font-bold uppercase tracking-[.09em] text-text-faint">Total</span><p className="num m-0 text-base font-semibold text-text"><ValorDividido centavos={receitas.totalMes} /></p></div><div><span className="text-[9px] font-bold uppercase tracking-[.09em] text-text-faint">Média diária</span><p className="num m-0 text-base font-semibold text-text"><ValorDividido centavos={receitas.mediaDiaria} /></p></div></div></div>
          <div className="overflow-x-auto rounded-2xl bg-surface-sunken/28 px-3 pb-1 pt-5"><GraficoDeBarras dias={receitas.dias} /></div>
        </section>
      )}

      {aReceber !== null && (
        <section aria-label="A receber" className="cadencia-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line/70 px-5 py-4 sm:px-6"><div><span className="cadencia-eyebrow">Próximos movimentos</span><h2 className="m-0 mt-1 text-base font-semibold text-text">A receber</h2></div><span className="num rounded-full border border-warn/15 bg-warn-soft px-3 py-1.5 text-xs font-bold text-warn">{centavosParaReais(aReceber.total)}</span></div>
          <ul className="m-0 list-none divide-y divide-line/65 p-0">
            {aReceber.entradas.map((e) => (
              <li key={e.entryId} className="grid gap-3 px-5 py-4 transition-colors hover:bg-surface-hover/65 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-6">
                <div className="min-w-0"><span className="block truncate text-sm font-semibold text-text">{e.patientName}</span><span className="mt-0.5 block truncate text-[11px] text-text-muted">{e.description} · vence {e.dueDate}</span></div>
                <span className="num text-sm font-semibold text-text">{centavosParaReais(e.amountCents)}</span>
                <Botao variante="fantasma" altura={32} onClick={() => { void p.aoEnviarLink(e.entryId); }}>Enviar link</Botao>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
