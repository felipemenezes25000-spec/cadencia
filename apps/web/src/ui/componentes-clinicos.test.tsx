import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ChipDeStatus } from './ChipDeStatus';
import { LinhaDaAgenda } from './LinhaDaAgenda';
import { BlocoDeSecao } from './BlocoDeSecao';
import { VersaoRetificada } from './VersaoRetificada';

describe('componentes clinicos', () => {
  it('o chip carrega COR + GLIFO: cor nunca sozinha', () => {
    render(<ChipDeStatus status="atendido" />);
    const chip = screen.getByText(/Atendido/);
    expect(chip.textContent).toMatch(/[✓✕⏱●]/);
  });

  it('a linha da agenda comunica status por FORMA — barra de 3px na borda', () => {
    render(<LinhaDaAgenda hora="14:00" paciente="Maria Souza Lima" profissional="Dr. Alceu"
      status="aguardando" encaixe={false} />);
    const linha = screen.getByRole('listitem');
    expect(linha.style.borderLeft).toContain('3px');
  });

  it('encaixe recebe HACHURA diagonal, nao outra cor', () => {
    render(<LinhaDaAgenda hora="14:15" paciente="Encaixe" profissional="Dr. Alceu"
      status="agendado" encaixe />);
    expect(screen.getByRole('listitem')).toHaveAttribute('data-encaixe', 'true');
    expect(screen.getByText(/· encaixe/)).toBeVisible();
  });

  it('secao vazia colapsa em uma linha clicavel de 24px', async () => {
    render(<BlocoDeSecao titulo="Odontograma" vazia />);
    const botao = screen.getByRole('button', { name: /Odontograma/ });
    expect(botao).toHaveStyle({ minHeight: '24px' });
    await userEvent.click(botao);
    expect(screen.getByRole('region', { name: 'Odontograma' })).toBeVisible();
  });

  it('secao NAO usa card: titulo, regua de 1px e conteudo', () => {
    const { container } = render(
      <BlocoDeSecao titulo="Queixa"><p>cefaleia</p></BlocoDeSecao>);
    expect(container.innerHTML).not.toMatch(/border-radius: (8|12)px/);
    expect(screen.getByRole('heading', { name: 'Queixa' })).toBeVisible();
  });

  it('versao retificada e TACHADA com a cor de perigo, recolhida por padrao', async () => {
    render(<VersaoRetificada versaoNo={1} retificadaEm="12/05/2027" autor="Dr. Alceu"
      justificativa="digitado no paciente errado durante a consulta">
      <p>Queixa: cefaleia há 3 dias</p>
    </VersaoRetificada>);
    expect(screen.queryByText(/cefaleia/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /versão 1/i }));
    const conteudo = screen.getByTestId('conteudo-retificado');
    expect(conteudo).toHaveStyle({ textDecorationLine: 'line-through' });
    expect(screen.getByText(/digitado no paciente errado/)).toBeVisible();
  });

  it('o verbo Excluir NAO existe no vocabulario para registro finalizado', () => {
    render(<VersaoRetificada versaoNo={1} retificadaEm="12/05/2027" autor="Dr. Alceu"
      justificativa="x">conteudo</VersaoRetificada>);
    expect(screen.queryByText(/Excluir/i)).not.toBeInTheDocument();
  });

  it('nenhuma violacao de acessibilidade nos quatro componentes', async () => {
    const { container } = render(
      <ul>
        <LinhaDaAgenda hora="14:00" paciente="Maria" profissional="Dr. A"
          status="atendido" encaixe={false} />
      </ul>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
