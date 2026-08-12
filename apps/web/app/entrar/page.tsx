'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle,
  Eye,
  EyeSlash,
  Fingerprint,
  Hospital,
  Pulse,
  ShieldCheck,
  Stethoscope,
  Timer,
} from '@phosphor-icons/react';
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

const BENFITS = [
  { icon: Hospital, label: 'Agenda integrada', desc: 'Horário, paciente e prontuário em um só lugar' },
  { icon: Timer, label: 'Operação em tempo real', desc: 'Status atualizado para toda a equipe' },
  { icon: ShieldCheck, label: 'Dados protegidos', desc: 'Criptografia e LGPD em todas as etapas' },
];

export default function PaginaEntrar() {
  const [passo, setPasso] = useState<Passo>({ nome: 'credenciais' });
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mostrarSenha, setMostrarSenha] = useState(false);

  useEffect(() => {
    void apiFetch('/v1/sessao', { clinicId: '', csrfToken: '' }).catch(() => undefined);
  }, []);

  async function seguirCom(vinculos: Vinculo[]) {
    if (vinculos.length === 1 && vinculos[0] !== undefined) {
      await apiFetch('/v1/sessao/unidade', {
        method: 'POST', body: { clinicId: vinculos[0].clinicId },
        clinicId: '', csrfToken: lerCsrf() });
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
    <main id="conteudo-principal" className="grid min-h-screen bg-canvas">
      {/* Desktop: Split layout */}
      <div className="hidden min-h-screen lg:grid lg:grid-cols-[1fr_520px]">

        {/* Left Panel - Branding */}
        <aside className="relative flex flex-col justify-between overflow-hidden bg-brand p-12">
          {/* Animated background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-white blur-3xl" />
            <div className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-white blur-3xl" />
            <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20 blur-3xl" />
          </div>

          {/* Grid pattern overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />

          {/* Logo */}
          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-white/20 backdrop-blur-sm">
                <Pulse size={26} weight="bold" className="text-white" />
              </div>
              <div>
                <p className="text-xl font-bold tracking-tight text-white">Cadencia</p>
                <p className="text-[10px] font-bold uppercase tracking-[.15em] text-white/60">Clinical OS</p>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="relative z-10 my-auto max-w-lg">
            <p className="text-xs font-bold uppercase tracking-[.15em] text-brand-soft">Sistema de gestão clínica</p>
            <h1 className="mt-4 text-4xl font-bold leading-tight tracking-[-0.03em] text-white">
              O controle que sua clínica precisa
            </h1>
            <p className="mt-5 text-base leading-relaxed text-white/75">
              Operação, atendimento e gestão financeira integrados em uma única plataforma. Menos retrabalho, mais cuidado.
            </p>

            {/* Benefits */}
            <div className="mt-10 space-y-4">
              {BENFITS.map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-start gap-4">
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/10 backdrop-blur-sm">
                    <Icon size={20} weight="duotone" className="text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">{label}</p>
                    <p className="mt-0.5 text-sm text-white/60">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="relative z-10 flex items-center justify-between text-sm text-white/40">
            <p>© 2026 Cadencia · Todos os direitos reservados</p>
            <p>LGPD Compliant</p>
          </div>
        </aside>

        {/* Right Panel - Login Form */}
        <div className="flex items-center justify-center bg-surface p-10">
          <div className="w-full max-w-[400px]">
            <FormContent
              passo={passo}
              email={email}
              setEmail={setEmail}
              senha={senha}
              setSenha={setSenha}
              codigo={codigo}
              setCodigo={setCodigo}
              erro={erro}
              setErro={setErro}
              enviando={enviando}
              mostrarSenha={mostrarSenha}
              setMostrarSenha={setMostrarSenha}
              onEntrar={entrar}
              onConfirmarMfa={confirmarMfa}
            />
          </div>
        </div>
      </div>

      {/* Mobile: Single column */}
      <div className="flex min-h-screen flex-col lg:hidden">
        {/* Header */}
        <header className="border-b border-border bg-surface p-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-brand text-white">
              <Pulse size={22} weight="bold" />
            </div>
            <div>
              <p className="font-bold">Cadencia</p>
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-text-tertiary">Clinical OS</p>
            </div>
          </div>
        </header>

        {/* Form */}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-[380px]">
            <FormContent
              passo={passo}
              email={email}
              setEmail={setEmail}
              senha={senha}
              setSenha={setSenha}
              codigo={codigo}
              setCodigo={setCodigo}
              erro={erro}
              setErro={setErro}
              enviando={enviando}
              mostrarSenha={mostrarSenha}
              setMostrarSenha={setMostrarSenha}
              onEntrar={entrar}
              onConfirmarMfa={confirmarMfa}
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-border bg-surface-subtle p-5">
          <div className="flex items-center justify-center gap-6 text-xs text-text-tertiary">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={14} weight="fill" className="text-success" />
              Dados protegidos
            </span>
            <span>·</span>
            <span>LGPD</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

interface FormContentProps {
  passo: Passo;
  email: string;
  setEmail: (v: string) => void;
  senha: string;
  setSenha: (v: string) => void;
  codigo: string;
  setCodigo: (v: string) => void;
  erro: string | null;
  setErro: (e: string | null) => void;
  enviando: boolean;
  mostrarSenha: boolean;
  setMostrarSenha: (v: boolean) => void;
  onEntrar: (e: React.FormEvent) => void;
  onConfirmarMfa: (e: React.FormEvent) => void;
}

function FormContent({
  passo,
  email,
  setEmail,
  senha,
  setSenha,
  codigo,
  setCodigo,
  erro,
  setErro,
  enviando,
  mostrarSenha,
  setMostrarSenha,
  onEntrar,
  onConfirmarMfa,
}: FormContentProps) {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-[-0.025em] text-text-primary">
          {passo.nome === 'credenciais' ? 'Bem-vindo de volta'
            : passo.nome === 'mfa' ? 'Verificação de segurança'
            : 'Escolha a unidade'}
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          {passo.nome === 'credenciais' ? 'Entre com suas credenciais para continuar'
            : passo.nome === 'mfa' ? 'Digite o código do seu autenticador'
            : 'Selecione onde você vai trabalhar'}
        </p>
      </header>

      {passo.nome === 'credenciais' && (
        <form onSubmit={(e) => { void onEntrar(e); }} className="space-y-5">
          <Campo
            rotulo="E-mail"
            type="email"
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
            autoComplete="username"
            autoFocus
            required
            prefixo={<span className="text-text-tertiary">@</span>}
          />
          <div className="relative">
            <Campo
              rotulo="Senha"
              type={mostrarSenha ? 'text' : 'password'}
              value={senha}
              onChange={(evento) => setSenha(evento.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setMostrarSenha(!mostrarSenha)}
              className="absolute bottom-3 right-3 rounded p-1 text-text-tertiary hover:text-text transition-colors"
              aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {mostrarSenha ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <Botao type="submit" carregando={enviando} fullWidth tamanho="lg">
            Entrar
          </Botao>
        </form>
      )}

      {passo.nome === 'mfa' && (
        <form onSubmit={(e) => { void onConfirmarMfa(e); }} className="space-y-5">
          <div className="flex items-center gap-3 rounded-lg bg-info-soft p-4">
            <Fingerprint size={24} className="text-info" weight="duotone" />
            <div>
              <p className="text-sm font-medium text-info">Autenticação em duas etapas</p>
              <p className="mt-0.5 text-xs text-info/80">Abra o app autenticador e digite o código</p>
            </div>
          </div>
          <Campo
            rotulo="Código de verificação"
            type="text"
            value={codigo}
            onChange={(evento) => setCodigo(evento.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="one-time-code"
            inputMode="numeric"
            autoFocus
            required
            placeholder="000000"
          />
          <Botao type="submit" carregando={enviando} disabled={codigo.length !== 6} fullWidth tamanho="lg">
            Verificar
          </Botao>
        </form>
      )}

      {passo.nome === 'unidade' && (
        <div className="space-y-3">
          {passo.vinculos.map((v) => (
            <button
              key={v.clinicId}
              type="button"
              onClick={() => {
                setErro(null);
                void apiFetch('/v1/sessao/unidade', {
                  method: 'POST', body: { clinicId: v.clinicId },
                  clinicId: '', csrfToken: lerCsrf() })
                  .then(() => window.location.assign('/hoje'))
                  .catch((e: unknown) => setErro(mensagem(e)));
              }}
              className="w-full rounded-xl border border-border bg-surface p-4 text-left transition-all hover:border-brand hover:shadow-lg hover:shadow-brand/10"
            >
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-lg bg-brand-soft">
                  <Stethoscope size={20} className="text-brand" weight="duotone" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-text">{v.clinicNome}</p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {v.tenantNome} · {rotulo(v.role)}
                  </p>
                </div>
                <CheckCircle size={20} className="text-brand" weight="fill" />
              </div>
            </button>
          ))}
        </div>
      )}

      {erro !== null && (
        <div role="alert" className="mt-5 rounded-lg bg-danger-soft p-4">
          <p className="text-sm font-medium text-danger">{erro}</p>
        </div>
      )}

      {passo.nome === 'credenciais' && (
        <p className="mt-6 text-center text-xs text-text-tertiary">
          Problemas para acessar?{' '}
          <a href="#" className="font-medium text-brand hover:underline">
            Recupere sua senha
          </a>
        </p>
      )}
    </>
  );
}
