import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Odontograma } from './Odontograma';

function montar(valor = '', aoMudar = vi.fn()) {
  const r = render(
    <Odontograma rotulo="Odontograma" valor={valor} aoMudar={aoMudar} />,
  );
  return { ...r, aoMudar };
}

/** Último JSON gravado, já parseado. */
function ultimoDoc(aoMudar: ReturnType<typeof vi.fn>): {
  denticao: string; dentes: Record<string, unknown>;
} {
  const chamadas = aoMudar.mock.calls;
  return JSON.parse(chamadas[chamadas.length - 1]![0] as string) as {
    denticao: string; dentes: Record<string, unknown>;
  };
}

describe('Odontograma — arcada', () => {
  it('mostra as 32 posicoes da denticao permanente', () => {
    montar();
    const sup = screen.getByRole('list', { name: 'Arcada superior' });
    const inf = screen.getByRole('list', { name: 'Arcada inferior' });
    expect(within(sup).getAllByRole('button')).toHaveLength(16);
    expect(within(inf).getAllByRole('button')).toHaveLength(16);
  });

  it('trocar para decidua mostra 20 dentes e NAO apaga o que ja foi marcado', async () => {
    const u = userEvent.setup();
    const aoMudar = vi.fn();
    const valor = JSON.stringify({ denticao: 'permanente', dentes: { '16': { condicao: 'protese' } } });
    montar(valor, aoMudar);

    await u.click(screen.getByRole('button', { name: 'Decídua' }));

    const doc = ultimoDoc(aoMudar);
    expect(doc.denticao).toBe('decidua');
    /* A marcação do permanente sobrevive: o paciente pode voltar para a outra
       arcada sem perder o registro. */
    expect(doc.dentes['16']).toEqual({ condicao: 'protese' });
  });

  it('a denticao mista mostra as duas arcadas juntas', async () => {
    const u = userEvent.setup();
    montar(JSON.stringify({ denticao: 'mista', dentes: {} }));
    const sup = screen.getByRole('list', { name: 'Arcada superior' });
    expect(within(sup).getAllByRole('button').length).toBeGreaterThan(16);
    await u.click(screen.getByRole('button', { name: 'Permanente' }));
  });
});

describe('Odontograma — leitor de tela', () => {
  it('cada dente anuncia numero e estado, nao so o numero', () => {
    montar(JSON.stringify({
      dentes: {
        '11': { condicao: 'ausente' },
        '16': { faces: { oclusal: 'carie' }, nota: 'acompanhar' },
      },
    }));
    expect(screen.getByRole('button', { name: 'Dente 11. Ausente' })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Dente 16. Oclusal/incisal: Cárie. Nota: acompanhar',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dente 12, sem marcação' })).toBeInTheDocument();
  });

  it('a condicao tambem aparece como glifo — cor sozinha nao carrega significado', () => {
    const { container } = montar(JSON.stringify({ dentes: { '11': { condicao: 'implante' } } }));
    /* WCAG 1.4.1: parte dos dentistas tem deficiencia de visao de cor. */
    expect(container.querySelector('text')?.textContent).toBe('I');
  });

  it('nao tem violacoes axe', async () => {
    const { container } = montar(JSON.stringify({ dentes: { '16': { faces: { oclusal: 'carie' } } } }));
    const r = await axe(container);
    expect(r).toHaveNoViolations();
  });
});

describe('Odontograma — edicao', () => {
  it('selecionar um dente abre o editor daquele dente', async () => {
    const u = userEvent.setup();
    montar();
    expect(screen.getByText(/Selecione um dente/)).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Dente 16, sem marcação' }));

    expect(screen.getByRole('heading', { name: /Dente 16/ })).toBeInTheDocument();
    /* 16 e molar: face de mastigacao chama oclusal. */
    expect(screen.getByLabelText('Oclusal/incisal')).toBeInTheDocument();
  });

  it('dente anterior mostra a face como Incisal, nao Oclusal', async () => {
    const u = userEvent.setup();
    montar();
    await u.click(screen.getByRole('button', { name: 'Dente 11, sem marcação' }));
    expect(screen.getByLabelText('Incisal')).toBeInTheDocument();
  });

  it('marcar condicao do dente grava no JSON', async () => {
    const u = userEvent.setup();
    const aoMudar = vi.fn();
    montar('', aoMudar);

    await u.click(screen.getByRole('button', { name: 'Dente 21, sem marcação' }));
    await u.selectOptions(screen.getByLabelText('Condição do dente'), 'implante');

    expect(ultimoDoc(aoMudar).dentes['21']).toEqual({ condicao: 'implante' });
  });

  it('marcar uma face grava so aquela face', async () => {
    const u = userEvent.setup();
    const aoMudar = vi.fn();
    montar('', aoMudar);

    await u.click(screen.getByRole('button', { name: 'Dente 36, sem marcação' }));
    await u.selectOptions(screen.getByLabelText('Mesial'), 'restauracao');

    expect(ultimoDoc(aoMudar).dentes['36']).toEqual({ faces: { mesial: 'restauracao' } });
  });

  it('voltar a condicao para "Sem marcação" REMOVE o dente do documento', async () => {
    const u = userEvent.setup();
    const aoMudar = vi.fn();
    montar(JSON.stringify({ dentes: { '11': { condicao: 'ausente' } } }), aoMudar);

    await u.click(screen.getByRole('button', { name: 'Dente 11. Ausente' }));
    await u.selectOptions(screen.getByLabelText('Condição do dente'), '');

    /* O JSON guarda o que foi afirmado. Dente sem nada nao ocupa espaco em
       toda versao do prontuario. */
    expect(ultimoDoc(aoMudar).dentes).toEqual({});
  });

  it('limpar a face nao apaga a condicao do dente', async () => {
    const u = userEvent.setup();
    const aoMudar = vi.fn();
    montar(
      JSON.stringify({ dentes: { '16': { condicao: 'protese', faces: { oclusal: 'carie' } } } }),
      aoMudar,
    );

    await u.click(screen.getByRole('button', { name: /Dente 16\./ }));
    await u.selectOptions(screen.getByLabelText('Oclusal/incisal'), '');

    expect(ultimoDoc(aoMudar).dentes['16']).toEqual({ condicao: 'protese' });
  });

  it('somenteLeitura desabilita os controles', () => {
    render(<Odontograma rotulo="Odontograma" valor="" aoMudar={vi.fn()} somenteLeitura />);
    expect(screen.getByRole('button', { name: 'Permanente' })).toBeDisabled();
  });
});
