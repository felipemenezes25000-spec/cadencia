import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
let aniversarianteDeHoje = '';

async function semearPainel(t: SementeSessao): Promise<void> {
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    // Um paciente que faz aniversario HOJE, em outro ano. O ano nao pode entrar
    // na comparacao — senao "aniversariantes de hoje" so acha quem nasceu hoje.
    aniversarianteDeHoje = uuidv7();
    await a.query(
      `INSERT INTO clin.patient
         (tenant_id, id, full_name, cadastro_status, birth_date, phone_primary)
       VALUES ($1,$2,'Aniversariante Do Dia','completo',
               make_date(1980, extract(month FROM app.local_date(clock_timestamp(),'America/Sao_Paulo'))::int,
                               extract(day   FROM app.local_date(clock_timestamp(),'America/Sao_Paulo'))::int),
               '11988887777')`,
      [t.tenantId, aniversarianteDeHoje]);

    // Um que faz amanha, para provar que a janela e do DIA e nao do mes.
    await a.query(
      `INSERT INTO clin.patient
         (tenant_id, id, full_name, cadastro_status, birth_date)
       VALUES ($1,$2,'Aniversariante De Amanha','completo',
               make_date(1975, extract(month FROM app.local_date(clock_timestamp(),'America/Sao_Paulo') + 1)::int,
                               extract(day   FROM app.local_date(clock_timestamp(),'America/Sao_Paulo') + 1)::int))`,
      [t.tenantId, uuidv7()]);

    // Atendimentos com duracao REAL medida (started_at -> finished_at).
    const proc = uuidv7();
    await a.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min)
       VALUES ($1,$2,'PNL','Consulta Painel','#0055aa',30)`, [t.tenantId, proc]);

    for (const [i, minutos] of [20, 40, 30].entries()) {
      await a.query(
        `INSERT INTO sched.appointment
           (tenant_id, id, patient_id, professional_id, clinic_id, procedure_id,
            operadora_nome, starts_at, ends_at, appointment_date, status,
            started_at, finished_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
                 clock_timestamp() - make_interval(days => $8::int),
                 clock_timestamp() - make_interval(days => $8::int) + interval '30 min',
                 (clock_timestamp() - make_interval(days => $8::int))::date,
                 'atendido',
                 clock_timestamp() - make_interval(days => $8::int),
                 clock_timestamp() - make_interval(days => $8::int)
                   + make_interval(mins => $9::int),
                 $10)`,
        [t.tenantId, uuidv7(), t.patientId, t.professionalId, t.clinicId, proc,
         i === 2 ? null : 'Unimed', i + 1, minutos, t.userId]);
    }
  } finally {
    await a.end();
  }
}

beforeAll(async () => {
  s = await semearSessao({ role: 'admin_clinico' });
  await semearPainel(s);
});
afterAll(async () => { await closePools(); });

describe('painel — aniversariantes', () => {
  it('GET /v1/painel/aniversariantes traz quem faz aniversario hoje', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/painel/aniversariantes', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as {
      itens: { patientId: string; nome: string; idade: number;
               telefone: string | null }[] }).itens;

    const hoje = itens.find((x) => x.patientId === aniversarianteDeHoje);
    expect(hoje?.nome).toBe('Aniversariante Do Dia');
    // A idade e a que a pessoa COMPLETA hoje, nao a que tinha ontem.
    expect(hoje?.idade).toBe(new Date().getUTCFullYear() - 1980);
    expect(hoje?.telefone).toBe('11988887777');

    expect(itens.some((x) => x.nome === 'Aniversariante De Amanha')).toBe(false);

    await app.close();
  });

  it('nao mostra aniversariante de outro tenant', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'admin_clinico' });
    const r = await app.inject({
      method: 'GET', url: '/v1/painel/aniversariantes', ...auth(outro) });
    expect((r.json() as { itens: { patientId: string }[] }).itens
      .some((x) => x.patientId === aniversarianteDeHoje)).toBe(false);
    await app.close();
  });
});

describe('painel — graficos', () => {
  it('GET /v1/painel/graficos devolve as seis series do inventario', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/painel/graficos?dias=30', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      atendimentosNoPeriodo: { dia: string; total: number }[];
      porProcedimento: { rotulo: string; total: number }[];
      porConvenio: { rotulo: string; total: number }[];
      duracaoMedia: { rotulo: string; minutos: number }[];
      pacientesNovos: { dia: string; total: number }[];
      distribuicaoEtaria: { faixa: string; total: number }[];
    };

    expect(d.atendimentosNoPeriodo.length).toBeGreaterThan(0);
    expect(d.porProcedimento.find((x) => x.rotulo === 'Consulta Painel')?.total).toBe(3);

    // Quem nao tem convenio e PARTICULAR, nao "sem dados": a distribuicao so
    // informa se o particular aparece como fatia.
    expect(d.porConvenio.find((x) => x.rotulo === 'Unimed')?.total).toBe(2);
    expect(d.porConvenio.find((x) => x.rotulo === 'Particular')?.total).toBe(1);

    // Duracao REAL (started_at -> finished_at), nao a agendada: 20, 40 e 30
    // dao media 30. A diferenca entre agendado e realizado e o numero que
    // interessa a quem monta a grade.
    expect(d.duracaoMedia.find((x) => x.rotulo === 'Consulta Painel')?.minutos).toBe(30);

    expect(Array.isArray(d.pacientesNovos)).toBe(true);
    expect(d.distribuicaoEtaria.reduce((a, x) => a + x.total, 0)).toBeGreaterThan(0);

    await app.close();
  });

  it('recepcao nao ve os graficos de gestao', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'GET', url: '/v1/painel/graficos', ...auth(recepcao) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
