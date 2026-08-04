'use client';

export interface Contadores {
  readonly agendados: number;
  readonly confirmados: number;
  readonly aguardando: number;
  readonly atendidos: number;
  readonly faltas: number;
}

export type FiltroDoDia = keyof Contadores;

const ROTULOS: Record<FiltroDoDia, string> = {
  agendados: 'Agendados', confirmados: 'Confirmados', aguardando: 'Aguardando',
  atendidos: 'Atendidos', faltas: 'Faltas',
};

export interface FaixaDeContadoresProps {
  readonly contadores: Contadores;
  readonly aoFiltrar: (filtro: FiltroDoDia) => void;
  readonly filtroAtivo?: FiltroDoDia;
}

export function FaixaDeContadores({
  contadores, aoFiltrar, filtroAtivo,
}: FaixaDeContadoresProps) {
  const chaves = Object.keys(ROTULOS) as FiltroDoDia[];
  return (
    <div
      role="group" aria-label="Contadores do dia" aria-live="polite"
      style={{ display: 'flex', border: 'var(--border)', borderRadius: 'var(--r-md)',
               background: 'var(--surface)', overflow: 'hidden' }}
    >
      {chaves.map((k, i) => (
        <button
          key={k} type="button" onClick={() => aoFiltrar(k)}
          aria-pressed={filtroAtivo === k}
          style={{
            flex: 1, border: 0, background: filtroAtivo === k ? 'var(--surface-hover)' : 'transparent',
            borderInlineStart: i === 0 ? 'none' : '1px solid var(--line)',
            padding: `var(--s-5) var(--s-4)`, cursor: 'pointer', minHeight: 44,
            display: 'grid', gap: 'var(--s-1)', justifyItems: 'start', color: 'var(--text)',
          }}
        >
          <span className="num" style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1.1 }}>
            {contadores[k]}
          </span>
          <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                         letterSpacing: '.04em', color: 'var(--text-muted)' }}>
            {ROTULOS[k]}
          </span>
        </button>
      ))}
    </div>
  );
}
