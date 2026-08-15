'use client';
import { useEffect, useMemo, useState } from 'react';
import { Clock, Stethoscope } from '@phosphor-icons/react';
import { Skeleton } from '../../../src/ui/Skeleton';
import { EstadoVazio } from '../../../src/ui/EstadoVazio';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface Procedimento {
  procedureId: string;
  code: string;
  nome: string;
  cor: string;
  duracaoMin: number;
  usosRecentes: number;
  maisFrequente: boolean;
}

export default function PaginaProcedimentos() {
  const { clinicId, csrfToken } = useSessao();
  const [itens, setItens] = useState<Procedimento[] | null>(null);

  useEffect(() => {
    let vivo = true;
    void apiFetch<{ itens: Procedimento[] }>(
      '/v1/procedimentos', { clinicId, csrfToken },
    ).then((r) => { if (vivo) setItens(r.itens); });
    return () => { vivo = false; };
  }, [clinicId, csrfToken]);

  const resumo = useMemo(() => {
    if (itens === null || itens.length === 0) return null;
    const duracaoMedia = Math.round(itens.reduce((total, item) => total + item.duracaoMin, 0) / itens.length);
    const usos = itens.reduce((total, item) => total + item.usosRecentes, 0);
    return { duracaoMedia, usos };
  }, [itens]);

  if (itens === null) {
    return <div className="grid gap-2"><Skeleton variant="table-row" /><Skeleton variant="table-row" /><Skeleton variant="table-row" /></div>;
  }

  if (itens.length === 0) {
    return <EstadoVazio icone={Stethoscope} titulo="Nenhum procedimento cadastrado"
      descricao="Procedimentos aparecem aqui quando cadastrados na unidade." />;
  }

  return (
    <div className="grid gap-4">
      <section className="grid gap-2 rounded-[10px] border border-line bg-surface-subtle/55 p-3 sm:grid-cols-3" aria-label="Resumo do catálogo">
        <div className="rounded-[9px] border border-line bg-surface px-3.5 py-3">
          <p className="text-[9px] font-bold uppercase tracking-[.06em] text-text-faint">Catálogo ativo</p>
          <p className="mt-1.5 text-lg font-bold tabular-nums text-text">{itens.length}</p>
          <p className="mt-0.5 text-[10px] text-text-muted">procedimento{itens.length === 1 ? '' : 's'} na unidade</p>
        </div>
        <div className="rounded-[9px] border border-line bg-surface px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.06em] text-text-faint"><Clock size={12} aria-hidden />Duração média</p>
          <p className="mt-1.5 text-lg font-bold tabular-nums text-text">{resumo?.duracaoMedia ?? 0} min</p>
          <p className="mt-0.5 text-[10px] text-text-muted">referência atual da agenda</p>
        </div>
        <div className="rounded-[9px] border border-line bg-surface px-3.5 py-3">
          <p className="text-[9px] font-bold uppercase tracking-[.06em] text-text-faint">Uso recente</p>
          <p className="mt-1.5 text-lg font-bold tabular-nums text-text">{resumo?.usos ?? 0}</p>
          <p className="mt-0.5 text-[10px] text-text-muted">registros nos últimos 90 dias</p>
        </div>
      </section>

      <div>
        <div className="mb-3">
          <h3 className="m-0 text-[13px] font-semibold text-text">Procedimentos da unidade</h3>
          <p className="mt-1 text-[10px] text-text-faint">Código, duração e frequência de uso para leitura rápida da operação.</p>
        </div>

        <div className="cadencia-table-shell overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr>
                <th className="px-4 py-2.5 text-left">Código</th>
                <th className="px-4 py-2.5 text-left">Procedimento</th>
                <th className="px-4 py-2.5 text-left">Duração</th>
                <th className="px-4 py-2.5 text-right">Usos · 90 dias</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((p) => (
                <tr key={p.procedureId} className="border-t border-line transition-colors hover:bg-surface-subtle/70">
                  <td className="px-4 py-3.5 font-mono text-[11px] text-text-muted">{p.code}</td>
                  <td className="px-4 py-3.5">
                    <span className="flex items-center gap-3">
                      <span className="inline-block size-2.5 shrink-0 rounded-full ring-4 ring-surface-sunken" style={{ backgroundColor: p.cor }} aria-hidden />
                      <span className="min-w-0">
                        <span className="block font-semibold text-text">{p.nome}</span>
                        {p.maisFrequente ? <span className="mt-1 inline-flex rounded-full bg-accent-soft px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.04em] text-accent">Mais frequente</span> : null}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-text-muted"><span className="inline-flex items-center gap-1.5"><Clock size={13} aria-hidden />{p.duracaoMin} min</span></td>
                  <td className="px-4 py-3.5 text-right font-semibold tabular-nums text-text-secondary">{p.usosRecentes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
