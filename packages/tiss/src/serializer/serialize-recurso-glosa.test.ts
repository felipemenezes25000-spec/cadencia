import { describe, expect, it } from 'vitest';
import { serializeRecursoGlosa } from './serialize-recurso-glosa';
import type { RecursoGlosaInput, ItemRecursoGlosaInput, ContratadoRecursoInput } from './types';

function itemRecursoBase(): ItemRecursoGlosaInput {
  return {
    sequencialItem: '1',
    dataAtendimento: '2026-08-05',
    numeroGuiaPrestador: '00001',
    codigoProcedimento: '10101012',
    codigoGlosa: 'A10',
    valorRecursadoCentavos: 15000,
    justificativa: 'Procedimento realizado conforme indicacao clinica',
  };
}

function contratadoRecursoBase(): ContratadoRecursoInput {
  return {
    cnpjContratado: '11222333000181',
    cnes: '1234567',
  };
}

function recursoAmostra(): RecursoGlosaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
    },
    registroANS: '339679',
    numeroLoteOriginal: '0001',
    numeroRecursoGlosa: 'RG0001',
    contratado: contratadoRecursoBase(),
    itens: [itemRecursoBase()],
    encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
  };
}

describe('serializeRecursoGlosa', () => {
  it('retorna Uint8Array (bytes ISO-8859-1, nao string)', () => {
    const result = serializeRecursoGlosa(recursoAmostra());
    expect(result.xml).toBeInstanceOf(Uint8Array);
    expect(result.warnings).toEqual([]);
  });

  it('comeca com declaracao XML encoding ISO-8859-1', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
  });

  it('contem namespace ans correto na raiz', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"');
  });

  it('contem tag ans:mensagemTISS como raiz', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:mensagemTISS');
    expect(text).toContain('</ans:mensagemTISS>');
  });

  it('contem cabecalho com todos os campos', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:versaoPadrao>4.01.00</ans:versaoPadrao>');
    expect(text).toContain('<ans:registroANS>339679</ans:registroANS>');
    expect(text).toContain('<ans:dataGeracao>2026-08-07</ans:dataGeracao>');
    expect(text).toContain('<ans:horaGeracao>14:30:00</ans:horaGeracao>');
    expect(text).toContain('<ans:sequencialTransacao>12345</ans:sequencialTransacao>');
  });

  it('contem tag ans:recursoGlosa envolvendo o conteudo', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:recursoGlosa>');
    expect(text).toContain('</ans:recursoGlosa>');
  });

  it('contem numero do lote original e numero do recurso', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroLoteOriginal>0001</ans:numeroLoteOriginal>');
    expect(text).toContain('<ans:numeroRecursoGlosa>RG0001</ans:numeroRecursoGlosa>');
  });

  it('contem dados do contratado com CNPJ', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:dadosContratado>');
    expect(text).toContain('<ans:cnpjContratado>11222333000181</ans:cnpjContratado>');
    expect(text).toContain('<ans:CNES>1234567</ans:CNES>');
    expect(text).toContain('</ans:dadosContratado>');
  });

  it('contem dados do contratado com CPF quando fornecido', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      contratado: { cpfContratado: '12345678901', cnes: '1234567' },
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:cpfContratado>12345678901</ans:cpfContratado>');
    expect(text).not.toContain('<ans:cnpjContratado>');
  });

  it('contem dados do contratado com codigoPrestadorNaOperadora quando fornecido', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      contratado: { codigoPrestadorNaOperadora: 'PREST001', cnes: '7654321' },
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(
      '<ans:codigoPrestadorNaOperadora>PREST001</ans:codigoPrestadorNaOperadora>',
    );
  });

  it('contem item de recurso com todos os campos', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:itemRecursoGlosa>');
    expect(text).toContain('<ans:sequencialItem>1</ans:sequencialItem>');
    expect(text).toContain('<ans:dataAtendimento>2026-08-05</ans:dataAtendimento>');
    expect(text).toContain('<ans:numeroGuiaPrestador>00001</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:codigoProcedimento>10101012</ans:codigoProcedimento>');
    expect(text).toContain('<ans:codigoGlosa>A10</ans:codigoGlosa>');
    expect(text).toContain('<ans:valorRecursado>150.00</ans:valorRecursado>');
    expect(text).toContain(
      '<ans:justificativa>Procedimento realizado conforme indicacao clinica</ans:justificativa>',
    );
    expect(text).toContain('</ans:itemRecursoGlosa>');
  });

  it('inclui numeroGuiaOperadora quando presente no item', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [{ ...itemRecursoBase(), numeroGuiaOperadora: 'OP98765' }],
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaOperadora>OP98765</ans:numeroGuiaOperadora>');
  });

  it('omite numeroGuiaOperadora quando ausente no item', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).not.toContain('<ans:numeroGuiaOperadora>');
  });

  it('serializa multiplos itens de recurso', () => {
    const item2: ItemRecursoGlosaInput = {
      sequencialItem: '2',
      dataAtendimento: '2026-07-15',
      numeroGuiaPrestador: '00002',
      codigoProcedimento: '10101039',
      codigoGlosa: 'B15',
      valorRecursadoCentavos: 8050,
      justificativa: 'Exame necessario para diagnostico diferencial',
    };
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [itemRecursoBase(), item2],
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:sequencialItem>1</ans:sequencialItem>');
    expect(text).toContain('<ans:sequencialItem>2</ans:sequencialItem>');
    expect(text).toContain('<ans:valorRecursado>150.00</ans:valorRecursado>');
    expect(text).toContain('<ans:valorRecursado>80.50</ans:valorRecursado>');
  });

  it('contem tag ans:hash com hash MD5 proprietario', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    const hashMatch = text.match(/<ans:hash>([0-9a-f]{32})<\/ans:hash>/);
    expect(hashMatch).not.toBeNull();
  });

  it('escapa entidades XML na justificativa', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [{
        ...itemRecursoBase(),
        justificativa: 'PA > 14 & FC < 100 "normal"',
      }],
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(
      '<ans:justificativa>PA &gt; 14 &amp; FC &lt; 100 &quot;normal&quot;</ans:justificativa>',
    );
  });

  it('estrutura XML segue a ordem: cabecalho > prestadorParaOperadora > recursoGlosa > itens > epilogo', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    const idxCabecalho = text.indexOf('<ans:cabecalho>');
    const idxPrestador = text.indexOf('<ans:prestadorParaOperadora>');
    const idxRecurso = text.indexOf('<ans:recursoGlosa>');
    const idxItem = text.indexOf('<ans:itemRecursoGlosa>');
    const idxEpilogo = text.indexOf('<ans:epilogo>');
    expect(idxCabecalho).toBeLessThan(idxPrestador);
    expect(idxPrestador).toBeLessThan(idxRecurso);
    expect(idxRecurso).toBeLessThan(idxItem);
    expect(idxItem).toBeLessThan(idxEpilogo);
  });
});
