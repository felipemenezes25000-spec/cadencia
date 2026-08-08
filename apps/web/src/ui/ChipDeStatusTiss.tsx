// apps/web/src/ui/ChipDeStatusTiss.tsx
'use client';

export type StatusTiss =
  | 'rascunho' | 'enviado' | 'processado' | 'glosado'
  | 'completa' | 'incompleta';

const CHIP: Record<StatusTiss, { rotulo: string; glifo: string; cor: string; bg: string }> = {
  rascunho:    { rotulo: 'Rascunho',    glifo: '●', cor: 'var(--text-muted)', bg: 'var(--surface-sunken)' },
  enviado:     { rotulo: 'Enviado',     glifo: '↑', cor: 'var(--accent)',      bg: 'var(--accent-soft)' },
  processado:  { rotulo: 'Processado',  glifo: '✓', cor: 'var(--ok)',          bg: 'var(--ok-soft)' },
  glosado:     { rotulo: 'Glosado',     glifo: '!', cor: 'var(--danger)',      bg: 'var(--danger-soft)' },
  completa:    { rotulo: 'Completa',    glifo: '✓', cor: 'var(--ok)',          bg: 'var(--ok-soft)' },
  incompleta:  { rotulo: 'Incompleta',  glifo: '!', cor: 'var(--warn)',        bg: 'var(--warn-soft)' },
};

export function ChipDeStatusTiss({ status }: { readonly status: StatusTiss }) {
  const c = CHIP[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
      fontWeight: 'var(--fw-medium)', padding: `var(--s-1) var(--s-4)`,
      borderRadius: 'var(--r-full)',
      color: c.cor, background: c.bg,
    }}>
      <span aria-hidden="true">{c.glifo}</span>{c.rotulo}
    </span>
  );
}

export { CHIP as CHIPS_TISS };
