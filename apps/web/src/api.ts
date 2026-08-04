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
  return await resposta.json() as T;
}
