'use client';

import { useState, type ReactNode } from 'react';
import {
  CalendarBlank,
  ChatCircle,
  ChatsCircle,
  ClipboardText,
  FileText,
  LockKey,
  Stethoscope,
  WarningCircle,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Avatar } from '../ui/Avatar';
import { Botao } from '../ui/Botao';
import { EstadoVazio } from '../ui/EstadoVazio';
import { PageHeader } from '../ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import type { PacienteHit } from '../ui/ComboboxDePaciente';
import { SecaoContato } from './SecaoContato';

/* ── Tipos exportados ────────────────────────────────────────────────── */

export type PapelNaTela =
  | 'profissional'
  | 'recepcao'
  | 'financeiro'
  | 'admin_clinico'
  | 'diretor_tecnico';

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

export interface ProntuarioResumo {
  readonly encounterId: string;
  readonly occurredDate: string;
  readonly status: string;
  readonly profissionalNome: string;
  readonly versionCount: number;
}

export interface DocumentoResumo {
  readonly id: string;
  readonly origem: 'emitido' | 'anexo';
  readonly titulo: string;
  readonly categoria: string;
  readonly criadoEm: string;
  readonly tamanhoBytes: number | null;
  readonly assinado: boolean;
}

export interface ContatoDoPaciente {
  readonly email: string | null;
  readonly phoneSecondary: string | null;
  readonly emergencyContactName: string | null;
  readonly emergencyContactPhone: string | null;
}

export interface FichaDoPacienteProps {
  readonly paciente: PacienteHit;
  readonly contato?: ContatoDoPaciente;
  readonly aoSalvarContato?: (dados: import('./SecaoContato').ContatoPayload) => Promise<void>;
  readonly papel: PapelNaTela;
  readonly pendentes: readonly string[];
  readonly prontuarioAcessivel: boolean;
  readonly existeMasSemAcesso: boolean;
  readonly carregarProntuario: () => Promise<ProntuarioResumo[]>;
  readonly aoSolicitarAcesso: () => void;
  readonly aoQuebrarVidro: (justificativa: string, horas: number) => Promise<void>;
  readonly carregarConversas: () => Promise<MensagemResumo[]>;
  readonly carregarFinanceiro: () => Promise<LancamentoResumo[]>;
  readonly carregarDocumentos: () => Promise<DocumentoResumo[]>;
  readonly aoAbrirDocumento: (documento: DocumentoResumo) => Promise<void>;
  readonly podeVerFinanceiro: boolean;
  /** Exibir skeleton de carregamento */
  readonly carregando?: boolean;
  /** Histórico de atendimentos para a timeline */
  readonly atendimentos?: readonly AtendimentoResumo[];
  /** Acoes de navegacao ficam na pagina, onde o roteador e o paciente existem. */
  readonly aoMensagem?: () => void;
  readonly aoNovoAtendimento?: () => void;
  /**
   * Ações extras no cabeçalho.
   *
   * É um slot e não um callback porque quem pode compartilhar prontuário depende
   * de `record.share`, e o papel da sessão vive na PÁGINA. Receber um callback
   * obrigaria esta tela a ganhar também um `podeCompartilhar`, duplicando uma
   * decisão de autorização que já existe um nível acima.
   */
  readonly acoesExtras?: ReactNode;
}

/* ── Constantes de acesso ────────────────────────────────────────────── */

const CLINICOS = new Set<PapelNaTela>([
  'profissional',
  'admin_clinico',
  'diretor_tecnico',
]);

const VE_FINANCEIRO = new Set<PapelNaTela>([
  'financeiro',
  'admin_clinico',
  'diretor_tecnico',
]);

// Exporta para uso externo (backward compat)
export { CLINICOS, VE_FINANCEIRO };

/* ── Helpers ─────────────────────────────────────────────────────────── */

function calcularIdade(nascimento: string | null): string {
  if (!nascimento) return '--';
  const hoje = new Date();
  const nasc = new Date(nascimento);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const mesAtual = hoje.getMonth();
  const mesNasc = nasc.getMonth();
  if (
    mesAtual < mesNasc ||
    (mesAtual === mesNasc && hoje.getDate() < nasc.getDate())
  ) {
    idade--;
  }
  return `${idade} anos`;
}

function formatarTelefone(tel: string | null): string {
  if (!tel) return '--';
  if (tel.length === 11) {
    return `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`;
  }
  return tel;
}

function formatarData(data: string): string {
  const d = new Date(data + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/* ── Skeleton de carregamento ────────────────────────────────────────── */

const shimmer =
  'bg-[linear-gradient(90deg,var(--line)_25%,var(--surface)_50%,var(--line)_75%)] [background-size:200%_100%] animate-[skeleton-shimmer_1.5s_ease-in-out_infinite]';

function FichaSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando ficha do paciente"
      className="cadencia-page grid gap-6"
    >
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className={cn('h-4 w-32 rounded-md', shimmer)} />
        <div className={cn('h-7 w-56 rounded-md', shimmer)} />
      </div>

      {/* Summary bar skeleton */}
      <div className="flex items-center gap-4 rounded-lg border border-line p-4">
        <div className={cn('h-14 w-14 shrink-0 rounded-full', shimmer)} />
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="space-y-1">
            <div className={cn('h-3 w-10 rounded', shimmer)} />
            <div className={cn('h-4 w-16 rounded', shimmer)} />
          </div>
          <div className="space-y-1">
            <div className={cn('h-3 w-14 rounded', shimmer)} />
            <div className={cn('h-4 w-28 rounded', shimmer)} />
          </div>
          <div className="space-y-1">
            <div className={cn('h-3 w-10 rounded', shimmer)} />
            <div className={cn('h-4 w-20 rounded', shimmer)} />
          </div>
        </div>
      </div>

      {/* Tabs skeleton */}
      <div className={cn('h-10 w-full rounded-md', shimmer)} />

      {/* Content skeleton */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={cn('h-32 rounded-lg', shimmer)} />
        <div className={cn('h-32 rounded-lg', shimmer)} />
      </div>
    </div>
  );
}

/* ── Tab: Resumo ─────────────────────────────────────────────────────── */

function ResumoTab({
  paciente,
  contato,
  aoSalvarContato,
  editavel,
}: {
  readonly paciente: PacienteHit;
  readonly contato?: ContatoDoPaciente;
  readonly aoSalvarContato?: (dados: import('./SecaoContato').ContatoPayload) => Promise<void>;
  readonly editavel: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,.65fr)]">
      <SecaoContato
        phonePrimary={paciente.phonePrimary}
        phoneSecondary={contato?.phoneSecondary ?? null}
        email={contato?.email ?? null}
        emergencyContactName={contato?.emergencyContactName ?? null}
        emergencyContactPhone={contato?.emergencyContactPhone ?? null}
        aoSalvar={aoSalvarContato ?? (async () => {})}
        editavel={editavel && aoSalvarContato !== undefined}
      />

      {/* Dados pessoais */}
      <section
        aria-label="Dados demográficos"
        className="rounded-xl border border-line bg-surface p-5"
      >
        <h2 className="mb-4 text-base font-semibold text-text">Informações</h2>
        <dl className="grid gap-4 text-sm">
          <div>
            <dt className="text-text-muted">Data de nascimento</dt>
            <dd className="m-0 font-medium text-text">
              {paciente.birthDate ? formatarData(paciente.birthDate) : '--'}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">Cadastro</dt>
            <dd className="m-0 font-medium text-text">
              {paciente.cadastroStatus === 'completo' ? 'Completo' : 'Preliminar'}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

/* ── Tab: Histórico ──────────────────────────────────────────────────── */

function HistoricoTab({
  atendimentos,
}: {
  readonly atendimentos: readonly AtendimentoResumo[] | undefined;
}) {
  if (!atendimentos || atendimentos.length === 0) {
    return (
      <EstadoVazio
        icone={CalendarBlank}
        titulo="Nenhum atendimento registrado"
        descricao="Quando um atendimento for concluído, ele aparecerá aqui em ordem cronológica."
      />
    );
  }

  return (
    <ol
      className="list-none overflow-hidden rounded-xl border border-line bg-surface p-0"
      aria-label="Linha do tempo de atendimentos"
    >
      {atendimentos.map((at) => (
        <li key={at.id} className="grid gap-2 border-b border-line px-5 py-4 last:border-b-0 sm:grid-cols-[116px_minmax(0,1fr)]">
          <time className="text-xs font-semibold tabular-nums text-text-muted">
            {formatarData(at.data)}
          </time>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-text">{at.tipo}</span>
              <span className="text-xs text-text-faint">{at.profissional}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">{at.resumo}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── Tab: Financeiro ─────────────────────────────────────────────────── */

function formatarTamanho(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function DocumentosTab({
  itens,
  erro,
  abrindoId,
  aoAbrir,
  aoTentarNovamente,
}: {
  readonly itens: DocumentoResumo[] | null;
  readonly erro: string | null;
  readonly abrindoId: string | null;
  readonly aoAbrir: (documento: DocumentoResumo) => void;
  readonly aoTentarNovamente: () => void;
}) {
  if (erro !== null) {
    return (
      <EstadoVazio
        icone={WarningCircle}
        titulo="Não foi possível carregar os documentos"
        descricao={erro}
        acao={<Botao variante="secundario" onClick={aoTentarNovamente}>Tentar novamente</Botao>}
      />
    );
  }
  if (itens === null) {
    return (
      <div role="status" className="rounded-xl border border-line bg-surface p-5 text-sm text-text-muted">
        Carregando documentos…
      </div>
    );
  }
  if (itens.length === 0) {
    return (
      <EstadoVazio
        icone={FileText}
        titulo="Nenhum documento cadastrado"
        descricao="Atestados, laudos e arquivos vinculados ao paciente aparecerão aqui."
      />
    );
  }
  return (
    <section aria-label="Documentos do paciente" className="overflow-hidden rounded-xl border border-line bg-surface">
      <ul className="m-0 list-none divide-y divide-line p-0">
        {itens.map((item) => {
          const tamanho = formatarTamanho(item.tamanhoBytes);
          return (
            <li key={`${item.origem}-${item.id}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
                  <FileText size={18} weight="duotone" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text">{item.titulo}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {item.categoria} · {new Date(item.criadoEm).toLocaleDateString('pt-BR')}
                    {tamanho === null ? '' : ` · ${tamanho}`}
                  </p>
                  {item.assinado && (
                    <span className="mt-1 inline-flex rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">
                      Documento assinado
                    </span>
                  )}
                </div>
              </div>
              <Botao
                variante="secundario"
                carregando={abrindoId === item.id}
                onClick={() => aoAbrir(item)}
              >
                Abrir {item.origem === 'anexo' ? 'anexo' : 'documento'}
              </Botao>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FinanceiroTab({
  lancamentos,
  veFinanceiro,
}: {
  readonly lancamentos: LancamentoResumo[] | null;
  readonly veFinanceiro: boolean;
}) {
  if (!veFinanceiro) {
    return (
      <EstadoVazio
        icone={LockKey}
        titulo="Acesso financeiro restrito"
        descricao="Seu perfil não possui permissão para visualizar lançamentos deste paciente."
      />
    );
  }

  return (
    <section
      aria-label="Financeiro do paciente"
      className="rounded-xl border border-line bg-surface p-5"
    >
      {lancamentos === null ? (
        <p className="m-0 text-sm text-text-muted">Carregando financeiro…</p>
      ) : lancamentos.length === 0 ? (
        <EstadoVazio
          icone={ClipboardText}
          compacto
          titulo="Nenhum lançamento financeiro"
          descricao="Este paciente não possui cobranças pendentes ou recebimentos registrados."
        />
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {lancamentos.map((l) => (
            <li
              key={l.entryId}
              className="grid items-center gap-2 border-b border-line py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px_96px]"
            >
              <span className="text-sm font-medium text-text">{l.description}</span>
              <span className="text-sm font-semibold tabular-nums text-text">
                {`R$ ${(Math.abs(l.amountCents) / 100).toFixed(2).replace('.', ',')}`}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-xs font-semibold',
                  l.status === 'paid' && 'text-ok',
                  l.status === 'overdue' && 'text-danger',
                  (l.status === 'pending' || l.status === 'cancelled') &&
                    'text-text-muted',
                )}
              >
                <span aria-hidden="true">{l.status === 'paid' ? '✓' : l.status === 'overdue' ? '!' : '◷'}</span>
                {l.status === 'paid'
                  ? 'Pago'
                  : l.status === 'overdue'
                    ? 'Vencido'
                    : l.status === 'pending'
                      ? 'Pendente'
                      : 'Cancelado'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProntuarioTab({
  itens,
  acessivel,
  restrito,
  erro,
  aoSolicitarAcesso,
  aoTentarNovamente,
}: {
  readonly itens: ProntuarioResumo[] | null;
  readonly acessivel: boolean;
  readonly restrito: boolean;
  readonly erro: string | null;
  readonly aoSolicitarAcesso: () => void;
  readonly aoTentarNovamente: () => void;
}) {
  if (!acessivel || restrito) {
    return (
      <EstadoVazio
        icone={LockKey}
        titulo="Prontuário com acesso restrito"
        descricao="O cadastro permanece disponível, mas o conteúdo clínico depende de autorização específica."
        acao={<Botao variante="secundario" onClick={aoSolicitarAcesso}>Solicitar acesso</Botao>}
      />
    );
  }
  if (erro) {
    return (
      <EstadoVazio
        icone={WarningCircle}
        titulo="Não foi possível carregar o prontuário"
        descricao={erro}
        acao={<Botao variante="secundario" onClick={aoTentarNovamente}>Tentar novamente</Botao>}
      />
    );
  }
  if (itens === null) {
    return <div role="status" className="rounded-xl border border-line bg-surface p-5 text-sm text-text-muted">Carregando prontuário…</div>;
  }
  if (itens.length === 0) {
    return (
      <EstadoVazio
        icone={ClipboardText}
        titulo="Prontuário ainda sem registros"
        descricao="O primeiro registro clínico aparecerá aqui depois que um atendimento for salvo."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {itens.map((item) => (
        <div key={item.encounterId} className="grid gap-2 border-b border-line px-5 py-4 last:border-b-0 sm:grid-cols-[116px_minmax(0,1fr)_auto] sm:items-center">
          <time className="text-xs font-semibold tabular-nums text-text-muted">{formatarData(item.occurredDate)}</time>
          <div>
            <p className="text-sm font-semibold text-text">{item.profissionalNome}</p>
            <p className="mt-0.5 text-xs text-text-muted">{item.versionCount} {item.versionCount === 1 ? 'versão clínica' : 'versões clínicas'}</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-text-muted">
            <span aria-hidden="true">{item.status === 'finalizado' ? '✓' : '◷'}</span>
            {item.status === 'finalizado' ? 'Finalizado' : 'Rascunho'}
          </span>
        </div>
      ))}
    </div>
  );
}

function ComunicacoesTab({
  mensagens,
  erro,
  aoTentarNovamente,
}: {
  readonly mensagens: MensagemResumo[] | null;
  readonly erro: string | null;
  readonly aoTentarNovamente: () => void;
}) {
  if (erro) {
    return (
      <EstadoVazio
        icone={WarningCircle}
        titulo="Não foi possível carregar as comunicações"
        descricao={erro}
        acao={<Botao variante="secundario" onClick={aoTentarNovamente}>Tentar novamente</Botao>}
      />
    );
  }
  if (mensagens === null) {
    return <div role="status" className="rounded-xl border border-line bg-surface p-5 text-sm text-text-muted">Carregando comunicações…</div>;
  }
  if (mensagens.length === 0) {
    return (
      <EstadoVazio
        icone={ChatsCircle}
        titulo="Nenhuma comunicação registrada"
        descricao="Mensagens associadas a este paciente aparecerão aqui."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {mensagens.map((mensagem) => (
        <div key={mensagem.messageId} className="grid gap-2 border-b border-line px-5 py-4 last:border-b-0 sm:grid-cols-[92px_minmax(0,1fr)_auto] sm:items-center">
          <span className="text-xs font-semibold text-text-muted">{mensagem.direction === 'inbound' ? 'Recebida' : 'Enviada'}</span>
          <p className="truncate text-sm text-text">{mensagem.bodyPreview || 'Mensagem sem prévia'}</p>
          <time className="text-xs tabular-nums text-text-faint">{mensagem.sentAt ? new Date(mensagem.sentAt).toLocaleDateString('pt-BR') : '—'}</time>
        </div>
      ))}
    </div>
  );
}

/* ── Componente principal ────────────────────────────────────────────── */

export function FichaDoPaciente(p: FichaDoPacienteProps) {
  const veFinanceiro = p.podeVerFinanceiro || VE_FINANCEIRO.has(p.papel);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[] | null>(
    null,
  );
  const [prontuario, setProntuario] = useState<ProntuarioResumo[] | null>(null);
  const [conversas, setConversas] = useState<MensagemResumo[] | null>(null);
  const [documentos, setDocumentos] = useState<DocumentoResumo[] | null>(null);
  const [abrindoDocumentoId, setAbrindoDocumentoId] = useState<string | null>(null);
  const [erroProntuario, setErroProntuario] = useState<string | null>(null);
  const [erroConversas, setErroConversas] = useState<string | null>(null);
  const [erroDocumentos, setErroDocumentos] = useState<string | null>(null);
  const [erroFinanceiro, setErroFinanceiro] = useState<string | null>(null);

  /* Skeleton de carregamento */
  if (p.carregando) {
    return <FichaSkeleton />;
  }

  async function carregarProntuario(): Promise<void> {
    setErroProntuario(null);
    try {
      setProntuario(await p.carregarProntuario());
    } catch {
      setErroProntuario('Não foi possível consultar o prontuário. Nenhum dado clínico foi alterado.');
    }
  }

  async function carregarConversas(): Promise<void> {
    setErroConversas(null);
    try {
      setConversas(await p.carregarConversas());
    } catch {
      setErroConversas('Não foi possível carregar as comunicações. Tente novamente.');
    }
  }

  async function carregarFinanceiro(): Promise<void> {
    setErroFinanceiro(null);
    try {
      setLancamentos(await p.carregarFinanceiro());
    } catch {
      setErroFinanceiro('Não foi possível consultar os lançamentos deste paciente.');
    }
  }

  async function carregarDocumentos(): Promise<void> {
    setErroDocumentos(null);
    try {
      setDocumentos(await p.carregarDocumentos());
    } catch {
      setErroDocumentos('Não foi possível carregar os documentos. Tente novamente.');
    }
  }

  async function abrirDocumento(documento: DocumentoResumo): Promise<void> {
    setAbrindoDocumentoId(documento.id);
    try {
      await p.aoAbrirDocumento(documento);
    } finally {
      setAbrindoDocumentoId(null);
    }
  }

  function aoMudarTab(value: string): void {
    if (value === 'prontuario' && prontuario === null && p.prontuarioAcessivel) {
      void carregarProntuario();
    }
    if (value === 'comunicacoes' && conversas === null) {
      void carregarConversas();
    }
    if (value === 'financeiro' && lancamentos === null && veFinanceiro) {
      void carregarFinanceiro();
    }
    if (value === 'documentos' && documentos === null) {
      void carregarDocumentos();
    }
  }

  return (
    <div className="cadencia-page grid min-w-0 gap-6">
      {/* Page header com breadcrumbs e ações */}
      <PageHeader
        titulo={p.paciente.displayName}
        subtitulo="Visão 360° do paciente, contexto clínico e próximos passos"
        breadcrumbs={[
          { rotulo: 'Pacientes', href: '/pacientes' },
          { rotulo: p.paciente.displayName },
        ]}
        acoes={
          <>
            {p.acoesExtras}
            {p.aoMensagem ? (
              <Botao variante="secundario" iconeEsquerda={ChatCircle} onClick={p.aoMensagem}>
                Mensagem
              </Botao>
            ) : null}
            {p.aoNovoAtendimento ? (
              <Botao variante="primario" iconeEsquerda={Stethoscope} onClick={p.aoNovoAtendimento}>
                Novo atendimento
              </Botao>
            ) : null}
          </>
        }
      />

      {/* Identidade: contexto estável antes de qualquer tab. */}
      <section aria-label="Identidade do paciente" className="flex items-center gap-4 rounded-xl border border-line bg-surface p-5 max-sm:items-start">
        <Avatar nome={p.paciente.displayName} tamanho="xl" />
        <div className="min-w-0 flex-1">
          {p.paciente.hasSocialName && p.paciente.legalName !== p.paciente.displayName ? (
            <p className="mb-2 text-xs text-text-muted">Nome civil: {p.paciente.legalName}</p>
          ) : null}
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-text-muted">Idade</span>
            <p className="m-0 font-medium text-text">
              {calcularIdade(p.paciente.birthDate)}
            </p>
          </div>
          <div>
            <span className="text-text-muted">Telefone</span>
            <p className="m-0 font-medium text-text">
              {formatarTelefone(p.paciente.phonePrimary)}
            </p>
          </div>
          <div>
            <span className="text-text-muted">Situação</span>
            <p className="m-0 inline-flex items-center gap-1.5 font-medium text-text">
              <span aria-hidden="true">{p.paciente.cadastroStatus === 'completo' ? '✓' : '◷'}</span>
              {p.paciente.cadastroStatus === 'completo'
                ? 'Completo'
                : 'Preliminar'}
            </p>
          </div>
          </div>
        </div>
      </section>

      {p.pendentes.length > 0 ? (
        <section role="status" aria-label="Pendências cadastrais" className="flex items-start gap-3 rounded-xl border border-warn/25 bg-warn-soft/55 px-4 py-3.5 text-sm">
          <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div>
            <p className="font-semibold text-text">{p.pendentes.length} {p.pendentes.length === 1 ? 'dado precisa' : 'dados precisam'} de atenção</p>
            <p className="mt-0.5 text-text-muted">{p.pendentes.join(' · ')}</p>
          </div>
        </section>
      ) : null}

      {/* Tabs */}
      <Tabs defaultValue="resumo" onValueChange={aoMudarTab} className="min-w-0 max-w-full">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="prontuario">Prontuário</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="comunicacoes">Comunicações</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo">
          <ResumoTab
            paciente={p.paciente}
            {...(p.contato !== undefined ? { contato: p.contato } : {})}
            {...(p.aoSalvarContato !== undefined ? { aoSalvarContato: p.aoSalvarContato } : {})}
            editavel={p.papel !== 'financeiro'}
          />
        </TabsContent>

        <TabsContent value="prontuario">
          <ProntuarioTab
            itens={prontuario}
            acessivel={p.prontuarioAcessivel}
            restrito={p.existeMasSemAcesso}
            erro={erroProntuario}
            aoSolicitarAcesso={p.aoSolicitarAcesso}
            aoTentarNovamente={() => { void carregarProntuario(); }}
          />
        </TabsContent>

        <TabsContent value="historico">
          <HistoricoTab atendimentos={p.atendimentos} />
        </TabsContent>

        <TabsContent value="documentos">
          <DocumentosTab
            itens={documentos}
            erro={erroDocumentos}
            abrindoId={abrindoDocumentoId}
            aoAbrir={(documento) => { void abrirDocumento(documento); }}
            aoTentarNovamente={() => { void carregarDocumentos(); }}
          />
        </TabsContent>

        <TabsContent value="financeiro">
          {erroFinanceiro ? (
            <EstadoVazio
              icone={WarningCircle}
              titulo="Não foi possível carregar o financeiro"
              descricao={erroFinanceiro}
              acao={<Botao variante="secundario" onClick={() => carregarFinanceiro()}>Tentar novamente</Botao>}
            />
          ) : <FinanceiroTab lancamentos={lancamentos} veFinanceiro={veFinanceiro} />}
        </TabsContent>

        <TabsContent value="comunicacoes">
          <ComunicacoesTab
            mensagens={conversas}
            erro={erroConversas}
            aoTentarNovamente={() => { void carregarConversas(); }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
