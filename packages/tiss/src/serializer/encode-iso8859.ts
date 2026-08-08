/**
 * Converte string JavaScript (UTF-16 interno) para ISO-8859-1 byte array.
 *
 * O padrao TISS exige encoding ISO-8859-1 no XML. Caracteres fora do range
 * 0x00-0xFF sao substituidos por '?' (0x3F) e cada substituicao gera um
 * warning com o code point original. NUNCA silencio: o chamador deve logar
 * ou rejeitar o lote se houver warnings.
 */
export interface EncodeResult {
  /** Bytes em ISO-8859-1. */
  readonly bytes: Uint8Array;
  /** Um warning por caractere substituido, com posicao e code point. */
  readonly warnings: readonly string[];
}

export function encodeIso8859(input: string): EncodeResult {
  const warnings: string[] = [];
  const output: number[] = [];

  let i = 0;
  while (i < input.length) {
    const code = input.codePointAt(i)!;
    // Avanca 2 unidades UTF-16 se for surrogate pair (code > 0xFFFF)
    const advance = code > 0xFFFF ? 2 : 1;

    if (code <= 0xFF) {
      output.push(code);
    } else {
      output.push(0x3F); // '?'
      const hex = code.toString(16).toUpperCase().padStart(4, '0');
      warnings.push(
        `Caractere U+${hex} na posicao ${i} nao existe em ISO-8859-1, substituido por '?'`,
      );
    }

    i += advance;
  }

  return {
    bytes: new Uint8Array(output),
    warnings,
  };
}
