'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

interface Metric {
  key: string; label: string; value: number;
  unit: 'numero' | 'percentual'; previous: number | null;
}
interface Resposta { mes: string; metrics: Metric[]; freshness: { refreshedAt: string } }

function mesAtual(): string { return new Date().toISOString().slice(0, 7); }

export default function PaginaDesempenho() {
  const { clinicId, csrfToken } = useSessao();
  const [mes, setMes] = useState(mesAtual());
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let vivo = true; setErro(false);
    void apiFetch<Resposta>(`/v1/desempenho/indicadores?mes=${mes}`, { clinicId, csrfToken })
      .then((r) => { if (vivo) setDados(r); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [clinicId, csrfToken, mes]);

  return <div className="cadencia-page space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="cadencia-kicker">Gestão pública</p><h1 className="text-2xl font-bold text-text">Indicadores assistenciais</h1><p className="mt-1 text-sm text-text-muted">Produção, absenteísmo, cidadãos e fila de regulação da unidade.</p></div>
      <label className="grid gap-1 text-xs font-semibold text-text-muted">Competência<input type="month" value={mes} onChange={(e)=>setMes(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-text" /></label>
    </header>
    {erro ? <p role="alert" className="rounded-xl bg-danger/10 p-4 text-sm text-danger">Não foi possível carregar os indicadores.</p> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {(dados?.metrics ?? []).map((m) => {
        const delta = m.previous === null ? null : m.value - m.previous;
        return <article key={m.key} className="rounded-xl border border-line bg-surface p-5"><p className="text-sm font-medium text-text-muted">{m.label}</p><strong className="mt-2 block text-3xl font-bold tracking-tight text-text">{m.unit === 'percentual' ? `${m.value.toLocaleString('pt-BR')}%` : m.value.toLocaleString('pt-BR')}</strong>{delta !== null ? <p className="mt-2 text-xs text-text-muted">Mês anterior: {m.previous?.toLocaleString('pt-BR')}{m.unit === 'percentual' ? '%' : ''} · variação {delta > 0 ? '+' : ''}{delta.toLocaleString('pt-BR')}{m.unit === 'percentual' ? ' p.p.' : ''}</p> : <p className="mt-2 text-xs text-text-faint">Situação atual</p>}</article>;
      })}
    </section>
    {dados ? <p className="text-xs text-text-faint">Atualizado em {new Date(dados.freshness.refreshedAt).toLocaleString('pt-BR')}.</p> : null}
  </div>;
}
