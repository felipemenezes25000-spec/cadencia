'use client';

import { useState, type ReactNode } from 'react';
import { ChatCircle, Stethoscope } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Botao } from '../ui/Botao';
import { PageHeader } from '../ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import type { PacienteHit } from '../ui/ComboboxDePaciente';

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
  /** Exibir skeleton de carregamento */
  readonly carregando?: boolean;
  /** Historico de atendimentos para a timeline */
  readonly atendimentos?: readonly AtendimentoResumo[];
  /**
   * Acoes extras no cabecalho.
   *
   * E um slot e nao um callback porque quem pode compartilhar prontuario depende
   * de `record.share`, e o papel da sessao vive na PAGINA. Receber um callback
   * obrigaria esta tela a ganhar tambem um `podeCompartilhar`, duplicando uma
   * decisao de autorizacao que ja existe um nivel acima.
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

function iniciais(nome: string): string {
  const partes = nome.split(' ').filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0]!;
  if (partes.length === 1) return primeira[0]!.toUpperCase();
  const ultima = partes[partes.length - 1]!;
  return (primeira[0]!.toUpperCase() + ultima[0]!.toUpperCase());
}

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
  pendentes,
}: {
  readonly paciente: PacienteHit;
  readonly pendentes: readonly string[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Dados pendentes */}
      {pendentes.length > 0 && (
        <div className="col-span-full" role="status">
          <p className="m-0 rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">
            {`${pendentes.length} dados pendentes`}
            <span className="text-text-muted">{` · ${pendentes.join(', ')}`}</span>
          </p>
        </div>
      )}

      {/* Contato */}
      <section
        aria-label="Informacoes de contato"
        className="rounded-xl border border-line bg-surface shadow-elev-1 p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-text">Contato</h2>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-text-muted">Telefone</dt>
            <dd className="m-0 font-medium text-text">
              {formatarTelefone(paciente.phonePrimary)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Dados pessoais */}
      <section
        aria-label="Dados demograficos"
        className="rounded-xl border border-line bg-surface shadow-elev-1 p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-text">Dados pessoais</h2>
        <dl className="grid gap-3 text-sm">
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

/* ── Tab: Historico ──────────────────────────────────────────────────── */

function HistoricoTab({
  atendimentos,
}: {
  readonly atendimentos: readonly AtendimentoResumo[] | undefined;
}) {
  if (!atendimentos || atendimentos.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-6">
        <p className="m-0 text-sm text-text-muted">
          Nenhum atendimento registrado.
        </p>
      </div>
    );
  }

  return (
    <ol
      className="relative ml-3 list-none space-y-6 border-l border-line p-0"
      aria-label="Timeline de atendimentos"
    >
      {atendimentos.map((at) => (
        <li key={at.id} className="ml-6">
          {/* Timeline dot */}
          <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-accent bg-surface" />

          {/* Card */}
          <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-text">{at.tipo}</span>
              <time className="text-xs text-text-muted">
                {formatarData(at.data)}
              </time>
            </div>
            <p className="m-0 text-sm text-text-muted">{at.resumo}</p>
            <p className="m-0 mt-1 text-xs text-text-faint">
              Dr(a). {at.profissional}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── Tab: Financeiro ─────────────────────────────────────────────────── */

function FinanceiroTab({
  lancamentos,
  veFinanceiro,
}: {
  readonly lancamentos: LancamentoResumo[] | null;
  readonly veFinanceiro: boolean;
}) {
  if (!veFinanceiro) {
    return (
      <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-6">
        <p className="m-0 text-sm text-text-muted">
          Sem permissao para visualizar dados financeiros.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Financeiro do paciente"
      className="rounded-xl border border-line bg-surface shadow-elev-1 p-6"
    >
      {lancamentos === null ? (
        <p className="m-0 text-text-muted">Carregando financeiro...</p>
      ) : lancamentos.length === 0 ? (
        <p className="m-0 text-text-muted">
          Nenhum lancamento para este paciente.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {lancamentos.map((l) => (
            <li
              key={l.entryId}
              className="flex items-center justify-between border-b border-line py-3"
            >
              <span className="text-sm">{l.description}</span>
              <span className="text-sm font-medium tabular-nums">
                {`R$ ${(Math.abs(l.amountCents) / 100).toFixed(2).replace('.', ',')}`}
              </span>
              <span
                className={cn(
                  'text-xs uppercase',
                  l.status === 'paid' && 'text-ok',
                  l.status === 'overdue' && 'text-danger',
                  (l.status === 'pending' || l.status === 'cancelled') &&
                    'text-text-muted',
                )}
              >
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

/* ── Componente principal ────────────────────────────────────────────── */

export function FichaDoPaciente(p: FichaDoPacienteProps) {
  const veFinanceiro = p.podeVerFinanceiro || VE_FINANCEIRO.has(p.papel);
  const [lancamentos, setLancamentos] = useState<LancamentoResumo[] | null>(
    null,
  );

  /* Skeleton de carregamento */
  if (p.carregando) {
    return <FichaSkeleton />;
  }

  function aoMudarTab(value: string): void {
    if (value === 'financeiro' && lancamentos === null && veFinanceiro) {
      void p.carregarFinanceiro().then(setLancamentos);
    }
  }

  return (
    <div className="cadencia-page grid gap-6">
      {/* Page header com breadcrumbs e acoes */}
      <PageHeader
        titulo={p.paciente.displayName}
        breadcrumbs={[
          { rotulo: 'Pacientes', href: '/pacientes' },
          { rotulo: p.paciente.displayName },
        ]}
        acoes={
          <>
            {p.acoesExtras}
            <Botao variante="secundario" iconeEsquerda={ChatCircle}>
              Mensagem
            </Botao>
            <Botao variante="primario" iconeEsquerda={Stethoscope}>
              Novo atendimento
            </Botao>
          </>
        }
      />

      {/* Barra de resumo com dados demograficos */}
      <div className="flex items-center gap-4 rounded-xl border border-line bg-surface shadow-elev-1 p-4 max-sm:flex-col max-sm:items-start">
        {/* Avatar */}
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg font-semibold text-accent"
          aria-hidden="true"
        >
          {iniciais(p.paciente.displayName)}
        </div>

        {/* Dados */}
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
            <span className="text-text-muted">Status</span>
            <p className="m-0 font-medium text-text">
              {p.paciente.cadastroStatus === 'completo'
                ? 'Completo'
                : 'Preliminar'}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="resumo" onValueChange={aoMudarTab}>
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="historico">Historico</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="convenios">Convenios</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo">
          <ResumoTab paciente={p.paciente} pendentes={p.pendentes} />
        </TabsContent>

        <TabsContent value="historico">
          <HistoricoTab atendimentos={p.atendimentos} />
        </TabsContent>

        <TabsContent value="documentos">
          <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-6">
            <p className="m-0 text-sm text-text-muted">
              Nenhum documento cadastrado.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="convenios">
          <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-6">
            <p className="m-0 text-sm text-text-muted">
              Nenhum convenio vinculado.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="financeiro">
          <FinanceiroTab
            lancamentos={lancamentos}
            veFinanceiro={veFinanceiro}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
