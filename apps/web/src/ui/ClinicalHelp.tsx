'use client';

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import {
  CheckCircle,
  Clock,
  Info,
  MagnifyingGlass,
  Stethoscope,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { ChipDeStatus, type StatusAgenda } from './ChipDeStatus';

const STATUS: readonly { status: StatusAgenda; descricao: string }[] = [
  { status: 'agendado', descricao: 'Horário reservado; a presença ainda pode precisar de confirmação.' },
  { status: 'confirmado', descricao: 'Presença confirmada para o horário programado.' },
  { status: 'aguardando', descricao: 'Check-in realizado; o cidadão está na fila para atendimento.' },
  { status: 'atendendo', descricao: 'Atendimento clínico em andamento neste momento.' },
  { status: 'atendido', descricao: 'Atendimento encerrado e registrado.' },
  { status: 'faltou', descricao: 'O cidadão não compareceu ao atendimento.' },
];

export function InfoTip({
  conteudo,
  rotulo = 'Entenda este item',
  lado = 'top',
  className,
}: {
  readonly conteudo: string;
  readonly rotulo?: string;
  readonly lado?: 'top' | 'bottom' | 'left' | 'right';
  readonly className?: string;
}) {
  return (
    <RadixTooltip.Root delayDuration={180}>
      <RadixTooltip.Trigger asChild>
        <button
          type="button"
          aria-label={`${rotulo}. ${conteudo}`}
          className={cn(
            'cadencia-help-trigger inline-grid size-6 shrink-0 place-items-center rounded-full border border-line bg-surface text-text-faint outline-none transition-colors hover:border-accent/30 hover:bg-accent-soft hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/55',
            className,
          )}
        >
          <Info size={13} weight="bold" aria-hidden />
        </button>
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={lado}
          sideOffset={7}
          className="z-[90] max-w-[300px] rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium leading-relaxed text-text shadow-elev-2"
        >
          {conteudo}
          <RadixTooltip.Arrow className="fill-surface" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export function StatusLegend({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {STATUS.map((item) => (
        <div key={item.status} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-line bg-surface-subtle/70 p-2.5">
          <ChipDeStatus status={item.status} className="mt-0.5 shrink-0" />
          {!compact ? <p className="m-0 text-xs leading-relaxed text-text-muted">{item.descricao}</p> : null}
        </div>
      ))}
    </div>
  );
}

function BlocoAjuda({ icon: Icon, titulo, children }: {
  readonly icon: PhosphorIcon;
  readonly titulo: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-[inset_0_1px_0_rgb(255_255_255/.9)]">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon size={16} weight="duotone" aria-hidden />
        </span>
        <h3 className="m-0 text-sm font-bold tracking-[-0.015em] text-text">{titulo}</h3>
      </div>
      {children}
    </section>
  );
}

function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd className="cadencia-command-key min-w-0 px-1.5">{children}</kbd>;
}

export function ClinicalHelpPanel({ open, onOpenChange }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[94] bg-[#07191f]/40 backdrop-blur-[5px] data-[state=open]:animate-[fadeIn_160ms_ease-out]" />
        <Dialog.Content className="cadencia-help-panel fixed inset-y-0 right-0 z-[95] flex w-[min(560px,100vw)] flex-col border-l border-line bg-canvas shadow-elev-3 outline-none data-[state=open]:animate-[slideInRight_210ms_var(--ease-out)] max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[90dvh] max-sm:w-full max-sm:rounded-t-[24px] max-sm:border-l-0 max-sm:border-t">
          <div className="border-b border-line bg-surface/92 px-5 py-5 backdrop-blur-xl sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="cadencia-eyebrow mb-1.5">Ajuda clínica</p>
                <Dialog.Title className="m-0 text-[22px] font-bold tracking-[-0.035em] text-text">
                  Como usar o Cadência
                </Dialog.Title>
                <Dialog.Description className="mt-2 max-w-[46ch] text-sm leading-relaxed text-text-muted">
                  Legenda operacional, significado dos estados e atalhos para trabalhar sem precisar adivinhar a interface.
                </Dialog.Description>
              </div>
              <Dialog.Close className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-text-muted transition-colors hover:bg-surface-hover hover:text-text" aria-label="Fechar ajuda">
                <X size={18} aria-hidden />
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 pb-8 scrollbar-thin sm:p-5">
            <BlocoAjuda icon={Clock} titulo="Fluxo do atendimento">
              <p className="mb-3 text-xs leading-relaxed text-text-muted">
                O texto do status sempre acompanha a cor. Cor é reforço visual — nunca é a única forma de entender o estado.
              </p>
              <StatusLegend />
            </BlocoAjuda>

            <BlocoAjuda icon={Stethoscope} titulo="Prontuário sem susto">
              <ul className="grid gap-2 text-xs leading-relaxed text-text-muted">
                <li><strong className="text-text">Rascunho:</strong> texto narrativo e ficha estruturada são salvos durante o atendimento.</li>
                <li><strong className="text-text">Campos estruturados:</strong> alimentam histórico, indicadores, gráficos e interoperabilidade.</li>
                <li><strong className="text-text">Campos calculados:</strong> aparecem somente para leitura quando o sistema deriva o valor, como IMC.</li>
                <li><strong className="text-text">Finalizar:</strong> sela a versão clínica. Revise antes de concluir; correções posteriores devem preservar a trilha de versões.</li>
              </ul>
            </BlocoAjuda>

            <BlocoAjuda icon={MagnifyingGlass} titulo="Encontre qualquer coisa rápido">
              <p className="text-xs leading-relaxed text-text-muted">
                Use a busca global para localizar cidadãos, agenda, prontuários, módulos e comandos sem navegar por vários menus.
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-text">
                <Kbd>Ctrl</Kbd><span>+</span><Kbd>K</Kbd><span className="ml-1 text-text-muted">abre a busca global</span>
              </div>
            </BlocoAjuda>

            <BlocoAjuda icon={CheckCircle} titulo="Atalhos durante a consulta">
              <div className="grid gap-2 text-xs text-text-muted sm:grid-cols-2">
                <span className="flex items-center gap-2"><Kbd>Ctrl+P</Kbd> Prescrever</span>
                <span className="flex items-center gap-2"><Kbd>Ctrl+E</Kbd> Pedir exame</span>
                <span className="flex items-center gap-2"><Kbd>Ctrl+D</Kbd> Emitir documento</span>
                <span className="flex items-center gap-2"><Kbd>Ctrl+Enter</Kbd> Finalizar atendimento</span>
              </div>
            </BlocoAjuda>

            <BlocoAjuda icon={WarningCircle} titulo="Como ler prioridade e risco">
              <div className="grid gap-2 text-xs leading-relaxed text-text-muted">
                <p><strong className="text-accent">Teal:</strong> ação clínica, foco ou atendimento em andamento.</p>
                <p><strong className="text-warn">Âmbar:</strong> espera ou situação que pede atenção.</p>
                <p><strong className="text-ok">Verde:</strong> confirmação ou etapa concluída.</p>
                <p><strong className="text-danger">Vermelho:</strong> erro, risco, falta ou bloqueio que exige cuidado.</p>
              </div>
            </BlocoAjuda>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
