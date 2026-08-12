'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CalendarBlank,
  CreditCard,
  FileText,
  MagnifyingGlass,
  Money,
  NotePencil,
  Plus,
  Receipt,
  SpinnerGap,
  Stethoscope,
  User,
  Users,
  Wallet,
  X,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { apiFetch } from '../../api';
import { useDebounce } from '../../lib/hooks';
import { useSessao } from '../../sessao';
import { indiceDeNavegacao } from '../../ui/nav';
import type { PacienteHit } from '../../ui/ComboboxDePaciente';

/* ── tipos ──────────────────────────────────────────────────────── */

interface CommandItem {
  readonly id: string;
  readonly label: string;
  readonly meta: string;
  readonly href: string;
  readonly icon: PhosphorIcon;
  readonly atalho?: string;
  readonly categoria: 'acao' | 'tela' | 'paciente' | 'catalogo';
}

/* ── comandos de ação ──────────────────────────────────────────── */

const ACOES: readonly CommandItem[] = [
  // Operações principais
  { id: 'novo-atendimento', label: 'Novo atendimento', meta: 'Agendar ou iniciar um atendimento', href: '/agenda?novo=1', icon: Plus, atalho: 'n', categoria: 'acao' },
  { id: 'registrar-pagamento', label: 'Registrar pagamento', meta: 'Lançar recebimento no caixa', href: '/financeiro/recebimentos', icon: CreditCard, atalho: 'p', categoria: 'acao' },
  { id: 'lancar-despesa', label: 'Lançar despesa', meta: 'Registrar conta a pagar', href: '/financeiro/a-pagar/novo', icon: Money, atalho: 'd', categoria: 'acao' },
  { id: 'abrir-agenda', label: 'Abrir agenda', meta: 'Visualizar horários da unidade', href: '/agenda', icon: CalendarBlank, atalho: 'g a', categoria: 'acao' },
  { id: 'hoje', label: 'Ir para Hoje', meta: 'Dashboard do dia', href: '/hoje', icon: Stethoscope, atalho: 'g h', categoria: 'acao' },

  // Financeiro rápido
  { id: 'caixa', label: 'Caixa do dia', meta: 'Visualizar entradas e saídas', href: '/financeiro/caixa', icon: Wallet, atalho: 'g f c', categoria: 'acao' },
  { id: 'a-receber', label: 'Contas a receber', meta: 'Lista de recebíveis', href: '/financeiro/a-receber', icon: Receipt, atalho: 'g f r', categoria: 'acao' },

  // Cadastros
  { id: 'novo-paciente', label: 'Cadastrar paciente', meta: 'Criar novo registro', href: '/pacientes/novo', icon: User, atalho: 'g p n', categoria: 'acao' },
  { id: 'lista-pacientes', label: 'Lista de pacientes', meta: 'Buscar e gerenciar pacientes', href: '/pacientes', icon: Users, atalho: 'g p', categoria: 'acao' },

  // Documentos
  { id: 'novo-documento', label: 'Emitir documento', meta: 'Atestado, pedido, relatório', href: '/atendimentos/novo/documento', icon: FileText, atalho: 'g d', categoria: 'acao' },
  { id: 'prescricao', label: 'Nova prescrição', meta: 'Prescrever medicamentos', href: '/atendimentos/novo/prescricao', icon: NotePencil, atalho: 'g r', categoria: 'acao' },

  // Convênios
  { id: 'convenios', label: 'Convênios', meta: 'Operadoras, guias, lotes', href: '/convenios', icon: Stethoscope, atalho: 'g o', categoria: 'acao' },
  { id: 'glosas', label: 'Glosas', meta: 'Recursos e glosas pendentes', href: '/convenios/glosas', icon: X, categoria: 'acao' },

  // Configurações
  { id: 'config-equipe', label: 'Equipe', meta: 'Gerenciar usuários e papéis', href: '/configuracoes/equipe', icon: Users, atalho: 'g c e', categoria: 'acao' },
  { id: 'config-procedimentos', label: 'Procedimentos', meta: 'Catálogo de procedimentos', href: '/configuracoes/procedimentos', icon: FileText, atalho: 'g c p', categoria: 'acao' },

  // Explorar
  { id: 'explorar', label: 'Explorar dados', meta: 'Consultas livres e relatórios', href: '/explorar', icon: MagnifyingGlass, atalho: 'g e', categoria: 'acao' },
];

/* ── telas navegáveis ───────────────────────────────────────────── */

const TELAS: readonly CommandItem[] = indiceDeNavegacao().map((item) => ({
  id: item.id,
  label: item.rotulo,
  meta: item.descricao ?? 'Abrir tela',
  href: item.href,
  icon: MagnifyingGlass,
  categoria: 'tela',
}));

/* ── utilitários ──────────────────────────────────────────────── */

function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
}

function pontuar(label: string, busca: string): boolean {
  if (!busca) return true;
  const buscaNorm = normalizar(busca);
  const palavras = buscaNorm.split(/\s+/);
  const labelNorm = normalizar(label);
  return palavras.every((palavra) => labelNorm.includes(palavra));
}

type Categoria = 'acao' | 'tela' | 'paciente' | 'catalogo' | 'atalho';

export function CommandPalette({ open, onOpenChange }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { clinicId, csrfToken } = useSessao();
  const [query, setQuery] = useState('');
  const [pacientes, setPacientes] = useState<readonly PacienteHit[]>([]);
  const [carregando, setCarregando] = useState(false);
  const termo = useDebounce(query.trim(), 120);
  const geracao = useRef(0);

  /* ── buscar pacientes ──────────────────────────────────────── */

  useEffect(() => {
    if (!open || termo.length < 2 || termo.startsWith('#')) {
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

  /* ── grupos filtrados ───────────────────────────────────────── */

  const grupos = useMemo(() => {
    const busca = normalizar(query.trim());
    const buscaOriginal = query.trim();

    // Detectar prefixo
    const prefixo = buscaOriginal[0];
    const modo: Categoria | 'todos' =
      prefixo === '@' ? 'paciente' :
      prefixo === '#' ? 'catalogo' :
      prefixo === '$' ? 'acao' :
      prefixo === '>' ? 'tela' :
      'todos';

    // Filtrar atalhos quando busca corresponde
    const atalhosFiltrados = busca.length > 0
      ? ACOES.filter((a) => a.atalho && normalizar(a.atalho).includes(busca))
      : [];

    const resultado: { label: string; items: readonly CommandItem[] }[] = [];

    // Pacientes
    if ((modo === 'todos' || modo === 'paciente') && pacientes.length > 0) {
      resultado.push({
        label: 'Pacientes',
        items: pacientes.map((paciente) => ({
          id: paciente.patientId,
          label: paciente.displayName,
          meta: [paciente.phonePrimary, paciente.cadastroStatus === 'preliminar' ? 'Cadastro preliminar' : null].filter(Boolean).join(' · ') || 'Cadastro completo',
          href: `/pacientes/${paciente.patientId}`,
          icon: User,
          categoria: 'paciente' as const,
        })),
      });
    }

    // Ações (quando busca corresponde ou modo é ação)
    if (modo === 'todos' || modo === 'acao') {
      const acoesFiltradas = ACOES.filter((a) =>
        pontuar(a.label, busca) || pontuar(a.meta, busca)
      );
      if (acoesFiltradas.length > 0) {
        resultado.push({ label: 'Ações', items: acoesFiltradas.slice(0, 8) });
      }
    }

    // Atalhos filtrados
    if (atalhosFiltrados.length > 0) {
      resultado.push({ label: 'Atalhos', items: atalhosFiltrados });
    }

    // Telas
    if (modo === 'todos' || modo === 'tela') {
      const telasFiltradas = TELAS.filter((t) => pontuar(t.label, busca));
      if (telasFiltradas.length > 0) {
        resultado.push({ label: 'Telas', items: telasFiltradas.slice(0, busca ? 10 : 6) });
      }
    }

    return resultado;
  }, [pacientes, query]);

  /* ── seleção ────────────────────────────────────────────────── */

  function select(href: string) {
    onOpenChange(false);
    setQuery('');
    setPacientes([]);
    router.push(href);
  }

  /* ── placeholder dinâmico ─────────────────────────────────── */

  const placeholder = useMemo(() => {
    if (query.startsWith('@')) return 'Buscar paciente (@nome, @cpf, @telefone)...';
    if (query.startsWith('#')) return 'Buscar CID, TUSS, procedimento (#tosse, #vacina)...';
    if (query.startsWith('$')) return 'Ação rápida ($pagamento, $despesa)...';
    if (query.startsWith('>')) return 'Ir para tela (>agenda, >caixa)...';
    return 'Buscar paciente ou executar ação... (@paciente, $acao, #cid, g+h)';
  }, [query]);

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
        <Dialog.Content
          className="fixed left-1/2 top-[12vh] z-[80] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-elev-3 data-[state=open]:animate-[scaleIn_160ms_var(--ease-out)]"
        >
          <Dialog.Title className="sr-only">Busca global e comandos</Dialog.Title>
          <Dialog.Description className="sr-only">
            Busque pacientes (@), execute ações ($), consulte catálogos (#) ou navegue para telas.
          </Dialog.Description>

          {/* ── input ── */}
          <div className="flex h-14 items-center gap-3 border-b border-line px-4">
            {carregando
              ? <SpinnerGap size={19} className="animate-spin text-text-faint" aria-label="Buscando" />
              : <MagnifyingGlass size={19} className="text-text-faint" aria-hidden />}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-label="Buscar paciente ou executar ação"
              aria-autocomplete="list"
              aria-controls="command-listbox"
              role="combobox"
              aria-expanded={grupos.length > 0}
              className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Limpar busca"
                className="grid size-7 shrink-0 place-items-center rounded-lg text-text-faint hover:bg-surface-subtle hover:text-text"
              >
                <X size={15} aria-hidden />
              </button>
            )}
            <Dialog.Close asChild>
              <kbd className="hidden shrink-0 rounded border border-line bg-surface-subtle px-1.5 py-0.5 text-[11px] text-text-faint sm:block">Esc</kbd>
            </Dialog.Close>
          </div>

          {/* ── resultados ── */}
          <div
            id="command-listbox"
            role="listbox"
            aria-label="Resultados da busca"
            className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin"
          >
            {grupos.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="font-semibold text-text">Nenhum resultado</p>
                <p className="mt-1 text-sm text-text-muted">
                  Use <kbd className="rounded bg-surface-subtle px-1">@</kbd> para pacientes,{' '}
                  <kbd className="rounded bg-surface-subtle px-1">$</kbd> para ações,{' '}
                  <kbd className="rounded bg-surface-subtle px-1">#</kbd> para catálogos
                </p>
              </div>
            ) : grupos.map((grupo) => (
              <section key={grupo.label} aria-labelledby={`cmd-${grupo.label}`} className="mb-2 last:mb-0">
                <h2 id={`cmd-${grupo.label}`} className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[.08em] text-text-faint">
                  {grupo.label}
                </h2>
                {grupo.items.map((item) => {
                  const Icone = item.icon;
                  return (
                    <button
                      key={`${grupo.label}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => select(item.href)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors-fast hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                        <Icone size={16} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text">{item.label}</span>
                        <span className="block truncate text-xs text-text-muted">{item.meta}</span>
                      </span>
                      {item.atalho && (
                        <kbd className="shrink-0 rounded border border-line bg-surface-subtle px-1.5 py-0.5 text-[11px] text-text-faint">
                          {item.atalho}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </section>
            ))}
          </div>

          {/* ── footer com dicas ── */}
          <div className="flex items-center justify-between border-t border-line bg-surface-subtle px-4 py-2.5 text-[11px] text-text-faint">
            <div className="flex gap-3">
              <span><kbd className="rounded bg-surface px-1">↑↓</kbd> navegar</span>
              <span><kbd className="rounded bg-surface px-1">↵</kbd> abrir</span>
              <span><kbd className="rounded bg-surface px-1">Esc</kbd> fechar</span>
            </div>
            <div className="flex gap-2">
              <span className="rounded bg-surface px-1">@</span>
              <span className="rounded bg-surface px-1">#</span>
              <span className="rounded bg-surface px-1">$</span>
              <span className="rounded bg-surface px-1">&gt;</span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
