import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FichaClinica, type SecaoDaFicha } from './FichaClinica';

const SECOES: SecaoDaFicha[] = [
  {
    sectionId: 's1', code: 'antecedentes', label: 'Antecedentes',
    campos: [{
      fieldId: 'f-alergias', code: 'alergias', label: 'Alergias',
      kind: 'texto_curto', generation: 1, required: false,
      unit: null, options: null, refSource: null, observationCode: null, componentes: [],
    }],
  },
  {
    sectionId: 's2', code: 'sinais_vitais', label: 'Sinais vitais',
    campos: [
      {
        fieldId: 'f-peso', code: 'peso', label: 'Peso', kind: 'numerico',
        generation: 1, required: false, unit: 'kg', options: null,
        refSource: null, observationCode: null, componentes: [],
      },
      {
        fieldId: 'f-pa', code: 'pa', label: 'Pressao arterial', kind: 'composto',
        generation: 1, required: false, unit: null, options: null, refSource: null, observationCode: null,
        componentes: [
          { ordinal: 1, label: 'Sistolica', unit: 'mmHg', observationCode: 'PA_SIS' },
          { ordinal: 2, label: 'Diastolica', unit: 'mmHg', observationCode: 'PA_DIA' },
        ],
      },
      {
        fieldId: 'f-odonto', code: 'odonto', label: 'Odontograma',
        kind: 'odontograma', generation: 1, required: false,
        unit: null, options: null, refSource: null, observationCode: null, componentes: [],
      },
      {
        fieldId: 'f-exotico', code: 'oculos', label: 'Prescrição de óculos',
        kind: 'oculos', generation: 1, required: false,
        unit: null, options: null, refSource: null, observationCode: null, componentes: [],
      },
    ],
  },
  {
    sectionId: 's3', code: 'hipoteses', label: 'Hipoteses diagnosticas',
    campos: [{
      fieldId: 'f-cid', code: 'cid', label: 'CID-10', kind: 'busca_tabela',
      generation: 1, required: false, unit: null, options: null,
      refSource: 'CID10', observationCode: null, componentes: [],
    }],
  },
];

function montar(over: Record<string, unknown> = {}) {
  const aoMudar = vi.fn();
  const buscarCodigo = vi.fn(async () => [
    { code: 'J06.9', display: 'Infeccao aguda das vias aereas superiores' },
  ]);
  const props = {
    secoes: SECOES, valores: {}, aoMudar, buscarCodigo, ...over,
  };
  render(<FichaClinica {...props} />);
  return props;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('FichaClinica', () => {
  it('renderiza os campos que a CLÍNICA configurou, não uma lista fixa', () => {
    montar();
    expect(screen.getByLabelText(/alergias/i)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /sinais vitais/i })).toBeInTheDocument();
  });

  it('campo numérico mostra a unidade ao lado', () => {
    montar();
    // Sem a unidade na tela, "70" pode ser kg ou lb, e "1.70" pode ser m ou cm.
    // O gráfico de evolução de peso é construído em cima desse número.
    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('campo composto vira DOIS campos, um por componente', () => {
    montar();
    // PA como caixa única faz o médico digitar "12x8": não existe série
    // numérica, nem gráfico, nem alerta de hipertensão em cima de texto livre.
    expect(screen.getByLabelText(/sistolica/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/diastolica/i)).toBeInTheDocument();
  });

  it('avisa em vez de esconder o tipo de campo que ainda não renderiza', () => {
    montar();
    // Sumir com o campo faria a clínica achar que configurou algo que não existe
    // e o dado nunca ser coletado, sem ninguém perceber.
    expect(screen.getByText(/oculos.*ainda não|não suportado/i)).toBeInTheDocument();
  });

  it('campo de odontograma renderiza a arcada, não o aviso de não suportado', () => {
    montar();
    // Sem odontograma o produto não entra em clínica odontológica. A persistência
    // e o registro de tipo já existiam; faltava só a tela.
    expect(screen.getByRole('list', { name: 'Arcada superior' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Arcada inferior' })).toBeInTheDocument();
  });

  it('digitar alergia avisa o pai com o fieldId', () => {
    const { aoMudar } = montar();
    fireEvent.change(screen.getByLabelText(/alergias/i),
      { target: { value: 'Dipirona' } });
    expect(aoMudar).toHaveBeenCalledWith('f-alergias', 'Dipirona');
  });

  it('componente do composto avisa com sufixo do código de observação', () => {
    const { aoMudar } = montar();
    fireEvent.change(screen.getByLabelText(/sistolica/i), { target: { value: '120' } });
    // A chave carrega o observation_code porque é ele que vira clin.observation.
    expect(aoMudar).toHaveBeenCalledWith('f-pa:PA_SIS', '120');
  });

  it('busca_tabela consulta o catálogo e devolve o código escolhido', async () => {
    const { aoMudar, buscarCodigo } = montar();
    fireEvent.change(screen.getByLabelText(/cid-10/i), { target: { value: 'infec' } });
    await waitFor(() => expect(buscarCodigo).toHaveBeenCalledWith('infec'));

    const opcao = await screen.findByRole('button', { name: /J06\.9/ });
    fireEvent.click(opcao);
    // Guarda código E descrição: o display_snapshot da versão selada precisa do
    // texto vigente na época, não do texto que o catálogo tiver daqui a 5 anos.
    expect(aoMudar).toHaveBeenCalledWith(
      'f-cid', 'J06.9|Infeccao aguda das vias aereas superiores');
  });

  it('não busca com menos de dois caracteres', async () => {
    const { buscarCodigo } = montar();
    fireEvent.change(screen.getByLabelText(/cid-10/i), { target: { value: 'j' } });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(buscarCodigo).not.toHaveBeenCalled();
  });
});
