'use client';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, CheckCircle, Warning, Clock, ArrowRight } from '@phosphor-icons/react';

interface Plan {
  id: string;
  slug: string;
  nome: string;
  valorPorProfissionalCents: number;
  periodicidade: string;
  features: string[];
}

interface Subscription {
  id: string;
  status: 'trial' | 'ativa' | 'suspensa' | 'cancelada';
  planoId: string;
  dataInicio: string;
  dataFim: string | null;
  trialTerminoEm: string;
}

interface Invoice {
  id: string;
  valorCents: number;
  status: 'pendente' | 'paga' | 'vencida' | 'cancelada';
  dataVencimento: string;
  dataPagamento: string | null;
  linkPagamento: string | null;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; class: string; icon: typeof CheckCircle }> = {
    trial: { label: 'Trial', class: 'bg-purple-100 text-purple-800', icon: Clock },
    ativa: { label: 'Ativo', class: 'bg-green-100 text-green-800', icon: CheckCircle },
    suspensa: { label: 'Suspenso', class: 'bg-red-100 text-red-800', icon: Warning },
    cancelada: { label: 'Cancelado', class: 'bg-gray-100 text-gray-600', icon: Warning },
    pendente: { label: 'Pendente', class: 'bg-yellow-100 text-yellow-800', icon: Clock },
    paga: { label: 'Paga', class: 'bg-green-100 text-green-800', icon: CheckCircle },
    vencida: { label: 'Vencida', class: 'bg-red-100 text-red-800', icon: Warning },
  };
  const c = configs[status] ?? configs.ativa!;
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${c.class}`}>
      <Icon size={12} weight="fill" />
      {c.label}
    </span>
  );
}

export default function PlanoPage() {
  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['billing-plans'],
    queryFn: async () => {
      const res = await fetch('/api/v1/billing/plans');
      const data = await res.json();
      return data.itens as Plan[];
    },
  });

  const { data: subscription, isLoading: subLoading } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: async () => {
      const res = await fetch('/api/v1/billing/subscription');
      if (!res.ok) return null;
      const data = await res.json();
      return data.assinatura as Subscription | null;
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: async () => {
      const res = await fetch('/api/v1/billing/invoices');
      if (!res.ok) return [];
      const data = await res.json();
      return data.itens as Invoice[];
    },
  });

  const currentPlan = plans.find((p) => p.id === subscription?.planoId);

  if (plansLoading || subLoading) {
    return <div className="animate-pulse space-y-4"><div className="h-48 bg-gray-200 rounded" /></div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Plano e Cobrança</h1>
        <p className="text-gray-500 mt-1">Gerencie seu plano e acompanhe suas faturas.</p>
      </div>

      {/* Plano Atual */}
      {subscription && currentPlan ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">{currentPlan.nome}</h2>
              <p className="text-gray-500 mt-1">
                {formatCurrency(currentPlan.valorPorProfissionalCents)}/profissional/{currentPlan.periodicidade}
              </p>
            </div>
            <StatusBadge status={subscription.status} />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {currentPlan.features.map((f) => (
              <span key={f} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                {f === '*' ? 'Todas as funcionalidades' : f}
              </span>
            ))}
          </div>

          {subscription.status === 'trial' && (
            <div className="mt-4 p-4 bg-purple-50 rounded-lg">
              <p className="text-purple-800 text-sm">
                Seu trial termina em {new Date(subscription.trialTerminoEm).toLocaleDateString('pt-BR')}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          <CreditCard size={48} className="mx-auto text-gray-400" />
          <p className="mt-2 text-gray-600">Nenhum plano ativo</p>
        </div>
      )}

      {/* Planos Disponíveis */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Planos Disponíveis</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`border rounded-lg p-4 ${plan.id === subscription?.planoId ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
            >
              <h3 className="font-semibold">{plan.nome}</h3>
              <p className="text-2xl font-bold mt-2">{formatCurrency(plan.valorPorProfissionalCents)}</p>
              <p className="text-gray-500 text-sm">por profissional/{plan.periodicidade}</p>
              <button
                className={`mt-4 w-full py-2 rounded-lg text-sm font-medium ${
                  plan.id === subscription?.planoId
                    ? 'bg-gray-200 text-gray-600 cursor-default'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
                disabled={plan.id === subscription?.planoId}
              >
                {plan.id === subscription?.planoId ? 'Plano atual' : 'Selecionar'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Faturas */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Faturas</h2>
        {invoices.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>Nenhuma fatura encontrada.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Vencimento</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Valor</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">Status</th>
                  <th className="text-right px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">{new Date(inv.dataVencimento).toLocaleDateString('pt-BR')}</td>
                    <td className="px-4 py-3 font-medium">{formatCurrency(inv.valorCents)}</td>
                    <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                    <td className="px-4 py-3 text-right">
                      {inv.linkPagamento && inv.status === 'pendente' && (
                        <a href={inv.linkPagamento} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 text-sm">
                          Pagar <ArrowRight size={14} className="inline" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
