'use client';

export type StatusAgenda =
  | 'agendado' | 'confirmado' | 'aguardando' | 'atendendo'
  | 'atendido' | 'faltou' | 'cancelado';

const CHIP: Record<StatusAgenda, { rotulo: string; glifo: string; token: string }> = {
  agendado:   { rotulo: 'Agendado',   glifo: '●', token: '--st-agendado' },
  confirmado: { rotulo: 'Confirmado', glifo: '✓', token: '--st-confirmado' },
  aguardando: { rotulo: 'Aguardando', glifo: '⏱', token: '--st-aguardando' },
  atendendo:  { rotulo: 'Atendendo',  glifo: '●', token: '--st-atendendo' },
  atendido:   { rotulo: 'Atendido',   glifo: '✓', token: '--st-atendido' },
  faltou:     { rotulo: 'Faltou',     glifo: '✕', token: '--st-faltou' },
  cancelado:  { rotulo: 'Cancelado',  glifo: '✕', token: '--st-cancelado' },
};

export function ChipDeStatus({ status }: { status: StatusAgenda }) {
  const c = CHIP[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
      fontWeight: 'var(--fw-medium)', padding: `var(--s-1) var(--s-4)`,
      borderRadius: 'var(--r-full)',
      color: `var(${c.token})`, background: 'var(--surface-sunken)',
    }}>
      <span aria-hidden="true">{c.glifo}</span>{c.rotulo}
    </span>
  );
}

export { CHIP as CHIPS_DE_STATUS };
