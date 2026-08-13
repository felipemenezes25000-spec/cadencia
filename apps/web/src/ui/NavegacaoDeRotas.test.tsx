import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NavegacaoDeRotas } from './NavegacaoDeRotas';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('NavegacaoDeRotas', () => {
  it('expõe destinos como links e identifica a rota atual', () => {
    render(
      <NavegacaoDeRotas
        rotulo="Seções financeiras"
        ativa="caixa"
        itens={[
          { value: 'resumo', rotulo: 'Resumo', href: '/financeiro' },
          { value: 'caixa', rotulo: 'Caixa', href: '/financeiro/caixa', badge: 3 },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Resumo' })).toHaveAttribute('href', '/financeiro');
    expect(screen.getByRole('link', { name: /Caixa/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});
