// apps/web/src/telas/CompositorDeMensagem.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { axe } from 'vitest-axe';
import { CompositorDeMensagem } from './CompositorDeMensagem';

function montar(
  overrides: Partial<Parameters<typeof CompositorDeMensagem>[0]> = {},
) {
  const props = {
    onEnviar: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...render(
      <RadixTooltip.Provider delayDuration={0}>
        <CompositorDeMensagem {...props} />
      </RadixTooltip.Provider>,
    ),
  };
}

describe('CompositorDeMensagem', () => {
  it('renderiza textarea e botão enviar', () => {
    montar();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Enviar mensagem/ }),
    ).toBeInTheDocument();
  });

  it('envia mensagem ao clicar Enviar', async () => {
    const user = userEvent.setup();
    const { props } = montar();

    await user.type(screen.getByRole('textbox'), 'Ola paciente');
    await user.click(screen.getByRole('button', { name: /Enviar mensagem/ }));

    expect(props.onEnviar).toHaveBeenCalledWith('Ola paciente', undefined);
  });

  it('envia mensagem ao pressionar Enter', async () => {
    const user = userEvent.setup();
    const { props } = montar();

    await user.type(screen.getByRole('textbox'), 'Mensagem via Enter{Enter}');

    expect(props.onEnviar).toHaveBeenCalledWith(
      'Mensagem via Enter',
      undefined,
    );
  });

  it('insere nova linha com Shift+Enter', async () => {
    const user = userEvent.setup();
    const { props } = montar();

    await user.type(
      screen.getByRole('textbox'),
      'Linha 1{Shift>}{Enter}{/Shift}Linha 2',
    );

    expect(props.onEnviar).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Linha 1\nLinha 2');
  });

  it('não envia mensagem vazia', async () => {
    const user = userEvent.setup();
    const { props } = montar();

    await user.click(screen.getByRole('button', { name: /Enviar mensagem/ }));

    expect(props.onEnviar).not.toHaveBeenCalled();
  });

  it('limpa texto após enviar', async () => {
    const user = userEvent.setup();
    montar();

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Texto para limpar');
    await user.click(screen.getByRole('button', { name: /Enviar mensagem/ }));

    expect(textarea).toHaveValue('');
  });

  it('mostra preview de arquivo anexado', async () => {
    montar();

    const file = new File(['conteudo'], 'receita.pdf', {
      type: 'application/pdf',
    });
    const input = screen.getByLabelText('Anexar arquivo');

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('receita.pdf')).toBeInTheDocument();
  });

  it('remove arquivo anexado', async () => {
    const user = userEvent.setup();
    montar();

    const file = new File(['conteudo'], 'exame.pdf', {
      type: 'application/pdf',
    });
    const input = screen.getByLabelText('Anexar arquivo');

    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('exame.pdf')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Remover exame.pdf/ }));
    expect(screen.queryByText('exame.pdf')).not.toBeInTheDocument();
  });

  it('auto-redimensiona textarea', async () => {
    const user = userEvent.setup();
    montar();

    const textarea = screen.getByRole('textbox');
    Object.defineProperty(textarea, 'scrollHeight', {
      value: 80,
      configurable: true,
    });

    await user.type(textarea, 'Linha com conteudo');

    expect(textarea.style.height).toBe('80px');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(
      <RadixTooltip.Provider delayDuration={0}>
        <CompositorDeMensagem onEnviar={vi.fn()} />
      </RadixTooltip.Provider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
