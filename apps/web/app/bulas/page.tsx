'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { FileText, MagnifyingGlass, Pill, ShieldCheck, X } from '@phosphor-icons/react';
import { ApiError, apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';
import { cn } from '../../src/lib/cn';
import { PageHeader } from '../../src/ui/PageHeader';
import { EstadoVazio } from '../../src/ui/EstadoVazio';
import { Skeleton } from '../../src/ui/Skeleton';

interface Drug {
  id: string;
  registroAnvisa: string;
  nome: string;
  principioAtivo: string;
  classeTerapeutica: string | null;
  concentracao: string | null;
  formaFarmaceutica: string | null;
  fabricante: string | null;
}

interface Leaflet {
  id: string;
  tipo: 'paciente' | 'profissional';
  conteudo: string;
  versao: string | null;
  dataPublicacao?: string | null;
}

export default function BulasPage() {
  const { clinicId, csrfToken } = useSessao();
  const [query, setQuery] = useState('');
  const [selectedDrug, setSelectedDrug] = useState<Drug | null>(null);
  const [leafletType, setLeafletType] = useState<'paciente' | 'profissional'>('paciente');
  const termo = query.trim();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')?.trim();
    if (q) setQuery(q);
  }, []);

  const { data: results = [], isLoading, isError } = useQuery({
    queryKey: ['drugs-search', clinicId, termo],
    queryFn: async () => {
      const data = await apiFetch<{ itens: Drug[] }>(
        `/v1/drugs/search?q=${encodeURIComponent(termo)}`,
        { clinicId, csrfToken },
      );
      return data.itens;
    },
    enabled: termo.length >= 2,
    staleTime: 60_000,
  });

  const { data: leaflet, isLoading: leafletLoading } = useQuery({
    queryKey: ['leaflet', clinicId, selectedDrug?.id, leafletType],
    queryFn: async () => {
      if (!selectedDrug) return null;
      try {
        return await apiFetch<Leaflet>(
          `/v1/drugs/${selectedDrug.id}/leaflet?tipo=${leafletType}`,
          { clinicId, csrfToken },
        );
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
    enabled: selectedDrug !== null,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="cadencia-page space-y-7">
      <PageHeader
        titulo="Bulário"
        eyebrow="Conhecimento clínico"
        subtitulo="Consulte medicamentos e bulas oficiais sem sair do fluxo de atendimento."
        semBreadcrumb
      />

      <section className="cadencia-hero-panel overflow-hidden p-5 sm:p-6" aria-label="Buscar no bulário">
        <div className="relative z-10 max-w-3xl">
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-text-muted">
            <ShieldCheck size={16} className="text-accent" aria-hidden />
            <span>Base medicamentosa da unidade</span>
          </div>
          <label className="relative block">
            <span className="sr-only">Buscar por medicamento ou princípio ativo</span>
            <MagnifyingGlass size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-faint" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Busque por nome ou princípio ativo…"
              className="h-12 w-full rounded-xl border border-line bg-surface/95 pl-12 pr-4 text-[15px] text-text shadow-elev-1 outline-none transition-all-fast placeholder:text-text-faint hover:border-line-strong focus:border-accent focus:ring-4 focus:ring-accent-soft"
            />
          </label>
          <p className="mt-2 text-xs text-text-faint">Digite ao menos 2 caracteres. Ex.: amoxicilina, dipirona.</p>
        </div>
      </section>

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2" aria-label="Buscando medicamentos">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} variant="card" className="h-[116px] rounded-2xl" />)}
        </div>
      ) : null}

      {isError ? (
        <EstadoVazio
          icone={Pill}
          titulo="Não foi possível consultar o bulário"
          descricao="Verifique sua conexão e tente novamente."
        />
      ) : null}

      {!isLoading && !isError && termo.length >= 2 && results.length === 0 ? (
        <EstadoVazio
          icone={Pill}
          titulo="Nenhum medicamento encontrado"
          descricao="Tente outro nome comercial, princípio ativo ou uma busca mais curta."
        />
      ) : null}

      {results.length > 0 ? (
        <section aria-label={`${results.length} medicamentos encontrados`} className="grid gap-3 lg:grid-cols-2">
          {results.map((drug) => (
            <button
              key={drug.id}
              type="button"
              onClick={() => setSelectedDrug(drug)}
              className="cadencia-card cadencia-card-interactive group flex min-h-[116px] items-start gap-4 p-4 text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <span className="cadencia-icon-orb size-10 shrink-0 transition-transform-fast group-hover:-translate-y-0.5">
                <Pill size={20} weight="duotone" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold tracking-[-0.02em] text-text">{drug.nome}</span>
                <span className="mt-0.5 block truncate text-sm text-text-muted">{drug.principioAtivo}</span>
                <span className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-text-faint">
                  {drug.concentracao ? <span className="rounded-full border border-line bg-surface-subtle px-2 py-1">{drug.concentracao}</span> : null}
                  {drug.formaFarmaceutica ? <span className="rounded-full border border-line bg-surface-subtle px-2 py-1">{drug.formaFarmaceutica}</span> : null}
                  {drug.classeTerapeutica ? <span className="rounded-full border border-accent/15 bg-accent-soft px-2 py-1 text-accent">{drug.classeTerapeutica}</span> : null}
                </span>
              </span>
            </button>
          ))}
        </section>
      ) : null}

      <Dialog.Root open={selectedDrug !== null} onOpenChange={(open) => { if (!open) setSelectedDrug(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[79] bg-[#07191f]/45 backdrop-blur-[6px] data-[state=open]:animate-[fadeIn_180ms_ease-out]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[80] flex max-h-[min(88vh,900px)] w-[min(920px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[20px] border border-white/60 bg-surface shadow-elev-3 data-[state=open]:animate-[scaleIn_180ms_var(--ease-out)]">
            <div className="flex items-start justify-between gap-5 border-b border-line bg-surface-subtle/70 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="cadencia-eyebrow mb-1">Bula do medicamento</p>
                <Dialog.Title className="truncate text-xl font-bold tracking-[-0.03em] text-text">{selectedDrug?.nome}</Dialog.Title>
                <Dialog.Description className="mt-1 truncate text-sm text-text-muted">{selectedDrug?.principioAtivo}</Dialog.Description>
              </div>
              <Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-lg text-text-muted transition-colors-fast hover:bg-surface-hover hover:text-text" aria-label="Fechar bula">
                <X size={18} aria-hidden />
              </Dialog.Close>
            </div>

            <div className="border-b border-line px-5 py-3 sm:px-6">
              <div className="inline-flex rounded-xl border border-line bg-surface-subtle p-1" role="group" aria-label="Tipo de bula">
                {(['paciente', 'profissional'] as const).map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    aria-pressed={leafletType === tipo}
                    onClick={() => setLeafletType(tipo)}
                    className={cn(
                      'rounded-lg px-3.5 py-2 text-xs font-semibold transition-all-fast',
                      leafletType === tipo ? 'bg-surface text-accent shadow-elev-1' : 'text-text-muted hover:text-text',
                    )}
                  >
                    {tipo === 'paciente' ? 'Bula do paciente' : 'Bula profissional'}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 scrollbar-thin sm:px-8 sm:py-7">
              {leafletLoading ? <Skeleton variant="text" lines={12} /> : null}
              {!leafletLoading && leaflet ? (
                <article className="mx-auto max-w-[760px] whitespace-pre-wrap font-[var(--font-ui)] text-sm leading-[1.78] text-text-secondary">
                  {leaflet.conteudo}
                </article>
              ) : null}
              {!leafletLoading && !leaflet ? (
                <EstadoVazio icone={FileText} titulo="Bula não disponível" descricao="Não há uma versão desse documento cadastrada para este medicamento." compacto />
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
