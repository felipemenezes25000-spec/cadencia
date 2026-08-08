### Task 41: tipos de entrada do serializador TISS — GuiaConsultaInput e LoteConsultaInput

**Arquivos**

- Criar `packages/tiss/src/serializer/types.ts`
- Teste `packages/tiss/src/serializer/types.test.ts`

**Passos**

- [ ] Criar o arquivo de tipos `packages/tiss/src/serializer/types.ts`:

```ts
/**
 * Tipos de entrada do serializador XML TISS.
 *
 * Estes tipos sao PUROS — sem dependencia de banco, sem I/O. Representam
 * exatamente os dados necessarios para gerar o XML de um lote de guias de
 * consulta conforme padrao TISS 4.01.00 (Componente Organizacional).
 *
 * Os campos espelham a tabela tiss.encounter_guia_consulta (design §3.9)
 * e o XSD ans:mensagemTISS > prestadorParaOperadora > loteGuias >
 * guiaConsulta.
 */

/** Cabecalho do lote TISS — tag <ans:cabecalho>. */
export interface CabecalhoInput {
  /** Versao do padrao, ex: '4.01.00'. */
  readonly versaoPadrao: string;
  /** Registro ANS da operadora destino, 6 digitos. */
  readonly registroANS: string;
  /** Data de geracao do lote, formato 'YYYY-MM-DD'. */
  readonly dataGeracao: string;
  /** Hora de geracao do lote, formato 'HH:MM:SS'. */
  readonly horaGeracao: string;
  /** Numero sequencial da transacao, unico por prestador. */
  readonly sequencialTransacao: string;
}

/** Dados do contratado executante — tag <ans:dadosContratado>. */
export interface ContratadoInput {
  /** Codigo do prestador na operadora. Exatamente um dos tres identificadores. */
  readonly codigoPrestadorNaOperadora?: string;
  readonly cpfContratado?: string;
  readonly cnpjContratado?: string;
  /** CNES do estabelecimento, 7 digitos. */
  readonly cnes: string;
}

/** Dados do profissional executante — tag <ans:profissionalExecutante>. */
export interface ProfissionalExecutanteInput {
  /** Conselho profissional do executante, 2 digitos (ex: '06' = CRM). */
  readonly conselhoProfissional: string;
  /** Numero do registro no conselho. */
  readonly numeroConselho: string;
  /** UF do conselho, 2 letras. */
  readonly ufConselho: string;
  /** CBOS do profissional. */
  readonly cbos: string;
}

/** Uma guia de consulta individual — tag <ans:guiaConsulta>. */
export interface GuiaConsultaInput {
  /** Numero da guia atribuido pelo prestador, unico por operadora. */
  readonly numeroGuiaPrestador: string;
  /** Numero da guia atribuido pela operadora (autorizacao), opcional. */
  readonly numeroGuiaOperadora?: string;
  /** Numero da carteira do beneficiario na operadora. */
  readonly numeroCarteira: string;
  /** Indica se e atendimento a recem-nascido. */
  readonly atendimentoRN: boolean;
  /** Dados do contratado (prestador). */
  readonly contratado: ContratadoInput;
  /** Profissional que executou o procedimento. */
  readonly profissionalExecutante: ProfissionalExecutanteInput;
  /** Indicacao de acidente: '0' nao, '1' trabalho, '2' transito, '9' outros. */
  readonly indicacaoAcidente: '0' | '1' | '2' | '9';
  /** Regime de atendimento: '01' ambulatorial, etc. */
  readonly regimeAtendimento: string;
  /** Saude ocupacional, opcional. */
  readonly saudeOcupacional?: string;
  /** Cobertura especial, opcional. */
  readonly coberturaEspecial?: string;
  /** Data do atendimento, formato 'YYYY-MM-DD'. Nunca derivada de timestamp. */
  readonly dataAtendimento: string;
  /** Tipo de consulta: '1' primeira, '2' retorno, '3' pre-natal, '4' por encaminhamento. */
  readonly tipoConsulta: '1' | '2' | '3' | '4';
  /** Tabela de procedimento (ex: '22' TUSS). CHECK <> '18' (particular). */
  readonly codigoTabela: string;
  /** Codigo do procedimento na tabela. */
  readonly codigoProcedimento: string;
  /** Valor do procedimento em centavos inteiros (Money.cents). */
  readonly valorProcedimentoCentavos: number;
  /** Observacao opcional, ate 500 caracteres. */
  readonly observacao?: string;
}

/** Entrada completa para serializar um lote de guias de consulta. */
export interface LoteConsultaInput {
  /** Cabecalho do lote. */
  readonly cabecalho: CabecalhoInput;
  /** Registro ANS da operadora destino, 6 digitos. */
  readonly registroANS: string;
  /** Numero do lote, unico por prestador+operadora. */
  readonly numeroLote: string;
  /** Guias do lote. Minimo 1, maximo 100. */
  readonly guias: readonly GuiaConsultaInput[];
}
```

- [ ] Criar o teste `packages/tiss/src/serializer/types.test.ts`:

```ts
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
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/types.test.ts
```

Saida esperada: 3 testes passando, 0 falhas.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/types.ts packages/tiss/src/serializer/types.test.ts
git commit -m "feat(tiss): add typed inputs for TISS XML serializer (GuiaConsultaInput, LoteConsultaInput)"
```

---

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

### Task 43: xml-builder tipado — montagem segura de XML com escape de entidades

**Arquivos**

- Criar `packages/tiss/src/serializer/xml-builder.ts`
- Teste `packages/tiss/src/serializer/xml-builder.test.ts`

**Passos**

- [ ] Criar o teste `packages/tiss/src/serializer/xml-builder.test.ts` (TDD):

```ts
import { describe, expect, it } from 'vitest';
import { XmlBuilder } from './xml-builder';

describe('XmlBuilder', () => {
  it('gera declaracao XML com encoding ISO-8859-1', () => {
    const builder = new XmlBuilder();
    const xml = builder.toString();
    expect(xml).toBe('<?xml version="1.0" encoding="ISO-8859-1"?>');
  });

  it('abre e fecha tag simples', () => {
    const builder = new XmlBuilder();
    builder.open('ans:teste');
    builder.close('ans:teste');
    const xml = builder.toString();
    expect(xml).toBe(
      '<?xml version="1.0" encoding="ISO-8859-1"?>' +
      '<ans:teste></ans:teste>',
    );
  });

  it('escreve tag com conteudo texto', () => {
    const builder = new XmlBuilder();
    builder.open('raiz');
    builder.tag('nome', 'Jo\u00E3o da Silva');
    builder.close('raiz');
    const xml = builder.toString();
    expect(xml).toContain('<nome>Jo\u00E3o da Silva</nome>');
  });

  it('escapa entidades XML no conteudo de texto', () => {
    const builder = new XmlBuilder();
    builder.open('raiz');
    builder.tag('obs', 'a < b & c > d "e" \'f\'');
    builder.close('raiz');
    const xml = builder.toString();
    expect(xml).toContain(
      '<obs>a &lt; b &amp; c &gt; d &quot;e&quot; &apos;f&apos;</obs>',
    );
  });

  it('escapa entidades XML em valores de atributo', () => {
    const builder = new XmlBuilder();
    builder.openWithAttrs('tag', { id: 'a&b<c' });
    builder.close('tag');
    const xml = builder.toString();
    expect(xml).toContain('<tag id="a&amp;b&lt;c"></tag>');
  });

  it('gera atributos na ordem fornecida', () => {
    const builder = new XmlBuilder();
    builder.openWithAttrs('tag', { xmlns: 'http://example.com', version: '1.0' });
    builder.close('tag');
    const xml = builder.toString();
    expect(xml).toContain('<tag xmlns="http://example.com" version="1.0"></tag>');
  });

  it('suporta tags aninhadas em profundidade', () => {
    const builder = new XmlBuilder();
    builder.open('a');
    builder.open('b');
    builder.open('c');
    builder.tag('d', 'valor');
    builder.close('c');
    builder.close('b');
    builder.close('a');
    const xml = builder.toString();
    expect(xml).toContain('<a><b><c><d>valor</d></c></b></a>');
  });

  it('rejeita close de tag que nao foi aberta ou esta fora de ordem', () => {
    const builder = new XmlBuilder();
    builder.open('a');
    expect(() => builder.close('b')).toThrow(
      'Tentativa de fechar tag "b" mas a tag aberta e "a"',
    );
  });

  it('rejeita close quando nenhuma tag esta aberta', () => {
    const builder = new XmlBuilder();
    expect(() => builder.close('a')).toThrow(
      'Tentativa de fechar tag "a" mas nenhuma tag esta aberta',
    );
  });

  it('nao emite tag quando valor e undefined (campo opcional omitido)', () => {
    const builder = new XmlBuilder();
    builder.open('raiz');
    builder.optionalTag('campo', undefined);
    builder.tag('obrigatorio', 'sim');
    builder.close('raiz');
    const xml = builder.toString();
    expect(xml).not.toContain('campo');
    expect(xml).toContain('<obrigatorio>sim</obrigatorio>');
  });

  it('emite tag quando valor e string vazia (campo presente mas vazio)', () => {
    const builder = new XmlBuilder();
    builder.open('raiz');
    builder.optionalTag('campo', '');
    builder.close('raiz');
    const xml = builder.toString();
    expect(xml).toContain('<campo></campo>');
  });
});
```

- [ ] Rodar e confirmar falha de import:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/xml-builder.test.ts
```

Saida esperada: falha — `Cannot find module './xml-builder'`.

- [ ] Criar a implementacao `packages/tiss/src/serializer/xml-builder.ts`:

```ts
/**
 * Builder tipado para XML TISS.
 *
 * NAO usa concatenacao de string direta para conteudo — todo texto passa
 * por escape de entidades XML. O builder rastreia a pilha de tags abertas
 * e rejeita fechamento fora de ordem, impossibilitando XML malformado.
 */

const ENTITY_MAP: ReadonlyMap<number, string> = new Map([
  [0x26, '&amp;'],   // & — DEVE ser primeiro para nao re-escapar
  [0x3C, '&lt;'],    // <
  [0x3E, '&gt;'],    // >
  [0x22, '&quot;'],  // "
  [0x27, '&apos;'],  // '
]);

function escapeXml(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const entity = ENTITY_MAP.get(code);
    result += entity ?? text[i];
  }
  return result;
}

export class XmlBuilder {
  private readonly parts: string[] = ['<?xml version="1.0" encoding="ISO-8859-1"?>'];
  private readonly stack: string[] = [];

  /** Abre uma tag sem atributos. */
  open(tagName: string): void {
    this.parts.push(`<${tagName}>`);
    this.stack.push(tagName);
  }

  /** Abre uma tag com atributos na ordem fornecida. */
  openWithAttrs(tagName: string, attrs: Record<string, string>): void {
    const attrStr = Object.entries(attrs)
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
      .join('');
    this.parts.push(`<${tagName}${attrStr}>`);
    this.stack.push(tagName);
  }

  /** Fecha a tag no topo da pilha. Erro se o nome nao bater. */
  close(tagName: string): void {
    const top = this.stack.pop();
    if (top === undefined) {
      throw new Error(`Tentativa de fechar tag "${tagName}" mas nenhuma tag esta aberta`);
    }
    if (top !== tagName) {
      this.stack.push(top); // restaura para nao corromper o estado
      throw new Error(`Tentativa de fechar tag "${tagName}" mas a tag aberta e "${top}"`);
    }
    this.parts.push(`</${tagName}>`);
  }

  /** Emite tag folha com conteudo texto (escape automatico). */
  tag(tagName: string, value: string): void {
    this.parts.push(`<${tagName}>${escapeXml(value)}</${tagName}>`);
  }

  /** Emite tag folha apenas se value !== undefined. */
  optionalTag(tagName: string, value: string | undefined): void {
    if (value === undefined) return;
    this.tag(tagName, value);
  }

  /** Retorna o XML completo como string UTF-16 (sera codificado para ISO-8859-1 depois). */
  toString(): string {
    return this.parts.join('');
  }
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/xml-builder.test.ts
```

Saida esperada: 11 testes passando, 0 falhas.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/xml-builder.ts packages/tiss/src/serializer/xml-builder.test.ts
git commit -m "feat(tiss): add typed XML builder with entity escaping and tag stack validation"
```

---

### Task 44: compute-tiss-hash — hash MD5 proprietario conforme XSD da ANS

**Arquivos**

- Criar `packages/tiss/src/serializer/compute-tiss-hash.ts`
- Teste `packages/tiss/src/serializer/compute-tiss-hash.test.ts`

**Passos**

- [ ] Criar o teste `packages/tiss/src/serializer/compute-tiss-hash.test.ts` (TDD):

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeTissHash } from './compute-tiss-hash';
import type { GuiaConsultaInput, CabecalhoInput } from './types';

describe('computeTissHash — hash MD5 proprietario TISS', () => {
  const cabecalho: CabecalhoInput = {
    versaoPadrao: '4.01.00',
    registroANS: '339679',
    dataGeracao: '2026-08-07',
    horaGeracao: '14:30:00',
    sequencialTransacao: '12345',
  };

  const guiaBase: GuiaConsultaInput = {
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
  };

  it('retorna string hexadecimal MD5 de 32 caracteres', () => {
    const hash = computeTissHash(cabecalho, '0001', [guiaBase]);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('e deterministico: mesma entrada produz mesmo hash', () => {
    const hash1 = computeTissHash(cabecalho, '0001', [guiaBase]);
    const hash2 = computeTissHash(cabecalho, '0001', [guiaBase]);
    expect(hash1).toBe(hash2);
  });

  it('muda quando o numero do lote muda', () => {
    const hash1 = computeTissHash(cabecalho, '0001', [guiaBase]);
    const hash2 = computeTissHash(cabecalho, '0002', [guiaBase]);
    expect(hash1).not.toBe(hash2);
  });

  it('muda quando o cabecalho muda', () => {
    const hash1 = computeTissHash(cabecalho, '0001', [guiaBase]);
    const cabecalho2 = { ...cabecalho, sequencialTransacao: '99999' };
    const hash2 = computeTissHash(cabecalho2, '0001', [guiaBase]);
    expect(hash1).not.toBe(hash2);
  });

  it('muda quando o valor do procedimento muda (centavo a centavo)', () => {
    const hash1 = computeTissHash(cabecalho, '0001', [guiaBase]);
    const guia2 = { ...guiaBase, valorProcedimentoCentavos: 15001 };
    const hash2 = computeTissHash(cabecalho, '0001', [guia2]);
    expect(hash1).not.toBe(hash2);
  });

  it('muda quando a ordem das guias muda', () => {
    const guia2: GuiaConsultaInput = {
      ...guiaBase,
      numeroGuiaPrestador: '00002',
      valorProcedimentoCentavos: 20000,
    };
    const hashAB = computeTissHash(cabecalho, '0001', [guiaBase, guia2]);
    const hashBA = computeTissHash(cabecalho, '0001', [guia2, guiaBase]);
    expect(hashAB).not.toBe(hashBA);
  });

  it('congela o hash para os dados de amostra (snapshot)', () => {
    const hash = computeTissHash(cabecalho, '0001', [guiaBase]);
    // Hash pre-calculado: concatenacao dos campos na ordem do XSD, MD5
    // registroANS + dataGeracao + horaGeracao + sequencialTransacao
    // + numeroLote + (para cada guia: numeroGuiaPrestador + dataAtendimento
    // + codigoProcedimento + valorProcedimento formatado)
    const concatenated =
      '339679' +                  // registroANS
      '2026-08-07' +              // dataGeracao
      '14:30:00' +                // horaGeracao
      '12345' +                   // sequencialTransacao
      '0001' +                    // numeroLote
      '00001' +                   // numeroGuiaPrestador
      '2026-08-05' +              // dataAtendimento
      '10101012' +                // codigoProcedimento
      '150.00';                   // valorProcedimento (centavos -> reais com 2 decimais)
    const expected = createHash('md5').update(concatenated, 'utf8').digest('hex');
    expect(hash).toBe(expected);
  });

  it('formata valor em reais com 2 casas decimais para o hash (15001 centavos = 150.01)', () => {
    const guia = { ...guiaBase, valorProcedimentoCentavos: 15001 };
    const hash = computeTissHash(cabecalho, '0001', [guia]);
    const concatenated =
      '339679' + '2026-08-07' + '14:30:00' + '12345' + '0001' +
      '00001' + '2026-08-05' + '10101012' + '150.01';
    const expected = createHash('md5').update(concatenated, 'utf8').digest('hex');
    expect(hash).toBe(expected);
  });
});
```

- [ ] Rodar e confirmar falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/compute-tiss-hash.test.ts
```

Saida esperada: falha — `Cannot find module './compute-tiss-hash'`.

- [ ] Criar a implementacao `packages/tiss/src/serializer/compute-tiss-hash.ts`:

```ts
import { createHash } from 'node:crypto';
import type { CabecalhoInput, GuiaConsultaInput } from './types';

/**
 * Calcula o hash MD5 proprietario do padrao TISS.
 *
 * O hash e construido pela concatenacao de campos especificos do cabecalho
 * e de cada guia, na ordem definida pelo XSD da ANS, seguida de MD5 hex.
 * Este hash e embutido na tag <ans:hash> do XML.
 *
 * Campos concatenados (ordem do XSD):
 *   cabecalho: registroANS + dataGeracao + horaGeracao + sequencialTransacao
 *   lote: numeroLote
 *   por guia: numeroGuiaPrestador + dataAtendimento + codigoProcedimento + valorProcedimento
 *
 * O valor do procedimento e formatado como reais com 2 casas decimais (ex: 15000 centavos -> "150.00").
 */
export function computeTissHash(
  cabecalho: CabecalhoInput,
  numeroLote: string,
  guias: readonly GuiaConsultaInput[],
): string {
  const parts: string[] = [];

  // Campos do cabecalho
  parts.push(cabecalho.registroANS);
  parts.push(cabecalho.dataGeracao);
  parts.push(cabecalho.horaGeracao);
  parts.push(cabecalho.sequencialTransacao);

  // Numero do lote
  parts.push(numeroLote);

  // Campos de cada guia na ordem de insercao no lote
  for (const guia of guias) {
    parts.push(guia.numeroGuiaPrestador);
    parts.push(guia.dataAtendimento);
    parts.push(guia.codigoProcedimento);
    parts.push(formatValorReais(guia.valorProcedimentoCentavos));
  }

  const concatenated = parts.join('');
  return createHash('md5').update(concatenated, 'utf8').digest('hex');
}

/**
 * Formata centavos inteiros como reais com 2 casas decimais.
 * Ex: 15000 -> '150.00', 15001 -> '150.01', 99 -> '0.99'
 */
function formatValorReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/compute-tiss-hash.test.ts
```

Saida esperada: 8 testes passando, 0 falhas.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/compute-tiss-hash.ts packages/tiss/src/serializer/compute-tiss-hash.test.ts
git commit -m "feat(tiss): add TISS proprietary MD5 hash computation per ANS XSD field order"
```

---

### Task 45: serialize-lote-consulta — monta XML completo do lote de guias

**Arquivos**

- Criar `packages/tiss/src/serializer/serialize-lote-consulta.ts`
- Teste `packages/tiss/src/serializer/serialize-lote-consulta.test.ts`

**Passos**

- [ ] Criar o teste `packages/tiss/src/serializer/serialize-lote-consulta.test.ts` (TDD):

```ts
import { describe, expect, it } from 'vitest';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import type { LoteConsultaInput } from './types';

function loteAmostra(): LoteConsultaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
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
      },
    ],
  };
}

describe('serializeLoteConsulta', () => {
  it('retorna Uint8Array (bytes ISO-8859-1, nao string)', () => {
    const result = serializeLoteConsulta(loteAmostra());
    expect(result.xml).toBeInstanceOf(Uint8Array);
    expect(result.warnings).toEqual([]);
  });

  it('comeca com declaracao XML encoding ISO-8859-1', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const decoder = new TextDecoder('iso-8859-1');
    const text = decoder.decode(xml);
    expect(text.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
  });

  it('contem namespace ans correto na raiz', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"');
  });

  it('contem tag ans:mensagemTISS como raiz', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:mensagemTISS');
    expect(text).toContain('</ans:mensagemTISS>');
  });

  it('contem cabecalho com todos os campos', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:versaoPadrao>4.01.00</ans:versaoPadrao>');
    expect(text).toContain('<ans:registroANS>339679</ans:registroANS>');
    expect(text).toContain('<ans:dataGeracao>2026-08-07</ans:dataGeracao>');
    expect(text).toContain('<ans:horaGeracao>14:30:00</ans:horaGeracao>');
    expect(text).toContain('<ans:sequencialTransacao>12345</ans:sequencialTransacao>');
  });

  it('contem tag ans:hash com hash MD5 proprietario', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    const hashMatch = text.match(/<ans:hash>([0-9a-f]{32})<\/ans:hash>/);
    expect(hashMatch).not.toBeNull();
  });

  it('contem numero do lote', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroLote>0001</ans:numeroLote>');
  });

  it('contem dados da guia de consulta', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaPrestador>00001</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:numeroCarteira>98765432101234567</ans:numeroCarteira>');
    expect(text).toContain('<ans:atendimentoRN>N</ans:atendimentoRN>');
    expect(text).toContain('<ans:CNES>1234567</ans:CNES>');
    expect(text).toContain('<ans:codigoTabela>22</ans:codigoTabela>');
    expect(text).toContain('<ans:codigoProcedimento>10101012</ans:codigoProcedimento>');
    expect(text).toContain('<ans:valorProcedimento>150.00</ans:valorProcedimento>');
  });

  it('serializa atendimentoRN como S/N (booleano TISS)', () => {
    const lote = loteAmostra();
    const guiaRN = { ...lote.guias[0], atendimentoRN: true };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guiaRN] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:atendimentoRN>S</ans:atendimentoRN>');
  });

  it('omite tags opcionais quando campo e undefined', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    // guia da amostra nao tem observacao, guia operadora, saude ocupacional, cobertura especial
    expect(text).not.toContain('<ans:observacao>');
    expect(text).not.toContain('<ans:numeroGuiaOperadora>');
    expect(text).not.toContain('<ans:saudeOcupacional>');
    expect(text).not.toContain('<ans:coberturaEspecial>');
  });

  it('inclui tags opcionais quando campo esta presente', () => {
    const lote = loteAmostra();
    const guia = {
      ...lote.guias[0],
      numeroGuiaOperadora: 'OP12345',
      observacao: 'Retorno em 30 dias',
      saudeOcupacional: '1',
      coberturaEspecial: '0',
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaOperadora>OP12345</ans:numeroGuiaOperadora>');
    expect(text).toContain('<ans:observacao>Retorno em 30 dias</ans:observacao>');
    expect(text).toContain('<ans:saudeOcupacional>1</ans:saudeOcupacional>');
    expect(text).toContain('<ans:coberturaEspecial>0</ans:coberturaEspecial>');
  });

  it('serializa contratado com CNPJ quando cnpjContratado presente', () => {
    const { xml } = serializeLoteConsulta(loteAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:cnpjContratado>11222333000181</ans:cnpjContratado>');
    expect(text).not.toContain('<ans:cpfContratado>');
    expect(text).not.toContain('<ans:codigoPrestadorNaOperadora>');
  });

  it('serializa contratado com CPF quando cpfContratado presente', () => {
    const lote = loteAmostra();
    const guia = {
      ...lote.guias[0],
      contratado: { cpfContratado: '12345678901', cnes: '1234567' },
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:cpfContratado>12345678901</ans:cpfContratado>');
    expect(text).not.toContain('<ans:cnpjContratado>');
  });

  it('serializa multiplas guias no mesmo lote', () => {
    const lote = loteAmostra();
    const guia2 = {
      ...lote.guias[0],
      numeroGuiaPrestador: '00002',
      valorProcedimentoCentavos: 20000,
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [lote.guias[0], guia2] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaPrestador>00001</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:numeroGuiaPrestador>00002</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:valorProcedimento>200.00</ans:valorProcedimento>');
  });

  it('escapa entidades XML em campo de observacao', () => {
    const lote = loteAmostra();
    const guia = {
      ...lote.guias[0],
      observacao: 'PA > 14 & FC < 100 "normal"',
    };
    const { xml } = serializeLoteConsulta({ ...lote, guias: [guia] });
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(
      '<ans:observacao>PA &gt; 14 &amp; FC &lt; 100 &quot;normal&quot;</ans:observacao>',
    );
  });
});
```

- [ ] Rodar e confirmar falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/serialize-lote-consulta.test.ts
```

Saida esperada: falha — `Cannot find module './serialize-lote-consulta'`.

- [ ] Criar a implementacao `packages/tiss/src/serializer/serialize-lote-consulta.ts`:

```ts
import { XmlBuilder } from './xml-builder';
import { encodeIso8859 } from './encode-iso8859';
import { computeTissHash } from './compute-tiss-hash';
import type { LoteConsultaInput, GuiaConsultaInput } from './types';

/**
 * Resultado da serializacao de um lote de consulta TISS.
 */
export interface SerializeLoteResult {
  /** XML completo em bytes ISO-8859-1, pronto para envio. */
  readonly xml: Uint8Array;
  /** Warnings de caracteres nao mapeados para ISO-8859-1. */
  readonly warnings: readonly string[];
}

/**
 * Serializa um lote de guias de consulta TISS em XML ISO-8859-1.
 *
 * Funcao PURA: recebe dados tipados, devolve Uint8Array. ZERO side-effect.
 * O hash MD5 proprietario e calculado e embutido em <ans:hash>.
 * O XML segue o padrao TISS 4.01.00 (ou a versao do lote).
 */
export function serializeLoteConsulta(input: LoteConsultaInput): SerializeLoteResult {
  const { cabecalho, numeroLote, guias } = input;

  // Calcula o hash antes de montar o XML — ele sera embutido no epilogo
  const hash = computeTissHash(cabecalho, numeroLote, guias);

  const xml = new XmlBuilder();

  // Raiz com namespace ANS
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  // ---- Cabecalho ----
  emitCabecalho(xml, cabecalho);

  // ---- Corpo: prestadorParaOperadora > loteGuias ----
  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:loteGuias');
  xml.tag('ans:numeroLote', numeroLote);

  for (const guia of guias) {
    emitGuiaConsulta(xml, guia);
  }

  xml.close('ans:loteGuias');
  xml.close('ans:prestadorParaOperadora');

  // ---- Epilogo: hash ----
  xml.open('ans:epilogo');
  xml.tag('ans:hash', hash);
  xml.close('ans:epilogo');

  xml.close('ans:mensagemTISS');

  // Codifica para ISO-8859-1
  const encoded = encodeIso8859(xml.toString());

  return {
    xml: encoded.bytes,
    warnings: encoded.warnings,
  };
}

function emitCabecalho(xml: XmlBuilder, cab: LoteConsultaInput['cabecalho']): void {
  xml.open('ans:cabecalho');
  xml.tag('ans:versaoPadrao', cab.versaoPadrao);
  xml.tag('ans:registroANS', cab.registroANS);
  xml.tag('ans:dataGeracao', cab.dataGeracao);
  xml.tag('ans:horaGeracao', cab.horaGeracao);
  xml.tag('ans:sequencialTransacao', cab.sequencialTransacao);
  xml.close('ans:cabecalho');
}

function emitGuiaConsulta(xml: XmlBuilder, guia: GuiaConsultaInput): void {
  xml.open('ans:guiaConsulta');

  xml.tag('ans:numeroGuiaPrestador', guia.numeroGuiaPrestador);
  xml.optionalTag('ans:numeroGuiaOperadora', guia.numeroGuiaOperadora);
  xml.tag('ans:numeroCarteira', guia.numeroCarteira);
  xml.tag('ans:atendimentoRN', guia.atendimentoRN ? 'S' : 'N');

  // Dados do contratado
  xml.open('ans:dadosContratado');
  xml.optionalTag('ans:codigoPrestadorNaOperadora', guia.contratado.codigoPrestadorNaOperadora);
  xml.optionalTag('ans:cpfContratado', guia.contratado.cpfContratado);
  xml.optionalTag('ans:cnpjContratado', guia.contratado.cnpjContratado);
  xml.tag('ans:CNES', guia.contratado.cnes);
  xml.close('ans:dadosContratado');

  // Profissional executante
  xml.open('ans:profissionalExecutante');
  xml.tag('ans:conselhoProfissional', guia.profissionalExecutante.conselhoProfissional);
  xml.tag('ans:numeroConselho', guia.profissionalExecutante.numeroConselho);
  xml.tag('ans:ufConselho', guia.profissionalExecutante.ufConselho);
  xml.tag('ans:CBOS', guia.profissionalExecutante.cbos);
  xml.close('ans:profissionalExecutante');

  // Dados do atendimento
  xml.tag('ans:indicacaoAcidente', guia.indicacaoAcidente);
  xml.tag('ans:regimeAtendimento', guia.regimeAtendimento);
  xml.optionalTag('ans:saudeOcupacional', guia.saudeOcupacional);
  xml.optionalTag('ans:coberturaEspecial', guia.coberturaEspecial);
  xml.tag('ans:dataAtendimento', guia.dataAtendimento);
  xml.tag('ans:tipoConsulta', guia.tipoConsulta);

  // Procedimento
  xml.tag('ans:codigoTabela', guia.codigoTabela);
  xml.tag('ans:codigoProcedimento', guia.codigoProcedimento);
  xml.tag('ans:valorProcedimento', formatValorReais(guia.valorProcedimentoCentavos));
  xml.optionalTag('ans:observacao', guia.observacao);

  xml.close('ans:guiaConsulta');
}

function formatValorReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/serialize-lote-consulta.test.ts
```

Saida esperada: 15 testes passando, 0 falhas.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/serialize-lote-consulta.ts packages/tiss/src/serializer/serialize-lote-consulta.test.ts
git commit -m "feat(tiss): add TISS consultation batch XML serializer (pure, ISO-8859-1)"
```

---

### Task 46: snapshot byte-a-byte — lote de amostra comparado contra referencia congelada

**Arquivos**

- Criar `packages/tiss/test/fixtures/lote-consulta-amostra.xml` (referencia congelada)
- Teste `packages/tiss/src/serializer/snapshot.test.ts`

**Passos**

- [ ] Criar primeiro o teste que gera e congela o snapshot `packages/tiss/src/serializer/snapshot.test.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import type { LoteConsultaInput } from './types';

/**
 * Lote de amostra DETERMINISTICO — os mesmos dados sempre, para que o
 * snapshot byte a byte seja reproduzivel. Nenhum campo depende de relogio.
 */
function loteAmostraDeterministico(): LoteConsultaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
    },
    registroANS: '339679',
    numeroLote: '0001',
    guias: [
      {
        numeroGuiaPrestador: '00001',
        numeroGuiaOperadora: 'OP98765',
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
        observacao: 'Paciente com press\u00E3o elevada',
      },
      {
        numeroGuiaPrestador: '00002',
        numeroCarteira: '11111111111111111',
        atendimentoRN: true,
        contratado: {
          codigoPrestadorNaOperadora: 'PREST001',
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
        saudeOcupacional: '1',
        coberturaEspecial: '0',
        dataAtendimento: '2026-07-15',
        tipoConsulta: '2',
        codigoTabela: '22',
        codigoProcedimento: '10101039',
        valorProcedimentoCentavos: 8050,
      },
    ],
  };
}

const FIXTURE_DIR = join(__dirname, '../../test/fixtures');
const FIXTURE_PATH = join(FIXTURE_DIR, 'lote-consulta-amostra.xml');

describe('snapshot byte a byte do lote de consulta', () => {
  it('gera XML deterministico e identico ao snapshot congelado', () => {
    const { xml, warnings } = serializeLoteConsulta(loteAmostraDeterministico());
    expect(warnings).toEqual([]);

    if (!existsSync(FIXTURE_PATH)) {
      // Primeira execucao: cria o snapshot
      if (!existsSync(FIXTURE_DIR)) {
        mkdirSync(FIXTURE_DIR, { recursive: true });
      }
      writeFileSync(FIXTURE_PATH, xml);
      // eslint-disable-next-line no-console
      console.log(`Snapshot criado: ${FIXTURE_PATH} (${xml.byteLength} bytes)`);
      // NAO falha na primeira execucao — o snapshot acabou de ser criado.
    }

    const expected = new Uint8Array(readFileSync(FIXTURE_PATH));
    expect(xml.byteLength).toBe(expected.byteLength);

    // Comparacao byte a byte com diagnostico util
    for (let i = 0; i < xml.byteLength; i++) {
      if (xml[i] !== expected[i]) {
        const context = new TextDecoder('iso-8859-1').decode(xml.slice(Math.max(0, i - 20), i + 20));
        throw new Error(
          `Divergencia no byte ${i}: esperado 0x${expected[i]!.toString(16).padStart(2, '0')} ` +
          `mas recebeu 0x${xml[i]!.toString(16).padStart(2, '0')}. ` +
          `Contexto: ...${context}...`,
        );
      }
    }
  });

  it('o XML do snapshot e valido como texto ISO-8859-1', () => {
    const { xml } = serializeLoteConsulta(loteAmostraDeterministico());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<?xml version="1.0" encoding="ISO-8859-1"?>');
    expect(text).toContain('</ans:mensagemTISS>');
    // Verifica que o acento em "pressao" foi preservado em ISO-8859-1
    expect(text).toContain('press\u00E3o');
  });

  it('duas chamadas com os mesmos dados produzem bytes identicos', () => {
    const result1 = serializeLoteConsulta(loteAmostraDeterministico());
    const result2 = serializeLoteConsulta(loteAmostraDeterministico());
    expect(result1.xml).toEqual(result2.xml);
  });
});
```

- [ ] Rodar o teste pela primeira vez (cria o snapshot):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/snapshot.test.ts
```

Saida esperada: 3 testes passando. O snapshot `lote-consulta-amostra.xml` foi criado.

- [ ] Rodar novamente para confirmar que o snapshot bate byte a byte:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/snapshot.test.ts
```

Saida esperada: 3 testes passando (agora comparando contra o snapshot existente).

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/snapshot.test.ts packages/tiss/test/fixtures/lote-consulta-amostra.xml
git commit -m "test(tiss): add frozen byte-level snapshot for consultation batch XML"
```

---

### Task 47: teste de validacao com xmllint e XSD de amostra

**Arquivos**

- Criar `packages/tiss/test/fixtures/tiss-sample.xsd` (XSD minimo de amostra)
- Teste `packages/tiss/src/serializer/xmllint.test.ts`

**Passos**

- [ ] Criar o XSD de amostra `packages/tiss/test/fixtures/tiss-sample.xsd`. Este XSD e uma versao SIMPLIFICADA do padrao TISS para validacao estrutural — nao substitui o XSD oficial da ANS, que deve ser usado em homologacao:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"
           targetNamespace="http://www.ans.gov.br/padroes/tiss/schemas"
           elementFormDefault="qualified">

  <xs:element name="mensagemTISS">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="cabecalho" type="ans:cabecalhoType"/>
        <xs:element name="prestadorParaOperadora" type="ans:prestadorParaOperadoraType"/>
        <xs:element name="epilogo" type="ans:epilogoType"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>

  <xs:complexType name="cabecalhoType">
    <xs:sequence>
      <xs:element name="versaoPadrao" type="xs:string"/>
      <xs:element name="registroANS" type="xs:string"/>
      <xs:element name="dataGeracao" type="xs:string"/>
      <xs:element name="horaGeracao" type="xs:string"/>
      <xs:element name="sequencialTransacao" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="prestadorParaOperadoraType">
    <xs:sequence>
      <xs:element name="loteGuias" type="ans:loteGuiasType"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="loteGuiasType">
    <xs:sequence>
      <xs:element name="numeroLote" type="xs:string"/>
      <xs:element name="guiaConsulta" type="ans:guiaConsultaType" maxOccurs="unbounded"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="guiaConsultaType">
    <xs:sequence>
      <xs:element name="numeroGuiaPrestador" type="xs:string"/>
      <xs:element name="numeroGuiaOperadora" type="xs:string" minOccurs="0"/>
      <xs:element name="numeroCarteira" type="xs:string"/>
      <xs:element name="atendimentoRN" type="xs:string"/>
      <xs:element name="dadosContratado" type="ans:dadosContratadoType"/>
      <xs:element name="profissionalExecutante" type="ans:profissionalExecutanteType"/>
      <xs:element name="indicacaoAcidente" type="xs:string"/>
      <xs:element name="regimeAtendimento" type="xs:string"/>
      <xs:element name="saudeOcupacional" type="xs:string" minOccurs="0"/>
      <xs:element name="coberturaEspecial" type="xs:string" minOccurs="0"/>
      <xs:element name="dataAtendimento" type="xs:string"/>
      <xs:element name="tipoConsulta" type="xs:string"/>
      <xs:element name="codigoTabela" type="xs:string"/>
      <xs:element name="codigoProcedimento" type="xs:string"/>
      <xs:element name="valorProcedimento" type="xs:string"/>
      <xs:element name="observacao" type="xs:string" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="dadosContratadoType">
    <xs:sequence>
      <xs:element name="codigoPrestadorNaOperadora" type="xs:string" minOccurs="0"/>
      <xs:element name="cpfContratado" type="xs:string" minOccurs="0"/>
      <xs:element name="cnpjContratado" type="xs:string" minOccurs="0"/>
      <xs:element name="CNES" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="profissionalExecutanteType">
    <xs:sequence>
      <xs:element name="conselhoProfissional" type="xs:string"/>
      <xs:element name="numeroConselho" type="xs:string"/>
      <xs:element name="ufConselho" type="xs:string"/>
      <xs:element name="CBOS" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="epilogoType">
    <xs:sequence>
      <xs:element name="hash" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>

</xs:schema>
```

- [ ] Criar o teste `packages/tiss/src/serializer/xmllint.test.ts`:

```ts
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeLoteConsulta } from './serialize-lote-consulta';
import type { LoteConsultaInput } from './types';

/**
 * Valida o XML gerado contra o XSD de amostra usando xmllint.
 * Este teste e PULADO automaticamente se xmllint nao estiver instalado.
 */

function xmllintDisponivel(): boolean {
  try {
    execSync('xmllint --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function loteAmostra(): LoteConsultaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
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
        observacao: 'Paciente com press\u00E3o elevada',
      },
    ],
  };
}

const SCRATCHPAD = join(__dirname, '../../test/fixtures');
const XSD_PATH = join(SCRATCHPAD, 'tiss-sample.xsd');
const TMP_XML = join(SCRATCHPAD, 'xmllint-test-temp.xml');

describe('validacao XML com xmllint', () => {
  const skipMsg = 'xmllint nao esta disponivel neste ambiente';

  it('XML gerado e valido contra o XSD de amostra', () => {
    if (!xmllintDisponivel()) {
      // eslint-disable-next-line no-console
      console.log(`SKIP: ${skipMsg}`);
      return;
    }

    const { xml, warnings } = serializeLoteConsulta(loteAmostra());
    expect(warnings).toEqual([]);

    // Escreve XML temporario para xmllint
    if (!existsSync(SCRATCHPAD)) {
      mkdirSync(SCRATCHPAD, { recursive: true });
    }
    writeFileSync(TMP_XML, xml);

    try {
      const result = execSync(
        `xmllint --noout --schema "${XSD_PATH}" "${TMP_XML}"`,
        { stdio: 'pipe', encoding: 'utf8' },
      );
      // xmllint saiu com codigo 0: XML valido
      expect(true).toBe(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`xmllint falhou na validacao:\n${message}`);
    } finally {
      try { unlinkSync(TMP_XML); } catch { /* arquivo ja foi removido */ }
    }
  });

  it('XML gerado e well-formed (xmllint sem schema)', () => {
    if (!xmllintDisponivel()) {
      // eslint-disable-next-line no-console
      console.log(`SKIP: ${skipMsg}`);
      return;
    }

    const { xml } = serializeLoteConsulta(loteAmostra());

    if (!existsSync(SCRATCHPAD)) {
      mkdirSync(SCRATCHPAD, { recursive: true });
    }
    writeFileSync(TMP_XML, xml);

    try {
      execSync(`xmllint --noout "${TMP_XML}"`, { stdio: 'pipe', encoding: 'utf8' });
      expect(true).toBe(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`xmllint well-formedness falhou:\n${message}`);
    } finally {
      try { unlinkSync(TMP_XML); } catch { /* arquivo ja foi removido */ }
    }
  });
});
```

- [ ] Rodar os testes:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto" && pnpm vitest run packages/tiss/src/serializer/xmllint.test.ts
```

Saida esperada: 2 testes passando (se xmllint estiver instalado) ou 2 testes passando com mensagem de SKIP (se xmllint nao estiver disponivel).

- [ ] Commitar:

```bash
git add packages/tiss/test/fixtures/tiss-sample.xsd packages/tiss/src/serializer/xmllint.test.ts
git commit -m "test(tiss): add XSD validation with xmllint for generated TISS XML"
```

---

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
