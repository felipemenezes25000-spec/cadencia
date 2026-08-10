'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Skeleton } from '../ui/Skeleton';

export interface ColunaCatalogo<T> {
  readonly chave: keyof T & string;
  readonly rotulo: string;
}

export interface BuscaDeCatalogoProps<T extends Record<string, unknown>> {
  readonly titulo: string;
  readonly placeholder: string;
  readonly colunas: readonly ColunaCatalogo<T>[];
  readonly buscar: (termo: string) => Promise<T[]>;
}

export function BuscaDeCatalogo<T extends Record<string, unknown>>({
  titulo, placeholder, colunas, buscar,
}: BuscaDeCatalogoProps<T>) {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<T[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const executarBusca = useCallback(async (t: string) => {
    if (t.length < 2) { setResultados([]); setBuscou(false); return; }
    setCarregando(true);
    try {
      const r = await buscar(t);
      setResultados(r);
      setBuscou(true);
    } finally {
      setCarregando(false);
    }
  }, [buscar]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (termo.length < 2) { setResultados([]); setBuscou(false); return; }
    timerRef.current = setTimeout(() => { void executarBusca(termo); }, 300);
    return () => clearTimeout(timerRef.current);
  }, [termo, executarBusca]);

  return (
    <div className="grid gap-6">
      <div className="relative max-w-lg">
        <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
        <input type="search" role="searchbox" value={termo} onChange={(e) => setTermo(e.target.value)}
          placeholder={placeholder} aria-label={`Buscar em ${titulo}`}
          className="h-10 w-full rounded-lg border border-line bg-surface pl-10 pr-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20" />
      </div>
      {carregando && <div className="grid gap-2"><Skeleton variant="table-row" /><Skeleton variant="table-row" /><Skeleton variant="table-row" /></div>}
      {!carregando && !buscou && <p className="py-12 text-center text-sm text-text-muted">Digite ao menos 2 caracteres para buscar.</p>}
      {!carregando && buscou && resultados.length === 0 && <p className="py-12 text-center text-sm text-text-muted">Nenhum resultado para &ldquo;{termo}&rdquo;.</p>}
      {!carregando && resultados.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase text-text-muted">
              <tr>{colunas.map((col) => <th key={col.chave} className="px-4 py-2.5 font-medium">{col.rotulo}</th>)}</tr>
            </thead>
            <tbody>
              {resultados.map((row, i) => (
                <tr key={i} className="border-t border-line">
                  {colunas.map((col) => <td key={col.chave} className="px-4 py-3">{String(row[col.chave] ?? '—')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
