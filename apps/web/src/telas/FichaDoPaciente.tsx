'use client';

import { useState } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  ChatCircle,
  Stethoscope,
  Phone,
  CalendarDots,
  ShieldCheck,
  WarningCircle,
  IdentificationCard,
  FileText,
  CreditCard,
  ClockCounterClockwise,
} from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { PageHeader } from '../ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

export type PapelNaTela = 'profissional' | 'recepcao' | 'financeiro' | 'admin_clinico' | 'diretor_tecnico';

export interface MensagemResumo {
  readonly messageId: string;
  readonly direction: 'inbound' | 'outbound';
  readonly bodyPreview: string;
  readonly sentAt: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface LancamentoResumo {
  readonly entryId: string;
  readonly description: string;
  readonly amountCents: number;
  readonly status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  readonly dueDate: string;
  readonly paidAt: string | null;
}

export interface AtendimentoResumo {
  readonly id: string;
  readonly tipo: string;
  readonly data: string;
  readonly resumo: string;
  readonly profissional: string;
}

export interface FichaDoPacienteProps {
  readonly paciente: PacienteHit;
  readonly papel: PapelNaTela;
  readonly pendentes: readonly string[];
  readonly prontuarioAcessivel: boolean;
  readonly existeMasSemAcesso: boolean;
  readonly carregarProntuario: () => Promise<unknown[]>;
  readonly aoSolicitarAcesso: () => void;
  readonly aoQuebrarVidro: (justificativa: string, horas: number) => Promise<void>;
  readonly carregarConversas: () => Promise<MensagemResumo[]>;
  readonly carregarFinanceiro: () => Promise<LancamentoResumo[]>;
  readonly podeVerFinanceiro: boolean;
  readonly carregando?: boolean;
  readonly atendimentos?: readonly AtendimentoResumo[];
}

const CLINICOS = new Set<PapelNaTela>(['profissional', 'admin_clinico', 'diretor_tecnico']);
const VE_FINANCEIRO = new Set<PapelNaTela>(['financeiro', 'admin_clinico', 'diretor_tecnico']);
export { CLINICOS, VE_FINANCEIRO };

function iniciais(nome: string): string {
  const partes = nome.split(' ').filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0]!;
  if (partes.length === 1) return primeira[0]!.toUpperCase();
  const ultima = partes[partes.length - 1]!;
  return primeira[0]!.toUpperCase() + ultima[0]!.toUpperCase();
}

function calcularIdade(nascimento: string | null): string {
  if (!nascimento) return '--';
  const hoje = new Date();
  const nasc = new Date(nascimento);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const mesAtual = hoje.getMonth();
  const mesNasc = nasc.getMonth();
  if (mesAtual < mesNasc || (mesAtual === mesNasc && hoje.getDate() < nasc.getDate())) idade--;
  return `${idade} anos`;
}

function formatarTelefone(tel: string | null): string {
  if (!tel) return '--';
  if (tel.length === 11) return `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`;
  return tel;
}

function formatarData(data: string): string {
  const d = new Date(data + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const shimmer = 'bg-[linear-gradient(90deg,var(--line)_25%,var(--surface)_50%,var(--line)_75%)] [background-size:200%_100%] animate-[skeleton-shimmer_1.5s_ease-in-out_infinite]';

function FichaSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Carregando ficha do paciente" className="cadencia-page grid gap-6">
      <div className="space-y-2"><div className={cn('h-4 w-32 rounded-md', shimmer)} /><div className={cn('h-9 w-64 rounded-md', shimmer)} /></div>
      <div className={cn('h-44 rounded-[24px]', shimmer)} />
      <div className={cn('h-12 rounded-xl', shimmer)} />
      <div className="grid gap-4 sm:grid-cols-2"><div className={cn('h-40 rounded-[20px]', shimmer)} /><div className={cn('h-40 rounded-[20px]', shimmer)} /></div>
    </div>
  );
}

function InfoTile({ icone: Icon, rotulo, valor }: { readonly icone: PhosphorIcon; readonly rotulo: string; readonly valor: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-line/70 bg-surface/66 px-3.5 py-3">
      <span className="cadencia-icon-orb h-9 w-9 shrink-0"><Icon size={17} weight="duotone" /></span>
      <div className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-[.1em] text-text-faint">{rotulo}</span><strong className="mt-0.5 block truncate text-xs font-semibold text-text">{valor}</strong></div>
    </div>
  );
}

function ResumoTab({ paciente, pendentes }: { readonly paciente: PacienteHit; readonly pendentes: readonly string[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {pendentes.length > 0 && (
        <div className="col-span-full flex items-start gap-3 rounded-2xl border border-warn/15 bg-warn-soft/70 px-4 py-3.5" role="status">
          <WarningCircle size={19} weight="fill" className="mt-0.5 shrink-0 text-warn" />
          <div><p className="m-0 text-sm font-semibold text-warn">{`${pendentes.length} dados pendentes`}</p><p className="m-0 mt-0.5 text-xs text-text-muted">{pendentes.join(', ')}</p></div>
        </div>
      )}

      <section aria-label="Informacoes de contato" className="cadencia-panel p-5">
        <div className="mb-5 flex items-center justify-between"><div><span className="cadencia-eyebrow">Comunicação</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em] text-text">Contato</h2></div><Phone size={20} className="text-text-faint" /></div>
        <dl className="grid gap-4 text-sm">
          <div className="rounded-xl bg-surface-sunken/55 p-3"><dt className="text-[10px] font-bold uppercase tracking-[.08em] text-text-faint">Telefone</dt><dd className="m-0 mt-1 font-semibold text-text">{formatarTelefone(paciente.phonePrimary)}</dd></div>
        </dl>
      </section>

      <section aria-label="Dados demograficos" className="cadencia-panel p-5">
        <div className="mb-5 flex items-center justify-between"><div><span className="cadencia-eyebrow">Identidade</span><h2 className="m-0 mt-1 text-base font-semibold tracking-[-.025em] text-text">Dados pessoais</h2></div><IdentificationCard size={21} className="text-text-faint" /></div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-surface-sunken/55 p-3"><dt className="text-[10px] font-bold uppercase tracking-[.08em] text-text-faint">Data de nascimento</dt><dd className="m-0 mt-1 font-semibold text-text">{paciente.birthDate ? formatarData(paciente.birthDate) : '--'}</dd></div>
          <div className="rounded-xl bg-surface-sunken/55 p-3"><dt className="text-[10px] font-bold uppercase tracking-[.08em] text-text-faint">Cadastro</dt><dd className="m-0 mt-1 font-semibold text-text">{paciente.cadastroStatus === 'completo' ? 'Completo' : 'Preliminar'}</dd></div>
        </dl>
      </section>
    </div>
  );
}

function HistoricoTab({ atendimentos }: { readonly atendimentos: readonly AtendimentoResumo[] | undefined }) {
  if (!atendimentos || atendimentos.length === 0) return <div className="cadencia-panel p-8 text-sm text-text-muted">Nenhum atendimento registrado.</div>;
  return (
    <ol className="relative m-0 list-none p-0" aria-label="Timeline de atendimentos">
      <div className="absolute bottom-5 left-[19px] top-5 w-px bg-gradient-to-b from-accent via-line to-transparent" aria-hidden />
      {atendimentos.map((at, index) => (
        <motion.li key={at.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .06 }} className="relative grid grid-cols-[40px_1fr] gap-4 pb-5 last:pb-0">
          <div className="relative z-[1] grid h-10 w-10 place-items-center rounded-full border border-accent/18 bg-surface text-accent shadow-elev-1"><ClockCounterClockwise size={17} weight="duotone" /></div>
          <article className="cadencia-panel p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4"><div><span className="text-sm font-semibold text-text">{at.tipo}</span><p className="m-0 mt-1 text-sm leading-relaxed text-text-muted">{at.resumo}</p></div><time className="shrink-0 rounded-lg bg-surface-sunken px-2 py-1 text-[10px] font-semibold tabular-nums text-text-muted">{formatarData(at.data)}</time></div>
            <p className="m-0 mt-3 text-[10px] font-bold uppercase tracking-[.08em] text-text-faint">Dr(a). {at.profissional}</p>
          </article>
        </motion.li>
      ))}
    </ol>
  );
}

function FinanceiroTab({ lancamentos, veFinanceiro }: { readonly lancamentos: LancamentoResumo[] | null; readonly veFinanceiro: boolean }) {
  if (!veFinanceiro) return <div className="cadencia-panel p-8 text-sm text-text-muted">Sem permissao para visualizar dados financeiros.</div>;
  return (
    <section aria-label="Financeiro do paciente" className="cadencia-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line/70 px-5 py-4"><div><span className="cadencia-eyebrow">Conta do paciente</span><h2 className="m-0 mt-1 text-base font-semibold">Financeiro</h2></div><CreditCard size={21} className="text-text-faint" /></div>
      {lancamentos === null ? <p className="m-0 p-6 text-text-muted">Carregando financeiro...</p> : lancamentos.length === 0 ? <p className="m-0 p-6 text-text-muted">Nenhum lancamento para este paciente.</p> : (
        <ul className="m-0 list-none p-0">{lancamentos.map((l) => (
          <li key={l.entryId} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-line/65 px-5 py-4 last:border-b-0">
            <span className="text-sm font-medium">{l.description}</span>
            <span className="text-sm font-semibold tabular-nums">{`R$ ${(Math.abs(l.amountCents) / 100).toFixed(2).replace('.', ',')}`}</span>
            <span className={cn('rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[.07em]', l.status === 'paid' && 'bg-ok-soft text-ok', l.status === 'overdue' && 'bg-danger-soft text-danger', (l.status === 'pending' || l.status === 'cancelled') && 'bg-surface-sunken text-text-muted')}>{l.status === 'paid' ? 'Pago' : l.status === 'overdue' ? 'Vencido' : l.status === 'pending' ? 'Pendente' : 'Cancelado'}</span>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

export function FichaDoPaciente(p: FichaDoPacienteProps) {
  const veFinanceiro = p.podeVerFinanceiro || VE_FINANCEIRO.has(p.papel);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[] | null>(null);
  if (p.carregando) return <FichaSkeleton />;

  function aoMudarTab(value: string): void {
    if (value === 'financeiro' && lancamentos === null && veFinanceiro) void p.carregarFinanceiro().then(setLancamentos);
  }

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo={p.paciente.displayName}
        subtitulo="Contexto clínico, histórico e relacionamento em uma única ficha."
        breadcrumbs={[{ rotulo: 'Pacientes', href: '/pacientes' }, { rotulo: p.paciente.displayName }]}
        acoes={<><Botao variante="secundario" iconeEsquerda={ChatCircle}>Mensagem</Botao><Botao variante="primario" iconeEsquerda={Stethoscope}>Novo atendimento</Botao></>}
      />

      <section className="cadencia-panel cadencia-panel-hero p-5 sm:p-6" aria-label="Identidade do paciente">
        <div className="flex items-start gap-5 max-sm:flex-col">
          <div className="relative grid h-[76px] w-[76px] shrink-0 place-items-center rounded-[24px] bg-[var(--aurora)] text-xl font-bold tracking-[-.04em] text-white shadow-[0_16px_38px_color-mix(in_oklab,var(--accent)_26%,transparent)]" aria-hidden>
            {iniciais(p.paciente.displayName)}
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-[3px] border-surface bg-ok text-white"><ShieldCheck size={12} weight="fill" /></span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-ok/15 bg-ok-soft px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.08em] text-ok">Paciente ativo</span>
              {p.paciente.cadastroStatus === 'preliminar' && <span className="rounded-full border border-warn/15 bg-warn-soft px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.08em] text-warn">Cadastro preliminar</span>}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <InfoTile icone={CalendarDots} rotulo="Idade" valor={calcularIdade(p.paciente.birthDate)} />
              <InfoTile icone={Phone} rotulo="Telefone" valor={formatarTelefone(p.paciente.phonePrimary)} />
              <InfoTile icone={IdentificationCard} rotulo="Status" valor={p.paciente.cadastroStatus === 'completo' ? 'Completo' : 'Preliminar'} />
            </div>
          </div>
        </div>
      </section>

      {!p.prontuarioAcessivel && p.existeMasSemAcesso && (
        <section className="flex items-start justify-between gap-4 rounded-2xl border border-warn/18 bg-warn-soft/60 p-4 max-sm:flex-col" aria-label="Acesso ao prontuário">
          <div className="flex items-start gap-3"><WarningCircle size={20} className="mt-0.5 shrink-0 text-warn" /><div><p className="m-0 text-sm font-semibold text-text">Prontuário protegido</p><p className="m-0 mt-0.5 text-xs text-text-muted">Seu perfil precisa de autorização antes de abrir o conteúdo clínico.</p></div></div>
          <Botao variante="secundario" tamanho="sm" onClick={p.aoSolicitarAcesso}>Solicitar acesso</Botao>
        </section>
      )}

      <Tabs defaultValue="resumo" onValueChange={aoMudarTab}>
        <div className="sticky top-0 z-[5] mb-5 overflow-x-auto bg-bg/82 py-2 backdrop-blur-xl max-md:top-auto">
          <TabsList className="min-w-max">
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="historico">Historico</TabsTrigger>
            <TabsTrigger value="documentos">Documentos</TabsTrigger>
            <TabsTrigger value="convenios">Convenios</TabsTrigger>
            <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="resumo"><ResumoTab paciente={p.paciente} pendentes={p.pendentes} /></TabsContent>
        <TabsContent value="historico"><HistoricoTab atendimentos={p.atendimentos} /></TabsContent>
        <TabsContent value="documentos"><div className="cadencia-panel flex min-h-56 flex-col items-center justify-center p-8 text-center"><span className="cadencia-icon-orb mb-3 h-12 w-12"><FileText size={22} weight="duotone" /></span><p className="m-0 text-sm text-text-muted">Nenhum documento cadastrado.</p></div></TabsContent>
        <TabsContent value="convenios"><div className="cadencia-panel flex min-h-56 items-center justify-center p-8 text-sm text-text-muted">Nenhum convenio vinculado.</div></TabsContent>
        <TabsContent value="financeiro"><FinanceiroTab lancamentos={lancamentos} veFinanceiro={veFinanceiro} /></TabsContent>
      </Tabs>
    </div>
  );
}
