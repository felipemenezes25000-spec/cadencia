'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Timer,
  Pill,
  TestTube,
  FileText,
  Check,
  CaretDown,
  CaretRight,
  Paperclip,
  Microphone,
  FlaskIcon,
} from '@phosphor-icons/react';
import { EditorClinico, type CodigoHit, type ModeloHit, type ValorAnterior } from './EditorClinico';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';
import { PainelDeDocumentos, type TipoDeDocumento } from '../ui/PainelDeDocumentos';
import { PainelDePrescricao, type SessaoDoPrescritor } from '../ui/PainelDePrescricao';
import { FichaClinica, type SecaoDaFicha } from '../ui/FichaClinica';
import { PainelDeAnexos, type Anexo } from '../ui/PainelDeAnexos';
import {
  PainelDeSadt, type GuiaSadtEmitida, type NovaGuiaSadt, type ProcedimentoTuss,
} from '../ui/PainelDeSadt';
import { PainelDeTranscricao, type SugestaoDaIA } from '../ui/PainelDeTranscricao';
import { Botao } from '../ui/Botao';
import { BotaoIcone } from '../ui/BotaoIcone';
import { ChipDeStatus } from '../ui/ChipDeStatus';
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
  /**
   * Abre a sessao do prescritor. Chamada ao MONTAR a tela, nao ao clicar em
   * Prescrever: buscar o token so no clique poe o paciente esperando a ida ate
   * a Memed. `mode` diferente de 'embedded' significa parceiro indisponivel.
   */
  readonly abrirSessaoDoPrescritor: () => Promise<{
    mode: string;
    scriptUrl?: string;
    token?: string;
    patientPayload?: Readonly<Record<string, string>>;
  }>;
  readonly buscarCodigo: (termo: string) => Promise<CodigoHit[]>;
  readonly buscarModelo: (termo: string) => Promise<ModeloHit[]>;
  readonly buscarValorAnterior: (campo: string) => Promise<ValorAnterior | null>;
  /**
   * Registra no prontuario a receita que a Memed acabou de emitir. Recebe o id
   * DELES: a confirmacao nasce do evento `prescricaoImpressa`, e nao de um botao
   * nosso — botao nosso registraria receita que talvez nao exista la.
   */
  readonly aoConfirmarPrescricao: (dados: { providerPrescriptionId: string })
    => Promise<{ prescriptionId: string }>;
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
  /**
   * Emite atestado, declaracao, pedido de exame ou relatorio. Ausente = a tela
   * NAO mostra o botao. Botao que abre painel que nao emite nada e pior que
   * botao ausente: o medico conta com ele na frente do paciente.
   */
  /**
   * Secoes e campos estruturados que a CLINICA configurou. Vazio = a clinica
   * usa so a evolucao narrativa, e a ficha nao aparece.
   */
  readonly secoesDaFicha?: readonly SecaoDaFicha[];
  readonly valoresDaFicha?: Readonly<Record<string, string>>;
  readonly aoMudarFicha?: (chave: string, valor: string) => void;
  /** Anexos do paciente. Ausente = a tela nao mostra o botao. */
  readonly anexos?: readonly Anexo[];
  readonly aoEnviarAnexo?: (dados: { arquivo: File; kind: string }) => Promise<void>;
  readonly aoAbrirAnexo?: (attachmentId: string) => Promise<void>;
  /**
   * Guia SP/SADT — a guia de exame. Ausente = sem botao.
   *
   * `convenio` nulo significa PARTICULAR: o painel abre e explica por que nao
   * ha guia, em vez de o botao sumir. Botao ausente parece defeito; a frase
   * ensina quem nunca faturou convenio.
   */
  readonly convenioDoAtendimento?: string | null;
  readonly guiasSadt?: readonly GuiaSadtEmitida[];
  /** Rascunho: o painel compoe e a guia sai no finalizar. */
  readonly emitirAoFinalizar?: boolean;
  readonly buscarProcedimentoTuss?: (termo: string) => Promise<readonly ProcedimentoTuss[]>;
  readonly aoEmitirGuiaSadt?: (g: NovaGuiaSadt) => Promise<void>;
  /** Transcricao por IA. Ausente = sem botao de gravar. */
  readonly aoTranscrever?: (audio: Blob) => Promise<SugestaoDaIA>;
  readonly aoAceitarSugestao?: (s: SugestaoDaIA, campos: ReadonlySet<string>) => void;
  readonly aoEmitirDocumento?: (dados: { kind: TipoDeDocumento; corpo: string })
    => Promise<{
      documentId: string; urlPdf: string;
      /** Falso quando nao ha PSC ICP-Brasil: o documento sai PENDENTE. */
      assinado: boolean; motivo?: string;
    }>;
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
  const [documentosAberto, setDocumentosAberto] = useState(false);
  const [sessaoPrescritor, setSessaoPrescritor] = useState<SessaoDoPrescritor | null>(null);
  const [anexosAberto, setAnexosAberto] = useState(false);
  const [sadtAberto, setSadtAberto] = useState(false);
  const [transcricaoAberta, setTranscricaoAberta] = useState(false);
  const [finalizado, setFinalizado] = useState(false);
  const [finalizandoVisual, setFinalizandoVisual] = useState(false);
  const [erroAoFinalizar, setErroAoFinalizar] = useState<string | null>(null);

  const inicio = p.inicio ?? new Date();
  const duracao = useDuracaoAtendimento(inicio);

  useEffect(() => {
    let vivo = true;
    void p.abrirSessaoDoPrescritor().then((r) => {
      if (!vivo) return;
      // So vira sessao utilizavel se vier COMPLETA. Guardar meia sessao faria o
      // painel injetar script sem token e falhar em silencio.
      if (r.mode === 'embedded' && typeof r.scriptUrl === 'string'
          && typeof r.token === 'string' && r.patientPayload !== undefined) {
        setSessaoPrescritor({
          scriptUrl: r.scriptUrl, token: r.token, patientPayload: r.patientPayload,
        });
      }
    }).catch(() => { /* parceiro fora do ar nao derruba a consulta */ });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Finaliza uma vez so, e sempre depois de gravar o que esta na tela.
   *
   * A trava nao e paranoia com clique duplo: Ctrl+Enter e ouvido pelo editor E
   * por esta tela, entao um unico atalho chega aqui duas vezes. A segunda
   * chamada encontra o atendimento fora de rascunho e devolve erro a quem fez
   * tudo certo. Ref e nao state porque a decisao acontece antes do proximo
   * render — dois cliques no mesmo tick veriam o mesmo state.
   */
  const finalizando = useRef(false);
  const descarregarEditor = useRef<null | (() => Promise<boolean>)>(null);

  async function finalizar() {
    if (finalizando.current || finalizado) return;
    finalizando.current = true;
    setFinalizandoVisual(true);
    setErroAoFinalizar(null);
    try {
      if (descarregarEditor.current !== null
          && !(await descarregarEditor.current())) return;
      await p.aoFinalizar();
      setFinalizado(true);
    } catch {
      /**
       * Finalizar e a acao mais critica da tela e era a unica sem tratamento de
       * erro: qualquer recusa da API — cadastro preliminar incompleto,
       * atendimento fora de rascunho, rede caida — virava unhandled rejection.
       * O medico clicava, nada mudava na tela, e ele nao tinha como saber se o
       * prontuario foi selado. Alguns clicavam de novo; outros fechavam a aba
       * com o atendimento em rascunho.
       */
      setErroAoFinalizar(
        'Nao foi possivel finalizar o atendimento. Nada foi selado — '
        + 'o conteudo continua salvo como rascunho. Tente de novo.');
    } finally {
      finalizando.current = false;
      setFinalizandoVisual(false);
    }
  }

  function prescrever() {
    setPrescricaoAberta(true);
  }

  function pedirExame() {
    // placeholder para futuro painel de exames
  }

  function emitirDocumento() {
    if (p.aoEmitirDocumento !== undefined) { setDocumentosAberto(true); return; }
    // placeholder para futuro painel de documentos
  }

  /* ── atalhos de teclado ──────────────────────────────────────────── */

  useKeyboardShortcut('p', prescrever, { ctrlKey: true });
  useKeyboardShortcut('r', prescrever, { ctrlKey: true });
  useKeyboardShortcut('e', pedirExame, { ctrlKey: true });
  useKeyboardShortcut('d', emitirDocumento, { ctrlKey: true });
  useKeyboardShortcut('Enter', () => { void finalizar(); }, { ctrlKey: true });
  useKeyboardShortcut('$', () => setCobrancaAberta(true), { ctrlKey: true });

  /* ── dados do paciente para o sidebar ────────────────────────────── */

  const pacienteDados: DadosDoPaciente = p.paciente ?? { nome: p.pacienteNome };

  return (
    <div className="flex min-h-[calc(100dvh-68px)] flex-col bg-canvas lg:h-[calc(100dvh-68px)]">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex min-h-[76px] shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {p.aoVoltar && (
            <BotaoIcone icone={ArrowLeft} rotulo="Voltar" onClick={p.aoVoltar} />
          )}
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="hidden text-xs font-semibold uppercase tracking-[.08em] text-text-faint sm:inline">Atendimento</span>
              <ChipDeStatus status="atendendo" />
            </div>
            <h1 className="truncate text-base font-bold text-text">{p.pacienteNome}</h1>
            <p className="truncate text-xs text-text-muted">
              {[
                p.procedimentoNome,
                pacienteDados.nascimento ? calcularIdade(pacienteDados.nascimento) : null,
                pacienteDados.sexo,
                pacienteDados.convenio ?? 'Particular',
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Timer de duracao */}
          <div
            className="hidden items-center gap-2 text-sm text-text-muted md:flex"
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
          {!finalizado ? (
            <Botao
              variante="primario"
              iconeEsquerda={Check}
              carregando={finalizandoVisual}
              onClick={() => { void finalizar(); }}
            >
              Finalizar atendimento
            </Botao>
          ) : null}
        </div>
      </header>

      {/* ── Main content: editor + sidebar ─────────────────────────── */}
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
        {/* Editor */}
        <div role="article" className="min-w-0 overflow-y-visible rounded-xl lg:overflow-y-auto">
          <EditorClinico
            encounterId={p.encounterId}
            buscarCodigo={p.buscarCodigo}
            buscarModelo={p.buscarModelo}
            buscarValorAnterior={p.buscarValorAnterior}
            registrarDescarga={(fn) => { descarregarEditor.current = fn; }}
            {...(p.conteudoInicial !== undefined ? { conteudoInicial: p.conteudoInicial } : {})}
            {...(p.onSalvar !== undefined ? { onSalvar: p.onSalvar } : {})}
            aoPrescrever={prescrever}
            aoPedirExame={pedirExame}
            aoEmitirDocumento={emitirDocumento}
            aoFinalizar={() => { void finalizar(); }}
            aoCobrar={() => setCobrancaAberta(true)}
          />

          {/* A ficha estruturada mora ABAIXO do editor, na mesma coluna: e
              entrada de dado, como o editor. Na barra lateral, que e coluna de
              consulta, o medico leria os campos como informacao ja registrada e
              nao perceberia que precisa preencher. */}
          {p.secoesDaFicha !== undefined && p.secoesDaFicha.length > 0
            && p.aoMudarFicha !== undefined && (
            <section
              aria-label="Ficha do atendimento"
              className="mt-3 rounded-xl border border-line bg-surface p-4"
            >
              <FichaClinica
                secoes={p.secoesDaFicha}
                valores={p.valoresDaFicha ?? {}}
                aoMudar={p.aoMudarFicha}
                buscarCodigo={p.buscarCodigo}
              />
            </section>
          )}
        </div>

        {/* Patient sidebar */}
        <aside
          className="overflow-hidden rounded-xl border border-line bg-surface lg:overflow-y-auto"
          aria-label="Dados do paciente"
        >
          <SidebarPaciente paciente={pacienteDados} />
        </aside>
      </div>

      {/* Falha ao finalizar precisa ser VISTA: sem isto o clique nao produzia
          nem selo nem aviso, e o medico ficava sem saber o que aconteceu. */}
      {erroAoFinalizar !== null && (
        <div role="alert" className="bg-danger/10 px-6 py-3 text-sm text-danger">
          {erroAoFinalizar}
        </div>
      )}

      {/* ── Finalizado status ──────────────────────────────────────── */}
      {finalizado && (
        <div
          role="status"
          className="flex items-center justify-center gap-4 bg-ok-soft p-4"
        >
          <span className="text-ok font-medium">Atendimento finalizado</span>
          <Botao variante="secundario" tamanho="sm">
            Próximo paciente (Enter)
          </Botao>
        </div>
      )}

      {/* ── Bottom action bar ──────────────────────────────────────── */}
      {!finalizado && (
        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line bg-surface px-3 py-3 sm:px-6">
          {/* Keyboard shortcut hints (hidden on mobile) */}
          <div className="flex items-center gap-4 max-sm:hidden">
            <KbdHint atalho="Ctrl+P" rotulo="Prescrever" />
            <KbdHint atalho="Ctrl+E" rotulo="Pedir exame" />
            <KbdHint atalho="Ctrl+D" rotulo="Documento" />
          </div>

          {/* Action buttons */}
          <nav
            className="flex min-w-0 items-center gap-2 overflow-x-auto max-sm:w-full"
            aria-label="Acoes do atendimento"
          >
            <Botao variante="secundario" iconeEsquerda={Pill} onClick={prescrever}>
              Prescrever
            </Botao>
            <Botao variante="secundario" iconeEsquerda={TestTube} onClick={pedirExame}>
              Pedir exame
            </Botao>
            {p.aoEmitirDocumento !== undefined && (
              <Botao variante="secundario" iconeEsquerda={FileText} onClick={emitirDocumento}>
                Emitir documento
              </Botao>
            )}
            {p.aoEnviarAnexo !== undefined && (
              <Botao variante="secundario" iconeEsquerda={Paperclip}
                onClick={() => setAnexosAberto(true)}>
                Anexos
              </Botao>
            )}
            {p.aoTranscrever !== undefined && (
              <Botao variante="secundario" iconeEsquerda={Microphone}
                onClick={() => setTranscricaoAberta(true)}>
                Transcrever
              </Botao>
            )}
            {p.aoEmitirGuiaSadt !== undefined && (
              <Botao variante="secundario" iconeEsquerda={FlaskIcon}
                onClick={() => setSadtAberto(true)}>
                Exames
              </Botao>
            )}
          </nav>
        </footer>
      )}

      {/* ── Paineis laterais ───────────────────────────────────────── */}
      {p.aoEmitirGuiaSadt !== undefined && p.buscarProcedimentoTuss !== undefined && (
        <PainelDeSadt
          aberto={sadtAberto}
          convenio={p.convenioDoAtendimento ?? null}
          guias={p.guiasSadt ?? []}
          emitirAoFinalizar={p.emitirAoFinalizar ?? false}
          buscarProcedimento={p.buscarProcedimentoTuss}
          aoEmitir={p.aoEmitirGuiaSadt}
          aoFechar={() => setSadtAberto(false)}
        />
      )}

      {p.aoEnviarAnexo !== undefined && p.aoAbrirAnexo !== undefined && (
        <PainelDeAnexos
          aberto={anexosAberto}
          anexos={p.anexos ?? []}
          aoEnviar={p.aoEnviarAnexo}
          aoAbrir={p.aoAbrirAnexo}
          aoFechar={() => setAnexosAberto(false)}
        />
      )}

      {p.aoTranscrever !== undefined && p.aoAceitarSugestao !== undefined && (
        <PainelDeTranscricao
          aberto={transcricaoAberta}
          aoTranscrever={p.aoTranscrever}
          aoAceitar={(sug, campos) => {
            p.aoAceitarSugestao?.(sug, campos);
            setTranscricaoAberta(false);
          }}
          aoFechar={() => setTranscricaoAberta(false)}
        />
      )}

      <PainelDePrescricao
        aberto={prescricaoAberta}
        sessao={sessaoPrescritor}
        aoConfirmar={p.aoConfirmarPrescricao}
        aoFechar={() => setPrescricaoAberta(false)}
      />

      {p.aoEmitirDocumento !== undefined && (
        <PainelDeDocumentos
          aberto={documentosAberto}
          pacienteNome={p.pacienteNome}
          aoEmitir={p.aoEmitirDocumento}
          aoFechar={() => setDocumentosAberto(false)}
        />
      )}

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
