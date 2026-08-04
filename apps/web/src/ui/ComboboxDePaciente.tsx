'use client';

import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface PacienteHit {
  readonly patientId: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly hasSocialName: boolean;
  readonly birthDate: string | null;
  readonly cadastroStatus: 'completo' | 'preliminar';
  readonly phonePrimary: string | null;
}

interface Props {
  readonly rotulo?: string;
  readonly buscar: (termo: string) => Promise<PacienteHit[]>;
  readonly aoEscolher: (hit: PacienteHit) => void;
  readonly aoCriar: (termo: string) => void;
  readonly autoFocus?: boolean;
}

export function ComboboxDePaciente({ rotulo = 'Buscar paciente', buscar, aoEscolher, aoCriar, autoFocus }: Props) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [termo, setTermo] = useState('');
  const [hits, setHits] = useState<PacienteHit[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const gen = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const opcoes = aberto
    ? [...hits, { _criar: true as const, termo }]
    : [];

  const optionId = (i: number) => `${id}-opt-${i}`;

  const executarBusca = useCallback((t: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (t.length === 0) {
      setHits([]);
      setAberto(false);
      setAtivo(-1);
      return;
    }
    timer.current = setTimeout(async () => {
      const g = ++gen.current;
      const resultado = await buscar(t);
      if (g === gen.current) {
        setHits(resultado);
        setAberto(true);
        setAtivo(-1);
      }
    }, 120);
  }, [buscar]);

  const escolher = (i: number) => {
    const op = opcoes[i];
    if (!op) return;
    if ('_criar' in op) {
      aoCriar(termo);
    } else {
      aoEscolher(op);
    }
    setAberto(false);
    setAtivo(-1);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!aberto || opcoes.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo(prev => Math.min(prev + 1, opcoes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo(prev => (prev <= 0 ? opcoes.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && ativo >= 0) {
      e.preventDefault();
      escolher(ativo);
    } else if (e.key === 'Escape') {
      setAberto(false);
      setAtivo(-1);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <label htmlFor={`${id}-input`} style={{
        fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
        lineHeight: 1.3, color: 'var(--text-muted)', display: 'block',
        marginBottom: 'var(--s-2)',
      }}>
        {rotulo}
      </label>
      <input
        id={`${id}-input`}
        role="combobox"
        autoFocus={autoFocus}
        aria-expanded={aberto}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={ativo >= 0 ? optionId(ativo) : undefined}
        value={termo}
        onChange={e => {
          setTermo(e.target.value);
          executarBusca(e.target.value);
        }}
        onKeyDown={onKeyDown}
        style={{
          width: '100%', height: 40, padding: '0 var(--s-4)',
          border: 'var(--border)', borderRadius: 'var(--r-md)',
          background: 'var(--surface)', color: 'var(--text)',
          fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
        }}
      />
      {aberto && opcoes.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Resultados de pacientes"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            margin: 0, padding: 0, listStyle: 'none',
            background: 'var(--surface)', border: 'var(--border)',
            borderRadius: 'var(--r-md)', boxShadow: 'var(--elev-2)',
            zIndex: 'var(--z-popover)' as unknown as number,
            maxHeight: 280, overflowY: 'auto',
          }}
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
                  style={{
                    padding: 'var(--s-3) var(--s-4)', cursor: 'pointer',
                    background: ativo === i ? 'var(--surface-hover)' : undefined,
                    fontWeight: 'var(--fw-medium)', color: 'var(--accent)',
                  }}
                >
                  + Criar &ldquo;{op.termo}&rdquo;
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
                style={{
                  padding: 'var(--s-3) var(--s-4)', cursor: 'pointer',
                  background: ativo === i ? 'var(--surface-hover)' : undefined,
                  display: 'flex', flexDirection: 'column', gap: 'var(--s-1)',
                }}
              >
                <span style={{ fontWeight: 'var(--fw-medium)' }}>
                  {op.displayName}
                </span>
                {op.hasSocialName && (
                  <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
                    {op.legalName}
                  </span>
                )}
                {op.cadastroStatus === 'preliminar' && (
                  <span style={{ fontSize: 'var(--fs-11)', color: 'var(--warn)' }}>
                    cadastro preliminar
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
