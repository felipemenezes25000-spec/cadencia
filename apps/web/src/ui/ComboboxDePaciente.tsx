'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import * as Popover from '@radix-ui/react-popover';
import { MagnifyingGlass, SpinnerGap, UserPlus } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { useDebounce } from '../lib/hooks';
import { Icone } from './Icone';

export interface PacienteHit {
  readonly patientId: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly hasSocialName: boolean;
  readonly birthDate: string | null;
  readonly cadastroStatus: 'completo' | 'preliminar';
  readonly phonePrimary: string | null;
}

interface ComboboxDePacienteProps {
  /** Rotulo do campo */
  readonly rotulo?: string;
  /** Placeholder do input */
  readonly placeholder?: string;
  /** Funcao de busca que retorna resultados */
  readonly buscar: (termo: string) => Promise<PacienteHit[]>;
  /** Callback ao escolher um paciente */
  readonly aoEscolher: (hit: PacienteHit) => void;
  /** Callback ao criar novo paciente */
  readonly aoCriar: (termo: string) => void;
  /** Foco automatico no input */
  readonly autoFocus?: boolean;
  /** Mensagem de erro */
  readonly erro?: string;
  /** Campo desabilitado */
  readonly disabled?: boolean;
  /** Classes adicionais */
  readonly className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function iniciais(nome: string): string {
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightMatch({ texto, busca }: { texto: string; busca: string }) {
  if (!busca.trim()) return <>{texto}</>;

  const regex = new RegExp(`(${escapeRegex(busca)})`, 'gi');
  const partes = texto.split(regex);

  return (
    <>
      {partes.map((parte, i) =>
        parte.toLowerCase() === busca.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-accent-soft text-inherit">
            {parte}
          </mark>
        ) : (
          <span key={i}>{parte}</span>
        ),
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function ComboboxDePaciente({
  rotulo = 'Buscar paciente',
  placeholder = 'Buscar paciente...',
  buscar,
  aoEscolher,
  aoCriar,
  autoFocus,
  erro,
  disabled,
  className,
}: ComboboxDePacienteProps) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [termo, setTermo] = useState('');
  const [hits, setHits] = useState<PacienteHit[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const [carregando, setCarregando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gen = useRef(0);

  const termoDebounced = useDebounce(termo, 100);

  /* Busca quando o valor debounced muda (minimo 2 caracteres) */
  useEffect(() => {
    if (termoDebounced.length < 2) {
      setHits([]);
      setAberto(false);
      setAtivo(-1);
      setCarregando(false);
      return;
    }

    const g = ++gen.current;
    setCarregando(true);

    buscar(termoDebounced).then((resultado) => {
      if (g === gen.current) {
        setHits(resultado);
        setAberto(true);
        setAtivo(-1);
        setCarregando(false);
      }
    });
  }, [termoDebounced, buscar]);

  /* Indicador de carregamento enquanto digita (antes do debounce disparar) */
  useEffect(() => {
    if (termo.length >= 2 && termo !== termoDebounced) {
      setCarregando(true);
    }
  }, [termo, termoDebounced]);

  const opcoes = aberto
    ? [...hits, { _criar: true as const, termo }]
    : [];

  const optionId = (i: number) => `${id}-opt-${i}`;

  const escolher = (i: number) => {
    const op = opcoes[i];
    if (!op) return;
    if ('_criar' in op) {
      aoCriar(termo);
    } else {
      aoEscolher(op);
      setTermo(op.displayName);
    }
    setAberto(false);
    setAtivo(-1);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setAberto(false);
      setAtivo(-1);
      return;
    }
    if (!aberto || opcoes.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((prev) => Math.min(prev + 1, opcoes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((prev) => (prev <= 0 ? opcoes.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && ativo >= 0) {
      e.preventDefault();
      escolher(ativo);
    }
  };

  return (
    <Popover.Root open={aberto} onOpenChange={setAberto}>
      <div className={cn('relative', className)}>
        <label
          htmlFor={`${id}-input`}
          className="mb-[var(--s-2)] block text-[length:var(--fs-12)] font-medium leading-tight text-text-muted"
        >
          {rotulo}
        </label>

        <Popover.Anchor asChild>
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg border bg-surface px-3 shadow-[inset_0_1px_0_oklch(100%_0_0_/_0.45)]',
              'transition-all duration-[var(--dur-2)]',
              erro
                ? 'border-danger'
                : 'border-line hover:border-line-strong focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/10',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <Icone
              icon={MagnifyingGlass}
              size="sm"
              className="shrink-0 text-text-muted"
            />
            <input
              id={`${id}-input`}
              ref={inputRef}
              type="text"
              role="combobox"
              autoFocus={autoFocus}
              aria-expanded={aberto}
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-activedescendant={
                ativo >= 0 ? optionId(ativo) : undefined
              }
              aria-label={rotulo}
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              className="flex-1 bg-transparent py-2.5 text-[length:var(--fs-14)] text-text outline-none placeholder:text-text-faint disabled:cursor-not-allowed"
            />
            {carregando && (
              <Icone
                icon={SpinnerGap}
                size="sm"
                className="animate-spin text-text-muted"
                label="Carregando"
              />
            )}
          </div>
        </Popover.Anchor>

        {erro && (
          <p className="mt-1 text-[length:var(--fs-12)] text-danger">{erro}</p>
        )}

        <Popover.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-label="Resultados de pacientes"
          className={cn(
            'z-[var(--z-popover)] w-[var(--radix-popover-trigger-width)]',
            'overflow-hidden rounded-xl border border-line bg-surface shadow-elev-3',
          )}
          sideOffset={4}
        >
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Resultados de pacientes"
            className="max-h-60 overflow-y-auto py-1"
          >
            {opcoes.map((op, i) => {
              if ('_criar' in op) {
                return (
                  <li
                    key="__criar__"
                    id={optionId(i)}
                    role="option"
                    aria-selected={ativo === i}
                    onClick={() => escolher(i)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 border-t border-line px-3 py-2 text-sm',
                      'transition-colors duration-[var(--dur-1)]',
                      ativo === i
                        ? 'bg-accent text-accent-on'
                        : 'text-accent hover:bg-surface-hover',
                    )}
                  >
                    <Icone icon={UserPlus} size="sm" />
                    Novo paciente &ldquo;{op.termo}&rdquo;
                  </li>
                );
              }
              return (
                <li
                  key={op.patientId}
                  id={optionId(i)}
                  role="option"
                  aria-selected={ativo === i}
                  onClick={() => escolher(i)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm',
                    'transition-colors duration-[var(--dur-1)]',
                    ativo === i
                      ? 'bg-accent text-accent-on'
                      : 'text-text hover:bg-surface-hover',
                  )}
                >
                  {/* Avatar com iniciais */}
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-xs font-semibold text-accent">
                    {iniciais(op.displayName)}
                  </div>
                  {/* Nome e detalhes */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      <HighlightMatch texto={op.displayName} busca={termo} />
                    </p>
                    {op.hasSocialName && (
                      <p className="truncate text-xs opacity-75">
                        {op.legalName}
                      </p>
                    )}
                    {op.cadastroStatus === 'preliminar' && (
                      <p className="text-[length:var(--fs-11)] text-warn">
                        cadastro preliminar
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </div>
    </Popover.Root>
  );
}
