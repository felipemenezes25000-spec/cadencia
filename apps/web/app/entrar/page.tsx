'use client';

import { useEffect, useState, type FormEvent } from 'react';
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

const BENEFICIOS = [
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

  async function entrar(evento: FormEvent) {
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

  async function confirmarMfa(evento: FormEvent) {
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
    <main
      id="conteudo-principal"
      className="relative min-h-screen overflow-hidden bg-[#eaf4ff] text-[#17324d]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 56% 50%, rgba(96, 165, 250, .30), transparent 28%), linear-gradient(135deg, #f3f8ff 0%, #dbeafe 52%, #bfdbfe 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[540px] left-[4%] hidden size-[900px] rounded-full border border-[#60a5fa]/25 shadow-[0_0_90px_rgba(59,130,246,0.13)] lg:block"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[430px] left-[22%] hidden size-[760px] rounded-full border border-white/45 lg:block"
      />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[minmax(0,1.15fr)_minmax(500px,0.85fr)]">
        <aside className="hidden min-h-screen flex-col px-12 py-10 lg:flex xl:px-16 xl:py-12">
          <Marca />

          <div className="my-auto max-w-[670px] py-14">
            <p className="text-xs font-bold uppercase tracking-[.28em] text-[#52708f]">
              Sistema de gestão clínica
            </p>
            <h1 className="mt-5 max-w-[650px] text-5xl font-bold leading-[1.04] tracking-[-0.045em] text-[#17324d] xl:text-6xl">
              O controle que sua <span className="text-[#2563eb]">clínica</span> precisa
            </h1>
            <p className="mt-6 max-w-[610px] text-base leading-7 text-[#4f6f8e] xl:text-lg xl:leading-8">
              Operação, atendimento e gestão financeira integrados em uma única plataforma.
              Menos retrabalho, mais cuidado.
            </p>

            <div className="mt-10 space-y-5">
              {BENEFICIOS.map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-center gap-4">
                  <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-[#93c5fd]/55 bg-white/65 shadow-[0_12px_30px_rgba(30,64,175,0.08)] backdrop-blur-sm">
                    <Icon size={22} weight="duotone" className="text-[#2563eb]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#17324d]">{label}</p>
                    <p className="mt-1 text-sm text-[#607b96]">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-6 text-xs text-[#6b829a] xl:text-sm">
            <div className="flex items-center gap-2 rounded-xl border border-[#93c5fd]/55 bg-white/55 px-4 py-2.5 backdrop-blur-sm">
              <ShieldCheck size={17} weight="duotone" className="text-[#2563eb]" />
              <span>LGPD Compliant</span>
            </div>
            <p>© 2026 Cadência · Todos os direitos reservados</p>
          </div>
        </aside>

        <section className="flex min-h-screen items-center justify-center bg-[#f7fbff]/85 px-4 py-7 text-[#17324d] backdrop-blur-[2px] sm:px-6 lg:px-10 lg:py-10">
          <div className="w-full max-w-[570px]">
            <div className="mb-6 flex justify-center lg:hidden">
              <Marca compacta />
            </div>

            <div className="rounded-[28px] border border-white bg-white p-6 shadow-[0_30px_85px_rgba(30,64,175,0.16)] sm:p-9 lg:rounded-[34px] lg:p-11 xl:p-12">
              <div className="mx-auto mb-7 grid size-[88px] place-items-center rounded-full bg-[#3b82f6]/10 ring-8 ring-[#60a5fa]/10">
                <div className="grid size-[64px] place-items-center rounded-full bg-gradient-to-br from-[#60a5fa] to-[#2563eb] shadow-[0_12px_28px_rgba(37,99,235,0.28)]">
                  <Pulse size={34} weight="bold" className="text-white" />
                </div>
              </div>

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

            <div className="mt-5 flex items-center justify-center gap-2 text-xs text-[#6d8298] lg:hidden">
              <ShieldCheck size={15} weight="fill" className="text-[#2563eb]" />
              Dados protegidos · LGPD
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Marca({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`${compacta ? 'size-11 rounded-xl' : 'size-12 rounded-[14px]'} grid place-items-center border border-[#93c5fd]/60 bg-[#3b82f6] shadow-[0_12px_28px_rgba(37,99,235,0.20)]`}>
        <Pulse size={compacta ? 24 : 27} weight="bold" className="text-white" />
      </div>
      <div>
        <p className={`${compacta ? 'text-lg' : 'text-xl'} font-bold tracking-[-0.03em] text-[#17324d]`}>Cadência</p>
        <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[.28em] text-[#607b96]">Clinical OS</p>
      </div>
    </div>
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
  onEntrar: (e: FormEvent) => void;
  onConfirmarMfa: (e: FormEvent) => void;
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
      <header className="mb-8 text-center">
        {passo.nome === 'credenciais' ? (
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-[#17324d] sm:text-[30px]">
            Bem-<span className="text-[#2563eb]">vindo</span> de volta
          </h1>
        ) : (
          <h1 className="text-2xl font-bold tracking-[-0.03em] text-[#17324d] sm:text-[28px]">
            {passo.nome === 'mfa' ? 'Verificação de segurança' : 'Escolha a unidade'}
          </h1>
        )}
        <p className="mt-2 text-sm text-[#70869c]">
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
            prefixo={<span className="font-medium text-[#70869c]">@</span>}
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
              className="absolute bottom-3 right-3 grid size-8 place-items-center rounded-lg text-[#70869c] transition-colors hover:bg-[#edf5ff] hover:text-[#2563eb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]/30"
              aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {mostrarSenha ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="pt-1">
            <Botao type="submit" carregando={enviando} fullWidth tamanho="lg">
              Entrar
            </Botao>
          </div>
        </form>
      )}

      {passo.nome === 'mfa' && (
        <form onSubmit={(e) => { void onConfirmarMfa(e); }} className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl border border-[#93c5fd]/45 bg-[#eff6ff] p-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-white shadow-sm">
              <Fingerprint size={23} className="text-[#2563eb]" weight="duotone" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1d4ed8]">Autenticação em duas etapas</p>
              <p className="mt-0.5 text-xs text-[#536d87]">Abra o app autenticador e digite o código</p>
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
              className="w-full rounded-xl border border-[#d5e4f5] bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#60a5fa] hover:shadow-[0_12px_28px_rgba(37,99,235,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]/25"
            >
              <div className="flex items-center gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-[#e8f1ff]">
                  <Stethoscope size={21} className="text-[#2563eb]" weight="duotone" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[#17324d]">{v.clinicNome}</p>
                  <p className="mt-0.5 truncate text-xs text-[#70869c]">
                    {v.tenantNome} · {rotulo(v.role)}
                  </p>
                </div>
                <CheckCircle size={20} className="shrink-0 text-[#3b82f6]" weight="fill" />
              </div>
            </button>
          ))}
        </div>
      )}

      {erro !== null && (
        <div role="alert" className="mt-5 rounded-xl border border-[#ef6370]/20 bg-[#fff0f2] px-4 py-3.5">
          <p className="text-sm font-medium text-[#d44d5b]">{erro}</p>
        </div>
      )}

      {passo.nome === 'credenciais' && (
        <div className="mt-7 border-t border-[#e6edf5] pt-6 text-center">
          <p className="text-xs leading-5 text-[#7b8fa4]">
            Problemas para acessar?{' '}
            <span className="font-semibold text-[#536d87]">Fale com a administração da sua clínica.</span>
          </p>
        </div>
      )}
    </>
  );
}
