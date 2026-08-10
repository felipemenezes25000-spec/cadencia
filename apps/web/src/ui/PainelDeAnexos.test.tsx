import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PainelDeAnexos, type Anexo } from './PainelDeAnexos';

const EXISTENTES: Anexo[] = [
  {
    attachmentId: 'a1', kind: 'resultado_exame', originalName: 'hemograma.pdf',
    contentType: 'application/pdf', sizeBytes: 240_000, criadoEm: '2026-08-01T10:00:00-03:00',
  },
  {
    attachmentId: 'a2', kind: 'imagem', originalName: 'lesao.jpg',
    contentType: 'image/jpeg', sizeBytes: 1_500_000, criadoEm: '2026-07-20T09:00:00-03:00',
  },
];

function montar(over: Record<string, unknown> = {}) {
  const props = {
    aberto: true,
    anexos: EXISTENTES,
    aoEnviar: vi.fn(async (_d: { arquivo: File; kind: string }) => {}),
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
  it('lista os anexos com tamanho legivel', () => {
    montar();
    expect(screen.getByText('hemograma.pdf')).toBeInTheDocument();
    // "240000 bytes" nao diz nada a quem esta decidindo se abre o arquivo no
    // meio da consulta; "234 KB" diz. O tamanho vive dentro da linha de
    // metadados, entao a busca e por SUBSTRING e nao pelo texto inteiro do no.
    const tudo = document.body.textContent ?? '';
    expect(tudo).toContain('234 KB');
    expect(tudo).toContain('1,43 MB');
  });

  it('sem anexo, explica em vez de mostrar caixa vazia', () => {
    montar({ anexos: [] });
    expect(screen.getByText(/nenhum arquivo/i)).toBeInTheDocument();
  });

  it('envia o arquivo escolhido', async () => {
    const { aoEnviar } = montar();
    const entrada = screen.getByLabelText(/escolher arquivo/i);
    const f = arquivo('exame.pdf', 'application/pdf', 100);
    await act(async () => {
      fireEvent.change(entrada, { target: { files: [f] } });
    });
    await waitFor(() => expect(aoEnviar).toHaveBeenCalled());
    const chamada = aoEnviar.mock.calls[0] as unknown as [{ arquivo: File }];
    expect(chamada[0].arquivo.name).toBe('exame.pdf');
  });

  it('recusa arquivo acima de 20 MB antes de subir', async () => {
    const { aoEnviar } = montar();
    const entrada = screen.getByLabelText(/escolher arquivo/i);
    const grande = arquivo('tomografia.zip', 'application/zip', 21 * 1024 * 1024);
    await act(async () => {
      fireEvent.change(entrada, { target: { files: [grande] } });
    });
    // A API tambem recusa, mas so depois de o celular da recepcao gastar a
    // franquia subindo 21 MB. Barrar aqui poupa a subida inteira.
    expect(aoEnviar).not.toHaveBeenCalled();
    expect(await screen.findByText(/20 MB/i)).toBeInTheDocument();
  });

  it('abrir chama o pai — o download precisa de cabecalho, nao de href', async () => {
    const { aoAbrir } = montar();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /hemograma\.pdf/i }));
    });
    // `<a href>` nao carrega `x-clinic-id` e a rota recusaria. Quem baixa e o
    // pai, com os cabecalhos certos.
    expect(aoAbrir).toHaveBeenCalledWith('a1');
  });
});
