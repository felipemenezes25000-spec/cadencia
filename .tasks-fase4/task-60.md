### Task 60: Chip de status TISS reutilizavel

**Arquivos**

- Criar `apps/web/src/ui/ChipDeStatusTiss.tsx`
- Criar `apps/web/src/ui/ChipDeStatusTiss.test.tsx`

**Por que**: O chip de status de lote e guia TISS (rascunho, enviado, processado, glosado, completa, incompleta) e reutilizado em multiplas telas de convenios. Ter um componente dedicado evita duplicacao e garante cores consistentes com o design system.

- [ ] Criar o teste `apps/web/src/ui/ChipDeStatusTiss.test.tsx`:

```tsx
// apps/web/src/ui/ChipDeStatusTiss.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ChipDeStatusTiss, type StatusTiss } from './ChipDeStatusTiss';

const TODOS: StatusTiss[] = [
  'rascunho', 'enviado', 'processado', 'glosado', 'completa', 'incompleta',
];

describe('ChipDeStatusTiss', () => {
  it.each(TODOS)('renderiza o status "%s" com rotulo visivel', (status) => {
    render(<ChipDeStatusTiss status={status} />);
    const el = screen.getByText(new RegExp(status, 'i'));
    expect(el).toBeVisible();
  });

  it('rascunho usa cor neutra (text-muted)', () => {
    render(<ChipDeStatusTiss status="rascunho" />);
    const el = screen.getByText(/Rascunho/i);
    expect(el).toHaveStyle({ color: 'var(--text-muted)' });
  });

  it('enviado usa cor accent', () => {
    render(<ChipDeStatusTiss status="enviado" />);
    const el = screen.getByText(/Enviado/i);
    expect(el).toHaveStyle({ color: 'var(--accent)' });
  });

  it('processado usa cor ok', () => {
    render(<ChipDeStatusTiss status="processado" />);
    const el = screen.getByText(/Processado/i);
    expect(el).toHaveStyle({ color: 'var(--ok)' });
  });

  it('glosado usa cor danger', () => {
    render(<ChipDeStatusTiss status="glosado" />);
    const el = screen.getByText(/Glosado/i);
    expect(el).toHaveStyle({ color: 'var(--danger)' });
  });

  it('incompleta usa cor warn', () => {
    render(<ChipDeStatusTiss status="incompleta" />);
    const el = screen.getByText(/Incompleta/i);
    expect(el).toHaveStyle({ color: 'var(--warn)' });
  });

  it('completa usa cor ok', () => {
    render(<ChipDeStatusTiss status="completa" />);
    const el = screen.getByText(/Completa/i);
    expect(el).toHaveStyle({ color: 'var(--ok)' });
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<ChipDeStatusTiss status="enviado" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/ui/ChipDeStatusTiss.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './ChipDeStatusTiss'
```

- [ ] Criar o componente `apps/web/src/ui/ChipDeStatusTiss.tsx`:

```tsx
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
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/ui/ChipDeStatusTiss.test.tsx 2>&1 | tail -5
# Esperado: Tests  8 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/ui/ChipDeStatusTiss.tsx apps/web/src/ui/ChipDeStatusTiss.test.tsx
git commit -m "feat(web): add ChipDeStatusTiss reusable status chip"
```

---