'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import type { Appointment } from '../../domain/appointments/types';
import { mockRepository } from '../../data/mockRepository';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';

function DetailSection({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <section className="border-b border-border py-4 first:pt-0 last:border-b-0">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-text-tertiary">{label}</h3>
      {children}
    </section>
  );
}

export function PatientQuickView({ appointment, onClose }: {
  readonly appointment: Appointment | null;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const patient = appointment ? mockRepository.getPatient(appointment.patientId) : undefined;
  return (
    <Drawer
      open={appointment !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Visão rápida do paciente"
      description="Contexto essencial sem perder o fluxo operacional"
      footer={appointment && patient ? (
        <div className="flex gap-2">
          <Button fullWidth onClick={() => router.push(`/pacientes/${patient.id}`)}>Abrir paciente</Button>
          <Button fullWidth variant="primary" onClick={() => router.push(`/atendimentos/${appointment.encounterId}`)}>Abrir atendimento</Button>
        </div>
      ) : undefined}
    >
      {appointment && patient ? (
        <>
          <div className="flex items-center gap-4 pb-5">
            <Avatar initials={patient.initials} name={patient.name} size="xl" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-text-primary">{patient.name}</h2>
              <p className="mt-0.5 text-sm text-text-secondary">{patient.age} anos · {patient.gender}</p>
              <div className="mt-2"><Badge tone="brand">{patient.insurer}</Badge></div>
            </div>
          </div>
          <DetailSection label="Atendimento de hoje">
            <div className="grid grid-cols-[72px_1fr] gap-y-1 text-sm">
              <span className="text-text-secondary">Horário</span><strong className="tabular-nums">{appointment.time}</strong>
              <span className="text-text-secondary">Tipo</span><span>{appointment.procedure}</span>
              <span className="text-text-secondary">Profissional</span><span>{appointment.professional}</span>
            </div>
          </DetailSection>
          <DetailSection label="Alertas clínicos">
            {patient.allergies.length > 0 ? (
              <div className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger"><WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" /><span><strong>Alerta demonstrativo</strong><br />{patient.allergies.join(', ')}</span></div>
            ) : <p className="flex items-center gap-2 text-sm text-success"><CheckCircle size={17} weight="fill" />Nenhum alerta clínico registrado</p>}
          </DetailSection>
          <DetailSection label="Convênio">
            <p className="text-sm font-semibold text-text-primary">{patient.insurer}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-success"><CheckCircle size={14} weight="fill" />Elegibilidade confirmada</p>
          </DetailSection>
          <DetailSection label="Último atendimento">
            <p className="text-sm font-semibold text-text-primary">Data demonstrativa · Retorno</p>
            <p className="mt-1 text-xs text-text-secondary">Registro fictício para validação da interface</p>
          </DetailSection>
          <DetailSection label="Pendências">
            <p className="text-sm text-text-secondary">{appointment.alert ?? 'Nenhuma pendência operacional.'}</p>
          </DetailSection>
        </>
      ) : null}
    </Drawer>
  );
}
