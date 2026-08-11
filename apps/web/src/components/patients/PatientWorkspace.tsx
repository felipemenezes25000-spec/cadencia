'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarBlank,
  CheckCircle,
  Envelope,
  MapPin,
  PencilSimple,
  Phone,
  Plus,
  WarningCircle,
} from '@phosphor-icons/react';
import { mockRepository } from '../../data/mockRepository';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Tabs } from '../ui/Tabs';

type PatientTab = 'summary' | 'record' | 'history' | 'finance' | 'documents' | 'communications';

const tabs = [
  { id: 'summary', label: 'Resumo' }, { id: 'record', label: 'Prontuário' },
  { id: 'history', label: 'Histórico' }, { id: 'finance', label: 'Financeiro' },
  { id: 'documents', label: 'Documentos' }, { id: 'communications', label: 'Comunicações' },
] as const;

export function PatientWorkspace({ patientId }: { readonly patientId: string }) {
  const router = useRouter();
  const patient = mockRepository.getPatient(patientId);
  const [activeTab, setActiveTab] = useState<PatientTab>('summary');

  if (!patient) return <div className="clinical-page"><p>Paciente não encontrado.</p></div>;

  return (
    <div className="clinical-page space-y-5">
      <button type="button" onClick={() => router.back()} className="flex items-center gap-2 rounded-md text-xs font-semibold text-text-secondary hover:text-text-primary"><ArrowLeft size={16} />Paciente</button>

      <header className="rounded-xl border border-border bg-surface p-5 shadow-elev-1">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar initials={patient.initials} name={patient.name} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-text-primary">{patient.name}</h1>
            <p className="mt-1 text-sm text-text-secondary">{patient.age} anos · {patient.gender} · CPF {patient.cpf}</p>
            <div className="mt-3 flex flex-wrap gap-2"><Badge tone="brand">{patient.insurer}</Badge><Badge>Cliente desde {patient.clientSince}</Badge></div>
          </div>
          <div className="flex gap-2"><Button iconLeft={PencilSimple}>Editar</Button><Button variant="primary" iconLeft={Plus} onClick={() => router.push('/agenda?novo=1')}>Novo atendimento</Button></div>
        </div>
        {patient.allergies.length > 0 ? <div role="alert" className="mt-4 flex items-center gap-3 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3"><WarningCircle size={20} weight="fill" className="shrink-0 text-danger" /><div><p className="text-[10px] font-bold uppercase tracking-[.08em] text-danger">Alerta demonstrativo</p><p className="text-sm font-bold text-danger">{patient.allergies.join(', ')}</p></div></div> : null}
      </header>

      <div className="border-b border-border"><Tabs items={tabs} active={activeTab} onChange={setActiveTab} label="Seções do paciente" /></div>

      {activeTab === 'summary' ? <PatientSummary patientId={patient.id} /> : <PatientTabContent tab={activeTab} />}
    </div>
  );
}

function PatientSummary({ patientId }: { readonly patientId: string }) {
  const router = useRouter();
  const patient = mockRepository.getPatient(patientId);
  if (!patient) return null;
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-5">
        <Panel title="Informações">
          <dl className="divide-y divide-border">
            <ContactLine icon={MapPin} label="Endereço" value={patient.address} />
            <ContactLine icon={Phone} label="Telefone" value={patient.phone} />
            <ContactLine icon={Envelope} label="E-mail" value={patient.email} />
            <DetailLine label="Convênio" value={patient.insurer} />
            <DetailLine label="Plano" value={patient.plan} />
          </dl>
        </Panel>
        <Panel title="Resumo clínico">
          <dl className="space-y-4"><ClinicalSummary label="Última consulta" value="Registro demonstrativo" /><ClinicalSummary label="Diagnósticos" value="Conteúdo clínico demonstrativo" /><ClinicalSummary label="Alertas" value={patient.allergies.join(', ') || 'Nenhum registrado'} danger={patient.allergies.length > 0} /><ClinicalSummary label="Medicações" value={patient.medications.join(', ') || 'Nenhuma registrada'} /></dl>
        </Panel>
      </div>

      <Panel title="Histórico de atendimentos" description="Linha do tempo clínica">
        <div className="relative ml-2 border-l border-border">
          <TimelineItem date="Data demo 01" title="Evento demonstrativo" professional="Profissional Demo A" />
          <TimelineItem date="Data demo 02" title="Evento demonstrativo" professional="Profissional Demo B" />
          <TimelineItem date="Data demo 03" title="Evento demonstrativo" professional="Profissional Demo C" />
          <TimelineItem date="Data demo 04" title="Evento demonstrativo" professional="Profissional Demo A" />
        </div>
        <Button variant="ghost" size="sm" fullWidth className="mt-3">Ver todos</Button>
      </Panel>

      <Panel title="Próximos passos" description="Ações com impacto no cuidado">
        <div className="divide-y divide-border">
          <NextStep icon={CalendarBlank} tone="brand" label="Retorno" value="Agendamento demonstrativo" />
          <NextStep icon={WarningCircle} tone="danger" label="Exames pendentes" value="Item demonstrativo" />
          <NextStep icon={CheckCircle} tone="warning" label="Cobrança em aberto" value="Valor demonstrativo" />
        </div>
        <Button fullWidth className="mt-4" onClick={() => router.push('/financeiro')}>Ver financeiro</Button>
      </Panel>
    </div>
  );
}

function Panel({ title, description, children }: { readonly title: string; readonly description?: string; readonly children: React.ReactNode }) {
  return <section className="rounded-xl border border-border bg-surface"><header className="border-b border-border px-4 py-3.5"><h2 className="text-base font-bold text-text-primary">{title}</h2>{description ? <p className="mt-0.5 text-xs text-text-secondary">{description}</p> : null}</header><div className="p-4">{children}</div></section>;
}

function ContactLine({ icon: Icon, label, value }: { readonly icon: typeof MapPin; readonly label: string; readonly value: string }) {
  return <div className="flex gap-3 py-3 first:pt-0 last:pb-0"><Icon size={17} className="mt-0.5 shrink-0 text-text-tertiary" /><div className="min-w-0"><dt className="text-[11px] font-semibold text-text-tertiary">{label}</dt><dd className="mt-0.5 break-words text-sm font-medium text-text-primary">{value}</dd></div></div>;
}

function DetailLine({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"><dt className="text-xs text-text-secondary">{label}</dt><dd className="text-right text-sm font-semibold text-text-primary">{value}</dd></div>;
}

function ClinicalSummary({ label, value, danger = false }: { readonly label: string; readonly value: string; readonly danger?: boolean }) {
  return <div><dt className="text-[11px] font-semibold text-text-tertiary">{label}</dt><dd className={`mt-1 text-sm font-medium ${danger ? 'text-danger' : 'text-text-primary'}`}>{value}</dd></div>;
}

function TimelineItem({ date, title, professional }: { readonly date: string; readonly title: string; readonly professional: string }) {
  return <div className="relative pb-5 pl-5 last:pb-0"><span className="absolute -left-1.5 top-1 size-3 rounded-full border-2 border-surface bg-brand" /><time className="text-[11px] tabular-nums text-text-tertiary">{date}</time><p className="mt-0.5 text-sm font-bold text-text-primary">{title}</p><p className="text-xs text-text-secondary">{professional}</p></div>;
}

function NextStep({ icon: Icon, tone, label, value }: { readonly icon: typeof CalendarBlank; readonly tone: 'brand' | 'danger' | 'warning'; readonly label: string; readonly value: string }) {
  const toneClass = tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-brand-soft text-brand';
  return <div className="flex gap-3 py-4 first:pt-0 last:pb-0"><span className={`grid size-8 shrink-0 place-items-center rounded-lg ${toneClass}`}><Icon size={16} aria-hidden /></span><div><p className="text-xs font-semibold text-text-secondary">{label}</p><p className="mt-0.5 text-sm font-bold text-text-primary">{value}</p></div></div>;
}

function PatientTabContent({ tab }: { readonly tab: Exclude<PatientTab, 'summary'> }) {
  const labels: Record<Exclude<PatientTab, 'summary'>, { title: string; description: string }> = {
    record: { title: 'Prontuário', description: 'Evoluções, diagnósticos, sinais vitais e documentos clínicos em ordem cronológica.' },
    history: { title: 'Histórico', description: 'Todos os atendimentos e eventos relevantes deste paciente.' },
    finance: { title: 'Financeiro', description: 'Títulos, pagamentos e convênios vinculados ao paciente.' },
    documents: { title: 'Documentos', description: 'Receitas, pedidos, atestados, laudos e anexos.' },
    communications: { title: 'Comunicações', description: 'Mensagens, lembretes e registros de contato.' },
  };
  const content = labels[tab];
  return <section className="rounded-xl border border-border bg-surface px-6 py-12 text-center"><h2 className="text-lg font-bold text-text-primary">{content.title}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-text-secondary">{content.description}</p><Button className="mt-4">Abrir visão completa</Button></section>;
}
