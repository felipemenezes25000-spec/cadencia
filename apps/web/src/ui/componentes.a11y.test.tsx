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
import { Modal } from './Modal';

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

/* ── Modal ───────────────────────────────────────────────────────── */

describe('Modal — acessibilidade', () => {
  it('expõe role=dialog com nome acessível vindo do título', () => {
    const { getByRole } = render(
      <Modal aberto titulo="Convidar usuário" aoFechar={() => {}}>
        <p>corpo</p>
      </Modal>,
    );
    expect(getByRole('dialog', { name: 'Convidar usuário' })).toBeInTheDocument();
  });

  it('sem descrição não deixa aria-describedby apontando para o vazio', () => {
    const { getByRole } = render(
      <Modal aberto titulo="Sem descrição" aoFechar={() => {}}>
        <p>corpo</p>
      </Modal>,
    );
    /* Radix gera um id de descrição mesmo quando não há <Description>. Se a prop
       vazasse, o leitor de tela procuraria um elemento inexistente. */
    expect(getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it('com descrição, o aria-describedby aponta para um elemento que existe', () => {
    const { getByRole } = render(
      <Modal aberto titulo="Criar unidade" descricao="Nasce no tenant atual." aoFechar={() => {}}>
        <p>corpo</p>
      </Modal>,
    );
    const id = getByRole('dialog').getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).toHaveTextContent('Nasce no tenant atual.');
  });

  it('marca o resto da página como inerte — a promessa que os modais à mão quebravam', () => {
    const { queryByRole, getByRole } = render(
      <div>
        <button type="button">fora do modal</button>
        <Modal aberto titulo="Preso" aoFechar={() => {}}>
          <button type="button">dentro</button>
        </Modal>
      </div>,
    );

    /* O botão de trás continua no DOM... */
    expect(getByRole('button', { name: 'fora do modal', hidden: true })).toBeInTheDocument();
    /* ...mas sumiu da árvore de acessibilidade, que é o que `aria-modal`
       promete. Os modais escritos à mão declaravam a promessa sem cumpri-la:
       o leitor de tela seguia enxergando a página inteira e o Tab passeava
       pelo conteúdo de trás. */
    expect(queryByRole('button', { name: 'fora do modal' })).toBeNull();
    /* O de dentro segue alcançável. */
    expect(getByRole('button', { name: 'dentro' })).toBeInTheDocument();
  });

  it('modal fechado não renderiza nada', () => {
    const { queryByRole } = render(
      <Modal aberto={false} titulo="Oculto" aoFechar={() => {}}>
        <p>corpo</p>
      </Modal>,
    );
    expect(queryByRole('dialog')).toBeNull();
  });

  it('não tem violações axe', async () => {
    const { baseElement } = render(
      <Modal aberto titulo="Auditado" descricao="Descrição." aoFechar={() => {}}>
        <p>corpo</p>
      </Modal>,
    );
    await expectAxeClean(baseElement as HTMLElement, 'Modal');
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
