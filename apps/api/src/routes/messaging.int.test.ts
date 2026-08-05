// apps/api/src/routes/messaging.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessaoMensageria, auth, type SementeSessaoMsg } from '../test-support-messaging';

let s: SementeSessaoMsg;
beforeAll(async () => { s = await semearSessaoMensageria(); });
afterAll(async () => { await closePools(); });

describe('rotas de mensageria', () => {
  it('GET /v1/conversations lista conversas do tenant', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/conversations', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; nextCursor: string | null };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('GET /v1/conversations filtra por patientId', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/conversations?patientId=${s.patientId}`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: Array<{ patientId: string }> };
    for (const item of body.itens) {
      expect(item.patientId).toBe(s.patientId);
    }
    await app.close();
  });

  it('GET /v1/conversations/:id/messages lista mensagens', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${s.conversationId}/messages`,
      ...auth(s),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[]; nextCursor: string | null };
    expect(Array.isArray(body.itens)).toBe(true);
    expect(body.itens.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('POST /v1/conversations/:id/messages enfileira mensagem no outbox', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${s.conversationId}/messages`,
      ...auth(s),
      payload: { body: 'Ola, sua consulta esta confirmada para amanha.' },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { messageId: string; status: string };
    expect(body.status).toBe('queued');
    expect(body.messageId).toBeTruthy();
    await app.close();
  });

  it('GET /v1/messaging/templates lista templates', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/messaging/templates', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(Array.isArray(body.itens)).toBe(true);
    await app.close();
  });

  it('POST /v1/messaging/templates cria template novo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/messaging/templates', ...auth(s),
      payload: {
        channelIdentityId: s.channelIdentityId,
        name: 'lembrete_consulta',
        category: 'utility',
        bodyTemplate: 'Ola {{nome}}, sua consulta esta marcada para {{data}}. Confirme respondendo SIM.',
        variables: ['nome', 'data'],
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { templateId: string; status: string };
    expect(body.templateId).toBeTruthy();
    expect(body.status).toBe('pending');
    await app.close();
  });

  it('GET /v1/messaging/automations lista regras de automacao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/messaging/automations', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: unknown[] };
    expect(Array.isArray(body.itens)).toBe(true);
    await app.close();
  });

  it('PUT /v1/messaging/automations salva regras de automacao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/messaging/automations', ...auth(s),
      payload: {
        rules: [{
          channelIdentityId: s.channelIdentityId,
          trigger: 'appointment_created',
          templateId: s.templateId,
          timingOffsetMinutes: -1440,
          active: true,
          channel: 'whatsapp',
        }],
      },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { saved: number }).saved).toBe(1);
    await app.close();
  });

  it('recepcao nao pode configurar automacoes (403)', async () => {
    const recep = await semearSessaoMensageria({ role: 'recepcao' });
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/messaging/automations', ...auth(recep),
      payload: { rules: [] },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
