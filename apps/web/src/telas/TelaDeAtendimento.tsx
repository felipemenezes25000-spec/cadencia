'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Timer,
  Pill,
  TestTube,
  FileText,
  Check,
  CaretDown,
  CaretRight,
  ShieldCheck,
  Heartbeat,
  Sparkle,
  CurrencyDollar,
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'motion/react';
import { EditorClinico, type CodigoHit, type ModeloHit, type ValorAnterior } from './EditorClinico';
import { PainelLateral } from '../ui/PainelLateral';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';
import { Botao } from '../ui/Botao';
import { Icone } from '../ui/Icone';
import { cn } from '../lib/cn';
import { useKeyboardShortcut } from '../lib/hooks';

export interface UltimoAtendimento { readonly data: string; readonly procedimento: string; }
export interface DadosDoPaciente {
  readonly nome: string;
  readonly nascimento?: string;
  readonly sexo?: string;
  readonly convenio?: string | null;
  readonly alergias?: readonly string[];
  readonly medicamentos?: readonly string[];
  readonly ultimosAtendimentos?: readonly UltimoAtendimento[];
}

export interface TelaDeAtendimentoProps {
  readonly encounterId: string;
  readonly pacienteNome: string;
  readonly procedimentoNome?: string;
  readonly valorSugeridoCentavos?: number;
  readonly abrirSessaoDoPrescritor: () => Promise<{ mode: string }>;
  readonly buscarCodigo: (termo: string) => Promise<CodigoHit[]>;
  readonly buscarModelo: (termo: string) => Promise<ModeloHit[]>;
  readonly buscarValorAnterior: (campo: string) => Promise<ValorAnterior | null>;
  readonly aoConfirmarPrescricao: () => Promise<{ prescriptionId: string }>;
  readonly aoFinalizar: () => Promise<{ versionId: string; versionNo: number }>;
  readonly aoRegistrarPagamento?: (dados: { amountCents: number; method: Exclude<MetodoPagamento, 'link'> }) => Promise<{ entryId: string; receiptNumber: number }>;
  readonly aoCriarLinkPagamento?: (dados: { amountCents: number }) => Promise<{ linkUrl: string; linkId: string }>;
  readonly paciente?: DadosDoPaciente;
  readonly inicio?: Date;
  readonly aoVoltar?: () => void;
  readonly conteudoInicial?: string;
  readonly onSalvar?: (conteudo: Record<string, unknown>) => Promise<void>;
}

function useDuracaoAtendimento(inicio: Date) {
  const [duracao, setDuracao] = useState(0);
  useEffect(() => {
    const atualizar = () => setDuracao(Math.max(0, Math.floor((Date.now() - inicio.getTime()) / 1000)));
    atualizar();
    const interval = setInterval(atualizar, 1000);
    return () => clearInterval(interval);
  }, [inicio]);
  return duracao;
}

function formatarDuracao(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function calcularIdade(nascimento: string): string {
  const hoje = new Date();
  const nasc = new Date(nascimento);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const mesAtual = hoje.getMonth();
  const mesNasc = nasc.getMonth();
  if (mesAtual < mesNasc || (mesAtual === mesNasc && hoje.getDate() < nasc.getDate())) idade--;
  return `${idade} anos`;
}

function KbdHint({ atalho, rotulo }: { readonly atalho: string; readonly rotulo: string }) {
  return <span className="text-[10px] font-medium text-text-muted"><kbd className="cadencia-command-key mr-1 text-text-faint">{atalho}</kbd>{rotulo}</span>;
}

function SecaoDoSidebar({ titulo, aberto: abertoInicial = false, badge, children }: {
  readonly titulo: string; readonly aberto?: boolean; readonly badge?: number; readonly children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(abertoInicial);
  return (
    <section className="border-b border-line/65 last:border-b-0">
      <button
        type="button" onClick={() => setAberta(!aberta)} aria-expanded={aberta}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm font-semibold text-text transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      >
        <span className="flex min-w-0 items-center gap-2"><span className="truncate">{titulo}</span>{badge != null && badge > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{badge}</span>}</span>
        <Icone icon={aberta ? CaretDown : CaretRight} size="sm" className="text-text-muted" />
      </button>
      <AnimatePresence initial={false}>
        {aberta && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .18 }} className="overflow-hidden">
            <div className="px-4 pb-4 text-sm">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function SidebarPaciente({ paciente }: { readonly paciente: DadosDoPaciente }) {
  return (
    <div>
      <div className="border-b border-line/70 p-4">
        <div className="flex items-center gap-3">
          <span className="cadencia-icon-orb h-11 w-11 shrink-0"><Heartbeat size={21} weight="duotone" /></span>
          <div className="min-w-0"><div className="cadencia-eyebrow">Contexto clínico</div><p className="m-0 mt-1 truncate text-sm font-semibold text-text">{paciente.nome}</p></div>
        </div>
      </div>
      <SecaoDoSidebar titulo="Dados do paciente" aberto>
        <dl className="grid grid-cols-2 gap-2.5">
          {paciente.nascimento && <><div className="rounded-xl bg-surface-sunken/55 p-2.5"><dt className="text-[9px] font-bold uppercase tracking-[.08em] text-text-faint">Idade</dt><dd className="m-0 mt-1 text-xs font-semibold text-text">{calcularIdade(paciente.nascimento)}</dd></div></>}
          {paciente.sexo && <div className="rounded-xl bg-surface-sunken/55 p-2.5"><dt className="text-[9px] font-bold uppercase tracking-[.08em] text-text-faint">Sexo</dt><dd className="m-0 mt-1 text-xs font-semibold text-text">{paciente.sexo}</dd></div>}
          <div className="col-span-2 rounded-xl bg-surface-sunken/55 p-2.5"><dt className="text-[9px] font-bold uppercase tracking-[.08em] text-text-faint">Convenio</dt><dd className="m-0 mt-1 text-xs font-semibold text-text">{paciente.convenio ?? 'Particular'}</dd></div>
        </dl>
      </SecaoDoSidebar>
      <SecaoDoSidebar titulo="Alergias" aberto badge={paciente.alergias?.length ?? 0}>
        {paciente.alergias?.length ? <ul className="m-0 grid list-none gap-2 p-0" role="list">{paciente.alergias.map((a) => <li key={a} className="flex items-center gap-2 rounded-xl border border-danger/12 bg-danger-soft/60 px-3 py-2"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden /><span className="text-xs font-semibold text-danger">{a}</span></li>)}</ul> : <p className="m-0 text-xs italic text-text-muted">Nenhuma alergia registrada</p>}
      </SecaoDoSidebar>
      <SecaoDoSidebar titulo="Medicamentos em uso">
        {paciente.medicamentos?.length ? <ul className="m-0 grid list-none gap-2 p-0" role="list">{paciente.medicamentos.map((m) => <li key={m} className="flex items-center gap-2 rounded-xl bg-accent-soft/50 px-3 py-2"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden /><span className="text-xs font-medium text-text">{m}</span></li>)}</ul> : <p className="m-0 text-xs italic text-text-muted">Nenhum medicamento registrado</p>}
      </SecaoDoSidebar>
      <SecaoDoSidebar titulo="Ultimos atendimentos">
        {paciente.ultimosAtendimentos?.length ? <ul className="m-0 grid list-none gap-2 p-0" role="list">{paciente.ultimosAtendimentos.map((at) => <li key={at.data} className="flex items-center justify-between gap-2 rounded-lg py-1"><span className="text-xs font-medium text-text">{at.procedimento}</span><span className="shrink-0 text-[10px] tabular-nums text-text-faint">{at.data}</span></li>)}</ul> : <p className="m-0 text-xs italic text-text-muted">Nenhum atendimento anterior</p>}
      </SecaoDoSidebar>
    </div>
  );
}

export function TelaDeAtendimento(p: TelaDeAtendimentoProps) {
  const [prescricaoAberta, setPrescricaoAberta] = useState(false);
  const [cobrancaAberta, setCobrancaAberta] = useState(false);
  const [finalizado, setFinalizado] = useState(false);
  const inicio = useMemo(() => p.inicio ?? new Date(), [p.inicio]);
  const duracao = useDuracaoAtendimento(inicio);

  useEffect(() => { void p.abrirSessaoDoPrescritor(); }, [p.abrirSessaoDoPrescritor]);

  async function finalizar() { await p.aoFinalizar(); setFinalizado(true); }
  function prescrever() { setPrescricaoAberta(true); }
  function pedirExame() {}
  function emitirDocumento() {}

  useKeyboardShortcut('p', prescrever, { ctrlKey: true });
  useKeyboardShortcut('e', pedirExame, { ctrlKey: true });
  useKeyboardShortcut('d', emitirDocumento, { ctrlKey: true });

  const pacienteDados = p.paciente ?? { nome: p.pacienteNome };

  return (
    <div className="flex h-[calc(100vh-var(--nav-height,0px))] min-h-[620px] flex-col overflow-hidden bg-[linear-gradient(180deg,color-mix(in_oklab,var(--surface-sunken)_70%,var(--bg)),var(--bg))]">
      <header className="relative z-[6] flex min-h-[76px] items-center justify-between gap-4 border-b border-line/70 bg-surface/88 px-5 py-3 backdrop-blur-2xl max-sm:px-3">
        <div className="flex min-w-0 items-center gap-3">
          {p.aoVoltar && <Botao variante="fantasma" tamanho="sm" iconeEsquerda={ArrowLeft} onClick={p.aoVoltar}>Voltar</Botao>}
          <div className="hidden h-8 w-px bg-line sm:block" aria-hidden />
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="hidden rounded-full border border-ok/15 bg-ok-soft px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.08em] text-ok sm:inline-flex"><ShieldCheck size={11} className="mr-1" /> sessão segura</span></div>
            <h1 className="m-0 mt-1 truncate text-[15px] font-semibold tracking-[-.025em] text-text">{p.pacienteNome}</h1>
            {p.procedimentoNome && <p className="m-0 mt-0.5 truncate text-[10px] font-medium uppercase tracking-[.07em] text-text-faint">{p.procedimentoNome}</p>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-sunken/60 px-3 py-2 text-xs text-text-muted" aria-label="Duracao do atendimento" role="timer">
            <Icone icon={Timer} size="sm" /><span className="font-mono font-semibold tabular-nums" data-testid="duracao-timer">{formatarDuracao(duracao)}</span>
          </div>
          {p.aoRegistrarPagamento !== undefined && <Botao variante="secundario" tamanho="sm" iconeEsquerda={CurrencyDollar} onClick={() => setCobrancaAberta(true)} aria-label="Cobrar"><span className="max-sm:hidden">Cobrar</span><span className="sm:hidden">R$</span></Botao>}
        </div>
      </header>

      <div className="relative flex flex-1 gap-3 overflow-hidden p-3 max-md:flex-col max-md:gap-2 max-md:p-2">
        <div className="pointer-events-none absolute left-[18%] top-[-80px] h-52 w-72 rounded-full bg-accent/[.055] blur-3xl" aria-hidden />
        <main className="relative min-w-0 flex-[3] overflow-y-auto rounded-[22px] border border-line/70 bg-surface shadow-elev-2 scrollbar-thin">
          <div className="sticky top-0 z-[3] flex items-center justify-between border-b border-line/60 bg-surface/82 px-4 py-2 backdrop-blur-xl">
            <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.12em] text-text-faint"><Sparkle size={11} weight="fill" className="text-accent" /> Prontuário em foco</span>
            <span className="text-[9px] text-text-faint">salvamento contínuo</span>
          </div>
          <EditorClinico
            encounterId={p.encounterId}
            buscarCodigo={p.buscarCodigo}
            buscarModelo={p.buscarModelo}
            buscarValorAnterior={p.buscarValorAnterior}
            {...(p.conteudoInicial !== undefined ? { conteudoInicial: p.conteudoInicial } : {})}
            {...(p.onSalvar !== undefined ? { onSalvar: p.onSalvar } : {})}
            aoPrescrever={prescrever}
            aoPedirExame={pedirExame}
            aoEmitirDocumento={emitirDocumento}
            aoFinalizar={() => { void finalizar(); }}
            aoCobrar={() => setCobrancaAberta(true)}
          />
        </main>

        <aside className="relative flex-[1.25] overflow-y-auto rounded-[22px] border border-line/70 bg-surface/92 shadow-elev-1 scrollbar-thin max-md:max-h-[38vh]" aria-label="Dados do paciente">
          <SidebarPaciente paciente={pacienteDados} />
        </aside>
      </div>

      <AnimatePresence>
        {finalizado && (
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} role="status" className="flex items-center justify-center gap-4 border-t border-ok/15 bg-ok-soft/92 p-4 backdrop-blur-xl">
            <span className="flex items-center gap-2 text-sm font-semibold text-ok"><Check size={17} weight="bold" /> Atendimento finalizado</span>
            <Botao variante="secundario" tamanho="sm">Proximo paciente (Enter)</Botao>
          </motion.div>
        )}
      </AnimatePresence>

      {!finalizado && (
        <div className="relative z-[6] flex items-center justify-between gap-4 border-t border-line/70 bg-surface/90 px-5 py-3 backdrop-blur-2xl max-sm:px-2">
          <div className="flex items-center gap-4 max-lg:hidden"><KbdHint atalho="Ctrl+P" rotulo="Prescrever" /><KbdHint atalho="Ctrl+E" rotulo="Pedir exame" /><KbdHint atalho="Ctrl+D" rotulo="Documento" /></div>
          <nav className="ml-auto flex items-center gap-2 overflow-x-auto max-sm:w-full max-sm:justify-start scrollbar-thin" aria-label="Acoes do atendimento">
            <Botao variante="secundario" tamanho="sm" iconeEsquerda={Pill} onClick={prescrever}>Prescrever</Botao>
            <Botao variante="secundario" tamanho="sm" iconeEsquerda={TestTube} onClick={pedirExame}>Pedir exame</Botao>
            <Botao variante="secundario" tamanho="sm" iconeEsquerda={FileText} onClick={emitirDocumento}>Emitir documento</Botao>
            <Botao variante="primario" tamanho="sm" iconeEsquerda={Check} onClick={() => { void finalizar(); }}>Finalizar</Botao>
          </nav>
        </div>
      )}

      <PainelLateral aberto={prescricaoAberta} titulo="Prescrever" aoFechar={() => setPrescricaoAberta(false)}><p className="m-0 text-sm text-text">Prescricao embarcada para {p.pacienteNome}</p></PainelLateral>
      {p.aoRegistrarPagamento !== undefined && p.aoCriarLinkPagamento !== undefined ? (
        <PainelDeCobranca aberto={cobrancaAberta} pacienteNome={p.pacienteNome} procedimentoNome={p.procedimentoNome ?? 'Consulta'} valorSugeridoCentavos={p.valorSugeridoCentavos ?? 0} aoRegistrar={p.aoRegistrarPagamento} aoCriarLink={p.aoCriarLinkPagamento} aoFechar={() => setCobrancaAberta(false)} />
      ) : null}
    </div>
  );
}
