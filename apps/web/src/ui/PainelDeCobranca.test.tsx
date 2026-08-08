// apps/web/src/ui/PainelDeCobranca.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelDeCobranca } from './PainelDeCobranca';
import { ToastProvider } from './ToastProvider';

/* ── Mock do clipboard ──────────────────────────────────────────────────── */
const mockWriteText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockWriteText },
    writable: true,
    configurable: true,
  });
  mockWriteText.mockClear();
});

/* ── Props base ──────────────────────────────────────────────────────────── */
const PROPS_BASE = {
  aberto: true,
  pacienteNome: 'Maria Souza Lima',
  procedimentoNome: 'Consulta',
  valorSugeridoCentavos: 25000,
  aoRegistrar: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
  aoCriarLink: vi.fn(async () => ({
    linkUrl: 'https://pay.example.com/abc',
    linkId: 'lk1',
  })),
  aoFechar: vi.fn(),
};

function montar(over: Partial<typeof PROPS_BASE> = {}) {
  const props = {
    ...PROPS_BASE,
    aoRegistrar: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
    aoCriarLink: vi.fn(async () => ({
      linkUrl: 'https://pay.example.com/abc',
      linkId: 'lk1',
    })),
    aoFechar: vi.fn(),
    ...over,
  };
  const result = render(
    <ToastProvider>
      <PainelDeCobranca {...props} />
    </ToastProvider>,
  );
  return { props, ...result };
}

describe('PainelDeCobranca', () => {
  it('renderiza no PainelLateral quando aberto', () => {
    montar();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('mostra nome do paciente e procedimento', () => {
    montar();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.getByText('Consulta')).toBeVisible();
  });

  it('aceita valor monetario formatado', () => {
    montar();
    expect(screen.getByText('R$')).toBeInTheDocument();
    const campo = screen.getByLabelText(/Valor/i);
    expect(campo).toHaveValue('250,00');
  });

  it('renderiza opcoes de forma de pagamento', () => {
    montar();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(screen.getByText('PIX')).toBeInTheDocument();
    expect(screen.getByText('Dinheiro')).toBeInTheDocument();
    expect(screen.getByText('Cartao de credito')).toBeInTheDocument();
    expect(screen.getByText('Cartao de debito')).toBeInTheDocument();
    expect(screen.getByText('Boleto')).toBeInTheDocument();
  });

  it('seleciona forma de pagamento ao clicar', async () => {
    montar();
    // PIX esta pre-selecionado
    const pix = screen.getAllByRole('radio')[0]!;
    expect(pix).toBeChecked();
    // Selecionar Dinheiro
    const dinheiro = screen.getAllByRole('radio')[1]!;
    await userEvent.click(dinheiro);
    expect(dinheiro).toBeChecked();
    expect(pix).not.toBeChecked();
  });

  it('valida campo valor obrigatorio', async () => {
    montar({ valorSugeridoCentavos: 0 });
    await userEvent.click(
      screen.getByRole('button', { name: /Registrar pagamento/i }),
    );
    await waitFor(() => {
      expect(screen.getByText('Informe o valor')).toBeInTheDocument();
    });
  });

  it('chama callback ao registrar pagamento', async () => {
    const { props } = montar();
    await userEvent.click(
      screen.getByRole('button', { name: /Registrar pagamento/i }),
    );
    await waitFor(() => {
      expect(props.aoRegistrar).toHaveBeenCalledWith({
        amountCents: 25000,
        method: 'pix',
      });
    });
  });

  it('gera link de pagamento', async () => {
    const { props } = montar();
    await userEvent.click(
      screen.getByRole('button', { name: /Gerar link de pagamento/i }),
    );
    await waitFor(() => {
      expect(props.aoCriarLink).toHaveBeenCalledWith({
        amountCents: 25000,
      });
    });
    expect(
      screen.getByDisplayValue('https://pay.example.com/abc'),
    ).toBeInTheDocument();
  });

  it('copia link para clipboard', async () => {
    montar();
    await userEvent.click(
      screen.getByRole('button', { name: /Gerar link de pagamento/i }),
    );
    await waitFor(() =>
      screen.getByDisplayValue('https://pay.example.com/abc'),
    );
    await userEvent.click(screen.getByRole('button', { name: /Copiar/i }));
    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith(
        'https://pay.example.com/abc',
      );
    });
  });

  it('mostra toast ao copiar', async () => {
    montar();
    await userEvent.click(
      screen.getByRole('button', { name: /Gerar link de pagamento/i }),
    );
    await waitFor(() =>
      screen.getByDisplayValue('https://pay.example.com/abc'),
    );
    await userEvent.click(screen.getByRole('button', { name: /Copiar/i }));
    await waitFor(() => {
      expect(screen.getByText('Link copiado!')).toBeInTheDocument();
    });
  });

  it('nao renderiza nada quando fechado', () => {
    montar({ aberto: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = montar();
    expect(await axe(container)).toHaveNoViolations();
  });
});
