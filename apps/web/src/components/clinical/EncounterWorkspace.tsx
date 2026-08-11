'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  ClipboardText,
  DotsThreeVertical,
  FileText,
  FirstAid,
  Flask,
  NotePencil,
  PaperPlaneTilt,
  Pill,
  Stethoscope,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { mockRepository } from '../../data/mockRepository';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

type SaveState = 'saved' | 'saving' | 'error';
type ClinicalSectionId = 'summary' | 'anamnesis' | 'exam' | 'plan' | 'prescription' | 'orders' | 'documents' | 'history';

const navigation: readonly { id: ClinicalSectionId; label: string; icon: PhosphorIcon }[] = [
  { id: 'summary', label: 'Resumo', icon: ClipboardText },
  { id: 'anamnesis', label: 'Anamnese', icon: NotePencil },
  { id: 'exam', label: 'Exame físico', icon: Stethoscope },
  { id: 'plan', label: 'Conduta', icon: FirstAid },
  { id: 'prescription', label: 'Receituário', icon: Pill },
  { id: 'orders', label: 'Pedidos', icon: Flask },
  { id: 'documents', label: 'Documentos', icon: FileText },
  { id: 'history', label: 'Histórico', icon: ClipboardText },
];

export function EncounterWorkspace({ encounterId }: { readonly encounterId: string }) {
  const router = useRouter();
  const appointment = mockRepository.getAppointment(encounterId);
  const patient = appointment ? mockRepository.getPatient(appointment.patientId) : undefined;
  const [activeSection, setActiveSection] = useState<ClinicalSectionId>('anamnesis');
  const [complaint, setComplaint] = useState('Queixa clínica demonstrativa para validação da interface.');
  const [history, setHistory] = useState('História clínica inteiramente fictícia. Nenhum conteúdo deste registro pertence a uma pessoa real.');
  const [background, setBackground] = useState('Antecedentes demonstrativos não vinculados a pessoa real.');
  const [habits, setHabits] = useState('Informações demonstrativas para validação do campo.');
  const [plan, setPlan] = useState('Conduta demonstrativa. Não utilizar este conteúdo para decisões clínicas.');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState('10:42');
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      setSaveState('saved');
      setSavedAt(new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date()));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [complaint, history, background, habits, plan]);

  if (!appointment || !patient) {
    return <div className="clinical-page"><div className="rounded-xl border border-border bg-surface px-6 py-14 text-center"><p className="font-semibold">Atendimento não encontrado</p><Button className="mt-4" onClick={() => router.push('/hoje')}>Voltar para Hoje</Button></div></div>;
  }

  return (
    <div className="min-h-[calc(100vh-68px)] bg-canvas">
      <header className="sticky top-[68px] z-[15] border-b border-border bg-surface/97 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-4 px-[var(--page-gutter)] py-3">
          <button type="button" onClick={() => router.back()} className="flex items-center gap-2 rounded-lg text-xs font-semibold text-text-secondary hover:text-text-primary"><ArrowLeft size={17} />Atendimento</button>
          <div className="h-8 w-px bg-border max-sm:hidden" />
          <Avatar initials={patient.initials} name={patient.name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-base font-bold text-text-primary">{patient.name}</h1><StatusBadge status="in_progress" /></div>
            <p className="truncate text-xs text-text-secondary">{patient.age} anos · {patient.gender} · {appointment.procedure} · {appointment.time} · {appointment.professional}</p>
          </div>
          <Badge tone="brand" className="max-lg:hidden">{patient.insurer}</Badge>
          <SaveIndicator state={saveState} savedAt={savedAt} onRetry={() => setSaveState('saving')} />
          <IconButton icon={DotsThreeVertical} label="Mais ações do atendimento" />
          <Button variant="primary" onClick={() => setActiveSection('plan')}>Finalizar atendimento</Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] items-start gap-6 px-[var(--page-gutter)] py-6 lg:grid-cols-[188px_minmax(0,1fr)]">
        <nav aria-label="Seções do atendimento" className="sticky top-[158px] hidden rounded-xl border border-border bg-surface p-2 lg:block">
          {navigation.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" onClick={() => { setActiveSection(item.id); document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className={cn('flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-xs font-semibold transition-colors-fast', activeSection === item.id ? 'bg-brand-soft text-brand' : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary')}><Icon size={17} weight={activeSection === item.id ? 'fill' : 'regular'} />{item.label}</button>;
          })}
        </nav>

        <div className="min-w-0">
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1.5 lg:hidden">{navigation.slice(0, 5).map((item) => <button key={item.id} type="button" onClick={() => setActiveSection(item.id)} className={cn('h-9 shrink-0 rounded-lg px-3 text-xs font-semibold', activeSection === item.id ? 'bg-brand-soft text-brand' : 'text-text-secondary')}>{item.label}</button>)}</div>
          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <main className="min-w-0 space-y-5">
              <ClinicalSection id="summary" title="Contexto do atendimento" description="Informações essenciais para a decisão clínica.">
                <div className="grid gap-3 sm:grid-cols-3"><Info label="Motivo" value="Motivo demonstrativo" /><Info label="Última consulta" value="Data demonstrativa" /><Info label="Risco atual" value="Não informado" /></div>
              </ClinicalSection>
              <ClinicalSection id="anamnesis" title="Anamnese" description="Registro estruturado da história clínica atual.">
                <ClinicalField label="Queixa principal" value={complaint} onChange={setComplaint} rows={2} />
                <ClinicalField label="História da doença atual" value={history} onChange={setHistory} rows={5} />
                <div className="grid gap-4 md:grid-cols-2"><ClinicalField label="Antecedentes" value={background} onChange={setBackground} rows={4} /><ClinicalField label="Hábitos" value={habits} onChange={setHabits} rows={4} /></div>
                <div className="grid gap-4 md:grid-cols-2"><Info label="Medicamentos em uso" value={patient.medications.join(', ') || 'Nenhum informado'} /><Info label="Alergias" value={patient.allergies.join(', ') || 'Nenhuma registrada'} tone={patient.allergies.length > 0 ? 'danger' : 'default'} /></div>
              </ClinicalSection>
              <ClinicalSection id="exam" title="Exame físico" description="Sinais vitais e achados objetivos.">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><VitalInput label="Pressão arterial" value="—" unit="mmHg" /><VitalInput label="Frequência cardíaca" value="—" unit="bpm" /><VitalInput label="Temperatura" value="—" unit="°C" /><VitalInput label="Peso" value="—" unit="kg" /><VitalInput label="Altura" value="—" unit="m" /><VitalInput label="IMC" value="—" unit="" /></div>
                <ClinicalField label="Achados do exame" value="Conteúdo demonstrativo sem informação clínica real." onChange={() => undefined} rows={4} />
              </ClinicalSection>
              <ClinicalSection id="plan" title="Conduta" description="Plano terapêutico, orientações e acompanhamento.">
                <ClinicalField label="Plano e orientações" value={plan} onChange={setPlan} rows={6} />
              </ClinicalSection>
            </main>

            <aside className="space-y-4 xl:sticky xl:top-[158px]">
              <section className="rounded-xl border border-border bg-surface p-4"><h2 className="text-base font-bold text-text-primary">Sinais vitais</h2><dl className="mt-3 divide-y divide-border"><VitalLine label="PA" value="Não informado" /><VitalLine label="FC" value="Não informado" /><VitalLine label="Temperatura" value="Não informado" /><VitalLine label="Peso" value="Não informado" /><VitalLine label="Altura" value="Não informado" /><VitalLine label="IMC" value="Não informado" /></dl></section>
              <section className="rounded-xl border border-border bg-surface p-4"><h2 className="text-base font-bold text-text-primary">Ações rápidas</h2><div className="mt-3 grid gap-2"><QuickAction icon={Pill} label="Prescrição" /><QuickAction icon={Flask} label="Pedido de exame" /><QuickAction icon={FileText} label="Atestado" /><QuickAction icon={PaperPlaneTilt} label="Encaminhamento" /></div></section>
              {patient.allergies.length > 0 ? <section role="alert" className="rounded-xl border border-danger/20 bg-danger-soft p-4"><p className="text-[10px] font-bold uppercase tracking-[.08em] text-danger">Alerta demonstrativo</p><p className="mt-1 text-sm font-bold text-danger">{patient.allergies.join(', ')}</p></section> : null}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ state, savedAt, onRetry }: { readonly state: SaveState; readonly savedAt: string; readonly onRetry: () => void }) {
  if (state === 'error') return <div className="text-right"><p className="text-xs font-semibold text-danger">Não foi possível salvar</p><button type="button" onClick={onRetry} className="text-[11px] font-semibold text-brand underline">Tentar novamente</button></div>;
  return <span role="status" className={cn('flex items-center gap-1.5 text-xs font-semibold', state === 'saving' ? 'text-text-secondary' : 'text-success')}>{state === 'saved' ? <Check size={15} weight="bold" /> : <span className="size-2 animate-pulse rounded-full bg-warning" />}{state === 'saved' ? `Salvo às ${savedAt}` : 'Salvando...'}</span>;
}

function ClinicalSection({ id, title, description, children }: { readonly id: string; readonly title: string; readonly description: string; readonly children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-[164px] rounded-xl border border-border bg-surface"><header className="border-b border-border px-5 py-4"><h2 className="text-lg font-bold tracking-tight text-text-primary">{title}</h2><p className="mt-0.5 text-xs text-text-secondary">{description}</p></header><div className="space-y-4 p-5">{children}</div></section>;
}

function ClinicalField({ label, value, onChange, rows }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly rows: number }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-text-primary">{label}</span><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm leading-relaxed text-text-primary outline-none transition-colors-fast placeholder:text-text-tertiary hover:border-border-strong focus:border-brand focus:ring-2 focus:ring-brand/10" /></label>;
}

function Info({ label, value, tone = 'default' }: { readonly label: string; readonly value: string; readonly tone?: 'default' | 'danger' }) {
  return <div className={cn('rounded-lg border p-3', tone === 'danger' ? 'border-danger/20 bg-danger-soft' : 'border-border bg-surface-subtle')}><p className={cn('text-[11px] font-semibold', tone === 'danger' ? 'text-danger' : 'text-text-secondary')}>{label}</p><p className={cn('mt-1 text-sm font-semibold', tone === 'danger' ? 'text-danger' : 'text-text-primary')}>{value}</p></div>;
}

function VitalInput({ label, value, unit }: { readonly label: string; readonly value: string; readonly unit: string }) {
  return <label className="rounded-lg border border-border bg-surface-subtle p-3"><span className="block text-[11px] font-semibold text-text-secondary">{label}</span><span className="mt-1 flex items-baseline gap-1"><input defaultValue={value} className="min-w-0 flex-1 bg-transparent text-base font-bold tabular-nums text-text-primary outline-none" aria-label={label} /><span className="text-[10px] text-text-tertiary">{unit}</span></span></label>;
}

function VitalLine({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="flex items-center justify-between py-2 text-sm"><dt className="text-text-secondary">{label}</dt><dd className="font-semibold tabular-nums text-text-primary">{value}</dd></div>;
}

function QuickAction({ icon: Icon, label }: { readonly icon: PhosphorIcon; readonly label: string }) {
  return <button type="button" className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-left text-xs font-semibold text-brand transition-colors-fast hover:border-brand/25 hover:bg-brand-soft"><Icon size={16} aria-hidden />{label}</button>;
}
