import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeTissHash, computeRecursoGlosaHash } from './compute-tiss-hash';
import type { GuiaConsultaInput, CabecalhoInput, ItemRecursoGlosaInput } from './types';

describe('computeTissHash — hash MD5 proprietario TISS', () => {
  const cabecalho: CabecalhoInput = {
    versaoPadrao: '4.01.00',
    registroANS: '339679',
    dataGeracao: '2026-08-07',
    horaGeracao: '14:30:00',
    sequencialTransacao: '12345',
  };

  const guiaBase: GuiaConsultaInput = {
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

  it('retorna string hexadecimal MD5 de 32 caracteres', () => {
    const hash = computeTissHash(cabecalho, '0001', [guiaBase]);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('e deterministico: mesma entrada produz mesmo hash', () => {
    const hash1 = computeTissHash(cabecalho, '0001', [guiaBase]);
    const hash2 = computeTissHash(cabecalho, '0001', [guiaBase]);
    expect(hash1).toBe(hash2);
  });

  it('muda quando o numero do lote muda', () => {
    const hash1 = computeTissHash(cabecalho, '0001', [guiaBase]);
    const hash2 = computeTissHash(cabecalho, '0002', [guiaBase]);
    expect(hash1).not.toBe(hash2);
  });

  it('muda quando o cabecalho muda', () => {
    const hash1 = computeTissHash(cabecalho, '0001', [guiaBase]);
    const cabecalho2 = { ...cabecalho, sequencialTransacao: '99999' };
    const hash2 = computeTissHash(cabecalho2, '0001', [guiaBase]);
    expect(hash1).not.toBe(hash2);
  });

  it('muda quando o valor do procedimento muda (centavo a centavo)', () => {
    const hash1 = computeTissHash(cabecalho, '0001', [guiaBase]);
    const guia2 = { ...guiaBase, valorProcedimentoCentavos: 15001 };
    const hash2 = computeTissHash(cabecalho, '0001', [guia2]);
    expect(hash1).not.toBe(hash2);
  });

  it('muda quando a ordem das guias muda', () => {
    const guia2: GuiaConsultaInput = {
      ...guiaBase,
      registroANSOperadora: '123456',
      numeroGuiaPrestador: '00002',
      valorProcedimentoCentavos: 20000,
    };
    const hashAB = computeTissHash(cabecalho, '0001', [guiaBase, guia2]);
    const hashBA = computeTissHash(cabecalho, '0001', [guia2, guiaBase]);
    expect(hashAB).not.toBe(hashBA);
  });

  it('congela o hash para os dados de amostra (snapshot)', () => {
    const hash = computeTissHash(cabecalho, '0001', [guiaBase]);
    // Hash pre-calculado: concatenacao dos campos na ordem do XSD, MD5
    // registroANS + dataGeracao + horaGeracao + sequencialTransacao
    // + numeroLote + (para cada guia: numeroGuiaPrestador + dataAtendimento
    // + codigoProcedimento + valorProcedimento formatado)
    const concatenated =
      '339679' +                  // registroANS
      '2026-08-07' +              // dataGeracao
      '14:30:00' +                // horaGeracao
      '12345' +                   // sequencialTransacao
      '0001' +                    // numeroLote
      '00001' +                   // numeroGuiaPrestador
      '2026-08-05' +              // dataAtendimento
      '10101012' +                // codigoProcedimento
      '150.00';                   // valorProcedimento (centavos -> reais com 2 decimais)
    const expected = createHash('md5').update(concatenated, 'utf8').digest('hex');
    expect(hash).toBe(expected);
  });

  it('formata valor em reais com 2 casas decimais para o hash (15001 centavos = 150.01)', () => {
    const guia = { ...guiaBase, valorProcedimentoCentavos: 15001 };
    const hash = computeTissHash(cabecalho, '0001', [guia]);
    const concatenated =
      '339679' + '2026-08-07' + '14:30:00' + '12345' + '0001' +
      '00001' + '2026-08-05' + '10101012' + '150.01';
    const expected = createHash('md5').update(concatenated, 'utf8').digest('hex');
    expect(hash).toBe(expected);
  });
});

describe('computeRecursoGlosaHash', () => {
  const cabecalho: CabecalhoInput = {
    versaoPadrao: '4.01.00',
    registroANS: '339679',
    dataGeracao: '2026-08-07',
    horaGeracao: '14:30:00',
    sequencialTransacao: '12345',
  };

  const itemBase: ItemRecursoGlosaInput = {
    sequencialItem: '1',
    dataAtendimento: '2026-08-05',
    numeroGuiaPrestador: '00001',
    codigoProcedimento: '10101012',
    codigoGlosa: 'A10',
    valorRecursadoCentavos: 15000,
    justificativa: 'Procedimento realizado conforme indicacao clinica',
  };

  it('retorna string hexadecimal de 32 caracteres (MD5)', () => {
    const hash = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('e deterministico — mesmos dados, mesmo hash', () => {
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    expect(h1).toBe(h2);
  });

  it('muda quando registroANS muda', () => {
    const cab2 = { ...cabecalho, registroANS: '999999' };
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cab2, '0001', 'RG0001', [itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando numeroLoteOriginal muda', () => {
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '9999', 'RG0001', [itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando numeroRecursoGlosa muda', () => {
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0002', [itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando valor recursado de um item muda', () => {
    const item2: ItemRecursoGlosaInput = { ...itemBase, valorRecursadoCentavos: 20000 };
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [item2]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando a ordem dos itens muda', () => {
    const item2: ItemRecursoGlosaInput = {
      ...itemBase,
      sequencialItem: '2',
      codigoProcedimento: '10101039',
      valorRecursadoCentavos: 8050,
    };
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase, item2]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [item2, itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('formata valor recursado como reais com 2 casas (ex: 15000 centavos -> "150.00")', async () => {
    // Teste indireto: hash com 15000 centavos deve usar "150.00"
    // Verificamos que o hash e o esperado via calculo manual
    const { createHash: ch } = await import('node:crypto');
    const concat = '339679' + '2026-08-07' + '14:30:00' + '12345' + '0001' + 'RG0001'
      + '1' + '10101012' + '150.00';
    const expected = ch('md5').update(concat, 'utf8').digest('hex');
    const actual = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    expect(actual).toBe(expected);
  });
});
