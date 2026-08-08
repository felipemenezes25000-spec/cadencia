// apps/web/src/telas/TemplatesDeMensagem.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { axe } from 'vitest-axe';
import { TemplatesDeMensagem, type Template } from './TemplatesDeMensagem';

/* ── Mocks ──────────────────────────────────────────────────────────── */

vi.mock('next/navigation', () => ({
  usePathname: () => '/templates',
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/* ── Dados de teste ─────────────────────────────────────────────────── */

const TEMPLATES: Template[] = [
  {
    id: 't1',
    titulo: 'Confirmacao de consulta',
    conteudo:
      'Ola {{nome}}, sua consulta esta confirmada para {{data}} as {{hora}}.',
  },
  {
    id: 't2',
    titulo: 'Lembrete D-1',
    conteudo: 'Ola {{nome}}, lembramos da consulta amanha as {{hora}}.',
  },
  {
    id: 't3',
    titulo: 'Pos-consulta',
    conteudo: 'Ola {{nome}}, obrigado pela visita!',
  },
];

function montar(
  overrides: Partial<Parameters<typeof TemplatesDeMensagem>[0]> = {},
) {
  const props = {
    templates: TEMPLATES,
    aoCriar: vi.fn(),
    aoEditar: vi.fn(),
    aoExcluir: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(
      <RadixTooltip.Provider delayDuration={0}>
        <TemplatesDeMensagem {...props} />
      </RadixTooltip.Provider>,
    ),
  };
}

/* ── Testes ──────────────────────────────────────────────────────────── */

describe('TemplatesDeMensagem', () => {
  it('renderiza lista de templates', () => {
    montar();
    expect(screen.getByText('Confirmacao de consulta')).toBeInTheDocument();
    expect(screen.getByText('Lembrete D-1')).toBeInTheDocument();
    expect(screen.getByText('Pos-consulta')).toBeInTheDocument();
  });

  it('mostra titulo e preview do conteudo', () => {
    montar();
    expect(screen.getByText('Confirmacao de consulta')).toBeVisible();
    expect(
      screen.getByText(/sua consulta esta confirmada/),
    ).toBeVisible();
  });

  it('mostra botoes editar e excluir', () => {
    montar();
    // Cada template tem um botao editar e um excluir
    const botoesEditar = screen.getAllByRole('button', { name: /Editar/ });
    const botoesExcluir = screen.getAllByRole('button', { name: /Excluir/ });
    expect(botoesEditar).toHaveLength(TEMPLATES.length);
    expect(botoesExcluir).toHaveLength(TEMPLATES.length);
  });

  it('mostra botao Novo template', () => {
    montar();
    expect(
      screen.getByRole('button', { name: /Novo template/ }),
    ).toBeInTheDocument();
  });

  it('botao Novo template chama aoCriar', async () => {
    const user = userEvent.setup();
    const { props } = montar();

    await user.click(screen.getByRole('button', { name: /Novo template/ }));
    expect(props.aoCriar).toHaveBeenCalled();
  });

  it('botao editar chama aoEditar com id correto', async () => {
    const user = userEvent.setup();
    const { props } = montar();

    await user.click(
      screen.getByRole('button', { name: /Editar Lembrete D-1/ }),
    );
    expect(props.aoEditar).toHaveBeenCalledWith('t2');
  });

  it('botao excluir chama aoExcluir com id correto', async () => {
    const user = userEvent.setup();
    const { props } = montar();

    await user.click(
      screen.getByRole('button', { name: /Excluir Pos-consulta/ }),
    );
    expect(props.aoExcluir).toHaveBeenCalledWith('t3');
  });

  it('mostra estado vazio quando sem templates', () => {
    montar({ templates: [] });
    expect(screen.getByText('Nenhum template cadastrado')).toBeInTheDocument();
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <RadixTooltip.Provider delayDuration={0}>
        <TemplatesDeMensagem
          templates={TEMPLATES}
          aoCriar={vi.fn()}
          aoEditar={vi.fn()}
          aoExcluir={vi.fn()}
        />
      </RadixTooltip.Provider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
