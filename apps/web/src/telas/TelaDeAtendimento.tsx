'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Timer,
  Pill,
  TestTube,
  FileText,
  Check,
  CaretDown,
  CaretRight,
} from '@phosphor-icons/react';
import { EditorClinico, type CodigoHit, type ModeloHit, type ValorAnterior } from './EditorClinico';
import { PainelLateral } from '../ui/PainelLateral';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';
import { Botao } from '../ui/Botao';
import { Icone } from '../ui/Icone';
import { cn } from '../lib/cn';
import { useKeyboardShortcut } from '../lib/hooks';

/* ── tipos do paciente ──────────────────────────────────────────────── */

export interface UltimoAtendimento {
  readonly data: string;
  readonly procedimento: string;
}

export interface DadosDoPaciente {
  readonly nome: string;
  readonly nascimento?: string;
  readonly sexo?: string;
  readonly convenio?: string | null;
  readonly alergias?: readonly string[];
  readonly medicamentos?: readonly string[];
  readonly ultimosAtendimentos?: readonly UltimoAtendimento[];
}

/* ── props ────────────────────────────────────────────────────────── */

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
  readonly aoRegistrarPagamento?: (dados: {
    amountCents: number;
    method: Exclude<MetodoPagamento, 'link'>;
  }) => Promise<{ entryId: string; receiptNumber: number }>;
  readonly aoCriarLinkPagamento?: (dados: {
    amountCents: number;
  }) => Promise<{ linkUrl: string; linkId: string }>;

  /** Dados completos do paciente para o sidebar */
  readonly paciente?: DadosDoPaciente;
  /** Data/hora de inicio do atendimento (para timer de duracao) */
  readonly inicio?: Date;
  /** Callback para voltar a tela anterior */
  readonly aoVoltar?: () => void;
  /** Conteudo inicial do editor */
  readonly conteudoInicial?: string;
  /** Callback de salvamento do editor */
  readonly onSalvar?: (conteudo: Record<string, unknown>) => Promise<void>;
}

/* ── hook de duracao ────────────────────────────────────────────────── */

function useDuracaoAtendimento(inicio: Date) {
  const [duracao, setDuracao] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDuracao(Math.floor((Date.now() - inicio.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [inicio]);

  return duracao;
}

function formatarDuracao(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/* ── helpers ────────────────────────────────────────────────────────── */

function calcularIdade(nascimento: string): string {
  const hoje = new Date();
  const nasc = new Date(nascimento);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const mesAtual = hoje.getMonth();
  const mesNasc = nasc.getMonth();
  if (mesAtual < mesNasc || (mesAtual === mesNasc && hoje.getDate() < nasc.getDate())) {
    idade--;
  }
  return `${idade} anos`;
}

/* ── KbdHint ────────────────────────────────────────────────────────── */

function KbdHint({ atalho, rotulo }: { readonly atalho: string; readonly rotulo: string }) {
  return (
    <span className="text-xs text-text-muted">
      <kbd className="rounded-sm border border-line bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">
        {atalho}
      </kbd>{' '}
      {rotulo}
    </span>
  );
}

/* ── SecaoDoSidebar (collapsible) ───────────────────────────────────── */

function SecaoDoSidebar({
  titulo,
  aberto: abertoInicial = false,
  badge,
  children,
}: {
  readonly titulo: string;
  readonly aberto?: boolean;
  readonly badge?: number;
  readonly children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(abertoInicial);

  return (
    <section className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setAberta(!aberta)}
        aria-expanded={aberta}
        className={cn(
          'flex w-full items-center justify-between px-4 py-3 text-left',
          'text-sm font-semibold text-text',
          'hover:bg-surface-hover transition-colors duration-[var(--dur-2)]',
          'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        )}
      >
        <span className="flex items-center gap-2">
          {titulo}
          {badge != null && badge > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">
              {badge}
            </span>
          )}
        </span>
        <Icone
          icon={aberta ? CaretDown : CaretRight}
          size="sm"
          className="text-text-muted"
        />
      </button>
      {aberta && (
        <div className="px-4 pb-4 text-sm">
          {children}
        </div>
      )}
    </section>
  );
}

/* ── SidebarPaciente ────────────────────────────────────────────────── */

function SidebarPaciente({ paciente }: { readonly paciente: DadosDoPaciente }) {
  return (
    <div className="divide-y divide-line">
      {/* Dados do paciente */}
      <SecaoDoSidebar titulo="Dados do paciente" aberto>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {paciente.nascimento && (
            <>
              <dt className="text-text-muted">Idade</dt>
              <dd className="text-text">{calcularIdade(paciente.nascimento)}</dd>
            </>
          )}
          {paciente.sexo && (
            <>
              <dt className="text-text-muted">Sexo</dt>
              <dd className="text-text">{paciente.sexo}</dd>
            </>
          )}
          <dt className="text-text-muted">Convenio</dt>
          <dd className="text-text">{paciente.convenio ?? 'Particular'}</dd>
        </dl>
      </SecaoDoSidebar>

      {/* Alergias */}
      <SecaoDoSidebar titulo="Alergias" aberto badge={paciente.alergias?.length ?? 0}>
        {paciente.alergias?.length ? (
          <ul className="space-y-1.5" role="list">
            {paciente.alergias.map((a) => (
              <li key={a} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />
                <span className="font-medium text-danger">{a}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs italic text-text-muted">Nenhuma alergia registrada</p>
        )}
      </SecaoDoSidebar>

      {/* Medicamentos em uso */}
      <SecaoDoSidebar titulo="Medicamentos em uso">
        {paciente.medicamentos?.length ? (
          <ul className="space-y-1.5" role="list">
            {paciente.medicamentos.map((m) => (
              <li key={m} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span className="text-text">{m}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs italic text-text-muted">Nenhum medicamento registrado</p>
        )}
      </SecaoDoSidebar>

      {/* Ultimos atendimentos */}
      <SecaoDoSidebar titulo="Ultimos atendimentos">
        {paciente.ultimosAtendimentos?.length ? (
          <ul className="space-y-2" role="list">
            {paciente.ultimosAtendimentos.map((at) => (
              <li key={at.data} className="flex items-center justify-between gap-2">
                <span className="text-text">{at.procedimento}</span>
                <span className="shrink-0 text-xs tabular-nums text-text-muted">{at.data}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs italic text-text-muted">Nenhum atendimento anterior</p>
        )}
      </SecaoDoSidebar>
    </div>
  );
}

/* ── TelaDeAtendimento ──────────────────────────────────────────────── */

export function TelaDeAtendimento(p: TelaDeAtendimentoProps) {
  const [prescricaoAberta, setPrescricaoAberta] = useState(false);
  const [cobrancaAberta, setCobrancaAberta] = useState(false);
  const [finalizado, setFinalizado] = useState(false);

  const inicio = p.inicio ?? new Date();
  const duracao = useDuracaoAtendimento(inicio);

  useEffect(() => {
    void p.abrirSessaoDoPrescritor();
  }, []);

  async function finalizar() {
    await p.aoFinalizar();
    setFinalizado(true);
  }

  function prescrever() {
    setPrescricaoAberta(true);
  }

  function pedirExame() {
    // placeholder para futuro painel de exames
  }

  function emitirDocumento() {
    // placeholder para futuro painel de documentos
  }

  /* ── atalhos de teclado ──────────────────────────────────────────── */

  useKeyboardShortcut('p', prescrever, { ctrlKey: true });
  useKeyboardShortcut('e', pedirExame, { ctrlKey: true });
  useKeyboardShortcut('d', emitirDocumento, { ctrlKey: true });

  /* ── dados do paciente para o sidebar ────────────────────────────── */

  const pacienteDados: DadosDoPaciente = p.paciente ?? { nome: p.pacienteNome };

  return (
    <div className="flex h-[calc(100vh-var(--nav-height,0px))] flex-col bg-bg">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-line px-6 py-3">
        <div className="flex items-center gap-3">
          {p.aoVoltar && (
            <Botao variante="fantasma" iconeEsquerda={ArrowLeft} onClick={p.aoVoltar}>
              Voltar
            </Botao>
          )}
          <div>
            <h1 className="text-base font-semibold text-text">
              {p.pacienteNome}
            </h1>
            {p.procedimentoNome && (
              <p className="text-xs text-text-muted">{p.procedimentoNome}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Timer de duracao */}
          <div
            className="flex items-center gap-2 text-sm text-text-muted"
            aria-label="Duracao do atendimento"
            role="timer"
          >
            <Icone icon={Timer} size="sm" />
            <span className="font-mono tabular-nums" data-testid="duracao-timer">
              {formatarDuracao(duracao)}
            </span>
          </div>

          {/* Botao Cobrar (backward compat) */}
          {p.aoRegistrarPagamento !== undefined && (
            <Botao
              variante="secundario"
              tamanho="sm"
              onClick={() => setCobrancaAberta(true)}
              aria-label="Cobrar"
            >
              Cobrar
            </Botao>
          )}
        </div>
      </header>

      {/* ── Main content: editor + sidebar ─────────────────────────── */}
      <div className="flex flex-1 overflow-hidden max-md:flex-col">
        {/* Editor */}
        <div className="flex-[3] overflow-y-auto border-r border-line max-md:border-b max-md:border-r-0">
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
        </div>

        {/* Patient sidebar */}
        <aside
          className="flex-[2] overflow-y-auto max-md:max-h-[40vh]"
          aria-label="Dados do paciente"
        >
          <SidebarPaciente paciente={pacienteDados} />
        </aside>
      </div>

      {/* ── Finalizado status ──────────────────────────────────────── */}
      {finalizado && (
        <div
          role="status"
          className="flex items-center justify-center gap-4 bg-ok-soft p-4"
        >
          <span className="text-ok font-medium">Atendimento finalizado</span>
          <Botao variante="secundario" tamanho="sm">
            Proximo paciente (Enter)
          </Botao>
        </div>
      )}

      {/* ── Bottom action bar ──────────────────────────────────────── */}
      {!finalizado && (
        <div className="flex items-center justify-between border-t border-line bg-surface px-6 py-3">
          {/* Keyboard shortcut hints (hidden on mobile) */}
          <div className="flex items-center gap-4 max-sm:hidden">
            <KbdHint atalho="Ctrl+P" rotulo="Prescrever" />
            <KbdHint atalho="Ctrl+E" rotulo="Pedir exame" />
            <KbdHint atalho="Ctrl+D" rotulo="Documento" />
          </div>

          {/* Action buttons */}
          <nav
            className="flex items-center gap-2 max-sm:w-full max-sm:flex-col"
            aria-label="Acoes do atendimento"
          >
            <Botao variante="secundario" iconeEsquerda={Pill} onClick={prescrever}>
              Prescrever
            </Botao>
            <Botao variante="secundario" iconeEsquerda={TestTube} onClick={pedirExame}>
              Pedir exame
            </Botao>
            <Botao variante="secundario" iconeEsquerda={FileText} onClick={emitirDocumento}>
              Emitir documento
            </Botao>
            <Botao
              variante="primario"
              iconeEsquerda={Check}
              onClick={() => { void finalizar(); }}
            >
              Finalizar
            </Botao>
          </nav>
        </div>
      )}

      {/* ── Paineis laterais ───────────────────────────────────────── */}
      <PainelLateral
        aberto={prescricaoAberta}
        titulo="Prescrever"
        aoFechar={() => setPrescricaoAberta(false)}
      >
        <p className="m-0 text-sm text-text">Prescricao embarcada para {p.pacienteNome}</p>
      </PainelLateral>

      {p.aoRegistrarPagamento !== undefined && p.aoCriarLinkPagamento !== undefined ? (
        <PainelDeCobranca
          aberto={cobrancaAberta}
          pacienteNome={p.pacienteNome}
          procedimentoNome={p.procedimentoNome ?? 'Consulta'}
          valorSugeridoCentavos={p.valorSugeridoCentavos ?? 0}
          aoRegistrar={p.aoRegistrarPagamento}
          aoCriarLink={p.aoCriarLinkPagamento}
          aoFechar={() => setCobrancaAberta(false)}
        />
      ) : null}
    </div>
  );
}
