'use client';

import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
import { useSubmitUnico, type ResultadoDeAcao } from '../../src/lib/acao-unica';
import { Botao } from '../../src/ui/Botao';

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

const PILARES = [
  {
    icon: Hospital,
    titulo: 'Agenda conectada',
    descricao: 'O início da jornada já conversa com todo o restante da operação.',
  },
  {
    icon: Stethoscope,
    titulo: 'Cuidado no centro',
    descricao: 'Informação clínica e contexto de atendimento no mesmo ritmo da equipe.',
  },
  {
    icon: Timer,
    titulo: 'Gestão em movimento',
    descricao: 'Uma visão contínua do que precisa acontecer agora e do que vem depois.',
  },
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
        method: 'POST',
        body: { clinicId: vinculos[0].clinicId },
        clinicId: '',
        csrfToken: lerCsrf(),
      });
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
        method: 'POST',
        body: { email, senha },
        clinicId: '',
        csrfToken: lerCsrf(),
      });
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
        method: 'POST',
        body: { codigo },
        clinicId: '',
        csrfToken: lerCsrf(),
      });
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
      className="relative min-h-dvh overflow-hidden bg-[#041719] text-white"
    >
      <FundoAmbiente />

      <div className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1920px] lg:grid-cols-[minmax(0,1.08fr)_minmax(520px,0.92fr)]">
        <aside className="relative hidden min-h-dvh flex-col overflow-hidden px-10 py-9 lg:flex xl:px-16 xl:py-12 2xl:px-20">
          <Marca />

          <div className="my-auto w-full max-w-[760px] py-12 xl:py-16">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[.055] px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[.16em] text-[#b9ece7] shadow-[inset_0_1px_0_rgba(255,255,255,.06)] backdrop-blur-xl">
              <span className="size-1.5 rounded-full bg-[#62d9ce] shadow-[0_0_16px_rgba(98,217,206,.8)]" />
              Clinical operating system
            </div>

            <h1 className="mt-7 max-w-[760px] text-[clamp(3.25rem,5.1vw,6.75rem)] font-semibold leading-[.92] tracking-[-.065em] text-white">
              A clínica inteira,
              <span className="mt-1 block bg-gradient-to-r from-[#d9fffb] via-[#8ce8df] to-[#62d9ce] bg-clip-text text-transparent">
                em perfeita cadência.
              </span>
            </h1>

            <p className="mt-7 max-w-[650px] text-[15px] leading-7 text-white/68 xl:text-[17px] xl:leading-8">
              Da primeira agenda ao fechamento do dia, uma operação clínica contínua,
              clara e feita para a equipe trabalhar no mesmo ritmo.
            </p>

            <PainelProduto />
          </div>

          <div className="flex items-center justify-between gap-8 border-t border-white/8 pt-6 text-xs text-white/58">
            <div className="flex items-center gap-2.5">
              <ShieldCheck size={17} weight="duotone" className="text-[#79ddd4]" />
              <span>Acesso protegido · privacidade em primeiro lugar</span>
            </div>
            <span className="hidden xl:inline">Cadência · Clinical OS</span>
          </div>
        </aside>

        <section className="relative flex min-h-dvh items-center justify-center px-4 py-5 sm:px-7 sm:py-8 lg:px-10 xl:px-16">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[#eef5f3] lg:rounded-l-[44px]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-70 lg:rounded-l-[44px]"
            style={{
              backgroundImage:
                'radial-gradient(circle at 82% 14%, rgba(98,217,206,.26), transparent 28%), radial-gradient(circle at 15% 88%, rgba(8,118,111,.09), transparent 28%)',
            }}
          />

          <div className="relative w-full max-w-[560px]">
            <div className="mb-6 flex items-center justify-between lg:hidden">
              <Marca compacta />
              <div className="flex items-center gap-1.5 rounded-full border border-[#cfe0dd] bg-white/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-[#486466] backdrop-blur-xl">
                <ShieldCheck size={14} weight="fill" className="text-[#08766f]" />
                Seguro
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[30px] border border-white/85 bg-white/[.92] p-5 shadow-[0_34px_100px_rgba(5,35,38,.16),0_8px_24px_rgba(5,35,38,.06)] backdrop-blur-2xl sm:p-8 lg:rounded-[36px] lg:p-10 xl:p-12">
              <div
                aria-hidden="true"
                className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#62d9ce]/75 to-transparent"
              />
              <div
                aria-hidden="true"
                className="absolute -right-24 -top-24 size-56 rounded-full bg-[#62d9ce]/10 blur-3xl"
              />

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

            <div className="mt-5 flex items-center justify-center gap-2 text-[11px] font-medium text-[#587274] lg:hidden">
              <span className="size-1.5 rounded-full bg-[#08766f]" />
              Ambiente restrito a profissionais autorizados
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function FundoAmbiente() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 21% 18%, rgba(98,217,206,.18), transparent 24%), radial-gradient(circle at 49% 82%, rgba(8,118,111,.18), transparent 27%), linear-gradient(135deg,#08272b 0%,#041719 52%,#031113 100%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
          maskImage: 'linear-gradient(to bottom, black, transparent 82%)',
        }}
      />
      <div className="absolute -left-32 top-[28%] size-[560px] rounded-full border border-[#62d9ce]/10" />
      <div className="absolute -left-12 top-[34%] size-[390px] rounded-full border border-white/[.06]" />
      <div className="absolute bottom-[-260px] left-[24%] size-[620px] rounded-full bg-[#08766f]/10 blur-[110px]" />
    </div>
  );
}

function Marca({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className={`flex items-center ${compacta ? 'gap-2.5 text-[#102f31]' : 'gap-3 text-white'}`}>
      <div
        className={`${compacta ? 'size-10 rounded-[13px]' : 'size-11 rounded-[14px]'} relative grid shrink-0 place-items-center overflow-hidden border border-[#8fe5dc]/25 bg-gradient-to-br from-[#72e0d6] via-[#25a99f] to-[#08766f] shadow-[0_12px_28px_rgba(8,118,111,.26)]`}
      >
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1/2 bg-white/10" />
        <Pulse size={compacta ? 22 : 24} weight="bold" className="relative text-white" />
      </div>
      <div>
        <p className={`${compacta ? 'text-[17px]' : 'text-lg'} font-semibold tracking-[-.035em]`}>
          Cadência
        </p>
        <p className={`${compacta ? 'text-[#60787a]' : 'text-white/52'} mt-0.5 text-[8px] font-bold uppercase tracking-[.27em]`}>
          Clinical OS
        </p>
      </div>
    </div>
  );
}

function PainelProduto() {
  return (
    <div
      aria-hidden="true"
      className="relative mt-10 max-w-[700px] overflow-hidden rounded-[28px] border border-white/10 bg-white/[.052] p-3 shadow-[0_30px_80px_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.07)] backdrop-blur-xl xl:mt-12 xl:p-4"
    >
      <div className="rounded-[21px] border border-white/8 bg-[#08262a]/72 p-4 xl:p-5">
        <div className="flex items-center justify-between border-b border-white/8 pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#84ded6]">Um único fluxo</p>
            <p className="mt-1.5 text-sm font-semibold tracking-[-.015em] text-white/92">Da agenda à gestão, sem perder contexto.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#62d9ce]/15 bg-[#62d9ce]/8 px-3 py-1.5 text-[10px] font-semibold text-[#a8eee8]">
            <span className="size-1.5 rounded-full bg-[#62d9ce]" />
            Integrado
          </div>
        </div>

        <div className="grid gap-2.5 pt-4 sm:grid-cols-3">
          {PILARES.map(({ icon: Icon, titulo, descricao }) => (
            <div
              key={titulo}
              className="rounded-[17px] border border-white/[.075] bg-white/[.045] p-3.5 xl:p-4"
            >
              <div className="grid size-9 place-items-center rounded-[11px] border border-[#62d9ce]/15 bg-[#62d9ce]/10 text-[#82e3da]">
                <Icon size={18} weight="duotone" />
              </div>
              <p className="mt-3 text-xs font-semibold text-white/92">{titulo}</p>
              <p className="mt-1.5 text-[10px] leading-[1.55] text-white/52">{descricao}</p>
            </div>
          ))}
        </div>
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
  onEntrar: (e: FormEvent) => ResultadoDeAcao;
  onConfirmarMfa: (e: FormEvent) => ResultadoDeAcao;
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
  // Login repetido cria uma segunda sessão e uma segunda linha de auditoria
  // para a mesma entrada; MFA repetido queima o código antes de o primeiro
  // POST responder.
  const entrarUmaVez = useSubmitUnico(onEntrar);
  const confirmarMfaUmaVez = useSubmitUnico(onConfirmarMfa);

  const titulo = passo.nome === 'credenciais'
    ? 'Bem-vindo de volta.'
    : passo.nome === 'mfa'
      ? 'Confirme sua identidade.'
      : 'Onde vamos trabalhar?';

  const subtitulo = passo.nome === 'credenciais'
    ? 'Entre no seu espaço de trabalho para continuar.'
    : passo.nome === 'mfa'
      ? 'Use o código de 6 dígitos do seu aplicativo autenticador.'
      : 'Escolha a unidade para abrir o ambiente correto.';

  return (
    <div className="relative">
      <header className="mb-8 sm:mb-9">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="grid size-11 place-items-center rounded-[14px] border border-[#cce4e0] bg-[#e7f6f3] text-[#08766f] shadow-[inset_0_1px_0_rgba(255,255,255,.8)]">
            {passo.nome === 'mfa' ? (
              <Fingerprint size={22} weight="duotone" />
            ) : passo.nome === 'unidade' ? (
              <Hospital size={21} weight="duotone" />
            ) : (
              <Pulse size={22} weight="bold" />
            )}
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#d9e6e4] bg-[#f7faf9] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#5b7476]">
            <ShieldCheck size={13} weight="fill" className="text-[#08766f]" />
            Acesso seguro
          </div>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#08766f]">
          {passo.nome === 'credenciais' ? 'Área do profissional' : 'Segurança da sessão'}
        </p>
        <h2 className="mt-2.5 text-[28px] font-semibold leading-tight tracking-[-.045em] text-[#102f31] sm:text-[34px]">
          {titulo}
        </h2>
        <p className="mt-2.5 max-w-[430px] text-sm leading-6 text-[#60787a]">
          {subtitulo}
        </p>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={passo.nome}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {passo.nome === 'credenciais' && (
            <form onSubmit={entrarUmaVez} className="space-y-4.5">
              <CampoAcesso
                rotulo="E-mail"
                type="email"
                value={email}
                onChange={(evento) => setEmail(evento.target.value)}
                onFocus={() => setErro(null)}
                autoComplete="username"
                autoFocus
                required
                placeholder="voce@clinica.com.br"
                prefixo={<span className="text-sm font-semibold text-[#688083]">@</span>}
              />

              <CampoAcesso
                rotulo="Senha"
                type={mostrarSenha ? 'text' : 'password'}
                value={senha}
                onChange={(evento) => setSenha(evento.target.value)}
                onFocus={() => setErro(null)}
                autoComplete="current-password"
                required
                placeholder="Digite sua senha"
                prefixo={<ShieldCheck size={18} weight="duotone" className="text-[#688083]" />}
                sufixo={(
                  <button
                    type="button"
                    onClick={() => setMostrarSenha(!mostrarSenha)}
                    className="grid size-10 shrink-0 place-items-center rounded-xl text-[#60787a] transition-colors hover:bg-[#eaf4f2] hover:text-[#08766f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#08766f]/30"
                    aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {mostrarSenha ? <EyeSlash size={18} /> : <Eye size={18} />}
                  </button>
                )}
              />

              <MensagemErro erro={erro} />

              <div className="pt-1.5">
                <Botao
                  type="submit"
                  carregando={enviando}
                  fullWidth
                  tamanho="lg"
                  className="h-[54px] rounded-[15px] border-[#08766f] bg-[#08766f] text-[15px] shadow-[0_14px_30px_rgba(8,118,111,.22)] hover:bg-[#065f5a] hover:shadow-[0_18px_36px_rgba(8,118,111,.28)]"
                >
                  Entrar no Cadência
                </Botao>
              </div>
            </form>
          )}

          {passo.nome === 'mfa' && (
            <form onSubmit={confirmarMfaUmaVez} className="space-y-5">
              <div className="flex items-start gap-3.5 rounded-[18px] border border-[#cfe4e0] bg-[#edf8f5] p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#08766f] shadow-[0_5px_14px_rgba(8,70,67,.08)]">
                  <Fingerprint size={21} weight="duotone" />
                </div>
                <div className="pt-0.5">
                  <p className="text-sm font-semibold tracking-[-.01em] text-[#173b3d]">Autenticação em duas etapas</p>
                  <p className="mt-1 text-xs leading-5 text-[#60787a]">O código muda rapidamente e só pode ser usado uma vez.</p>
                </div>
              </div>

              <CampoAcesso
                rotulo="Código de verificação"
                type="text"
                value={codigo}
                onChange={(evento) => setCodigo(evento.target.value.replace(/\D/g, '').slice(0, 6))}
                onFocus={() => setErro(null)}
                autoComplete="one-time-code"
                inputMode="numeric"
                autoFocus
                required
                placeholder="000000"
                inputClassName="text-center text-xl font-semibold tracking-[.34em] tabular-nums placeholder:tracking-[.34em]"
              />

              <MensagemErro erro={erro} />

              <Botao
                type="submit"
                carregando={enviando}
                disabled={codigo.length !== 6}
                fullWidth
                tamanho="lg"
                className="h-[54px] rounded-[15px] text-[15px] shadow-[0_14px_30px_rgba(8,118,111,.2)]"
              >
                Confirmar e continuar
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
                      method: 'POST',
                      body: { clinicId: v.clinicId },
                      clinicId: '',
                      csrfToken: lerCsrf(),
                    })
                      .then(() => window.location.assign('/hoje'))
                      .catch((e: unknown) => setErro(mensagem(e)));
                  }}
                  className="group w-full rounded-[18px] border border-[#d3e0de] bg-[#fbfdfc] p-4 text-left shadow-[0_3px_10px_rgba(8,46,48,.03)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#8fc6c0] hover:bg-white hover:shadow-[0_14px_32px_rgba(8,75,72,.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#08766f] focus-visible:ring-offset-2"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="grid size-12 shrink-0 place-items-center rounded-[14px] border border-[#d3e8e4] bg-[#e9f6f3] text-[#08766f] transition-transform duration-200 group-hover:scale-[1.03]">
                      <Stethoscope size={22} weight="duotone" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold tracking-[-.015em] text-[#173638]">{v.clinicNome}</p>
                      <p className="mt-1 truncate text-xs text-[#60787a]">{v.tenantNome} · {rotulo(v.role)}</p>
                    </div>
                    <div className="grid size-8 shrink-0 place-items-center rounded-full border border-[#d9e5e3] bg-white text-[#759092] transition-colors group-hover:border-[#b7d9d5] group-hover:text-[#08766f]">
                      <CheckCircle size={17} weight="fill" />
                    </div>
                  </div>
                </button>
              ))}

              <MensagemErro erro={erro} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {passo.nome === 'credenciais' && (
        <div className="mt-8 flex items-start gap-3 border-t border-[#e1e9e7] pt-6">
          <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[#f0f5f4] text-[#60787a]">
            <ShieldCheck size={15} weight="duotone" />
          </div>
          <p className="text-[11px] leading-[1.65] text-[#60787a]">
            Problemas para acessar?{' '}
            <span className="font-semibold text-[#365557]">Fale com a administração da sua clínica.</span>
          </p>
        </div>
      )}
    </div>
  );
}

function MensagemErro({ erro }: { erro: string | null }) {
  return (
    <AnimatePresence initial={false}>
      {erro !== null && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.16 }}
          className="overflow-hidden"
        >
          <div className="flex items-start gap-2.5 rounded-[14px] border border-[#e8c6cc] bg-[#fff4f5] px-3.5 py-3 text-[#923b47]">
            <span aria-hidden="true" className="mt-[2px] grid size-4 shrink-0 place-items-center rounded-full bg-[#a93f4b] text-[10px] font-bold text-white">!</span>
            <p className="text-xs font-medium leading-5">{erro}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface CampoAcessoProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly rotulo: string;
  readonly prefixo?: ReactNode;
  readonly sufixo?: ReactNode;
  readonly inputClassName?: string;
}

function CampoAcesso({
  rotulo,
  prefixo,
  sufixo,
  inputClassName = '',
  className = '',
  ...props
}: CampoAcessoProps) {
  const id = useId();

  return (
    <div className={`space-y-2 ${className}`}>
      <label htmlFor={id} className="block text-[12px] font-semibold tracking-[-.005em] text-[#365557]">
        {rotulo}
      </label>
      <div className="flex min-h-[54px] items-center gap-3 rounded-[15px] border border-[#91aaa7] bg-[#fbfdfc] px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.9)] transition-[border-color,background-color,box-shadow] duration-150 hover:border-[#6f9792] hover:bg-white focus-within:border-[#08766f] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#08766f]/10">
        {prefixo !== undefined && <span className="grid shrink-0 place-items-center">{prefixo}</span>}
        <input
          id={id}
          {...props}
          className={`min-w-0 flex-1 bg-transparent py-3 text-sm text-[#173638] outline-none placeholder:text-[#71888a] disabled:cursor-not-allowed disabled:opacity-50 ${inputClassName}`}
        />
        {sufixo !== undefined && <span className="-mr-1 shrink-0">{sufixo}</span>}
      </div>
    </div>
  );
}
