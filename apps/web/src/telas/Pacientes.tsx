'use client';

import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass, UserCircle, Plus, ArrowRight, UsersThree, IdentificationCard, FunnelSimple } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { useDebounce } from '../lib/hooks';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Botao } from '../ui/Botao';
import { Skeleton } from '../ui/Skeleton';
import { PageHeader } from '../ui/PageHeader';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

export interface Faceta { readonly chave: string; readonly rotulo: string; }
export const FACETAS: readonly Faceta[] = [
  { chave: 'ativos', rotulo: 'Ativos' },
  { chave: 'inativos', rotulo: 'Inativos' },
  { chave: 'obitos', rotulo: 'Óbitos' },
  { chave: 'cadastro_preliminar', rotulo: 'Cadastro preliminar' },
  { chave: 'sem_retorno', rotulo: 'Sem retorno há 6 meses' },
];

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0];
  if (!primeira) return '?';
  const ultima = partes[partes.length - 1];
  if (partes.length === 1 || !ultima) return primeira.charAt(0).toUpperCase();
  return (primeira.charAt(0) + ultima.charAt(0)).toUpperCase();
}

function formatarData(iso: string): string {
  try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return iso; }
}

export interface PacientesProps {
  readonly faceta: string;
  readonly buscar: (termo: string, faceta: string) => Promise<PacienteHit[]>;
  readonly aoMudarFaceta: (faceta: string) => void;
  readonly aoAbrir: (patientId: string) => void;
  readonly aoCriar?: () => void;
}

export function PacientesSkeleton() {
  return (
    <div className="space-y-4 p-1" data-testid="pacientes-skeleton">
      <Skeleton variant="card" height="112px" className="rounded-[22px]" />
      <div className="space-y-2">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} variant="table-row" height="66px" />)}</div>
    </div>
  );
}

function EstadoVazio({ busca, aoCriar }: { readonly busca: string; readonly aoCriar?: () => void }) {
  return (
    <div className="cadencia-panel flex min-h-[360px] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="cadencia-icon-orb mb-4 h-16 w-16"><UserCircle size={30} weight="duotone" /></div>
      <p className="m-0 text-lg font-semibold tracking-[-.025em] text-text">Nenhum paciente encontrado</p>
      <p className="mt-1 max-w-sm text-sm text-text-muted">{busca ? `Nenhum resultado para "${busca}"` : 'Adicione seu primeiro paciente'}</p>
      {!busca && aoCriar && <Botao variante="primario" className="mt-5" iconeEsquerda={Plus} onClick={aoCriar}>Novo paciente</Botao>}
    </div>
  );
}

export function Pacientes(p: PacientesProps) {
  const [busca, setBusca] = useState('');
  const [itens, setItens] = useState<PacienteHit[] | null>(null);
  const buscaDebounced = useDebounce(busca, 300);

  useEffect(() => {
    let ativo = true;
    setItens(null);
    void p.buscar(buscaDebounced, p.faceta).then((resultado) => { if (ativo) setItens(resultado); });
    return () => { ativo = false; };
  }, [buscaDebounced, p.faceta, p.buscar]);

  const carregando = itens === null;
  const pacientesFiltrados = useMemo(() => itens ?? [], [itens]);
  const contagem = itens?.length ?? 0;
  const preliminares = itens?.filter((item) => item.cadastroStatus === 'preliminar').length ?? 0;
  const facetaAtual = FACETAS.find((f) => f.chave === p.faceta)?.rotulo ?? p.faceta;

  return (
    <div className="cadencia-page space-y-6">
      <PageHeader
        titulo="Pacientes"
        subtitulo={carregando ? 'Seu diretório clínico, organizado para encontrar contexto em segundos.' : `${contagem} paciente${contagem !== 1 ? 's' : ''} · ${facetaAtual}`}
        semBreadcrumb
        {...(p.aoCriar ? { acoes: <Botao variante="primario" iconeEsquerda={Plus} onClick={p.aoCriar}>Novo paciente</Botao> } : {})}
      />

      <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="cadencia-panel cadencia-panel-hero p-4 sm:p-5" aria-label="Busca e filtros de pacientes">
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_auto] lg:items-center">
          <Campo
            prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
            placeholder="Buscar por nome, CPF ou telefone..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full"
            aria-label="Buscar pacientes"
          />
          <div className="flex items-center gap-2 text-xs text-text-muted max-lg:hidden">
            <FunnelSimple size={15} /> filtros salvos para sua rotina
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1" role="tablist" aria-label="Filtros de pacientes">
          {FACETAS.map((f) => (
            <button
              key={f.chave} type="button" role="tab" aria-selected={p.faceta === f.chave}
              onClick={() => p.aoMudarFaceta(f.chave)}
              className={cn(
                'whitespace-nowrap rounded-[11px] border px-3 py-2 text-xs font-semibold transition-all-fast',
                p.faceta === f.chave
                  ? 'border-accent/25 bg-accent text-accent-on shadow-[0_8px_20px_color-mix(in_oklab,var(--accent)_18%,transparent)]'
                  : 'border-line/80 bg-surface/70 text-text-muted hover:border-line-strong hover:bg-surface hover:text-text',
              )}
            >{f.rotulo}</button>
          ))}
        </div>
      </motion.section>

      {!carregando && contagem > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Resumo da lista">
          <div className="cadencia-metric p-4"><div className="flex items-center gap-2 text-text-muted"><UsersThree size={16} /><span className="text-[10px] font-bold uppercase tracking-[.1em]">Resultados</span></div><strong className="mt-2 block text-2xl font-semibold tracking-[-.05em] tabular-nums">{contagem}</strong></div>
          <div className="cadencia-metric p-4"><div className="flex items-center gap-2 text-text-muted"><IdentificationCard size={16} /><span className="text-[10px] font-bold uppercase tracking-[.1em]">Cadastros a completar</span></div><strong className="mt-2 block text-2xl font-semibold tracking-[-.05em] tabular-nums">{preliminares}</strong></div>
        </div>
      )}

      {carregando ? (
        <PacientesSkeleton />
      ) : pacientesFiltrados.length === 0 ? (
        <EstadoVazio busca={busca} {...(p.aoCriar ? { aoCriar: p.aoCriar } : {})} />
      ) : (
        <div className="cadencia-data-grid">
          <div className="hidden grid-cols-[minmax(0,1fr)_150px_160px_40px] gap-4 border-b border-line/70 bg-surface-sunken/45 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.1em] text-text-faint md:grid">
            <span>Paciente</span><span>Nascimento</span><span>Contato</span><span />
          </div>
          <ul className="m-0 list-none p-0" aria-label="Lista de pacientes">
            {pacientesFiltrados.map((pac, index) => (
              <motion.li
                key={pac.patientId}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * .025, .18) }}
                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 68px' }}
              >
                <button
                  type="button" onClick={() => p.aoAbrir(pac.patientId)}
                  className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line/65 px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent md:grid-cols-[auto_minmax(0,1fr)_150px_160px_40px] md:gap-4"
                >
                  <div className="cadencia-icon-orb h-10 w-10 shrink-0 text-sm font-bold" aria-hidden>{iniciais(pac.displayName)}</div>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-text">{pac.displayName}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {pac.cadastroStatus === 'preliminar' && <span className="rounded-full border border-warn/15 bg-warn-soft px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.06em] text-warn">preliminar</span>}
                      <span className="text-[10px] text-text-faint md:hidden">{pac.phonePrimary ?? 'Sem telefone'}</span>
                    </div>
                  </div>
                  <span className="hidden text-xs tabular-nums text-text-muted md:block">{pac.birthDate ? formatarData(pac.birthDate) : '—'}</span>
                  <span className="hidden truncate text-xs text-text-muted md:block">{pac.phonePrimary ?? '—'}</span>
                  <span className="grid h-8 w-8 place-items-center rounded-lg text-text-faint transition-all group-hover:translate-x-0.5 group-hover:bg-accent-soft group-hover:text-accent"><ArrowRight size={15} /></span>
                </button>
              </motion.li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
