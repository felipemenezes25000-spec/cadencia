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
import { EstadoVazio } from '../ui/EstadoVazio';

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
  /** @deprecated Mantido para compatibilidade. Use o formulario integrado. */
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
        'cadencia-panel group p-4 transition-[opacity,transform,box-shadow,border-color] duration-[var(--dur-2)] hover:-translate-y-0.5 hover:shadow-elev-2',
        automacao.ativa ? 'border-accent/10' : 'opacity-58 grayscale-[.14]',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Conteudo do card */}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <Icone
              icon={Lightning}
              size="sm"
              className={automacao.ativa ? 'text-accent' : 'text-text-muted'}
            />
            <p className="m-0 text-sm font-semibold tracking-[-.015em] text-text">{automacao.nome}</p>
          </div>
          <p className="m-0 text-xs leading-relaxed text-text-muted">{automacao.descricao}</p>

          {/* Badges de gatilho e acao */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-line/65 bg-surface-sunken/55 px-2.5 py-1 text-[10px] font-semibold text-text-muted">
              Gatilho: {automacao.timing}
            </span>
            <span className="rounded-full border border-line/65 bg-surface-sunken/55 px-2.5 py-1 text-[10px] font-semibold text-text-muted">
              Acao: {automacao.canal} - {automacao.templateNome}
            </span>
          </div>
        </div>

        {/* Toggle e menu */}
        <div className="flex shrink-0 items-center gap-3">
          <Switch.Root
            checked={automacao.ativa}
            onCheckedChange={onToggle}
            className={cn(
              'relative h-6 w-11 rounded-full border border-line/60 shadow-inner transition-colors-fast',
              automacao.ativa ? 'bg-accent' : 'bg-line-strong',
            )}
            aria-label={`${automacao.nome} ${automacao.ativa ? 'ativa' : 'inativa'}`}
          >
            <Switch.Thumb
              className={cn(
                'block h-[18px] w-[18px] rounded-full bg-white shadow-elev-1 transition-transform',
                'data-[state=checked]:translate-x-[21px] translate-x-0.5',
              )}
            />
          </Switch.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="grid h-9 w-9 place-items-center rounded-[10px] text-text-muted hover:bg-surface-raised hover:text-text transition-colors-fast"
                aria-label={`Acoes de ${automacao.nome}`}
              >
                <Icone icon={DotsThree} size="md" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-[60] min-w-[154px] rounded-[14px] border border-line/75 bg-surface/96 p-1.5 shadow-[var(--elev-float)] backdrop-blur-xl"
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
        {...register('nome', { required: 'Nome obrigatorio' })}
        {...(errors.nome?.message ? { erro: errors.nome.message } : {})}
      />
      <Campo
        rotulo="Descricao"
        variante="textarea"
        {...register('descricao')}
      />
      <Campo
        rotulo="Gatilho"
        placeholder="Ex: 2 dias antes"
        {...register('timing')}
      />
      <Campo
        rotulo="Canal"
        placeholder="Ex: whatsapp"
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
      aria-label="Carregando automacoes"
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
    let ativo = true;
    void p.carregar().then((itens) => { if (ativo) setAutomacoes(itens); });
    return () => { ativo = false; };
  }, [p.carregar]);

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
        titulo="Automacoes"
        subtitulo="Configure respostas e acoes automaticas para conversas"
        semBreadcrumb
        acoes={
          <Botao variante="primario" iconeEsquerda={Plus} onClick={abrirFormulario}>
            Nova automacao
          </Botao>
        }
      />

      {automacoes.length > 0 && (
        <section className="cadencia-panel cadencia-panel-hero p-4 sm:p-5" aria-label="Resumo de automacoes">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="cadencia-metric p-3.5"><span className="cadencia-eyebrow">Fluxos</span><strong className="mt-1 block text-2xl tracking-[-.05em] text-text">{automacoes.length}</strong><span className="text-[10px] text-text-faint">configurados</span></div>
            <div className="cadencia-metric p-3.5"><span className="cadencia-eyebrow">Ativos</span><strong className="mt-1 block text-2xl tracking-[-.05em] text-ok">{automacoes.filter((a) => a.ativa).length}</strong><span className="text-[10px] text-text-faint">executando</span></div>
            <div className="cadencia-metric p-3.5"><span className="cadencia-eyebrow">Cobertura</span><strong className="mt-1 block text-2xl tracking-[-.05em] text-text">{new Set(automacoes.map((a) => a.canal)).size}</strong><span className="text-[10px] text-text-faint">canais</span></div>
          </div>
        </section>
      )}

      {/* Lista de automacoes */}
      {automacoes.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2" role="list" aria-label="Lista de automacoes">
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
        <EstadoVazio
          icone={Robot}
          titulo="Nenhuma automacao configurada"
          descricao="Crie automacoes para agilizar o atendimento por mensagens"
          acao={<Botao variante="primario" iconeEsquerda={Plus} onClick={abrirFormulario}>Nova automacao</Botao>}
        />
      )}

      {/* Formulario lateral de criacao/edicao */}
      <PainelLateral
        aberto={formularioAberto}
        onFechar={() => {
          setFormularioAberto(false);
          setEditandoId(null);
        }}
        titulo={editandoId ? 'Editar automacao' : 'Nova automacao'}
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
