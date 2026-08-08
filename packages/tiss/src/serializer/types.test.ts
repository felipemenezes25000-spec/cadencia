import { describe, expect, it } from 'vitest';
import type {
  CabecalhoInput,
  ContratadoInput,
  GuiaConsultaInput,
  LoteConsultaInput,
  ProfissionalExecutanteInput,
} from './types';

// Teste de compilacao: garante que os tipos sao atribuiveis e que campos
// obrigatorios e opcionais estao corretos. Se o tipo mudar de forma
// incompativel, o teste de compilacao falha.

describe('tipos de entrada do serializador TISS', () => {
  it('LoteConsultaInput aceita lote valido com todos os campos obrigatorios', () => {
    const cabecalho: CabecalhoInput = {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '1',
    };

    const contratado: ContratadoInput = {
      cnpjContratado: '11222333000181',
      cnes: '1234567',
    };

    const profissional: ProfissionalExecutanteInput = {
      conselhoProfissional: '06',
      numeroConselho: '123456',
      ufConselho: 'SP',
      cbos: '225120',
    };

    const guia: GuiaConsultaInput = {
      numeroGuiaPrestador: '00001',
      numeroCarteira: '98765432101234567',
      atendimentoRN: false,
      contratado,
      profissionalExecutante: profissional,
      indicacaoAcidente: '9',
      regimeAtendimento: '01',
      dataAtendimento: '2026-08-05',
      tipoConsulta: '1',
      codigoTabela: '22',
      codigoProcedimento: '10101012',
      valorProcedimentoCentavos: 15000,
    };

    const lote: LoteConsultaInput = {
      cabecalho,
      registroANS: '339679',
      numeroLote: '0001',
      guias: [guia],
    };

    // Se compilou e criou sem erro de tipo, o contrato esta correto.
    expect(lote.guias).toHaveLength(1);
    expect(lote.cabecalho.versaoPadrao).toBe('4.01.00');
  });

  it('GuiaConsultaInput aceita campos opcionais omitidos', () => {
    const guia: GuiaConsultaInput = {
      numeroGuiaPrestador: '00002',
      numeroCarteira: '11111111111111111',
      atendimentoRN: true,
      contratado: {
        codigoPrestadorNaOperadora: '123456',
        cnes: '7654321',
      },
      profissionalExecutante: {
        conselhoProfissional: '06',
        numeroConselho: '654321',
        ufConselho: 'RJ',
        cbos: '225120',
      },
      indicacaoAcidente: '0',
      regimeAtendimento: '01',
      dataAtendimento: '2026-07-15',
      tipoConsulta: '2',
      codigoTabela: '22',
      codigoProcedimento: '10101012',
      valorProcedimentoCentavos: 8000,
    };

    expect(guia.numeroGuiaOperadora).toBeUndefined();
    expect(guia.saudeOcupacional).toBeUndefined();
    expect(guia.coberturaEspecial).toBeUndefined();
    expect(guia.observacao).toBeUndefined();
  });

  it('ContratadoInput aceita cada um dos tres identificadores isoladamente', () => {
    const porCodigo: ContratadoInput = {
      codigoPrestadorNaOperadora: 'ABCD123',
      cnes: '1111111',
    };
    const porCpf: ContratadoInput = {
      cpfContratado: '12345678901',
      cnes: '2222222',
    };
    const porCnpj: ContratadoInput = {
      cnpjContratado: '11222333000181',
      cnes: '3333333',
    };

    expect(porCodigo.codigoPrestadorNaOperadora).toBe('ABCD123');
    expect(porCpf.cpfContratado).toBe('12345678901');
    expect(porCnpj.cnpjContratado).toBe('11222333000181');
  });
});
