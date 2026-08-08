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
