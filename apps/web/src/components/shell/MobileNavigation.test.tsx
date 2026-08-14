import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileNavigation } from './AppShell';
import { CONFIG_NAV, NAVEGACAO_SHELL } from '../../ui/nav';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const pathname = vi.hoisted(() => ({ atual: '/hoje' }));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.atual,
}));

/**
 * O dock e a unica navegacao estrutural no celular — a Sidebar e `hidden
 * md:flex`. Ele ja teve cinco destinos fixos com "Mais" apontando direto para
 * /configuracoes, o que deixava Financeiro, Convenios, Desempenho, Catalogos,
 * Bulario e Relatorios sem nenhuma entrada no telefone. Estes testes existem
 * para que isso nao volte silenciosamente: o que a Sidebar mostra tem de estar
 * alcancavel no celular.
 */
describe('MobileNavigation', () => {
  it('mantém no dock os quatro destinos do fluxo do dia', () => {
    pathname.atual = '/hoje';
    render(<MobileNavigation />);

    const dock = screen.getByRole('navigation', { name: 'Navegação móvel' });
    for (const rotulo of ['Hoje', 'Agenda', 'Pacientes', 'Mensagens']) {
      expect(within(dock).getByRole('link', { name: rotulo })).toBeInTheDocument();
    }
    expect(within(dock).getByRole('button', { name: 'Mais' })).toBeInTheDocument();
  });

  it('alcança pelo "Mais" todo destino que a Sidebar desenha', async () => {
    pathname.atual = '/hoje';
    const user = userEvent.setup();
    render(<MobileNavigation />);

    await user.click(screen.getByRole('button', { name: 'Mais' }));
    const painel = await screen.findByRole('dialog');

    const esperados = [
      ...NAVEGACAO_SHELL.flatMap((g) => g.itens.map((i) => i.href)),
      ...CONFIG_NAV.filhos.map((f) => f.href),
    ];
    const alcancaveis = within(painel).getAllByRole('link')
      .map((a) => a.getAttribute('href'));

    for (const href of esperados) {
      expect(alcancaveis, `destino ausente no painel "Mais": ${href}`).toContain(href);
    }
  });

  it('leva a Financeiro, Convênios, Relatórios e Catálogos — inalcançáveis antes', async () => {
    pathname.atual = '/hoje';
    const user = userEvent.setup();
    render(<MobileNavigation />);

    await user.click(screen.getByRole('button', { name: 'Mais' }));
    const painel = await screen.findByRole('dialog');

    expect(within(painel).getByRole('link', { name: 'Financeiro' })).toHaveAttribute('href', '/financeiro');
    expect(within(painel).getByRole('link', { name: 'Convênios' })).toHaveAttribute('href', '/convenios');
    expect(within(painel).getByRole('link', { name: 'Relatórios' })).toHaveAttribute('href', '/explorar');
    expect(within(painel).getByRole('link', { name: 'Catálogos' })).toHaveAttribute('href', '/catalogos');
    expect(within(painel).getByRole('link', { name: 'Bulário' })).toHaveAttribute('href', '/bulas');
  });

  it('marca "Mais" como ativo quando a rota atual não está no dock', () => {
    pathname.atual = '/financeiro/caixa';
    render(<MobileNavigation />);

    const dock = screen.getByRole('navigation', { name: 'Navegação móvel' });
    /* Sem isto o dock fica sem nenhum item aceso em metade do produto, e o
       usuario perde a referencia de onde esta. */
    expect(within(dock).getByRole('button', { name: 'Mais' })).toHaveClass('text-accent');
  });

  it('fecha o painel ao navegar, para não cobrir a tela recém-aberta', async () => {
    pathname.atual = '/hoje';
    const user = userEvent.setup();
    render(<MobileNavigation />);

    await user.click(screen.getByRole('button', { name: 'Mais' }));
    const painel = await screen.findByRole('dialog');
    await user.click(within(painel).getByRole('link', { name: 'Financeiro' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
