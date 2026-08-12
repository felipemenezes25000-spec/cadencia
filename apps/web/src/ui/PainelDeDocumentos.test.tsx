import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PainelDeDocumentos } from './PainelDeDocumentos';
import { ToastProvider } from './ToastProvider';

function montar(over: Record<string, unknown> = {}) {
  const aoEmitir = vi.fn(async () => ({
    documentId: 'doc-1', urlPdf: '/x.pdf', assinado: true,
  }));
  const props = {
    aberto: true,
    pacienteNome: 'Yasmin Correia',
    aoEmitir,
    aoFechar: vi.fn(),
    ...over,
  };
  render(<ToastProvider><PainelDeDocumentos {...props} /></ToastProvider>);
  return props;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelDeDocumentos', () => {
  it('abre no atestado — é o documento que mais se emite', () => {
    montar();
    const atestado = screen.getByRole('radio', { name: /atestado/i });
    expect(atestado).toBeChecked();
  });

  it('o corpo já vem redigido, com o texto que a lei pede', () => {
    montar();
    const corpo = screen.getByRole('textbox', { name: /texto do documento/i });
    // Atestado em branco obriga o médico a redigir a mesma frase dez vezes por
    // dia, e frase redigida com pressa é frase que esquece o afastamento.
    expect((corpo as HTMLTextAreaElement).value).toMatch(/Atesto/i);
  });

  it('trocar o tipo troca o texto padrão', async () => {
    montar();
    fireEvent.click(screen.getByRole('radio', { name: /comparecimento/i }));
    await waitFor(() => {
      const corpo = screen.getByRole('textbox', { name: /texto do documento/i });
      expect((corpo as HTMLTextAreaElement).value).toMatch(/compareceu/i);
    });
  });

  it('não emite documento com corpo vazio', async () => {
    const { aoEmitir } = montar();
    const corpo = screen.getByRole('textbox', { name: /texto do documento/i });
    fireEvent.change(corpo, { target: { value: '   ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /emitir/i }));
    });
    // Documento assinado com corpo vazio é documento assinado em branco: o hash
    // sela o nada e a assinatura do médico fica valendo para uma folha vazia.
    expect(aoEmitir).not.toHaveBeenCalled();
    expect(screen.getByText(/escreva o texto/i)).toBeInTheDocument();
  });

  it('emite com o tipo e o corpo escolhidos', async () => {
    const { aoEmitir } = montar();
    fireEvent.click(screen.getByRole('radio', { name: /exame/i }));
    const corpo = screen.getByRole('textbox', { name: /texto do documento/i });
    fireEvent.change(corpo, { target: { value: 'Hemograma completo e TSH.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /emitir/i }));
    });
    expect(aoEmitir).toHaveBeenCalledWith({
      kind: 'pedido_exame',
      corpo: 'Hemograma completo e TSH.',
    });
  });

  it('avisa quando o documento saiu SEM assinatura', async () => {
    montar({ aoEmitir: vi.fn(async () => ({
      documentId: 'doc-1', urlPdf: '/x.pdf', assinado: false, motivo: 'psc_nao_contratado',
    })) });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /emitir/i }));
    });

    // Sem PSC contratado o atestado é emitido e fica pendente. Dizer só
    // "documento emitido" faz o médico entregar ao paciente um papel que o
    // INSS e o empregador vão recusar — e ele descobre pelo paciente.
    expect(await screen.findByText(/sem assinatura/i)).toBeInTheDocument();
  });

  it('não avisa nada quando o documento saiu assinado', async () => {
    montar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /emitir/i }));
    });
    await screen.findByRole('link', { name: /abrir|imprimir/i });
    expect(screen.queryByText(/sem assinatura/i)).not.toBeInTheDocument();
  });

  it('depois de emitir oferece o link para imprimir', async () => {
    montar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /emitir/i }));
    });
    const link = await screen.findByRole('link', { name: /abrir|imprimir/i });
    expect(link).toHaveAttribute('href', '/x.pdf');
    // Abre em aba nova: perder o prontuário aberto para ver um atestado é
    // perder o atendimento em andamento.
    expect(link).toHaveAttribute('target', '_blank');
  });
});
