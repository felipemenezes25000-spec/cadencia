// apps/web/src/telas/FormRecursoGlosa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  FormRecursoGlosa,
  type GlosaParaRecurso,
} from './FormRecursoGlosa';

const GLOSAS: readonly GlosaParaRecurso[] = [
  {
    id: 'gl1',
    guiaNumero: '000001',
    pacienteNome: 'Carlos Melo',
    codigoGlosa: '1005',
    descricaoGlosa: 'Procedimento nao autorizado',
    valorGlosadoCentavos: 15000,
  },
  {
    id: 'gl2',
    guiaNumero: '000002',
    pacienteNome: 'Ana Silva',
    codigoGlosa: '1015',
    descricaoGlosa: 'Fora do prazo',
    valorGlosadoCentavos: 8000,
  },
];

function montar() {
  const aoSubmeter = vi.fn<(dados: {
    glosas: { glosaId: string; justificativa: string }[];
    justificativaGeral: string;
  }) => Promise<void>>().mockResolvedValue(undefined);
  const aoCancelar = vi.fn();

  render(
    <FormRecursoGlosa
      glosas={GLOSAS}
      aoSubmeter={aoSubmeter}
      aoCancelar={aoCancelar}
    />,
  );
  return { aoSubmeter, aoCancelar };
}

describe('FormRecursoGlosa', () => {
  it('passo 1: mostra lista de glosas com campo de justificativa individual', () => {
    montar();
    expect(screen.getByText(/Passo 1/i)).toBeVisible();
    expect(screen.getByText('000001')).toBeVisible();
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    expect(campos).toHaveLength(2);
  });

  it('passo 1: botao Proximo desabilitado se justificativas estao vazias', () => {
    montar();
    const proximo = screen.getByRole('button', { name: /Proximo/i });
    expect(proximo).toBeDisabled();
  });

  it('passo 1: botao Proximo habilitado apos preencher todas as justificativas', async () => {
    montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Procedimento estava devidamente autorizado.');
    await userEvent.type(campos[1]!, 'Envio realizado dentro do prazo contratual.');
    const proximo = screen.getByRole('button', { name: /Proximo/i });
    expect(proximo).toBeEnabled();
  });

  it('passo 2: mostra campo de justificativa geral e resumo', async () => {
    montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Autorizado.');
    await userEvent.type(campos[1]!, 'Dentro do prazo.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    expect(screen.getByText(/Passo 2/i)).toBeVisible();
    expect(screen.getByLabelText(/Justificativa geral/i)).toBeVisible();
    expect(screen.getByText(/2 glosa/i)).toBeVisible();
    expect(screen.getByText('R$ 230,00')).toBeVisible();
  });

  it('passo 2: botao Submeter chama aoSubmeter com dados corretos', async () => {
    const { aoSubmeter } = montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Autorizado.');
    await userEvent.type(campos[1]!, 'Dentro do prazo.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    const geral = screen.getByLabelText(/Justificativa geral/i);
    await userEvent.type(geral, 'Recurso fundamentado conforme protocolo.');
    await userEvent.click(screen.getByRole('button', { name: /Submeter/i }));
    await waitFor(() => {
      expect(aoSubmeter).toHaveBeenCalledWith({
        glosas: [
          { glosaId: 'gl1', justificativa: 'Autorizado.' },
          { glosaId: 'gl2', justificativa: 'Dentro do prazo.' },
        ],
        justificativaGeral: 'Recurso fundamentado conforme protocolo.',
      });
    });
  });

  it('passo 2: botao Voltar retorna ao passo 1', async () => {
    montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Autorizado.');
    await userEvent.type(campos[1]!, 'Dentro do prazo.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    expect(screen.getByText(/Passo 2/i)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Voltar/i }));
    expect(screen.getByText(/Passo 1/i)).toBeVisible();
  });

  it('botao Cancelar chama aoCancelar', async () => {
    const { aoCancelar } = montar();
    await userEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(aoCancelar).toHaveBeenCalled();
  });

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(
      <FormRecursoGlosa
        glosas={GLOSAS}
        aoSubmeter={async () => {}}
        aoCancelar={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
