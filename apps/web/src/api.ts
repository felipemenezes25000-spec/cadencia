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

/**
 * URL base da API. Vazia significa mesma origem — e é a unica forma que funciona:
 *
 * - O navegador so aceita cookie `__Host-` quando ele vem da MESMA origem da
 *   pagina, e o `__Host-cadencia_csrf` e parte da defesa contra login CSRF.
 *   Apontar a API para outro host quebraria o prefixo `__Host-` por design do
 *   navegador, e o login deixa de funcionar.
 * - HTTPS do Vercel NAO conversa com HTTP da API por causa do Mixed Content.
 *   A unica saida e o navegador chamar `/v1/*` no proprio Vercel e o rewrite
 *   do `next.config.ts` repassar para a API real.
 *
 * Configurar `NEXT_PUBLIC_API_URL` so faz sentido em desenvolvimento, quando
 * Next e API estao em portas diferentes na mesma maquina — e mesmo assim so
 * se o dev tiver HTTPS local configurado. Em producao, manter VAZIO.
 */
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
  // 204 não tem corpo POR DEFINIÇÃO, e `json()` de corpo vazio estoura
  // SyntaxError. O estouro viria DEPOIS de o servidor ter feito a operação:
  // quem chamou leria "não foi possível" e tentaria de novo um DELETE que já
  // aconteceu. Sucesso sem conteúdo é `null`, não exceção.
  if (resposta.status === 204) return null as T;
  return await resposta.json() as T;
}

/**
 * Busca um binário (PDF, XML) e devolve uma URL de blob para abrir em aba nova.
 *
 * Existe porque `<a href="/v1/documentos/.../pdf">` NÃO funciona: a navegação do
 * navegador não carrega o cabeçalho `x-clinic-id`, e a API responde 400. Baixar
 * com os cabeçalhos certos e entregar um blob resolve sem afrouxar o contrato da
 * API — que continua exigindo a unidade explicitamente, e não adivinhando qual
 * das unidades do usuário ele quis.
 *
 * Quem chama é dono da URL: `URL.revokeObjectURL` só pode acontecer depois que a
 * aba que a abriu terminar de ler, então não revogamos aqui.
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
