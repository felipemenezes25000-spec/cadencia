'use client';
import { useEffect, useState } from 'react';
import { Barbell } from '@phosphor-icons/react';
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

  if (itens === null) {
    return <div className="grid gap-2"><Skeleton variant="table-row" /><Skeleton variant="table-row" /><Skeleton variant="table-row" /></div>;
  }

  if (itens.length === 0) {
    return <EstadoVazio icone={Barbell} titulo="Nenhum procedimento cadastrado"
      descricao="Procedimentos aparecem aqui quando cadastrados na unidade." />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase text-text-muted">
          <tr>
            <th className="px-4 py-2.5 font-medium">Código</th>
            <th className="px-4 py-2.5 font-medium">Procedimento</th>
            <th className="px-4 py-2.5 font-medium">Duração</th>
            <th className="px-4 py-2.5 font-medium">Usos (90 dias)</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((p) => (
            <tr key={p.procedureId} className="border-t border-line">
              <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.cor }} aria-hidden />
                  <span className="font-medium">{p.nome}</span>
                  {p.maisFrequente && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent">frequente</span>}
                </span>
              </td>
              <td className="px-4 py-3 text-text-muted">{p.duracaoMin} min</td>
              <td className="px-4 py-3 text-text-muted">{p.usosRecentes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
