import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { MatrizPermissoes } from './MatrizPermissoes';

// Mock do hook useSessao
vi.mock('../sessao', () => ({
  useSessao: () => ({
    clinicId: '00000000-0000-0000-0000-000000000001',
    csrfToken: 'fake-csrf-token',
    vinculoAtivo: {
      clinicId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000002',
      role: 'admin_clinico',
      clinicNome: 'Clínica Demo',
      tenantNome: 'Tenant Demo',
      ativo: true,
    },
  }),
}));

describe('MatrizPermissoes', () => {
  it('renderiza todas as colunas de roles', () => {
    render(<MatrizPermissoes />);
    expect(screen.getByText('Administração')).toBeDefined();
    expect(screen.getByText('Direção técnica')).toBeDefined();
    expect(screen.getByText('Profissional')).toBeDefined();
    expect(screen.getByText('Recepção')).toBeDefined();
    expect(screen.getByText('Financeiro')).toBeDefined();
  });
  it('renderiza ao menos 10 linhas de ação', () => {
    render(<MatrizPermissoes />);
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(10);
  });
  it('indica ações que exigem MFA', () => {
    render(<MatrizPermissoes />);
    expect(screen.getAllByText('MFA').length).toBeGreaterThan(0);
  });
  it('passa a11y', async () => {
    const { container } = render(<MatrizPermissoes />);
    expect(await axe(container)).toHaveNoViolations();
  }, 15_000);
});
