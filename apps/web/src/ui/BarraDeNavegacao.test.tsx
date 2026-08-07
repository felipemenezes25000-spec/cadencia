import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV, FASE_ATUAL } from './nav';

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

  it('na Fase 3 nenhum item esta marcado como futuro', () => {
    expect(FASE_ATUAL).toBe(3);
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > FASE_ATUAL);
    expect(futuros).toEqual([]);
  });

  it('todos os itens sao links navegaveis, incluindo Desempenho', () => {
    render(<BarraDeNavegacao />);
    for (const item of ITENS_NAV) {
      expect(screen.getByRole('link', { name: item.rotulo })).toBeInTheDocument();
    }
  });

  it('nenhum item aparece como botao desabilitado', () => {
    render(<BarraDeNavegacao />);
    const botoesDesabilitados = screen.queryAllByRole('button')
      .filter((b) => b.hasAttribute('disabled'));
    expect(botoesDesabilitados).toHaveLength(0);
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
