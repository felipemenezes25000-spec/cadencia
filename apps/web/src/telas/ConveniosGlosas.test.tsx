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
  it('renderiza badge de valor total glosado pendente', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/R\$ 230,00/)).toBeVisible();
    });
    // Badge contem valor e "pendente" juntos
    expect(screen.getByText(/R\$ 230,00/)).toHaveTextContent(/pendente/i);
  });

  it('renderiza lista de glosas com guia, paciente e codigo da glosa', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    // Codigo 1005 aparece em mais de uma glosa — busca dentro da secao
    const secao = screen.getByRole('region', { name: /Lista de glosas/i });
    expect(within(secao).getAllByText('1005').length).toBeGreaterThanOrEqual(1);
    expect(within(secao).getAllByText(/Procedimento nao autorizado/).length).toBeGreaterThanOrEqual(1);
  });

  it('renderiza chip de status para glosa com recurso enviado', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000003')).toBeVisible();
    });
    // "Recurso enviado" aparece no select e no chip — busca dentro da secao
    const secao = screen.getByRole('region', { name: /Lista de glosas/i });
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

  it('renderiza filtros de status, operadora e periodo', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByLabelText(/Status/i)).toBeVisible();
    });
    expect(screen.getByLabelText(/Operadora/i)).toBeVisible();
    expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible();
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
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
