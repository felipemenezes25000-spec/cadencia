### Task 48: barrel export e teste de caracteres acentuados ISO-8859-1

**Arquivos**

- Modificar `packages/tiss/src/index.ts`
- Teste `packages/tiss/src/serializer/iso8859-acentos.test.ts`

**Passos**

- [ ] Criar o teste dedicado a caracteres acentuados `packages/tiss/src/serializer/iso8859-acentos.test.ts`:

```ts
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
    { char: '\u00E9', nome: 'e com acento agudo', byte: 0xE9 },
    { char: '\u00E1', nome: 'a com acento agudo', byte: 0xE1 },
    { char: '\u00E7', nome: 'c com cedilha', byte: 0xE7 },
    { char: '\u00F4', nome: 'o com acento circunflexo', byte: 0xF4 },
    { char: '\u00FA', nome: 'u com acento agudo', byte: 0xFA },
    { char: '\u00E3', nome: 'a com til', byte: 0xE3 },
    { char: '\u00F5', nome: 'o com til', byte: 0xF5 },
    { char: '\u00ED', nome: 'i com acento agudo', byte: 0xED },
    { char: '\u00EA', nome: 'e com acento circunflexo', byte: 0xEA },
    { char: '\u00E0', nome: 'a com acento grave', byte: 0xE0 },
    { char: '\u00FC', nome: 'u com trema', byte: 0xFC },
    { char: '\u00C9', nome: 'E maiusculo com acento agudo', byte: 0xC9 },
    { char: '\u00C3', nome: 'A maiusculo com til', byte: 0xC3 },
    { char: '\u00D5', nome: 'O maiusculo com til', byte: 0xD5 },
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
    const frase = 'Press\u00E3o arterial: sist\u00F3lica 14, diast\u00F3lica 9. Prescri\u00E7\u00E3o m\u00E9dica adequada.';
    const { xml, warnings } = serializeLoteConsulta(loteComAcentos(frase));
    expect(warnings).toEqual([]);

    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(frase);
  });

  it('gera warning para caractere fora do ISO-8859-1 na observacao sem perder os acentos validos', () => {
    const fraseComEmoji = 'Paciente bem \u2764 press\u00E3o normal';
    const { xml, warnings } = serializeLoteConsulta(loteComAcentos(fraseComEmoji));

    // U+2764 (coracao) nao existe em ISO-8859-1
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('U+2764');

    // Mas os acentos validos (a com til) foram preservados
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('press\u00E3o');
    // O emoji foi substituido por ?
    expect(text).toContain('Paciente bem ? press\u00E3o normal');
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/iso8859-acentos.test.ts
```

Saida esperada: 16 testes passando (14 acentos individuais + frase + warning), 0 falhas.

- [ ] Atualizar o barrel export `packages/tiss/src/index.ts`:

```ts
export type {
  CabecalhoInput,
  ContratadoInput,
  GuiaConsultaInput,
  LoteConsultaInput,
  ProfissionalExecutanteInput,
} from './serializer/types';

export { serializeLoteConsulta, type SerializeLoteResult } from './serializer/serialize-lote-consulta';
export { encodeIso8859, type EncodeResult } from './serializer/encode-iso8859';
export { computeTissHash } from './serializer/compute-tiss-hash';
export { XmlBuilder } from './serializer/xml-builder';
```

- [ ] Confirmar que a compilacao esta limpa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/
```

Saida esperada: todos os testes do pacote tiss passando, 0 falhas.

- [ ] Commitar:

```bash
git add packages/tiss/src/index.ts packages/tiss/src/serializer/iso8859-acentos.test.ts
git commit -m "feat(tiss): add barrel export and dedicated ISO-8859-1 accent preservation tests"
```