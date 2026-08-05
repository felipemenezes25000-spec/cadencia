// apps/web/src/telas/TemplatesDeMensagem.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { TemplatesDeMensagem, type TemplateAdmin } from './TemplatesDeMensagem';

const TEMPLATES: TemplateAdmin[] = [
  {
    templateId: 't1', nome: 'Confirmacao de consulta',
    corpo: 'Ola {{nome}}, confirme sua consulta em {{data}} as {{hora}}.',
    canal: 'whatsapp', statusAprovacao: 'aprovado',
  },
  {
    templateId: 't2', nome: 'Lembrete D-1',
    corpo: 'Ola {{nome}}, lembramos da consulta amanha as {{hora}}.',
    canal: 'whatsapp', statusAprovacao: 'pendente',
  },
  {
    templateId: 't3', nome: 'Pos-consulta',
    corpo: 'Ola {{nome}}, obrigado pela visita!',
    canal: 'whatsapp', statusAprovacao: 'rejeitado',
  },
];

function montar(over: Partial<Parameters<typeof TemplatesDeMensagem>[0]> = {}) {
  const props = {
    carregar: vi.fn(async () => TEMPLATES),
    aoCriar: vi.fn(),
    aoEditar: vi.fn(),
    ...over,
  };
  render(<TemplatesDeMensagem {...props} />);
  return props;
}

describe('tela Templates de Mensagem', () => {
  it('lista os templates com nome, canal e status de aprovacao', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Confirmacao de consulta')).toBeVisible();
      expect(screen.getByText('aprovado')).toBeVisible();
      expect(screen.getByText('pendente')).toBeVisible();
      expect(screen.getByText('rejeitado')).toBeVisible();
    });
  });

  it('botao Novo template chama aoCriar', async () => {
    const { aoCriar } = montar();
    await waitFor(() => expect(screen.getByText('Confirmacao de consulta')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Novo template/ }));
    expect(aoCriar).toHaveBeenCalled();
  });

  it('clicar no template chama aoEditar com o templateId', async () => {
    const { aoEditar } = montar();
    await waitFor(() => expect(screen.getByText('Lembrete D-1')).toBeVisible());
    await userEvent.click(screen.getByText('Lembrete D-1'));
    expect(aoEditar).toHaveBeenCalledWith('t2');
  });

  it('status de aprovacao tem cores distintas: aprovado, pendente, rejeitado', async () => {
    montar();
    await waitFor(() => {
      const aprovado = screen.getByText('aprovado');
      const rejeitado = screen.getByText('rejeitado');
      expect(aprovado.getAttribute('style')).toContain('var(--success)');
      expect(rejeitado.getAttribute('style')).toContain('var(--danger)');
    });
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <TemplatesDeMensagem carregar={async () => TEMPLATES}
        aoCriar={vi.fn()} aoEditar={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole('row').length).toBeGreaterThan(1));
    expect(await axe(container)).toHaveNoViolations();
  });
});
