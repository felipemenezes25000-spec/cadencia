import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MatrizPermissoes } from './MatrizPermissoes';

describe('MatrizPermissoes', () => {
  it('renderiza todas as colunas de roles', () => {
    render(<MatrizPermissoes />);
    expect(screen.getByText('Administracao')).toBeDefined();
    expect(screen.getByText('Direcao tecnica')).toBeDefined();
    expect(screen.getByText('Profissional')).toBeDefined();
    expect(screen.getByText('Recepcao')).toBeDefined();
    expect(screen.getByText('Financeiro')).toBeDefined();
  });
  it('renderiza ao menos 10 linhas de acao', () => {
    render(<MatrizPermissoes />);
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(10);
  });
  it('indica acoes que exigem MFA', () => {
    render(<MatrizPermissoes />);
    expect(screen.getAllByText('MFA').length).toBeGreaterThan(0);
  });
  it('passa a11y', async () => {
    const { container } = render(<MatrizPermissoes />);
    expect(await axe(container)).toHaveNoViolations();
  }, 15_000);
});
