import { describe, expect, it } from 'vitest';
import { validarContraXsdTiss } from '../../test/xsd';
import { serializeLoteSadt } from './serialize-lote-sadt';
import type { LoteSadtInput } from './types';

const BASE: LoteSadtInput = {
  cabecalho: {
    versaoPadrao: '4.03.00',
    registroANS: '123456',
    dataGeracao: '2026-08-09',
    horaGeracao: '10:30:00',
    sequencialTransacao: '000000000001',
  },
  registroANS: '123456',
  numeroLote: '000000000002',
  guias: [{
    registroANSOperadora: '123456',
    numeroGuiaPrestador: '00000000000000000010',
    numeroCarteira: '12345678901234567',
    atendimentoRN: false,
    contratadoSolicitante: { cnpjContratado: '12345678000199', cnes: '1234567' },
    nomeContratadoSolicitante: 'Clinica Aurora Unidade Centro',
    profissionalSolicitante: {
      conselhoProfissional: '06', numeroConselho: '123456',
      ufConselho: '35', cbos: '225125',
    },
    caraterAtendimento: '1',
    contratadoExecutante: { cnpjContratado: '12345678000199', cnes: '1234567' },
    // `dm_tipoAtendimento` nao e sequencial: {01,02,03,04,08,09,10,13,23}.
    // '05' parece plausivel e nao existe — o schema pega.
    tipoAtendimento: '04',
    indicacaoAcidente: '9',
    regimeAtendimento: '01',
    procedimentos: [{
      sequencialItem: 1,
      dataExecucao: '2026-08-09',
      codigoTabela: '22',
      codigoProcedimento: '40304361',
      descricaoProcedimento: 'Hemograma completo',
      quantidadeExecutada: 1,
      valorUnitarioCentavos: 4500,
    }],
  }],
};

function validar(input: LoteSadtInput) {
  const { xml, warnings } = serializeLoteSadt(input);
  expect(warnings).toEqual([]);
  return validarContraXsdTiss(xml);
}

describe('lote SP/SADT', () => {
  it('valida contra o XSD 4.03.00 da ANS', () => {
    const r = validar(BASE);
    expect(r.erros.join('\n')).toBe('');
    expect(r.valido).toBe(true);
  });

  it('soma o valor total a partir dos itens, sem receber o total pronto', () => {
    const { xml } = serializeLoteSadt({
      ...BASE,
      guias: [{
        ...BASE.guias[0]!,
        procedimentos: [
          { ...BASE.guias[0]!.procedimentos[0]!, valorUnitarioCentavos: 4500, quantidadeExecutada: 2 },
          { ...BASE.guias[0]!.procedimentos[0]!, sequencialItem: 2,
            codigoProcedimento: '40302040', valorUnitarioCentavos: 3000,
            quantidadeExecutada: 1 },
        ],
      }],
    });
    const texto = new TextDecoder('iso-8859-1').decode(xml);
    // 2 x 45,00 + 1 x 30,00 = 120,00. Aceitar um total vindo de fora deixaria a
    // guia divergir dos proprios itens — a glosa mais comum e a mais boba.
    expect(texto).toContain('<ans:valorTotalGeral>120.00</ans:valorTotalGeral>');
    expect(texto).toContain('<ans:valorProcedimentos>120.00</ans:valorProcedimentos>');
  });

  it('acentos sobrevivem em ISO-8859-1, sem aviso', () => {
    const { xml, warnings } = serializeLoteSadt({
      ...BASE,
      guias: [{ ...BASE.guias[0]!,
        nomeContratadoSolicitante: 'Clínica Aurora Unidade Ipiranga' }],
    });
    expect(warnings).toEqual([]);
    const texto = new TextDecoder('iso-8859-1').decode(xml);
    expect(texto).toContain('encoding="ISO-8859-1"');
    expect(texto).toContain('Clínica Aurora');
  });

  it('caractere fora do ISO-8859-1 vira aviso, nao corrupcao silenciosa', () => {
    const { warnings } = serializeLoteSadt({
      ...BASE,
      guias: [{ ...BASE.guias[0]!,
        // Travessao tipografico nao existe em ISO-8859-1. Vem de texto colado
        // do Word, que e como metade dos nomes de clinica sao cadastrados.
        nomeContratadoSolicitante: 'Clínica Aurora — Ipiranga' }],
    });
    // Trocar por '?' calado poria o nome errado na guia. O aviso deixa a
    // camada de cima decidir: barrar o envio ou normalizar o cadastro.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/U\+2014/);
  });

  it('recusa lote sem guia em vez de emitir envelope vazio', () => {
    expect(() => serializeLoteSadt({ ...BASE, guias: [] })).toThrow(/sem guias/);
  });

  it('mais de 100 guias nao cabem num lote — a norma limita', () => {
    const guia = BASE.guias[0]!;
    const muitas = Array.from({ length: 101 }, (_, i) => ({
      ...guia, numeroGuiaPrestador: String(i).padStart(20, '0'),
    }));
    // maxOccurs=100 no XSD. Recusar aqui evita descobrir no retorno da
    // operadora, dias depois, que o lote inteiro foi rejeitado.
    expect(() => serializeLoteSadt({ ...BASE, guias: muitas })).toThrow(/100/);
  });
});
