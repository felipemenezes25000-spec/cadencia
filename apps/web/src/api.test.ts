import { describe, expect, it, vi, afterEach } from 'vitest';
import { apiFetch, ApiError } from './api';

afterEach(() => { vi.restoreAllMocks(); });

describe('cliente da API', () => {
  it('manda o cabecalho da unidade e o CSRF em metodo mutante', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await apiFetch('/v1/pacientes', { method: 'POST', body: { fullName: 'X' },
                                      clinicId: 'c1', csrfToken: 'tok' });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('x-clinic-id')).toBe('c1');
    expect(headers.get('x-csrf-token')).toBe('tok');
    expect(init.credentials).toBe('include');
  });

  it('NAO manda CSRF em GET — cabecalho a mais em leitura e ruido', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await apiFetch('/v1/pacientes?termo=a', { clinicId: 'c1', csrfToken: 'tok' });
    const headers = new Headers((spy.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get('x-csrf-token')).toBeNull();
  });

  it('traduz o erro de dominio em ApiError com o codigo nomeado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ erro: 'horario_ocupado', encaixePossivel: true }),
        { status: 409, headers: { 'content-type': 'application/json' } }));
    await expect(apiFetch('/v1/agenda/agendamentos', { method: 'POST', body: {},
      clinicId: 'c', csrfToken: 't' }))
      .rejects.toMatchObject({ codigo: 'horario_ocupado', status: 409,
                               dados: { encaixePossivel: true } });
  });

  it('204 e sucesso sem corpo — nao pode virar erro de parse', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }));
    // `resposta.json()` num corpo vazio estoura SyntaxError. Como isso acontece
    // DEPOIS de a operacao ter sido feita, quem chamou ve "nao foi possivel" e
    // tenta de novo — enquanto o servidor ja apagou. Vale para todo DELETE.
    await expect(apiFetch('/v1/agenda/bloqueios/abc', {
      method: 'DELETE', clinicId: 'c', csrfToken: 't' })).resolves.toBeNull();
  });

  it('401 vira ApiError sem_sessao, para a casca redirecionar ao login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ erro: 'sem_sessao' }),
        { status: 401, headers: { 'content-type': 'application/json' } }));
    const e = await apiFetch('/v1/whoami', { clinicId: 'c', csrfToken: 't' })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).codigo).toBe('sem_sessao');
  });
});
