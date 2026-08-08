// apps/web/src/ui/ChipDeStatus.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ChipDeStatus, type StatusAgenda } from './ChipDeStatus';

const TODOS_ORIGINAIS: StatusAgenda[] = [
  'agendado', 'confirmado', 'aguardando', 'atendendo',
  'atendido', 'faltou', 'cancelado',
];

const NOVOS: StatusAgenda[] = [
  'em_atendimento', 'pendente', 'pago', 'vencido',
];

describe('ChipDeStatus', () => {
  it.each(TODOS_ORIGINAIS)('renderiza rotulo correto para status "%s"', (status) => {
    render(<ChipDeStatus status={status} />);
    const el = screen.getByText(new RegExp(status.replace(/_/g, ' '), 'i'));
    expect(el).toBeVisible();
  });

  it.each(NOVOS)('renderiza rotulo correto para status novo "%s"', (status) => {
    render(<ChipDeStatus status={status} />);
    const rotulo = status.replace(/_/g, ' ');
    const el = screen.getByText(new RegExp(rotulo, 'i'));
    expect(el).toBeVisible();
  });

  it('glifo e rotulo aparecem juntos no chip', () => {
    render(<ChipDeStatus status="atendido" />);
    const chip = screen.getByText(/Atendido/);
    expect(chip.textContent).toMatch(/[✓✕⏱●]/);
  });

  it('confirmado usa classe ok', () => {
    render(<ChipDeStatus status="confirmado" />);
    const el = screen.getByText(/Confirmado/i);
    expect(el.className).toContain('text-ok');
  });

  it('aguardando usa classe warn', () => {
    render(<ChipDeStatus status="aguardando" />);
    const el = screen.getByText(/Aguardando/i);
    expect(el.className).toContain('text-warn');
  });

  it('faltou usa classe danger', () => {
    render(<ChipDeStatus status="faltou" />);
    const el = screen.getByText(/Faltou/i);
    expect(el.className).toContain('text-danger');
  });

  it('cancelado usa classe text-muted (neutro)', () => {
    render(<ChipDeStatus status="cancelado" />);
    const el = screen.getByText(/Cancelado/i);
    expect(el.className).toContain('text-text-muted');
  });

  it('pago usa classe ok', () => {
    render(<ChipDeStatus status="pago" />);
    const el = screen.getByText(/Pago/i);
    expect(el.className).toContain('text-ok');
  });

  it('vencido usa classe danger', () => {
    render(<ChipDeStatus status="vencido" />);
    const el = screen.getByText(/Vencido/i);
    expect(el.className).toContain('text-danger');
  });

  it('aceita className adicional', () => {
    render(<ChipDeStatus status="agendado" className="ml-2" />);
    const el = screen.getByText(/Agendado/i);
    expect(el.className).toContain('ml-2');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<ChipDeStatus status="atendido" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
