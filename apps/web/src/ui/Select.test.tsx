import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Select } from './Select';

const opcoes = [
  { value: 'a', label: 'Opcao A' },
  { value: 'b', label: 'Opcao B' },
  { value: 'c', label: 'Opcao C' },
];

const grupos = [
  {
    label: 'Grupo 1',
    options: [
      { value: 'g1a', label: 'Item G1A' },
      { value: 'g1b', label: 'Item G1B' },
    ],
  },
  {
    label: 'Grupo 2',
    options: [
      { value: 'g2a', label: 'Item G2A' },
      { value: 'g2b', label: 'Item G2B', disabled: true },
    ],
  },
];

// Polyfills para jsdom: Radix Select depende de APIs de ponteiro e scroll
// que nao existem no jsdom
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    // @ts-expect-error - polyfill basico para testes
    window.PointerEvent = class PointerEvent extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      constructor(type: string, params: PointerEventInit & { pointerId?: number; pointerType?: string } = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? '';
      }
    };
  }

  // Radix Select chama hasPointerCapture / setPointerCapture / releasePointerCapture
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }

  // Radix Select chama scrollIntoView nos itens
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
});

describe('Select', () => {
  it('renderiza com placeholder', () => {
    render(<Select opcoes={opcoes} placeholder="Escolha uma opcao" />);
    expect(screen.getByText('Escolha uma opcao')).toBeInTheDocument();
  });

  it('renderiza com placeholder padrao quando nao fornecido', () => {
    render(<Select opcoes={opcoes} />);
    expect(screen.getByText('Selecione...')).toBeInTheDocument();
  });

  it('renderiza rotulo quando fornecido', () => {
    render(<Select rotulo="Tipo" opcoes={opcoes} />);
    expect(screen.getByText('Tipo')).toBeVisible();
  });

  it('mostra opcoes ao clicar', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Select rotulo="Tipo" opcoes={opcoes} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    expect(screen.getByRole('option', { name: 'Opcao A' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Opcao B' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Opcao C' })).toBeVisible();
  });

  it('seleciona opcao ao clicar', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <Select rotulo="Tipo" opcoes={opcoes} onChange={handleChange} />,
    );

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const opcaoB = screen.getByRole('option', { name: 'Opcao B' });
    await user.click(opcaoB);

    expect(handleChange).toHaveBeenCalledWith('b');
  });

  it('mostra opcoes agrupadas', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Select rotulo="Itens" grupos={grupos} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    // Rotulos dos grupos sao visiveis
    expect(screen.getByText('Grupo 1')).toBeVisible();
    expect(screen.getByText('Grupo 2')).toBeVisible();

    // Opcoes dos grupos
    expect(screen.getByRole('option', { name: 'Item G1A' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Item G2A' })).toBeVisible();
  });

  it('desabilita opcoes marcadas como disabled', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Select rotulo="Itens" grupos={grupos} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const opcaoDesabilitada = screen.getByRole('option', { name: 'Item G2B' });
    expect(opcaoDesabilitada).toHaveAttribute('data-disabled', '');
  });

  it('mostra estado de erro', () => {
    render(
      <Select rotulo="Tipo" opcoes={opcoes} erro="Campo obrigatorio" />,
    );

    // Mensagem de erro visivel
    expect(screen.getByRole('alert')).toHaveTextContent('Campo obrigatorio');

    // Trigger tem aria-invalid
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
  });

  it('trigger tem aria-invalid false sem erro', () => {
    render(<Select rotulo="Tipo" opcoes={opcoes} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-invalid', 'false');
  });

  it('trigger tem aria-describedby apontando para o erro', () => {
    render(
      <Select rotulo="Tipo" opcoes={opcoes} erro="Erro aqui" />,
    );

    const trigger = screen.getByRole('combobox');
    const erroEl = screen.getByRole('alert');
    expect(trigger.getAttribute('aria-describedby')).toBe(erroEl.id);
  });

  it('mostra valor selecionado no trigger', () => {
    render(
      <Select rotulo="Tipo" opcoes={opcoes} value="b" />,
    );

    // Radix mostra o label da opcao selecionada no trigger
    expect(screen.getByRole('combobox')).toHaveTextContent('Opcao B');
  });

  it('desabilita trigger quando disabled=true', () => {
    render(
      <Select rotulo="Tipo" opcoes={opcoes} disabled />,
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
  });

  it('navega com teclado (ArrowDown + Enter)', async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <Select rotulo="Tipo" opcoes={opcoes} onChange={handleChange} />,
    );

    const trigger = screen.getByRole('combobox');
    // Foca e abre com Enter
    trigger.focus();
    await user.keyboard('{Enter}');

    // Navega para baixo e seleciona
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(handleChange).toHaveBeenCalled();
  });

  it('fecha com Escape', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Select rotulo="Tipo" opcoes={opcoes} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    // Verifica que esta aberto
    expect(screen.getByRole('listbox')).toBeVisible();

    // Fecha com Escape
    await user.keyboard('{Escape}');

    // Listbox nao deve mais estar visivel
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('suporta className adicional no container', () => {
    const { container } = render(
      <Select opcoes={opcoes} className="mt-4" />,
    );
    expect(container.firstElementChild).toHaveClass('mt-4');
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <Select rotulo="Tipo" opcoes={opcoes} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nao tem violacoes de acessibilidade com erro', async () => {
    const { container } = render(
      <Select rotulo="Tipo" opcoes={opcoes} erro="Erro" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nao tem violacoes de acessibilidade quando desabilitado', async () => {
    const { container } = render(
      <Select rotulo="Tipo" opcoes={opcoes} disabled />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
