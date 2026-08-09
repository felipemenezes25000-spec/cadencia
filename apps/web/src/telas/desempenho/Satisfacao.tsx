'use client';

import { useEffect, useState } from 'react';
import { ChatCircleText, Heart, Smiley, Star } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';
import { Skeleton } from '../../ui/Skeleton';
import type { NpsSummary, NpsPoint, NpsByProfessional, DataFreshness } from './types';

export interface SatisfacaoProps {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly carregarDados: () => Promise<{ summary: NpsSummary; evolution: NpsPoint[]; byProfessional: NpsByProfessional[]; freshness: DataFreshness }>;
}

const MESES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;
function npsColor(score: number): string { return score >= 75 ? 'var(--ok)' : score >= 50 ? 'var(--accent)' : score >= 0 ? 'var(--warn)' : 'var(--danger)'; }

function NpsEvolutionChart({ points }: { readonly points: readonly NpsPoint[] }) {
  if (points.length === 0) return null;
  const width = 680, height = 210, left = 38, right = 24, top = 26, bottom = 38;
  const chartW = width - left - right, chartH = height - top - bottom;
  const minScore = Math.min(...points.map((pt) => pt.score), 0), maxScore = Math.max(...points.map((pt) => pt.score), 100), range = maxScore - minScore || 1;
  const coords = points.map((pt, i) => ({ ...pt, x: left + (i / Math.max(points.length - 1, 1)) * chartW, y: top + chartH - ((pt.score - minScore) / range) * chartH }));
  const line = coords.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x},${pt.y}`).join(' ');
  const area = `${line} L${coords.at(-1)?.x ?? left},${top + chartH} L${coords[0]?.x ?? left},${top + chartH} Z`;
  return <svg role="img" aria-label="NPS evolutivo" viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[520px]">
    <defs><linearGradient id="nps-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".18" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
    {[0, 25, 50, 75, 100].map((v) => { const y = top + chartH - ((v - minScore) / range) * chartH; return <line key={v} x1={left} x2={width - right} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 5" />; })}
    <path d={area} fill="url(#nps-area)" /><path d={line} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    {coords.map((pt) => { const [, m] = pt.period.split('-'); return <g key={pt.period}><circle cx={pt.x} cy={pt.y} r="5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="3" /><text x={pt.x} y={height - 9} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--text-muted)">{MESES_CURTO[Number(m) - 1]}</text></g>; })}
  </svg>;
}

const thClasses = cn('border-b border-line/70 px-4 py-3 text-[10px]', 'font-bold uppercase tracking-[.09em] text-text-faint');

function SatisfacaoSkeleton() {
  return <div className="cadencia-page cadencia-enter mx-auto grid max-w-[1180px] gap-6" role="status" aria-label="Carregando satisfacao"><div className="space-y-2"><Skeleton variant="text" width="180px" height="34px" /><Skeleton variant="text" width="300px" height="14px" /></div><Skeleton variant="card" height="190px" /><Skeleton variant="card" height="260px" /></div>;
}

export function Satisfacao(p: SatisfacaoProps) {
  const [summary, setSummary] = useState<NpsSummary | null>(null);
  const [evolution, setEvolution] = useState<NpsPoint[]>([]);
  const [byProf, setByProf] = useState<NpsByProfessional[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { let active = true; setLoading(true); void p.carregarDados().then((r) => { if (!active) return; setSummary(r.summary); setEvolution(r.evolution); setByProf(r.byProfessional); setFreshness(r.freshness); setLoading(false); }); return () => { active = false; }; }, [p.carregarDados]);
  if (loading && summary === null) return <SatisfacaoSkeleton />;

  return <div className="cadencia-page cadencia-enter mx-auto grid max-w-[1180px] gap-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><span className="cadencia-eyebrow">Voz do paciente</span><h1 className="m-0 mt-2 text-[clamp(1.8rem,3.2vw,2.7rem)] font-semibold leading-none tracking-[-.05em]">Satisfacao</h1><p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">Não apenas um score: uma leitura contínua de confiança, experiência e consistência do cuidado.</p></div>{freshness?.source === 'matview' && freshness.refreshedAt ? <span className="rounded-full border border-line/70 bg-surface/80 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-text-faint shadow-elev-1">dados ate {new Date(freshness.refreshedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}</span> : null}</header>

    {summary ? <section aria-label="NPS do periodo" className="cadencia-panel cadencia-panel-hero overflow-hidden p-5 sm:p-6"><div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)] lg:items-center"><div><div className="flex items-center gap-3"><div className="cadencia-icon-orb"><Heart size={19} weight="fill" /></div><span className="cadencia-eyebrow">Net Promoter Score</span></div><div className="mt-5 flex flex-wrap items-end gap-4"><span className="num text-[clamp(3.8rem,8vw,6.6rem)] font-semibold leading-[.82] tracking-[-.085em]" style={{ color: npsColor(summary.score) }}>{summary.score}</span><div className="pb-1"><strong className="block text-lg tracking-[-.03em]">NPS da experiência</strong><span className="text-sm text-text-muted">{summary.totalResponses} respostas no período</span></div></div><div className="mt-6 h-2 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-[linear-gradient(90deg,var(--danger),var(--warn),var(--accent),var(--ok))]" style={{ width: `${Math.max(4, Math.min(100, summary.score))}%` }} /></div></div>
      <div className="grid grid-cols-3 gap-2"><div className="rounded-2xl border border-ok/15 bg-ok-soft/60 p-4"><Smiley size={18} className="text-ok" weight="duotone" /><strong className="num mt-4 block text-2xl text-ok">{summary.promoters}</strong><span className="mt-1 block text-[9px] font-bold uppercase tracking-[.09em] text-text-muted">Promotores</span></div><div className="rounded-2xl border border-line/70 bg-surface/75 p-4"><ChatCircleText size={18} className="text-text-muted" weight="duotone" /><strong className="num mt-4 block text-2xl text-text-muted">{summary.passives}</strong><span className="mt-1 block text-[9px] font-bold uppercase tracking-[.09em] text-text-muted">Neutros</span></div><div className="rounded-2xl border border-danger/15 bg-danger-soft/55 p-4"><Star size={18} className="text-danger" weight="duotone" /><strong className="num mt-4 block text-2xl text-danger">{summary.detractors}</strong><span className="mt-1 block text-[9px] font-bold uppercase tracking-[.09em] text-text-muted">Detratores</span></div></div></div></section> : null}

    {evolution.length > 0 ? <section aria-label="Evolucao do NPS" className="cadencia-data-grid overflow-hidden"><div className="border-b border-line/70 px-5 py-4 sm:px-6"><span className="cadencia-eyebrow">Tendência</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em]">Evolutivo</h2></div><div className="overflow-x-auto p-4 sm:p-6"><NpsEvolutionChart points={evolution} /></div></section> : null}

    {byProf.length > 0 ? <section aria-label="NPS por profissional" className="cadencia-data-grid overflow-hidden"><div className="border-b border-line/70 px-5 py-4 sm:px-6"><span className="cadencia-eyebrow">Consistência da experiência</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em]">Por profissional</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[560px] border-collapse text-[13px]"><thead><tr><th className={cn(thClasses, 'text-left')}>Profissional</th><th className={cn(thClasses, 'text-right')}>NPS</th><th className={cn(thClasses, 'text-right')}>Respostas</th></tr></thead><tbody>{byProf.map((prof, index) => <tr key={prof.professionalId} className="group hover:bg-accent-soft/30"><td className="border-b border-line/70 px-4 py-3.5"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-xl bg-surface-sunken text-[10px] font-bold text-text-muted">#{index + 1}</span><span className="font-semibold">{prof.professionalName}</span></div></td><td className="num border-b border-line/70 px-4 py-3.5 text-right font-bold tabular-nums" style={{ color: npsColor(prof.score) }}>{prof.score}</td><td className="num border-b border-line/70 px-4 py-3.5 text-right tabular-nums text-text-muted">{prof.responses}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}
