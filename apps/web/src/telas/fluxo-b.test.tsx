import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TelaDeAtendimento } from './TelaDeAtendimento';

function montar(over = {}) {
  const props = {
    encounterId: 'e1', pacienteNome: 'Maria Souza Lima',
    abrirSessaoDoPrescritor: vi.fn(async () => ({ mode: 'embedded' as const })),
    buscarCodigo: vi.fn(async () => [{ code: 'I10', display: 'Hipertensão essencial' }]),
    buscarModelo: vi.fn(async () => [{ code: 'retorno', texto: 'Retorno em 30 dias.' }]),
    buscarValorAnterior: vi.fn(async () => ({ valor: '72,4 kg', em: '12/05/2026' })),
    aoConfirmarPrescricao: vi.fn(async () => ({ prescriptionId: 'rx1' })),
    aoFinalizar: vi.fn(async () => ({ versionId: 'v1', versionNo: 1 })),
    ...over,
  };
  render(<TelaDeAtendimento {...props} />);
  return props;
}

describe('fluxo critico (b) — medico atende, prescreve e finaliza', () => {
  it('a sessao do prescritor carrega em BACKGROUND quando o atendimento abre', async () => {
    const { abrirSessaoDoPrescritor } = montar();
    await waitFor(() => expect(abrirSessaoDoPrescritor).toHaveBeenCalledTimes(1));
  });

  it('Ctrl+R abre o painel de prescricao AO LADO — o atendimento continua visivel', async () => {
    montar();
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: 'r', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: /Prescrever/ })).toBeVisible();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
  });

  it('Ctrl+Enter chama aoFinalizar e oferece "Proximo paciente"', async () => {
    const { aoFinalizar } = montar();
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(aoFinalizar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Próximo paciente/ })).toBeVisible());
  });

  it('a assinatura NAO bloqueia: PSC fora do ar finaliza e joga a pendencia para depois', async () => {
    const aoFinalizar = vi.fn(async () => ({ versionId: 'v1', versionNo: 1 }));
    const aoConfirmarPrescricao = vi.fn(async () => {
      throw { codigo: 'parceiro_indisponivel' };
    });
    montar({ aoFinalizar, aoConfirmarPrescricao });
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(aoFinalizar).toHaveBeenCalled());
    expect(screen.queryByRole('alert', { name: /erro/i })).not.toBeInTheDocument();
  });
});
