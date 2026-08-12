// packages/tiss/src/serializer/conformidade-xsd.test.ts
import { describe, expect, it } from 'vitest';
import { validarContraXsdTiss } from '../../test/xsd';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import type { LoteConsultaInput } from './types';

/**
 * Conformidade contra o XSD OFICIAL 4.03.00 da ANS.
 *
 * Este é o único teste do pacote que responde a pergunta que importa: a
 * operadora aceitaria este arquivo? Snapshot prova que o XML não MUDOU;
 * só o schema prova que ele está CERTO.
 */

const LOTE: LoteConsultaInput = {
  cabecalho: {
    versaoPadrao: '4.03.00',
    registroANS: '123456',
    dataGeracao: '2026-08-09',
    horaGeracao: '10:30:00',
    sequencialTransacao: '000000000001',
  },
  registroANS: '123456',
  numeroLote: '000000000001',
  guias: [{
    registroANSOperadora: '123456',
    numeroGuiaPrestador: '00000000000000000001',
    numeroCarteira: '12345678901234567',
    atendimentoRN: false,
    contratado: {
      cnpjContratado: '12345678000199',
      codigoPrestadorNaOperadora: '123456',
      cnes: '1234567',
    },
    profissionalExecutante: {
      conselhoProfissional: '06',
      numeroConselho: '123456',
      ufConselho: '35',
      cbos: '225125',
    },
    indicacaoAcidente: '9',
    regimeAtendimento: '01',
    dataAtendimento: '2026-08-09',
    tipoConsulta: '1',
    codigoTabela: '22',
    codigoProcedimento: '10101012',
    valorProcedimentoCentavos: 15000,
  }],
};

describe('conformidade com o XSD 4.03.00 da ANS', () => {
  it('o lote de consulta valida contra o schema publicado', () => {
    const { xml, warnings } = serializeLoteConsulta(LOTE);
    expect(warnings).toEqual([]);

    const r = validarContraXsdTiss(xml);
    // A mensagem entra no expect para que a falha diga QUAL regra do padrão foi
    // violada, em vez de "esperado true, recebido false".
    expect(r.erros.join('\n')).toBe('');
    expect(r.valido).toBe(true);
  });
});
