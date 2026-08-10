### Task 25: tipo RecursoGlosaInput em serializer/types.ts

**Arquivos:** `packages/tiss/src/serializer/types.ts`

- [ ] Adicionar os tipos de entrada do recurso de glosa ao final de `types.ts`:

```ts
// --- em packages/tiss/src/serializer/types.ts (acrescentar ao final) ---

/** Um item de recurso de glosa individual — tag <ans:itemRecursoGlosa>. */
export interface ItemRecursoGlosaInput {
  /** Numero sequencial do item dentro do recurso. */
  readonly sequencialItem: string;
  /** Data do atendimento original, formato 'YYYY-MM-DD'. */
  readonly dataAtendimento: string;
  /** Numero da guia referenciada pelo recurso (guia do prestador). */
  readonly numeroGuiaPrestador: string;
  /** Numero da guia atribuido pela operadora, opcional. */
  readonly numeroGuiaOperadora?: string;
  /** Codigo do procedimento TUSS contestado. */
  readonly codigoProcedimento: string;
  /** Codigo da glosa atribuido pela operadora (tabela TUSS de motivo de glosa). */
  readonly codigoGlosa: string;
  /** Valor recursado em centavos inteiros (Money.cents). */
  readonly valorRecursadoCentavos: number;
  /** Justificativa textual do prestador para o recurso, ate 500 caracteres. */
  readonly justificativa: string;
}

/** Dados do prestador contratado para o recurso — tag <ans:dadosContratado>. */
export interface ContratadoRecursoInput {
  /** Codigo do prestador na operadora. Exatamente um dos tres identificadores. */
  readonly codigoPrestadorNaOperadora?: string;
  readonly cpfContratado?: string;
  readonly cnpjContratado?: string;
  /** CNES do estabelecimento, 7 digitos. */
  readonly cnes: string;
}

/** Entrada completa para serializar um recurso de glosa TISS. */
export interface RecursoGlosaInput {
  /** Cabecalho do XML TISS. Reutiliza o mesmo tipo do lote. */
  readonly cabecalho: CabecalhoInput;
  /** Registro ANS da operadora destino, 6 digitos. */
  readonly registroANS: string;
  /** Numero do lote original que sofreu a glosa. */
  readonly numeroLoteOriginal: string;
  /** Numero do recurso de glosa, unico por prestador. */
  readonly numeroRecursoGlosa: string;
  /** Dados do prestador contratado. */
  readonly contratado: ContratadoRecursoInput;
  /** Itens do recurso. Minimo 1. */
  readonly itens: readonly ItemRecursoGlosaInput[];
  /** ID da versao do encounter usada para gerar o recurso (§3.9). Nao vai no XML, mas e obrigatorio no input. */
  readonly encounterVersionId: string;
}
```

- [ ] Rodar o type-check para confirmar que compila sem erros:

```bash
npx tsc --noEmit -p packages/tiss/tsconfig.json
```

Saida esperada: nenhum erro.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/types.ts
git commit -m "feat(tiss): add RecursoGlosaInput types for glosa appeal serializer"
```

---

### Task 26: teste unitario dos tipos RecursoGlosaInput

**Arquivos:** `packages/tiss/src/serializer/types.test.ts`

- [ ] Ler o teste existente para entender o padrao:

```bash
cat packages/tiss/src/serializer/types.test.ts
```

- [ ] Acrescentar teste que valida que os tipos sao usaveis (type-level test + factory helper):

```ts
// --- acrescentar ao final de packages/tiss/src/serializer/types.test.ts ---

import type {
  RecursoGlosaInput,
  ItemRecursoGlosaInput,
  ContratadoRecursoInput,
} from './types';

describe('RecursoGlosaInput', () => {
  function itemRecursoBase(): ItemRecursoGlosaInput {
    return {
      sequencialItem: '1',
      dataAtendimento: '2026-08-05',
      numeroGuiaPrestador: '00001',
      codigoProcedimento: '10101012',
      codigoGlosa: 'A10',
      valorRecursadoCentavos: 15000,
      justificativa: 'Procedimento realizado conforme indicacao clinica',
    };
  }

  function contratadoRecursoBase(): ContratadoRecursoInput {
    return {
      cnpjContratado: '11222333000181',
      cnes: '1234567',
    };
  }

  function recursoAmostra(): RecursoGlosaInput {
    return {
      cabecalho: {
        versaoPadrao: '4.01.00',
        registroANS: '339679',
        dataGeracao: '2026-08-07',
        horaGeracao: '14:30:00',
        sequencialTransacao: '12345',
      },
      registroANS: '339679',
      numeroLoteOriginal: '0001',
      numeroRecursoGlosa: 'RG0001',
      contratado: contratadoRecursoBase(),
      itens: [itemRecursoBase()],
      encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
    };
  }

  it('aceita entrada valida com todos os campos obrigatorios', () => {
    const input: RecursoGlosaInput = recursoAmostra();
    expect(input.cabecalho.versaoPadrao).toBe('4.01.00');
    expect(input.itens).toHaveLength(1);
    expect(input.encounterVersionId).toBeTruthy();
  });

  it('aceita item com numeroGuiaOperadora opcional', () => {
    const item: ItemRecursoGlosaInput = {
      ...itemRecursoBase(),
      numeroGuiaOperadora: 'OP98765',
    };
    expect(item.numeroGuiaOperadora).toBe('OP98765');
  });

  it('aceita contratado com CPF ao inves de CNPJ', () => {
    const contratado: ContratadoRecursoInput = {
      cpfContratado: '12345678901',
      cnes: '1234567',
    };
    expect(contratado.cpfContratado).toBe('12345678901');
    expect(contratado.cnpjContratado).toBeUndefined();
  });

  it('aceita contratado com codigoPrestadorNaOperadora', () => {
    const contratado: ContratadoRecursoInput = {
      codigoPrestadorNaOperadora: 'PREST001',
      cnes: '7654321',
    };
    expect(contratado.codigoPrestadorNaOperadora).toBe('PREST001');
  });

  it('aceita multiplos itens no recurso', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [
        itemRecursoBase(),
        { ...itemRecursoBase(), sequencialItem: '2', codigoGlosa: 'B15', valorRecursadoCentavos: 8050 },
      ],
    };
    expect(input.itens).toHaveLength(2);
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
npx vitest run packages/tiss/src/serializer/types.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/types.test.ts
git commit -m "test(tiss): add RecursoGlosaInput type-level tests"
```

---

### Task 27: funcao computeRecursoGlosaHash e seu teste

**Arquivos:** `packages/tiss/src/serializer/compute-tiss-hash.ts`, `packages/tiss/src/serializer/compute-tiss-hash.test.ts`

O hash do recurso segue a mesma logica proprietaria do lote (concatenacao + MD5 hex), mas com campos diferentes: cabecalho + numeroLoteOriginal + numeroRecursoGlosa + por item (sequencialItem + codigoProcedimento + valorRecursado).

- [ ] Primeiro, ler o teste existente de hash para entender o padrao:

```bash
cat packages/tiss/src/serializer/compute-tiss-hash.test.ts
```

- [ ] Acrescentar a funcao `computeRecursoGlosaHash` em `compute-tiss-hash.ts`:

```ts
// --- acrescentar ao final de packages/tiss/src/serializer/compute-tiss-hash.ts ---

import type { ItemRecursoGlosaInput } from './types';

/**
 * Calcula o hash MD5 proprietario do recurso de glosa TISS.
 *
 * Campos concatenados (ordem do XSD):
 *   cabecalho: registroANS + dataGeracao + horaGeracao + sequencialTransacao
 *   recurso: numeroLoteOriginal + numeroRecursoGlosa
 *   por item: sequencialItem + codigoProcedimento + valorRecursado
 *
 * O valor recursado e formatado como reais com 2 casas decimais.
 */
export function computeRecursoGlosaHash(
  cabecalho: CabecalhoInput,
  numeroLoteOriginal: string,
  numeroRecursoGlosa: string,
  itens: readonly ItemRecursoGlosaInput[],
): string {
  const parts: string[] = [];

  // Campos do cabecalho
  parts.push(cabecalho.registroANS);
  parts.push(cabecalho.dataGeracao);
  parts.push(cabecalho.horaGeracao);
  parts.push(cabecalho.sequencialTransacao);

  // Identificacao do recurso
  parts.push(numeroLoteOriginal);
  parts.push(numeroRecursoGlosa);

  // Campos de cada item na ordem de insercao
  for (const item of itens) {
    parts.push(item.sequencialItem);
    parts.push(item.codigoProcedimento);
    parts.push(formatValorReais(item.valorRecursadoCentavos));
  }

  const concatenated = parts.join('');
  return createHash('md5').update(concatenated, 'utf8').digest('hex');
}
```

Note: `createHash` e `CabecalhoInput` ja estao importados no topo do arquivo; `formatValorReais` ja existe. A unica adicao de import necessaria e `ItemRecursoGlosaInput`.

O import existente de `CabecalhoInput, GuiaConsultaInput` no topo do arquivo precisa ser expandido:

```ts
// --- alterar import existente em compute-tiss-hash.ts ---
// DE:
import type { CabecalhoInput, GuiaConsultaInput } from './types';
// PARA:
import type { CabecalhoInput, GuiaConsultaInput, ItemRecursoGlosaInput } from './types';
```

- [ ] Acrescentar testes para `computeRecursoGlosaHash` em `compute-tiss-hash.test.ts`:

```ts
// --- acrescentar ao final de packages/tiss/src/serializer/compute-tiss-hash.test.ts ---

import { computeRecursoGlosaHash } from './compute-tiss-hash';
import type { CabecalhoInput, ItemRecursoGlosaInput } from './types';

describe('computeRecursoGlosaHash', () => {
  const cabecalho: CabecalhoInput = {
    versaoPadrao: '4.01.00',
    registroANS: '339679',
    dataGeracao: '2026-08-07',
    horaGeracao: '14:30:00',
    sequencialTransacao: '12345',
  };

  const itemBase: ItemRecursoGlosaInput = {
    sequencialItem: '1',
    dataAtendimento: '2026-08-05',
    numeroGuiaPrestador: '00001',
    codigoProcedimento: '10101012',
    codigoGlosa: 'A10',
    valorRecursadoCentavos: 15000,
    justificativa: 'Procedimento realizado conforme indicacao clinica',
  };

  it('retorna string hexadecimal de 32 caracteres (MD5)', () => {
    const hash = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('e deterministico — mesmos dados, mesmo hash', () => {
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    expect(h1).toBe(h2);
  });

  it('muda quando registroANS muda', () => {
    const cab2 = { ...cabecalho, registroANS: '999999' };
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cab2, '0001', 'RG0001', [itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando numeroLoteOriginal muda', () => {
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '9999', 'RG0001', [itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando numeroRecursoGlosa muda', () => {
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0002', [itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando valor recursado de um item muda', () => {
    const item2: ItemRecursoGlosaInput = { ...itemBase, valorRecursadoCentavos: 20000 };
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [item2]);
    expect(h1).not.toBe(h2);
  });

  it('muda quando a ordem dos itens muda', () => {
    const item2: ItemRecursoGlosaInput = {
      ...itemBase,
      sequencialItem: '2',
      codigoProcedimento: '10101039',
      valorRecursadoCentavos: 8050,
    };
    const h1 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase, item2]);
    const h2 = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [item2, itemBase]);
    expect(h1).not.toBe(h2);
  });

  it('formata valor recursado como reais com 2 casas (ex: 15000 centavos -> "150.00")', () => {
    // Teste indireto: hash com 8050 centavos deve usar "80.50"
    // Verificamos que o hash e o esperado via calculo manual
    const { createHash: ch } = await import('node:crypto');
    const concat = '339679' + '2026-08-07' + '14:30:00' + '12345' + '0001' + 'RG0001'
      + '1' + '10101012' + '150.00';
    const expected = ch('md5').update(concat, 'utf8').digest('hex');
    const actual = computeRecursoGlosaHash(cabecalho, '0001', 'RG0001', [itemBase]);
    expect(actual).toBe(expected);
  });
});
```

- [ ] Rodar o teste e confirmar que o teste FALHA (funcao ainda nao existe no arquivo — vamos primeiro commitar o teste, depois a implementacao). Neste caso como estamos fazendo TDD inline, rodar apos adicionar tanto teste quanto implementacao:

```bash
npx vitest run packages/tiss/src/serializer/compute-tiss-hash.test.ts
```

Saida esperada: todos os testes passam (incluindo os existentes de `computeTissHash` do lote + os novos de `computeRecursoGlosaHash`).

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/compute-tiss-hash.ts packages/tiss/src/serializer/compute-tiss-hash.test.ts
git commit -m "feat(tiss): add computeRecursoGlosaHash for glosa appeal MD5 hash"
```

---

### Task 28: funcao serializeRecursoGlosa e teste unitario principal

**Arquivos:** `packages/tiss/src/serializer/serialize-recurso-glosa.ts` (novo), `packages/tiss/src/serializer/serialize-recurso-glosa.test.ts` (novo)

- [ ] Criar o arquivo de teste `packages/tiss/src/serializer/serialize-recurso-glosa.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { serializeRecursoGlosa } from './serialize-recurso-glosa';
import type { RecursoGlosaInput, ItemRecursoGlosaInput, ContratadoRecursoInput } from './types';

function itemRecursoBase(): ItemRecursoGlosaInput {
  return {
    sequencialItem: '1',
    dataAtendimento: '2026-08-05',
    numeroGuiaPrestador: '00001',
    codigoProcedimento: '10101012',
    codigoGlosa: 'A10',
    valorRecursadoCentavos: 15000,
    justificativa: 'Procedimento realizado conforme indicacao clinica',
  };
}

function contratadoRecursoBase(): ContratadoRecursoInput {
  return {
    cnpjContratado: '11222333000181',
    cnes: '1234567',
  };
}

function recursoAmostra(): RecursoGlosaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
    },
    registroANS: '339679',
    numeroLoteOriginal: '0001',
    numeroRecursoGlosa: 'RG0001',
    contratado: contratadoRecursoBase(),
    itens: [itemRecursoBase()],
    encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
  };
}

describe('serializeRecursoGlosa', () => {
  it('retorna Uint8Array (bytes ISO-8859-1, nao string)', () => {
    const result = serializeRecursoGlosa(recursoAmostra());
    expect(result.xml).toBeInstanceOf(Uint8Array);
    expect(result.warnings).toEqual([]);
  });

  it('comeca com declaracao XML encoding ISO-8859-1', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
  });

  it('contem namespace ans correto na raiz', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas"');
  });

  it('contem tag ans:mensagemTISS como raiz', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:mensagemTISS');
    expect(text).toContain('</ans:mensagemTISS>');
  });

  it('contem cabecalho com todos os campos', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:versaoPadrao>4.01.00</ans:versaoPadrao>');
    expect(text).toContain('<ans:registroANS>339679</ans:registroANS>');
    expect(text).toContain('<ans:dataGeracao>2026-08-07</ans:dataGeracao>');
    expect(text).toContain('<ans:horaGeracao>14:30:00</ans:horaGeracao>');
    expect(text).toContain('<ans:sequencialTransacao>12345</ans:sequencialTransacao>');
  });

  it('contem tag ans:recursoGlosa envolvendo o conteudo', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:recursoGlosa>');
    expect(text).toContain('</ans:recursoGlosa>');
  });

  it('contem numero do lote original e numero do recurso', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroLoteOriginal>0001</ans:numeroLoteOriginal>');
    expect(text).toContain('<ans:numeroRecursoGlosa>RG0001</ans:numeroRecursoGlosa>');
  });

  it('contem dados do contratado com CNPJ', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:dadosContratado>');
    expect(text).toContain('<ans:cnpjContratado>11222333000181</ans:cnpjContratado>');
    expect(text).toContain('<ans:CNES>1234567</ans:CNES>');
    expect(text).toContain('</ans:dadosContratado>');
  });

  it('contem dados do contratado com CPF quando fornecido', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      contratado: { cpfContratado: '12345678901', cnes: '1234567' },
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:cpfContratado>12345678901</ans:cpfContratado>');
    expect(text).not.toContain('<ans:cnpjContratado>');
  });

  it('contem dados do contratado com codigoPrestadorNaOperadora quando fornecido', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      contratado: { codigoPrestadorNaOperadora: 'PREST001', cnes: '7654321' },
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(
      '<ans:codigoPrestadorNaOperadora>PREST001</ans:codigoPrestadorNaOperadora>',
    );
  });

  it('contem item de recurso com todos os campos', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:itemRecursoGlosa>');
    expect(text).toContain('<ans:sequencialItem>1</ans:sequencialItem>');
    expect(text).toContain('<ans:dataAtendimento>2026-08-05</ans:dataAtendimento>');
    expect(text).toContain('<ans:numeroGuiaPrestador>00001</ans:numeroGuiaPrestador>');
    expect(text).toContain('<ans:codigoProcedimento>10101012</ans:codigoProcedimento>');
    expect(text).toContain('<ans:codigoGlosa>A10</ans:codigoGlosa>');
    expect(text).toContain('<ans:valorRecursado>150.00</ans:valorRecursado>');
    expect(text).toContain(
      '<ans:justificativa>Procedimento realizado conforme indicacao clinica</ans:justificativa>',
    );
    expect(text).toContain('</ans:itemRecursoGlosa>');
  });

  it('inclui numeroGuiaOperadora quando presente no item', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [{ ...itemRecursoBase(), numeroGuiaOperadora: 'OP98765' }],
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:numeroGuiaOperadora>OP98765</ans:numeroGuiaOperadora>');
  });

  it('omite numeroGuiaOperadora quando ausente no item', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).not.toContain('<ans:numeroGuiaOperadora>');
  });

  it('serializa multiplos itens de recurso', () => {
    const item2: ItemRecursoGlosaInput = {
      sequencialItem: '2',
      dataAtendimento: '2026-07-15',
      numeroGuiaPrestador: '00002',
      codigoProcedimento: '10101039',
      codigoGlosa: 'B15',
      valorRecursadoCentavos: 8050,
      justificativa: 'Exame necessario para diagnostico diferencial',
    };
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [itemRecursoBase(), item2],
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<ans:sequencialItem>1</ans:sequencialItem>');
    expect(text).toContain('<ans:sequencialItem>2</ans:sequencialItem>');
    expect(text).toContain('<ans:valorRecursado>150.00</ans:valorRecursado>');
    expect(text).toContain('<ans:valorRecursado>80.50</ans:valorRecursado>');
  });

  it('contem tag ans:hash com hash MD5 proprietario', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    const hashMatch = text.match(/<ans:hash>([0-9a-f]{32})<\/ans:hash>/);
    expect(hashMatch).not.toBeNull();
  });

  it('escapa entidades XML na justificativa', () => {
    const input: RecursoGlosaInput = {
      ...recursoAmostra(),
      itens: [{
        ...itemRecursoBase(),
        justificativa: 'PA > 14 & FC < 100 "normal"',
      }],
    };
    const { xml } = serializeRecursoGlosa(input);
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain(
      '<ans:justificativa>PA &gt; 14 &amp; FC &lt; 100 &quot;normal&quot;</ans:justificativa>',
    );
  });

  it('estrutura XML segue a ordem: cabecalho > prestadorParaOperadora > recursoGlosa > itens > epilogo', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostra());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    const idxCabecalho = text.indexOf('<ans:cabecalho>');
    const idxPrestador = text.indexOf('<ans:prestadorParaOperadora>');
    const idxRecurso = text.indexOf('<ans:recursoGlosa>');
    const idxItem = text.indexOf('<ans:itemRecursoGlosa>');
    const idxEpilogo = text.indexOf('<ans:epilogo>');
    expect(idxCabecalho).toBeLessThan(idxPrestador);
    expect(idxPrestador).toBeLessThan(idxRecurso);
    expect(idxRecurso).toBeLessThan(idxItem);
    expect(idxItem).toBeLessThan(idxEpilogo);
  });
});
```

- [ ] Rodar o teste e confirmar que FALHA (funcao ainda nao existe):

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa.test.ts
```

Saida esperada: falha com erro de import (modulo nao encontrado).

- [ ] Criar o arquivo de implementacao `packages/tiss/src/serializer/serialize-recurso-glosa.ts`:

```ts
import { XmlBuilder } from './xml-builder';
import { encodeIso8859 } from './encode-iso8859';
import { computeRecursoGlosaHash } from './compute-tiss-hash';
import type { RecursoGlosaInput, ItemRecursoGlosaInput } from './types';

/**
 * Resultado da serializacao de um recurso de glosa TISS.
 */
export interface SerializeRecursoGlosaResult {
  /** XML completo em bytes ISO-8859-1, pronto para envio. */
  readonly xml: Uint8Array;
  /** Warnings de caracteres nao mapeados para ISO-8859-1. */
  readonly warnings: readonly string[];
}

/**
 * Serializa um recurso de glosa TISS em XML ISO-8859-1.
 *
 * Funcao PURA: recebe dados tipados, devolve Uint8Array. ZERO side-effect.
 * O hash MD5 proprietario e calculado e embutido em <ans:hash>.
 * O XML segue o padrao TISS 4.01.00 (ou a versao do recurso).
 *
 * O encounterVersionId esta no input mas NAO vai no XML — e obrigatorio
 * para rastreabilidade (§3.9: recurso de glosa sempre cita a versao usada).
 */
export function serializeRecursoGlosa(input: RecursoGlosaInput): SerializeRecursoGlosaResult {
  const { cabecalho, numeroLoteOriginal, numeroRecursoGlosa, contratado, itens } = input;

  // Calcula o hash antes de montar o XML — ele sera embutido no epilogo
  const hash = computeRecursoGlosaHash(cabecalho, numeroLoteOriginal, numeroRecursoGlosa, itens);

  const xml = new XmlBuilder();

  // Raiz com namespace ANS
  xml.openWithAttrs('ans:mensagemTISS', {
    'xmlns:ans': 'http://www.ans.gov.br/padroes/tiss/schemas',
  });

  // ---- Cabecalho ----
  emitCabecalho(xml, cabecalho);

  // ---- Corpo: prestadorParaOperadora > recursoGlosa ----
  xml.open('ans:prestadorParaOperadora');
  xml.open('ans:recursoGlosa');

  xml.tag('ans:registroANS', input.registroANS);
  xml.tag('ans:numeroLoteOriginal', numeroLoteOriginal);
  xml.tag('ans:numeroRecursoGlosa', numeroRecursoGlosa);

  // Dados do contratado
  xml.open('ans:dadosContratado');
  xml.optionalTag('ans:codigoPrestadorNaOperadora', contratado.codigoPrestadorNaOperadora);
  xml.optionalTag('ans:cpfContratado', contratado.cpfContratado);
  xml.optionalTag('ans:cnpjContratado', contratado.cnpjContratado);
  xml.tag('ans:CNES', contratado.cnes);
  xml.close('ans:dadosContratado');

  // Itens do recurso
  for (const item of itens) {
    emitItemRecurso(xml, item);
  }

  xml.close('ans:recursoGlosa');
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

function emitCabecalho(xml: XmlBuilder, cab: RecursoGlosaInput['cabecalho']): void {
  xml.open('ans:cabecalho');
  xml.tag('ans:versaoPadrao', cab.versaoPadrao);
  xml.tag('ans:registroANS', cab.registroANS);
  xml.tag('ans:dataGeracao', cab.dataGeracao);
  xml.tag('ans:horaGeracao', cab.horaGeracao);
  xml.tag('ans:sequencialTransacao', cab.sequencialTransacao);
  xml.close('ans:cabecalho');
}

function emitItemRecurso(xml: XmlBuilder, item: ItemRecursoGlosaInput): void {
  xml.open('ans:itemRecursoGlosa');
  xml.tag('ans:sequencialItem', item.sequencialItem);
  xml.tag('ans:dataAtendimento', item.dataAtendimento);
  xml.tag('ans:numeroGuiaPrestador', item.numeroGuiaPrestador);
  xml.optionalTag('ans:numeroGuiaOperadora', item.numeroGuiaOperadora);
  xml.tag('ans:codigoProcedimento', item.codigoProcedimento);
  xml.tag('ans:codigoGlosa', item.codigoGlosa);
  xml.tag('ans:valorRecursado', formatValorReais(item.valorRecursadoCentavos));
  xml.tag('ans:justificativa', item.justificativa);
  xml.close('ans:itemRecursoGlosa');
}

function formatValorReais(centavos: number): string {
  const reais = Math.trunc(centavos / 100);
  const cents = centavos % 100;
  return `${reais}.${String(cents).padStart(2, '0')}`;
}
```

- [ ] Rodar o teste novamente e confirmar que passa:

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```bash
git add packages/tiss/src/serializer/serialize-recurso-glosa.ts packages/tiss/src/serializer/serialize-recurso-glosa.test.ts
git commit -m "feat(tiss): add serializeRecursoGlosa XML serializer for glosa appeal"
```

---

### Task 29: teste snapshot byte a byte e teste de acentos ISO-8859-1 no recurso de glosa

**Arquivos:** `packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts` (novo), `packages/tiss/src/serializer/serialize-recurso-glosa-acentos.test.ts` (novo)

- [ ] Criar o teste de snapshot `packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeRecursoGlosa } from './serialize-recurso-glosa';
import type { RecursoGlosaInput } from './types';

/**
 * Recurso de glosa de amostra DETERMINISTICO — os mesmos dados sempre, para
 * que o snapshot byte a byte seja reproduzivel. Nenhum campo depende de relogio.
 */
function recursoAmostraDeterministico(): RecursoGlosaInput {
  return {
    cabecalho: {
      versaoPadrao: '4.01.00',
      registroANS: '339679',
      dataGeracao: '2026-08-07',
      horaGeracao: '14:30:00',
      sequencialTransacao: '12345',
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
        numeroGuiaOperadora: 'OP98765',
        codigoProcedimento: '10101012',
        codigoGlosa: 'A10',
        valorRecursadoCentavos: 15000,
        justificativa: 'Procedimento realizado conforme indicação clínica documentada',
      },
      {
        sequencialItem: '2',
        dataAtendimento: '2026-07-15',
        numeroGuiaPrestador: '00002',
        codigoProcedimento: '10101039',
        codigoGlosa: 'B15',
        valorRecursadoCentavos: 8050,
        justificativa: 'Exame necessário para diagnóstico diferencial',
      },
    ],
    encounterVersionId: 'ev_00000000-0000-0000-0000-000000000001',
  };
}

const FIXTURE_DIR = join(__dirname, '../../test/fixtures');
const FIXTURE_PATH = join(FIXTURE_DIR, 'recurso-glosa-amostra.xml');

describe('snapshot byte a byte do recurso de glosa', () => {
  it('gera XML deterministico e identico ao snapshot congelado', () => {
    const { xml, warnings } = serializeRecursoGlosa(recursoAmostraDeterministico());
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
        const context = new TextDecoder('iso-8859-1').decode(
          xml.slice(Math.max(0, i - 20), i + 20),
        );
        throw new Error(
          `Divergencia no byte ${i}: esperado 0x${expected[i]!.toString(16).padStart(2, '0')} ` +
          `mas recebeu 0x${xml[i]!.toString(16).padStart(2, '0')}. ` +
          `Contexto: ...${context}...`,
        );
      }
    }
  });

  it('o XML do snapshot e valido como texto ISO-8859-1', () => {
    const { xml } = serializeRecursoGlosa(recursoAmostraDeterministico());
    const text = new TextDecoder('iso-8859-1').decode(xml);
    expect(text).toContain('<?xml version="1.0" encoding="ISO-8859-1"?>');
    expect(text).toContain('</ans:mensagemTISS>');
    // Verifica que o acento em "indicacao" foi preservado em ISO-8859-1
    expect(text).toContain('indicação');
  });

  it('duas chamadas com os mesmos dados produzem bytes identicos', () => {
    const result1 = serializeRecursoGlosa(recursoAmostraDeterministico());
    const result2 = serializeRecursoGlosa(recursoAmostraDeterministico());
    expect(result1.xml).toEqual(result2.xml);
  });
});
```

- [ ] Rodar o teste de snapshot (a primeira execucao cria o fixture):

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts
```

Saida esperada: teste passa. Console imprime "Snapshot criado: ..." na primeira execucao. Na segunda execucao, compara byte a byte.

- [ ] Rodar pela segunda vez para garantir idempotencia:

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts
```

Saida esperada: todos os testes passam sem criar snapshot novo.

- [ ] Criar o teste de acentos `packages/tiss/src/serializer/serialize-recurso-glosa-acentos.test.ts`:

```ts
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
```

- [ ] Rodar os testes de acentos:

```bash
npx vitest run packages/tiss/src/serializer/serialize-recurso-glosa-acentos.test.ts
```

Saida esperada: todos os testes passam.

- [ ] Commitar tudo junto (snapshot fixture + testes):

```bash
git add packages/tiss/src/serializer/serialize-recurso-glosa-snapshot.test.ts packages/tiss/src/serializer/serialize-recurso-glosa-acentos.test.ts packages/tiss/test/fixtures/recurso-glosa-amostra.xml
git commit -m "test(tiss): add snapshot and ISO-8859-1 accent tests for recurso de glosa serializer"
```

---

### Task 30: exportar serializeRecursoGlosa e tipos no index.ts do pacote tiss

**Arquivos:** `packages/tiss/src/index.ts`

- [ ] Adicionar os exports do recurso de glosa em `packages/tiss/src/index.ts`, logo apos o export de `serializeLoteConsulta`:

```ts
// --- em packages/tiss/src/index.ts, logo APOS a linha:
// export { serializeLoteConsulta, type SerializeLoteResult } from './serializer/serialize-lote-consulta';
// ACRESCENTAR: ---

export type {
  RecursoGlosaInput,
  ItemRecursoGlosaInput,
  ContratadoRecursoInput,
} from './serializer/types';

export {
  serializeRecursoGlosa,
  type SerializeRecursoGlosaResult,
} from './serializer/serialize-recurso-glosa';

export { computeRecursoGlosaHash } from './serializer/compute-tiss-hash';
```

- [ ] Rodar type-check para confirmar que tudo compila:

```bash
npx tsc --noEmit -p packages/tiss/tsconfig.json
```

Saida esperada: nenhum erro.

- [ ] Rodar TODOS os testes do serializer para garantir que nada quebrou:

```bash
npx vitest run packages/tiss/src/serializer/
```

Saida esperada: todos os testes passam (incluindo os existentes do lote e os novos do recurso).

- [ ] Commitar:

```bash
git add packages/tiss/src/index.ts
git commit -m "feat(tiss): export serializeRecursoGlosa and RecursoGlosaInput from package index"
```
