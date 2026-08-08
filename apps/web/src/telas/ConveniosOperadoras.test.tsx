// apps/web/src/telas/ConveniosOperadoras.test.tsx
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import {
  ConveniosOperadoras,
  type Operadora,
  type OperadorasDados,
} from './ConveniosOperadoras';

// Polyfills para jsdom: Radix Tooltip (Popper) depende de ResizeObserver e
// DOMRect que nao existem no jsdom
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
  }

  if (typeof globalThis.DOMRect === 'undefined') {
    // @ts-ignore - polyfill basico para testes no jsdom
    globalThis.DOMRect = class DOMRect {
      x = 0; y = 0; width = 0; height = 0;
      top = 0; right = 0; bottom = 0; left = 0;
      toJSON() { return {}; }
      static fromRect() { return new DOMRect(); }
    };
  }
});

function Wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={0}>
      {children}
    </RadixTooltip.Provider>
  );
}

const OPERADORAS: readonly Operadora[] = [
  {
    id: 'op1', nome: 'Unimed', registroAns: '123456',
    versaoTiss: '4.01.00', cnpj: 'AB1234567890CD',
    email: 'faturamento@unimed.com.br', telefone: '(11) 3333-4444',
    ativa: true, totalPacientes: 42,
  },
  {
    id: 'op2', nome: 'Bradesco Saude', registroAns: '654321',
    versaoTiss: '4.01.00', cnpj: 'XY9876543210ZW',
    email: 'tiss@bradescosaude.com.br', telefone: '(11) 5555-6666',
    ativa: true, totalPacientes: 18,
  },
  {
    id: 'op3', nome: 'SulAmerica', registroAns: '111222',
    versaoTiss: '3.05.00', cnpj: 'SA1111222233CD',
    email: null, telefone: null,
    ativa: false, totalPacientes: 0,
  },
];

const DADOS: OperadorasDados = { operadoras: OPERADORAS };

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoSalvar: vi.fn(async (_op: Partial<Operadora> & { nome: string; registroAns: string }) => {}),
    aoDesativar: vi.fn(async (_id: string) => {}),
  };
  render(<ConveniosOperadoras {...props} />, { wrapper: Wrapper });
  return props;
}

describe('ConveniosOperadoras', () => {
  it('renderiza tabela de operadoras', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.getByText('SulAmerica')).toBeVisible();
    // Verifica que ha uma tabela
    expect(screen.getByRole('table')).toBeVisible();
    // Verifica cabecalhos
    expect(screen.getByText('Operadora')).toBeVisible();
    expect(screen.getByText('Registro ANS')).toBeVisible();
    expect(screen.getByText('CNPJ')).toBeVisible();
  });

  it('mostra registro ANS e CNPJ', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    // Registro ANS
    expect(screen.getByText('123456')).toBeVisible();
    expect(screen.getByText('654321')).toBeVisible();
    // CNPJ
    expect(screen.getByText('AB1234567890CD')).toBeVisible();
    expect(screen.getByText('XY9876543210ZW')).toBeVisible();
  });

  it('mostra botoes editar e excluir', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    // Deve haver botoes com aria-label Editar e Excluir para cada operadora
    const botoesEditar = screen.getAllByLabelText('Editar');
    const botoesExcluir = screen.getAllByLabelText('Excluir');
    expect(botoesEditar).toHaveLength(3);
    expect(botoesExcluir).toHaveLength(3);
  });

  it('filtra ao digitar na busca', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const campoBusca = screen.getByLabelText('Buscar operadora');
    await userEvent.type(campoBusca, 'Bradesco');
    // Apenas Bradesco deve estar visivel
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.queryByText('Unimed')).not.toBeInTheDocument();
    expect(screen.queryByText('SulAmerica')).not.toBeInTheDocument();
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <ConveniosOperadoras
        carregarDados={async () => DADOS}
        aoSalvar={async () => {}}
        aoDesativar={async () => {}}
      />,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
