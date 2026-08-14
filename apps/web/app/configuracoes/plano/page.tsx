'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowSquareOut, Check, CheckCircle, Clock, CreditCard, Sparkle, Warning } from '@phosphor-icons/react';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { cn } from '../../../src/lib/cn';
import { Botao } from '../../../src/ui/Botao';
import { EstadoVazio } from '../../../src/ui/EstadoVazio';
import { Skeleton } from '../../../src/ui/Skeleton';
import { useToast } from '../../../src/ui/ToastProvider';

interface Plan {
  id: string;
  slug: string;
  nome: string;
  valorPorProfissionalCents: number;
  periodicidade: string;
  features: string[];
}
interface Subscription { id: string; status: 'trial' | 'ativa' | 'suspensa' | 'cancelada'; planoId: string; dataInicio: string; dataFim: string | null; trialTerminoEm: string; }
interface Invoice { id: string; valorCents: number; status: 'pendente' | 'paga' | 'vencida' | 'cancelada'; dataVencimento: string; dataPagamento: string | null; linkPagamento: string | null; }

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function StatusBadge({ status }: { readonly status: Subscription['status'] | Invoice['status'] }) {
  const map = {
    trial: ['Trial', 'bg-info-soft text-info', Clock],
    ativa: ['Ativo', 'bg-ok-soft text-ok', CheckCircle],
    suspensa: ['Suspenso', 'bg-danger-soft text-danger', Warning],
    cancelada: ['Cancelado', 'bg-surface-sunken text-text-muted', Warning],
    pendente: ['Pendente', 'bg-warn-soft text-warn', Clock],
    paga: ['Paga', 'bg-ok-soft text-ok', CheckCircle],
    vencida: ['Vencida', 'bg-danger-soft text-danger', Warning],
  } as const;
  const [label, className, Icon] = map[status];
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold', className)}><Icon size={12} weight="fill" aria-hidden />{label}</span>;
}

export default function PlanoPage() {
  const { clinicId, csrfToken } = useSessao();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const plansQuery = useQuery({
    queryKey: ['billing-plans', clinicId],
    queryFn: async () => (await apiFetch<{ itens: Plan[] }>('/v1/billing/plans', { clinicId, csrfToken })).itens,
    staleTime: 5 * 60_000,
  });
  const subscriptionQuery = useQuery({
    queryKey: ['billing-subscription', clinicId],
    queryFn: () => apiFetch<{ assinatura: Subscription | null }>('/v1/billing/subscription', { clinicId, csrfToken }),
  });
  const invoicesQuery = useQuery({
    queryKey: ['billing-invoices', clinicId],
    queryFn: async () => (await apiFetch<{ itens: Invoice[] }>('/v1/billing/invoices', { clinicId, csrfToken })).itens,
  });

  const selectPlan = useMutation({
    mutationFn: (planoId: string) => apiFetch<{ assinatura: Subscription }>('/v1/billing/subscription', {
      method: 'POST', body: { planoId }, clinicId, csrfToken,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing-subscription', clinicId] });
      void queryClient.invalidateQueries({ queryKey: ['billing-invoices', clinicId] });
      toast({ tipo: 'sucesso', mensagem: 'Plano atualizado com sucesso.' });
    },
    onError: () => toast({ tipo: 'erro', mensagem: 'Não foi possível alterar o plano.' }),
  });

  const plans = plansQuery.data ?? [];
  const subscription = subscriptionQuery.data?.assinatura ?? null;
  const invoices = invoicesQuery.data ?? [];
  const currentPlan = plans.find((plan) => plan.id === subscription?.planoId);
  const loading = plansQuery.isLoading || subscriptionQuery.isLoading;

  if (loading) return <div className="space-y-4"><Skeleton variant="card" className="h-44 rounded-2xl" /><Skeleton variant="card" className="h-56 rounded-2xl" /></div>;

  return (
    <div className="space-y-8">
      <div>
        <p className="cadencia-kicker">Assinatura</p>
        <h2 className="mt-1 text-xl font-bold tracking-[-0.025em] text-text">Plano e cobrança</h2>
        <p className="mt-1 text-sm text-text-muted">Entenda o plano atual, troque de faixa e acompanhe cobranças em um só lugar.</p>
      </div>

      {currentPlan && subscription ? (
        <section className="cadencia-hero-panel relative overflow-hidden p-5 sm:p-6">
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">
            <div>
              <div className="mb-3 flex items-center gap-2"><span className="cadencia-icon-orb size-9"><Sparkle size={18} weight="fill" aria-hidden /></span><StatusBadge status={subscription.status} /></div>
              <h3 className="text-2xl font-bold tracking-[-0.035em] text-text">{currentPlan.nome}</h3>
              <p className="mt-1 text-sm text-text-muted">{formatCurrency(currentPlan.valorPorProfissionalCents)} por profissional / {currentPlan.periodicidade}</p>
            </div>
            {subscription.status === 'trial' ? <div className="rounded-xl border border-info/15 bg-info-soft px-3.5 py-2.5 text-xs font-semibold text-info">Teste até {new Date(subscription.trialTerminoEm).toLocaleDateString('pt-BR')}</div> : null}
          </div>
          <div className="relative z-10 mt-5 flex flex-wrap gap-2">
            {currentPlan.features.slice(0, 8).map((feature) => <span key={feature} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/80 px-2.5 py-1.5 text-[11px] font-semibold text-text-muted"><Check size={12} className="text-ok" aria-hidden />{feature === '*' ? 'Todas as funcionalidades' : feature}</span>)}
          </div>
        </section>
      ) : <EstadoVazio icone={CreditCard} titulo="Nenhum plano ativo" descricao="Escolha uma opção abaixo para ativar os recursos da sua clínica." compacto />}

      <section>
        <div className="mb-4 flex items-end justify-between gap-4"><div><h3 className="cadencia-section-heading">Planos disponíveis</h3><p className="mt-1 text-xs text-text-faint">Valores por profissional ativo.</p></div></div>
        {plansQuery.isError ? <EstadoVazio icone={CreditCard} titulo="Não foi possível carregar os planos" compacto /> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => {
            const active = plan.id === subscription?.planoId;
            return (
              <article key={plan.id} className={cn('cadencia-card flex min-h-[238px] flex-col p-5 transition-all-fast', active && 'border-accent/35 bg-accent-soft/35 ring-1 ring-accent/10')}>
                <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[.06em] text-text-faint">{plan.slug}</p><h4 className="mt-1 text-lg font-bold text-text">{plan.nome}</h4></div>{active ? <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold text-white">Atual</span> : null}</div>
                <p className="mt-5 text-[27px] font-bold tracking-[-0.04em] text-text num">{formatCurrency(plan.valorPorProfissionalCents)}</p>
                <p className="text-xs text-text-faint">por profissional / {plan.periodicidade}</p>
                <div className="mt-4 flex flex-1 flex-wrap content-start gap-1.5">{plan.features.slice(0, 4).map((feature) => <span key={feature} className="rounded-full bg-surface-subtle px-2 py-1 text-[10px] font-semibold text-text-muted">{feature === '*' ? 'Tudo incluso' : feature}</span>)}</div>
                <Botao fullWidth variante={active ? 'secundario' : 'primario'} disabled={active} carregando={selectPlan.isPending && selectPlan.variables === plan.id} onClick={() => selectPlan.mutate(plan.id)}>{active ? 'Plano atual' : 'Selecionar plano'}</Botao>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4"><h3 className="cadencia-section-heading">Faturas</h3><p className="mt-1 text-xs text-text-faint">Histórico financeiro da assinatura.</p></div>
        {invoicesQuery.isError ? <EstadoVazio icone={CreditCard} titulo="Não foi possível carregar as faturas" compacto /> : null}
        {!invoicesQuery.isError && invoices.length === 0 ? <EstadoVazio icone={CreditCard} titulo="Nenhuma fatura encontrada" descricao="As próximas cobranças aparecerão aqui." compacto /> : null}
        {invoices.length > 0 ? (
          <div className="cadencia-table-shell overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead className="bg-surface-subtle"><tr><th className="px-4 py-3 text-left">Vencimento</th><th className="px-4 py-3 text-left">Valor</th><th className="px-4 py-3 text-left">Situação</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
              <tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-t border-line hover:bg-surface-subtle"><td className="px-4 py-3 text-sm text-text">{new Date(invoice.dataVencimento).toLocaleDateString('pt-BR')}</td><td className="px-4 py-3 text-sm font-bold text-text num">{formatCurrency(invoice.valorCents)}</td><td className="px-4 py-3"><StatusBadge status={invoice.status} /></td><td className="px-4 py-3 text-right">{invoice.linkPagamento && invoice.status === 'pendente' ? <a href={invoice.linkPagamento} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-accent hover:text-accent-hover">Abrir cobrança <ArrowSquareOut size={13} aria-hidden /></a> : <span className="text-xs text-text-faint">—</span>}</td></tr>)}</tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
