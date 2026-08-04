import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode;
    [k: string]: unknown }) => <a href={href} {...rest}>{children}</a>,
}));

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('marca o que ainda nao existe, com o motivo — nunca cadeado de upsell', () => {
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > 1);
    expect(futuros.map((i) => i.rotulo)).toEqual(['Conversas', 'Financeiro', 'Desempenho']);
    for (const f of futuros) expect(f.motivo).toMatch(/Fase \d/);
  });

  it('renderiza os itens da Fase 1 como link e os futuros como desabilitados', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: 'Hoje' })).toBeInTheDocument();
    const conversas = screen.getByRole('button', { name: /Conversas/ });
    expect(conversas).toBeDisabled();
    expect(conversas).toHaveAttribute('aria-disabled', 'true');
    expect(conversas).toHaveAccessibleDescription(/Fase 2/);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
