import { describe, expect, it } from 'vitest';
import { encodeIso8859 } from './encode-iso8859';

describe('encodeIso8859', () => {
  it('codifica ASCII puro sem alteracao', () => {
    const result = encodeIso8859('Hello World 123');
    expect(result.bytes).toEqual(new Uint8Array([
      0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x20,
      0x57, 0x6F, 0x72, 0x6C, 0x64, 0x20,
      0x31, 0x32, 0x33,
    ]));
    expect(result.warnings).toHaveLength(0);
  });

  it('preserva caracteres acentuados do portugues em ISO-8859-1', () => {
    // e com acento agudo = U+00E9 = 0xE9 em ISO-8859-1
    // a com acento agudo = U+00E1 = 0xE1
    // c com cedilha = U+00E7 = 0xE7
    // o com acento circunflexo = U+00F4 = 0xF4
    // u com acento agudo = U+00FA = 0xFA
    // a com til = U+00E3 = 0xE3
    const result = encodeIso8859('éáçôúã');
    expect(result.bytes).toEqual(new Uint8Array([0xE9, 0xE1, 0xE7, 0xF4, 0xFA, 0xE3]));
    expect(result.warnings).toHaveLength(0);
  });

  it('preserva todos os caracteres ISO-8859-1 no range 0x80-0xFF', () => {
    // Amostra representativa: pound sign (0xA3), copyright (0xA9), degree (0xB0), umlaut u (0xFC)
    const result = encodeIso8859('£©°ü');
    expect(result.bytes).toEqual(new Uint8Array([0xA3, 0xA9, 0xB0, 0xFC]));
    expect(result.warnings).toHaveLength(0);
  });

  it('substitui caractere fora do range ISO-8859-1 por ? e registra warning', () => {
    // Emoji (U+1F600) está fora do ISO-8859-1
    const result = encodeIso8859('abc\u{1F600}def');
    // O emoji é um surrogate pair em UTF-16, conta como 1 caractere lógico
    expect(result.bytes).toEqual(new Uint8Array([0x61, 0x62, 0x63, 0x3F, 0x64, 0x65, 0x66]));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('U+1F600');
  });

  it('substitui caractere Unicode acima de U+00FF por ? e registra warning', () => {
    // Caractere grego alfa (U+03B1) não existe em ISO-8859-1
    const result = encodeIso8859('aαb');
    expect(result.bytes).toEqual(new Uint8Array([0x61, 0x3F, 0x62]));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('U+03B1');
  });

  it('registra multiplos warnings para multiplos caracteres invalidos', () => {
    const result = encodeIso8859('αβγ');
    expect(result.bytes).toEqual(new Uint8Array([0x3F, 0x3F, 0x3F]));
    expect(result.warnings).toHaveLength(3);
  });

  it('codifica string vazia sem erro', () => {
    const result = encodeIso8859('');
    expect(result.bytes).toEqual(new Uint8Array([]));
    expect(result.warnings).toHaveLength(0);
  });

  it('preserva frase real de observacao de guia com acentos', () => {
    const frase = 'Paciente com pressão arterial elevada, acompanhamento clínico';
    const result = encodeIso8859(frase);
    expect(result.warnings).toHaveLength(0);
    // Verifica roundtrip: decodificar com TextDecoder('iso-8859-1') recupera o original
    const decoder = new TextDecoder('iso-8859-1');
    expect(decoder.decode(result.bytes)).toBe(frase);
  });

  it('nunca substitui em silencio — cada caractere perdido gera warning', () => {
    // Mistura de válidos e inválidos
    const result = encodeIso8859('João ☃ da ❤ Silva');
    // U+2603 (boneco de neve) e U+2764 (coração) são inválidos
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('U+2603');
    expect(result.warnings[1]).toContain('U+2764');
  });
});
