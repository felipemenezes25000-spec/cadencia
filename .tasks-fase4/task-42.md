### Task 42: encode-iso8859 — conversor UTF-16 para ISO-8859-1 byte array

**Arquivos**

- Criar `packages/tiss/src/serializer/encode-iso8859.ts`
- Teste `packages/tiss/src/serializer/encode-iso8859.test.ts`

**Passos**

- [ ] Criar o teste `packages/tiss/src/serializer/encode-iso8859.test.ts` (teste primeiro, TDD):

```ts
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
    const result = encodeIso8859('\u00E9\u00E1\u00E7\u00F4\u00FA\u00E3');
    expect(result.bytes).toEqual(new Uint8Array([0xE9, 0xE1, 0xE7, 0xF4, 0xFA, 0xE3]));
    expect(result.warnings).toHaveLength(0);
  });

  it('preserva todos os caracteres ISO-8859-1 no range 0x80-0xFF', () => {
    // Amostra representativa: pound sign (0xA3), copyright (0xA9), degree (0xB0), umlaut u (0xFC)
    const result = encodeIso8859('\u00A3\u00A9\u00B0\u00FC');
    expect(result.bytes).toEqual(new Uint8Array([0xA3, 0xA9, 0xB0, 0xFC]));
    expect(result.warnings).toHaveLength(0);
  });

  it('substitui caractere fora do range ISO-8859-1 por ? e registra warning', () => {
    // Emoji (U+1F600) esta fora do ISO-8859-1
    const result = encodeIso8859('abc\u{1F600}def');
    // O emoji e um surrogate pair em UTF-16, conta como 1 caractere logico
    expect(result.bytes).toEqual(new Uint8Array([0x61, 0x62, 0x63, 0x3F, 0x64, 0x65, 0x66]));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('U+1F600');
  });

  it('substitui caractere Unicode acima de U+00FF por ? e registra warning', () => {
    // Caractere grego alfa (U+03B1) nao existe em ISO-8859-1
    const result = encodeIso8859('a\u03B1b');
    expect(result.bytes).toEqual(new Uint8Array([0x61, 0x3F, 0x62]));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('U+03B1');
  });

  it('registra multiplos warnings para multiplos caracteres invalidos', () => {
    const result = encodeIso8859('\u03B1\u03B2\u03B3');
    expect(result.bytes).toEqual(new Uint8Array([0x3F, 0x3F, 0x3F]));
    expect(result.warnings).toHaveLength(3);
  });

  it('codifica string vazia sem erro', () => {
    const result = encodeIso8859('');
    expect(result.bytes).toEqual(new Uint8Array([]));
    expect(result.warnings).toHaveLength(0);
  });

  it('preserva frase real de observacao de guia com acentos', () => {
    const frase = 'Paciente com press\u00E3o arterial elevada, acompanhamento cl\u00EDnico';
    const result = encodeIso8859(frase);
    expect(result.warnings).toHaveLength(0);
    // Verifica roundtrip: decodificar com TextDecoder('iso-8859-1') recupera o original
    const decoder = new TextDecoder('iso-8859-1');
    expect(decoder.decode(result.bytes)).toBe(frase);
  });

  it('nunca substitui em silencio — cada caractere perdido gera warning', () => {
    // Mistura de validos e invalidos
    const result = encodeIso8859('Jo\u00E3o \u2603 da \u2764 Silva');
    // U+2603 (boneco de neve) e U+2764 (coracao) sao invalidos
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('U+2603');
    expect(result.warnings[1]).toContain('U+2764');
  });
});
```

- [ ] Rodar e confirmar que falha (modulo nao existe ainda):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/encode-iso8859.test.ts
```

Saida esperada: falha de import — `Cannot find module './encode-iso8859'`.

- [ ] Criar a implementacao `packages/tiss/src/serializer/encode-iso8859.ts`:

```ts
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
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/encode-iso8859.test.ts
```

Saida esperada: 9 testes passando, 0 falhas.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/encode-iso8859.ts packages/tiss/src/serializer/encode-iso8859.test.ts
git commit -m "feat(tiss): add ISO-8859-1 encoder with explicit warnings for unmappable characters"
```

---