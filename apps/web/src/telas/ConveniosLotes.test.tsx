// apps/web/src/telas/ConveniosLotes.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosLotes,
  type Lote,
  type LotesDados,
} from './ConveniosLotes';

const LOTES: readonly Lote[] = [
  {
    id: 'l1', numero: 'L-2026-001', operadoraNome: 'Unimed',
    registroAns: '123456', status: 'rascunho',
    totalGuias: 5, totalCentavos: 75000,
    criadoEm: '2026-08-05', enviadoEm: null,
    guias: [
      { id: 'g1', numeroGuia: '000001', pacienteNome: 'Maria Souza',
        codigoProcedimento: '10101012', valorCentavos: 15000, sequencial: 1 },
      { id: 'g2', numeroGuia: '000002', pacienteNome: 'Joao Silva',
        codigoProcedimento: '10101012', valorCentavos: 18000, sequencial: 2 },
    ],
  },
  {
    id: 'l2', numero: 'L-2026-002', operadoraNome: 'Bradesco Saude',
    registroAns: '654321', status: 'enviado',
    totalGuias: 3, totalCentavos: 45000,
    criadoEm: '2026-08-03', enviadoEm: '2026-08-04',
    guias: [
      { id: 'g3', numeroGuia: '000003', pacienteNome: 'Ana Costa',
        codigoProcedimento: '20201015', valorCentavos: 15000, sequencial: 1 },
    ],
  },
  {
    id: 'l3', numero: 'L-2026-003', operadoraNome: 'Unimed',
    registroAns: '123456', status: 'processado',
    totalGuias: 8, totalCentavos: 120000,
    criadoEm: '2026-08-01', enviadoEm: '2026-08-02',
    guias: [],
  },
];

const DADOS: LotesDados = { lotes: LOTES };

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoEnviar: vi.fn(async (_id: string) => {}),
    aoCancelar: vi.fn(async (_id: string) => {}),
    aoBaixarXml: vi.fn(async (_id: string) => {}),
  };
  render(<ConveniosLotes {...props} />);
  return props;
}

describe('ConveniosLotes', () => {
  it('lista os lotes com numero, operadora e total de guias', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    expect(screen.getByText('L-2026-002')).toBeVisible();
    expect(screen.getByText('L-2026-003')).toBeVisible();
  });

  it('exibe chip de status com cores corretas', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Rascunho')).toBeVisible());
    expect(screen.getByText('Enviado')).toBeVisible();
    expect(screen.getByText('Processado')).toBeVisible();
  });

  it('exibe o valor total do lote formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 750,00')).toBeVisible());
    expect(screen.getByText('R$ 450,00')).toBeVisible();
  });

  it('lote rascunho tem botoes Enviar e Cancelar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const linha = screen.getByText('L-2026-001').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByRole('button', { name: /Enviar/i })).toBeVisible();
    expect(within(linha!).getByRole('button', { name: /Cancelar/i })).toBeVisible();
  });

  it('lote enviado tem botao Baixar XML e nao tem Enviar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-002')).toBeVisible());
    const linha = screen.getByText('L-2026-002').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByRole('button', { name: /Baixar XML/i })).toBeVisible();
    expect(within(linha!).queryByRole('button', { name: /^Enviar$/i })).not.toBeInTheDocument();
  });

  it('ao clicar Enviar chama aoEnviar com o id do lote', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const linha = screen.getByText('L-2026-001').closest('li');
    await userEvent.click(within(linha!).getByRole('button', { name: /Enviar/i }));
    expect(props.aoEnviar).toHaveBeenCalledWith('l1');
  });

  it('ao clicar Baixar XML chama aoBaixarXml com o id do lote', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('L-2026-002')).toBeVisible());
    const linha = screen.getByText('L-2026-002').closest('li');
    await userEvent.click(within(linha!).getByRole('button', { name: /Baixar XML/i }));
    expect(props.aoBaixarXml).toHaveBeenCalledWith('l2');
  });

  it('expandir lote mostra as guias com sequencial e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const expandir = screen.getAllByRole('button', { name: /Expandir/i })[0]!;
    await userEvent.click(expandir);
    expect(screen.getByText('000001')).toBeVisible();
    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('Joao Silva')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosLotes
        carregarDados={async () => DADOS}
        aoEnviar={async () => {}}
        aoCancelar={async () => {}}
        aoBaixarXml={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
