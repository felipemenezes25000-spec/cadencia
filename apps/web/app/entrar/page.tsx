'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../src/api';
import { lerCsrf, rotulo, type Vinculo } from '../../src/sessao';

interface RespostaLogin {
  userId: string;
  precisaMfa: boolean;
  vinculos: Vinculo[];
}

type Passo =
  | { nome: 'credenciais' }
  | { nome: 'mfa'; vinculos: Vinculo[] }
  | { nome: 'unidade'; vinculos: Vinculo[] };

/** Erros do servidor são NOMES; o texto de tela mora aqui e só aqui. */
const TEXTO: Record<string, string> = {
  credenciais_invalidas: 'E-mail ou senha não conferem.',
  conta_bloqueada: 'Conta bloqueada por tentativas seguidas. Tente de novo em 15 minutos.',
  csrf_invalido: 'Sua sessão expirou. Recarregue a página.',
  codigo_invalido: 'Código inválido.',
  codigo_reutilizado: 'Esse código já foi usado. Espere o próximo.',
  nao_cadastrado: 'Não há segundo fator cadastrado nesta conta.',
  sem_vinculo_na_unidade: 'Você não tem acesso a esta unidade.',
};

function mensagem(e: unknown): string {
  if (e instanceof ApiError) return TEXTO[e.codigo] ?? 'Não foi possível continuar.';
  return 'Sem conexão com o servidor.';
}

export default function PaginaEntrar() {
  const [passo, setPasso] = useState<Passo>({ nome: 'credenciais' });
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Uma leitura antes do primeiro POST: é ela que faz o servidor emitir o
  // cookie de CSRF. Sem isso o login do primeiro acesso cai em 403 — o
  // navegador não tem como fabricar um cookie com prefixo __Host-.
  useEffect(() => {
    void apiFetch('/v1/sessao', { clinicId: '', csrfToken: '' }).catch(() => undefined);
  }, []);

  async function seguirCom(vinculos: Vinculo[]) {
    if (vinculos.length === 1 && vinculos[0] !== undefined) {
      await apiFetch('/v1/sessao/unidade', {
        method: 'POST', body: { clinicId: vinculos[0].clinicId },
        clinicId: '', csrfToken: lerCsrf() });
      // Recarga completa em vez de router.replace: o SessaoProvider só consulta
      // GET /v1/sessao ao montar, e navegar por cliente o deixaria com o estado
      // "anônimo" da carga anterior -- ele devolveria o usuário para cá em
      // seguida. Recarregar após autenticar também garante estado limpo.
      window.location.assign('/hoje');
      return;
    }
    setPasso({ nome: 'unidade', vinculos });
  }

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await apiFetch<RespostaLogin>('/v1/sessao', {
        method: 'POST', body: { email, senha }, clinicId: '', csrfToken: lerCsrf() });
      if (r.precisaMfa) setPasso({ nome: 'mfa', vinculos: r.vinculos });
      else await seguirCom(r.vinculos);
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarMfa(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await apiFetch('/v1/sessao/mfa', {
        method: 'POST', body: { codigo }, clinicId: '', csrfToken: lerCsrf() });
      if (passo.nome === 'mfa') await seguirCom(passo.vinculos);
    } catch (e) {
      setErro(mensagem(e));
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm">
        <header className="mb-8">
          <p className="font-doc text-2xl font-semibold tracking-tight">Cadencia</p>
          <p className="mt-1 text-sm text-text-muted">
            {passo.nome === 'credenciais' ? 'Entre para começar o dia.'
              : passo.nome === 'mfa' ? 'Confirme com o código do seu aplicativo.'
              : 'Escolha a unidade.'}
          </p>
        </header>

        {passo.nome === 'credenciais' && (
          <form onSubmit={(e) => { void entrar(e); }} className="flex flex-col gap-4">
            <Campo
              id="email" rotulo="E-mail" tipo="email" valor={email}
              aoMudar={setEmail} autoComplete="username" autoFocus
            />
            <Campo
              id="senha" rotulo="Senha" tipo="password" valor={senha}
              aoMudar={setSenha} autoComplete="current-password"
            />
            <Botao enviando={enviando}>Entrar</Botao>
          </form>
        )}

        {passo.nome === 'mfa' && (
          <form onSubmit={(e) => { void confirmarMfa(e); }} className="flex flex-col gap-4">
            <Campo
              id="codigo" rotulo="Código de 6 dígitos" tipo="text" valor={codigo}
              aoMudar={(v) => setCodigo(v.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code" inputMode="numeric" autoFocus
            />
            <Botao enviando={enviando} desabilitado={codigo.length !== 6}>Confirmar</Botao>
          </form>
        )}

        {passo.nome === 'unidade' && (
          <ul className="flex flex-col gap-2">
            {passo.vinculos.map((v) => (
              <li key={v.clinicId}>
                <button
                  type="button"
                  onClick={() => {
                    setErro(null);
                    void apiFetch('/v1/sessao/unidade', {
                      method: 'POST', body: { clinicId: v.clinicId },
                      clinicId: '', csrfToken: lerCsrf() })
                      .then(() => window.location.assign('/hoje'))
                      .catch((e: unknown) => setErro(mensagem(e)));
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
        )}

        {erro !== null && (
          <p role="alert" className="mt-4 text-sm text-danger">{erro}</p>
        )}
      </div>
    </div>
  );
}

function Campo({ id, rotulo: texto, tipo, valor, aoMudar, ...resto }: {
  id: string; rotulo: string; tipo: string; valor: string;
  aoMudar: (v: string) => void;
  autoComplete?: string; autoFocus?: boolean; inputMode?: 'numeric';
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{texto}</label>
      <input
        id={id} type={tipo} value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        required
        className="h-10 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
        {...resto}
      />
    </div>
  );
}

function Botao({ children, enviando, desabilitado }: {
  children: React.ReactNode; enviando: boolean; desabilitado?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={enviando || desabilitado === true}
      className="mt-1 h-10 rounded-[var(--r-md)] bg-accent text-sm font-medium text-accent-on transition hover:opacity-90 disabled:opacity-50"
    >
      {enviando ? 'Aguarde…' : children}
    </button>
  );
}
