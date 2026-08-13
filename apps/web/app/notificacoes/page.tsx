'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarBlank, ChatCircle, CheckCircle, Clock, CreditCard, Pill, Stethoscope } from '@phosphor-icons/react';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';
import { cn } from '../../src/lib/cn';
import { Botao } from '../../src/ui/Botao';
import { EstadoVazio } from '../../src/ui/EstadoVazio';
import { PageHeader } from '../../src/ui/PageHeader';
import { Skeleton } from '../../src/ui/Skeleton';
import { useToast } from '../../src/ui/ToastProvider';
import {
  combineNotificationPages, notificationPageUrl, type NotificationPage,
} from '../../src/telas/notificacoes-pagination';

function KindIcon({ kind }: { readonly kind: string }) {
  const Icon = kind.startsWith('appointment_') ? CalendarBlank
    : kind.startsWith('payment_') ? CreditCard
    : kind === 'message_received' ? ChatCircle
    : kind === 'prescription_ready' ? Pill
    : kind === 'encounter_completed' ? Stethoscope
    : Bell;
  return <Icon size={19} weight="duotone" aria-hidden />;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMins < 1) return 'Agora';
  if (diffMins < 60) return `${diffMins} min atrás`;
  if (diffHours < 24) return `${diffHours}h atrás`;
  if (diffDays < 7) return `${diffDays} dia${diffDays > 1 ? 's' : ''} atrás`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date);
}

export default function NotificacoesPage() {
  const { clinicId, csrfToken } = useSessao();
  const { toast } = useToast();
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const queryClient = useQueryClient();

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['notifications', clinicId, showUnreadOnly],
    queryFn: ({ pageParam }) => apiFetch<NotificationPage>(
      notificationPageUrl(showUnreadOnly, pageParam),
      { clinicId, csrfToken },
    ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/v1/notifications/${id}/read`, {
      method: 'PUT', clinicId, csrfToken,
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: () => apiFetch<{ markedCount: number }>('/v1/notifications/read-all', {
      method: 'PUT', clinicId, csrfToken,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast({ tipo: 'sucesso', mensagem: 'Notificações marcadas como lidas.' });
    },
  });

  const notifications = combineNotificationPages(data?.pages);
  const unreadCount = data?.pages[0]?.unreadCount ?? 0;

  return (
    <div className="cadencia-page space-y-6">
      <PageHeader
        titulo="Notificações"
        eyebrow="Central de atividade"
        subtitulo={unreadCount > 0 ? `${unreadCount} atualização${unreadCount > 1 ? 'ões' : ''} aguardando sua atenção.` : 'Tudo em dia por aqui.'}
        semBreadcrumb
        acoes={unreadCount > 0 ? (
          <Botao variante="secundario" iconeEsquerda={CheckCircle} carregando={markAll.isPending} onClick={() => markAll.mutate()}>
            Marcar todas como lidas
          </Botao>
        ) : undefined}
      />

      <div className="flex items-center gap-1 rounded-xl border border-line bg-surface-subtle p-1 sm:w-fit" role="group" aria-label="Filtrar notificações">
        {[
          { value: false, label: 'Todas' },
          { value: true, label: 'Não lidas' },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={showUnreadOnly === option.value}
            onClick={() => setShowUnreadOnly(option.value)}
            className={cn(
              'flex-1 rounded-lg px-4 py-2 text-xs font-semibold transition-all-fast sm:flex-none',
              showUnreadOnly === option.value ? 'bg-surface text-accent shadow-elev-1' : 'text-text-muted hover:text-text',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="cadencia-panel divide-y divide-line" aria-label="Carregando notificações">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="flex gap-4 p-4 sm:p-5"><Skeleton variant="avatar" /><Skeleton variant="text" lines={2} className="flex-1" /></div>
          ))}
        </div>
      ) : null}

      {isError ? <EstadoVazio icone={Bell} titulo="Não foi possível carregar as notificações" descricao="Tente novamente em instantes." /> : null}

      {!isLoading && !isError && notifications.length === 0 ? (
        <EstadoVazio
          icone={Bell}
          titulo={showUnreadOnly ? 'Nenhuma notificação não lida' : 'Sua central está tranquila'}
          descricao={showUnreadOnly ? 'Você já revisou tudo que precisava da sua atenção.' : 'Novas atividades importantes aparecerão aqui.'}
        />
      ) : null}

      {notifications.length > 0 ? (
        <section className="cadencia-panel divide-y divide-line" aria-label="Lista de notificações">
          {notifications.map((notification) => {
            const unread = notification.readAt === null;
            return (
              <button
                key={notification.id}
                type="button"
                disabled={!unread || markRead.isPending}
                onClick={() => { if (unread) markRead.mutate(notification.id); }}
                className={cn(
                  'group flex w-full gap-4 p-4 text-left transition-colors-fast sm:p-5',
                  unread ? 'bg-accent-soft/35 hover:bg-accent-soft/60' : 'bg-surface hover:bg-surface-subtle',
                  !unread && 'cursor-default',
                )}
                aria-label={`${notification.title}. ${notification.body}${unread ? '. Marcar como lida' : '. Lida'}`}
              >
                <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', unread ? 'bg-surface text-accent shadow-elev-1' : 'bg-surface-subtle text-text-muted')}>
                  <KindIcon kind={notification.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className={cn('block text-sm tracking-[-0.01em] text-text', unread ? 'font-bold' : 'font-semibold')}>{notification.title}</span>
                    {unread ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_4px_var(--brand-soft)]" aria-label="Não lida" /> : null}
                  </span>
                  <span className="mt-1 block max-w-3xl text-sm leading-relaxed text-text-muted">{notification.body}</span>
                  <span className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-text-faint">
                    <Clock size={13} aria-hidden />{formatDate(notification.createdAt)}
                  </span>
                </span>
              </button>
            );
          })}
          {hasNextPage ? (
            <div className="flex justify-center bg-surface p-4">
              <Botao
                variante="secundario"
                carregando={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                Carregar mais
              </Botao>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
