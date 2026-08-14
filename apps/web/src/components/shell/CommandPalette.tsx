'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CalendarBlank,
  CreditCard,
  MagnifyingGlass,
  Money,
  Pill,
  Plus,
  Receipt,
  SpinnerGap,
  Stethoscope,
  Table,
  User,
  Users,
  Wallet,
  X,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { apiFetch } from '../../api';
import { useDebounce } from '../../lib/hooks';
import { cn } from '../../lib/cn';
import { useSessao } from '../../sessao';
import { indiceDeNavegacao } from '../../ui/nav';
import type { PacienteHit } from '../../ui/ComboboxDePaciente';

interface CommandItem {
  readonly id: string;
  readonly label: string;
  readonly meta: string;
  readonly href: string;
  readonly icon: PhosphorIcon;
  readonly atalho?: string;
  readonly categoria: 'acao' | 'tela' | 'paciente' | 'catalogo';
}

const ACOES: readonly CommandItem[] = [
  { id: 'novo-atendimento', label: 'Novo atendimento', meta: 'Agendar ou iniciar um atendimento', href: '/agenda?novo=1', icon: Plus, atalho: 'n', categoria: 'acao' },
  { id: 'registrar-pagamento', label: 'Registrar pagamento', meta: 'Lançar recebimento no caixa', href: '/financeiro/recebimentos', icon: CreditCard, atalho: 'p', categoria: 'acao' },
  { id: 'lancar-despesa', label: 'A pagar', meta: 'Abrir despesas e compromissos', href: '/financeiro/a-pagar', icon: Money, atalho: 'd', categoria: 'acao' },
  { id: 'abrir-agenda', label: 'Abrir agenda', meta: 'Visualizar horários da unidade', href: '/agenda', icon: CalendarBlank, atalho: 'g a', categoria: 'acao' },
  { id: 'hoje', label: 'Ir para Hoje', meta: 'Painel operacional do dia', href: '/hoje', icon: Stethoscope, atalho: 'g h', categoria: 'acao' },
  { id: 'caixa', label: 'Caixa do dia', meta: 'Visualizar entradas e saídas', href: '/financeiro/caixa', icon: Wallet, atalho: 'g f c', categoria: 'acao' },
  { id: 'a-receber', label: 'A receber', meta: 'Lista de recebíveis', href: '/financeiro/a-receber', icon: Receipt, atalho: 'g f r', categoria: 'acao' },
  { id: 'lista-pacientes', label: 'Lista de pacientes', meta: 'Buscar e gerenciar pacientes', href: '/pacientes', icon: Users, atalho: 'g p', categoria: 'acao' },
  { id: 'convenios', label: 'Convênios', meta: 'Operadoras, guias e lotes', href: '/convenios', icon: Stethoscope, atalho: 'g o', categoria: 'acao' },
  { id: 'config-equipe', label: 'Equipe', meta: 'Gerenciar usuários e papéis', href: '/configuracoes/equipe', icon: Users, atalho: 'g c e', categoria: 'acao' },
  { id: 'explorar', label: 'Explorar dados', meta: 'Consultas livres e relatórios', href: '/explorar', icon: MagnifyingGlass, atalho: 'g e', categoria: 'acao' },
];

const TELAS: readonly CommandItem[] = indiceDeNavegacao().map((item) => ({
  id: item.id,
  label: item.rotulo,
  meta: item.descricao ?? 'Abrir tela',
  href: item.href,
  icon: MagnifyingGlass,
  categoria: 'tela',
}));

function catalogos(termo: string): readonly CommandItem[] {
  const q = termo.trim();
  const sufixo = q ? `?q=${encodeURIComponent(q)}` : '';
  const meta = (nome: string) => q ? `Pesquisar “${q}” em ${nome}` : `Abrir catálogo ${nome}`;
  return [
    { id: 'catalogo-cid10', label: 'CID-10', meta: meta('CID-10'), href: `/catalogos/cid10${sufixo}`, icon: Table, categoria: 'catalogo' },
    { id: 'catalogo-cid11', label: 'CID-11', meta: meta('CID-11'), href: `/catalogos/cid11${sufixo}`, icon: Table, categoria: 'catalogo' },
    { id: 'catalogo-tuss', label: 'TUSS', meta: meta('TUSS'), href: `/catalogos/tuss${sufixo}`, icon: Table, categoria: 'catalogo' },
    { id: 'catalogo-bulas', label: 'Bulário', meta: q ? `Pesquisar “${q}” no bulário` : 'Consultar medicamentos e bulas', href: `/bulas${sufixo}`, icon: Pill, categoria: 'catalogo' },
  ];
}

function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function corresponde(label: string, busca: string): boolean {
  if (!busca) return true;
  const palavras = normalizar(busca).split(/\s+/);
  const alvo = normalizar(label);
  return palavras.every((palavra) => alvo.includes(palavra));
}

type Categoria = 'acao' | 'tela' | 'paciente' | 'catalogo';

export function CommandPalette({ open, onOpenChange }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { clinicId, csrfToken } = useSessao();
  const [query, setQuery] = useState('');
  const [pacientes, setPacientes] = useState<readonly PacienteHit[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const termo = useDebounce(query.trim(), 120);
  const geracao = useRef(0);

  useEffect(() => {
    if (!open || termo.length < 2 || termo.startsWith('#') || termo.startsWith('$') || termo.startsWith('>')) {
      setPacientes([]);
      setCarregando(false);
      return;
    }
    const atual = ++geracao.current;
    setCarregando(true);
    void apiFetch<{ itens: PacienteHit[] }>(
      `/v1/pacientes?termo=${encodeURIComponent(termo.replace(/^[@$]/, ''))}`,
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
    const original = query.trim();
    const prefixo = original[0];
    const busca = prefixo === '@' || prefixo === '#' || prefixo === '$' || prefixo === '>' ? original.slice(1).trim() : original;
    const modo: Categoria | 'todos' = prefixo === '@' ? 'paciente' : prefixo === '#' ? 'catalogo' : prefixo === '$' ? 'acao' : prefixo === '>' ? 'tela' : 'todos';
    const resultado: { label: string; items: readonly CommandItem[] }[] = [];

    if ((modo === 'todos' || modo === 'paciente') && pacientes.length > 0) {
      resultado.push({
        label: 'Pacientes',
        items: pacientes.map((paciente) => ({
          id: `paciente-${paciente.patientId}`,
          label: paciente.displayName,
          meta: [paciente.phonePrimary, paciente.cadastroStatus === 'preliminar' ? 'Cadastro preliminar' : null].filter(Boolean).join(' · ') || 'Cadastro completo',
          href: `/pacientes/${paciente.patientId}`,
          icon: User,
          categoria: 'paciente' as const,
        })),
      });
    }

    if (modo === 'catalogo') resultado.push({ label: 'Catálogos', items: catalogos(busca) });

    if (modo === 'todos' || modo === 'acao') {
      const itens = ACOES.filter((acao) => corresponde(`${acao.label} ${acao.meta} ${acao.atalho ?? ''}`, busca));
      if (itens.length > 0) resultado.push({ label: 'Ações', items: itens.slice(0, 8) });
    }

    if (modo === 'todos' || modo === 'tela') {
      const itens = TELAS.filter((tela) => corresponde(`${tela.label} ${tela.meta}`, busca));
      if (itens.length > 0) resultado.push({ label: 'Telas', items: itens.slice(0, busca ? 10 : 6) });
    }

    return resultado;
  }, [pacientes, query]);

  const flatItems = useMemo(() => grupos.flatMap((grupo) => grupo.items), [grupos]);

  useEffect(() => { setSelectedIndex(0); }, [query, open]);
  useEffect(() => {
    if (flatItems.length === 0) return;
    const index = Math.min(selectedIndex, flatItems.length - 1);
    document.getElementById(`cmd-option-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [flatItems.length, selectedIndex]);

  function select(href: string) {
    onOpenChange(false);
    setQuery('');
    setPacientes([]);
    router.push(href);
  }

  const placeholder = query.startsWith('@') ? 'Buscar paciente (@nome, @cpf, @telefone)…'
    : query.startsWith('#') ? 'Pesquisar em catálogos (#tosse, #vacina, #dipirona)…'
    : query.startsWith('$') ? 'Ação rápida ($pagamento, $despesa)…'
    : query.startsWith('>') ? 'Ir para tela (>agenda, >caixa)…'
    : 'Buscar paciente, tela ou comando…';

  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      onOpenChange(next);
      if (!next) { setQuery(''); setPacientes([]); }
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[79] bg-[#06161c]/45 backdrop-blur-[7px] data-[state=open]:animate-[fadeIn_180ms_ease-out]" />
        <Dialog.Content className="fixed left-1/2 top-[10vh] z-[80] w-[min(680px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[20px] border border-white/55 bg-surface/95 shadow-elev-3 backdrop-blur-xl data-[state=open]:animate-[commandIn_220ms_var(--ease-out)]">
          <Dialog.Title className="sr-only">Busca global e comandos</Dialog.Title>
          <Dialog.Description className="sr-only">Busque pacientes, execute ações, consulte catálogos ou navegue pelo sistema.</Dialog.Description>

          <div className="flex h-16 items-center gap-3 border-b border-line px-4 sm:px-5">
            {carregando ? <SpinnerGap size={20} className="animate-spin text-accent" aria-label="Buscando" /> : <MagnifyingGlass size={20} className="text-accent" aria-hidden />}
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex((value) => flatItems.length === 0 ? 0 : (value + 1) % flatItems.length); }
                if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex((value) => flatItems.length === 0 ? 0 : (value - 1 + flatItems.length) % flatItems.length); }
                if (event.key === 'Enter' && flatItems[selectedIndex]) { event.preventDefault(); select(flatItems[selectedIndex].href); }
              }}
              placeholder={placeholder}
              aria-label="Buscar paciente ou executar ação"
              aria-autocomplete="list"
              aria-controls="command-listbox"
              aria-activedescendant={flatItems[selectedIndex] ? `cmd-option-${selectedIndex}` : undefined}
              role="combobox"
              aria-expanded={flatItems.length > 0}
              className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-text outline-none placeholder:text-text-faint"
            />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca" className="grid size-8 place-items-center rounded-lg text-text-faint hover:bg-surface-subtle hover:text-text"><X size={15} aria-hidden /></button> : null}
            {/* No desktop a dica de tecla basta. No celular nao ha Esc, e o
                unico jeito de sair era tocar no overlay acima do painel — algo
                que ninguem descobre. Como esta e a UNICA busca do app no
                mobile, entrar sem saber sair e um beco. */}
            <Dialog.Close className="hidden rounded-md border border-line bg-surface-subtle px-2 py-1 text-[10px] font-semibold text-text-faint sm:block">Esc</Dialog.Close>
            <Dialog.Close
              aria-label="Fechar busca"
              className="grid size-11 shrink-0 place-items-center rounded-lg text-text-faint hover:bg-surface-subtle hover:text-text sm:hidden"
            >
              <X size={20} aria-hidden />
            </Dialog.Close>
          </div>

          <div id="command-listbox" role="listbox" aria-label="Resultados da busca" className="max-h-[62dvh] overflow-y-auto p-2.5 scrollbar-thin max-md:max-h-[46dvh]">
            {grupos.length === 0 ? (
              <div className="px-5 py-14 text-center"><p className="font-bold text-text">Nenhum resultado</p><p className="mt-1 text-sm text-text-muted">Experimente <kbd className="rounded bg-surface-subtle px-1.5 py-0.5">@</kbd> pacientes, <kbd className="rounded bg-surface-subtle px-1.5 py-0.5">$</kbd> ações, <kbd className="rounded bg-surface-subtle px-1.5 py-0.5">#</kbd> catálogos ou <kbd className="rounded bg-surface-subtle px-1.5 py-0.5">&gt;</kbd> telas.</p></div>
            ) : (() => {
              let optionIndex = 0;
              return grupos.map((grupo) => (
                <section key={grupo.label} aria-labelledby={`cmd-${grupo.label}`} className="mb-2 last:mb-0">
                  <h2 id={`cmd-${grupo.label}`} className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[.09em] text-text-faint">{grupo.label}</h2>
                  {grupo.items.map((item) => {
                    const index = optionIndex++;
                    const Icon = item.icon;
                    const active = index === selectedIndex;
                    return (
                      <button
                        id={`cmd-option-${index}`}
                        key={`${grupo.label}-${item.id}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => select(item.href)}
                        className={cn('group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all-fast', active ? 'bg-accent-soft text-accent' : 'text-text hover:bg-surface-subtle')}
                      >
                        <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl border transition-all-fast', active ? 'border-accent/15 bg-surface text-accent shadow-elev-1' : 'border-line bg-surface-subtle text-text-faint group-hover:text-accent')}><Icon size={17} weight={active ? 'duotone' : 'regular'} aria-hidden /></span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold tracking-[-0.01em]">{item.label}</span><span className={cn('block truncate text-xs', active ? 'text-accent/75' : 'text-text-muted')}>{item.meta}</span></span>
                        {item.atalho ? <kbd className="shrink-0 rounded-md border border-line bg-surface px-1.5 py-1 text-[10px] font-semibold text-text-faint">{item.atalho}</kbd> : null}
                      </button>
                    );
                  })}
                </section>
              ));
            })()}
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-line bg-surface-subtle/80 px-4 py-2.5 text-[10px] font-medium text-text-faint sm:px-5">
            <div className="flex flex-wrap gap-3"><span><kbd className="cadencia-command-key mr-1">↑↓</kbd> navegar</span><span><kbd className="cadencia-command-key mr-1">↵</kbd> abrir</span></div>
            <div className="hidden gap-1.5 sm:flex"><span className="cadencia-command-key">@</span><span className="cadencia-command-key">#</span><span className="cadencia-command-key">$</span><span className="cadencia-command-key">&gt;</span></div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
