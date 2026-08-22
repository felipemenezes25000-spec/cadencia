'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChatCircle, ClockCountdown, DotsThree, User } from '@phosphor-icons/react';
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
  /** Mantido temporariamente no contrato para compatibilidade com chamadas antigas; não é exibido na edição pública. */
  readonly onCharge?: () => void;
}

function Sinal({ children, tone = 'neutral' }: { readonly children: string; readonly tone?: 'neutral' | 'warning' | 'info' }) {
  return <span className={cn(
    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4',
    tone === 'warning' ? 'border-warn/15 bg-warn-soft/60 text-warn' : tone === 'info' ? 'border-accent/15 bg-accent-soft/55 text-accent' : 'border-line bg-surface-subtle text-text-faint',
  )}>{children}</span>;
}

export function AppointmentRow({ appointment, horario, selected = false, loading = false, onPatientClick, onPrimaryAction, onMessage, onOpenPatient }: AppointmentRowProps) {
  const action = getPrimaryAction(appointment.status);
  const estadoVivo = appointment.status === 'aguardando' || appointment.status === 'atendendo';

  return (
    <li className={cn(
      'group/row relative grid min-h-[84px] grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line px-3 py-3.5 last:border-b-0 sm:px-4',
      'md:grid-cols-[72px_minmax(220px,1fr)_88px_150px_140px_38px] md:gap-x-4 md:px-5 md:py-3',
      'transition-[background-color,box-shadow] duration-150 hover:bg-surface-hover/80',
      selected && 'bg-accent-soft/55 shadow-[inset_3px_0_0_var(--brand)]',
    )}>
      {estadoVivo ? <span className={cn('absolute inset-y-4 left-0 w-[3px] rounded-r-full shadow-[0_0_14px_currentColor]', appointment.status === 'atendendo' ? 'bg-accent text-accent' : 'bg-warn text-warn')} aria-hidden /> : null}

      <div className="col-start-1 row-span-2 self-start pt-0.5 md:row-span-1 md:self-auto md:pt-0">
        <time className="block font-mono text-[12px] font-bold tracking-[-0.02em] text-text tabular-nums">{horario}</time>
        <span className="mt-1 hidden items-center gap-1 text-[10px] font-medium text-text-faint md:flex">
          <ClockCountdown size={11} aria-hidden />
          {appointment.status === 'aguardando' ? 'na fila' : appointment.status === 'atendendo' ? 'agora' : 'horário'}
        </span>
      </div>

      <button type="button" onClick={onPatientClick} className="group/patient col-start-2 row-start-1 flex min-w-0 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/55 focus-visible:ring-offset-4 md:col-start-auto md:row-start-auto">
        <Avatar nome={appointment.displayName} tamanho="md" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold tracking-[-0.018em] text-text transition-colors group-hover/patient:text-accent sm:text-sm">{appointment.displayName}</span>
          <span className="mt-0.5 block truncate text-[11px] font-medium text-text-muted sm:text-xs">
            {[appointment.procedureNome ?? (appointment.teleconsulta ? 'Teleconsulta' : 'Atendimento'), appointment.professionalNome ?? appointment.professionalId].filter(Boolean).join(' · ')}
          </span>
          <span className="mt-1.5 flex max-w-full flex-wrap gap-1">
            {appointment.encaixe ? <Sinal tone="warning">Encaixe</Sinal> : null}
            {appointment.primeiraVez ? <Sinal tone="info">Primeira vez</Sinal> : null}
            {appointment.cadastroPreliminar ? <Sinal tone="warning">Cadastro preliminar</Sinal> : null}
          </span>
        </span>
      </button>

      <span className={cn('hidden text-[11px] font-semibold md:flex md:items-center md:gap-1.5', appointment.status === 'aguardando' ? 'text-warn' : appointment.status === 'atendendo' ? 'text-accent' : 'text-text-faint')}>
        {estadoVivo ? <span className="cadencia-live-dot !size-1.5 !bg-current !shadow-none" aria-hidden /> : null}
        {appointment.status === 'aguardando' ? 'Na fila' : appointment.status === 'atendendo' ? 'Agora' : '—'}
      </span>

      <div className="col-start-2 row-start-2 mt-2 md:col-start-auto md:row-start-auto md:mt-0"><ChipDeStatus status={appointment.status} /></div>
      <Botao variante={action.intent === 'clinical' ? 'primario' : 'secundario'} tamanho="sm" carregando={loading} onClick={onPrimaryAction} aria-label={`${action.label} para ${appointment.displayName}`} className="col-start-3 row-start-1 min-w-[108px] md:col-start-auto md:row-start-auto md:w-[132px]">{action.label}</Botao>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" aria-label={`Mais ações para ${appointment.displayName}`} className="col-start-3 row-start-2 mt-1 grid size-9 justify-self-end place-items-center rounded-xl border border-transparent text-text-faint outline-none transition-all duration-150 hover:border-line hover:bg-surface hover:text-text hover:shadow-elev-1 focus-visible:ring-2 focus-visible:ring-accent/50 md:col-start-auto md:row-start-auto md:mt-0 md:justify-self-center">
            <DotsThree size={18} weight="bold" aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={8} className="z-[60] min-w-[214px] rounded-2xl border border-line bg-surface/98 p-1.5 shadow-elev-3 backdrop-blur-xl">
            <MenuItem icon={User} label="Abrir paciente" onSelect={onOpenPatient} />
            <MenuItem icon={ChatCircle} label={appointment.mensagensNaoLidas > 0 ? `Mensagem (${appointment.mensagensNaoLidas})` : 'Enviar mensagem'} onSelect={onMessage} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}

function MenuItem({ icon: Icone, label, onSelect }: { readonly icon: typeof User; readonly label: string; readonly onSelect: () => void }) {
  return <DropdownMenu.Item onSelect={onSelect} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-text outline-none data-[highlighted]:bg-surface-subtle">
    <span className="grid size-7 place-items-center rounded-lg bg-surface-sunken text-text-faint"><Icone size={15} aria-hidden /></span>{label}
  </DropdownMenu.Item>;
}
