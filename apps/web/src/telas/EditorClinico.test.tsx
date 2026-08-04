import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { EditorClinico } from './EditorClinico';

function montar(over = {}) {
  const props = {
    encounterId: 'e1',
    buscarCodigo: vi.fn(async () => [{ code: 'I10', display: 'Hipertensão essencial' }]),
    buscarModelo: vi.fn(async () => [{ code: 'retorno', texto: 'Retorno em 30 dias.' }]),
    buscarValorAnterior: vi.fn(async () => ({ valor: '72,4 kg', em: '12/05/2026' })),
    aoPrescrever: vi.fn(),
    aoPedirExame: vi.fn(),
    aoEmitirDocumento: vi.fn(),
    aoFinalizar: vi.fn(),
    ...over,
  };
  render(<EditorClinico {...props} />);
  return props;
}

describe('editor clinico', () => {
  it('Ctrl+R chama aoPrescrever — o painel abre AO LADO, sem sair do documento', () => {
    const { aoPrescrever } = montar();
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: 'r', ctrlKey: true });
    expect(aoPrescrever).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+E chama aoPedirExame', () => {
    const { aoPedirExame } = montar();
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: 'e', ctrlKey: true });
    expect(aoPedirExame).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+D chama aoEmitirDocumento', () => {
    const { aoEmitirDocumento } = montar();
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: 'd', ctrlKey: true });
    expect(aoEmitirDocumento).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter chama aoFinalizar', () => {
    const { aoFinalizar } = montar();
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(aoFinalizar).toHaveBeenCalledTimes(1);
  });

  it('o cronometro do atendimento aparece visivel', () => {
    montar();
    expect(screen.getByText(/Duração/)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <EditorClinico encounterId="e1"
        buscarCodigo={async () => []} buscarModelo={async () => []}
        buscarValorAnterior={async () => null}
        aoPrescrever={vi.fn()} aoPedirExame={vi.fn()}
        aoEmitirDocumento={vi.fn()} aoFinalizar={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('article')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
