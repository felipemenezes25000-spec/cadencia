// apps/web/src/telas/ConveniosGlosas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosGlosas,
  type GlosasDados,
  type FiltrosGlosas,
} from './ConveniosGlosas';

const DADOS: GlosasDados = {
  glosas: [
    {
      id: 'gl1',
      demonstrativoId: 'd1',
      guiaNumero: '000001',
      pacienteNome: 'Carlos Melo',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      codigoProcedimento: '10101012',
      nomeProcedimento: 'Consulta',
      codigoGlosa: '1005',
      descricaoGlosa: 'Procedimento nao autorizado',
      valorApresentadoCentavos: 15000,
      valorGlosadoCentavos: 15000,
      dataAtendimento: '2026-07-15',
      status: 'pendente',
    },
    {
      id: 'gl2',
      demonstrativoId: 'd1',
      guiaNumero: '000002',
      pacienteNome: 'Ana Silva',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      codigoProcedimento: '10101012',
      nomeProcedimento: 'Consulta',
      codigoGlosa: '1015',
      descricaoGlosa: 'Fora do prazo',
      valorApresentadoCentavos: 15000,
      valorGlosadoCentavos: 8000,
      dataAtendimento: '2026-07-16',
      status: 'pendente',
    },
    {
      id: 'gl3',
      demonstrativoId: 'd1',
      guiaNumero: '000003',
      pacienteNome: 'Jose Santos',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      codigoProcedimento: '10101012',
      nomeProcedimento: 'Consulta',
      codigoGlosa: '1005',
      descricaoGlosa: 'Procedimento nao autorizado',
      valorApresentadoCentavos: 15000,
      valorGlosadoCentavos: 15000,
      dataAtendimento: '2026-07-17',
      status: 'recurso_enviado',
    },
  ],
  operadoras: [
    { id: 'op1', nome: 'Unimed', registroAns: '123456' },
  ],
  totalGlosadoPendenteCentavos: 23000,
};

const DADOS_VAZIO: GlosasDados = {
  glosas: [],
  operadoras: [],
  totalGlosadoPendenteCentavos: 0,
};

function montar(overrides: Partial<{
  carregarDados: (f: FiltrosGlosas) => Promise<GlosasDados>;
  aoCriarRecurso: (glosaIds: readonly string[]) => void;
}> = {}) {
  const carregarDados = vi.fn<(f: FiltrosGlosas) => Promise<GlosasDados>>()
    .mockResolvedValue(DADOS);
  const aoCriarRecurso = vi.fn();

  render(
    <ConveniosGlosas
      carregarDados={overrides.carregarDados ?? carregarDados}
      aoCriarRecurso={overrides.aoCriarRecurso ?? aoCriarRecurso}
    />,
  );
  return { carregarDados, aoCriarRecurso };
}

describe('ConveniosGlosas', () => {
  it('renderiza skeleton enquanto carrega', () => {
    const carregarDados = vi.fn<(f: FiltrosGlosas) => Promise<GlosasDados>>()
      .mockReturnValue(new Promise(() => {}));
    render(
      <ConveniosGlosas
        carregarDados={carregarDados}
        aoCriarRecurso={() => {}}
      />,
    );
    const skeletons = screen.getAllByRole('status');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    expect(skeletons[0]).toBeVisible();
  });

  it('renderiza tabela com dados', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('000003')).toBeVisible();
    // Cabecalhos da tabela
    expect(screen.getByText('Guia')).toBeVisible();
    expect(screen.getByText('Paciente')).toBeVisible();
    // Dados na tabela
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
  });

  it('renderiza badge de valor total glosado pendente', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/R\$ 230,00/)).toBeVisible();
    });
    expect(screen.getByText(/R\$ 230,00/)).toHaveTextContent(/pendente/i);
  });

  it('filtra por status', async () => {
    montar();
    const secao = await screen.findByRole('region', { name: /Lista de glosas/i });
    expect(within(secao).getByText('000001')).toBeVisible();
    const select = screen.getByLabelText(/Status/i);
    await userEvent.selectOptions(select, 'recurso_enviado');
    // So gl3 (recurso_enviado) deve aparecer
    expect(within(secao).queryByText('000001')).not.toBeInTheDocument();
    expect(within(secao).queryByText('000002')).not.toBeInTheDocument();
    expect(within(secao).getByText('000003')).toBeVisible();
  });

  it('filtra por operadora', async () => {
    montar();
    const secao = await screen.findByRole('region', { name: /Lista de glosas/i });
    // Todas as glosas sao de op1, selecionar op1 deve manter todas
    const select = screen.getByLabelText(/Operadora/i);
    await userEvent.selectOptions(select, 'op1');
    expect(within(secao).getByText('000001')).toBeVisible();
    expect(within(secao).getByText('000002')).toBeVisible();
    expect(within(secao).getByText('000003')).toBeVisible();
  });

  it('busca por texto', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    const campoBusca = screen.getByLabelText(/Buscar glosas/i);
    await userEvent.type(campoBusca, 'Ana');
    // So gl2 (Ana Silva) deve aparecer
    expect(screen.queryByText('000001')).not.toBeInTheDocument();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.queryByText('000003')).not.toBeInTheDocument();
  });

  it('mostra ChipDeStatusTiss correto', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    const secao = screen.getByRole('region', { name: /Lista de glosas/i });
    // Chips de status na tabela
    expect(within(secao).getAllByText(/Pendente/i).length).toBeGreaterThanOrEqual(1);
    expect(within(secao).getByText(/Recurso enviado/i)).toBeVisible();
  });

  it('permite selecionar glosas pendentes com checkbox', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    const checkboxes = screen.getAllByRole('checkbox', { name: /Selecionar glosa/i });
    // So glosas pendentes tem checkbox (2 de 3)
    expect(checkboxes).toHaveLength(2);
  });

  it('ao selecionar glosas e clicar "Criar recurso" chama callback com ids', async () => {
    const { aoCriarRecurso } = montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    const checkboxes = screen.getAllByRole('checkbox', { name: /Selecionar glosa/i });
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[1]!);
    const botao = screen.getByRole('button', { name: /Criar recurso/i });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoCriarRecurso).toHaveBeenCalledWith(['gl1', 'gl2']);
  });

  it('mostra estado vazio com icone', async () => {
    const carregarDados = vi.fn<(f: FiltrosGlosas) => Promise<GlosasDados>>()
      .mockResolvedValue(DADOS_VAZIO);
    render(
      <ConveniosGlosas
        carregarDados={carregarDados}
        aoCriarRecurso={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Nenhuma glosa pendente/i)).toBeVisible();
    });
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <ConveniosGlosas
        carregarDados={async () => DADOS}
        aoCriarRecurso={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
