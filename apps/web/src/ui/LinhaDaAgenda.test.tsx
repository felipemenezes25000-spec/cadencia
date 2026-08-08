import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { LinhaDaAgenda } from './LinhaDaAgenda';

const agendamentoPadrao = {
  id: '1',
  horario: '14:30',
  paciente: 'Maria Silva',
  procedimento: 'Consulta de retorno',
  status: 'aguardando' as const,
  encaixe: true,
  teleconsulta: false,
  primeiraVez: false,
};

describe('LinhaDaAgenda', () => {
  it('renderiza horario e nome do paciente', () => {
    render(
      <ul>
        <LinhaDaAgenda agendamento={agendamentoPadrao} />
      </ul>,
    );
    expect(screen.getByText('14:30')).toBeInTheDocument();
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
  });

  it('renderiza procedimento', () => {
    render(
      <ul>
        <LinhaDaAgenda agendamento={agendamentoPadrao} />
      </ul>,
    );
    expect(screen.getByText(/Consulta de retorno/)).toBeInTheDocument();
  });

  it('renderiza chip de status', () => {
    render(
      <ul>
        <LinhaDaAgenda agendamento={agendamentoPadrao} />
      </ul>,
    );
    expect(screen.getByText(/Aguardando/)).toBeInTheDocument();
  });

  it('renderiza badge de encaixe quando aplicavel', () => {
    render(
      <ul>
        <LinhaDaAgenda agendamento={{ ...agendamentoPadrao, encaixe: true }} />
      </ul>,
    );
    expect(screen.getByText('Encaixe')).toBeInTheDocument();
  });

  it('nao renderiza badge de encaixe quando nao aplicavel', () => {
    render(
      <ul>
        <LinhaDaAgenda agendamento={{ ...agendamentoPadrao, encaixe: false }} />
      </ul>,
    );
    expect(screen.queryByText('Encaixe')).not.toBeInTheDocument();
  });

  it('renderiza badge de teleconsulta quando aplicavel', () => {
    render(
      <ul>
        <LinhaDaAgenda
          agendamento={{ ...agendamentoPadrao, teleconsulta: true }}
        />
      </ul>,
    );
    expect(screen.getByText('Teleconsulta')).toBeInTheDocument();
  });

  it('renderiza badge de primeira vez quando aplicavel', () => {
    render(
      <ul>
        <LinhaDaAgenda
          agendamento={{ ...agendamentoPadrao, primeiraVez: true }}
        />
      </ul>,
    );
    expect(screen.getByText('1a vez')).toBeInTheDocument();
  });

  it('abre menu de acoes ao clicar nos tres pontos', async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <LinhaDaAgenda agendamento={agendamentoPadrao} />
      </ul>,
    );

    const botaoMenu = screen.getByRole('button', {
      name: 'Acoes do agendamento',
    });
    await user.click(botaoMenu);

    expect(screen.getByText('Check-in')).toBeInTheDocument();
  });

  it('menu tem opcoes: Check-in, Abrir atendimento, Mensagem, Cobrar', async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <LinhaDaAgenda agendamento={agendamentoPadrao} />
      </ul>,
    );

    const botaoMenu = screen.getByRole('button', {
      name: 'Acoes do agendamento',
    });
    await user.click(botaoMenu);

    expect(screen.getByText('Check-in')).toBeInTheDocument();
    expect(screen.getByText('Abrir atendimento')).toBeInTheDocument();
    expect(screen.getByText('Enviar mensagem')).toBeInTheDocument();
    expect(screen.getByText('Cobrar')).toBeInTheDocument();
  });

  it('chama onClick ao clicar na linha', async () => {
    const user = userEvent.setup();
    const aoClicar = vi.fn();
    render(
      <ul>
        <LinhaDaAgenda agendamento={agendamentoPadrao} onClick={aoClicar} />
      </ul>,
    );

    const linha = screen.getByRole('listitem');
    await user.click(linha);
    expect(aoClicar).toHaveBeenCalledOnce();
  });

  it('suporta props legadas (API flat)', () => {
    render(
      <ul>
        <LinhaDaAgenda
          hora="09:00"
          paciente="Joao Santos"
          profissional="Dr. Marcos"
          procedimento="Retorno"
          status="atendido"
          encaixe={false}
        />
      </ul>,
    );
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('Joao Santos')).toBeInTheDocument();
    expect(screen.getByText(/Retorno/)).toBeInTheDocument();
    expect(screen.getByText(/Atendido/)).toBeInTheDocument();
  });

  it('define data-encaixe corretamente', () => {
    const { rerender } = render(
      <ul>
        <LinhaDaAgenda agendamento={{ ...agendamentoPadrao, encaixe: true }} />
      </ul>,
    );
    expect(screen.getByRole('listitem')).toHaveAttribute(
      'data-encaixe',
      'true',
    );

    rerender(
      <ul>
        <LinhaDaAgenda agendamento={{ ...agendamentoPadrao, encaixe: false }} />
      </ul>,
    );
    expect(screen.getByRole('listitem')).toHaveAttribute(
      'data-encaixe',
      'false',
    );
  });

  it('usa classes Tailwind sem inline styles', () => {
    render(
      <ul>
        <LinhaDaAgenda agendamento={agendamentoPadrao} />
      </ul>,
    );
    const linha = screen.getByRole('listitem');
    // Nao deve ter inline styles (style attribute vazio ou ausente)
    expect(linha.getAttribute('style')).toBeNull();
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <ul>
        <LinhaDaAgenda agendamento={agendamentoPadrao} />
      </ul>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nao tem violacoes de acessibilidade com todas as badges', async () => {
    const { container } = render(
      <ul>
        <LinhaDaAgenda
          agendamento={{
            ...agendamentoPadrao,
            encaixe: true,
            teleconsulta: true,
            primeiraVez: true,
          }}
        />
      </ul>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
