'use client';

import { useEffect, useMemo, useState } from 'react';
import { useEstadoNaUrl } from '../hooks/useEstadoNaUrl';
import {
  CaretRight,
  MagnifyingGlass,
  Plus,
  UserCircle,
  UsersThree,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { useDebounce } from '../lib/hooks';
import { Campo } from '../ui/Campo';
import { Icone } from '../ui/Icone';
import { Botao } from '../ui/Botao';
import { Skeleton } from '../ui/Skeleton';
import { PageHeader } from '../ui/PageHeader';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

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

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0];
  if (!primeira) return '?';
  const ultima = partes[partes.length - 1];
  if (partes.length === 1 || !ultima) return primeira.charAt(0).toUpperCase();
  return (primeira.charAt(0) + ultima.charAt(0)).toUpperCase();
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

function idadeEmAnos(iso: string): number | null {
  const nascimento = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(nascimento.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getUTCFullYear() - nascimento.getUTCFullYear();
  const antesDoAniversario = hoje.getUTCMonth() < nascimento.getUTCMonth()
    || (hoje.getUTCMonth() === nascimento.getUTCMonth() && hoje.getUTCDate() < nascimento.getUTCDate());
  if (antesDoAniversario) idade -= 1;
  return idade;
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
    <div className="cadencia-table-shell" data-testid="pacientes-skeleton">
      <div className="grid grid-cols-[minmax(240px,1.4fr)_180px_180px_150px] gap-4 border-b border-line bg-surface-subtle px-5 py-3 max-md:hidden">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="text" width={i === 0 ? '140px' : '90px'} />)}
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-b-0">
          <Skeleton variant="avatar" />
          <div className="flex-1 space-y-1"><Skeleton variant="text" width="36%" /><Skeleton variant="text" width="24%" /></div>
          <Skeleton variant="text" width="100px" className="max-md:hidden" />
          <Skeleton variant="text" width="100px" className="max-md:hidden" />
        </div>
      ))}
    </div>
  );
}

function EstadoVazio({ busca, aoCriar }: { readonly busca: string; readonly aoCriar?: () => void }) {
  return (
    <div className="cadencia-surface flex min-h-[360px] flex-col items-center justify-center px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <UserCircle size={30} aria-hidden />
      </span>
      <p className="mt-4 text-base font-semibold text-text">Nenhum paciente encontrado</p>
      <p className="mt-1 max-w-md text-sm text-text-muted">
        {busca ? `Nenhum resultado para “${busca}”. Tente nome, CPF ou telefone.` : 'Não há pacientes nesta visualização.'}
      </p>
      {!busca && aoCriar ? <Botao className="mt-5" iconeEsquerda={Plus} onClick={aoCriar}>Novo paciente</Botao> : null}
    </div>
  );
}

function IdentidadePaciente({ paciente }: { readonly paciente: PacienteHit }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-sm font-bold text-accent ring-1 ring-accent/10">
        {iniciais(paciente.displayName)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-text">{paciente.displayName}</span>
        {paciente.hasSocialName && paciente.legalName !== paciente.displayName ? (
          <span className="block truncate text-xs text-text-faint">Registro: {paciente.legalName}</span>
        ) : (
          <span className="block truncate text-xs text-text-faint">Prontuário ativo</span>
        )}
      </span>
    </div>
  );
}

export function Pacientes(p: PacientesProps) {
  const [busca, setBusca] = useEstadoNaUrl('busca');
  const [itens, setItens] = useState<PacienteHit[] | null>(null);
  const [erro, setErro] = useState(false);
  const buscaDebounced = useDebounce(busca, 250);

  useEffect(() => {
    let ativo = true;
    setItens(null);
    setErro(false);
    void p.buscar(buscaDebounced, p.faceta)
      .then((resultado) => { if (ativo) setItens(resultado); })
      .catch(() => { if (ativo) { setItens([]); setErro(true); } });
    return () => { ativo = false; };
  }, [buscaDebounced, p.faceta, p.buscar]);

  const pacientes = useMemo(() => itens ?? [], [itens]);
  const carregando = itens === null;
  const contagem = itens?.length ?? 0;

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="Pacientes"
        eyebrow="Base clínica"
        subtitulo={carregando ? 'Localize pessoas e retome o contexto clínico sem perder o fluxo.' : `${contagem} paciente${contagem !== 1 ? 's' : ''} nesta visualização`}
        semBreadcrumb
        {...(p.aoCriar ? { acoes: <Botao iconeEsquerda={Plus} onClick={p.aoCriar}>Novo paciente</Botao> } : {})}
      />

      <section className="cadencia-surface overflow-hidden" aria-label="Diretório de pacientes">
        <div className="flex flex-col gap-4 border-b border-line p-4 sm:p-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <Campo
              prefixo={<Icone icon={MagnifyingGlass} size="sm" />}
              placeholder="Buscar por nome, CPF ou telefone…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="max-w-xl"
              aria-label="Buscar pacientes"
            />
          </div>
          <div className="inline-flex items-center gap-2 text-xs text-text-faint">
            <UsersThree size={16} aria-hidden />
            <span>Busca na unidade ativa</span>
          </div>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface-subtle px-3 py-2 scrollbar-thin" role="tablist" aria-label="Filtros de pacientes">
          {FACETAS.map((f) => (
            <button
              key={f.chave}
              type="button"
              role="tab"
              aria-selected={p.faceta === f.chave}
              onClick={() => p.aoMudarFaceta(f.chave)}
              className={cn(
                'whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors-fast',
                p.faceta === f.chave
                  ? 'bg-surface text-accent shadow-elev-1'
                  : 'text-text-muted hover:bg-surface hover:text-text',
              )}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        {erro ? (
          <div role="alert" className="border-b border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
            Não foi possível atualizar a lista. Tente novamente alterando a busca ou o filtro.
          </div>
        ) : null}

        {carregando ? (
          <PacientesSkeleton />
        ) : pacientes.length === 0 ? (
          <div className="p-4 sm:p-5"><EstadoVazio busca={busca} {...(p.aoCriar ? { aoCriar: p.aoCriar } : {})} /></div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(240px,1.4fr)_180px_minmax(160px,1fr)_150px_28px] gap-4 border-b border-line bg-surface-subtle px-5 py-2.5 text-[10px] font-bold uppercase tracking-[.07em] text-text-faint md:grid">
              <span>Paciente</span><span>Nascimento</span><span>Contato</span><span>Cadastro</span><span><span className="sr-only">Abrir</span></span>
            </div>
            <ul className="m-0 list-none p-0" aria-label="Lista de pacientes">
              {pacientes.map((pac) => {
                const idade = pac.birthDate ? idadeEmAnos(pac.birthDate) : null;
                return (
                  <li key={pac.patientId} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 68px' }}>
                    <button
                      type="button"
                      onClick={() => p.aoAbrir(pac.patientId)}
                      className="group grid w-full gap-2 border-b border-line px-4 py-3.5 text-left transition-colors-fast last:border-b-0 hover:bg-surface-hover focus-visible:outline-offset-[-2px] md:grid-cols-[minmax(240px,1.4fr)_180px_minmax(160px,1fr)_150px_28px] md:items-center md:gap-4 md:px-5"
                    >
                      <IdentidadePaciente paciente={pac} />

                      <span className="flex items-center justify-between gap-4 md:block">
                        <span className="text-xs text-text-faint md:hidden">Nascimento</span>
                        <span className="text-sm text-text-muted tabular-nums">
                          {pac.birthDate ? `${formatarData(pac.birthDate)}${idade !== null ? ` · ${idade} anos` : ''}` : 'Não informado'}
                        </span>
                      </span>

                      <span className="flex items-center justify-between gap-4 md:block">
                        <span className="text-xs text-text-faint md:hidden">Contato</span>
                        <span className="text-sm text-text-muted">{pac.phonePrimary ?? 'Sem telefone'}</span>
                      </span>

                      <span className="flex items-center justify-between gap-4 md:block">
                        <span className="text-xs text-text-faint md:hidden">Cadastro</span>
                        <span className={cn(
                          'inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                          pac.cadastroStatus === 'completo'
                            ? 'border-ok/15 bg-ok-soft text-ok'
                            : 'border-warn/15 bg-warn-soft text-warn',
                        )}>
                          {pac.cadastroStatus === 'completo' ? 'Completo' : 'Preliminar'}
                        </span>
                      </span>

                      <CaretRight size={17} className="hidden text-text-faint transition-transform-fast group-hover:translate-x-0.5 group-hover:text-accent md:block" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
