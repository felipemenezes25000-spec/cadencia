'use client';

import { cn } from "../lib/cn";
import { ChipDeStatus, type StatusAgenda } from './ChipDeStatus';
import { Icone } from './Icone';
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  DotsThreeVertical,
  SignIn,
  Stethoscope,
  ChatCircle,
  CurrencyDollar,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

/* ── Dados do agendamento ──────────────────────────────────────────────── */

export interface Agendamento {
  id?: string;
  horario: string;
  paciente: string;
  profissional?: string;
  procedimento?: string;
  convenio?: string;
  status: StatusAgenda;
  encaixe?: boolean;
  teleconsulta?: boolean;
  primeiraVez?: boolean;
  cadastroPreliminar?: boolean;
}

/* ── Props: suporta API nova (agendamento) E legada (flat) ─────────────── */

interface PropsNova {
  readonly agendamento: Agendamento;
  readonly onClick?: () => void;
  readonly className?: string;
}

interface PropsLegada {
  readonly hora: string;
  readonly paciente: string;
  readonly profissional: string;
  readonly procedimento?: string;
  readonly convenio?: string;
  readonly status: StatusAgenda;
  readonly encaixe: boolean;
  readonly cadastroPreliminar?: boolean;
  readonly primeiraVez?: boolean;
  readonly teleconsulta?: boolean;
  readonly aoAbrir?: () => void;
  readonly className?: string;
}

export type LinhaDaAgendaProps = PropsNova | PropsLegada;

/* ── Cores de borda por status ─────────────────────────────────────────── */

const COR_BORDA: Record<StatusAgenda, string> = {
  agendado:       'border-l-st-agendado',
  confirmado:     'border-l-st-confirmado',
  aguardando:     'border-l-st-aguardando',
  atendendo:      'border-l-st-atendendo',
  em_atendimento: 'border-l-st-atendendo',
  atendido:       'border-l-st-atendido',
  faltou:         'border-l-st-faltou',
  cancelado:      'border-l-st-cancelado',
  pendente:       'border-l-st-aguardando',
  pago:           'border-l-st-atendido',
  vencido:        'border-l-st-faltou',
};

/* ── Normalizacao de props ─────────────────────────────────────────────── */

interface Normalizado {
  ag: Agendamento;
  onClick: (() => void) | undefined;
  className: string | undefined;
}

function normalizar(props: LinhaDaAgendaProps): Normalizado {
  if ('agendamento' in props) {
    return { ag: props.agendamento, onClick: props.onClick, className: props.className };
  }
  const ag: Agendamento = {
    horario: props.hora,
    paciente: props.paciente,
    profissional: props.profissional,
    status: props.status,
    encaixe: props.encaixe,
  };
  if (props.procedimento !== undefined) ag.procedimento = props.procedimento;
  if (props.convenio !== undefined) ag.convenio = props.convenio;
  if (props.teleconsulta !== undefined) ag.teleconsulta = props.teleconsulta;
  if (props.primeiraVez !== undefined) ag.primeiraVez = props.primeiraVez;
  if (props.cadastroPreliminar !== undefined) ag.cadastroPreliminar = props.cadastroPreliminar;
  return { ag, onClick: props.aoAbrir, className: props.className };
}

/* ── Item do menu ──────────────────────────────────────────────────────── */

function ItemDoMenu({ icon, rotulo }: { icon: PhosphorIcon; rotulo: string }) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5",
        "text-[length:var(--fs-14)] text-text outline-none cursor-pointer",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-on",
        "transition-colors-fast",
      )}
    >
      <Icone icon={icon} size="sm" />
      {rotulo}
    </DropdownMenu.Item>
  );
}

/* ── Menu de acoes ─────────────────────────────────────────────────────── */

function AcoesMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "rounded-[var(--r-md)] p-1 text-text-muted",
            "hover:bg-surface-hover hover:text-text",
            "transition-colors-fast",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
          aria-label="Acoes do agendamento"
          onClick={(e) => e.stopPropagation()}
        >
          <Icone icon={DotsThreeVertical} size="md" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className={cn(
            "z-[var(--z-popover)] min-w-[180px]",
            "rounded-[var(--r-md)] border border-line bg-surface p-1",
            "shadow-elev-2",
            "animate-[scaleIn_150ms_ease]",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <ItemDoMenu icon={SignIn} rotulo="Check-in" />
          <ItemDoMenu icon={Stethoscope} rotulo="Abrir atendimento" />
          <ItemDoMenu icon={ChatCircle} rotulo="Enviar mensagem" />
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <ItemDoMenu icon={CurrencyDollar} rotulo="Cobrar" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ── Badge auxiliar ────────────────────────────────────────────────────── */

function Badge({ texto, cor }: { texto: string; cor: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5",
        "text-[length:10px] font-medium leading-tight",
        cor,
      )}
    >
      {texto}
    </span>
  );
}

/* ── Componente principal ──────────────────────────────────────────────── */

export function LinhaDaAgenda(props: LinhaDaAgendaProps) {
  const { ag, onClick, className } = normalizar(props);

  return (
    <li
      data-encaixe={ag.encaixe ? 'true' : 'false'}
      onClick={onClick}
      className={cn(
        "grid items-center gap-3",
        "grid-cols-[60px_1fr_auto_auto_auto]",
        "max-sm:grid-cols-[50px_1fr_auto_auto]",
        "px-4 py-3 min-h-[44px]",
        "border-l-[3px] border-b border-b-line",
        COR_BORDA[ag.status],
        "bg-surface hover:bg-surface-hover transition-colors-fast",
        onClick ? "cursor-pointer" : "cursor-default",
        className,
      )}
    >
      {/* Horario */}
      <span className="text-[length:var(--fs-13)] font-mono font-medium text-text-muted tabular-nums">
        {ag.horario}
      </span>

      {/* Paciente + detalhes */}
      <div className="min-w-0">
        <p className="text-[length:var(--fs-14)] font-medium text-text truncate m-0">
          {ag.paciente}
        </p>
        {(ag.profissional || ag.procedimento || ag.convenio) && (
          <p className="text-[length:var(--fs-12)] text-text-muted truncate m-0">
            {[ag.profissional, ag.procedimento, ag.convenio]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>

      {/* Badges (desktop only) */}
      <div className="flex items-center gap-1.5 max-sm:hidden">
        {ag.encaixe && (
          <Badge texto="Encaixe" cor="bg-warn-soft text-warn" />
        )}
        {ag.teleconsulta && (
          <Badge texto="Teleconsulta" cor="bg-accent-soft text-accent" />
        )}
        {ag.primeiraVez && (
          <Badge texto="1a vez" cor="bg-ok-soft text-ok" />
        )}
        {ag.cadastroPreliminar && (
          <Badge texto="Cadastro preliminar" cor="bg-warn-soft text-warn" />
        )}
      </div>

      {/* Status chip */}
      <ChipDeStatus status={ag.status} />

      {/* Menu de acoes */}
      <AcoesMenu />
    </li>
  );
}
