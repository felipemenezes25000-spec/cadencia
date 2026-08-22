import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let admin: SementeSessao;

beforeAll(async () => { admin = await semearSessao({ role: 'admin_clinico' }); });
afterAll(async () => { await closePools(); });

describe('implantação pública do PEC', () => {
  it('expõe checklist de prontidão sem fingir homologação externa', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/implantacao/readiness', ...auth(admin) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { prontoParaGoLive: boolean; checks: { id: string; status: string }[] };
    expect(body.checks.some((x) => x.id === 'rnds')).toBe(true);
    expect(body.checks.some((x) => x.id === 'cnes')).toBe(true);
    expect(typeof body.prontoParaGoLive).toBe('boolean');
    await app.close();
  });

  it('registra e reconcilia uma execução de migração', async () => {
    const app = await buildApp();
    const criada = await app.inject({
      method: 'POST', url: '/v1/implantacao/migracoes', ...auth(admin),
      payload: { sourceSystem: 'PEC legado municipal', sourceVersion: '2026.1', sourceKind: 'database' },
    });
    expect(criada.statusCode).toBe(201);
    const id = (criada.json() as { id: string }).id;

    const atualizada = await app.inject({
      method: 'PATCH', url: `/v1/implantacao/migracoes/${id}`, ...auth(admin),
      payload: {
        status: 'concluida', recebidos: 100, validos: 98, importados: 98,
        conciliados: 96, rejeitados: 2, report: { duplicados: 2, observacao: 'teste' },
      },
    });
    expect(atualizada.statusCode).toBe(200);
    expect((atualizada.json() as { importados: number }).importados).toBe(98);

    const lista = await app.inject({ method: 'GET', url: '/v1/implantacao/migracoes', ...auth(admin) });
    expect(lista.statusCode).toBe(200);
    expect((lista.json() as { itens: { id: string }[] }).itens.some((x) => x.id === id)).toBe(true);
    await app.close();
  });

  it('registra evidência de restore para aceite operacional', async () => {
    const app = await buildApp();
    const criada = await app.inject({
      method: 'POST', url: '/v1/implantacao/evidencias', ...auth(admin),
      payload: {
        evidenceType: 'backup_restore', status: 'ok', happenedAt: '2026-08-22T20:00:00-03:00',
        summary: 'Restore validado em ambiente de homologação', metadata: { rpoMinutos: 15, rtoMinutos: 45 },
      },
    });
    expect(criada.statusCode).toBe(201);

    const lista = await app.inject({ method: 'GET', url: '/v1/implantacao/evidencias', ...auth(admin) });
    expect(lista.statusCode).toBe(200);
    expect((lista.json() as { itens: { evidenceType: string }[] }).itens.some((x) => x.evidenceType === 'backup_restore')).toBe(true);
    await app.close();
  });
});
