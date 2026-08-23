import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PainelDeAnexos, type Anexo, type PedidoExamePendente } from './PainelDeAnexos';

const EXISTENTES: Anexo[] = [
  {
    attachmentId: 'a1', kind: 'resultado_exame', originalName: 'hemograma.pdf',
    contentType: 'application/pdf', sizeBytes: 240_000, criadoEm: '2026-08-01T10:00:00-03:00',
    requestDocumentId: 'p1', pedidoTitulo: 'Hemograma completo',
  },
  {
    attachmentId: 'a2', kind: 'imagem', originalName: 'lesao.jpg',
    contentType: 'image/jpeg', sizeBytes: 1_500_000, criadoEm: '2026-07-20T09:00:00-03:00',
  },
];

const PEDIDOS: PedidoExamePendente[] = [
  {
    documentId: 'p1', titulo: 'Hemograma completo', issuedDate: '2026-08-10',
    encounterId: null, resultados: 0,
  },
  {
    documentId: 'p2', titulo: 'TSH e T4 livre', issuedDate: '2026-08-09',
    encounterId: null, resultados: 0,
  },
];

function montar(over: Record<string, unknown> = {}) {
  const props = {
    aberto: true,
    anexos: EXISTENTES,
    aoEnviar: vi.fn(async (_d: { arquivo: File; kind: string; requestDocumentId?: string }) => {}),
    aoAbrir: vi.fn(async () => {}),
    aoFechar: vi.fn(),
    ...over,
  };
  render(<PainelDeAnexos {...props} />);
  return props;
}

function arquivo(nome: string, tipo: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], nome, { type: tipo });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PainelDeAnexos', () => {
  it('lista os anexos com tamanho legível e origem do resultado', () => {
    montar();
    expect(screen.getByText('hemograma.pdf')).toBeInTheDocument();
    const tudo = document.body.textContent ?? '';
    expect(tudo).toContain('234 KB');
    expect(tudo).toContain('1,43 MB');
    expect(tudo).toContain('Vinculado a: Hemograma completo');
  });

  it('sem anexo, explica em vez de mostrar caixa vazia', () => {
    montar({ anexos: [] });
    expect(screen.getByText(/nenhum arquivo/i)).toBeInTheDocument();
  });

  it('envia arquivo sem vínculo quando não existe pedido pendente', async () => {
    const { aoEnviar } = montar({ pedidosExamePendentes: [] });
    const entrada = screen.getByLabelText(/escolher arquivo/i);
    const f = arquivo('exame.pdf', 'application/pdf', 100);
    await act(async () => {
      fireEvent.change(entrada, { target: { files: [f] } });
    });
    await waitFor(() => expect(aoEnviar).toHaveBeenCalled());
    const chamada = aoEnviar.mock.calls[0] as unknown as [{ arquivo: File; requestDocumentId?: string }];
    expect(chamada[0].arquivo.name).toBe('exame.pdf');
    expect(chamada[0].requestDocumentId).toBeUndefined();
  });

  it('resultado com pedido pendente exige escolher a solicitação antes do arquivo', () => {
    montar({ pedidosExamePendentes: PEDIDOS });
    const seletor = screen.getByLabelText(/pedido de exame correspondente/i);
    expect(seletor).toHaveTextContent('Hemograma completo · 10/08/26');
    expect(screen.getByLabelText(/escolher arquivo/i)).toBeDisabled();
    fireEvent.change(seletor, { target: { value: 'p1' } });
    expect(screen.getByLabelText(/escolher arquivo/i)).not.toBeDisabled();
  });

  it('envia resultado vinculado ao pedido selecionado', async () => {
    const { aoEnviar } = montar({ pedidosExamePendentes: PEDIDOS });
    fireEvent.change(screen.getByLabelText(/pedido de exame correspondente/i), {
      target: { value: 'p2' },
    });
    const f = arquivo('tireoide.pdf', 'application/pdf', 100);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/escolher arquivo/i), { target: { files: [f] } });
    });
    await waitFor(() => expect(aoEnviar).toHaveBeenCalled());
    expect(aoEnviar).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'resultado_exame',
      requestDocumentId: 'p2',
    }));
  });

  it('recusa arquivo acima de 20 MB antes de subir', async () => {
    const { aoEnviar } = montar({ pedidosExamePendentes: [] });
    const entrada = screen.getByLabelText(/escolher arquivo/i);
    const grande = arquivo('tomografia.zip', 'application/zip', 21 * 1024 * 1024);
    await act(async () => {
      fireEvent.change(entrada, { target: { files: [grande] } });
    });
    expect(aoEnviar).not.toHaveBeenCalled();
    expect(await screen.findByText(/20 MB/i)).toBeInTheDocument();
  });

  it('abrir chama o pai — o download precisa de cabeçalho, não de href', async () => {
    const { aoAbrir } = montar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /hemograma\.pdf/i }));
    });
    expect(aoAbrir).toHaveBeenCalledWith('a1');
  });
});
