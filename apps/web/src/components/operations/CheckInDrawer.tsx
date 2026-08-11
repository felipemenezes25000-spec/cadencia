'use client';

import { CheckCircle, Circle, WarningCircle } from '@phosphor-icons/react';
import type { Appointment } from '../../domain/appointments/types';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';

function CheckItem({ label, state, detail }: {
  readonly label: string;
  readonly state: 'ok' | 'warning' | 'neutral';
  readonly detail: string;
}) {
  const Icon = state === 'ok' ? CheckCircle : state === 'warning' ? WarningCircle : Circle;
  const color = state === 'ok' ? 'text-success' : state === 'warning' ? 'text-warning' : 'text-text-tertiary';
  return (
    <div className="flex items-start gap-3 border-b border-border py-4 last:border-b-0">
      <Icon size={20} weight={state === 'neutral' ? 'regular' : 'fill'} className={`mt-0.5 shrink-0 ${color}`} aria-hidden />
      <div><h3 className="text-xs font-bold uppercase tracking-[.06em] text-text-tertiary">{label}</h3><p className="mt-1 text-sm font-medium text-text-primary">{detail}</p></div>
    </div>
  );
}

export function CheckInDrawer({ appointment, onClose, onComplete }: {
  readonly appointment: Appointment | null;
  readonly onClose: () => void;
  readonly onComplete: (appointment: Appointment) => void;
}) {
  const blocked = appointment?.alert !== null && appointment?.alert !== undefined;
  return (
    <Drawer
      open={appointment !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Check-in"
      description={appointment ? `${appointment.patientName} · ${appointment.time} · ${appointment.procedure}` : undefined}
      footer={appointment ? (
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={blocked} onClick={() => onComplete(appointment)}>Concluir check-in</Button></div>
      ) : undefined}
    >
      {appointment ? (
        <>
          <CheckItem label="Identificação" state="ok" detail="Cadastro confirmado" />
          <CheckItem label="Convênio" state={blocked ? 'warning' : 'ok'} detail={blocked ? 'Guia precisa de autorização' : 'Elegibilidade confirmada'} />
          <CheckItem label="Documentos" state="ok" detail="Consentimento recebido" />
          <CheckItem label="Pagamento" state="neutral" detail="Não aplicável" />
          {blocked ? (
            <div role="alert" className="mt-5 rounded-xl border border-warning/20 bg-warning-soft p-4">
              <p className="text-sm font-semibold text-warning">Não é possível concluir o check-in.</p>
              <p className="mt-1 text-sm text-warning">A autorização da {appointment.insurer} ainda está pendente.</p>
              <Button size="sm" className="mt-3 border-warning/25 bg-surface text-warning hover:bg-warning-soft">Resolver autorização</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
