// apps/web/src/telas/DetalheDemonstrativo.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  DetalheDemonstrativo,
  type ItemDemonstrativo,
} from './DetalheDemonstrativo';

const ITENS: readonly ItemDemonstrativo[] = [
  {
    id: 'it1',
    guiaNumero: '000001',
    pacienteNome: 'Carlos Melo',
    codigoProcedimento: '10101012',
    nomeProcedimento: 'Consulta em consultorio',
    apresentadoCentavos: 15000,
    processadoCentavos: 15000,
    liberadoCentavos: 15000,
    glosadoCentavos: 0,
    codigoGlosa: null,
    descricaoGlosa: null,
  },
  {
    id: 'it2',
    guiaNumero: '000002',
    pacienteNome: 'Ana Silva',
    codigoProcedimento: '10101012',
    nomeProcedimento: 'Consulta em consultorio',
    apresentadoCentavos: 15000,
    processadoCentavos: 15000,
    liberadoCentavos: 7000,
    glosadoCentavos: 8000,
    codigoGlosa: '1015',
    descricaoGlosa: 'Fora do prazo',
  },
  {
    id: 'it3',
    guiaNumero: '000003',
    pacienteNome: 'Jose Santos',
    codigoProcedimento: '10101012',
    nomeProcedimento: 'Consulta em consultorio',
    apresentadoCentavos: 15000,
    processadoCentavos: 0,
    liberadoCentavos: 0,
    glosadoCentavos: 15000,
    codigoGlosa: '1005',
    descricaoGlosa: 'Procedimento nao autorizado',
  },
];

function montar() {
  const aoFechar = vi.fn();

  render(
    <DetalheDemonstrativo
      aberto
      titulo="Demonstrativo PROT-001"
      itens={ITENS}
      aoFechar={aoFechar}
    />,
  );
  return { aoFechar };
}

describe('DetalheDemonstrativo', () => {
  it('renderiza titulo do demonstrativo no painel lateral', () => {
    montar();
    expect(screen.getByText('Demonstrativo PROT-001')).toBeVisible();
  });

  it('renderiza todos os itens com guia e paciente', () => {
    montar();
    expect(screen.getByText('000001')).toBeVisible();
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    expect(screen.getByText('000003')).toBeVisible();
    expect(screen.getByText('Jose Santos')).toBeVisible();
  });

  it('exibe valores lado a lado: apresentado, processado, liberado, glosado', () => {
    montar();
    // Cabecalho da tabela
    expect(screen.getByText(/Apresentado/i)).toBeVisible();
    expect(screen.getByText(/Processado/i)).toBeVisible();
    expect(screen.getByText(/Liberado/i)).toBeVisible();
    expect(screen.getByText(/Glosado/i)).toBeVisible();
  });

  it('destaca item com glosa mostrando codigo e descricao', () => {
    montar();
    expect(screen.getByText('1015')).toBeVisible();
    expect(screen.getByText(/Fora do prazo/)).toBeVisible();
    expect(screen.getByText('1005')).toBeVisible();
    expect(screen.getByText(/Procedimento nao autorizado/)).toBeVisible();
  });

  it('nao renderiza nada quando fechado', () => {
    render(
      <DetalheDemonstrativo
        aberto={false}
        titulo="Test"
        itens={ITENS}
        aoFechar={() => {}}
      />,
    );
    expect(screen.queryByText('000001')).toBeNull();
  });

  it('ao clicar no fundo escurecido chama aoFechar', async () => {
    const { aoFechar } = montar();
    await userEvent.click(screen.getByTestId('fundo-escurecido'));
    expect(aoFechar).toHaveBeenCalled();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <DetalheDemonstrativo
        aberto
        titulo="Demonstrativo PROT-001"
        itens={ITENS}
        aoFechar={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
