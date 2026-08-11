'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CalendarBlank,
  CreditCard,
  MagnifyingGlass,
  Plus,
  SpinnerGap,
  User,
  X,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { apiFetch } from '../../api';
import { useDebounce } from '../../lib/hooks';
import { useSessao } from '../../sessao';
import { indiceDeNavegacao } from '../../ui/nav';
import type { PacienteHit } from '../../ui/ComboboxDePaciente';

interface CommandItem {
  readonly id: string;
  readonly label: string;
  readonly meta: string;
  readonly href: string;
  readonly icon: PhosphorIcon;
}

const ACOES: readonly CommandItem[] = [
  { id: 'novo-atendimento', label: 'Novo atendimento', meta: 'Agendar ou iniciar um atendimento', href: '/agenda?novo=1', icon: Plus },
  { id: 'registrar-pagamento', label: 'Registrar pagamento', meta: 'Abrir recebimentos', href: '/financeiro/recebimentos', icon: CreditCard },
  { id: 'abrir-agenda', label: 'Abrir agenda', meta: 'Visualizar horários da unidade', href: '/agenda', icon: CalendarBlank },
];

const TELAS: readonly CommandItem[] = indiceDeNavegacao().map((item) => ({
  id: item.id,
  label: item.rotulo,
  meta: item.descricao ?? 'Abrir tela',
  href: item.href,
  icon: MagnifyingGlass,
}));

function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function CommandPalette({ open, onOpenChange }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { clinicId, csrfToken } = useSessao();
  const [query, setQuery] = useState('');
  const [pacientes, setPacientes] = useState<readonly PacienteHit[]>([]);
  const [carregando, setCarregando] = useState(false);
  const termo = useDebounce(query.trim(), 140);
  const geracao = useRef(0);

  useEffect(() => {
    if (!open || termo.length < 2) {
      setPacientes([]);
      setCarregando(false);
      return;
    }
    const atual = ++geracao.current;
    setCarregando(true);
    void apiFetch<{ itens: PacienteHit[] }>(
      `/v1/pacientes?termo=${encodeURIComponent(termo)}`,
      { clinicId, csrfToken },
    ).then((resposta) => {
      if (geracao.current === atual) setPacientes(resposta.itens.slice(0, 6));
    }).catch(() => {
      if (geracao.current === atual) setPacientes([]);
    }).finally(() => {
      if (geracao.current === atual) setCarregando(false);
    });
  }, [clinicId, csrfToken, open, termo]);

  const grupos = useMemo(() => {
    const busca = normalizar(query.trim());
    const filtrar = (itens: readonly CommandItem[]) => busca.length === 0
      ? itens
      : itens.filter((item) => normalizar(`${item.label} ${item.meta}`).includes(busca));
    const resultado: { label: string; items: readonly CommandItem[] }[] = [];
    if (pacientes.length > 0) {
      resultado.push({
        label: 'Pacientes',
        items: pacientes.map((paciente) => ({
          id: paciente.patientId,
          label: paciente.displayName,
          meta: [paciente.phonePrimary, paciente.cadastroStatus === 'preliminar' ? 'Cadastro preliminar' : null].filter(Boolean).join(' · ') || 'Cadastro completo',
          href: `/pacientes/${paciente.patientId}`,
          icon: User,
        })),
      });
    }
    const acoes = filtrar(ACOES);
    const telas = filtrar(TELAS);
    if (acoes.length > 0) resultado.push({ label: 'Ações', items: acoes });
    if (telas.length > 0) resultado.push({ label: 'Telas', items: telas.slice(0, busca ? 10 : 6) });
    return resultado;
  }, [pacientes, query]);

  function select(href: string) {
    onOpenChange(false);
    setQuery('');
    setPacientes([]);
    router.push(href);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery('');
          setPacientes([]);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[79] bg-text/20 data-[state=open]:animate-[fadeIn_160ms_ease-out]" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-[80] w-[min(620px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-elev-3 data-[state=open]:animate-[scaleIn_160ms_var(--ease-out)]">
          <Dialog.Title className="sr-only">Busca global e comandos</Dialog.Title>
          <Dialog.Description className="sr-only">Busque pacientes reais, ações ou telas do Cadencia.</Dialog.Description>
          <div className="flex h-14 items-center gap-3 border-b border-line px-4">
            {carregando ? <SpinnerGap size={19} className="animate-spin text-text-faint" aria-label="Buscando pacientes" /> : <MagnifyingGlass size={19} className="text-text-faint" aria-hidden />}
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar paciente ou executar ação..."
              aria-label="Buscar paciente ou executar ação"
              className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
            />
            <Dialog.Close asChild>
              <button type="button" aria-label="Fechar busca" className="grid size-8 place-items-center rounded-lg text-text-faint hover:bg-surface-subtle hover:text-text">
                <X size={17} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
            {grupos.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="font-semibold text-text">Nenhum resultado encontrado</p>
                <p className="mt-1 text-sm text-text-muted">Confira o nome ou busque por outra ação.</p>
              </div>
            ) : grupos.map((grupo) => (
              <section key={grupo.label} aria-labelledby={`command-${grupo.label}`} className="mb-2 last:mb-0">
                <h2 id={`command-${grupo.label}`} className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[.08em] text-text-faint">{grupo.label}</h2>
                {grupo.items.map((item) => {
                  const Icone = item.icon;
                  return (
                    <button
                      key={`${grupo.label}-${item.id}`}
                      type="button"
                      onClick={() => select(item.href)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors-fast hover:bg-surface-subtle focus-visible:bg-surface-subtle"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Icone size={16} aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text">{item.label}</span>
                        <span className="block truncate text-xs text-text-muted">{item.meta}</span>
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-line bg-surface-subtle px-4 py-2.5 text-[11px] text-text-faint">
            <span>Tab para navegar · Enter para abrir</span><span>Esc para fechar</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
