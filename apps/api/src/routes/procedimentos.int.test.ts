import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
let raro = '';
let frequente = '';

beforeAll(async () => {
  s = await semearSessao({ role: 'recepcao' });
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    raro = uuidv7();
    frequente = uuidv7();
    await a.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min)
       VALUES ($1,$2,'RARO','Procedimento Raro','#aa0000',60),
              ($1,$3,'FREQ','Procedimento Frequente','#00aa00',20)`,
      [s.tenantId, raro, frequente]);

    // Cinco atendimentos com o frequente, um com o raro.
    for (let i = 0; i < 5; i += 1) {
      await a.query(
        `INSERT INTO sched.appointment
           (tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
            starts_at, ends_at, appointment_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,
                 clock_timestamp() - make_interval(days => $7::int),
                 clock_timestamp() - make_interval(days => $7::int) + interval '20 min',
                 (clock_timestamp() - make_interval(days => $7::int))::date,
                 'atendido',$8)`,
        [s.tenantId, uuidv7(), s.patientId, s.professionalId, s.clinicId,
         frequente, i + 1, s.userId]);
    }
    await a.query(
      `INSERT INTO sched.appointment
         (tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
          starts_at, ends_at, appointment_date, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6, clock_timestamp(), clock_timestamp() + interval '1h',
               current_date, 'atendido', $7)`,
      [s.tenantId, uuidv7(), s.patientId, s.professionalId, s.clinicId, raro, s.userId]);
  } finally {
    await a.end();
  }
});
afterAll(async () => { await closePools(); });

describe('procedimentos da agenda', () => {
  it('GET /v1/procedimentos marca o mais frequente por USO, nao por ordem alfabetica', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/procedimentos', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as {
      itens: { procedureId: string; nome: string; duracaoMin: number;
               maisFrequente: boolean; usosRecentes: number }[] }).itens;

    const f = itens.find((x) => x.procedureId === frequente);
    const rr = itens.find((x) => x.procedureId === raro);

    // "Mais frequente" e o que a recepcao agenda de verdade. Ordenar por nome
    // colocaria "Procedimento Frequente" antes de "Raro" por acaso alfabetico,
    // e o atalho deixaria de ser atalho.
    expect(f?.maisFrequente).toBe(true);
    expect(rr?.maisFrequente).toBe(false);
    expect(f?.usosRecentes).toBe(5);
    expect(f?.duracaoMin).toBe(20);

    await app.close();
  });

  it('procedimento de outro tenant nao aparece', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({ method: 'GET', url: '/v1/procedimentos', ...auth(outro) });
    expect((r.json() as { itens: { procedureId: string }[] }).itens
      .some((x) => x.procedureId === frequente)).toBe(false);
    await app.close();
  });
});

describe('profissionais da unidade', () => {
  it('GET /v1/profissionais lista quem atende, com nome e conselho', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/profissionais', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as {
      itens: { professionalId: string; nome: string; conselho: string }[] }).itens;

    const eu = itens.find((x) => x.professionalId === s.professionalId);
    expect(eu).toBeDefined();
    expect(eu?.nome).toBeTruthy();
    expect(eu?.nome).not.toMatch(/^[0-9a-f]{8}-/);
    // Conselho e registro sao o que a guia TISS exige e o que a recepcao usa
    // para nao agendar com o profissional errado quando ha homonimos.
    expect(eu?.conselho).toMatch(/^\d{2} \d+\/[A-Z]{2}$/);

    await app.close();
  });

  it('recepcao PODE listar profissionais — precisa deles para agendar', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({ method: 'GET', url: '/v1/profissionais', ...auth(recepcao) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
