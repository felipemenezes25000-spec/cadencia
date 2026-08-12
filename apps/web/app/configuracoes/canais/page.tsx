'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Envelope, Phone, WhatsappLogo, CheckCircle, Warning, XCircle, CaretRight, Plus } from '@phosphor-icons/react';

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

function ChannelIcon({ channel }: { channel: string }) {
  const icons: Record<string, { icon: typeof Envelope; color: string }> = {
    whatsapp: { icon: WhatsappLogo, color: 'text-green-500' },
    sms: { icon: Phone, color: 'text-blue-500' },
    email: { icon: Envelope, color: 'text-amber-500' },
  };
  const { icon: Icon, color } = icons[channel] || { icon: Envelope, color: 'text-gray-500' };
  return <Icon size={24} weight="fill" className={color} />;
}

function StatusBadge({ status }: { status: Channel['status'] }) {
  const configs = {
    active: { label: 'Ativo', class: 'bg-green-100 text-green-800', icon: CheckCircle },
    inactive: { label: 'Inativo', class: 'bg-gray-100 text-gray-600', icon: XCircle },
    suspended: { label: 'Suspenso', class: 'bg-red-100 text-red-800', icon: Warning },
    pending_verification: { label: 'Pendente', class: 'bg-yellow-100 text-yellow-800', icon: Warning },
  };
  const c = configs[status];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${c.class}`}>
      <Icon size={12} weight="fill" />
      {c.label}
    </span>
  );
}

export default function CanaisPage() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/v1/channels');
      const data = await res.json();
      return data.itens as Channel[];
    },
  });

  const { data: identities = [] } = useQuery({
    queryKey: ['channel-identities', expanded],
    queryFn: async () => {
      if (!expanded) return [];
      const res = await fetch(`/api/v1/channels/${expanded}/identity`);
      const data = await res.json();
      return data.itens as ChannelIdentity[];
    },
    enabled: !!expanded,
  });

  if (isLoading) {
    return <div className="animate-pulse space-y-4"><div className="h-24 bg-gray-200 rounded" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Canais de Comunicação</h1>
        <p className="text-gray-500 mt-1">Configure WhatsApp, SMS e Email para envio de mensagens.</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Limites por canal</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2"><WhatsappLogo size={16} className="text-green-600" /><span>WhatsApp: 60 msg/min</span></div>
          <div className="flex items-center gap-2"><Phone size={16} className="text-blue-600" /><span>SMS: 30 msg/min</span></div>
          <div className="flex items-center gap-2"><Envelope size={16} className="text-amber-600" /><span>Email: 100 msg/min</span></div>
        </div>
      </div>

      <div className="space-y-3">
        {channels.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>Nenhum canal configurado.</p>
            <p className="text-sm mt-1">Configure um canal para começar a enviar mensagens.</p>
          </div>
        ) : channels.map((channel: Channel) => (
          <div key={channel.id} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === channel.id ? null : channel.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <ChannelIcon channel={channel.channel} />
                <div className="text-left">
                  <div className="font-medium capitalize">{channel.channel}</div>
                  <div className="text-sm text-gray-500">Limite: {channel.rateLimitPerMinute} msg/min</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={channel.status} />
                <CaretRight size={16} className={`text-gray-400 transition-transform ${expanded === channel.id ? 'rotate-90' : ''}`} />
              </div>
            </button>

            {expanded === channel.id && (
              <div className="border-t border-gray-100 p-4 bg-gray-50">
                {identities.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-700">Identidades</div>
                    {identities.map((id: ChannelIdentity) => (
                      <div key={id.id} className="flex items-center justify-between bg-white p-3 rounded border">
                        <div>
                          <div className="font-medium">{id.displayName}</div>
                          <div className="text-sm text-gray-500">{id.phone ?? id.emailDomain}</div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${id.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{id.status}</span>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-sm text-gray-500">Nenhuma identidade configurada.</div>}
                <button className="mt-3 flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700">
                  <Plus size={16} />Adicionar identidade
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <button className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400">
        <Plus size={20} />Adicionar canal
      </button>
    </div>
  );
}
