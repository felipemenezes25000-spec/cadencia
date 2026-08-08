// apps/web/src/telas/ConveniosRetornos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosRetornos,
  type RetornosDados,
  type FiltrosRetornos,
} from './ConveniosRetornos';

const DADOS: RetornosDados = {
  demonstrativos: [
    {
      id: 'd1',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      registroAns: '123456',
      protocolo: 'PROT-001',
      tipo: 'analise',
      dataImportacao: '2026-08-01',
      periodoInicio: '2026-07-01',
      periodoFim: '2026-07-31',
      totalApresentadoCentavos: 500000,
      totalProcessadoCentavos: 480000,
      totalLiberadoCentavos: 450000,
      totalGlosadoCentavos: 30000,
      totalItens: 15,
      itensGlosados: 3,
    },
    {
      id: 'd2',
      operadoraNome: 'Bradesco Saude',
      operadoraId: 'op2',
      registroAns: '654321',
      protocolo: 'PROT-002',
      tipo: 'pagamento',
      dataImportacao: '2026-08-02',
      periodoInicio: '2026-07-01',
      periodoFim: '2026-07-31',
      totalApresentadoCentavos: 300000,
      totalProcessadoCentavos: 300000,
      totalLiberadoCentavos: 300000,
      totalGlosadoCentavos: 0,
      totalItens: 10,
      itensGlosados: 0,
    },
  ],
  operadoras: [
    { id: 'op1', nome: 'Unimed', registroAns: '123456' },
    { id: 'op2', nome: 'Bradesco Saude', registroAns: '654321' },
  ],
  totais: {
    apresentadoCentavos: 800000,
    processadoCentavos: 780000,
    liberadoCentavos: 750000,
    glosadoCentavos: 30000,
  },
};

function montar(overrides: Partial<{
  carregarDados: (f: FiltrosRetornos) => Promise<RetornosDados>;
  aoImportarXml: (arquivo: File) => Promise<void>;
  aoAbrirDemonstrativo: (id: string) => void;
}> = {}) {
  const carregarDados = vi.fn<(f: FiltrosRetornos) => Promise<RetornosDados>>()
    .mockResolvedValue(DADOS);
  const aoImportarXml = vi.fn<(arquivo: File) => Promise<void>>()
    .mockResolvedValue(undefined);
  const aoAbrirDemonstrativo = vi.fn();

  render(
    <ConveniosRetornos
      carregarDados={overrides.carregarDados ?? carregarDados}
      aoImportarXml={overrides.aoImportarXml ?? aoImportarXml}
      aoAbrirDemonstrativo={overrides.aoAbrirDemonstrativo ?? aoAbrirDemonstrativo}
    />,
  );
  return { carregarDados, aoImportarXml, aoAbrirDemonstrativo };
}

describe('ConveniosRetornos', () => {
  it('renderiza totalizadores: apresentado, processado, liberado, glosado', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/Apresentado/i)).toBeVisible();
    });
    const grupo = screen.getByRole('group', { name: /Totalizadores de retornos/i });
    expect(grupo).toBeVisible();
    expect(within(grupo).getByText('R$ 8.000,00')).toBeVisible();
    expect(within(grupo).getByText('R$ 7.800,00')).toBeVisible();
    expect(within(grupo).getByText('R$ 7.500,00')).toBeVisible();
    expect(within(grupo).getByText('R$ 300,00')).toBeVisible();
  });

  it('renderiza lista de demonstrativos com protocolo, operadora e tipo', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(screen.getByText('PROT-002')).toBeVisible();
    const lista = screen.getByLabelText(/Demonstrativos importados/i);
    expect(within(lista).getByText('Unimed')).toBeVisible();
    expect(within(lista).getByText('Bradesco Saude')).toBeVisible();
    expect(within(lista).getByText(/Analise/i)).toBeVisible();
    expect(within(lista).getByText(/Pagamento/i)).toBeVisible();
  });

  it('exibe badge de itens glosados quando ha glosas', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(screen.getByText(/3 glosa/i)).toBeVisible();
  });

  it('ao clicar em um demonstrativo chama aoAbrirDemonstrativo', async () => {
    const { aoAbrirDemonstrativo } = montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    await userEvent.click(screen.getByText('PROT-001'));
    expect(aoAbrirDemonstrativo).toHaveBeenCalledWith('d1');
  });

  it('renderiza filtros de operadora, periodo e tipo', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByLabelText(/Operadora/i)).toBeVisible();
    });
    expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible();
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
    expect(screen.getByLabelText(/Tipo/i)).toBeVisible();
  });

  it('botao Importar esta visivel', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Importar/i })).toBeVisible();
    });
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosRetornos
        carregarDados={async () => DADOS}
        aoImportarXml={async () => {}}
        aoAbrirDemonstrativo={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
