// packages/tiss/src/demonstrativo/parse-demonstrativo.ts

/**
 * Parser PURO e determinístico de XML de demonstrativo TISS.
 *
 * Recebe o XML em bytes ISO-8859-1 (como retornado por TissTransport.fetchDemonstrativo),
 * decodifica para string e extrai os campos estruturados. Sem I/O, sem side-effects.
 *
 * O parser usa extração por regex para o subset limitado do XSD TISS — DOMParser
 * não existe em Node.js e uma dependência de parser XML completo é desnecessária
 * para o formato previsível e bem definido do demonstrativo TISS 4.01.00.
 */

// ---------------------------------------------------------------------------
// Tipos de saída
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
// Utilidade de decodificação
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

// ---------------------------------------------------------------------------
// Helpers de extração XML por regex
// ---------------------------------------------------------------------------

/**
 * Extrai o conteúdo texto de uma tag folha (sem filhos).
 * Retorna undefined se a tag não for encontrada.
 * O regex aceita tags com ou sem atributos.
 */
function extractTag(xml: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([^<]*)</${escaped}>`);
  const m = xml.match(re);
  return m?.[1];
}

/**
 * Extrai todos os blocos de conteúdo de tags container (com filhos).
 * Usa match lazy para evitar capturar tags irmãs.
 *
 * LIMITAÇÃO: não suporta tags idênticas aninhadas (ex: <a><a>...</a></a>).
 * O formato TISS não tem tags idênticas aninhadas, então esta limitação
 * é aceitável para este parser de subset.
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
 * Converte valor monetário no formato TISS (reais com 2 decimais) para centavos inteiros.
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
 * Função PURA e DETERMINÍSTICA. Recebe bytes ISO-8859-1, decodifica,
 * extrai os campos do demonstrativo de análise de conta ou de pagamento.
 *
 * Lança Error se o XML não contiver nenhum dos dois tipos de demonstrativo.
 */
export function parseDemonstrativoXml(xml: Uint8Array): ParsedDemonstrativo {
  const text = decodeIso8859(xml);

  // Detecta tipo pela presença da tag container
  const isAnalise = text.includes('<ans:demonstrativoAnaliseConta');
  const isPagamento = text.includes('<ans:demonstrativoPagamento');

  if (!isAnalise && !isPagamento) {
    throw new Error(
      'XML não contém demonstrativoAnaliseConta nem demonstrativoPagamento',
    );
  }

  const tipo: 'analise' | 'pagamento' = isAnalise ? 'analise' : 'pagamento';
  const demoTag = isAnalise
    ? 'ans:demonstrativoAnaliseConta'
    : 'ans:demonstrativoPagamento';

  // Extrai o bloco do demonstrativo (pode haver apenas 1 por mensagem TISS)
  const demoBlocks = extractAllBlocks(text, demoTag);
  if (demoBlocks.length === 0) {
    throw new Error(`Bloco <${demoTag}> não encontrado no XML`);
  }
  const demo = demoBlocks[0]!;

  // Cabeçalho — extraído de dentro do bloco demonstrativo, não da mensagem TISS
  const registroANS = extractTag(demo, 'ans:registroANS') ?? '';
  const numeroDemonstrativo = extractTag(demo, 'ans:numeroDemonstrativo') ?? '';
  const dataProcessamento = extractTag(demo, 'ans:dataProcessamento') ?? '';
  const numeroProtocolo = extractTag(demo, 'ans:numeroProtocolo') ?? '';

  // Itens (guias) — cada <ans:guiaCabecalho> é um item
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
