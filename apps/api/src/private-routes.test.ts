import { describe, expect, it } from 'vitest';
import { buildApp } from './app';

const ROTAS_PRIVADAS = [
  '/v1/notifications',
  '/v1/channels',
  '/v1/tenants/current',
  '/v1/clinics',
  '/v1/permissions?clinicId=00000000-0000-4000-8000-000000000001',
  '/v1/documentos/templates/vars/atestado',
] as const;

describe('fronteira privada das rotas administrativas', () => {
  it.each(ROTAS_PRIVADAS)('%s recusa requisicao anonima', async (url) => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ erro: 'sem_sessao' });
    await app.close();
  });
});
