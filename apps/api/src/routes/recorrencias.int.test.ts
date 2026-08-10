import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { semearSessao, auth, type SementeSessao } from '../test-support';

let s: SementeSessao;
let procedureId: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => {
  s = await semearSessao({ role: 'recepcao' });
  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  try {
    procedureId = uuidv7();
    await pool.query(
      `INSERT INTO sched.procedure (tenant_id, id, code, nome, cor, duracao_min)
       VALUES ($1, $2, 'FISIO', 'Fisioterapia', '#4f46e5', 50)`,
      [s.tenantId, procedureId]);
  } finally {
    await pool.end();
  }
});

afterAll(async () => { await closePools(); });

function corpo(over: Record<string, unknown> = {}) {
  return {
    patientId: s.patientId,
    professionalId: s.professionalId,
    procedureId,
    primeiraData: '2027-03-02',   // terca
    hora: '14:00',
    freq: 'semanal',
    intervalo: 1,
    horizonteAte: '2027-03-30',
    ...over,
  };
}

describe('agendamento recorrente', () => {
  it('cria a serie inteira e devolve cada ocorrencia', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/agenda/recorrencias', ...auth(s), payload: corpo(),
    });
    expect(r.statusCode).toBe(201);
    const b = r.json() as { criadas: unknown[]; recusadas: unknown[] };
    // 02, 09, 16, 23 e 30 de marco — cinco tercas, horizonte inclusivo.
    expect(b.criadas).toHaveLength(5);
    expect(b.recusadas).toEqual([]);
    await app.close();
  });

  it('a hora de parede vira o instante do fuso da CLINICA', async () => {
    const pool = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const { rows } = await pool.query<{ parede: string; utc: string }>(
        `SELECT to_char(a.starts_at AT TIME ZONE c.timezone, 'HH24:MI') AS parede,
                to_char(a.starts_at AT TIME ZONE 'UTC', 'HH24:MI') AS utc
           FROM sched.appointment a
           JOIN app.clinic c ON c.id = a.clinic_id
          WHERE a.recurrence_id IS NOT NULL AND a.tenant_id = $1
          ORDER BY a.starts_at LIMIT 1`, [s.tenantId]);
      // 14:00 na clinica em TODA ocorrencia. Se a expansao tivesse sido feita
      // em UTC e convertida no fim, uma virada de regra de fuso no meio da
      // serie faria o horario andar — e o paciente chegaria na hora errada.
      expect(rows[0]?.parede).toBe('14:00');
      expect(rows[0]?.utc).not.toBe('14:00');
    } finally {
      await pool.end();
    }
  });

  it('colisao recusa SO a ocorrencia que colide, nao a serie', async () => {
    const app = await buildApp();
    // Segunda serie no mesmo horario: todas as cinco colidem com as anteriores.
    const r = await app.inject({
      method: 'POST', url: '/v1/agenda/recorrencias', ...auth(s), payload: corpo(),
    });
    expect(r.statusCode).toBe(201);
    const b = r.json() as { criadas: unknown[]; recusadas: { motivo: string }[] };
    // Numa fisioterapia de 12 sessoes, uma colidir com feriado nao pode
    // impedir as outras onze — mas a recepcao precisa VER quais falharam.
    expect(b.recusadas.length).toBeGreaterThan(0);
    expect(b.recusadas[0]?.motivo).toBe('horario_ocupado');
    await app.close();
  });

  it('a serie aparece na listagem com o que ainda vem', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/agenda/recorrencias', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      freq: string; futurasAtivas: number; procedimentoNome: string | null }[] }).itens;
    // Duas series existem: a primeira, que entrou inteira, e a do teste de
    // colisao, que nao criou nenhuma ocorrencia. A ordem e por mais recente,
    // entao pegar `itens[0]` cegamente cairia na vazia — e `futurasAtivas: 0`
    // nela e o comportamento CERTO, nao um defeito.
    expect(itens.length).toBeGreaterThanOrEqual(2);
    expect(itens.every((x) => x.freq === 'semanal')).toBe(true);
    expect(itens.every((x) => x.procedimentoNome === 'Fisioterapia')).toBe(true);
    const cheia = itens.find((x) => x.futurasAtivas > 0);
    expect(cheia?.futurasAtivas).toBe(5);
    await app.close();
  });

  it('cancelar para o que vem e nao apaga a serie', async () => {
    const app = await buildApp();
    const lista = await app.inject({
      method: 'GET', url: '/v1/agenda/recorrencias', ...auth(s) });
    // A serie que TEM ocorrencias futuras — cancelar a vazia nao provaria nada.
    const id = (lista.json() as { itens: { recurrenceId: string; futurasAtivas: number }[] })
      .itens.find((x) => x.futurasAtivas > 0)!.recurrenceId;

    const r = await app.inject({
      method: 'DELETE', url: `/v1/agenda/recorrencias/${id}`, ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { canceladas: number }).canceladas).toBeGreaterThan(0);

    // A serie continua existindo: ela e o motivo de as consultas passadas
    // existirem. Apagar apagaria a explicacao de uma cobranca.
    const depois = await app.inject({
      method: 'GET', url: '/v1/agenda/recorrencias', ...auth(s) });
    const itens = (depois.json() as { itens: { recurrenceId: string; futurasAtivas: number }[] }).itens;
    const alvo = itens.find((x) => x.recurrenceId === id);
    expect(alvo).toBeDefined();
    expect(alvo?.futurasAtivas).toBe(0);
    await app.close();
  });

  it('horizonte antes do inicio e recusado antes de tocar no banco', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/agenda/recorrencias', ...auth(s),
      payload: corpo({ primeiraData: '2027-05-01', horizonteAte: '2027-04-01' }),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('serie longa demais e recusada com explicacao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/agenda/recorrencias', ...auth(s),
      payload: corpo({ freq: 'diaria', primeiraData: '2027-01-01',
                       horizonteAte: '2030-01-01' }),
    });
    // Mil linhas em `sched.appointment`, cada uma disputando o indice de
    // exclusao. Recusar aqui protege o banco de um clique distraido.
    expect(r.statusCode).toBe(422);
    expect((r.json() as { erro: string }).erro).toBe('serie_muito_longa');
    await app.close();
  });
});
