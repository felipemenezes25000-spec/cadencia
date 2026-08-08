// apps/web/src/ui/ChipDeStatusTiss.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ChipDeStatusTiss, type StatusTiss } from './ChipDeStatusTiss';

const TODOS: StatusTiss[] = [
  'rascunho', 'enviado', 'processado', 'glosado', 'completa', 'incompleta',
  'pendente', 'processando', 'aprovado', 'parcial', 'recurso', 'pago',
];

describe('ChipDeStatusTiss', () => {
  it.each(TODOS)('renderiza o status "%s" com rotulo visivel', (status) => {
    render(<ChipDeStatusTiss status={status} />);
    // recurso renders as "Em recurso"
    const rotulo = status === 'recurso' ? 'Em recurso' : status;
    const el = screen.getByText(new RegExp(rotulo, 'i'));
    expect(el).toBeVisible();
  });

  it('rascunho usa classe neutra (text-muted)', () => {
    render(<ChipDeStatusTiss status="rascunho" />);
    const el = screen.getByText(/Rascunho/i);
    expect(el.className).toContain('text-text-muted');
  });

  it('enviado usa classe accent', () => {
    render(<ChipDeStatusTiss status="enviado" />);
    const el = screen.getByText(/Enviado/i);
    expect(el.className).toContain('text-accent');
  });

  it('processado usa classe ok', () => {
    render(<ChipDeStatusTiss status="processado" />);
    const el = screen.getByText(/Processado/i);
    expect(el.className).toContain('text-ok');
  });

  it('glosado usa classe danger', () => {
    render(<ChipDeStatusTiss status="glosado" />);
    const el = screen.getByText(/Glosado/i);
    expect(el.className).toContain('text-danger');
  });

  it('incompleta usa classe warn', () => {
    render(<ChipDeStatusTiss status="incompleta" />);
    const el = screen.getByText(/Incompleta/i);
    expect(el.className).toContain('text-warn');
  });

  it('completa usa classe ok', () => {
    render(<ChipDeStatusTiss status="completa" />);
    const el = screen.getByText(/Completa/i);
    expect(el.className).toContain('text-ok');
  });

  it('aprovado usa classe ok', () => {
    render(<ChipDeStatusTiss status="aprovado" />);
    const el = screen.getByText(/Aprovado/i);
    expect(el.className).toContain('text-ok');
  });

  it('parcial usa classe warn', () => {
    render(<ChipDeStatusTiss status="parcial" />);
    const el = screen.getByText(/Parcial/i);
    expect(el.className).toContain('text-warn');
  });

  it('pago usa classe ok', () => {
    render(<ChipDeStatusTiss status="pago" />);
    const el = screen.getByText(/Pago/i);
    expect(el.className).toContain('text-ok');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<ChipDeStatusTiss status="enviado" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
