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
