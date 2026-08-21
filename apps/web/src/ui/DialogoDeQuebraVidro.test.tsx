import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogoDeQuebraVidro } from './DialogoDeQuebraVidro';

const JUSTIFICATIVA = 'Paciente em atendimento de urgência, preciso conferir alergias.';

function montar(over: Partial<Parameters<typeof DialogoDeQuebraVidro>[0]> = {}) {
  const props = {
    aberto: true,
    nomeDoPaciente: 'Maria Souza Lima',
    aoFechar: vi.fn(),
    aoConfirmar: vi.fn(async () => {}),
    ...over,
  };
  render(<DialogoDeQuebraVidro {...props} />);
  return props;
}

describe('DialogoDeQuebraVidro', () => {
  it('avisa que o acesso é nominal e auditado antes de qualquer confirmação', () => {
    montar();
    /* Um quebra-vidro que nao avisa e uma armadilha: a pessoa descobre a
       auditoria depois de acionar. */
    expect(screen.getByText('Este acesso fica registrado no seu nome.')).toBeVisible();
  });

  it('bloqueia o envio enquanto a justificativa não atinge o mínimo do banco', async () => {
    const { aoConfirmar } = montar();
    const liberar = screen.getByRole('button', { name: 'Liberar acesso' });
    expect(liberar).toBeDisabled();

    await userEvent.type(screen.getByRole('textbox'), 'curta');
    expect(liberar).toBeDisabled();
    expect(aoConfirmar).not.toHaveBeenCalled();
  });

  it('diz quantos caracteres faltam, em vez de só desabilitar', async () => {
    montar();
    await userEvent.type(screen.getByRole('textbox'), 'urgência');
    expect(screen.getByText(/Faltam 12 caracteres/)).toBeVisible();
  });

  it('envia justificativa e prazo escolhido', async () => {
    const { aoConfirmar } = montar();
    await userEvent.type(screen.getByRole('textbox'), JUSTIFICATIVA);
    await userEvent.click(screen.getByRole('button', { name: '12 horas' }));
    await userEvent.click(screen.getByRole('button', { name: 'Liberar acesso' }));

    expect(aoConfirmar).toHaveBeenCalledWith({ justificativa: JUSTIFICATIVA, horas: 12 });
  });

  it('usa 4 horas como prazo padrão', async () => {
    const { aoConfirmar } = montar();
    await userEvent.type(screen.getByRole('textbox'), JUSTIFICATIVA);
    await userEvent.click(screen.getByRole('button', { name: 'Liberar acesso' }));

    expect(aoConfirmar).toHaveBeenCalledWith({ justificativa: JUSTIFICATIVA, horas: 4 });
  });

  it('corta espaço em volta antes de medir e de enviar', async () => {
    const { aoConfirmar } = montar();
    await userEvent.type(screen.getByRole('textbox'), `   ${JUSTIFICATIVA}   `);
    await userEvent.click(screen.getByRole('button', { name: 'Liberar acesso' }));

    expect(aoConfirmar).toHaveBeenCalledWith({ justificativa: JUSTIFICATIVA, horas: 4 });
  });

  it('em falha, informa que NENHUMA autorização foi criada e não fecha', async () => {
    /* A frase importa: quem tenta um quebra-vidro precisa saber, sem ambiguidade,
       se ficou com acesso ou nao — e se um evento foi para a auditoria. */
    const { aoFechar } = montar({ aoConfirmar: vi.fn().mockRejectedValue(new Error('falhou')) });
    await userEvent.type(screen.getByRole('textbox'), JUSTIFICATIVA);
    await userEvent.click(screen.getByRole('button', { name: 'Liberar acesso' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nenhuma autorização foi criada.');
    expect(aoFechar).not.toHaveBeenCalled();
  });

  it('fecha ao concluir com sucesso', async () => {
    const { aoFechar } = montar();
    await userEvent.type(screen.getByRole('textbox'), JUSTIFICATIVA);
    await userEvent.click(screen.getByRole('button', { name: 'Liberar acesso' }));

    expect(aoFechar).toHaveBeenCalled();
  });
});
