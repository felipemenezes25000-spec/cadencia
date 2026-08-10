export class ApiError extends Error {
  constructor(
    readonly codigo: string,
    readonly status: number,
    readonly dados: Record<string, unknown> = {},
  ) {
    super(codigo);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly clinicId: string;
  readonly csrfToken: string;
  readonly signal?: AbortSignal;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch<T>(caminho: string, opts: ApiOptions): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers = new Headers({ 'x-clinic-id': opts.clinicId });
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  if (MUTANTES.has(method)) headers.set('x-csrf-token', opts.csrfToken);

  const resposta = await fetch(`${BASE}${caminho}`, {
    method,
    headers,
    credentials: 'include',
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({})) as Record<string, unknown>;
    const { erro, ...resto } = corpo;
    throw new ApiError(typeof erro === 'string' ? erro : 'interno', resposta.status, resto);
  }
  // 204 nao tem corpo POR DEFINICAO, e `json()` de corpo vazio estoura
  // SyntaxError. O estouro viria DEPOIS de o servidor ter feito a operacao:
  // quem chamou leria "nao foi possivel" e tentaria de novo um DELETE que ja
  // aconteceu. Sucesso sem conteudo e `null`, nao excecao.
  if (resposta.status === 204) return null as T;
  return await resposta.json() as T;
}

/**
 * Busca um binario (PDF, XML) e devolve uma URL de blob para abrir em aba nova.
 *
 * Existe porque `<a href="/v1/documentos/.../pdf">` NAO funciona: a navegacao do
 * navegador nao carrega o cabecalho `x-clinic-id`, e a API responde 400. Baixar
 * com os cabecalhos certos e entregar um blob resolve sem afrouxar o contrato da
 * API — que continua exigindo a unidade explicitamente, e nao adivinhando qual
 * das unidades do usuario ele quis.
 *
 * Quem chama e dono da URL: `URL.revokeObjectURL` so pode acontecer depois que a
 * aba que a abriu terminar de ler, entao nao revogamos aqui.
 */
export async function apiFetchBlobUrl(
  caminho: string, opts: Omit<ApiOptions, 'body' | 'method'>,
): Promise<string> {
  const resposta = await fetch(`${BASE}${caminho}`, {
    headers: new Headers({ 'x-clinic-id': opts.clinicId }),
    credentials: 'include',
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({})) as Record<string, unknown>;
    const { erro } = corpo;
    throw new ApiError(typeof erro === 'string' ? erro : 'interno', resposta.status);
  }
  return URL.createObjectURL(await resposta.blob());
}
