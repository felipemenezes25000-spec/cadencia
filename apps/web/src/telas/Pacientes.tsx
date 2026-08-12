'use client';

import { useState, useMemo } from 'react';
import { MagnifyingGlass, UserCircle, Plus } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { useDebounce } from '../lib/hooks';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Botao } from '../ui/Botao';
import { Skeleton } from '../ui/Skeleton';
import { PageHeader } from '../ui/PageHeader';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

/* ── Facetas (filtros salvos) ───────────────────────────── */

export interface Faceta {
  readonly chave: string;
  readonly rotulo: string;
}

export const FACETAS: readonly Faceta[] = [
  { chave: 'ativos', rotulo: 'Ativos' },
  { chave: 'inativos', rotulo: 'Inativos' },
  { chave: 'obitos', rotulo: 'Óbitos' },
  { chave: 'cadastro_preliminar', rotulo: 'Cadastro preliminar' },
  { chave: 'sem_retorno', rotulo: 'Sem retorno há 6 meses' },
];

/* ── Helpers ────────────────────────────────────────────── */

/** Extrai iniciais do nome (até 2 letras) */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0];
  if (!primeira) return '?';
  const ultima = partes[partes.length - 1];
  if (partes.length === 1 || !ultima) return primeira.charAt(0).toUpperCase();
  return (primeira.charAt(0) + ultima.charAt(0)).toUpperCase();
}

/** Formata data ISO para exibição curta */
function formatarData(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

/* ── Props ──────────────────────────────────────────────── */

export interface PacientesProps {
  readonly faceta: string;
  readonly buscar: (termo: string, faceta: string) => Promise<PacienteHit[]>;
  readonly aoMudarFaceta: (faceta: string) => void;
  readonly aoAbrir: (patientId: string) => void;
  /** Callback para botão "Novo paciente" */
  readonly aoCriar?: () => void;
}

/* ── Skeleton de carregamento ───────────────────────────── */

export function PacientesSkeleton() {
  return (
    <div className="space-y-4 p-6" data-testid="pacientes-skeleton">
      <Skeleton variant="text" width="200px" />
      <Skeleton variant="text" width="300px" height="40px" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="text" width="80px" height="32px" />
        ))}
      </div>
      <div className="space-y-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton variant="avatar" />
            <div className="flex-1 space-y-1">
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="text" width="30%" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Estado vazio ───────────────────────────────────────── */

function EstadoVazio({
  busca,
  aoCriar,
}: {
  readonly busca: string;
  readonly aoCriar?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icone icon={UserCircle} size="xl" className="text-text-muted mb-3" />
      <p className="text-base font-medium text-text">Nenhum paciente encontrado</p>
      <p className="mt-1 text-sm text-text-muted">
        {busca
          ? `Nenhum resultado para "${busca}"`
          : 'Adicione seu primeiro paciente'}
      </p>
      {!busca && aoCriar && (
        <Botao
          variante="primario"
          className="mt-4"
          iconeEsquerda={Plus}
          onClick={aoCriar}
        >
          Novo paciente
        </Botao>
      )}
    </div>
  );
}

/* ── Componente principal ───────────────────────────────── */

export function Pacientes(p: PacientesProps) {
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState<PacienteHit[] | null>(null);

  const buscaDebounced = useDebounce(busca, 300);

  // Buscar pacientes quando muda o debounced ou a faceta
  const [ultimaBusca, setUltimaBusca] = useState<string | null>(null);
  const [ultimaFaceta, setUltimaFaceta] = useState<string | null>(null);

  if (buscaDebounced !== ultimaBusca || p.faceta !== ultimaFaceta) {
    setUltimaBusca(buscaDebounced);
    setUltimaFaceta(p.faceta);
    void p.buscar(buscaDebounced, p.faceta).then(setItens);
  }

  const carregando = itens === null;

  // Contagem para o subtítulo
  const contagem = itens?.length ?? 0;

  // Filtro local pelo termo digitado (antes do debounce resolver)
  const pacientesFiltrados = useMemo(() => {
    if (!itens) return [];
    return itens;
  }, [itens]);

  return (
    <div className="cadencia-page grid gap-6">
      {/* Cabeçalho */}
      <PageHeader
        titulo="Pacientes"
        {...(carregando ? {} : { subtitulo: `${contagem} paciente${contagem !== 1 ? 's' : ''}` })}
        semBreadcrumb
        {...(p.aoCriar
          ? {
              acoes: (
                <Botao variante="primario" iconeEsquerda={Plus} onClick={p.aoCriar}>
                  Novo paciente
                </Botao>
              ),
            }
          : {})}
      />

      {/* Barra de busca */}
      <Campo
        prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
        placeholder="Buscar por nome, CPF ou telefone..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="max-w-md"
        aria-label="Buscar pacientes"
      />

      {/* Chips de filtro (facetas) */}
      <div
        className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-2"
        role="tablist"
        aria-label="Filtros de pacientes"
      >
        {FACETAS.map((f) => (
          <button
            key={f.chave}
            type="button"
            role="tab"
            aria-selected={p.faceta === f.chave}
            onClick={() => p.aoMudarFaceta(f.chave)}
            className={cn(
              'whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all-fast',
              p.faceta === f.chave
                ? 'border-accent/25 bg-accent-soft text-accent shadow-elev-1'
                : 'border-line bg-surface text-text-muted hover:border-line-strong hover:text-text'
            )}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      {carregando ? (
        <PacientesSkeleton />
      ) : pacientesFiltrados.length === 0 ? (
        <EstadoVazio busca={busca} {...(p.aoCriar ? { aoCriar: p.aoCriar } : {})} />
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-xl border border-line bg-surface p-0 shadow-elev-1" aria-label="Lista de pacientes">
          {pacientesFiltrados.map((pac) => (
            <li
              key={pac.patientId}
              style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
            >
              <button
                type="button"
                onClick={() => p.aoAbrir(pac.patientId)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-line px-4 py-3.5 last:border-b-0',
                  'text-left transition-all-fast',
                  'hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent'
                )}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    'bg-accent-soft text-sm font-semibold text-accent ring-1 ring-accent/10'
                  )}
                  aria-hidden="true"
                >
                  {iniciais(pac.displayName)}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">
                    {pac.displayName}
                  </p>
                  <p className="text-xs text-text-muted">
                    {pac.birthDate
                      ? `Nascimento: ${formatarData(pac.birthDate)}`
                      : 'Sem data de nascimento'}
                  </p>
                  {pac.cadastroStatus === 'preliminar' && (
                    <span className="mt-0.5 inline-block rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">
                      preliminar
                    </span>
                  )}
                </div>

                {/* Telefone (visível apenas no desktop) */}
                <span className="text-xs text-text-muted max-sm:hidden">
                  {pac.phonePrimary ?? '—'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
