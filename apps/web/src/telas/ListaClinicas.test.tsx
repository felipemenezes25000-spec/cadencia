import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ListaClinicas, type ClinicaResumo } from './ListaClinicas';

const CLINICAS: ClinicaResumo[] = [
  { clinicId: 'c1', nome: 'Unidade Centro', cnes: '2077501', cnpj: null, timezone: 'America/Sao_Paulo' },
  { clinicId: 'c2', nome: 'Filial Norte', cnes: null, cnpj: '12345678000190', timezone: 'America/Manaus' },
];

function montar(over: Partial<Parameters<typeof ListaClinicas>[0]> = {}) {
  const props = {
    clinicas: CLINICAS,
    clinicaAtivaId: 'c1',
    podeCriar: true,
    aoCriar: vi.fn(),
    ...over,
  };
  render(<ListaClinicas {...props} />);
  return props;
}

describe('ListaClinicas', () => {
  it('renderiza todas as clínicas com colunas', () => {
    montar();
    expect(screen.getByText('Unidade Centro')).toBeDefined();
    expect(screen.getByText('Filial Norte')).toBeDefined();
    expect(screen.getByText('2077501')).toBeDefined();
    expect(screen.getByText('Brasília')).toBeDefined();
    expect(screen.getByText('Manaus')).toBeDefined();
  });

  it('destaca a clínica ativa com badge', () => {
    montar();
    expect(screen.getByText('ativa')).toBeDefined();
  });

  it('mostra traço quando CNES é null', () => {
    montar();
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('botão Criar unidade visível para admin', () => {
    montar({ podeCriar: true });
    expect(screen.getByRole('button', { name: /criar unidade/i })).toBeDefined();
  });

  it('botão Criar unidade oculto para não-admin', () => {
    montar({ podeCriar: false });
    expect(screen.queryByRole('button', { name: /criar unidade/i })).toBeNull();
  });

  it('chama aoCriar ao clicar no botão', async () => {
    const props = montar();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /criar unidade/i }));
    expect(props.aoCriar).toHaveBeenCalledOnce();
  });

  it('mostra mensagem vazia quando não há clínicas', () => {
    montar({ clinicas: [] });
    expect(screen.getByText(/nenhuma unidade/i)).toBeDefined();
  });

  it('passa a11y', async () => {
    const { container } = render(
      <ListaClinicas clinicas={CLINICAS} clinicaAtivaId="c1"
        podeCriar={true} aoCriar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
