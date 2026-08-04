import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

/**
 * §5.3 — a agenda. Encaixe e inegociavel no Brasil: a restricao de exclusao tem
 * que deixa-lo passar EXPLICITAMENTE, senao a recepcao descobre que o software
 * nao deixa encaixar e volta para o caderno.
 *
 * O harness sempre faz ROLLBACK, entao cada cenario que depende de conflito monta
 * o horario de base DENTRO da mesma transacao: sem isso o segundo INSERT nao teria
 * com o que colidir e o teste passaria a toa.
 */
const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const INSERT_SQL = `
  INSERT INTO sched.appointment
    (tenant_id, id, patient_id, professional_id, clinic_id, room_id,
     starts_at, ends_at, appointment_date, status, cancelled_at, encaixe, created_by)
  VALUES ($1, gen_random_uuid(), $2, $3, $4, $5,
          $6::timestamptz, $7::timestamptz,
          app.local_date($6::timestamptz,
                         (SELECT timezone FROM app.clinic WHERE id = $4)),
          $8::sched.appointment_status, $9::timestamptz, $10, app.current_user_id())`;

interface Agendamento {
  inicio: string;
  fim: string;
  encaixe?: boolean;
  profissional?: string;
  clinica?: string;
  sala?: string | null;
  status?: string;
  cancelledAt?: string | null;
}

function agendar(c: Client, a: Agendamento) {
  return c.query(INSERT_SQL, [
    F.TENANT_A,
    F.PATIENT_A_JOANA,
    a.profissional ?? F.PROF_A_ANA,
    a.clinica ?? F.CLINIC_A_SP,
    a.sala ?? null,
    a.inicio,
    a.fim,
    a.status ?? 'agendado',
    a.cancelledAt ?? null,
    a.encaixe ?? false,
  ]);
}

/** Horario de base e a sobreposicao parcial que todo cenario de conflito usa. */
const BASE = { inicio: '2026-09-01T13:00:00Z', fim: '2026-09-01T13:30:00Z' };
const SOBREPOE = { inicio: '2026-09-01T13:15:00Z', fim: '2026-09-01T13:45:00Z' };

const SALA = '01930000-0000-7000-8000-0000000000e1';

describe('sched.appointment', () => {
  let api: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
  });

  it('agenda o primeiro horario', async () => {
    const linhas = await comoAtor(api, ANA, async (c) => {
      const r = await agendar(c, BASE);
      return r.rowCount;
    });
    expect(linhas).toBe(1);
  });

  it('recusa sobreposicao do MESMO profissional quando nao e encaixe', async () => {
    const erro = await comoAtor(api, ANA, async (c) => {
      await agendar(c, BASE);
      return erroPg(() => agendar(c, SOBREPOE));
    });
    expect(erro.code).toBe('23P01');
    expect(erro.message).toMatch(/ex_appointment_sem_sobreposicao/);
  });

  it('ACEITA a mesma sobreposicao quando marcada como encaixe', async () => {
    const linhas = await comoAtor(api, ANA, async (c) => {
      await agendar(c, BASE);
      const r = await agendar(c, { ...SOBREPOE, encaixe: true });
      return r.rowCount;
    });
    expect(linhas).toBe(1);
  });

  it('encaixe nao vale para SALA: overbooking e de agenda, nao de espaco fisico', async () => {
    const erro = await comoAtor(api, ANA, async (c) => {
      await agendar(c, { ...BASE, sala: SALA });
      return erroPg(() =>
        agendar(c, {
          ...SOBREPOE,
          sala: SALA,
          encaixe: true,
          profissional: F.PROF_A_BRUNO,
        }),
      );
    });
    expect(erro.code).toBe('23P01');
    expect(erro.message).toMatch(/ex_appointment_sala/);
  });

  it('horario cancelado devolve o slot: a sobreposicao passa sem ser encaixe', async () => {
    const linhas = await comoAtor(api, ANA, async (c) => {
      await agendar(c, {
        ...BASE,
        status: 'cancelado',
        cancelledAt: '2026-08-31T12:00:00Z',
      });
      const r = await agendar(c, SOBREPOE);
      return r.rowCount;
    });
    expect(linhas).toBe(1);
  });

  it('recusa fim antes do inicio', async () => {
    // Quem recusa aqui e a coluna gerada `periodo`, avaliada ANTES do CHECK: o
    // construtor tstzrange nao aceita limite inferior maior que o superior e
    // aborta com 22000 (data_exception), nao com 23514. O CHECK continua no
    // lugar como segunda linha — e o teste seguinte prova que ele dispara.
    const erro = await comoAtor(api, ANA, (c) =>
      erroPg(() => agendar(c, { inicio: '2026-09-01T15:00:00Z', fim: '2026-09-01T14:00:00Z' })),
    );
    expect(erro.code).toBe('22000');
    expect(erro.message).toMatch(/range lower bound must be less than or equal to range upper bound/);
  });

  it('recusa consulta de duracao zero — e ali que o CHECK ends_at > starts_at morde', async () => {
    // tstzrange(x, x, '[)') e um intervalo VAZIO valido, entao a coluna gerada
    // deixa passar. Sem o CHECK, um slot de zero minuto entraria na grade.
    const erro = await comoAtor(api, ANA, (c) =>
      erroPg(() => agendar(c, { inicio: '2026-09-01T15:00:00Z', fim: '2026-09-01T15:00:00Z' })),
    );
    expect(erro.code).toBe('23514');
    expect(erro.message).toMatch(/violates check constraint/);
  });

  it('amarra status cancelado a cancelled_at nas DUAS direcoes', async () => {
    // O CHECK e uma bicondicional: nem cancelamento sem carimbo de hora, nem
    // carimbo de hora em horario que continua de pe. So testar um lado deixaria
    // metade da restricao sem cobertura.
    const semCarimbo = await comoAtor(api, ANA, (c) =>
      erroPg(() => agendar(c, { ...BASE, status: 'cancelado' })),
    );
    expect(semCarimbo.code).toBe('23514');
    expect(semCarimbo.message).toMatch(/violates check constraint/);

    const carimboSemCancelamento = await comoAtor(api, ANA, (c) =>
      erroPg(() => agendar(c, { ...BASE, cancelledAt: '2026-08-31T12:00:00Z' })),
    );
    expect(carimboSemCancelamento.code).toBe('23514');
    expect(carimboSemCancelamento.message).toMatch(/violates check constraint/);
  });

  it('appointment_date sai no fuso da CLINICA, nao no do tenant nem em UTC', async () => {
    // 2026-09-02T03:30:00Z e 2026-09-02 em UTC, 2026-09-02 00:30 em Sao Paulo
    // (UTC-3) e 2026-09-01 23:30 em Manaus (UTC-4). Uma rede com unidade nos dois
    // fusos e caso real, e a data do evento tem que divergir entre elas.
    const instante = '2026-09-02T03:30:00Z';
    const datas = await comoAtor(api, ANA, async (c) => {
      // Profissionais diferentes de proposito: o mesmo profissional no mesmo
      // instante cairia na restricao de exclusao antes de chegar na data.
      await agendar(c, {
        inicio: instante,
        fim: '2026-09-02T04:00:00Z',
        clinica: F.CLINIC_A_SP,
        profissional: F.PROF_A_ANA,
      });
      await agendar(c, {
        inicio: instante,
        fim: '2026-09-02T04:00:00Z',
        clinica: F.CLINIC_A_MANAUS,
        profissional: F.PROF_A_BRUNO,
      });
      const { rows } = await c.query<{ clinic_id: string; d: string }>(
        `SELECT clinic_id, appointment_date::text AS d
           FROM sched.appointment
          WHERE starts_at = $1::timestamptz
          ORDER BY appointment_date`,
        [instante],
      );
      return rows;
    });

    expect(datas).toEqual([
      { clinic_id: F.CLINIC_A_MANAUS, d: '2026-09-01' },
      { clinic_id: F.CLINIC_A_SP, d: '2026-09-02' },
    ]);
  });
});
