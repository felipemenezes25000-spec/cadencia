import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ComboboxDePaciente, type PacienteHit } from './ComboboxDePaciente';

const HITS: PacienteHit[] = [
  {
    patientId: 'p1',
    displayName: 'MARIA SOUZA LIMA',
    legalName: 'Maria Souza Lima',
    hasSocialName: false,
    birthDate: '1988-03-14',
    cadastroStatus: 'completo',
    phonePrimary: '11987654321',
  },
  {
    patientId: 'p2',
    displayName: 'Joana Prado',
    legalName: 'Joao Prado',
    hasSocialName: true,
    birthDate: null,
    cadastroStatus: 'preliminar',
    phonePrimary: null,
  },
];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function montar(
  buscar = vi.fn(async () => HITS),
  aoCriar = vi.fn(),
  aoEscolher = vi.fn(),
) {
  render(
    <ComboboxDePaciente
      buscar={buscar}
      aoEscolher={aoEscolher}
      aoCriar={aoCriar}
    />,
  );
  return { buscar, aoCriar, aoEscolher };
}

async function digitar(texto: string) {
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: texto } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe('ComboboxDePaciente', () => {
  it('renderiza input com placeholder', () => {
    montar();
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('placeholder', 'Buscar paciente...');
  });

  it('tem os papeis ARIA de combobox com listbox', () => {
    montar();
    const input = screen.getByRole('combobox', { name: 'Buscar paciente' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });

  it('abre dropdown ao digitar 2+ caracteres', async () => {
    const { buscar } = montar();
    const input = screen.getByRole('combobox');

    // 1 caractere: nao abre
    fireEvent.change(input, { target: { value: 'm' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(buscar).not.toHaveBeenCalled();

    // 2+ caracteres: abre
    fireEvent.change(input, { target: { value: 'ma' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(buscar).toHaveBeenCalledWith('ma');
  });

  it('debounce de 300 ms: nao chama a busca a cada tecla', async () => {
    const { buscar } = montar();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'mar' } });
    fireEvent.change(input, { target: { value: 'mari' } });
    fireEvent.change(input, { target: { value: 'maria' } });
    expect(buscar).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith('maria');
  });

  it('mostra spinner enquanto busca', async () => {
    // buscar que nunca resolve para manter o carregando ativo
    const buscarLenta = vi.fn(() => new Promise<PacienteHit[]>(() => {}));
    montar(buscarLenta);
    const input = screen.getByRole('combobox');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'maria' } });
    });

    // Spinner visivel enquanto debounce espera
    expect(screen.getByRole('img', { name: 'Carregando' })).toBeInTheDocument();
  });

  it('mostra resultados com nome destacado', async () => {
    montar();
    await digitar('maria');
    // A parte que casa fica em <mark>
    const marks = document.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]!.textContent!.toLowerCase()).toBe('maria');
  });

  it('mostra avatar com iniciais do paciente', async () => {
    montar();
    await digitar('maria');
    expect(screen.getByText('MS')).toBeVisible(); // MARIA SOUZA LIMA -> MS
    expect(screen.getByText('JP')).toBeVisible(); // Joana Prado -> JP
  });

  it('o nome SOCIAL fica em destaque e o civil aparece como secundario', async () => {
    montar();
    await digitar('joa');
    // O HighlightMatch divide o nome em fragmentos, entao buscamos o textContent completo
    const nomeEl = screen.getByText((_content, el) =>
      el?.tagName === 'P' && el?.textContent === 'Joana Prado',
    );
    expect(nomeEl).toBeVisible();
    expect(screen.getByText(/Joao Prado/)).toBeVisible();
  });

  it('"Novo paciente" e SEMPRE a ultima linha, inclusive com resultados', async () => {
    montar();
    await digitar('maria');
    const opcoes = screen.getAllByRole('option');
    expect(opcoes).toHaveLength(3);
    expect(opcoes[2]).toHaveTextContent(/Novo paciente/);
  });

  it('setas movem aria-activedescendant e Enter escolhe', async () => {
    const { aoEscolher } = montar();
    const input = screen.getByRole('combobox');
    await digitar('maria');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      screen.getAllByRole('option')[0]!.id,
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(aoEscolher).toHaveBeenCalledWith(HITS[0]);
  });

  it('navega com ArrowDown e ArrowUp', async () => {
    montar();
    const input = screen.getByRole('combobox');
    await digitar('maria');

    const opcoes = screen.getAllByRole('option');

    // Desce para o primeiro
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', opcoes[0]!.id);

    // Desce para o segundo
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', opcoes[1]!.id);

    // Sobe de volta para o primeiro
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', opcoes[0]!.id);
  });

  it('seleciona ao clicar em resultado', async () => {
    const { aoEscolher } = montar();
    await digitar('maria');
    const opcoes = screen.getAllByRole('option');
    fireEvent.click(opcoes[0]!);
    expect(aoEscolher).toHaveBeenCalledWith(HITS[0]);
  });

  it('Enter na ultima linha cria o paciente com o termo digitado', async () => {
    const { aoCriar } = montar();
    const input = screen.getByRole('combobox');
    await digitar('maria sou');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(aoCriar).toHaveBeenCalledWith('maria sou');
  });

  it('fecha com Escape', async () => {
    montar();
    const input = screen.getByRole('combobox');
    await digitar('maria');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('mostra o sinal de cadastro preliminar na linha', async () => {
    montar();
    await digitar('joa');
    expect(screen.getByText('cadastro preliminar')).toBeVisible();
  });

  it('mostra mensagem de erro quando prop erro esta presente', () => {
    render(
      <ComboboxDePaciente
        buscar={vi.fn(async () => [])}
        aoEscolher={vi.fn()}
        aoCriar={vi.fn()}
        erro="Campo obrigatorio"
      />,
    );
    expect(screen.getByText('Campo obrigatorio')).toBeVisible();
  });

  it('nao tem violacao de acessibilidade com a lista aberta', async () => {
    const { container } = render(
      <ComboboxDePaciente
        buscar={async () => HITS}
        aoEscolher={vi.fn()}
        aoCriar={vi.fn()}
      />,
    );
    await digitar('maria');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });
});
