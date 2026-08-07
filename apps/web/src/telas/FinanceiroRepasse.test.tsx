// apps/web/src/telas/FinanceiroRepasse.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroRepasse, type RepasseDados } from './FinanceiroRepasse';

const DADOS_GESTORA: RepasseDados = {
  profissionais: [
    { id: 'p1', nome: 'Dr. Alceu Moreira', totalBruto: 500000,
      percentual: 60, totalRepasse: 300000, status: 'pendente', atendimentos: 40 },
    { id: 'p2', nome: 'Dra. Beatriz Lima', totalBruto: 350000,
      percentual: 50, totalRepasse: 175000, status: 'pago', atendimentos: 28 },
  ],
  totalRepasse: 475000,
  periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
};

const DADOS_MEDICO: RepasseDados = {
  profissionais: [
    { id: 'p1', nome: 'Dr. Alceu Moreira', totalBruto: 500000,
      percentual: 60, totalRepasse: 300000, status: 'pendente', atendimentos: 40 },
  ],
  totalRepasse: 300000,
  periodo: { inicio: '2026-08-01', fim: '2026-08-31' },
};

function montarGestora() {
  const props = {
    carregarDados: vi.fn(async (_filtros: {
      profissionalId?: string; status?: string;
      dataInicio?: string; dataFim?: string;
    }) => DADOS_GESTORA),
    papelAtual: 'admin_clinico' as const,
  };
  render(<FinanceiroRepasse {...props} />);
  return props;
}

function montarMedico() {
  const props = {
    carregarDados: vi.fn(async (_filtros: {
      profissionalId?: string; status?: string;
      dataInicio?: string; dataFim?: string;
    }) => DADOS_MEDICO),
    papelAtual: 'profissional' as const,
  };
  render(<FinanceiroRepasse {...props} />);
  return props;
}

describe('FinanceiroRepasse', () => {
  it('gestora ve todos os profissionais com seus repasses', async () => {
    montarGestora();
    // Nomes aparecem tanto nas opcoes do select quanto na lista;
    // usamos within(section) para buscar apenas na lista
    const secao = await screen.findByRole('region', { name: /repasse por profissional/i });
    expect(within(secao).getByText('Dr. Alceu Moreira')).toBeVisible();
    expect(within(secao).getByText('Dra. Beatriz Lima')).toBeVisible();
  });

  it('exibe o total geral de repasse', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText('R$ 4.750,00')).toBeVisible());
  });

  it('exibe percentual e total de repasse por profissional', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText('60%')).toBeVisible());
    expect(screen.getByText('R$ 3.000,00')).toBeVisible();
  });

  it('exibe o status do repasse', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText(/Pendente/i)).toBeVisible());
    expect(screen.getByText(/Pago/i)).toBeVisible();
  });

  it('exibe a quantidade de atendimentos', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText(/40 atend/i)).toBeVisible());
  });

  it('medico ve so o seu proprio repasse', async () => {
    montarMedico();
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(screen.queryByText('Dra. Beatriz Lima')).not.toBeInTheDocument();
  });

  it('tem filtro por periodo', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
  });

  it('gestora tem filtro por profissional', async () => {
    montarGestora();
    // Usa string exata para nao casar com aria-label "Repasse por profissional" da section
    await waitFor(() => expect(screen.getByLabelText('Profissional')).toBeVisible());
  });

  it('medico nao ve filtro por profissional', async () => {
    montarMedico();
    await waitFor(() => expect(screen.getByText('Dr. Alceu Moreira')).toBeVisible());
    expect(screen.queryByLabelText('Profissional')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroRepasse
        carregarDados={async () => DADOS_GESTORA}
        papelAtual="admin_clinico"
      />,
    );
    const secao = await screen.findByRole('region', { name: /repasse por profissional/i });
    expect(within(secao).getByText('Dr. Alceu Moreira')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });
});
