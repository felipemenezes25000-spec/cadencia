// apps/web/src/telas/Explorar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Explorar } from './Explorar';
import type { SavedView } from '@cadencia/reports';

const VISOES_MOCK: SavedView[] = [
  {
    id: 'builtin-atendimentos-realizados',
    name: 'Atendimentos realizados',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'realizado' }],
    columns: { visible: ['occurred_date', 'patient_name', 'professional_name', 'status'] },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
  {
    id: 'builtin-faltas',
    name: 'Faltas',
    builtIn: true,
    view: 'atendimentos',
    filters: [{ column: 'status', op: 'eq', value: 'falta' }],
    columns: { visible: ['occurred_date', 'patient_name', 'professional_name', 'status'] },
    sort: [{ column: 'occurred_date', dir: 'desc' }],
    chartKind: 'bar',
  },
];

const LINHAS_MOCK = [
  { occurred_date: '2026-07-15', patient_name: 'Carlos', professional_name: 'Dra. Ana', status: 'realizado' },
  { occurred_date: '2026-07-16', patient_name: 'Maria', professional_name: 'Dr. Bruno', status: 'realizado' },
];

function montar(overrides: Partial<Parameters<typeof Explorar>[0]> = {}) {
  const props = {
    visoesSalvas: VISOES_MOCK,
    aoConsultar: vi.fn(async () => ({ rows: LINHAS_MOCK, total: 2 })),
    aoExportar: vi.fn(async () => {}),
    aoSalvarVisao: vi.fn(async () => ({ viewId: 'custom-1' })),
    ...overrides,
  };
  render(<Explorar {...props} />);
  return props;
}

describe('tela Explorar', () => {
  it('renderiza o titulo "Explorar"', () => {
    montar();
    expect(screen.getByRole('heading', { name: /Explorar/ })).toBeVisible();
  });

  it('exibe lista de visoes salvas como botoes de acesso rapido', () => {
    montar();
    expect(screen.getByRole('button', { name: /Atendimentos realizados/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Faltas/ })).toBeVisible();
  });

  it('ao clicar em visao salva, carrega filtros e dispara consulta', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(props.aoConsultar).toHaveBeenCalled());
  });

  it('exibe seletor de periodo com campos de data inicio e fim', () => {
    montar();
    expect(screen.getByLabelText(/Data inicio/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Data fim/i)).toBeInTheDocument();
  });

  it('exibe tabela de resultados apos consulta', async () => {
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    expect(screen.getByText('Carlos')).toBeVisible();
    expect(screen.getByText('Maria')).toBeVisible();
  });

  it('exibe cabecalhos de coluna na tabela', async () => {
    montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    expect(screen.getByRole('columnheader', { name: /Data/ })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /Paciente/ })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /Profissional/ })).toBeVisible();
  });

  it('exibe botoes de exportar CSV e XLSX', () => {
    montar();
    expect(screen.getByRole('button', { name: /CSV/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /XLSX/ })).toBeVisible();
  });

  it('ao clicar em exportar CSV chama aoExportar com formato csv', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /CSV/ }));
    await waitFor(() => expect(props.aoExportar).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'csv' }),
    ));
  });

  it('exibe botao "Salvar visao" e chama aoSalvarVisao com nome', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Atendimentos realizados/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Salvar visao/ }));
    const campo = screen.getByLabelText(/Nome da visao/i);
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Minha visao');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(props.aoSalvarVisao).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Minha visao' }),
    ));
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Explorar
        visoesSalvas={VISOES_MOCK}
        aoConsultar={vi.fn(async () => ({ rows: LINHAS_MOCK, total: 2 }))}
        aoExportar={vi.fn(async () => {})}
        aoSalvarVisao={vi.fn(async () => ({ viewId: 'custom-1' }))}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
