'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from './api';

export const CSRF_COOKIE = '__Host-cadencia_csrf';
export const ROTA_ENTRAR = '/entrar';

/**
 * Caminhos que NAO exigem sessao.
 *
 * O provider empurra todo anonimo para `/entrar`. Isso e o certo para o produto
 * inteiro e errado para as duas telas que existem justamente para quem nao tem
 * conta: a de login e a de agendamento online. Um paciente que abre o link da
 * clinica no celular caia num formulario de login e desiste.
 *
 * A lista e de PREFIXOS porque `/agendar/{clinicId}` carrega a unidade na URL.
 */
const PREFIXOS_PUBLICOS = [ROTA_ENTRAR, '/agendar'] as const;

export function ehRotaPublica(caminho: string): boolean {
  return PREFIXOS_PUBLICOS.some(
    (p) => caminho === p || caminho.startsWith(`${p}/`));
}

export interface Vinculo {
  readonly tenantId: string;
  readonly tenantNome: string;
  readonly clinicId: string;
  readonly clinicNome: string;
  readonly timezone: string;
  readonly role: 'admin_clinico' | 'diretor_tecnico' | 'profissional' | 'recepcao' | 'financeiro';
}

export interface QuemSou {
  readonly userId: string;
  readonly email: string;
  readonly nome: string;
  readonly mfaOk: boolean;
  readonly mfaCadastrado: boolean;
  readonly unidadeAtiva: { readonly tenantId: string; readonly clinicId: string } | null;
  readonly vinculos: readonly Vinculo[];
}

export interface Sessao {
  readonly clinicId: string;
  readonly csrfToken: string;
  readonly usuario: QuemSou;
  readonly vinculoAtivo: Vinculo;
  readonly trocarUnidade: (clinicId: string) => Promise<void>;
  readonly sair: () => Promise<void>;
}

const SessaoCtx = createContext<Sessao | null>(null);

export function useSessao(): Sessao {
  const s = useContext(SessaoCtx);
  if (s === null) throw new Error('useSessao fora de SessaoProvider');
  return s;
}

/**
 * O token de CSRF vem do cookie, nao de estado do React. O cookie e emitido
 * com httpOnly:false de proposito (double-submit): o servidor grava, o JS le e
 * reenvia no header. Guardar uma copia em memoria daria uma segunda fonte de
 * verdade que envelhece na hora em que o servidor rotaciona o cookie.
 */
export function lerCsrf(): string {
  if (typeof document === 'undefined') return '';
  for (const parte of document.cookie.split('; ')) {
    const igual = parte.indexOf('=');
    if (igual > 0 && parte.slice(0, igual) === CSRF_COOKIE) {
      return decodeURIComponent(parte.slice(igual + 1));
    }
  }
  return '';
}

type Estado =
  | { fase: 'carregando' }
  | { fase: 'anonimo' }
  | { fase: 'autenticado'; quem: QuemSou };

export function SessaoProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const caminho = usePathname();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });

  const carregar = useCallback(async () => {
    try {
      // O proprio GET emite o cookie de CSRF quando ele nao existe — e por isso
      // que esta chamada precisa vir ANTES de qualquer POST, inclusive o login.
      const quem = await apiFetch<QuemSou>('/v1/sessao', { clinicId: '', csrfToken: '' });
      setEstado({ fase: 'autenticado', quem });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setEstado({ fase: 'anonimo' });
      else setEstado({ fase: 'anonimo' });
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const naTelaDeEntrada = caminho === ROTA_ENTRAR;
  const emRotaPublica = ehRotaPublica(caminho);

  useEffect(() => {
    if (estado.fase === 'anonimo' && !emRotaPublica) router.replace(ROTA_ENTRAR);
    // O caminho inverso importa tanto quanto: quem ja tem sessao e volta para
    // /entrar (link antigo, botao de voltar, aba esquecida) ficaria olhando um
    // formulario de login que nao serve para nada.
    if (estado.fase === 'autenticado' && naTelaDeEntrada
        && estado.quem.unidadeAtiva !== null) {
      router.replace('/hoje');
    }
  }, [estado, naTelaDeEntrada, emRotaPublica, router]);

  const trocarUnidade = useCallback(async (clinicId: string) => {
    await apiFetch('/v1/sessao/unidade', {
      method: 'POST', body: { clinicId }, clinicId: '', csrfToken: lerCsrf() });
    await carregar();
  }, [carregar]);

  const sair = useCallback(async () => {
    await apiFetch('/v1/sessao', {
      method: 'DELETE', clinicId: '', csrfToken: lerCsrf() });
    setEstado({ fase: 'anonimo' });
    router.replace(ROTA_ENTRAR);
  }, [router]);

  const valor = useMemo<Sessao | null>(() => {
    if (estado.fase !== 'autenticado') return null;
    const ativa = estado.quem.unidadeAtiva;
    if (ativa === null) return null;
    const vinculo = estado.quem.vinculos.find((v) => v.clinicId === ativa.clinicId);
    if (vinculo === undefined) return null;
    return {
      clinicId: ativa.clinicId,
      csrfToken: lerCsrf(),
      usuario: estado.quem,
      vinculoAtivo: vinculo,
      trocarUnidade,
      sair,
    };
  }, [estado, trocarUnidade, sair]);

  // Rota publica roda FORA do contexto de sessao. Para a tela de entrada isso e
  // circular por natureza — e ela que cria a sessao. Para o agendamento online e
  // por definicao: quem marca nao tem conta, e nunca vai ter.
  if (emRotaPublica) return <>{children}</>;

  if (estado.fase === 'carregando') return <TelaDeEspera />;
  if (estado.fase === 'anonimo') return <TelaDeEspera />;

  // Autenticado sem unidade escolhida: nenhuma rota do sistema responde sem
  // clinicId, entao a escolha vem antes de qualquer tela.
  if (valor === null) {
    return (
      <EscolhaDeUnidade
        vinculos={estado.quem.vinculos}
        aoEscolher={trocarUnidade}
        nome={estado.quem.nome}
      />
    );
  }

  return <SessaoCtx.Provider value={valor}>{children}</SessaoCtx.Provider>;
}

function TelaDeEspera() {
  return (
    <div className="grid min-h-screen place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-accent" />
        <p className="text-sm text-text-muted">Carregando…</p>
      </div>
    </div>
  );
}

function EscolhaDeUnidade({ vinculos, aoEscolher, nome }: {
  vinculos: readonly Vinculo[];
  aoEscolher: (clinicId: string) => Promise<void>;
  nome: string;
}) {
  const [erro, setErro] = useState<string | null>(null);

  if (vinculos.length === 0) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold">Sem unidade vinculada</h1>
          <p className="mt-2 text-sm text-text-muted">
            {nome}, sua conta existe mas ainda nao tem vinculo com nenhuma clinica.
            Peca a quem administra a clinica para conceder o acesso.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold">Onde voce vai atender hoje?</h1>
        <p className="mt-1 text-sm text-text-muted">
          Voce tem acesso a mais de uma unidade. Cada uma tem agenda, caixa e
          prontuario proprios.
        </p>
        <ul className="mt-5 flex flex-col gap-2">
          {vinculos.map((v) => (
            <li key={v.clinicId}>
              <button
                type="button"
                onClick={() => {
                  setErro(null);
                  void aoEscolher(v.clinicId).catch(() => setErro('Nao foi possivel entrar nesta unidade.'));
                }}
                className="w-full rounded-[var(--r-md)] border border-border bg-surface px-4 py-3 text-left transition hover:border-accent hover:bg-surface-2"
              >
                <span className="block font-medium">{v.clinicNome}</span>
                <span className="block text-xs text-text-muted">
                  {v.tenantNome} · {rotulo(v.role)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {erro !== null && <p className="mt-3 text-sm text-danger">{erro}</p>}
      </div>
    </div>
  );
}

export function rotulo(role: Vinculo['role']): string {
  return role === 'admin_clinico' ? 'Administracao'
    : role === 'diretor_tecnico' ? 'Direcao tecnica'
    : role === 'profissional' ? 'Profissional de saude'
    : role === 'recepcao' ? 'Recepcao'
    : 'Financeiro';
}
