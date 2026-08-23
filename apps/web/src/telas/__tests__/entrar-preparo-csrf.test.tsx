import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * A tela de login depende de um cookie que ela mesma manda emitir.
 *
 * No mount ela dispara `GET /v1/sessao` so para receber o `__Host-cadencia_csrf`,
 * e esse GET responde 401 para quem ainda nao entrou. Ou seja: falhar e o caso
 * NORMAL, e o que separa "tudo certo" de "servidor fora" nao e o status, e se o
 * cookie chegou.
 *
 * A versao anterior engolia a falha com `.catch(() => undefined)`. Quando o
 * rewrite de `/v1/*` nao alcancava a API, o login seguia sem token, a API
 * respondia `csrf_invalido` e a tela dizia "sua sessao expirou. Recarregue a
 * pagina." — mandando o usuario fazer exatamente o que nao resolve, e escondendo
 * uma indisponibilidade atras de uma mensagem de sessao.
 */

vi.mock('../../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api')>();
  return { ...real, apiFetch: vi.fn() };
});

vi.mock('../../sessao', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../sessao')>();
  return { ...real, lerCsrf: vi.fn(() => '') };
});

const { apiFetch } = await import('../../api');
const { lerCsrf } = await import('../../sessao');
const { default: PaginaEntrar } = await import('../../../app/entrar/page');

const SEM_SERVIDOR = 'Sem conexão com o servidor. Tente de novo em instantes.';
const SESSAO_EXPIROU = /sessão expirou/i;

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(lerCsrf).mockReset();
});

describe('preparo do CSRF na tela de login', () => {
  it('sem resposta da API e sem cookie: diz que o servidor esta fora', async () => {
    // Falha de rede/CORS: nao ha resposta, entao nao ha cookie.
    vi.mocked(apiFetch).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(lerCsrf).mockReturnValue('');

    render(<PaginaEntrar />);

    await waitFor(() => {
      expect(screen.getByText(SEM_SERVIDOR)).toBeInTheDocument();
    });
  });

  it('401 de visitante com cookie emitido: nao acusa erro nenhum', async () => {
    // O caso comum: ninguem esta logado, o GET responde 401, o cookie veio.
    const { ApiError } = await import('../../api');
    vi.mocked(apiFetch).mockRejectedValue(new ApiError('nao_autenticado', 401));
    vi.mocked(lerCsrf).mockReturnValue('token-de-teste');

    render(<PaginaEntrar />);

    // Espera o efeito de mount resolver antes de afirmar a ausencia do erro.
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByText(SEM_SERVIDOR)).not.toBeInTheDocument();
  });

  it('nunca troca indisponibilidade por "sua sessao expirou"', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(lerCsrf).mockReturnValue('');

    render(<PaginaEntrar />);

    await waitFor(() => expect(screen.getByText(SEM_SERVIDOR)).toBeInTheDocument());
    // `csrf_invalido` continua valendo para um CSRF de verdade vencido; o que
    // nao pode e servidor inalcancavel chegar ate la e ser traduzido assim.
    expect(screen.queryByText(SESSAO_EXPIROU)).not.toBeInTheDocument();
  });
});
