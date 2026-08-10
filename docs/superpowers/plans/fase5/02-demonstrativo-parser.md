### Task 7: tipos ParsedDemonstrativo e funcao decodeIso8859 com teste unitario

**Arquivos**

- Criar `packages/tiss/src/demonstrativo/parse-demonstrativo.ts`
- Criar `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`

- [ ] **Passo 1** — criar o arquivo de tipos e a funcao `decodeIso8859` em `packages/tiss/src/demonstrativo/parse-demonstrativo.ts`:

```ts
// packages/tiss/src/demonstrativo/parse-demonstrativo.ts

/**
 * Parser PURO e deterministico de XML de demonstrativo TISS.
 *
 * Recebe o XML em bytes ISO-8859-1 (como retornado por TissTransport.fetchDemonstrativo),
 * decodifica para string e extrai os campos estruturados. Sem I/O, sem side-effects.
 *
 * O parser usa extracao por regex para o subset limitado do XSD TISS — DOMParser
 * nao existe em Node.js e uma dependencia de parser XML completo e desnecessaria
 * para o formato previsivel e bem definido do demonstrativo TISS 4.01.00.
 */

// ---------------------------------------------------------------------------
// Tipos de saida
// ---------------------------------------------------------------------------

export interface ParsedDemonstrativoGlosa {
  readonly codigoGlosa: string;
  readonly descricaoGlosa: string;
}

export interface ParsedDemonstrativoItem {
  readonly numeroGuiaPrestador: string;
  readonly numeroGuiaOperadora?: string;
  readonly valorInformadoCents: number;
  readonly valorProcessadoCents: number;
  readonly valorLiberadoCents: number;
  readonly valorGlosaCents: number;
  readonly glosas: readonly ParsedDemonstrativoGlosa[];
}

export interface ParsedDemonstrativoCabecalho {
  readonly registroANS: string;
  readonly numeroDemonstrativo: string;
  readonly dataProcessamento: string;
  readonly numeroProtocolo: string;
}

export interface ParsedDemonstrativo {
  readonly tipo: 'analise' | 'pagamento';
  readonly cabecalho: ParsedDemonstrativoCabecalho;
  readonly itens: readonly ParsedDemonstrativoItem[];
}

// ---------------------------------------------------------------------------
// Utilidade de decodificacao
// ---------------------------------------------------------------------------

/**
 * Decodifica bytes ISO-8859-1 para string JavaScript.
 *
 * Inversa de encodeIso8859 (packages/tiss/src/serializer/encode-iso8859.ts).
 * ISO-8859-1 mapeia bytes 0x00-0xFF diretamente para code points Unicode
 * correspondentes, o que TextDecoder('iso-8859-1') faz nativamente.
 */
export function decodeIso8859(bytes: Uint8Array): string {
  return new TextDecoder('iso-8859-1').decode(bytes);
}
```

- [ ] **Passo 2** — criar o teste unitario para `decodeIso8859` em `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`:

```ts
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
```

- [ ] **Passo 3** — rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 4 passed`.

- [ ] **Passo 4** — commitar:

```bash
git add packages/tiss/src/demonstrativo/parse-demonstrativo.ts \
       packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
git commit -m "feat(tiss): add ParsedDemonstrativo types and decodeIso8859 utility"
```

---

### Task 8: parseDemonstrativoXml — teste e implementacao com amostra de 3 guias

**Arquivos**

- Modificar `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`
- Modificar `packages/tiss/src/demonstrativo/parse-demonstrativo.ts`

- [ ] **Passo 1** — adicionar o teste de `parseDemonstrativoXml` com fixture de 3 guias (1 paga integral, 1 glosa parcial, 1 glosa total) em `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`. Adicionar o bloco abaixo APOS o `describe('decodeIso8859', ...)` existente:

```ts
// --- Adicionar ao final de parse-demonstrativo.test.ts ---
// Na linha de imports existente, adicionar parseDemonstrativoXml:
//   import { decodeIso8859, parseDemonstrativoXml } from './parse-demonstrativo';
// (encodeIso8859 ja foi importado no Passo 2 da Task 7)

/** Fixture: demonstrativo de analise com 3 guias de consulta. */
const SAMPLE_ANALISE = [
  '<?xml version="1.0" encoding="ISO-8859-1"?>',
  '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
  '<ans:cabecalho>',
  '<ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
  '<ans:registroANS>999999</ans:registroANS>',
  '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
  '<ans:horaGeracao>10:30:00</ans:horaGeracao>',
  '<ans:sequencialTransacao>999</ans:sequencialTransacao>',
  '</ans:cabecalho>',
  '<ans:operadoraParaPrestador>',
  '<ans:demonstrativoAnaliseConta>',
  '<ans:cabecalhoDemonstrativo>',
  '<ans:registroANS>326305</ans:registroANS>',
  '<ans:numeroDemonstrativo>DEMO-2026-001</ans:numeroDemonstrativo>',
  '</ans:cabecalhoDemonstrativo>',
  '<ans:dadosProtocolo>',
  '<ans:numeroProtocolo>PROT-001</ans:numeroProtocolo>',
  '</ans:dadosProtocolo>',
  '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
  '<ans:relacaoGuias>',
  // --- Guia 1: paga integralmente, sem glosa ---
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-001</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>100.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>100.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>100.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
  '</ans:guiaCabecalho>',
  // --- Guia 2: glosa parcial (R$ 50 de R$ 200) ---
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-002</ans:numeroGuiaPrestador>',
  '<ans:numeroGuiaOperadora>OP-5678</ans:numeroGuiaOperadora>',
  '<ans:valorInformadoGuia>200.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>150.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>150.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>50.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>A010</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Valor acima do autorizado</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  // --- Guia 3: glosa total (R$ 300 de R$ 300, 2 codigos de glosa) ---
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-003</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>300.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>0.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>0.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>300.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>B015</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Procedimento nao coberto pelo plano</ans:descricaoGlosa>',
  '</ans:glosa>',
  '<ans:glosa>',
  '<ans:codigoGlosa>C020</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Guia vencida</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  '</ans:relacaoGuias>',
  '</ans:demonstrativoAnaliseConta>',
  '</ans:operadoraParaPrestador>',
  '<ans:epilogo><ans:hash>abc123</ans:hash></ans:epilogo>',
  '</ans:mensagemTISS>',
].join('\n');

describe('parseDemonstrativoXml', () => {
  it('extrai cabecalho, 3 itens e glosas de demonstrativo de analise', () => {
    const encoded = encodeIso8859(SAMPLE_ANALISE);
    const result = parseDemonstrativoXml(encoded.bytes);

    // Tipo detectado a partir da tag demonstrativoAnaliseConta
    expect(result.tipo).toBe('analise');

    // Cabecalho extraido do bloco cabecalhoDemonstrativo (NAO do cabecalho da mensagem)
    expect(result.cabecalho.registroANS).toBe('326305');
    expect(result.cabecalho.numeroDemonstrativo).toBe('DEMO-2026-001');
    expect(result.cabecalho.dataProcessamento).toBe('2026-08-05');
    expect(result.cabecalho.numeroProtocolo).toBe('PROT-001');

    expect(result.itens).toHaveLength(3);

    // --- Guia 1: paga integralmente ---
    const g1 = result.itens[0]!;
    expect(g1.numeroGuiaPrestador).toBe('CY-001');
    expect(g1.numeroGuiaOperadora).toBeUndefined();
    expect(g1.valorInformadoCents).toBe(10000);
    expect(g1.valorProcessadoCents).toBe(10000);
    expect(g1.valorLiberadoCents).toBe(10000);
    expect(g1.valorGlosaCents).toBe(0);
    expect(g1.glosas).toHaveLength(0);

    // --- Guia 2: glosa parcial ---
    const g2 = result.itens[1]!;
    expect(g2.numeroGuiaPrestador).toBe('CY-002');
    expect(g2.numeroGuiaOperadora).toBe('OP-5678');
    expect(g2.valorInformadoCents).toBe(20000);
    expect(g2.valorProcessadoCents).toBe(15000);
    expect(g2.valorLiberadoCents).toBe(15000);
    expect(g2.valorGlosaCents).toBe(5000);
    expect(g2.glosas).toHaveLength(1);
    expect(g2.glosas[0]!.codigoGlosa).toBe('A010');
    expect(g2.glosas[0]!.descricaoGlosa).toBe('Valor acima do autorizado');

    // --- Guia 3: glosa total ---
    const g3 = result.itens[2]!;
    expect(g3.numeroGuiaPrestador).toBe('CY-003');
    expect(g3.valorInformadoCents).toBe(30000);
    expect(g3.valorProcessadoCents).toBe(0);
    expect(g3.valorLiberadoCents).toBe(0);
    expect(g3.valorGlosaCents).toBe(30000);
    expect(g3.glosas).toHaveLength(2);
    expect(g3.glosas[0]!.codigoGlosa).toBe('B015');
    expect(g3.glosas[0]!.descricaoGlosa).toBe('Procedimento nao coberto pelo plano');
    expect(g3.glosas[1]!.codigoGlosa).toBe('C020');
    expect(g3.glosas[1]!.descricaoGlosa).toBe('Guia vencida');
  });
});
```

- [ ] **Passo 2** — rodar o teste e confirmar que falha (a funcao `parseDemonstrativoXml` ainda nao existe):

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: erro de compilacao ou `parseDemonstrativoXml is not a function`.

- [ ] **Passo 3** — implementar `parseDemonstrativoXml` em `packages/tiss/src/demonstrativo/parse-demonstrativo.ts`. Adicionar o bloco abaixo apos a funcao `decodeIso8859`:

```ts
// --- Adicionar ao final de parse-demonstrativo.ts ---

// ---------------------------------------------------------------------------
// Helpers de extracao XML por regex
// ---------------------------------------------------------------------------

/**
 * Extrai o conteudo texto de uma tag folha (sem filhos).
 * Retorna undefined se a tag nao for encontrada.
 * O regex aceita tags com ou sem atributos.
 */
function extractTag(xml: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([^<]*)</${escaped}>`);
  const m = xml.match(re);
  return m?.[1];
}

/**
 * Extrai todos os blocos de conteudo de tags container (com filhos).
 * Usa match lazy para evitar capturar tags irmãs.
 *
 * LIMITACAO: nao suporta tags identicas aninhadas (ex: <a><a>...</a></a>).
 * O formato TISS nao tem tags identicas aninhadas, entao esta limitacao
 * e aceitavel para este parser de subset.
 */
function extractAllBlocks(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'g');
  const result: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    result.push(m[1]!);
  }
  return result;
}

/**
 * Converte valor monetario no formato TISS (reais com 2 decimais) para centavos inteiros.
 * Ex: '150.00' -> 15000, '0.99' -> 99, '' -> 0
 */
function parseReaisToCentavos(valor: string): number {
  const trimmed = valor.trim();
  if (trimmed === '') return 0;
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex === -1) return Number(trimmed) * 100;
  const reais = Number(trimmed.slice(0, dotIndex));
  const decPart = trimmed.slice(dotIndex + 1).padEnd(2, '0').slice(0, 2);
  return reais * 100 + Number(decPart);
}

// ---------------------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------------------

/**
 * Parseia XML de demonstrativo TISS (ISO-8859-1) em estrutura tipada.
 *
 * Funcao PURA e DETERMINISTICA. Recebe bytes ISO-8859-1, decodifica,
 * extrai os campos do demonstrativo de analise de conta ou de pagamento.
 *
 * Lanca Error se o XML nao contiver nenhum dos dois tipos de demonstrativo.
 */
export function parseDemonstrativoXml(xml: Uint8Array): ParsedDemonstrativo {
  const text = decodeIso8859(xml);

  // Detecta tipo pela presenca da tag container
  const isAnalise = text.includes('<ans:demonstrativoAnaliseConta');
  const isPagamento = text.includes('<ans:demonstrativoPagamento');

  if (!isAnalise && !isPagamento) {
    throw new Error(
      'XML nao contem demonstrativoAnaliseConta nem demonstrativoPagamento',
    );
  }

  const tipo: 'analise' | 'pagamento' = isAnalise ? 'analise' : 'pagamento';
  const demoTag = isAnalise
    ? 'ans:demonstrativoAnaliseConta'
    : 'ans:demonstrativoPagamento';

  // Extrai o bloco do demonstrativo (pode haver apenas 1 por mensagem TISS)
  const demoBlocks = extractAllBlocks(text, demoTag);
  if (demoBlocks.length === 0) {
    throw new Error(`Bloco <${demoTag}> nao encontrado no XML`);
  }
  const demo = demoBlocks[0]!;

  // Cabecalho — extraido de dentro do bloco demonstrativo, nao da mensagem TISS
  const registroANS = extractTag(demo, 'ans:registroANS') ?? '';
  const numeroDemonstrativo = extractTag(demo, 'ans:numeroDemonstrativo') ?? '';
  const dataProcessamento = extractTag(demo, 'ans:dataProcessamento') ?? '';
  const numeroProtocolo = extractTag(demo, 'ans:numeroProtocolo') ?? '';

  // Itens (guias) — cada <ans:guiaCabecalho> e um item
  const guiaBlocks = extractAllBlocks(demo, 'ans:guiaCabecalho');
  const itens: ParsedDemonstrativoItem[] = guiaBlocks.map(parseGuiaBlock);

  return {
    tipo,
    cabecalho: { registroANS, numeroDemonstrativo, dataProcessamento, numeroProtocolo },
    itens,
  };
}

function parseGuiaBlock(guiaXml: string): ParsedDemonstrativoItem {
  const numeroGuiaPrestador = extractTag(guiaXml, 'ans:numeroGuiaPrestador') ?? '';
  const numeroGuiaOperadora = extractTag(guiaXml, 'ans:numeroGuiaOperadora');
  const valorInformadoCents = parseReaisToCentavos(
    extractTag(guiaXml, 'ans:valorInformadoGuia') ?? '0',
  );
  const valorProcessadoCents = parseReaisToCentavos(
    extractTag(guiaXml, 'ans:valorProcessadoGuia') ?? '0',
  );
  const valorLiberadoCents = parseReaisToCentavos(
    extractTag(guiaXml, 'ans:valorLiberadoGuia') ?? '0',
  );
  const valorGlosaCents = parseReaisToCentavos(
    extractTag(guiaXml, 'ans:valorGlosaGuia') ?? '0',
  );

  // Glosas: extrai cada <ans:glosa> de dentro de <ans:glosas>.
  // O regex distingue corretamente <ans:glosa> de <ans:glosas> pelo '>' final.
  const glosaBlocks = extractAllBlocks(guiaXml, 'ans:glosa');
  const glosas: ParsedDemonstrativoGlosa[] = glosaBlocks.map((g) => ({
    codigoGlosa: extractTag(g, 'ans:codigoGlosa') ?? '',
    descricaoGlosa: extractTag(g, 'ans:descricaoGlosa') ?? '',
  }));

  return {
    numeroGuiaPrestador,
    ...(numeroGuiaOperadora !== undefined ? { numeroGuiaOperadora } : {}),
    valorInformadoCents,
    valorProcessadoCents,
    valorLiberadoCents,
    valorGlosaCents,
    glosas,
  };
}
```

- [ ] **Passo 4** — rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 5 passed` (4 do decodeIso8859 + 1 do parseDemonstrativoXml).

- [ ] **Passo 5** — commitar:

```bash
git add packages/tiss/src/demonstrativo/parse-demonstrativo.ts \
       packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
git commit -m "feat(tiss): implement parseDemonstrativoXml for TISS demonstrativo XML"
```

---

### Task 9: parseDemonstrativoXml — suporte a demonstrativo de pagamento e acentos ISO-8859-1

**Arquivos**

- Modificar `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`

- [ ] **Passo 1** — adicionar teste para demonstrativo de pagamento (tag `demonstrativoPagamento` em vez de `demonstrativoAnaliseConta`). Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  // --- Adicionar dentro do describe('parseDemonstrativoXml') ---

  it('detecta tipo pagamento a partir da tag demonstrativoPagamento', () => {
    const xmlPagamento = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho>',
      '<ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-10</ans:dataGeracao>',
      '<ans:horaGeracao>14:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1000</ans:sequencialTransacao>',
      '</ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoPagamento>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>PAG-2026-001</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo>',
      '<ans:numeroProtocolo>PROT-PAG-001</ans:numeroProtocolo>',
      '</ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-10</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>PG-001</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>500.00</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>500.00</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>500.00</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoPagamento>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>def456</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlPagamento);
    const result = parseDemonstrativoXml(encoded.bytes);

    expect(result.tipo).toBe('pagamento');
    expect(result.cabecalho.numeroDemonstrativo).toBe('PAG-2026-001');
    expect(result.cabecalho.numeroProtocolo).toBe('PROT-PAG-001');
    expect(result.itens).toHaveLength(1);
    expect(result.itens[0]!.numeroGuiaPrestador).toBe('PG-001');
    expect(result.itens[0]!.valorInformadoCents).toBe(50000);
    expect(result.itens[0]!.valorGlosaCents).toBe(0);
  });
```

- [ ] **Passo 2** — adicionar teste para acentos ISO-8859-1 na descricao de glosa (bytes reais, nao UTF-8). Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  it('decodifica acentos ISO-8859-1 na descricao de glosa', () => {
    const xmlComAcentos = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
      '<ans:horaGeracao>10:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>AC-ACENTO</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-AC</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>AC-001</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>100.00</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>50.00</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>50.00</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>50.00</ans:valorGlosaGuia>',
      '<ans:glosas><ans:glosa>',
      '<ans:codigoGlosa>X001</ans:codigoGlosa>',
      // 'nao' com til: n + a-til + o = caracteres ISO-8859-1 validos
      '<ans:descricaoGlosa>Procedimento não autorizado pela clínica</ans:descricaoGlosa>',
      '</ans:glosa></ans:glosas>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>xyz</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlComAcentos);
    expect(encoded.warnings).toHaveLength(0);

    const result = parseDemonstrativoXml(encoded.bytes);

    // Os acentos devem ser preservados apos decode ISO-8859-1
    expect(result.itens[0]!.glosas[0]!.descricaoGlosa).toBe(
      'Procedimento não autorizado pela clínica',
    );
  });
```

- [ ] **Passo 3** — rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 7 passed`.

- [ ] **Passo 4** — commitar:

```bash
git add packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
git commit -m "test(tiss): add demonstrativoPagamento and ISO-8859-1 accent tests"
```

---

### Task 10: parseDemonstrativoXml — testes de borda e robustez

**Arquivos**

- Modificar `packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts`

- [ ] **Passo 1** — adicionar teste de erro para XML sem tag de demonstrativo. Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  it('lanca erro para XML sem tag de demonstrativo', () => {
    const xmlSemDemo = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao></ans:cabecalho>',
      '</ans:mensagemTISS>',
    ].join('\n');
    const encoded = encodeIso8859(xmlSemDemo);

    expect(() => parseDemonstrativoXml(encoded.bytes)).toThrow(
      'XML nao contem demonstrativoAnaliseConta nem demonstrativoPagamento',
    );
  });
```

- [ ] **Passo 2** — adicionar teste para demonstrativo com zero guias (relacaoGuias vazio). Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  it('retorna itens vazio para demonstrativo sem guias', () => {
    const xmlSemGuias = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
      '<ans:horaGeracao>10:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>VAZIO-001</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-V</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
      '<ans:relacaoGuias></ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>vazio</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlSemGuias);
    const result = parseDemonstrativoXml(encoded.bytes);

    expect(result.tipo).toBe('analise');
    expect(result.cabecalho.numeroDemonstrativo).toBe('VAZIO-001');
    expect(result.itens).toHaveLength(0);
  });
```

- [ ] **Passo 3** — adicionar teste para valores monetarios com formatos variados. Adicionar dentro do `describe('parseDemonstrativoXml', ...)`:

```ts
  it('converte valores monetarios com centavos fracionarios corretamente', () => {
    const xmlValores = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
      '<ans:horaGeracao>10:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>1</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>VAL-001</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-VAL</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>VAL-001</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>0.99</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>1234.56</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>0.01</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>val</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const encoded = encodeIso8859(xmlValores);
    const result = parseDemonstrativoXml(encoded.bytes);
    const item = result.itens[0]!;

    expect(item.valorInformadoCents).toBe(99);
    expect(item.valorProcessadoCents).toBe(123456);
    expect(item.valorLiberadoCents).toBe(1);
    expect(item.valorGlosaCents).toBe(0);
  });
```

- [ ] **Passo 4** — rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 10 passed`.

- [ ] **Passo 5** — commitar:

```bash
git add packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
git commit -m "test(tiss): add edge case tests for parseDemonstrativoXml"
```

---

### Task 11: importDemonstrativo — tipos e implementacao

**Arquivos**

- Criar `packages/tiss/src/demonstrativo/import-demonstrativo.ts`

- [ ] **Passo 1** — criar `packages/tiss/src/demonstrativo/import-demonstrativo.ts` com tipos e implementacao completa:

```ts
// packages/tiss/src/demonstrativo/import-demonstrativo.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';
import { parseDemonstrativoXml, type ParsedDemonstrativo } from './parse-demonstrativo';
import { receiveLoteReturn } from '../lote-lifecycle';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ImportDemonstrativoInput {
  /** XML do demonstrativo em bytes ISO-8859-1. */
  readonly xml: Uint8Array;
  /** Id da operadora destino (FK obrigatoria em tiss.demonstrativo). */
  readonly operadoraId: string;
  /** Chave de storage do XML original (coluna xml_storage_key). */
  readonly xmlStorageKey: string;
  /** Se informado, atualiza o lote para status 'retornado'. */
  readonly loteId?: string;
}

export type ImportDemonstrativoFailure =
  | { kind: 'xml_invalido'; message: string }
  | { kind: 'lote_nao_encontrado' }
  | { kind: 'transicao_invalida'; de: string; para: string };

export interface ImportDemonstrativoResult {
  /** Id do demonstrativo inserido. */
  readonly demonstrativoId: string;
  /** Quantidade de itens (guias) no demonstrativo. */
  readonly itemCount: number;
  /** Quantas guias foram vinculadas a encounter_guia_consulta existente. */
  readonly matchedCount: number;
  /** Valor total de glosa em centavos. */
  readonly totalGlosaCents: number;
}

// ---------------------------------------------------------------------------
// Funcao principal
// ---------------------------------------------------------------------------

/**
 * Importa um demonstrativo TISS para o banco de dados.
 *
 * (1) Chama parseDemonstrativoXml para extrair dados estruturados do XML.
 * (2) Para cada item, faz match de numero_guia_prestador com
 *     tiss.encounter_guia_consulta (RLS filtra por tenant automaticamente).
 * (3) Insere em tiss.demonstrativo e tiss.demonstrativo_item.
 * (4) Marca guias com glosa: o vinculo demonstrativo_item.guia_id +
 *     valor_glosa_cents > 0 constitui a marcacao de glosa na guia.
 * (5) Se loteId presente, atualiza lote.status para 'retornado' via
 *     receiveLoteReturn.
 *
 * As tabelas tiss.demonstrativo e tiss.demonstrativo_item sao criadas
 * pelo bloco 01-demonstrativo-migrations.
 */
export async function importDemonstrativo(
  tx: TxClient,
  input: ImportDemonstrativoInput,
  importedBy: string,
): Promise<Result<ImportDemonstrativoResult, ImportDemonstrativoFailure>> {
  // 1. Parse XML
  let parsed: ParsedDemonstrativo;
  try {
    parsed = parseDemonstrativoXml(input.xml);
  } catch (e) {
    return err({
      kind: 'xml_invalido',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const demonstrativoId = uuidv7();
  const cab = parsed.cabecalho;

  // 2. Computa totais a partir dos itens parseados
  let totalApresentado = 0;
  let totalProcessado = 0;
  let totalLiberado = 0;
  let totalGlosa = 0;
  for (const item of parsed.itens) {
    totalApresentado += item.valorInformadoCents;
    totalProcessado += item.valorProcessadoCents;
    totalLiberado += item.valorLiberadoCents;
    totalGlosa += item.valorGlosaCents;
  }

  // 3. Insere cabecalho do demonstrativo (tenant_id vem do DEFAULT via RLS).
  //    Nomes de coluna seguem o schema canonico do bloco 01 (migration 0123).
  await tx.query(
    `INSERT INTO tiss.demonstrativo
       (id, operadora_id, lote_id, protocolo_operadora, kind,
        data_processamento, xml_storage_key,
        total_apresentado_cents, total_processado_cents,
        total_liberado_cents, total_glosa_cents, imported_by)
     VALUES ($1, $2, $3, $4, $5::tiss.demonstrativo_kind,
             $6::date, $7, $8, $9, $10, $11, $12)`,
    [
      demonstrativoId,
      input.operadoraId,
      input.loteId ?? null,
      cab.numeroProtocolo,
      parsed.tipo === 'analise' ? 'analise' : 'pagamento',
      cab.dataProcessamento,
      input.xmlStorageKey,
      totalApresentado,
      totalProcessado,
      totalLiberado,
      totalGlosa,
      importedBy,
    ],
  );

  // 4. Para cada item, faz match e insere demonstrativo_item
  let matchedCount = 0;
  for (const item of parsed.itens) {
    // Match por numero_guia_prestador na guia VIVA (RLS filtra por tenant)
    const { rows: guiaRows } = await tx.query<{ id: string }>(
      `SELECT id FROM tiss.encounter_guia_consulta
        WHERE numero_guia_prestador = $1 AND live = true`,
      [item.numeroGuiaPrestador],
    );
    const guiaId = guiaRows.length > 0 ? guiaRows[0]!.id : null;
    if (guiaId !== null) matchedCount++;

    // Nomes de coluna seguem o schema canonico do bloco 01 (migration 0124).
    // Glosa armazenada como par codigo+descricao (primeiro da lista parseada);
    // detalhes completos preservados no XML original (xml_storage_key).
    const primaryGlosa = item.glosas.length > 0 ? item.glosas[0]! : null;
    await tx.query(
      `INSERT INTO tiss.demonstrativo_item
         (id, demonstrativo_id, guia_id, numero_guia_prestador,
          valor_apresentado_cents, valor_processado_cents,
          valor_liberado_cents, valor_glosa_cents,
          glosa_codigo, glosa_descricao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        uuidv7(),
        demonstrativoId,
        guiaId,
        item.numeroGuiaPrestador,
        item.valorInformadoCents,
        item.valorProcessadoCents,
        item.valorLiberadoCents,
        item.valorGlosaCents,
        primaryGlosa?.codigoGlosa ?? null,
        primaryGlosa?.descricaoGlosa ?? null,
      ],
    );
  }

  // 5. Atualiza lote para 'retornado' se loteId presente
  if (input.loteId) {
    const loteResult = await receiveLoteReturn(tx, input.loteId);
    if (!loteResult.ok) {
      const e = loteResult.error;
      if (e.kind === 'lote_nao_encontrado') {
        return err({ kind: 'lote_nao_encontrado' });
      }
      if (e.kind === 'transicao_invalida') {
        return err({ kind: 'transicao_invalida', de: e.de, para: e.para });
      }
    }
  }

  return ok({
    demonstrativoId,
    itemCount: parsed.itens.length,
    matchedCount,
    totalGlosaCents: totalGlosa,
  });
}
```

- [ ] **Passo 2** — verificar que o arquivo compila sem erros de tipo:

```bash
pnpm tsc --noEmit -p packages/tiss/tsconfig.json 2>&1 | head -20
```

Saida esperada: sem erros de tipo (ou zero output).

- [ ] **Passo 3** — commitar:

```bash
git add packages/tiss/src/demonstrativo/import-demonstrativo.ts
git commit -m "feat(tiss): add importDemonstrativo function for demonstrativo TISS import"
```

---

### Task 12: importDemonstrativo — teste de integracao e exports no index.ts

**Arquivos**

- Criar `packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts`
- Modificar `packages/tiss/src/index.ts`

- [ ] **Passo 1** — criar o teste de integracao em `packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts`. O teste semeia 3 guias num lote enviado, importa o demonstrativo de amostra e verifica valores, vinculos e transicao de lote:

```ts
// packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { encodeIso8859 } from '../serializer/encode-iso8859';
import { importDemonstrativo } from './import-demonstrativo';

// ---------------------------------------------------------------------------
// Semente
// ---------------------------------------------------------------------------

interface SementeDemonstrativo {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  patientId: string;
  operadoraId: string;
  loteId: string;
  guiaIds: string[];
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearDemonstrativo(): Promise<SementeDemonstrativo> {
  const s: SementeDemonstrativo = {
    tenantId: uuidv7(),
    clinicId: uuidv7(),
    userId: uuidv7(),
    professionalId: uuidv7(),
    patientId: uuidv7(),
    operadoraId: uuidv7(),
    loteId: uuidv7(),
    guiaIds: [uuidv7(), uuidv7(), uuidv7()],
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');

    // --- Infraestrutura base ---
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Demo', '77ABC88899DE00')`,
      [s.tenantId, `demo-${s.tenantId}`],
    );
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Demo', '7788990', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId],
    );
    await c.query(
      `INSERT INTO id."user" (id, email, full_name)
       VALUES ($1, $2, 'Admin Demo')`,
      [s.userId, `${s.userId}@example.test`],
    );
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId],
    );
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777888', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId],
    );
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Demo', 'completo')`,
      [s.tenantId, s.patientId],
    );
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, tiss_version, active, created_by)
       VALUES ($1, $2, '326305', 'Operadora Demo', '66XYZ00005DE05', '4.01', true, $3)`,
      [s.tenantId, s.operadoraId, s.userId],
    );

    // --- 3 encounters com guias (numero_guia_prestador CY-001, CY-002, CY-003) ---
    for (let idx = 0; idx < 3; idx++) {
      const encId = uuidv7();
      const verId = uuidv7();
      const dia = String(idx + 1).padStart(2, '0');
      await c.query(
        `INSERT INTO clin.encounter
           (tenant_id, id, patient_id, professional_id, clinic_id,
            occurred_at, occurred_date, status)
         VALUES ($1, $2, $3, $4, $5,
                 TIMESTAMPTZ '2026-08-${dia}T14:00:00Z', DATE '2026-08-${dia}',
                 'finalizado'::clin.encounter_status)`,
        [s.tenantId, encId, s.patientId, s.professionalId, s.clinicId],
      );
      await c.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1, $2, $3, 1, 'original', $4, $5, sha256($6::bytea), 'jcs-1')`,
        [s.tenantId, verId, encId, s.userId, s.professionalId, `demo-${idx}`],
      );
      await c.query(
        `INSERT INTO tiss.encounter_guia_consulta
           (tenant_id, id, encounter_id, encounter_version_id, operadora_id,
            registro_ans, numero_guia_prestador, numero_carteira, atendimento_rn,
            codigo_prestador_na_operadora, cnes,
            conselho_profissional, numero_conselho, uf_conselho, cbos,
            indicacao_acidente, regime_atendimento,
            data_atendimento, tipo_consulta, codigo_tabela, codigo_procedimento,
            valor_procedimento, live, created_by)
         VALUES ($1, $2, $3, $4, $5, '326305', $6, '00112233445566', false,
                '900123', '7788990', '06', '777888', 'SP', '225125', '9', '01',
                DATE '2026-08-${dia}', '1', '22', '10101012',
                ${(idx + 1) * 100}.00, true, $7)`,
        [
          s.tenantId, s.guiaIds[idx], encId, verId, s.operadoraId,
          `CY-${String(idx + 1).padStart(3, '0')}`, s.userId,
        ],
      );
    }

    // --- Lote em status 'enviado' com as 3 guias ---
    await c.query(
      `INSERT INTO tiss.lote
         (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
          guia_count, total_value_cents, protocolo_operadora, sent_at,
          xml_storage_key, xml_hash_md5, created_by)
       VALUES ($1, $2, $3, '1', 'enviado', '4.01', 3, 60000,
               'PROT-001', clock_timestamp(),
               'lote/demo/001.xml', 'aabbccddaabbccddaabbccddaabbccdd', $4)`,
      [s.tenantId, s.loteId, s.operadoraId, s.userId],
    );
    for (let idx = 0; idx < 3; idx++) {
      await c.query(
        `INSERT INTO tiss.lote_guia (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, $4)`,
        [s.tenantId, s.loteId, s.guiaIds[idx], idx + 1],
      );
    }

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}

// ---------------------------------------------------------------------------
// Fixture XML de demonstrativo (3 guias: paga, glosa parcial, glosa total)
// ---------------------------------------------------------------------------

const DEMONSTRATIVO_XML = [
  '<?xml version="1.0" encoding="ISO-8859-1"?>',
  '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
  '<ans:cabecalho>',
  '<ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
  '<ans:registroANS>999999</ans:registroANS>',
  '<ans:dataGeracao>2026-08-05</ans:dataGeracao>',
  '<ans:horaGeracao>10:30:00</ans:horaGeracao>',
  '<ans:sequencialTransacao>999</ans:sequencialTransacao>',
  '</ans:cabecalho>',
  '<ans:operadoraParaPrestador>',
  '<ans:demonstrativoAnaliseConta>',
  '<ans:cabecalhoDemonstrativo>',
  '<ans:registroANS>326305</ans:registroANS>',
  '<ans:numeroDemonstrativo>DEMO-INT-001</ans:numeroDemonstrativo>',
  '</ans:cabecalhoDemonstrativo>',
  '<ans:dadosProtocolo>',
  '<ans:numeroProtocolo>PROT-001</ans:numeroProtocolo>',
  '</ans:dadosProtocolo>',
  '<ans:dataProcessamento>2026-08-05</ans:dataProcessamento>',
  '<ans:relacaoGuias>',
  // Guia CY-001: paga integralmente (R$ 100,00)
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-001</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>100.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>100.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>100.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>0.00</ans:valorGlosaGuia>',
  '</ans:guiaCabecalho>',
  // Guia CY-002: glosa parcial (R$ 50 de R$ 200)
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-002</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>200.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>150.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>150.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>50.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>A010</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Valor acima do autorizado</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  // Guia CY-003: glosa total (R$ 300)
  '<ans:guiaCabecalho>',
  '<ans:numeroGuiaPrestador>CY-003</ans:numeroGuiaPrestador>',
  '<ans:valorInformadoGuia>300.00</ans:valorInformadoGuia>',
  '<ans:valorProcessadoGuia>0.00</ans:valorProcessadoGuia>',
  '<ans:valorLiberadoGuia>0.00</ans:valorLiberadoGuia>',
  '<ans:valorGlosaGuia>300.00</ans:valorGlosaGuia>',
  '<ans:glosas>',
  '<ans:glosa>',
  '<ans:codigoGlosa>B015</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Procedimento nao coberto</ans:descricaoGlosa>',
  '</ans:glosa>',
  '<ans:glosa>',
  '<ans:codigoGlosa>C020</ans:codigoGlosa>',
  '<ans:descricaoGlosa>Guia vencida</ans:descricaoGlosa>',
  '</ans:glosa>',
  '</ans:glosas>',
  '</ans:guiaCabecalho>',
  '</ans:relacaoGuias>',
  '</ans:demonstrativoAnaliseConta>',
  '</ans:operadoraParaPrestador>',
  '<ans:epilogo><ans:hash>abc</ans:hash></ans:epilogo>',
  '</ans:mensagemTISS>',
].join('\n');

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('importDemonstrativo', () => {
  let s: SementeDemonstrativo;
  let actor: Actor;

  beforeAll(async () => {
    s = await semearDemonstrativo();
    actor = {
      kind: 'user',
      tenantId: s.tenantId,
      userId: s.userId,
      clinicId: s.clinicId,
      requestId: uuidv7(),
    };
  });

  afterAll(async () => {
    await closePools();
  });

  it('importa demonstrativo com 3 guias, vincula guias e transiciona lote para retornado', async () => {
    const xmlBytes = encodeIso8859(DEMONSTRATIVO_XML).bytes;

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(
        tx,
        { xml: xmlBytes, operadoraId: s.operadoraId, xmlStorageKey: 'demo/int-001.xml', loteId: s.loteId },
        s.userId,
      ),
    );

    // Resultado de sucesso
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.itemCount).toBe(3);
    expect(result.value.matchedCount).toBe(3);
    expect(result.value.totalGlosaCents).toBe(35000); // 0 + 5000 + 30000

    const demoId = result.value.demonstrativoId;

    // --- Verificar tiss.demonstrativo (colunas canonicas do bloco 01) ---
    const demoRow = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        lote_id: string;
        protocolo_operadora: string;
        kind: string;
        total_apresentado_cents: string;
        total_processado_cents: string;
        total_liberado_cents: string;
        total_glosa_cents: string;
      }>(
        `SELECT id, lote_id, protocolo_operadora, kind,
                total_apresentado_cents, total_processado_cents,
                total_liberado_cents, total_glosa_cents
           FROM tiss.demonstrativo WHERE id = $1`,
        [demoId],
      );
      return rows[0];
    });

    expect(demoRow).toBeDefined();
    expect(demoRow!.lote_id).toBe(s.loteId);
    expect(demoRow!.protocolo_operadora).toBe('PROT-001');
    expect(demoRow!.kind).toBe('analise');
    expect(Number(demoRow!.total_apresentado_cents)).toBe(60000);
    expect(Number(demoRow!.total_processado_cents)).toBe(25000);
    expect(Number(demoRow!.total_glosa_cents)).toBe(35000);

    // --- Verificar tiss.demonstrativo_item (colunas canonicas do bloco 01) ---
    const items = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        guia_id: string | null;
        numero_guia_prestador: string;
        valor_apresentado_cents: string;
        valor_processado_cents: string;
        valor_glosa_cents: string;
        glosa_codigo: string | null;
        glosa_descricao: string | null;
      }>(
        `SELECT guia_id, numero_guia_prestador, valor_apresentado_cents,
                valor_processado_cents, valor_glosa_cents,
                glosa_codigo, glosa_descricao
           FROM tiss.demonstrativo_item
          WHERE demonstrativo_id = $1
          ORDER BY numero_guia_prestador`,
        [demoId],
      );
      return rows;
    });

    expect(items).toHaveLength(3);

    // CY-001: paga, sem glosa, vinculada
    expect(items[0]!.numero_guia_prestador).toBe('CY-001');
    expect(items[0]!.guia_id).toBe(s.guiaIds[0]);
    expect(Number(items[0]!.valor_apresentado_cents)).toBe(10000);
    expect(Number(items[0]!.valor_glosa_cents)).toBe(0);
    expect(items[0]!.glosa_codigo).toBeNull();

    // CY-002: glosa parcial, vinculada (primeiro codigo de glosa armazenado)
    expect(items[1]!.numero_guia_prestador).toBe('CY-002');
    expect(items[1]!.guia_id).toBe(s.guiaIds[1]);
    expect(Number(items[1]!.valor_apresentado_cents)).toBe(20000);
    expect(Number(items[1]!.valor_processado_cents)).toBe(15000);
    expect(Number(items[1]!.valor_glosa_cents)).toBe(5000);
    expect(items[1]!.glosa_codigo).toBe('A010');
    expect(items[1]!.glosa_descricao).toBe('Valor acima do autorizado');

    // CY-003: glosa total, vinculada (primeiro codigo de glosa armazenado)
    expect(items[2]!.numero_guia_prestador).toBe('CY-003');
    expect(items[2]!.guia_id).toBe(s.guiaIds[2]);
    expect(Number(items[2]!.valor_apresentado_cents)).toBe(30000);
    expect(Number(items[2]!.valor_processado_cents)).toBe(0);
    expect(Number(items[2]!.valor_glosa_cents)).toBe(30000);
    expect(items[2]!.glosa_codigo).toBe('B015');
    expect(items[2]!.glosa_descricao).toBe('Procedimento nao coberto pelo plano');

    // --- Verificar transicao do lote para 'retornado' ---
    const loteStatus = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ status: string }>(
        `SELECT status FROM tiss.lote WHERE id = $1`,
        [s.loteId],
      );
      return rows[0]!.status;
    });

    expect(loteStatus).toBe('retornado');
  });

  it('importa demonstrativo sem loteId e nao altera nenhum lote', async () => {
    // Cria XML com guia que NAO existe no banco (sem vinculo)
    const xmlOrfa = [
      '<?xml version="1.0" encoding="ISO-8859-1"?>',
      '<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas">',
      '<ans:cabecalho><ans:versaoPadrao>4.01.00</ans:versaoPadrao>',
      '<ans:registroANS>999999</ans:registroANS>',
      '<ans:dataGeracao>2026-08-06</ans:dataGeracao>',
      '<ans:horaGeracao>11:00:00</ans:horaGeracao>',
      '<ans:sequencialTransacao>2</ans:sequencialTransacao></ans:cabecalho>',
      '<ans:operadoraParaPrestador>',
      '<ans:demonstrativoAnaliseConta>',
      '<ans:cabecalhoDemonstrativo>',
      '<ans:registroANS>326305</ans:registroANS>',
      '<ans:numeroDemonstrativo>DEMO-ORFA</ans:numeroDemonstrativo>',
      '</ans:cabecalhoDemonstrativo>',
      '<ans:dadosProtocolo><ans:numeroProtocolo>P-ORFA</ans:numeroProtocolo></ans:dadosProtocolo>',
      '<ans:dataProcessamento>2026-08-06</ans:dataProcessamento>',
      '<ans:relacaoGuias>',
      '<ans:guiaCabecalho>',
      '<ans:numeroGuiaPrestador>INEXISTENTE-999</ans:numeroGuiaPrestador>',
      '<ans:valorInformadoGuia>500.00</ans:valorInformadoGuia>',
      '<ans:valorProcessadoGuia>0.00</ans:valorProcessadoGuia>',
      '<ans:valorLiberadoGuia>0.00</ans:valorLiberadoGuia>',
      '<ans:valorGlosaGuia>500.00</ans:valorGlosaGuia>',
      '</ans:guiaCabecalho>',
      '</ans:relacaoGuias>',
      '</ans:demonstrativoAnaliseConta>',
      '</ans:operadoraParaPrestador>',
      '<ans:epilogo><ans:hash>orfa</ans:hash></ans:epilogo>',
      '</ans:mensagemTISS>',
    ].join('\n');

    const xmlBytes = encodeIso8859(xmlOrfa).bytes;

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, { xml: xmlBytes, operadoraId: s.operadoraId, xmlStorageKey: 'demo/orfa.xml' }, s.userId),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.itemCount).toBe(1);
    expect(result.value.matchedCount).toBe(0); // guia nao encontrada
    expect(result.value.totalGlosaCents).toBe(50000);

    // Item inserido com guia_id NULL
    const items = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ guia_id: string | null }>(
        `SELECT guia_id FROM tiss.demonstrativo_item
          WHERE demonstrativo_id = $1`,
        [result.value.demonstrativoId],
      );
      return rows;
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.guia_id).toBeNull();
  });

  it('retorna erro xml_invalido para XML malformado', async () => {
    const xmlInvalido = new TextEncoder().encode('isso nao e xml');

    const result = await withTenantTx(actor, (tx) =>
      importDemonstrativo(tx, { xml: xmlInvalido, operadoraId: s.operadoraId, xmlStorageKey: 'demo/invalid.xml' }, s.userId),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('xml_invalido');
  });
});
```

- [ ] **Passo 2** — adicionar exports ao `packages/tiss/src/index.ts`. Adicionar ao final do arquivo existente:

```ts
// --- Demonstrativo (Fase 5) ---
export {
  parseDemonstrativoXml,
  decodeIso8859,
  type ParsedDemonstrativo,
  type ParsedDemonstrativoCabecalho,
  type ParsedDemonstrativoItem,
  type ParsedDemonstrativoGlosa,
} from './demonstrativo/parse-demonstrativo';

export {
  importDemonstrativo,
  type ImportDemonstrativoInput,
  type ImportDemonstrativoResult,
  type ImportDemonstrativoFailure,
} from './demonstrativo/import-demonstrativo';
```

- [ ] **Passo 3** — rodar os testes unitarios (o teste de integracao depende das migrations do bloco 01):

```bash
pnpm vitest run packages/tiss/src/demonstrativo/parse-demonstrativo.test.ts
```

Saida esperada: `Tests: 10 passed`.

- [ ] **Passo 4** — rodar o teste de integracao (requer migrations do bloco 01 aplicadas e DATABASE_URL_ADMIN configurado):

```bash
pnpm vitest run packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts
```

Saida esperada: `Tests: 3 passed` (apos aplicacao das migrations do bloco 01-demonstrativo-migrations).

- [ ] **Passo 5** — commitar:

```bash
git add packages/tiss/src/demonstrativo/import-demonstrativo.int.test.ts \
       packages/tiss/src/index.ts
git commit -m "test(tiss): add importDemonstrativo integration test and export demonstrativo API"
```
