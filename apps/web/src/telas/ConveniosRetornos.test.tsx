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

const DADOS_VAZIO: RetornosDados = {
  demonstrativos: [],
  operadoras: [],
  totais: {
    apresentadoCentavos: 0,
    processadoCentavos: 0,
    liberadoCentavos: 0,
    glosadoCentavos: 0,
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
  it('renderiza skeleton enquanto carrega', () => {
    // carregarDados nunca resolve — mantem estado de carregamento
    const carregarDados = vi.fn<(f: FiltrosRetornos) => Promise<RetornosDados>>()
      .mockReturnValue(new Promise(() => {}));
    render(
      <ConveniosRetornos
        carregarDados={carregarDados}
        aoImportarXml={async () => {}}
        aoAbrirDemonstrativo={() => {}}
      />,
    );
    const skeletons = screen.getAllByRole('status');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    expect(skeletons[0]).toBeVisible();
  });

  it('renderiza tabela com dados', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(screen.getByText('PROT-002')).toBeVisible();
    // Verifica tabela com cabecalhos
    expect(screen.getByText('Lote')).toBeVisible();
    expect(screen.getByText('Operadora', { selector: 'th' })).toBeVisible();
    // Dados na tabela
    const secao = screen.getByRole('region', { name: /Demonstrativos importados/i });
    expect(within(secao).getByText('Unimed')).toBeVisible();
    expect(within(secao).getByText('Bradesco Saude')).toBeVisible();
  });

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

  it('filtra por status (tipo)', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    const select = screen.getByLabelText(/Tipo/i);
    await userEvent.selectOptions(select, 'analise');
    // So PROT-001 (analise) deve aparecer
    expect(screen.getByText('PROT-001')).toBeVisible();
    expect(screen.queryByText('PROT-002')).not.toBeInTheDocument();
  });

  it('filtra por operadora', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    const select = screen.getByLabelText(/Operadora/i);
    await userEvent.selectOptions(select, 'op2');
    // So PROT-002 (Bradesco) deve aparecer
    expect(screen.queryByText('PROT-001')).not.toBeInTheDocument();
    expect(screen.getByText('PROT-002')).toBeVisible();
  });

  it('busca por texto', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    const camposBusca = screen.getByLabelText(/Buscar retornos/i);
    await userEvent.type(camposBusca, 'Bradesco');
    expect(screen.queryByText('PROT-001')).not.toBeInTheDocument();
    expect(screen.getByText('PROT-002')).toBeVisible();
  });

  it('navega para detalhe ao clicar na linha', async () => {
    const { aoAbrirDemonstrativo } = montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    await userEvent.click(screen.getByText('PROT-001'));
    expect(aoAbrirDemonstrativo).toHaveBeenCalledWith('d1');
  });

  it('mostra chip de status correto', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    const secao = screen.getByRole('region', { name: /Demonstrativos importados/i });
    // Chips de tipo dentro da tabela
    expect(within(secao).getByText(/Análise/i)).toBeVisible();
    expect(within(secao).getByText(/Pagamento/i)).toBeVisible();
  });

  it('mostra estado vazio', async () => {
    const carregarDados = vi.fn<(f: FiltrosRetornos) => Promise<RetornosDados>>()
      .mockResolvedValue(DADOS_VAZIO);
    render(
      <ConveniosRetornos
        carregarDados={carregarDados}
        aoImportarXml={async () => {}}
        aoAbrirDemonstrativo={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Nenhum demonstrativo encontrado/i)).toBeVisible();
    });
  });

  it('botao Importar esta visivel', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Importar/i })).toBeVisible();
    });
  });

  it('nao tem violacoes de acessibilidade', async () => {
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
