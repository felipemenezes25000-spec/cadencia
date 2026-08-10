import { describe, expect, it } from 'vitest';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import type { LoteConsultaInput } from './types';

/**
 * Teste dedicado: caracteres acentuados do portugues brasileiro sao
 * preservados na ida (UTF-16 -> ISO-8859-1) e na volta (decodificacao).
 * Este e o teste que garante que nomes de pacientes, observacoes e
 * enderecos nao perdem acentos no XML TISS.
 */

function loteComAcentos(observacao: string): LoteConsultaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '1',
    },
    registroANS: '339679',
    numeroLote: '0001',
    guias: [
      {
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
        observacao,
      },
    ],
  };
}

describe('preservacao de acentos ISO-8859-1 no XML TISS', () => {
  const ACENTOS_PT_BR: readonly { readonly char: string; readonly nome: string; readonly byte: number }[] = [
    { char: 'é', nome: 'e com acento agudo', byte: 0xE9 },
    { char: 'á', nome: 'a com acento agudo', byte: 0xE1 },
    { char: 'ç', nome: 'c com cedilha', byte: 0xE7 },
    { char: 'ô', nome: 'o com acento circunflexo', byte: 0xF4 },
    { char: 'ú', nome: 'u com acento agudo', byte: 0xFA },
    { char: 'ã', nome: 'a com til', byte: 0xE3 },
    { char: 'õ', nome: 'o com til', byte: 0xF5 },
    { char: 'í', nome: 'i com acento agudo', byte: 0xED },
    { char: 'ê', nome: 'e com acento circunflexo', byte: 0xEA },
    { char: 'à', nome: 'a com acento grave', byte: 0xE0 },
    { char: 'ü', nome: 'u com trema', byte: 0xFC },
    { char: 'É', nome: 'E maiusculo com acento agudo', byte: 0xC9 },
    { char: 'Ã', nome: 'A maiusculo com til', byte: 0xC3 },
    { char: 'Õ', nome: 'O maiusculo com til', byte: 0xD5 },
  ];

  for (const { char, nome, byte: expectedByte } of ACENTOS_PT_BR) {
    it(`preserva ${nome} (${char} -> 0x${expectedByte.toString(16).toUpperCase()})`, () => {
      const obs = `Teste ${char} aqui`;
      const { xml, warnings } = serializeLoteConsulta(loteComAcentos(obs));
      expect(warnings).toEqual([]);

      // Decodifica e verifica que o caractere acentuado aparece na saida
      const text = new TextDecoder('iso-8859-1').decode(xml);
      expect(text).toContain(char);

      // Verifica que o byte correto esta presente no array
      const bytes = Array.from(xml);
      expect(bytes).toContain(expectedByte);
    });
  }

  it('preserva frase completa com multiplos acentos do portugues', () => {
    const frase = 'Pressão arterial: sistólica 14, diastólica 9. Prescrição médica adequada.';
    const { xml, warnings } = serializeLoteConsulta(loteComAcentos(frase));
    expect(warnings).toEqual([]);

    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(frase);
  });

  it('gera warning para caractere fora do ISO-8859-1 na observacao sem perder os acentos validos', () => {
    const fraseComEmoji = 'Paciente bem ❤ pressão normal';
    const { xml, warnings } = serializeLoteConsulta(loteComAcentos(fraseComEmoji));

    // U+2764 (coracao) nao existe em ISO-8859-1
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('U+2764');

    // Mas os acentos validos (a com til) foram preservados
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('pressão');
    // O emoji foi substituido por ?
    expect(text).toContain('Paciente bem ? pressão normal');
  });
});
