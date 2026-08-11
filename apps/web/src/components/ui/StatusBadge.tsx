import {
  CalendarBlank,
  CheckCircle,
  Clock,
  Hourglass,
  Play,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { APPOINTMENT_STATUS } from '../../domain/appointments/states';
import type { AppointmentStatus } from '../../domain/appointments/types';
import { Badge, type BadgeTone } from './Badge';

const icons: Record<AppointmentStatus, PhosphorIcon> = {
  scheduled: CalendarBlank,
  confirmation_pending: Hourglass,
  confirmed: CheckCircle,
  waiting: Clock,
  called: Play,
  in_progress: Play,
  closing: Hourglass,
  completed: CheckCircle,
  no_show: XCircle,
  blocked: WarningCircle,
};

const tones = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const satisfies Record<string, BadgeTone>;

export function StatusBadge({ status }: { readonly status: AppointmentStatus }) {
  const definition = APPOINTMENT_STATUS[status];
  const Icon = icons[status];
  return (
    <Badge tone={tones[definition.tone]}>
      <Icon size={12} weight="bold" aria-hidden />
      {definition.label}
    </Badge>
  );
}
