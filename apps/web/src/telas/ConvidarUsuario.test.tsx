import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ConvidarUsuario } from './ConvidarUsuario';

function montar(over: Partial<Parameters<typeof ConvidarUsuario>[0]> = {}) {
  const props = {
    aberto: true,
    aoFechar: vi.fn(),
    aoConvidar: vi.fn(async () => {}),
    ...over,
  };
  render(<ConvidarUsuario {...props} />);
  return props;
}

describe('ConvidarUsuario', () => {
  it('renderiza campos quando aberto=true', () => {
    montar();
    expect(screen.getByLabelText(/email/i)).toBeDefined();
    expect(screen.getByLabelText(/nome completo/i)).toBeDefined();
    expect(screen.getByLabelText(/papel/i)).toBeDefined();
    expect(screen.getByLabelText(/senha temporaria/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /convidar/i })).toBeDefined();
  });

  it('nao renderiza nada quando aberto=false', () => {
    montar({ aberto: false });
    expect(screen.queryByLabelText(/email/i)).toBeNull();
  });

  it('campos profissionais aparecem ao selecionar role profissional', async () => {
    montar();
    const user = userEvent.setup();
    expect(screen.queryByLabelText(/numero do conselho/i)).toBeNull();
    await user.selectOptions(screen.getByLabelText(/papel/i), 'profissional');
    expect(screen.getByLabelText(/^conselho$/i)).toBeDefined();
    expect(screen.getByLabelText(/numero do conselho/i)).toBeDefined();
    expect(screen.getByLabelText(/uf do conselho/i)).toBeDefined();
  });

  it('campos profissionais ocultos para recepcao', async () => {
    montar();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/papel/i), 'recepcao');
    expect(screen.queryByLabelText(/numero do conselho/i)).toBeNull();
  });

  it('botao desabilitado com campos vazios', () => {
    montar();
    expect(screen.getByRole('button', { name: /convidar/i })).toBeDisabled();
  });

  it('chama aoConvidar com dados corretos (recepcao)', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'novo@test.local');
    await user.type(screen.getByLabelText(/nome completo/i), 'Novo Usuario');
    await user.selectOptions(screen.getByLabelText(/papel/i), 'recepcao');
    await user.type(screen.getByLabelText(/senha temporaria/i), 'Temp@2026xx');
    await user.click(screen.getByRole('button', { name: /convidar/i }));
    expect(props.aoConvidar).toHaveBeenCalledWith({
      email: 'novo@test.local',
      nome: 'Novo Usuario',
      role: 'recepcao',
      senhaTemporaria: 'Temp@2026xx',
    });
  });

  it('chama aoConvidar com dados profissionais quando profissional', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'dr@test.local');
    await user.type(screen.getByLabelText(/nome completo/i), 'Dr Novo');
    await user.selectOptions(screen.getByLabelText(/papel/i), 'profissional');
    await user.type(screen.getByLabelText(/senha temporaria/i), 'Temp@2026xx');
    await user.type(screen.getByLabelText(/numero do conselho/i), '54321');
    await user.click(screen.getByRole('button', { name: /convidar/i }));
    expect(props.aoConvidar).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'dr@test.local',
        nome: 'Dr Novo',
        role: 'profissional',
        conselho: '06',
        numeroConselho: '54321',
        ufConselho: 'SP',
      }),
    );
  });

  it('exibe erro em caso de falha', async () => {
    montar({
      aoConvidar: vi.fn(async () => { throw new Error('vinculo_duplicado'); }),
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'dup@test.local');
    await user.type(screen.getByLabelText(/nome completo/i), 'Dup User');
    await user.type(screen.getByLabelText(/senha temporaria/i), 'Temp@2026xx');
    await user.click(screen.getByRole('button', { name: /convidar/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/ja tem esse papel/i)).toBeDefined();
    });
  });

  it('passa a11y', async () => {
    const { container } = render(
      <ConvidarUsuario
        aberto={true}
        aoFechar={vi.fn()}
        aoConvidar={vi.fn(async () => {})}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
