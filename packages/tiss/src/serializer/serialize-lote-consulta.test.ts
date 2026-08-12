import { describe, expect, it } from 'vitest';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import type { GuiaConsultaInput, LoteConsultaInput } from './types';

function guiaBase(): GuiaConsultaInput {
  return {
    registroANSOperadora: '123456',
    numeroGuiaPrestador: '00001',
    numeroCarteira: '98765432101234567',
    atendimentoRN: false,
    contratado: {
      cnpjContratado: '11222333000181',
      cnes: '1234567',
    },
    profissionalExecutante: {
      conselhoProfissional: '06',
      numeroConselho: '123456',
      ufConselho: 'SP',
      cbos: '225120',
    },
    indicacaoAcidente: '9',
    regimeAtendimento: '01',
    dataAtendimento: '2026-08-05',
    tipoConsulta: '1',
    codigoTabela: '22',
    codigoProcedimento: '10101012',
    valorProcedimentoCentavos: 15000,
  };
}

function loteAmostra(): LoteConsultaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
    },
    registroANS: '339679',
    numeroLote: '0001',
    guias: [guiaBase()],
  };
}

describe('serializeLoteConsulta', () => {
  it('retorna Uint8Array (bytes ISO-8859-1, nao string)', () => {
    const result = serializeLoteConsulta(loteAmostra());
    expect(result.xml).toBeInstanceOf(Uint8Array);
    expect(result.warnings).toEqual([]);
  });

  it('comeca com declaracao XML encoding ISO-8859-1', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const decoder = new TextDecoder('iso-8859-1');
    const text = decoder.decode(xml);
    expect(text.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
  });

  it('contem namespace ans correto na raiz', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"');
  });

  it('contem tag ans:mensagemTISS como raiz', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:mensagemTISS');
    expect(text).toContain('</ans:mensagemTISS>');
  });

  it('cabecalho segue a forma da norma: agrupado, nao plano', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);

    // O padrão agrupa por propósito. A versão antiga deste teste afirmava um
    // cabeçalho plano (versaoPadrao, registroANS, dataGeracao... em sequência),
    // que era a forma de um XSD de amostra escrito a mão — nunca a da ANS.
    expect(text).toContain('<ans:identificacaoTransacao>');
    expect(text).toContain('<ans:tipoTransacao>ENVIO_LOTE_GUIAS</ans:tipoTransacao>');
    expect(text).toContain('<ans:dataRegistroTransacao>2026-08-07</ans:dataRegistroTransacao>');
    expect(text).toContain('<ans:horaRegistroTransacao>14:30:00</ans:horaRegistroTransacao>');
    expect(text).toContain('<ans:sequencialTransacao>12345</ans:sequencialTransacao>');
    // `Padrao`, com P maiúsculo, é o nome do elemento no XSD.
    expect(text).toContain('<ans:Padrao>4.01.00</ans:Padrao>');
    expect(text).toContain('<ans:destino><ans:registroANS>339679</ans:registroANS></ans:destino>');
    expect(text).not.toContain('<ans:versaoPadrao>');
  });

  it('contem tag ans:hash com hash MD5 proprietario', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    const hashMatch = text.match(/<ans:hash>([0-9a-f]{32})<\/ans:hash>/);
    expect(hashMatch).not.toBeNull();
  });

  it('contem numero do lote', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroLote>0001</ans:numeroLote>');
  });

  it('contem dados da guia de consulta', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaPrestador>00001</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:numeroCarteira>98765432101234567</ans:numeroCarteira>');
    expect(text).toContain('<ans:atendimentoRN>N</ans:atendimentoRN>');
    expect(text).toContain('<ans:CNES>1234567</ans:CNES>');
    expect(text).toContain('<ans:codigoTabela>22</ans:codigoTabela>');
    expect(text).toContain('<ans:codigoProcedimento>10101012</ans:codigoProcedimento>');
    expect(text).toContain('<ans:valorProcedimento>150.00</ans:valorProcedimento>');
  });

  it('serializa atendimentoRN como S/N (booleano TISS)', () => {
    const lote = loteAmostra();
    const guiaRN: GuiaConsultaInput = { ...guiaBase(), atendimentoRN: true };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guiaRN] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:atendimentoRN>S</ans:atendimentoRN>');
  });

  it('omite tags opcionais quando campo e undefined', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    // guia da amostra não tem observação, guia operadora, saúde ocupacional, cobertura especial
    expect(text).not.toContain('<ans:observacao>');
    expect(text).not.toContain('<ans:numeroGuiaOperadora>');
    expect(text).not.toContain('<ans:saudeOcupacional>');
    expect(text).not.toContain('<ans:coberturaEspecial>');
  });

  it('inclui tags opcionais quando campo esta presente', () => {
    const lote = loteAmostra();
    const guia: GuiaConsultaInput = {
      ...guiaBase(),
      numeroGuiaOperadora: 'OP12345',
      observacao: 'Retorno em 30 dias',
      saudeOcupacional: '1',
      coberturaEspecial: '0',
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaOperadora>OP12345</ans:numeroGuiaOperadora>');
    expect(text).toContain('<ans:observacao>Retorno em 30 dias</ans:observacao>');
    expect(text).toContain('<ans:saudeOcupacional>1</ans:saudeOcupacional>');
    expect(text).toContain('<ans:coberturaEspecial>0</ans:coberturaEspecial>');
  });

  it('serializa contratado com CNPJ quando cnpjContratado presente', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:cnpjContratado>11222333000181</ans:cnpjContratado>');
    expect(text).not.toContain('<ans:cpfContratado>');
    expect(text).not.toContain('<ans:codigoPrestadorNaOperadora>');
  });

  it('serializa contratado com CPF quando cpfContratado presente', () => {
    const lote = loteAmostra();
    const guia: GuiaConsultaInput = {
      ...guiaBase(),
      contratado: { cpfContratado: '12345678901', cnes: '1234567' },
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:cpfContratado>12345678901</ans:cpfContratado>');
    expect(text).not.toContain('<ans:cnpjContratado>');
  });

  it('serializa multiplas guias no mesmo lote', () => {
    const lote = loteAmostra();
    const guia1 = guiaBase();
    const guia2: GuiaConsultaInput = {
      ...guiaBase(),
      registroANSOperadora: '123456',
      numeroGuiaPrestador: '00002',
      valorProcedimentoCentavos: 20000,
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia1, guia2] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaPrestador>00001</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:numeroGuiaPrestador>00002</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:valorProcedimento>200.00</ans:valorProcedimento>');
  });

  it('escapa entidades XML em campo de observacao', () => {
    const lote = loteAmostra();
    const guia: GuiaConsultaInput = {
      ...guiaBase(),
      observacao: 'PA > 14 & FC < 100 "normal"',
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(
      '<ans:observacao>PA &gt; 14 &amp; FC &lt; 100 &quot;normal&quot;</ans:observacao>',
    );
  });
});
