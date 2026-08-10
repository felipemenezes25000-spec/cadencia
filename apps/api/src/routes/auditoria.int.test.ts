import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

beforeAll(async () => {
  s = await semearSessao({ role: 'admin_clinico' });
  // Gera trilha DE VERDADE: cada busca de paciente emite PATIENT_SEARCH pelo
  // canal A, dentro da transacao de leitura. Inserir evento na mao provaria
  // que o INSERT funciona, nao que o sistema registra o que faz.
  const app = await buildApp();
  await app.inject({ method: 'GET', url: '/v1/pacientes?termo=pacient', ...auth(s) });
  await app.inject({ method: 'GET', url: '/v1/pacientes?termo=sessao', ...auth(s) });
  await app.close();
});
afterAll(async () => { await closePools(); });

describe('trilha de auditoria consultavel', () => {
  it('GET /v1/auditoria devolve os eventos da clinica, do mais novo ao mais antigo', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/auditoria', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      itens: {
        eventId: string; ocorridoEm: string; eventType: string;
        entidade: string; outcome: string; ator: string | null;
        meta: Record<string, unknown>;
      }[];
    };

    expect(d.itens.length).toBeGreaterThanOrEqual(2);
    expect(d.itens.some((x) => x.eventType === 'PATIENT_SEARCH')).toBe(true);

    const primeiro = d.itens[0];
    const segundo = d.itens[1];
    expect(primeiro).toBeDefined();
    if (primeiro !== undefined && segundo !== undefined) {
      expect(primeiro.ocorridoEm >= segundo.ocorridoEm).toBe(true);
    }

    await app.close();
  });

  it('filtra por tipo de evento e por periodo', async () => {
    const app = await buildApp();
    // A rota filtra por `app.local_date(occurred_at, cl.timezone)` — a data da
    // CLINICA. Montar a janela com o relogio do processo em UTC faz o teste
    // pedir 10/08 enquanto os eventos estao carimbados em 09/08, todo dia
    // entre 21h e meia-noite em Sao Paulo.
    const hoje = await withTenantTx(
      { kind: 'user', tenantId: s.tenantId, userId: s.userId,
        clinicId: s.clinicId, requestId: uuidv7() },
      async (tx) => {
        const { rows } = await tx.query<{ d: string }>(
          `SELECT app.local_date(clock_timestamp(), cl.timezone)::text AS d
             FROM app.clinic cl WHERE cl.id = $1`, [s.clinicId]);
        return rows[0]!.d;
      });

    const porTipo = await app.inject({
      method: 'GET', url: '/v1/auditoria?tipo=PATIENT_SEARCH', ...auth(s) });
    expect(porTipo.statusCode).toBe(200);
    const tipos = (porTipo.json() as { itens: { eventType: string }[] })
      .itens.map((x) => x.eventType);
    expect(new Set(tipos)).toEqual(new Set(['PATIENT_SEARCH']));

    const foraDoPeriodo = await app.inject({
      method: 'GET', url: '/v1/auditoria?de=2020-01-01&ate=2020-12-31', ...auth(s) });
    expect((foraDoPeriodo.json() as { itens: unknown[] }).itens).toHaveLength(0);

    const noPeriodo = await app.inject({
      method: 'GET', url: `/v1/auditoria?de=${hoje}&ate=${hoje}`, ...auth(s) });
    expect((noPeriodo.json() as { itens: unknown[] }).itens.length).toBeGreaterThan(0);

    await app.close();
  });

  it('a trilha NAO expoe identificador de paciente nem conteudo clinico', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/auditoria', ...auth(s) });
    const corpo = r.body;

    // Decisao irreversivel 8: a trilha nasce sem conteudo clinico e sem
    // identificador de paciente. Se a rota vazasse um, seria o proprio painel
    // de auditoria virando a superficie que ele existe para vigiar.
    expect(corpo).not.toContain(s.patientId);
    expect(corpo).not.toContain(s.patientCpf);
    expect(corpo).not.toContain(s.patientNome);

    await app.close();
  });

  it('recepcao nao le a trilha', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({ method: 'GET', url: '/v1/auditoria', ...auth(recepcao) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('nao enxerga evento de outro tenant', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'admin_clinico' });
    const r = await app.inject({ method: 'GET', url: '/v1/auditoria', ...auth(outro) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: unknown[] }).itens).toHaveLength(0);
    await app.close();
  });
});
