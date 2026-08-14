'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as Switch from '@radix-ui/react-switch';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Lightning,
  DotsThree,
  PencilSimple,
  Trash,
  Plus,
  Robot,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { PageHeader } from '../ui/PageHeader';
import { PainelLateral } from '../ui/PainelLateral';
import { Campo } from '../ui/Campo';
import { Botao } from '../ui/Botao';
import { Icone } from '../ui/Icone';
import { Skeleton } from '../ui/Skeleton';

/* ── Tipos ─────────────────────────────────────────────────────────────── */

export interface Automacao {
  readonly automationId: string;
  readonly nome: string;
  readonly descricao: string;
  readonly templateNome: string;
  readonly canal: 'whatsapp' | 'sms' | 'email';
  readonly timing: string;
  readonly ativa: boolean;
}

export interface AutomacoesDeConversaProps {
  readonly carregar: () => Promise<Automacao[]>;
  readonly aoAlternarAtiva: (automationId: string, novoEstado: boolean) => Promise<void>;
  /** @deprecated Mantido para compatibilidade. Use o formulário integrado. */
  readonly aoEditar?: (automationId: string) => void;
  readonly aoExcluir?: (automationId: string) => void;
  readonly aoSalvar?: (dados: FormularioDados) => void;
}

interface FormularioDados {
  nome: string;
  descricao: string;
  timing: string;
  canal: string;
  templateNome: string;
}

/* ── CardAutomacao ─────────────────────────────────────────────────────── */

interface CardAutomacaoProps {
  readonly automacao: Automacao;
  readonly onToggle: (ativa: boolean) => void;
  readonly onEditar: () => void;
  readonly onExcluir: () => void;
}

function CardAutomacao({ automacao, onToggle, onEditar, onExcluir }: CardAutomacaoProps) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-surface p-4 transition-colors-fast',
        automacao.ativa ? 'border-line' : 'border-line opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Conteúdo do card */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <Icone
              icon={Lightning}
              size="sm"
              className={automacao.ativa ? 'text-accent' : 'text-text-muted'}
            />
            <p className="text-sm font-semibold text-text">{automacao.nome}</p>
          </div>
          <p className="text-xs text-text-muted">{automacao.descricao}</p>

          {/* Badges de gatilho e ação */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-text-muted">
              Gatilho: {automacao.timing}
            </span>
            <span className="rounded-md bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-text-muted">
              Ação: {automacao.canal} - {automacao.templateNome}
            </span>
          </div>
        </div>

        {/* Toggle e menu */}
        <div className="flex shrink-0 items-center gap-3">
          <Switch.Root
            checked={automacao.ativa}
            onCheckedChange={onToggle}
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors-fast',
              automacao.ativa ? 'bg-accent' : 'bg-line-strong',
            )}
            aria-label={`${automacao.nome} ${automacao.ativa ? 'ativa' : 'inativa'}`}
          >
            <Switch.Thumb
              className={cn(
                'block h-4 w-4 rounded-full bg-white transition-transform',
                'data-[state=checked]:translate-x-4 translate-x-0.5',
              )}
            />
          </Switch.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="rounded-md p-1 text-text-muted hover:bg-surface-raised transition-colors-fast max-md:min-h-11 max-md:min-w-11 max-md:inline-grid max-md:place-items-center"
                aria-label={`Ações de ${automacao.nome}`}
              >
                <Icone icon={DotsThree} size="md" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-[60] min-w-[140px] rounded-md border border-line bg-surface p-1 shadow-elev-2"
              >
                <DropdownMenu.Item
                  onSelect={onEditar}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-text',
                    'outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-on',
                  )}
                >
                  <Icone icon={PencilSimple} size="sm" />
                  Editar
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={onExcluir}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-danger',
                    'outline-none data-[highlighted]:bg-danger data-[highlighted]:text-white',
                  )}
                >
                  <Icone icon={Trash} size="sm" />
                  Excluir
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  );
}

/* ── FormularioAutomacao ───────────────────────────────────────────────── */

interface FormularioAutomacaoProps {
  readonly automacao: Automacao | undefined;
  readonly onSalvar: (dados: FormularioDados) => void;
  readonly onCancelar: () => void;
}

function FormularioAutomacao({ automacao, onSalvar, onCancelar }: FormularioAutomacaoProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormularioDados>({
    defaultValues: automacao
      ? {
          nome: automacao.nome,
          descricao: automacao.descricao,
          timing: automacao.timing,
          canal: automacao.canal,
          templateNome: automacao.templateNome,
        }
      : { nome: '', descricao: '', timing: '', canal: '', templateNome: '' },
  });

  return (
    <form onSubmit={handleSubmit(onSalvar)} className="space-y-4">
      <Campo
        rotulo="Nome"
        {...register('nome', { required: 'Nome obrigatório' })}
        {...(errors.nome?.message ? { erro: errors.nome.message } : {})}
      />
      <Campo
        rotulo="Descrição"
        variante="textarea"
        {...register('descricao')}
      />
      <Campo
        rotulo="Gatilho"
        placeholder="Ex.: 2 dias antes"
        {...register('timing')}
      />
      <Campo
        rotulo="Canal"
        placeholder="Ex.: WhatsApp"
        {...register('canal')}
      />
      <Campo
        rotulo="Template de mensagem"
        variante="textarea"
        linhas={4}
        {...register('templateNome')}
      />

      <div className="flex gap-2 pt-2">
        <Botao variante="fantasma" type="button" onClick={onCancelar} fullWidth>
          Cancelar
        </Botao>
        <Botao variante="primario" type="submit" fullWidth>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

/* ── Skeleton de carregamento ────────────────────────────────────────────── */

function AutomacoesSkeleton() {
  return (
    <div
      className="cadencia-page space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Carregando automações"
      data-testid="automacoes-skeleton"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton variant="text" width="160px" />
          <Skeleton variant="text" width="280px" />
        </div>
        <Skeleton variant="text" width="140px" height="36px" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="card" height="100px" />
        ))}
      </div>
    </div>
  );
}

/* ── AutomacoesDeConversa (tela principal) ─────────────────────────────── */

export function AutomacoesDeConversa(p: AutomacoesDeConversaProps) {
  const [automacoes, setAutomacoes] = useState<Automacao[] | null>(null);
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  useEffect(() => {
    void p.carregar().then(setAutomacoes);
  }, [p]);

  if (automacoes === null) {
    return <AutomacoesSkeleton />;
  }

  async function alternar(automationId: string, novoEstado: boolean): Promise<void> {
    if (automacoes === null) return;
    const anterior = automacoes.find((a) => a.automationId === automationId);
    if (!anterior) return;

    setAutomacoes((prev) =>
      (prev ?? []).map((a) =>
        a.automationId === automationId ? { ...a, ativa: novoEstado } : a,
      ),
    );
    try {
      await p.aoAlternarAtiva(automationId, novoEstado);
    } catch {
      setAutomacoes((prev) =>
        (prev ?? []).map((a) =>
          a.automationId === automationId ? { ...a, ativa: !novoEstado } : a,
        ),
      );
    }
  }

  function abrirFormulario(): void {
    setEditandoId(null);
    setFormularioAberto(true);
  }

  function editarAutomacao(automationId: string): void {
    setEditandoId(automationId);
    setFormularioAberto(true);
    p.aoEditar?.(automationId);
  }

  function excluirAutomacao(automationId: string): void {
    p.aoExcluir?.(automationId);
  }

  function salvarAutomacao(dados: FormularioDados): void {
    p.aoSalvar?.(dados);
    setFormularioAberto(false);
    setEditandoId(null);
  }

  return (
    <div className="cadencia-page space-y-6">
      <PageHeader
        titulo="Automações"
        subtitulo="Configure respostas e ações automáticas para conversas"
        semBreadcrumb
        acoes={
          <Botao variante="primario" iconeEsquerda={Plus} onClick={abrirFormulario}>
            Nova automação
          </Botao>
        }
      />

      {/* Lista de automações */}
      {automacoes.length > 0 && (
        <div className="space-y-3" role="list" aria-label="Lista de automações">
          {automacoes.map((auto) => (
            <div key={auto.automationId} role="listitem">
              <CardAutomacao
                automacao={auto}
                onToggle={(ativa) => {
                  void alternar(auto.automationId, ativa);
                }}
                onEditar={() => editarAutomacao(auto.automationId)}
                onExcluir={() => excluirAutomacao(auto.automationId)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Estado vazio */}
      {automacoes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Icone icon={Robot} size="xl" className="mb-3 text-text-muted" />
          <p className="text-base font-medium text-text">Nenhuma automação configurada</p>
          <p className="mt-1 text-sm text-text-muted">
            Crie automações para agilizar o atendimento por mensagens
          </p>
          <Botao
            variante="primario"
            className="mt-4"
            iconeEsquerda={Plus}
            onClick={abrirFormulario}
          >
            Nova automação
          </Botao>
        </div>
      )}

      {/* Formulário lateral de criação/edição */}
      <PainelLateral
        aberto={formularioAberto}
        onFechar={() => {
          setFormularioAberto(false);
          setEditandoId(null);
        }}
        titulo={editandoId ? 'Editar automação' : 'Nova automação'}
      >
        <FormularioAutomacao
          automacao={editandoId ? automacoes.find((a) => a.automationId === editandoId) : undefined}
          onSalvar={salvarAutomacao}
          onCancelar={() => {
            setFormularioAberto(false);
            setEditandoId(null);
          }}
        />
      </PainelLateral>
    </div>
  );
}
