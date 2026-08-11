'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ChatCircle,
  CurrencyDollar,
  DotsThree,
  User,
} from '@phosphor-icons/react';
import type { OperationalAppointment } from '../../domain/appointments/queue';
import { getPrimaryAction } from '../../domain/appointments/actions';
import { cn } from '../../lib/cn';
import { Avatar } from '../../ui/Avatar';
import { Botao } from '../../ui/Botao';
import { ChipDeStatus } from '../../ui/ChipDeStatus';

interface AppointmentRowProps {
  readonly appointment: OperationalAppointment;
  readonly horario: string;
  readonly selected?: boolean;
  readonly loading?: boolean;
  readonly onPatientClick: () => void;
  readonly onPrimaryAction: () => void;
  readonly onMessage: () => void;
  readonly onOpenPatient: () => void;
  readonly onCharge: () => void;
}

function Sinal({ children, tone = 'neutral' }: {
  readonly children: string;
  readonly tone?: 'neutral' | 'warning' | 'info';
}) {
  return (
    <span className={cn(
      'text-[11px] font-medium',
      tone === 'warning' ? 'text-warn' : tone === 'info' ? 'text-accent' : 'text-text-faint',
    )}>
      {children}
    </span>
  );
}

export function AppointmentRow({
  appointment,
  horario,
  selected = false,
  loading = false,
  onPatientClick,
  onPrimaryAction,
  onMessage,
  onOpenPatient,
  onCharge,
}: AppointmentRowProps) {
  const action = getPrimaryAction(appointment.status);
  return (
    <li
      className={cn(
        'grid min-h-[72px] grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line px-3 py-3 last:border-b-0 sm:px-4',
        'md:grid-cols-[72px_minmax(220px,1fr)_88px_148px_136px_36px] md:gap-x-4 md:py-2.5',
        'transition-colors-fast hover:bg-surface-subtle',
        selected && 'bg-accent-soft/45',
      )}
    >
      <time className="col-start-1 row-span-2 self-start pt-1 font-mono text-xs font-semibold text-text-muted tabular-nums md:row-span-1 md:self-auto md:pt-0">
        {horario}
      </time>

      <button
        type="button"
        onClick={onPatientClick}
        className="col-start-2 row-start-1 flex min-w-0 items-center gap-3 rounded-md text-left focus-visible:outline-offset-4 md:col-start-auto md:row-start-auto"
      >
        <Avatar nome={appointment.displayName} tamanho="sm" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-text">{appointment.displayName}</span>
          <span className="block truncate text-xs text-text-muted">
            {[appointment.procedureNome ?? (appointment.teleconsulta ? 'Teleconsulta' : 'Atendimento'), appointment.professionalNome ?? appointment.professionalId].filter(Boolean).join(' · ')}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2">
            {appointment.operadoraNome ? <Sinal>{appointment.operadoraNome}</Sinal> : <Sinal>Particular</Sinal>}
            {appointment.encaixe ? <Sinal tone="warning">Encaixe</Sinal> : null}
            {appointment.primeiraVez ? <Sinal tone="info">Primeira vez</Sinal> : null}
            {appointment.cadastroPreliminar ? <Sinal tone="warning">Cadastro preliminar</Sinal> : null}
          </span>
        </span>
      </button>

      <span className="hidden text-xs font-medium text-text-muted md:block">
        {appointment.status === 'aguardando' ? 'Na fila' : '—'}
      </span>

      <div className="col-start-2 row-start-2 mt-2 md:col-start-auto md:row-start-auto md:mt-0">
        <ChipDeStatus status={appointment.status} />
      </div>

      <Botao
        variante={action.intent === 'clinical' ? 'primario' : 'secundario'}
        tamanho="sm"
        carregando={loading}
        onClick={onPrimaryAction}
        aria-label={`${action.label} para ${appointment.displayName}`}
        className="col-start-3 row-start-1 min-w-[112px] md:col-start-auto md:row-start-auto md:w-[128px]"
      >
        {action.label}
      </Botao>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`Mais ações para ${appointment.displayName}`}
            className="col-start-3 row-start-2 mt-1 grid size-8 justify-self-end place-items-center rounded-lg text-text-faint hover:bg-surface hover:text-text md:col-start-auto md:row-start-auto md:mt-0 md:justify-self-center"
          >
            <DotsThree size={18} weight="bold" aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={5} className="z-[60] min-w-[190px] rounded-xl border border-line bg-surface p-1.5 shadow-elev-2">
            <MenuItem icon={User} label="Abrir paciente" onSelect={onOpenPatient} />
            <MenuItem icon={ChatCircle} label={appointment.mensagensNaoLidas > 0 ? `Mensagem (${appointment.mensagensNaoLidas})` : 'Enviar mensagem'} onSelect={onMessage} />
            {appointment.pagamentoPendente ? <MenuItem icon={CurrencyDollar} label="Ver cobrança" onSelect={onCharge} /> : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}

function MenuItem({ icon: Icone, label, onSelect }: {
  readonly icon: typeof User;
  readonly label: string;
  readonly onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-text outline-none data-[highlighted]:bg-surface-subtle"
    >
      <Icone size={16} className="text-text-faint" aria-hidden />
      {label}
    </DropdownMenu.Item>
  );
}
