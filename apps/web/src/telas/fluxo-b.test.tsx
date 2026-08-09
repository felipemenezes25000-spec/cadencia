import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { ToastProvider } from '../ui/ToastProvider';
import { TelaDeAtendimento } from './TelaDeAtendimento';

/* ── polyfills para jsdom ─────────────────────────────────────────────── */

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;
  }
  if (typeof globalThis.DOMRect === 'undefined') {
    // @ts-ignore - polyfill basico
    globalThis.DOMRect = class DOMRect {
      x = 0; y = 0; width = 0; height = 0;
      top = 0; right = 0; bottom = 0; left = 0;
      toJSON() { return {}; }
      static fromRect() { return new DOMRect(); }
    };
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (typeof globalThis.ClipboardEvent === 'undefined') {
    // @ts-ignore - polyfill basico
    globalThis.ClipboardEvent = class ClipboardEvent extends Event {
      clipboardData: DataTransfer | null = null;
      constructor(type: string, init?: EventInit) { super(type, init); }
    };
  }
});

/* ── Mock do EditorClinico (evita TipTap no jsdom) ─────────────────── */

vi.mock('./EditorClinico', () => ({
  EditorClinico: (props: {
    encounterId: string;
    aoPrescrever: () => void;
    aoFinalizar: () => void;
  }) => (
    <div data-testid="editor-clinico" data-encounter={props.encounterId}>
      <button type="button" onClick={props.aoPrescrever}>Mock prescrever</button>
      <button type="button" onClick={props.aoFinalizar}>Mock finalizar</button>
    </div>
  ),
}));

/* ── Mock do PainelLateral ────────────────────────────────────────── */

vi.mock('../ui/PainelLateral', () => ({
  PainelLateral: ({ aberto, titulo, children }: {
    aberto: boolean;
    titulo?: string;
    children: ReactNode;
  }) =>
    aberto ? <div data-testid="painel-lateral" aria-label={titulo}>{children}</div> : null,
}));

/* ── Mock do PainelDeCobranca ─────────────────────────────────────── */

vi.mock('../ui/PainelDeCobranca', () => ({
  PainelDeCobranca: ({ aberto }: { aberto: boolean }) =>
    aberto ? <div data-testid="painel-cobranca">Cobranca</div> : null,
}));

/** Wrapper com providers necessarios. */
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={0}>
      <ToastProvider>{children}</ToastProvider>
    </RadixTooltip.Provider>
  );
}

function montar(over = {}) {
  const props = {
    encounterId: 'e1', pacienteNome: 'Maria Souza Lima',
    procedimentoNome: 'Consulta', valorSugeridoCentavos: 25000,
    abrirSessaoDoPrescritor: vi.fn(async () => ({ mode: 'embedded' as const })),
    buscarCodigo: vi.fn(async () => [{ code: 'I10', display: 'Hipertensão essencial' }]),
    buscarModelo: vi.fn(async () => [{ code: 'retorno', texto: 'Retorno em 30 dias.' }]),
    buscarValorAnterior: vi.fn(async () => ({ valor: '72,4 kg', em: '12/05/2026' })),
    aoConfirmarPrescricao: vi.fn(async () => ({ prescriptionId: 'rx1' })),
    aoFinalizar: vi.fn(async () => ({ versionId: 'v1', versionNo: 1 })),
    aoRegistrarPagamento: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
    aoCriarLinkPagamento: vi.fn(async () => ({ linkUrl: 'https://pay.example.com/abc', linkId: 'lk1' })),
    inicio: new Date(),
    paciente: {
      nome: 'Maria Souza Lima',
      nascimento: '1985-03-15',
      sexo: 'Feminino',
      convenio: 'Unimed',
      alergias: [],
      medicamentos: [],
      ultimosAtendimentos: [],
    },
    ...over,
  };
  render(<TelaDeAtendimento {...props} />, { wrapper: Wrapper });
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

  it('Ctrl+$ abre o painel de cobranca ao lado do atendimento', async () => {
    montar();
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: '$', ctrlKey: true });
    const dialog = screen.getByRole('dialog', { name: /Cobrar/ });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText('Maria Souza Lima')).toBeVisible();
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
