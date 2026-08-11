'use client';

import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  CalendarBlank,
  CheckCircle,
  DotsThreeVertical,
  FunnelSimple,
  MagnifyingGlass,
  Plus,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type { FinanceEntry } from '../../data/mockRepository';
import { mockRepository } from '../../data/mockRepository';
import { useToast } from '../../ui/ToastProvider';
import { Badge, type BadgeTone } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { PageHeader } from '../ui/PageHeader';
import { Tabs } from '../ui/Tabs';

type FinanceTab = 'summary' | 'receivable' | 'invoices' | 'payments' | 'reports';

const tabs = [
  { id: 'summary', label: 'Resumo' }, { id: 'receivable', label: 'Contas a receber' },
  { id: 'invoices', label: 'Faturas' }, { id: 'payments', label: 'Pagamentos' },
  { id: 'reports', label: 'Relatórios' },
] as const;

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function FinanceWorkspace() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<FinanceTab>('summary');
  const [entries, setEntries] = useState<FinanceEntry[]>(() => [...mockRepository.listFinanceEntries()]);
  const [selected, setSelected] = useState<FinanceEntry | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FinanceEntry | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  const visible = useMemo(() => entries.filter((entry) => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return (normalized === '' || `${entry.patientName} ${entry.description}`.toLocaleLowerCase('pt-BR').includes(normalized))
      && (status === 'all' || entry.status === status);
  }), [entries, query, status]);

  function markPaid(entry: FinanceEntry) {
    setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'paid' } : item));
    setSelected(null);
    toast({ tipo: 'sucesso', mensagem: `Pagamento de ${currency.format(entry.amount)} registrado para ${entry.patientName}.` });
  }

  function cancel(entry: FinanceEntry) {
    setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, status: 'cancelled' } : item));
    setCancelTarget(null);
    toast({ tipo: 'info', mensagem: `Título de ${entry.patientName} cancelado.` });
  }

  return (
    <div className="clinical-page space-y-5">
      <PageHeader title="Financeiro" description="Gestão financeira da unidade" actions={<Button iconLeft={FunnelSimple}>Filtros</Button>} />
      <div className="border-b border-border"><Tabs items={tabs} active={activeTab} onChange={setActiveTab} label="Seções do financeiro" /></div>

      <section aria-label="Indicadores financeiros" className="grid overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-2 xl:grid-cols-4">
        <FinancialMetric label="A receber" value="R$ 24.580,00" detail="12 títulos" tone="brand" />
        <FinancialMetric label="Vencidos" value="R$ 3.450,00" detail="8 títulos" tone="danger" />
        <FinancialMetric label="Recebidos no mês" value="R$ 18.750,00" detail="+15% vs. mês anterior" tone="success" />
        <FinancialMetric label="Cancelados" value="R$ 580,00" detail="0,8% do período" tone="neutral" />
      </section>

      <section aria-labelledby="receivables-title" className="overflow-hidden rounded-xl border border-border bg-surface shadow-elev-1">
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5">
          <div className="mr-auto"><h2 id="receivables-title" className="text-base font-bold text-text-primary">Contas a receber</h2><p className="text-xs text-text-secondary">Títulos e recebimentos da unidade</p></div>
          <label className="relative min-w-[210px] flex-1 sm:max-w-[280px]"><span className="sr-only">Buscar paciente</span><MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-2.5 text-text-tertiary" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar paciente" className="h-9 w-full rounded-lg border border-border pl-9 pr-3 text-xs outline-none focus:border-brand" /></label>
          <label><span className="sr-only">Período</span><select className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-secondary"><option>Este mês</option><option>Últimos 30 dias</option></select></label>
          <label><span className="sr-only">Status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-text-secondary"><option value="all">Todos os status</option><option value="due">A vencer</option><option value="paid">Pago</option><option value="overdue">Vencido</option><option value="cancelled">Cancelado</option></select></label>
          <Button variant="primary" iconLeft={Plus}>Novo recebimento</Button>
        </header>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[820px] text-left">
            <thead className="bg-surface-subtle"><tr><th className="px-4 py-2.5">Paciente</th><th className="px-4 py-2.5">Descrição</th><th className="px-4 py-2.5">Atendimento</th><th className="px-4 py-2.5">Vencimento</th><th className="px-4 py-2.5 text-right">Valor</th><th className="px-4 py-2.5">Status</th><th className="w-12 px-4 py-2.5"><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>{visible.map((entry) => <FinanceRow key={entry.id} entry={entry} onSelect={() => setSelected(entry)} />)}</tbody>
          </table>
        </div>
        <div className="md:hidden">{visible.map((entry) => <button key={entry.id} type="button" onClick={() => setSelected(entry)} className="flex w-full items-start gap-3 border-b border-border p-4 text-left last:border-b-0"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{entry.patientName}</span><span className="block text-xs text-text-secondary">{entry.description} · vence {entry.dueDate}</span><span className="mt-1 block font-bold tabular-nums">{currency.format(entry.amount)}</span></span><PaymentStatusBadge status={entry.status} /></button>)}</div>
        {visible.length === 0 ? <div className="px-6 py-12 text-center"><p className="font-semibold">Nenhum título neste filtro</p><p className="mt-1 text-sm text-text-secondary">Altere o status ou busque outro paciente.</p></div> : null}
      </section>

      <FinanceDrawer entry={selected} onClose={() => setSelected(null)} onPaid={markPaid} onCancel={(entry) => { setSelected(null); setCancelTarget(entry); }} />
      <CancelDialog entry={cancelTarget} onClose={() => setCancelTarget(null)} onConfirm={cancel} />
    </div>
  );
}

function FinancialMetric({ label, value, detail, tone }: { readonly label: string; readonly value: string; readonly detail: string; readonly tone: 'brand' | 'danger' | 'success' | 'neutral' }) {
  const detailClass = tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : tone === 'brand' ? 'text-brand' : 'text-text-tertiary';
  return <div className="min-h-[104px] border-r border-border p-4 last:border-r-0 max-sm:border-b max-sm:border-r-0"><p className="text-xs font-semibold text-text-secondary">{label}</p><p className="mt-2 text-xl font-bold tabular-nums text-text-primary">{value}</p><p className={`mt-1 text-[11px] font-semibold ${detailClass}`}>{detail}</p></div>;
}

function FinanceRow({ entry, onSelect }: { readonly entry: FinanceEntry; readonly onSelect: () => void }) {
  return <tr tabIndex={0} aria-label={`Abrir título de ${entry.patientName}`} onClick={onSelect} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }} className="cursor-pointer border-b border-border transition-colors-fast hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-[-2px]"><td className="border-b border-border px-4 py-3 text-sm font-semibold text-text-primary">{entry.patientName}</td><td className="border-b border-border px-4 py-3 text-sm text-text-secondary">{entry.description}</td><td className="border-b border-border px-4 py-3 text-xs tabular-nums text-text-secondary">{entry.encounterDate}</td><td className="border-b border-border px-4 py-3 text-xs tabular-nums text-text-secondary">{entry.dueDate}</td><td className="border-b border-border px-4 py-3 text-right text-sm font-bold tabular-nums">{currency.format(entry.amount)}</td><td className="border-b border-border px-4 py-3"><PaymentStatusBadge status={entry.status} /></td><td className="border-b border-border px-4 py-3"><span className="grid size-8 place-items-center text-text-tertiary" aria-hidden><DotsThreeVertical size={17} /></span></td></tr>;
}

function PaymentStatusBadge({ status }: { readonly status: FinanceEntry['status'] }) {
  const labels = { due: 'A vencer', paid: 'Pago', overdue: 'Vencido', cancelled: 'Cancelado' } as const;
  const tones = { due: 'info', paid: 'success', overdue: 'danger', cancelled: 'neutral' } as const satisfies Record<FinanceEntry['status'], BadgeTone>;
  return <Badge tone={tones[status]}>{status === 'paid' ? <CheckCircle size={12} weight="bold" /> : status === 'overdue' ? <WarningCircle size={12} weight="bold" /> : <CalendarBlank size={12} />}{labels[status]}</Badge>;
}

function FinanceDrawer({ entry, onClose, onPaid, onCancel }: { readonly entry: FinanceEntry | null; readonly onClose: () => void; readonly onPaid: (entry: FinanceEntry) => void; readonly onCancel: (entry: FinanceEntry) => void }) {
  return <Drawer open={entry !== null} onOpenChange={(open) => { if (!open) onClose(); }} title="Detalhes do título" description={entry?.patientName} footer={entry ? <div className="space-y-2"><Button fullWidth variant="primary" disabled={entry.status === 'paid' || entry.status === 'cancelled'} onClick={() => onPaid(entry)}>Registrar pagamento</Button><div className="grid grid-cols-2 gap-2"><Button>Enviar cobrança</Button><Button>Editar</Button></div><Button fullWidth variant="ghost" className="text-danger" disabled={entry.status === 'cancelled'} onClick={() => onCancel(entry)}>Cancelar título</Button></div> : undefined}>{entry ? <><div className="rounded-xl border border-border bg-surface-subtle p-4"><p className="text-sm font-semibold text-text-secondary">Valor</p><p className="mt-1 text-2xl font-bold tabular-nums">{currency.format(entry.amount)}</p><div className="mt-3"><PaymentStatusBadge status={entry.status} /></div></div><dl className="mt-5 grid grid-cols-[120px_1fr] gap-y-3 text-sm"><dt className="text-text-secondary">Paciente</dt><dd className="font-semibold">{entry.patientName}</dd><dt className="text-text-secondary">Atendimento</dt><dd>{entry.description} · {entry.encounterDate}</dd><dt className="text-text-secondary">Convênio</dt><dd>{entry.insurer}</dd><dt className="text-text-secondary">Vencimento</dt><dd className="tabular-nums">{entry.dueDate}</dd></dl><section className="mt-6 border-t border-border pt-5"><h3 className="text-sm font-bold">Histórico</h3><ol className="mt-3 space-y-3"><HistoryItem label="Título criado" date="01/08 · 09:12" done /><HistoryItem label="Fatura enviada" date="01/08 · 09:14" done /><HistoryItem label="Pagamento pendente" date={`Vencimento ${entry.dueDate}`} /></ol></section></> : null}</Drawer>;
}

function HistoryItem({ label, date, done = false }: { readonly label: string; readonly date: string; readonly done?: boolean }) {
  return <li className="flex gap-3"><span className={`mt-1 size-2.5 rounded-full ${done ? 'bg-success' : 'bg-warning'}`} /><span><span className="block text-sm font-semibold">{label}</span><span className="text-xs text-text-secondary">{date}</span></span></li>;
}

function CancelDialog({ entry, onClose, onConfirm }: { readonly entry: FinanceEntry | null; readonly onClose: () => void; readonly onConfirm: (entry: FinanceEntry) => void }) {
  return <Dialog.Root open={entry !== null} onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[79] bg-text-primary/25" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[80] w-[min(440px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 shadow-elev-3"><div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-lg font-bold">Cancelar título?</Dialog.Title><Dialog.Description className="mt-2 text-sm text-text-secondary">O título de {entry?.patientName ?? 'paciente'} será cancelado. O histórico financeiro será preservado.</Dialog.Description></div><Dialog.Close asChild><button type="button" aria-label="Fechar" className="grid size-8 place-items-center rounded-lg hover:bg-surface-subtle"><X size={17} /></button></Dialog.Close></div><div className="mt-5 flex justify-end gap-2"><Button onClick={onClose}>Voltar</Button>{entry ? <Button variant="danger" onClick={() => onConfirm(entry)}>Confirmar cancelamento</Button> : null}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
