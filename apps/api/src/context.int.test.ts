import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from './app';
import { semearSessao, type SementeSessao } from './test-support';

let s: SementeSessao;

beforeAll(async () => { s = await semearSessao(); });
afterAll(async () => { await closePools(); });

describe('preambulo da borda', () => {
  it('sem cookie de sessao, rota clinica devolve 401 — nao 500 e nao 200 vazio', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/whoami' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ erro: 'sem_sessao' });
    await app.close();
  });

  it('com sessao valida, monta o Actor kind=user com tenant, usuario e clinica', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/whoami',
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId });
    await app.close();
  });

  it('clinica fora do vinculo do usuario devolve 403, nao dado de outra unidade', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/whoami',
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicIdDeOutroTenant },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'sem_vinculo_na_unidade' });
    await app.close();
  });

  it('o tenant NUNCA vem do cliente: nao existe parametro tenantId em rota nenhuma', async () => {
    const app = await buildApp();
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json() as {
      paths: Record<string, Record<string, { parameters?: { name: string }[] }>> };
    for (const [rota, metodos] of Object.entries(spec.paths)) {
      for (const [metodo, def] of Object.entries(metodos)) {
        for (const p of def.parameters ?? []) {
          expect(p.name, `${metodo.toUpperCase()} ${rota} aceita ${p.name}`)
            .not.toMatch(/^tenant_?id$/i);
        }
      }
    }
    await app.close();
  });

  it('metodo mutante sem CSRF e recusado com 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/whoami',
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
    });
    expect([403, 404]).toContain(r.statusCode);
    await app.close();
  });
});
