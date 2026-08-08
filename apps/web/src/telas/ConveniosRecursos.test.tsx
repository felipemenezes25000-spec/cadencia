// apps/web/src/telas/ConveniosRecursos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  it('renderiza lista de recursos com operadora e status', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.getByText(/Rascunho/i)).toBeVisible();
    expect(screen.getByText(/Enviado/i)).toBeVisible();
  });

  it('renderiza valor total de glosas em cada recurso', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('R$ 230,00')).toBeVisible();
    });
    expect(screen.getByText('R$ 500,00')).toBeVisible();
  });

  it('botao Editar aparece para recurso em rascunho', async () => {
    const { aoEditar } = montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    const botoes = screen.getAllByRole('button', { name: /Editar/i });
    expect(botoes).toHaveLength(1);
    await userEvent.click(botoes[0]!);
    expect(aoEditar).toHaveBeenCalledWith('r1');
  });

  it('botao Enviar aparece para recurso em rascunho', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    expect(screen.getByRole('button', { name: /Enviar/i })).toBeVisible();
  });

  it('botao Ver resultado aparece para recurso enviado', async () => {
    const { aoVerResultado } = montar();
    await waitFor(() => {
      expect(screen.getByText('Bradesco Saude')).toBeVisible();
    });
    const botao = screen.getByRole('button', { name: /Ver resultado/i });
    await userEvent.click(botao);
    expect(aoVerResultado).toHaveBeenCalledWith('r2');
  });

  it('expandir recurso mostra itens com justificativa individual', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    const expandir = screen.getAllByRole('button', { name: /Expandir/i });
    await userEvent.click(expandir[0]!);
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText(/Procedimento estava autorizado/)).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    expect(screen.getByText(/Guia enviada dentro do prazo/)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosRecursos
        carregarDados={async () => DADOS}
        aoEditar={() => {}}
        aoEnviar={async () => {}}
        aoVerResultado={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
