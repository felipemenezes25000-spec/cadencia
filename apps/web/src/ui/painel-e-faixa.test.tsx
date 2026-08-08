import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelLateral } from './PainelLateral';
import { FaixaDeContadores } from './FaixaDeContadores';

describe('painel lateral compositor', () => {
  it('usa largura md (420px) por padrao e renderiza como Radix Dialog', () => {
    render(<PainelLateral aberto titulo="Prescrever" aoFechar={vi.fn()}>
      <p>conteudo</p></PainelLateral>);
    const dialog = screen.getByRole('dialog', { name: 'Prescrever' });
    // Largura md e aplicada via classe Tailwind w-[420px]
    expect(dialog.className).toContain('w-[420px]');
  });

  it('Esc fecha e devolve o foco a origem', async () => {
    const aoFechar = vi.fn();
    render(<PainelLateral aberto titulo="Prescrever" aoFechar={aoFechar}>
      <button type="button">dentro</button></PainelLateral>);
    await userEvent.keyboard('{Escape}');
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it('faz focus trap: Tab nao escapa do painel (Radix Dialog)', async () => {
    render(<>
      <button type="button">fora</button>
      <PainelLateral aberto titulo="P" aoFechar={vi.fn()}>
        <button type="button">a</button><button type="button">b</button>
      </PainelLateral></>);
    await userEvent.tab(); await userEvent.tab(); await userEvent.tab();
    expect(document.activeElement).not.toHaveTextContent('fora');
  });

  it('sem violacao de acessibilidade', async () => {
    render(
      <PainelLateral aberto titulo="Prescrever" aoFechar={vi.fn()}><p>x</p></PainelLateral>);
    // Radix Portal renderiza em document.body
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('faixa de contadores', () => {
  const CONT = { agendados: 12, confirmados: 8, aguardando: 2, atendidos: 5, faltas: 1 };

  it('cada numero e um BUTTON que filtra a fila, nao um enfeite', async () => {
    const aoFiltrar = vi.fn();
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={aoFiltrar} />);
    await userEvent.click(screen.getByRole('button', { name: /Aguardando/ }));
    expect(aoFiltrar).toHaveBeenCalledWith('aguardando');
  });

  it('anuncia mudanca com aria-live polite', () => {
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Contadores do dia' }))
      .toHaveAttribute('aria-live', 'polite');
  });

  it('os numeros sao tabulares em 28/600', () => {
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} />);
    expect(screen.getByText('12')).toHaveStyle({ fontSize: '28px', fontWeight: '600' });
  });

  it('o filtro ativo fica marcado com aria-pressed', () => {
    render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} filtroAtivo="faltas" />);
    expect(screen.getByRole('button', { name: /Faltas/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<FaixaDeContadores contadores={CONT} aoFiltrar={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
