// apps/web/src/telas/DetalheDemonstrativo.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  it('renderiza no PainelLateral com titulo do demonstrativo', () => {
    montar();
    expect(screen.getByText('Demonstrativo PROT-001')).toBeVisible();
  });

  it('mostra resumo de valores (apresentado, liberado, glosado)', () => {
    montar();
    // Total apresentado: 15000 + 15000 + 15000 = 45000 centavos = R$ 450,00
    expect(screen.getByText('R$ 450,00')).toBeVisible();
    // Total liberado: 15000 + 7000 + 0 = 22000 centavos = R$ 220,00
    expect(screen.getByText('R$ 220,00')).toBeVisible();
    // Total glosado: 0 + 8000 + 15000 = 23000 centavos = R$ 230,00
    expect(screen.getByText('R$ 230,00')).toBeVisible();
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

  it('mostra tabela de guias do demonstrativo com colunas de valores', () => {
    montar();
    // Cabecalho da tabela
    expect(screen.getByText('Apresentado', { selector: 'th' })).toBeVisible();
    expect(screen.getByText('Processado', { selector: 'th' })).toBeVisible();
    expect(screen.getByText('Liberado', { selector: 'th' })).toBeVisible();
    expect(screen.getByText('Glosado', { selector: 'th' })).toBeVisible();
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
