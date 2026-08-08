// packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
import { describe, expect, it } from 'vitest';
import { decodeIso8859 } from './parse-demonstrativo';
import { encodeIso8859 } from '../serializer/encode-iso8859';

describe('decodeIso8859', () => {
  it('decodifica bytes ASCII em string identica', () => {
    const bytes = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]);
    expect(decodeIso8859(bytes)).toBe('Hello');
  });

  it('decodifica bytes acentuados ISO-8859-1 para caracteres corretos', () => {
    // e agudo = 0xE9, c cedilha = 0xE7, a til = 0xE3
    const bytes = new Uint8Array([0xE9, 0xE7, 0xE3]);
    expect(decodeIso8859(bytes)).toBe('éçã');
  });

  it('decodifica Uint8Array vazio em string vazia', () => {
    expect(decodeIso8859(new Uint8Array([]))).toBe('');
  });

  it('preserva roundtrip com encodeIso8859 para texto portugues', () => {
    const texto = 'Procedimento não autorizado pela clínica';
    const encoded = encodeIso8859(texto);
    expect(encoded.warnings).toHaveLength(0);
    expect(decodeIso8859(encoded.bytes)).toBe(texto);
  });
});
