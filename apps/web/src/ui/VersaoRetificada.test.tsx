// apps/web/src/ui/VersaoRetificada.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { VersaoRetificada } from './VersaoRetificada';

describe('VersaoRetificada', () => {
  const propsBase = {
    versaoNo: 1,
    retificadaEm: '12/05/2027',
    autor: 'Dr. Alceu',
    justificativa: 'digitado no paciente errado',
  };

  it('mostra versão atual no botão', () => {
    render(
      <VersaoRetificada {...propsBase}>
        <p>Conteúdo antigo</p>
      </VersaoRetificada>,
    );
    expect(screen.getByRole('button', { name: /versão 1/i })).toBeInTheDocument();
  });

  it('conteúdo recolhido por padrão', () => {
    render(
      <VersaoRetificada {...propsBase}>
        <p>Conteúdo antigo</p>
      </VersaoRetificada>,
    );
    expect(screen.queryByText(/Conteúdo antigo/)).not.toBeInTheDocument();
  });

  it('expande ao clicar mostrando versão anterior', async () => {
    render(
      <VersaoRetificada {...propsBase}>
        <p>Conteúdo antigo</p>
      </VersaoRetificada>,
    );
    await userEvent.click(screen.getByRole('button', { name: /versão 1/i }));
    const conteudo = screen.getByTestId('conteudo-retificado');
    expect(conteudo).toBeVisible();
    expect(conteudo).toHaveStyle({ textDecorationLine: 'line-through' });
  });

  it('mostra motivo da retificação (justificativa)', async () => {
    render(
      <VersaoRetificada {...propsBase}>
        <p>Conteúdo</p>
      </VersaoRetificada>,
    );
    await userEvent.click(screen.getByRole('button', { name: /versão 1/i }));
    expect(screen.getByText(/digitado no paciente errado/)).toBeVisible();
  });

  it('mostra informações de retificação no header', () => {
    render(
      <VersaoRetificada {...propsBase}>
        <p>Conteúdo</p>
      </VersaoRetificada>,
    );
    expect(screen.getByText(/retificada em 12\/05\/2027 por Dr\. Alceu/)).toBeInTheDocument();
  });

  it('toggle recolhe ao clicar novamente', async () => {
    render(
      <VersaoRetificada {...propsBase}>
        <p>Conteúdo antigo</p>
      </VersaoRetificada>,
    );
    const botao = screen.getByRole('button', { name: /versão 1/i });
    await userEvent.click(botao);
    expect(screen.getByTestId('conteudo-retificado')).toBeVisible();
    await userEvent.click(botao);
    // Content should be removed from the DOM after collapse
    expect(screen.queryByTestId('conteudo-retificado')).not.toBeInTheDocument();
  });

  it('não mostra verbo Excluir', () => {
    render(
      <VersaoRetificada {...propsBase}>
        <p>Conteúdo</p>
      </VersaoRetificada>,
    );
    expect(screen.queryByText(/Excluir/i)).not.toBeInTheDocument();
  });

  it('sem violação de acessibilidade', async () => {
    const { container } = render(
      <VersaoRetificada {...propsBase}>
        <p>Conteúdo</p>
      </VersaoRetificada>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
