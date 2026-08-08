import { describe, expect, it } from 'vitest';
import { serializeRecursoGlosa } from './serialize-recurso-glosa';
import type { RecursoGlosaInput } from './types';

/**
 * Teste dedicado: caracteres acentuados do portugues brasileiro sao
 * preservados na justificativa do recurso de glosa (UTF-16 -> ISO-8859-1)
 * e na volta (decodificacao). Garante que justificativas com acentos
 * nao perdem informacao no XML TISS.
 */

function recursoComJustificativa(justificativa: string): RecursoGlosaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '1',
    },
    registroANS: '339679',
    numeroLoteOriginal: '0001',
    numeroRecursoGlosa: 'RG0001',
    contratado: {
      cnpjContratado: '11222333000181',
      cnes: '1234567',
    },
    itens: [
      {
        sequencialItem: '1',
        dataAtendimento: '2026-08-05',
        numeroGuiaPrestador: '00001',
        codigoProcedimento: '10101012',
        codigoGlosa: 'A10',
        valorRecursadoCentavos: 15000,
        justificativa,
      },
    ],
    encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
  };
}

describe('preservacao de acentos ISO-8859-1 na justificativa do recurso de glosa', () => {
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
      const just = `Justificativa com ${char} aqui`;
      const { xml, warnings } = serializeRecursoGlosa(recursoComJustificativa(just));
      expect(warnings).toEqual([]);

      // Decodifica e verifica que o caractere acentuado aparece na saida
      const text = new TextDecoder('iso-8859-1').decode(xml);
      expect(text).toContain(char);

      // Verifica que o byte correto esta presente no array
      const bytes = Array.from(xml);
      expect(bytes).toContain(expectedByte);
    });
  }

  it('preserva frase completa com multiplos acentos do portugues na justificativa', () => {
    const frase = 'Prescrição médica adequada. Diagnóstico clínico confirmado. Não há contraindicação.';
    const { xml, warnings } = serializeRecursoGlosa(recursoComJustificativa(frase));
    expect(warnings).toEqual([]);

    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(frase);
  });

  it('gera warning para caractere fora do ISO-8859-1 na justificativa sem perder acentos validos', () => {
    const fraseComEmoji = 'Procedimento necessário ❤ indicação clínica';
    const { xml, warnings } = serializeRecursoGlosa(recursoComJustificativa(fraseComEmoji));

    // U+2764 (coracao) nao existe em ISO-8859-1
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('U+2764');

    // Mas os acentos validos foram preservados
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('necessário');
    expect(text).toContain('indicação');
    // O emoji foi substituido por ?
    expect(text).toContain('Procedimento necessário ? indicação clínica');
  });
});
