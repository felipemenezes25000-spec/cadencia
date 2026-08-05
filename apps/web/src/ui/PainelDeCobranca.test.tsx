// apps/web/src/ui/PainelDeCobranca.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelDeCobranca } from './PainelDeCobranca';

const PROPS_BASE = {
  aberto: true,
  pacienteNome: 'Maria Souza Lima',
  procedimentoNome: 'Consulta',
  valorSugeridoCentavos: 25000,
  aoRegistrar: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
  aoCriarLink: vi.fn(async () => ({ linkUrl: 'https://pay.example.com/abc', linkId: 'lk1' })),
  aoFechar: vi.fn(),
};

function montar(over: Partial<typeof PROPS_BASE> = {}) {
  const props = { ...PROPS_BASE, aoRegistrar: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
    aoCriarLink: vi.fn(async () => ({ linkUrl: 'https://pay.example.com/abc', linkId: 'lk1' })),
    aoFechar: vi.fn(), ...over };
  render(<PainelDeCobranca {...props} />);
  return props;
}

describe('PainelDeCobranca', () => {
  it('exibe o valor sugerido formatado em reais no campo editavel', () => {
    montar();
    const campo = screen.getByRole('textbox', { name: /Valor/i });
    expect(campo).toHaveValue('250,00');
  });

  it('pre-seleciona metodo "Dinheiro" e oferece quatro opcoes', () => {
    montar();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Dinheiro/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Cartão/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Pix/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Link/i })).toBeInTheDocument();
  });

  it('ao confirmar com metodo presencial chama aoRegistrar com centavos e metodo', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Registrar/i }));
    await waitFor(() => expect(props.aoRegistrar).toHaveBeenCalledWith({
      amountCents: 25000,
      method: 'dinheiro',
    }));
  });

  it('ao confirmar com metodo "Link" chama aoCriarLink em vez de aoRegistrar', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('radio', { name: /Link/i }));
    await userEvent.click(screen.getByRole('button', { name: /Enviar link/i }));
    await waitFor(() => expect(props.aoCriarLink).toHaveBeenCalledWith({
      amountCents: 25000,
    }));
    expect(props.aoRegistrar).not.toHaveBeenCalled();
  });

  it('permite editar o valor antes de registrar', async () => {
    const props = montar();
    const campo = screen.getByRole('textbox', { name: /Valor/i });
    await userEvent.clear(campo);
    await userEvent.type(campo, '300,00');
    await userEvent.click(screen.getByRole('button', { name: /Registrar/i }));
    await waitFor(() => expect(props.aoRegistrar).toHaveBeenCalledWith({
      amountCents: 30000,
      method: 'dinheiro',
    }));
  });

  it('mostra o nome do paciente e do procedimento no cabecalho', () => {
    montar();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.getByText('Consulta')).toBeVisible();
  });

  it('botao fica em estado carregando enquanto a promessa nao resolve', async () => {
    const aoRegistrar = vi.fn(() => new Promise<{ entryId: string; receiptNumber: number }>(() => {}));
    montar({ aoRegistrar });
    await userEvent.click(screen.getByRole('button', { name: /Registrar/i }));
    expect(screen.getByRole('button', { name: /Registrar/i })).toHaveAttribute('aria-busy', 'true');
  });

  it('nao renderiza nada quando fechado', () => {
    montar({ aberto: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<PainelDeCobranca {...PROPS_BASE} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
