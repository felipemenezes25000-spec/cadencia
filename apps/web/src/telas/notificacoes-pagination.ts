export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  itens: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

export function notificationPageUrl(unreadOnly: boolean, cursor: string | null): string {
  const params = new URLSearchParams();
  if (unreadOnly) params.set('unreadOnly', 'true');
  if (cursor !== null) params.set('cursor', cursor);
  const query = params.toString();
  return `/v1/notifications${query === '' ? '' : `?${query}`}`;
}

export function combineNotificationPages(
  pages: readonly NotificationPage[] | undefined,
): NotificationItem[] {
  return pages?.flatMap((page) => page.itens) ?? [];
}
