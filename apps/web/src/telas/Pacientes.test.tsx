import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Pacientes, PacientesSkeleton, FACETAS } from './Pacientes';

const HITS = [
  {
    patientId: 'p1',
    displayName: 'Álvaro Neto',
    legalName: 'Álvaro Neto',
    hasSocialName: false,
    birthDate: '1970-01-01',
    cadastroStatus: 'completo' as const,
    phonePrimary: null,
  },
  {
    patientId: 'p2',
    displayName: 'Ana Lima',
    legalName: 'Ana Lima',
    hasSocialName: false,
    birthDate: null,
    cadastroStatus: 'preliminar' as const,
    phonePrimary: '11999999999',
  },
];

function criarBuscarMock(resultados = HITS) {
  return vi.fn(async () => resultados);
}

describe('tela Pacientes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('as abas do líder viram FACETAS, que são filtros salvos', () => {
    expect(FACETAS.map((f) => f.chave)).toEqual([
      'ativos',
      'inativos',
      'obitos',
      'cadastro_preliminar',
      'sem_retorno',
    ]);
  });

  it('renderiza skeleton enquanto carrega', () => {
    const { container } = render(<PacientesSkeleton />);
    expect(container.querySelector('[data-testid="pacientes-skeleton"]')).toBeTruthy();
    // Verifica que há elementos de skeleton
    const skeletons = container.querySelectorAll('[role="status"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renderiza lista de pacientes', async () => {
    const buscar = criarBuscarMock();
    render(
      <Pacientes
        buscar={buscar}
        faceta="ativos"
        aoMudarFaceta={vi.fn()}
        aoAbrir={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Álvaro Neto')).toBeVisible();
      expect(screen.getByText('Ana Lima')).toBeVisible();
    });
  });

  it('filtra pacientes ao digitar na busca', async () => {
    const anaHit = HITS[1]!;
    const buscar = vi.fn(async (termo: string, _faceta: string) => {
      if (termo === 'ana') return [anaHit];
      return HITS;
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <Pacientes
        buscar={buscar}
        faceta="ativos"
        aoMudarFaceta={vi.fn()}
        aoAbrir={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('Álvaro Neto')).toBeVisible());

    const input = screen.getByRole('textbox', { name: 'Buscar pacientes' });
    await user.type(input, 'ana');

    // Avança o debounce
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    await waitFor(() => {
      expect(screen.getByText('Ana Lima')).toBeVisible();
      expect(screen.queryByText('Álvaro Neto')).not.toBeInTheDocument();
    });
  });

  it('debounce a busca (300ms)', async () => {
    const buscar = criarBuscarMock();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <Pacientes
        buscar={buscar}
        faceta="ativos"
        aoMudarFaceta={vi.fn()}
        aoAbrir={vi.fn()}
      />,
    );

    // Aguarda a primeira chamada (renderização inicial)
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));

    const input = screen.getByRole('textbox', { name: 'Buscar pacientes' });
    await user.type(input, 'test');

    // Antes do debounce expirar, não deve ter chamado de novo com o termo
    const chamadasAntes = buscar.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    // Após o debounce, deve chamar com o termo debounced
    await waitFor(() => {
      expect(buscar.mock.calls.length).toBeGreaterThan(chamadasAntes);
    });
  });

  it('mostra estado vazio quando sem resultados', async () => {
    const buscar = vi.fn(async () => []);

    render(
      <Pacientes
        buscar={buscar}
        faceta="ativos"
        aoMudarFaceta={vi.fn()}
        aoAbrir={vi.fn()}
        aoCriar={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Nenhum paciente encontrado')).toBeVisible();
      expect(screen.getByText('Não há pacientes nesta visualização.')).toBeVisible();
    });
  });

  it('mostra estado vazio com mensagem personalizada para busca', async () => {
    const buscar = vi.fn(async () => []);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <Pacientes
        buscar={buscar}
        faceta="ativos"
        aoMudarFaceta={vi.fn()}
        aoAbrir={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Nenhum paciente encontrado')).toBeVisible();
    });

    const input = screen.getByRole('textbox', { name: 'Buscar pacientes' });
    await act(async () => {
      await user.type(input, 'xyz');
      vi.advanceTimersByTime(350);
    });

    await waitFor(() => {
      expect(screen.getByText(/Nenhum resultado para “xyz”/)).toBeVisible();
    });
  });

  it('a faceta escolhida vai para a query string', async () => {
    const aoMudarFaceta = vi.fn();
    render(
      <Pacientes
        buscar={async () => HITS}
        faceta="ativos"
        aoMudarFaceta={aoMudarFaceta}
        aoAbrir={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole('tab', { name: 'Cadastro preliminar' }),
    );
    expect(aoMudarFaceta).toHaveBeenCalledWith('cadastro_preliminar');
  });

  it('navega para detalhe ao clicar em paciente', async () => {
    const aoAbrir = vi.fn();
    render(
      <Pacientes
        buscar={async () => HITS}
        faceta="ativos"
        aoMudarFaceta={vi.fn()}
        aoAbrir={aoAbrir}
      />,
    );

    await waitFor(() => expect(screen.getByText('Álvaro Neto')).toBeVisible());

    await userEvent.click(screen.getByText('Álvaro Neto'));
    expect(aoAbrir).toHaveBeenCalledWith('p1');
  });

  it('mostra iniciais do nome no avatar', async () => {
    render(
      <Pacientes
        buscar={async () => HITS}
        faceta="ativos"
        aoMudarFaceta={vi.fn()}
        aoAbrir={vi.fn()}
      />,
    );

    await waitFor(() => {
      // Álvaro Neto → ÁN (preserva acentuação)
      expect(screen.getByText('ÁN')).toBeVisible();
      // Ana Lima → AL
      expect(screen.getByText('AL')).toBeVisible();
    });
  });

  it('marca o cadastro preliminar com texto, nunca só com cor', async () => {
    render(
      <Pacientes
        buscar={async () => HITS}
        faceta="ativos"
        aoMudarFaceta={vi.fn()}
        aoAbrir={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Cadastro preliminar')).toBeVisible());
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(
      <Pacientes
        buscar={async () => HITS}
        faceta="ativos"
        aoMudarFaceta={vi.fn()}
        aoAbrir={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('Álvaro Neto')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
