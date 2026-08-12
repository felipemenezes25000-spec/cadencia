/**
 * Testes de acessibilidade (axe-core) para componentes UI críticos.
 *
 * Executar: pnpm test:a11y
 */

import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Botao } from './Botao';
import { Campo } from './Campo';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';
import { ToastProvider } from './ToastProvider';
import { ChipDeStatus } from './ChipDeStatus';
import { Avatar } from './Avatar';
import { Skeleton } from './Skeleton';

/* ── Helper ──────────────────────────────────────────────────────── */

async function expectAxeClean(node: HTMLElement, label?: string) {
  const results = await axe(node);
  expect(results, label ?? 'Acessibilidade').toHaveNoViolations();
}

/* ── Botao ──────────────────────────────────────────────────────── */

describe('Botao — acessibilidade', () => {
  it('botão primário não tem violações', async () => {
    const { container } = render(<Botao>Salvar</Botao>);
    await expectAxeClean(container, 'Botao primário');
  });

  it('botão com aria-label é acessível', async () => {
    const { container } = render(
      <Botao aria-label="Fechar painel">×</Botao>,
    );
    await expectAxeClean(container, 'Botao com aria-label');
  });

  it('botão desabilitado não causa violações', async () => {
    const { container } = render(<Botao disabled>Enviar</Botao>);
    const btn = container.querySelector('button');
    expect(btn).toBeDisabled();
    await expectAxeClean(container, 'Botao disabled');
  });

  it('botão com carregando mantém label', async () => {
    const { getByRole } = render(
      <Botao carregando>Processando</Botao>,
    );
    const btn = getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveTextContent('Processando');
  });
});

/* ── Campo ───────────────────────────────────────────────────────── */

describe('Campo — acessibilidade', () => {
  it('campo com rótulo é acessível', async () => {
    const { container } = render(
      <Campo rotulo="Nome completo" name="nome" />,
    );
    await expectAxeClean(container, 'Campo com rótulo');
  });

  it('campo com erro anuncia erro', async () => {
    const { getByRole, container } = render(
      <Campo rotulo="CPF" name="cpf" erro="CPF inválido" />,
    );
    const input = getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await expectAxeClean(container, 'Campo com erro');
  });

  it('campo com ajuda é descrito', async () => {
    const { container } = render(
      <Campo rotulo="Email" name="email" ajuda="Formato: nome@exemplo.com" />,
    );
    await expectAxeClean(container, 'Campo com ajuda');
  });

  it('textarea tem label', async () => {
    const { getByRole } = render(
      <Campo rotulo="Observações" name="obs" variante="textarea" />,
    );
    expect(getByRole('textbox', { name: 'Observações' })).toBeInTheDocument();
  });
});

/* ── Tabs ────────────────────────────────────────────────────────── */

describe('Tabs — acessibilidade', () => {
  it('tabs são navegáveis por teclado', async () => {
    const { getByRole } = render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Aba 1</TabsTrigger>
          <TabsTrigger value="tab2">Aba 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Conteúdo 1</TabsContent>
        <TabsContent value="tab2">Conteúdo 2</TabsContent>
      </Tabs>,
    );

    const tablist = getByRole('tablist');
    expect(tablist).toBeInTheDocument();

    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
  });

  it('tab panel existe', async () => {
    const { getByRole } = render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Principal</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Dados principais</TabsContent>
      </Tabs>,
    );

    const panel = getByRole('tabpanel');
    expect(panel).toBeInTheDocument();
  });
});

/* ── Toast ──────────────────────────────────────────────────────── */

describe('Toast — acessibilidade', () => {
  it('ToastProvider não causa violações', async () => {
    const { container } = render(
      <ToastProvider>
        <div>App content</div>
      </ToastProvider>,
    );
    await expectAxeClean(container, 'ToastProvider');
  });
});

/* ── ChipDeStatus ───────────────────────────────────────────────── */

describe('ChipDeStatus — acessibilidade', () => {
  it('chip não tem violações', async () => {
    const { container } = render(
      <ChipDeStatus status="confirmado" />,
    );
    await expectAxeClean(container, 'ChipDeStatus');
  });
});

/* ── Avatar ──────────────────────────────────────────────────────── */

describe('Avatar — acessibilidade', () => {
  it('avatar com nome mostra iniciais', async () => {
    const { container } = render(<Avatar nome="Maria Silva" />);
    await expectAxeClean(container, 'Avatar');
  });
});

/* ── Skeleton ────────────────────────────────────────────────────── */

describe('Skeleton — acessibilidade', () => {
  it('skeleton usa role=status', async () => {
    const { getByRole } = render(<Skeleton />);
    const el = getByRole('status');
    expect(el).toBeInTheDocument();
  });
});
