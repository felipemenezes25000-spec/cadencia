'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  CalendarBlank,
  ChatCircle,
  ClockCounterClockwise,
  DotsThreeVertical,
  User,
  XCircle,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import type { Appointment } from '../../domain/appointments/types';

function MenuItem({ icon: Icon, children, danger = false, onSelect }: {
  readonly icon: PhosphorIcon;
  readonly children: string;
  readonly danger?: boolean;
  readonly onSelect?: () => void;
}) {
  return (
    <DropdownMenu.Item
      {...(onSelect ? { onSelect } : {})}
      className={`flex h-9 items-center gap-2 rounded-md px-2.5 text-sm outline-none transition-colors-fast data-[highlighted]:bg-surface-subtle ${danger ? 'text-danger' : 'text-text-primary'}`}
    >
      <Icon size={16} aria-hidden />{children}
    </DropdownMenu.Item>
  );
}

export function AppointmentActionMenu({ appointment, onOpenPatient }: {
  readonly appointment: Appointment;
  readonly onOpenPatient: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={`Mais ações para ${appointment.patientName}`} className="grid size-8 shrink-0 place-items-center rounded-lg text-text-tertiary transition-colors-fast hover:bg-surface-subtle hover:text-text-primary">
          <DotsThreeVertical size={18} weight="bold" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={5} className="z-[60] min-w-[210px] rounded-lg border border-border bg-surface p-1.5 shadow-elev-2 data-[state=open]:animate-[scaleIn_120ms_var(--ease-out)]">
          <MenuItem icon={User} onSelect={onOpenPatient}>Abrir paciente</MenuItem>
          <MenuItem icon={ChatCircle}>Enviar mensagem</MenuItem>
          <MenuItem icon={CalendarBlank}>Reagendar</MenuItem>
          <MenuItem icon={ClockCounterClockwise}>Ver histórico</MenuItem>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <MenuItem icon={XCircle} danger>Cancelar agendamento</MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
