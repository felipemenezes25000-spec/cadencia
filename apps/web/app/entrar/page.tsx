'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Pulse, ShieldCheck } from '@phosphor-icons/react';
import { apiFetch, ApiError } from '../../src/api';
import { lerCsrf, rotulo, type Vinculo } from '../../src/sessao';
import { Botao } from '../../src/ui/Botao';
import { Campo } from '../../src/ui/Campo';

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
    <main id="conteudo-principal" className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(360px,.85fr)_minmax(520px,1.15fr)]">
      <aside className="hidden border-r border-border bg-surface-subtle p-12 lg:flex lg:flex-col">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-[10px] bg-brand text-white"><Pulse size={22} weight="bold" /></span><div><p className="text-base font-bold tracking-tight">Cadencia</p><p className="text-[10px] font-bold uppercase tracking-[.12em] text-text-tertiary">Clinical Intelligence</p></div></div>
        <div className="my-auto max-w-md">
          <p className="text-xs font-bold uppercase tracking-[.1em] text-brand">Operação clínica conectada</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-[-0.035em] text-text-primary">Clareza para cuidar. Precisão para operar.</h1>
          <p className="mt-4 text-base leading-relaxed text-text-secondary">Agenda, atendimento e prontuário no mesmo fluxo — do paciente que chegou à próxima ação da equipe.</p>
          <ul className="mt-8 space-y-4 text-sm text-text-secondary"><li className="flex items-center gap-3"><CheckCircle size={19} weight="fill" className="text-success" />Operação da unidade em tempo real</li><li className="flex items-center gap-3"><CheckCircle size={19} weight="fill" className="text-success" />Prontuário clínico estruturado</li><li className="flex items-center gap-3"><ShieldCheck size={19} weight="fill" className="text-brand" />Acesso seguro e auditável</li></ul>
        </div>
        <p className="text-xs text-text-tertiary">Ambiente clínico protegido · Cadencia 2026</p>
      </aside>

      <div className="grid place-items-center p-6 sm:p-10">
        <div className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-6 shadow-elev-1 sm:p-8">
          <header className="mb-7">
            <div className="mb-6 flex items-center gap-3 lg:hidden"><span className="grid size-9 place-items-center rounded-lg bg-brand text-white"><Pulse size={20} weight="bold" /></span><p className="font-bold">Cadencia</p></div>
            <h1 className="text-2xl font-bold tracking-[-0.03em] text-text-primary">
              {passo.nome === 'credenciais' ? 'Acesse sua unidade'
                : passo.nome === 'mfa' ? 'Confirme sua identidade'
                : 'Escolha a unidade'}
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              {passo.nome === 'credenciais' ? 'Entre para começar a operação do dia.'
                : passo.nome === 'mfa' ? 'Digite o código do seu aplicativo autenticador.'
                : 'Selecione onde você vai trabalhar agora.'}
            </p>
          </header>

          {passo.nome === 'credenciais' && (
          <form onSubmit={(e) => { void entrar(e); }} className="flex flex-col gap-4">
            <Campo
              rotulo="E-mail" type="email" value={email}
              onChange={(evento) => setEmail(evento.target.value)} autoComplete="username" autoFocus required
            />
            <Campo
              rotulo="Senha" type="password" value={senha}
              onChange={(evento) => setSenha(evento.target.value)} autoComplete="current-password" required
            />
            <Botao type="submit" carregando={enviando} fullWidth>Entrar</Botao>
          </form>
          )}

          {passo.nome === 'mfa' && (
          <form onSubmit={(e) => { void confirmarMfa(e); }} className="flex flex-col gap-4">
            <Campo
              rotulo="Código de 6 dígitos" type="text" value={codigo}
              onChange={(evento) => setCodigo(evento.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code" inputMode="numeric" autoFocus required
            />
            <Botao type="submit" carregando={enviando} disabled={codigo.length !== 6} fullWidth>Confirmar</Botao>
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
            <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger">{erro}</p>
          )}
          <p className="mt-6 text-center text-xs text-text-tertiary">Precisa de ajuda? Fale com a administração da sua clínica.</p>
        </div>
      </div>
    </main>
  );
}
