// apps/web/src/telas/ConveniosLotes.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    ],
  },
  {
    id: 'l2', numero: 'L-2026-002', operadoraNome: 'Bradesco Saude',
    registroAns: '654321', status: 'enviado',
    totalGuias: 3, totalCentavos: 45000,
    criadoEm: '2026-08-03', enviadoEm: '2026-08-04',
    guias: [],
  },
  {
    id: 'l3', numero: 'L-2026-003', operadoraNome: 'Unimed',
    registroAns: '123456', status: 'processando',
    totalGuias: 8, totalCentavos: 120000,
    criadoEm: '2026-08-01', enviadoEm: null,
    guias: [],
    progresso: 65,
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
  it('renderiza grid de lotes', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    // Verifica que todos os lotes estao presentes
    expect(screen.getByText('L-2026-002')).toBeVisible();
    expect(screen.getByText('L-2026-003')).toBeVisible();
    // Verifica que ha um container de grid (section com aria-label)
    expect(screen.getByLabelText('Lista de lotes')).toBeVisible();
  });

  it('mostra numero, operadora, valor total', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    // Numero do lote
    expect(screen.getByText('L-2026-001')).toBeVisible();
    // Nome da operadora (Unimed aparece em 2 lotes)
    expect(screen.getAllByText('Unimed')).toHaveLength(2);
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    // Valor total formatado
    expect(screen.getByText('R$ 750,00')).toBeVisible();
    expect(screen.getByText('R$ 450,00')).toBeVisible();
    // Total de guias
    expect(screen.getByText('5 guias')).toBeVisible();
  });

  it('mostra ChipDeStatusTiss', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Rascunho')).toBeVisible());
    expect(screen.getByText('Enviado')).toBeVisible();
    // Processando tem chip customizado
    expect(screen.getByText('Processando')).toBeVisible();
  });

  it('mostra barra de progresso quando processando', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-003')).toBeVisible());
    // Barra de progresso visivel
    expect(screen.getByTestId('barra-progresso')).toBeVisible();
    // Texto de porcentagem
    expect(screen.getByText('65%')).toBeVisible();
    // Elemento progressbar com aria
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '65');
  });

  it('filtra ao digitar na busca', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('L-2026-001')).toBeVisible());
    const campoBusca = screen.getByLabelText('Buscar lote');
    await userEvent.type(campoBusca, 'Bradesco');
    // Apenas o lote Bradesco deve estar visivel
    expect(screen.getByText('L-2026-002')).toBeVisible();
    expect(screen.queryByText('L-2026-001')).not.toBeInTheDocument();
    expect(screen.queryByText('L-2026-003')).not.toBeInTheDocument();
  });

  it('nao tem violacoes de acessibilidade', async () => {
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
