// apps/web/src/telas/FinanceiroRepasse.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroRepasse, type RepasseDados } from './FinanceiroRepasse';

const DADOS_GESTORA: RepasseDados = {
  profissionais: [
    { id: 'p1', nome: 'Dr. Alceu Moreira', totalBruto: 500000,
      percentual: 60, totalRepasse: 300000, status: 'pendente', atendimentos: 40,
      especialidade: 'Cardiologia' },
    { id: 'p2', nome: 'Dra. Beatriz Lima', totalBruto: 350000,
      percentual: 50, totalRepasse: 175000, status: 'pago', atendimentos: 28,
      especialidade: 'Dermatologia' },
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

const DADOS_VAZIO: RepasseDados = {
  profissionais: [],
  totalRepasse: 0,
  periodo: { inicio: '2026-09-01', fim: '2026-09-30' },
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
  it('renderiza skeleton enquanto carrega', () => {
    // Usamos uma promise que nunca resolve para manter o estado de carregamento
    render(
      <FinanceiroRepasse
        carregarDados={() => new Promise(() => {})}
        papelAtual="admin_clinico"
      />,
    );
    expect(screen.getByLabelText('Carregando repasse...')).toBeInTheDocument();
  });

  it('renderiza seletor de periodo', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText(/Agosto 2026/)).toBeVisible());
    expect(screen.getByLabelText(/Mes anterior/i)).toBeVisible();
    expect(screen.getByLabelText(/Proximo mes/i)).toBeVisible();
  });

  it('renderiza cards de resumo por profissional', async () => {
    montarGestora();
    const secao = await screen.findByRole('region', { name: /Resumo por profissional/i });
    expect(within(secao).getByText('Dr. Alceu Moreira')).toBeVisible();
    expect(within(secao).getByText('Dra. Beatriz Lima')).toBeVisible();
    // Verifica iniciais nos avatares
    expect(within(secao).getByText('DA')).toBeVisible();
    expect(within(secao).getByText('DB')).toBeVisible();
  });

  it('renderiza tabela detalhada', async () => {
    montarGestora();
    const secao = await screen.findByRole('region', { name: /Repasse por profissional/i });
    const tabela = within(secao).getByRole('table');
    expect(tabela).toBeVisible();
    // Headers da tabela
    expect(within(tabela).getByText('Profissional')).toBeVisible();
    expect(within(tabela).getByText('Atendimentos')).toBeVisible();
    expect(within(tabela).getByText('Producao')).toBeVisible();
    // Dados na tabela
    expect(within(tabela).getByText('Dr. Alceu Moreira')).toBeVisible();
    expect(within(tabela).getByText('Dra. Beatriz Lima')).toBeVisible();
  });

  it('navega entre meses', async () => {
    const user = userEvent.setup();
    const props = montarGestora();
    await waitFor(() => expect(screen.getByText(/Agosto 2026/)).toBeVisible());

    // Clicar no botao de proximo mes
    await user.click(screen.getByLabelText(/Proximo mes/i));
    expect(props.carregarDados).toHaveBeenCalledTimes(2);

    // Clicar no botao de mes anterior
    await user.click(screen.getByLabelText(/Mes anterior/i));
    expect(props.carregarDados).toHaveBeenCalledTimes(3);
  });

  it('exibe o total geral de repasse', async () => {
    montarGestora();
    // O total aparece tanto no cabecalho quanto no rodape da tabela
    await waitFor(() => expect(screen.getAllByText('R$ 4.750,00').length).toBeGreaterThan(0));
  });

  it('exibe percentual e status na tabela', async () => {
    montarGestora();
    await waitFor(() => expect(screen.getByText(/Pendente/i)).toBeVisible());
    expect(screen.getByText(/Pago/i)).toBeVisible();
  });

  it('medico ve so o seu proprio repasse', async () => {
    montarMedico();
    const secao = await screen.findByRole('region', { name: /Repasse por profissional/i });
    expect(within(secao).getByText('Dr. Alceu Moreira')).toBeVisible();
    expect(screen.queryByText('Dra. Beatriz Lima')).not.toBeInTheDocument();
  });

  it('renderiza estado vazio quando nao ha profissionais', async () => {
    render(
      <FinanceiroRepasse
        carregarDados={async () => DADOS_VAZIO}
        papelAtual="admin_clinico"
      />,
    );
    await waitFor(() => expect(screen.getByText(/Nenhum repasse encontrado/)).toBeVisible());
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <FinanceiroRepasse
        carregarDados={async () => DADOS_GESTORA}
        papelAtual="admin_clinico"
      />,
    );
    const secao = await screen.findByRole('region', { name: /Repasse por profissional/i });
    expect(within(secao).getByText('Dr. Alceu Moreira')).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });
});
