// apps/web/src/telas/ConveniosRecursos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosRecursos,
  type RecursosDados,
} from './ConveniosRecursos';

const DADOS: RecursosDados = {
  recursos: [
    {
      id: 'r1',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      status: 'rascunho',
      justificativaGeral: 'Procedimentos realizados conforme protocolo clinico.',
      criadoEm: '2026-08-05',
      enviadoEm: null,
      totalGlosasCentavos: 23000,
      itens: [
        {
          id: 'ri1',
          glosaId: 'gl1',
          guiaNumero: '000001',
          pacienteNome: 'Carlos Melo',
          codigoGlosa: '1005',
          valorGlosadoCentavos: 15000,
          justificativa: 'Procedimento estava autorizado pela guia SADT 12345.',
        },
        {
          id: 'ri2',
          glosaId: 'gl2',
          guiaNumero: '000002',
          pacienteNome: 'Ana Silva',
          codigoGlosa: '1015',
          valorGlosadoCentavos: 8000,
          justificativa: 'Guia enviada dentro do prazo de 10 dias uteis.',
        },
      ],
    },
    {
      id: 'r2',
      operadoraNome: 'Bradesco Saude',
      operadoraId: 'op2',
      status: 'enviado',
      justificativaGeral: 'Recurso fundamentado.',
      criadoEm: '2026-08-01',
      enviadoEm: '2026-08-03',
      totalGlosasCentavos: 50000,
      itens: [
        {
          id: 'ri3',
          glosaId: 'gl4',
          guiaNumero: '000010',
          pacienteNome: 'Maria Costa',
          codigoGlosa: '1020',
          valorGlosadoCentavos: 50000,
          justificativa: 'Codigo correto conforme tabela TUSS vigente.',
        },
      ],
    },
  ],
};

const DADOS_VAZIO: RecursosDados = { recursos: [] };

function montar() {
  const carregarDados = vi.fn<() => Promise<RecursosDados>>()
    .mockResolvedValue(DADOS);
  const aoEditar = vi.fn();
  const aoEnviar = vi.fn<(id: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const aoVerResultado = vi.fn();

  render(
    <ConveniosRecursos
      carregarDados={carregarDados}
      aoEditar={aoEditar}
      aoEnviar={aoEnviar}
      aoVerResultado={aoVerResultado}
    />,
  );
  return { carregarDados, aoEditar, aoEnviar, aoVerResultado };
}

describe('ConveniosRecursos', () => {
  it('renderiza skeleton enquanto carrega', () => {
    const carregarDados = vi.fn<() => Promise<RecursosDados>>()
      .mockReturnValue(new Promise(() => {}));
    render(
      <ConveniosRecursos
        carregarDados={carregarDados}
        aoEditar={() => {}}
        aoEnviar={async () => {}}
        aoVerResultado={() => {}}
      />,
    );
    const skeletons = screen.getAllByRole('status');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
    expect(skeletons[0]).toBeVisible();
  });

  it('renderiza tabela com dados', async () => {
    montar();
    const secao = await screen.findByRole('region', { name: /Lista de recursos/i });
    expect(within(secao).getByText('Unimed')).toBeVisible();
    expect(within(secao).getByText('Bradesco Saude')).toBeVisible();
    // Cabeçalhos da tabela
    expect(screen.getByText('Recurso')).toBeVisible();
    // Valores monetários
    expect(within(secao).getByText('R$ 230,00')).toBeVisible();
    expect(within(secao).getByText('R$ 500,00')).toBeVisible();
  });

  it('filtra por status', async () => {
    montar();
    const secao = await screen.findByRole('region', { name: /Lista de recursos/i });
    expect(within(secao).getByText('Unimed')).toBeVisible();
    const select = screen.getByLabelText(/Status/i);
    await userEvent.selectOptions(select, 'enviado');
    // Só Bradesco Saude (enviado) deve aparecer na tabela
    expect(within(secao).queryByText('Unimed')).not.toBeInTheDocument();
    expect(within(secao).getByText('Bradesco Saude')).toBeVisible();
  });

  it('filtra por operadora', async () => {
    montar();
    const secao = await screen.findByRole('region', { name: /Lista de recursos/i });
    expect(within(secao).getByText('Unimed')).toBeVisible();
    const select = screen.getByLabelText(/Operadora/i);
    await userEvent.selectOptions(select, 'op1');
    // Só Unimed (op1) deve aparecer na tabela
    expect(within(secao).getByText('Unimed')).toBeVisible();
    expect(within(secao).queryByText('Bradesco Saude')).not.toBeInTheDocument();
  });

  it('busca por texto', async () => {
    montar();
    const secao = await screen.findByRole('region', { name: /Lista de recursos/i });
    expect(within(secao).getByText('Unimed')).toBeVisible();
    const campoBusca = screen.getByLabelText(/Buscar recursos/i);
    await userEvent.type(campoBusca, 'Bradesco');
    // Unimed não aparece mais na tabela (mas pode estar no filtro)
    expect(within(secao).queryByText('Unimed')).not.toBeInTheDocument();
    expect(within(secao).getByText('Bradesco Saude')).toBeVisible();
  });

  it('mostra ChipDeStatusTiss correto', async () => {
    montar();
    const secao = await screen.findByRole('region', { name: /Lista de recursos/i });
    // Chips de status na tabela (texto pode existir também no filtro dropdown)
    const rascunhoChips = within(secao).getAllByText(/Rascunho/i);
    expect(rascunhoChips.length).toBeGreaterThanOrEqual(1);
    const enviadoChips = within(secao).getAllByText(/Enviado/i);
    expect(enviadoChips.length).toBeGreaterThanOrEqual(1);
  });

  it('botão Editar aparece para recurso em rascunho', async () => {
    const { aoEditar } = montar();
    await screen.findByRole('region', { name: /Lista de recursos/i });
    const botoes = screen.getAllByRole('button', { name: /Editar/i });
    expect(botoes).toHaveLength(1);
    await userEvent.click(botoes[0]!);
    expect(aoEditar).toHaveBeenCalledWith('r1');
  });

  it('botão Enviar aparece para recurso em rascunho', async () => {
    montar();
    await screen.findByRole('region', { name: /Lista de recursos/i });
    expect(screen.getByRole('button', { name: /Enviar/i })).toBeVisible();
  });

  it('botão Ver resultado aparece para recurso enviado', async () => {
    const { aoVerResultado } = montar();
    await screen.findByRole('region', { name: /Lista de recursos/i });
    const botao = screen.getByRole('button', { name: /Ver resultado/i });
    await userEvent.click(botao);
    expect(aoVerResultado).toHaveBeenCalledWith('r2');
  });

  it('expandir recurso mostra itens com justificativa individual', async () => {
    montar();
    await screen.findByRole('region', { name: /Lista de recursos/i });
    const expandir = screen.getAllByRole('button', { name: /Expandir/i });
    await userEvent.click(expandir[0]!);
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText(/Procedimento estava autorizado/)).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    expect(screen.getByText(/Guia enviada dentro do prazo/)).toBeVisible();
  });

  it('mostra estado vazio', async () => {
    render(
      <ConveniosRecursos
        carregarDados={async () => DADOS_VAZIO}
        aoEditar={() => {}}
        aoEnviar={async () => {}}
        aoVerResultado={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Nenhum recurso encontrado/i)).toBeVisible();
    });
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(
      <ConveniosRecursos
        carregarDados={async () => DADOS}
        aoEditar={() => {}}
        aoEnviar={async () => {}}
        aoVerResultado={() => {}}
      />,
    );
    await screen.findByRole('region', { name: /Lista de recursos/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
