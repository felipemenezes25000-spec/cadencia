'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Timer,
  Pill,
  FileText,
  Check,
  CaretDown,
  CaretRight,
  Paperclip,
  Microphone,
  TestTube,
} from '@phosphor-icons/react';
import { EditorClinico, type CodigoHit } from './EditorClinico';
import { PainelDeDocumentos, type TipoDeDocumento } from '../ui/PainelDeDocumentos';
import { PainelDePrescricao, type SessaoDoPrescritor } from '../ui/PainelDePrescricao';
import { FichaClinica, type SecaoDaFicha } from '../ui/FichaClinica';
import { PainelDeAnexos, type Anexo } from '../ui/PainelDeAnexos';
import { PainelDeTranscricao, type SugestaoDaIA } from '../ui/PainelDeTranscricao';
import { Botao } from '../ui/Botao';
import { BotaoIcone } from '../ui/BotaoIcone';
import { ChipDeStatus } from '../ui/ChipDeStatus';
import { InfoTip } from '../ui/ClinicalHelp';
import { Icone } from '../ui/Icone';
import { cn } from '../lib/cn';
import { useKeyboardShortcut } from '../lib/hooks';

export interface UltimoAtendimento {
  readonly data: string;
  readonly procedimento: string;
}

export interface DadosDoPaciente {
  readonly nome: string;
  readonly nascimento?: string;
  readonly sexo?: string;
  readonly cns?: string | null;
  readonly equipe?: string | null;
  readonly alergias?: readonly string[];
  readonly medicamentos?: readonly string[];
  readonly ultimosAtendimentos?: readonly UltimoAtendimento[];
}

export interface TelaDeAtendimentoProps {
  readonly encounterId: string;
  readonly pacienteNome: string;
  readonly procedimentoNome?: string;
  readonly abrirSessaoDoPrescritor: () => Promise<{
    mode: string;
    scriptUrl?: string;
    token?: string;
    patientPayload?: Readonly<Record<string, string>>;
  }>;
  readonly buscarCodigo: (termo: string) => Promise<CodigoHit[]>;
  readonly aoConfirmarPrescricao: (dados: { providerPrescriptionId: string }) => Promise<{ prescriptionId: string }>;
  readonly aoFinalizar: () => Promise<{ versionId: string; versionNo: number }>;
  readonly paciente?: DadosDoPaciente;
  readonly inicio?: Date;
  readonly aoVoltar?: () => void;
  readonly conteudoInicial?: string;
  readonly onSalvar?: (conteudo: Record<string, unknown>) => Promise<void>;
  readonly secoesDaFicha?: readonly SecaoDaFicha[];
  readonly valoresDaFicha?: Readonly<Record<string, string>>;
  readonly aoMudarFicha?: (chave: string, valor: string) => void;
  readonly anexos?: readonly Anexo[];
  readonly aoEnviarAnexo?: (dados: { arquivo: File; kind: string }) => Promise<void>;
  readonly aoAbrirAnexo?: (attachmentId: string) => Promise<void>;
  readonly aoTranscrever?: (audio: Blob) => Promise<SugestaoDaIA>;
  readonly aoAceitarSugestao?: (s: SugestaoDaIA, campos: ReadonlySet<string>) => void;
  readonly aoEmitirDocumento?: (dados: { kind: TipoDeDocumento; corpo: string }) => Promise<{
    documentId: string;
    urlPdf: string;
    assinado: boolean;
    motivo?: string;
  }>;
}

function useDuracaoAtendimento(inicio: Date) {
  const [duracao, setDuracao] = useState(0);
  useEffect(() => {
    const interval = setInterval(
      () => setDuracao(Math.floor((Date.now() - inicio.getTime()) / 1000)),
      1000,
    );
    return () => clearInterval(interval);
  }, [inicio]);
  return duracao;
}

function formatarDuracao(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function calcularIdade(nascimento: string): string {
  const hoje = new Date();
  const nasc = new Date(nascimento);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  if (
    hoje.getMonth() < nasc.getMonth()
    || (hoje.getMonth() === nasc.getMonth() && hoje.getDate() < nasc.getDate())
  ) idade--;
  return `${idade} anos`;
}

function KbdHint({ atalho, rotulo }: { readonly atalho: string; readonly rotulo: string }) {
  return (
    <span className="text-xs text-text-muted">
      <kbd className="rounded-sm border border-line bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">{atalho}</kbd>{' '}
      {rotulo}
    </span>
  );
}

function SecaoDoSidebar({
  titulo,
  descricao,
  aberto: inicial = false,
  badge,
  children,
}: {
  readonly titulo: string;
  readonly descricao: string;
  readonly aberto?: boolean;
  readonly badge?: number;
  readonly children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(inicial);
  return (
    <section className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-1 pr-3">
        <button
          type="button"
          onClick={() => setAberta(!aberta)}
          aria-expanded={aberta}
          className={cn(
            'flex min-h-12 min-w-0 flex-1 items-center justify-between px-4 py-3 text-left text-sm font-semibold text-text',
            'hover:bg-surface-hover',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{titulo}</span>
            {badge != null && badge > 0 ? (
              <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">
                {badge}
              </span>
            ) : null}
          </span>
          <Icone icon={aberta ? CaretDown : CaretRight} size="sm" className="shrink-0 text-text-muted" />
        </button>
        <InfoTip conteudo={descricao} rotulo={`Ajuda sobre ${titulo}`} />
      </div>
      {aberta ? <div className="px-4 pb-4 text-sm">{children}</div> : null}
    </section>
  );
}

function SidebarPaciente({ paciente }: { readonly paciente: DadosDoPaciente }) {
  return (
    <div>
      <div className="border-b border-line bg-surface-subtle/65 px-4 py-3.5">
        <p className="m-0 text-xs font-bold uppercase tracking-[.08em] text-text">Contexto do cidadão</p>
        <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
          Informações rápidas para decidir sem sair do atendimento.
        </p>
      </div>
      <SecaoDoSidebar
        titulo="Dados do cidadão"
        descricao="Identificação clínica básica e vínculo territorial disponíveis neste atendimento."
        aberto
      >
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {paciente.nascimento ? <><dt className="text-text-muted">Idade</dt><dd>{calcularIdade(paciente.nascimento)}</dd></> : null}
          {paciente.sexo ? <><dt className="text-text-muted">Sexo</dt><dd>{paciente.sexo}</dd></> : null}
          {paciente.cns ? <><dt className="text-text-muted">CNS</dt><dd className="font-mono text-xs">{paciente.cns}</dd></> : null}
          {paciente.equipe ? <><dt className="text-text-muted">Equipe</dt><dd>{paciente.equipe}</dd></> : null}
        </dl>
      </SecaoDoSidebar>

      <SecaoDoSidebar
        titulo="Alergias"
        descricao="Alergias registradas no prontuário. Revise antes de prescrever ou orientar medicamentos."
        aberto
        badge={paciente.alergias?.length ?? 0}
      >
        {paciente.alergias?.length ? (
          <ul className="space-y-1.5">
            {paciente.alergias.map((a) => (
              <li key={a} className="rounded-lg border border-danger/15 bg-danger-soft/35 px-2.5 py-2 font-semibold text-danger">{a}</li>
            ))}
          </ul>
        ) : <p className="text-xs italic text-text-muted">Nenhuma alergia registrada</p>}
      </SecaoDoSidebar>

      <SecaoDoSidebar
        titulo="Medicamentos em uso"
        descricao="Medicamentos ativos conhecidos. Use como contexto; confirme uso e posologia com o cidadão."
      >
        {paciente.medicamentos?.length ? (
          <ul className="space-y-1.5">{paciente.medicamentos.map((m) => <li key={m}>{m}</li>)}</ul>
        ) : <p className="text-xs italic text-text-muted">Nenhum medicamento registrado</p>}
      </SecaoDoSidebar>

      <SecaoDoSidebar
        titulo="Últimos atendimentos"
        descricao="Resumo dos encontros anteriores para recuperar rapidamente continuidade e contexto assistencial."
      >
        {paciente.ultimosAtendimentos?.length ? (
          <ul className="space-y-2">
            {paciente.ultimosAtendimentos.map((a) => (
              <li key={`${a.data}-${a.procedimento}`} className="flex justify-between gap-2 rounded-lg bg-surface-subtle/55 px-2.5 py-2">
                <span>{a.procedimento}</span>
                <span className="text-xs text-text-muted">{a.data}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs italic text-text-muted">Nenhum atendimento anterior</p>}
      </SecaoDoSidebar>
    </div>
  );
}

export function TelaDeAtendimento(p: TelaDeAtendimentoProps) {
  const [prescricaoAberta, setPrescricaoAberta] = useState(false);
  const [documentosAberto, setDocumentosAberto] = useState(false);
  const [sessaoPrescritor, setSessaoPrescritor] = useState<SessaoDoPrescritor | null>(null);
  const [anexosAberto, setAnexosAberto] = useState(false);
  const [transcricaoAberta, setTranscricaoAberta] = useState(false);
  const [finalizado, setFinalizado] = useState(false);
  const [finalizandoVisual, setFinalizandoVisual] = useState(false);
  const [erroAoFinalizar, setErroAoFinalizar] = useState<string | null>(null);

  const inicio = p.inicio ?? new Date();
  const duracao = useDuracaoAtendimento(inicio);
  const finalizando = useRef(false);
  const descarregarEditor = useRef<null | (() => Promise<boolean>)>(null);

  useEffect(() => {
    let vivo = true;
    void p.abrirSessaoDoPrescritor().then((r) => {
      if (
        vivo
        && r.mode === 'embedded'
        && typeof r.scriptUrl === 'string'
        && typeof r.token === 'string'
        && r.patientPayload !== undefined
      ) {
        setSessaoPrescritor({ scriptUrl: r.scriptUrl, token: r.token, patientPayload: r.patientPayload });
      }
    }).catch(() => {});
    return () => { vivo = false; };
  }, []);

  async function finalizar() {
    if (finalizando.current || finalizado) return;
    finalizando.current = true;
    setFinalizandoVisual(true);
    setErroAoFinalizar(null);
    try {
      if (descarregarEditor.current !== null && !(await descarregarEditor.current())) return;
      await p.aoFinalizar();
      setFinalizado(true);
    } catch {
      setErroAoFinalizar('Não foi possível finalizar. O conteúdo continua salvo como rascunho.');
    } finally {
      finalizando.current = false;
      setFinalizandoVisual(false);
    }
  }

  const prescrever = () => setPrescricaoAberta(true);
  const emitirDocumento = () => { if (p.aoEmitirDocumento) setDocumentosAberto(true); };
  const pedirExame = emitirDocumento;

  useKeyboardShortcut('p', prescrever, { ctrlKey: true });
  useKeyboardShortcut('r', prescrever, { ctrlKey: true });
  useKeyboardShortcut('e', pedirExame, { ctrlKey: true });
  useKeyboardShortcut('d', emitirDocumento, { ctrlKey: true });
  useKeyboardShortcut('Enter', () => { void finalizar(); }, { ctrlKey: true });

  const pacienteDados = p.paciente ?? { nome: p.pacienteNome };

  return (
    <div className="flex min-h-[calc(100dvh-68px)] flex-col bg-canvas lg:h-[calc(100dvh-68px)]">
      <header className="flex min-h-[76px] shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {p.aoVoltar ? <BotaoIcone icone={ArrowLeft} rotulo="Voltar" onClick={p.aoVoltar} /> : null}
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="hidden text-xs font-semibold uppercase tracking-[.08em] text-text-faint sm:inline">Atendimento SUS</span>
              <ChipDeStatus status="atendendo" />
            </div>
            <h1 className="truncate text-base font-bold text-text">{p.pacienteNome}</h1>
            <p className="truncate text-xs text-text-muted">
              {[p.procedimentoNome, pacienteDados.nascimento ? calcularIdade(pacienteDados.nascimento) : null, pacienteDados.sexo].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-2 text-sm text-text-muted md:flex" role="timer" title="Tempo transcorrido desde o início do atendimento">
            <Icone icon={Timer} size="sm" />
            <span className="font-mono tabular-nums">{formatarDuracao(duracao)}</span>
          </div>
          {!finalizado ? (
            <Botao
              variante="primario"
              iconeEsquerda={Check}
              carregando={finalizandoVisual}
              title="Salva o conteúdo pendente e sela a versão clínica deste atendimento"
              onClick={() => { void finalizar(); }}
            >
              Finalizar atendimento
            </Botao>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
        <div role="article" className="min-w-0 overflow-y-visible rounded-xl lg:overflow-y-auto">
          <div className="mb-3 flex items-start gap-3 rounded-xl border border-line bg-surface-subtle/70 px-3.5 py-3">
            <InfoTip conteudo="A evolução narrativa é salva automaticamente. Os campos estruturados ficam abaixo do editor e alimentam histórico, gráficos e indicadores." rotulo="Como funciona o registro clínico" className="mt-0.5" />
            <div>
              <p className="m-0 text-xs font-bold text-text">Registro clínico do atendimento</p>
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Evolução narrativa acima; dados estruturados abaixo. Revise antes de finalizar.</p>
            </div>
          </div>

          <EditorClinico
            encounterId={p.encounterId}
            buscarCodigo={p.buscarCodigo}
            registrarDescarga={(fn) => { descarregarEditor.current = fn; }}
            {...(p.conteudoInicial !== undefined ? { conteudoInicial: p.conteudoInicial } : {})}
            {...(p.onSalvar !== undefined ? { onSalvar: p.onSalvar } : {})}
            aoPrescrever={prescrever}
            aoPedirExame={pedirExame}
            aoEmitirDocumento={emitirDocumento}
            aoFinalizar={() => { void finalizar(); }}
          />

          {p.secoesDaFicha && p.secoesDaFicha.length > 0 && p.aoMudarFicha ? (
            <section aria-label="Ficha do atendimento" className="mt-3 rounded-xl border border-line bg-surface p-4">
              <FichaClinica
                secoes={p.secoesDaFicha}
                valores={p.valoresDaFicha ?? {}}
                aoMudar={p.aoMudarFicha}
                buscarCodigo={p.buscarCodigo}
              />
            </section>
          ) : null}
        </div>

        <aside className="overflow-hidden rounded-xl border border-line bg-surface shadow-[inset_0_1px_0_rgb(255_255_255/.9)] lg:overflow-y-auto" aria-label="Dados do cidadão">
          <SidebarPaciente paciente={pacienteDados} />
        </aside>
      </div>

      {erroAoFinalizar ? (
        <div role="alert" className="border-t border-danger/15 bg-danger-soft px-6 py-3 text-sm font-medium text-danger">
          {erroAoFinalizar}
        </div>
      ) : null}

      {finalizado ? (
        <div role="status" className="flex items-center justify-center gap-4 border-t border-ok/15 bg-ok-soft p-4">
          <span className="font-medium text-ok">Atendimento finalizado</span>
        </div>
      ) : null}

      {!finalizado ? (
        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line bg-surface px-3 py-3 sm:px-6">
          <div className="flex items-center gap-4 max-sm:hidden">
            <KbdHint atalho="Ctrl+P" rotulo="Prescrever" />
            <KbdHint atalho="Ctrl+E" rotulo="Pedir exame" />
            {p.aoEmitirDocumento ? <KbdHint atalho="Ctrl+D" rotulo="Documento" /> : null}
          </div>
          <nav className="flex min-w-0 items-center gap-2 overflow-x-auto max-sm:w-full" aria-label="Ações do atendimento">
            <Botao variante="secundario" iconeEsquerda={Pill} title="Abrir prescrição vinculada a este atendimento" onClick={prescrever}>Prescrever</Botao>
            {p.aoEmitirDocumento ? <Botao variante="secundario" iconeEsquerda={TestTube} title="Criar uma solicitação de exame para este cidadão" onClick={pedirExame}>Pedir exame</Botao> : null}
            {p.aoEmitirDocumento ? <Botao variante="secundario" iconeEsquerda={FileText} title="Emitir documento clínico vinculado ao atendimento" onClick={emitirDocumento}>Emitir documento</Botao> : null}
            {p.aoEnviarAnexo ? <Botao variante="secundario" iconeEsquerda={Paperclip} title="Adicionar ou consultar arquivos do prontuário" onClick={() => setAnexosAberto(true)}>Anexos</Botao> : null}
            {p.aoTranscrever ? <Botao variante="secundario" iconeEsquerda={Microphone} title="Transcrever áudio e revisar sugestões antes de aplicar" onClick={() => setTranscricaoAberta(true)}>Transcrever</Botao> : null}
          </nav>
        </footer>
      ) : null}

      {p.aoEnviarAnexo && p.aoAbrirAnexo ? (
        <PainelDeAnexos aberto={anexosAberto} anexos={p.anexos ?? []} aoEnviar={p.aoEnviarAnexo} aoAbrir={p.aoAbrirAnexo} aoFechar={() => setAnexosAberto(false)} />
      ) : null}

      {p.aoTranscrever && p.aoAceitarSugestao ? (
        <PainelDeTranscricao aberto={transcricaoAberta} aoTranscrever={p.aoTranscrever} aoAceitar={(s, c) => { p.aoAceitarSugestao?.(s, c); setTranscricaoAberta(false); }} aoFechar={() => setTranscricaoAberta(false)} />
      ) : null}

      <PainelDePrescricao aberto={prescricaoAberta} sessao={sessaoPrescritor} aoConfirmar={p.aoConfirmarPrescricao} aoFechar={() => setPrescricaoAberta(false)} />
      {p.aoEmitirDocumento ? <PainelDeDocumentos aberto={documentosAberto} pacienteNome={p.pacienteNome} aoEmitir={p.aoEmitirDocumento} aoFechar={() => setDocumentosAberto(false)} /> : null}
    </div>
  );
}
