import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
let amanha = '';

beforeAll(async () => {
  s = await semearSessao({ role: 'recepcao' });
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    const { rows } = await a.query<{ d: string }>(
      `SELECT to_char(app.local_date(clock_timestamp() + interval '1 day', c.timezone),
                      'YYYY-MM-DD') AS d
         FROM app.clinic c WHERE c.id = $1`, [s.clinicId]);
    amanha = rows[0]!.d;
  } finally { await a.end(); }
});

afterAll(async () => { await closePools(); });

describe('agendamento online — leitura publica', () => {
  it('lista horarios livres SEM login', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET',
      url: `/v1/publico/horarios?clinicId=${s.clinicId}&dia=${amanha}`
         + `&procedureId=${s.procedureId}`,
    });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      professionalId: string; professionalNome: string;
      inicio: string; fim: string }[] }).itens;
    expect(itens.length).toBeGreaterThan(0);
    expect(itens[0]?.professionalNome).toBeTruthy();

    // O que o publico ve e SO horario livre. Nome de paciente, quantidade de
    // consultas, telefone — nada disso pode aparecer numa pagina aberta.
    const cru = JSON.stringify(r.json());
    expect(cru).not.toContain(s.patientNome);
    expect(cru).not.toContain(s.patientCpf);
    await app.close();
  });

  it('nao devolve horario no passado', async () => {
    const app = await buildApp();
    const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    let ontem = '';
    try {
      const { rows } = await a.query<{ d: string }>(
        `SELECT to_char(app.local_date(clock_timestamp() - interval '1 day', c.timezone),
                        'YYYY-MM-DD') AS d
           FROM app.clinic c WHERE c.id = $1`, [s.clinicId]);
      ontem = rows[0]!.d;
    } finally { await a.end(); }

    const r = await app.inject({
      method: 'GET',
      url: `/v1/publico/horarios?clinicId=${s.clinicId}&dia=${ontem}`
         + `&procedureId=${s.procedureId}`,
    });
    // Quem abre a pagina de manha nao pode marcar as 08h de ontem.
    expect((r.json() as { itens: unknown[] }).itens).toHaveLength(0);
    await app.close();
  });
});

describe('agendamento online — marcacao', () => {
  it('marca sem login e cria o paciente como PRELIMINAR', async () => {
    const app = await buildApp();
    const livres = await app.inject({
      method: 'GET',
      url: `/v1/publico/horarios?clinicId=${s.clinicId}&dia=${amanha}`
         + `&procedureId=${s.procedureId}`,
    });
    const vaga = (livres.json() as { itens: {
      professionalId: string; inicio: string }[] }).itens[0]!;

    const r = await app.inject({
      method: 'POST', url: '/v1/publico/agendamentos',
      payload: {
        clinicId: s.clinicId,
        professionalId: vaga.professionalId,
        procedureId: s.procedureId,
        inicio: vaga.inicio,
        nome: 'Paciente Que Marcou Sozinho',
        telefone: '11988887777',
      },
    });

    expect(r.statusCode).toBe(201);
    const j = r.json() as { appointmentId: string };
    expect(j.appointmentId).toBeTruthy();

    const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      const { rows } = await a.query<{ cadastro_status: string; nome: string }>(
        `SELECT pat.cadastro_status, pat.full_name AS nome
           FROM sched.appointment ap
           JOIN clin.patient pat
             ON (pat.tenant_id, pat.id) = (ap.tenant_id, ap.patient_id)
          WHERE ap.id = $1`, [j.appointmentId]);
      // Preliminar: nome e telefone bastam para marcar. Exigir CPF de quem esta
      // no celular faz a pessoa desistir ou inventar — e o bloqueio de
      // finalizacao ja cobra o resto na recepcao.
      expect(rows[0]?.cadastro_status).toBe('preliminar');
      expect(rows[0]?.nome).toBe('Paciente Que Marcou Sozinho');
    } finally { await a.end(); }

    await app.close();
  });

  it('duas pessoas no mesmo horario: a segunda recebe 409', async () => {
    const app = await buildApp();
    const livres = await app.inject({
      method: 'GET',
      url: `/v1/publico/horarios?clinicId=${s.clinicId}&dia=${amanha}`
         + `&procedureId=${s.procedureId}`,
    });
    const vaga = (livres.json() as { itens: {
      professionalId: string; inicio: string }[] }).itens[0]!;

    const corpo = {
      clinicId: s.clinicId, professionalId: vaga.professionalId,
      procedureId: s.procedureId, inicio: vaga.inicio,
      nome: 'Primeiro', telefone: '11900000001',
    };
    const um = await app.inject({
      method: 'POST', url: '/v1/publico/agendamentos', payload: corpo });
    const dois = await app.inject({
      method: 'POST', url: '/v1/publico/agendamentos',
      payload: { ...corpo, nome: 'Segundo', telefone: '11900000002' } });

    expect(um.statusCode).toBe(201);
    // Duas pessoas clicando na mesma vaga e o caso NORMAL aqui. Quem perde tem
    // que saber; consulta fantasma seria pior que recusa.
    expect(dois.statusCode).toBe(409);
    await app.close();
  });

  it('nome ou telefone em branco e recusado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/publico/agendamentos',
      payload: {
        clinicId: s.clinicId, professionalId: s.professionalId,
        procedureId: s.procedureId, inicio: new Date(Date.now() + 86400000).toISOString(),
        nome: '  ', telefone: '11999999999',
      },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('a rota publica NAO expõe a agenda interna', async () => {
    const app = await buildApp();
    // Sem sessao, a rota interna do dia continua fechada. O agendamento online
    // abriu duas portas estreitas, e nao a agenda.
    const r = await app.inject({ method: 'GET', url: `/v1/agenda/dia?dia=${amanha}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it('a rota interna continua funcionando para quem tem sessao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/agenda/dia?dia=${amanha}`, ...auth(s) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

describe('procedimentos publicos', () => {
  it('lista o que a clinica oferece para marcacao online', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/publico/procedimentos?clinicId=${s.clinicId}` });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      procedureId: string; nome: string; duracaoMin: number }[] }).itens;
    expect(itens.length).toBeGreaterThan(0);
    expect(itens[0]?.nome).toBeTruthy();
    expect(itens[0]?.duracaoMin).toBeGreaterThan(0);

    // PREÇO NAO SAI. Valor de procedimento e negociado por convenio e por
    // contrato; publicar a tabela particular numa pagina aberta expoe a
    // politica comercial da clinica para o concorrente ao lado.
    expect(JSON.stringify(r.json())).not.toContain('valor');
    await app.close();
  });
});
