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
   * Abre a sessão do prescritor. Chamada ao MONTAR a tela, não ao clicar em
   * Prescrever: buscar o token só no clique põe o paciente esperando a ida até
   * a Memed. `mode` diferente de 'embedded' significa parceiro indisponível.
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
   * Registra no prontuário a receita que a Memed acabou de emitir. Recebe o id
   * DELES: a confirmação nasce do evento `prescricaoImpressa`, e não de um botão
   * nosso — botão nosso registraria receita que talvez não exista lá.
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
  /** Data/hora de início do atendimento (para timer de duração) */
  readonly inicio?: Date;
  /** Callback para voltar à tela anterior */
  readonly aoVoltar?: () => void;
  /** Conteúdo inicial do editor */
  readonly conteudoInicial?: string;
  /** Callback de salvamento do editor */
  readonly onSalvar?: (conteudo: Record<string, unknown>) => Promise<void>;
  /**
   * Emite atestado, declaração, pedido de exame ou relatório. Ausente = a tela
   * NÃO mostra o botão. Botão que abre painel que não emite nada é pior que
   * botão ausente: o médico conta com ele na frente do paciente.
   */
  /**
   * Seções e campos estruturados que a CLÍNICA configurou. Vazio = a clínica
   * usa só a evolução narrativa, e a ficha não aparece.
   */
  readonly secoesDaFicha?: readonly SecaoDaFicha[];
  readonly valoresDaFicha?: Readonly<Record<string, string>>;
  readonly aoMudarFicha?: (chave: string, valor: string) => void;
  /** Anexos do paciente. Ausente = a tela não mostra o botão. */
  readonly anexos?: readonly Anexo[];
  readonly aoEnviarAnexo?: (dados: { arquivo: File; kind: string }) => Promise<void>;
  readonly aoAbrirAnexo?: (attachmentId: string) => Promise<void>;
  /**
   * Guia SP/SADT — a guia de exame. Ausente = sem botão.
   *
   * `convenio` nulo significa PARTICULAR: o painel abre e explica por que não
   * há guia, em vez de o botão sumir. Botão ausente parece defeito; a frase
   * ensina quem nunca faturou convênio.
   */
  readonly convenioDoAtendimento?: string | null;
  readonly guiasSadt?: readonly GuiaSadtEmitida[];
  /** Rascunho: o painel compõe e a guia sai no finalizar. */
  readonly emitirAoFinalizar?: boolean;
  readonly buscarProcedimentoTuss?: (termo: string) => Promise<readonly ProcedimentoTuss[]>;
  readonly aoEmitirGuiaSadt?: (g: NovaGuiaSadt) => Promise<void>;
  /** Transcrição por IA. Ausente = sem botão de gravar. */
  readonly aoTranscrever?: (audio: Blob) => Promise<SugestaoDaIA>;
  readonly aoAceitarSugestao?: (s: SugestaoDaIA, campos: ReadonlySet<string>) => void;
  readonly aoEmitirDocumento?: (dados: { kind: TipoDeDocumento; corpo: string })
    => Promise<{
      documentId: string; urlPdf: string;
      /** Falso quando não há PSC ICP-Brasil: o documento sai PENDENTE. */
      assinado: boolean; motivo?: string;
    }>;
}

/* ── hook de duração ────────────────────────────────────────────────── */

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
          <dt className="text-text-muted">Convênio</dt>
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

      {/* Últimos atendimentos */}
      <SecaoDoSidebar titulo="Últimos atendimentos">
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
  const [erroAoFinalizar, setErroAoFinalizar] = useState<string | null>(null);

  const inicio = p.inicio ?? new Date();
  const duracao = useDuracaoAtendimento(inicio);

  useEffect(() => {
    let vivo = true;
    void p.abrirSessaoDoPrescritor().then((r) => {
      if (!vivo) return;
      // Só vira sessão utilizável se vier COMPLETA. Guardar meia sessão faria o
      // painel injetar script sem token e falhar em silêncio.
      if (r.mode === 'embedded' && typeof r.scriptUrl === 'string'
          && typeof r.token === 'string' && r.patientPayload !== undefined) {
        setSessaoPrescritor({
          scriptUrl: r.scriptUrl, token: r.token, patientPayload: r.patientPayload,
        });
      }
    }).catch(() => { /* parceiro fora do ar não derruba a consulta */ });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Finaliza uma vez só, e sempre depois de gravar o que está na tela.
   *
   * A trava não é paranoia com clique duplo: Ctrl+Enter é ouvido pelo editor E
   * por esta tela, então um único atalho chega aqui duas vezes. A segunda
   * chamada encontra o atendimento fora de rascunho e devolve erro a quem fez
   * tudo certo. Ref e não state porque a decisão acontece antes do próximo
   * render — dois cliques no mesmo tick veriam o mesmo state.
   */
  const finalizando = useRef(false);
  const descarregarEditor = useRef<null | (() => Promise<boolean>)>(null);

  async function finalizar() {
    if (finalizando.current || finalizado) return;
    finalizando.current = true;
    setErroAoFinalizar(null);
    try {
      if (descarregarEditor.current !== null
          && !(await descarregarEditor.current())) return;
      await p.aoFinalizar();
      setFinalizado(true);
    } catch {
      /**
       * Finalizar é a ação mais crítica da tela e era a única sem tratamento de
       * erro: qualquer recusa da API — cadastro preliminar incompleto,
       * atendimento fora de rascunho, rede caída — virava unhandled rejection.
       * O médico clicava, nada mudava na tela, e ele não tinha como saber se o
       * prontuário foi selado. Alguns clicavam de novo; outros fechavam a aba
       * com o atendimento em rascunho.
       */
      setErroAoFinalizar(
        'Não foi possível finalizar o atendimento. Nada foi selado — '
        + 'o conteúdo continua salvo como rascunho. Tente de novo.');
    } finally {
      finalizando.current = false;
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
    <div className="flex h-[calc(100vh-var(--nav-height,0px))] flex-col bg-surface-sunken/45">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="cadencia-glass flex min-h-[72px] items-center justify-between border-b border-line px-6 py-3 max-sm:px-4">
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
          {/* Timer de duração */}
          <div
            className="flex items-center gap-2 text-sm text-text-muted"
            aria-label="Duração do atendimento"
            role="timer"
          >
            <Icone icon={Timer} size="sm" />
            <span className="font-mono tabular-nums" data-testid="duracao-timer">
              {formatarDuracao(duracao)}
            </span>
          </div>

          {/* Botão Cobrar (backward compat) */}
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
      <div className="flex flex-1 gap-3 overflow-hidden p-3 max-md:flex-col max-md:gap-2 max-md:p-2">
        {/* Editor */}
        <div role="article" className="min-w-0 flex-[3] overflow-y-auto rounded-xl">
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

          {/* A ficha estruturada mora ABAIXO do editor, na mesma coluna: é
              entrada de dado, como o editor. Na barra lateral, que é coluna de
              consulta, o médico leria os campos como informação já registrada e
              não perceberia que precisa preencher. */}
          {p.secoesDaFicha !== undefined && p.secoesDaFicha.length > 0
            && p.aoMudarFicha !== undefined && (
            <section
              aria-label="Ficha do atendimento"
              className="mt-3 rounded-xl border border-line bg-surface p-4 shadow-elev-1"
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
          className="flex-[2] overflow-y-auto rounded-xl border border-line bg-surface shadow-elev-1 max-md:max-h-[40vh]"
          aria-label="Dados do paciente"
        >
          <SidebarPaciente paciente={pacienteDados} />
        </aside>
      </div>

      {/* Falha ao finalizar precisa ser VISTA: sem isto o clique não produzia
          nem selo nem aviso, e o médico ficava sem saber o que aconteceu. */}
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
        <div className="cadencia-glass flex items-center justify-between border-t border-line px-6 py-3 max-sm:px-3">
          {/* Keyboard shortcut hints (hidden on mobile) */}
          <div className="flex items-center gap-4 max-sm:hidden">
            <KbdHint atalho="Ctrl+P" rotulo="Prescrever" />
            <KbdHint atalho="Ctrl+E" rotulo="Pedir exame" />
            <KbdHint atalho="Ctrl+D" rotulo="Documento" />
          </div>

          {/* Action buttons */}
          <nav
            className="flex items-center gap-2 max-sm:w-full max-sm:flex-col"
            aria-label="Ações do atendimento"
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

      {/* ── Painéis laterais ───────────────────────────────────────── */}
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
