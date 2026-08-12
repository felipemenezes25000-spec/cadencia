'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { Skeleton } from '../ui/Skeleton';
import { Botao } from '../ui/Botao';
import { ApiError } from '../api';

export interface ColunaCatalogo<T> {
  readonly chave: keyof T & string;
  readonly rotulo: string;
}

export interface BuscaDeCatalogoProps<T extends object> {
  readonly titulo: string;
  readonly placeholder: string;
  readonly colunas: readonly ColunaCatalogo<T>[];
  readonly buscar: (termo: string) => Promise<T[]>;
}

function mensagemDaFalha(erro: unknown, titulo: string): string {
  if (erro instanceof ApiError) {
    if (erro.codigo === 'catalogo_nao_carregado') {
      return `O catálogo ${titulo} ainda não foi carregado neste ambiente. A consulta não pode devolver dados confiáveis.`;
    }
    if (erro.codigo === 'sem_permissao') {
      return `Seu perfil não possui permissão para consultar o catálogo ${titulo}.`;
    }
    if (erro.codigo === 'nao_autenticado') {
      return 'Sua sessão expirou. Entre novamente para continuar.';
    }
  }
  return `Não foi possível consultar o catálogo ${titulo}. Nenhuma informação foi alterada.`;
}

export function BuscaDeCatalogo<T extends object>({
  titulo, placeholder, colunas, buscar,
}: BuscaDeCatalogoProps<T>) {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<T[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const geracaoRef = useRef(0);

  const executarBusca = useCallback(async (t: string) => {
    const geracao = ++geracaoRef.current;
    if (t.trim().length < 2) {
      setResultados([]);
      setBuscou(false);
      setErro(null);
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const r = await buscar(t.trim());
      if (geracao !== geracaoRef.current) return;
      setResultados(r);
      setBuscou(true);
    } catch (falha: unknown) {
      if (geracao !== geracaoRef.current) return;
      setResultados([]);
      setBuscou(true);
      setErro(mensagemDaFalha(falha, titulo));
    } finally {
      if (geracao === geracaoRef.current) setCarregando(false);
    }
  }, [buscar, titulo]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (termo.trim().length < 2) {
      geracaoRef.current += 1;
      setResultados([]);
      setBuscou(false);
      setErro(null);
      setCarregando(false);
      return;
    }
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
      {!carregando && erro && (
        <div role="alert" className="flex flex-col gap-4 rounded-xl border border-danger/20 bg-danger-soft p-4 sm:flex-row sm:items-center">
          <WarningCircle size={22} weight="fill" className="shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-danger">Consulta indisponível</p>
            <p className="mt-0.5 text-sm text-text-muted">{erro}</p>
          </div>
          <Botao variante="secundario" tamanho="sm" onClick={() => void executarBusca(termo)}>
            Tentar novamente
          </Botao>
        </div>
      )}
      {!carregando && !buscou && <p className="py-12 text-center text-sm text-text-muted">Digite ao menos 2 caracteres para buscar.</p>}
      {!carregando && buscou && !erro && resultados.length === 0 && <p className="py-12 text-center text-sm text-text-muted">Nenhum resultado para &ldquo;{termo}&rdquo; nesta data de referência.</p>}
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
