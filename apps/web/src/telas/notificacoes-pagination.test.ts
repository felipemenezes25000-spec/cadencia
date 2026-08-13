import { describe, expect, it } from 'vitest';
import { combineNotificationPages, notificationPageUrl, type NotificationPage } from './notificacoes-pagination';

const first: NotificationPage = {
  itens: [{
    id: '1', kind: 'message_received', title: 'Primeira', body: 'Corpo',
    readAt: null, createdAt: '2026-08-13T10:00:00.000Z',
  }],
  nextCursor: '01890a5d-ac96-774b-bcce-b302099a8057',
  unreadCount: 2,
};

describe('paginacao das notificacoes', () => {
  it('envia filtro e cursor ao buscar a pagina seguinte', () => {
    expect(notificationPageUrl(true, first.nextCursor))
      .toBe('/v1/notifications?unreadOnly=true&cursor=01890a5d-ac96-774b-bcce-b302099a8057');
  });

  it('mantem a primeira pagina ao acrescentar a segunda', () => {
    const second: NotificationPage = {
      itens: [{ ...first.itens[0]!, id: '2', title: 'Segunda' }],
      nextCursor: null,
      unreadCount: 2,
    };
    expect(combineNotificationPages([first, second]).map((item) => item.title))
      .toEqual(['Primeira', 'Segunda']);
  });
});
