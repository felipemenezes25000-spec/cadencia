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
        fieldId: 'f-exotico', code: 'odonto', label: 'Odontograma',
        kind: 'odontograma', generation: 1, required: false,
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
  it('renderiza os campos que a CLINICA configurou, nao uma lista fixa', () => {
    montar();
    expect(screen.getByLabelText(/alergias/i)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /sinais vitais/i })).toBeInTheDocument();
  });

  it('campo numerico mostra a unidade ao lado', () => {
    montar();
    // Sem a unidade na tela, "70" pode ser kg ou lb, e "1.70" pode ser m ou cm.
    // O grafico de evolucao de peso e construido em cima desse numero.
    expect(screen.getByText('kg')).toBeInTheDocument();
  });

  it('campo composto vira DOIS campos, um por componente', () => {
    montar();
    // PA como caixa unica faz o medico digitar "12x8": nao existe serie
    // numerica, nem grafico, nem alerta de hipertensao em cima de texto livre.
    expect(screen.getByLabelText(/sistolica/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/diastolica/i)).toBeInTheDocument();
  });

  it('avisa em vez de esconder o tipo de campo que ainda nao renderiza', () => {
    montar();
    // Sumir com o campo faria a clinica achar que configurou algo que nao existe
    // e o dado nunca ser coletado, sem ninguem perceber.
    expect(screen.getByText(/odontograma.*ainda nao|nao suportado/i)).toBeInTheDocument();
  });

  it('digitar alergia avisa o pai com o fieldId', () => {
    const { aoMudar } = montar();
    fireEvent.change(screen.getByLabelText(/alergias/i),
      { target: { value: 'Dipirona' } });
    expect(aoMudar).toHaveBeenCalledWith('f-alergias', 'Dipirona');
  });

  it('componente do composto avisa com sufixo do codigo de observacao', () => {
    const { aoMudar } = montar();
    fireEvent.change(screen.getByLabelText(/sistolica/i), { target: { value: '120' } });
    // A chave carrega o observation_code porque e ele que vira clin.observation.
    expect(aoMudar).toHaveBeenCalledWith('f-pa:PA_SIS', '120');
  });

  it('busca_tabela consulta o catalogo e devolve o codigo escolhido', async () => {
    const { aoMudar, buscarCodigo } = montar();
    fireEvent.change(screen.getByLabelText(/cid-10/i), { target: { value: 'infec' } });
    await waitFor(() => expect(buscarCodigo).toHaveBeenCalledWith('infec'));

    const opcao = await screen.findByRole('button', { name: /J06\.9/ });
    fireEvent.click(opcao);
    // Guarda codigo E descricao: o display_snapshot da versao selada precisa do
    // texto vigente na epoca, nao do texto que o catalogo tiver daqui a 5 anos.
    expect(aoMudar).toHaveBeenCalledWith(
      'f-cid', 'J06.9|Infeccao aguda das vias aereas superiores');
  });

  it('nao busca com menos de dois caracteres', async () => {
    const { buscarCodigo } = montar();
    fireEvent.change(screen.getByLabelText(/cid-10/i), { target: { value: 'j' } });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(buscarCodigo).not.toHaveBeenCalled();
  });
});
