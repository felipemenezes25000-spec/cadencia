'use client';

import { CalendarBlank, CheckCircle, IdentificationCard, WarningCircle } from '@phosphor-icons/react';
import type { OperationalAppointment } from '../../domain/appointments/queue';
import { Avatar } from '../../ui/Avatar';
import { Botao } from '../../ui/Botao';
import { PainelLateral } from '../../ui/PainelLateral';
import { Skeleton } from '../../ui/Skeleton';

export interface PatientQuickSummary {
  readonly patientId: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly birthDate: string | null;
  readonly phonePrimary: string | null;
  readonly email: string | null;
  readonly cadastroStatus: 'completo' | 'preliminar';
  readonly pendentes: readonly string[];
}

function idade(data: string | null): string | null {
  if (!data) return null;
  const nascimento = new Date(`${data}T12:00:00`);
  const hoje = new Date();
  let anos = hoje.getFullYear() - nascimento.getFullYear();
  if (hoje.getMonth() < nascimento.getMonth()
      || (hoje.getMonth() === nascimento.getMonth() && hoje.getDate() < nascimento.getDate())) anos -= 1;
  return `${anos} anos`;
}

export function PatientQuickView({
  appointment,
  summary,
  loading,
  open,
  onClose,
  onOpenPatient,
  onOpenAppointment,
  contextDescription = 'Contexto essencial sem sair do fluxo atual',
  appointmentActionLabel,
}: {
  readonly appointment: OperationalAppointment | null;
  readonly summary: PatientQuickSummary | null;
  readonly loading: boolean;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onOpenPatient: () => void;
  readonly onOpenAppointment?: () => void;
  readonly contextDescription?: string;
  readonly appointmentActionLabel?: string;
}) {
  const nome = summary?.displayName ?? appointment?.displayName ?? 'Paciente';
  return (
    <PainelLateral
      aberto={open}
      onFechar={onClose}
      titulo="Visão rápida do paciente"
      descricao={contextDescription}
      largura="md"
      rodape={appointment ? (
        <div className={onOpenAppointment ? 'grid grid-cols-2 gap-2' : 'grid'}>
          <Botao variante="secundario" onClick={onOpenPatient}>Abrir paciente</Botao>
          {onOpenAppointment ? (
            <Botao onClick={onOpenAppointment}>
              {appointmentActionLabel ?? (appointment.encounterId ? 'Abrir atendimento' : 'Iniciar atendimento')}
            </Botao>
          ) : null}
        </div>
      ) : undefined}
    >
      {appointment ? (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar nome={nome} tamanho="lg" />
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-text">{nome}</p>
              <p className="mt-0.5 text-sm text-text-muted">
                {[idade(summary?.birthDate ?? null), summary?.phonePrimary].filter(Boolean).join(' · ') || 'Dados pessoais na ficha completa'}
              </p>
            </div>
          </div>

          {loading ? <Skeleton variant="card" height="112px" /> : (
            <>
              <QuickSection icon={IdentificationCard} title="Identificação">
                <p>{summary?.cadastroStatus === 'preliminar' ? 'Cadastro preliminar' : 'Cadastro confirmado'}</p>
                {summary?.email ? <p className="break-words text-text-muted">{summary.email}</p> : null}
              </QuickSection>
              <QuickSection icon={CalendarBlank} title="Atendimento de hoje">
                <p className="font-semibold text-text">{appointment.procedureNome ?? (appointment.teleconsulta ? 'Teleconsulta' : 'Atendimento')}</p>
                <p className="text-text-muted">{appointment.professionalNome ?? appointment.professionalId}</p>
              </QuickSection>
              <QuickSection icon={CheckCircle} title="Convênio / pagador">
                <p>{appointment.operadoraNome ?? 'Particular'}</p>
              </QuickSection>
              <QuickSection icon={summary?.pendentes.length ? WarningCircle : CheckCircle} title="Pendências cadastrais" warning={Boolean(summary?.pendentes.length)}>
                {summary?.pendentes.length ? (
                  <ul className="list-disc space-y-1 pl-4">
                    {summary.pendentes.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : <p>Nenhuma pendência identificada</p>}
              </QuickSection>
            </>
          )}
        </div>
      ) : null}
    </PainelLateral>
  );
}

function QuickSection({ icon: Icone, title, warning = false, children }: {
  readonly icon: typeof CalendarBlank;
  readonly title: string;
  readonly warning?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.08em] text-text-faint">
        <Icone size={16} className={warning ? 'text-warn' : 'text-accent'} aria-hidden />
        {title}
      </h3>
      <div className="space-y-1 text-sm text-text">{children}</div>
    </section>
  );
}
