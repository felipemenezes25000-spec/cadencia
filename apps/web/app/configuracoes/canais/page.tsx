'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretRight, CheckCircle, Envelope, Phone, Plus, Warning, WhatsappLogo, XCircle } from '@phosphor-icons/react';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { cn } from '../../../src/lib/cn';
import { Botao } from '../../../src/ui/Botao';
import { EstadoVazio } from '../../../src/ui/EstadoVazio';
import { Skeleton } from '../../../src/ui/Skeleton';
import { useToast } from '../../../src/ui/ToastProvider';

interface Channel {
  id: string;
  channel: 'whatsapp' | 'sms' | 'email';
  status: 'inactive' | 'active' | 'suspended' | 'pending_verification';
  rateLimitPerMinute: number;
  hasCredentials: boolean;
}

interface ChannelIdentity {
  id: string;
  displayName: string;
  phone: string | null;
  emailDomain: string | null;
  status: 'active' | 'inactive';
}

const CHANNEL_META = {
  whatsapp: { label: 'WhatsApp', icon: WhatsappLogo, limit: '60 msg/min' },
  sms: { label: 'SMS', icon: Phone, limit: '30 msg/min' },
  email: { label: 'E-mail', icon: Envelope, limit: '100 msg/min' },
} as const;

function StatusBadge({ status }: { readonly status: Channel['status'] }) {
  const configs = {
    active: { label: 'Ativo', className: 'bg-ok-soft text-ok', icon: CheckCircle },
    inactive: { label: 'Inativo', className: 'bg-surface-sunken text-text-muted', icon: XCircle },
    suspended: { label: 'Suspenso', className: 'bg-danger-soft text-danger', icon: Warning },
    pending_verification: { label: 'Verificação pendente', className: 'bg-warn-soft text-warn', icon: Warning },
  } as const;
  const config = configs[status];
  const Icon = config.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold', config.className)}>
      <Icon size={12} weight="fill" aria-hidden />{config.label}
    </span>
  );
}

export default function CanaisPage() {
  const { clinicId, csrfToken } = useSessao();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: channels = [], isLoading, isError } = useQuery({
    queryKey: ['channels', clinicId],
    queryFn: async () => {
      const data = await apiFetch<{ itens: Channel[] }>('/v1/channels', { clinicId, csrfToken });
      return data.itens;
    },
    staleTime: 60_000,
  });

  const { data: identities = [], isLoading: identitiesLoading } = useQuery({
    queryKey: ['channel-identities', clinicId, expanded],
    queryFn: async () => {
      if (!expanded) return [];
      const data = await apiFetch<{ itens: ChannelIdentity[] }>(`/v1/channels/${expanded}/identity`, { clinicId, csrfToken });
      return data.itens;
    },
    enabled: expanded !== null,
  });

  const createChannel = useMutation({
    mutationFn: (channel: Channel['channel']) => apiFetch<{ id: string; status: string }>('/v1/channels', {
      method: 'POST', body: { channel }, clinicId, csrfToken,
    }),
    onSuccess: () => {
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['channels', clinicId] });
      toast({ tipo: 'sucesso', mensagem: 'Canal criado. Agora falta concluir a verificação e as credenciais.' });
    },
    onError: () => toast({ tipo: 'erro', mensagem: 'Não foi possível criar o canal.' }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="cadencia-kicker">Comunicação omnichannel</p>
          <h2 className="mt-1 text-xl font-bold tracking-[-0.025em] text-text">Canais</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">Centralize WhatsApp, SMS e e-mail com limites e identidades transparentes.</p>
        </div>
        <Botao variante="secundario" iconeEsquerda={Plus} onClick={() => setShowCreate((value) => !value)}>
          Adicionar canal
        </Botao>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" aria-label="Limites recomendados por canal">
        {(Object.entries(CHANNEL_META) as [Channel['channel'], (typeof CHANNEL_META)[Channel['channel']]][]).map(([key, meta]) => {
          const Icon = meta.icon;
          return (
            <div key={key} className="rounded-xl border border-line bg-surface-subtle p-3.5">
              <div className="flex items-center gap-3">
                <span className="cadencia-icon-orb size-9"><Icon size={18} weight="duotone" aria-hidden /></span>
                <div><p className="text-sm font-bold text-text">{meta.label}</p><p className="text-[11px] text-text-faint">Referência: {meta.limit}</p></div>
              </div>
            </div>
          );
        })}
      </div>

      {showCreate ? (
        <section className="rounded-2xl border border-accent/20 bg-accent-soft/45 p-4" aria-label="Escolher novo canal">
          <p className="text-xs font-bold uppercase tracking-[.06em] text-accent">Novo canal</p>
          <p className="mt-1 text-sm text-text-muted">Escolha o meio de comunicação. As credenciais são configuradas depois.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {(Object.entries(CHANNEL_META) as [Channel['channel'], (typeof CHANNEL_META)[Channel['channel']]][]).map(([key, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={createChannel.isPending || channels.some((item) => item.channel === key)}
                  onClick={() => createChannel.mutate(key)}
                  className="cadencia-card cadencia-card-interactive flex items-center gap-3 p-3 text-left disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="cadencia-icon-orb size-9"><Icon size={18} aria-hidden /></span>
                  <span><span className="block text-sm font-bold text-text">{meta.label}</span><span className="block text-[11px] text-text-faint">{channels.some((item) => item.channel === key) ? 'Já configurado' : 'Configurar canal'}</span></span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {isLoading ? <div className="space-y-3">{[0, 1].map((item) => <Skeleton key={item} variant="card" className="h-20 rounded-xl" />)}</div> : null}
      {isError ? <EstadoVazio icone={Envelope} titulo="Não foi possível carregar os canais" descricao="Tente novamente em instantes." compacto /> : null}

      {!isLoading && !isError && channels.length === 0 ? (
        <EstadoVazio icone={Envelope} titulo="Nenhum canal configurado" descricao="Adicione WhatsApp, SMS ou e-mail para começar a centralizar a comunicação." compacto />
      ) : null}

      <div className="space-y-3">
        {channels.map((channel) => {
          const meta = CHANNEL_META[channel.channel];
          const Icon = meta.icon;
          const open = expanded === channel.id;
          const panelId = `channel-${channel.id}-identities`;
          return (
            <section key={channel.id} className="cadencia-panel">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setExpanded(open ? null : channel.id)}
                className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors-fast hover:bg-surface-subtle sm:p-5"
              >
                <span className="flex min-w-0 items-center gap-3.5">
                  <span className="cadencia-icon-orb size-10 shrink-0"><Icon size={20} weight="duotone" aria-hidden /></span>
                  <span className="min-w-0"><span className="block text-sm font-bold text-text">{meta.label}</span><span className="block truncate text-xs text-text-faint">{channel.rateLimitPerMinute} msg/min · {channel.hasCredentials ? 'Credenciais configuradas' : 'Credenciais pendentes'}</span></span>
                </span>
                <span className="flex shrink-0 items-center gap-3"><StatusBadge status={channel.status} /><CaretRight size={16} className={cn('text-text-faint transition-transform-fast', open && 'rotate-90')} aria-hidden /></span>
              </button>

              {open ? (
                <div id={panelId} className="border-t border-line bg-surface-subtle/65 p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-xs font-bold uppercase tracking-[.06em] text-text-muted">Identidades</h3><span className="text-[11px] text-text-faint">{identities.length} configurada{identities.length === 1 ? '' : 's'}</span></div>
                  {identitiesLoading ? <Skeleton variant="text" lines={2} /> : null}
                  {!identitiesLoading && identities.length === 0 ? <p className="rounded-xl border border-dashed border-line bg-surface px-3 py-4 text-sm text-text-muted">Nenhuma identidade configurada neste canal.</p> : null}
                  {identities.length > 0 ? (
                    <div className="grid gap-2">
                      {identities.map((identity) => (
                        <div key={identity.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
                          <div className="min-w-0"><p className="truncate text-sm font-semibold text-text">{identity.displayName}</p><p className="truncate text-xs text-text-faint">{identity.phone ?? identity.emailDomain ?? 'Sem identificador público'}</p></div>
                          <span className={cn('rounded-full px-2 py-1 text-[10px] font-bold', identity.status === 'active' ? 'bg-ok-soft text-ok' : 'bg-surface-sunken text-text-muted')}>{identity.status === 'active' ? 'Ativa' : 'Inativa'}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-3 text-[11px] text-text-faint">Cadastro de novas identidades será liberado quando a API de identidade aceitar escrita.</p>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
