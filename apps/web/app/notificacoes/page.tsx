'use client';
import { useState } from 'react';
import { Bell, CheckCircle, Clock, Calendar, CreditCard, ChatCircle, Pill, Stethoscope } from '@phosphor-icons/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

function getKindIcon(kind: string) {
  switch (kind) {
    case 'appointment_reminder':
    case 'appointment_created':
    case 'appointment_confirmed':
    case 'appointment_cancelled':
      return <Calendar size={20} className="text-blue-500" />;
    case 'payment_received':
    case 'payment_overdue':
      return <CreditCard size={20} className="text-green-500" />;
    case 'message_received':
      return <ChatCircle size={20} className="text-purple-500" />;
    case 'prescription_ready':
      return <Pill size={20} className="text-orange-500" />;
    case 'encounter_completed':
      return <Stethoscope size={20} className="text-teal-500" />;
    default:
      return <Bell size={20} className="text-gray-500" />;
  }
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Agora';
  if (diffMins < 60) return `${diffMins} min atrás`;
  if (diffHours < 24) return `${diffHours}h atrás`;
  if (diffDays < 7) return `${diffDays} dia${diffDays > 1 ? 's' : ''} atrás`;
  return date.toLocaleDateString('pt-BR');
}

async function fetchNotifications(unreadOnly = false) {
  const params = new URLSearchParams();
  if (unreadOnly) params.set('unreadOnly', 'true');
  const res = await fetch(`/api/v1/notifications?${params}`);
  return res.json();
}

async function markAsRead(id: string) {
  await fetch(`/api/v1/notifications/${id}/read`, { method: 'PUT' });
}

async function markAllAsRead() {
  await fetch('/api/v1/notifications/read-all', { method: 'PUT' });
}

export default function NotificacoesPage() {
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', showUnreadOnly],
    queryFn: () => fetchNotifications(showUnreadOnly),
  });

  const markRead = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (isLoading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded w-1/4" /></div>;
  }

  const notifications: Notification[] = data?.itens ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notificações</h1>
          <p className="text-gray-500 mt-1">
            {unreadCount > 0 ? `${unreadCount} não lida${unreadCount > 1 ? 's' : ''}` : 'Todas lidas'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
          >
            <CheckCircle size={16} />
            Marcar todas como lidas
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setShowUnreadOnly(false)}
          className={`px-4 py-2 text-sm rounded-lg ${!showUnreadOnly ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          Todas
        </button>
        <button
          onClick={() => setShowUnreadOnly(true)}
          className={`px-4 py-2 text-sm rounded-lg ${showUnreadOnly ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          Não lidas
        </button>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-16">
          <Bell size={48} className="mx-auto text-gray-300" />
          <p className="mt-4 text-gray-500">
            {showUnreadOnly ? 'Não há notificações não lidas.' : 'Você não tem notificações ainda.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex gap-4 p-4 border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer ${
                !n.readAt ? 'bg-blue-50/50' : ''
              }`}
              onClick={() => !n.readAt && markRead.mutate(n.id)}
            >
              <div className="flex-shrink-0 mt-1">{getKindIcon(n.kind)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className={`font-medium ${!n.readAt ? 'text-gray-900' : 'text-gray-700'}`}>{n.title}</h3>
                  {!n.readAt && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
                </div>
                <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">{n.body}</p>
                <div className="flex items-center gap-2 mt-2 text-xs text-gray-400">
                  <Clock size={12} />
                  {formatDate(n.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
