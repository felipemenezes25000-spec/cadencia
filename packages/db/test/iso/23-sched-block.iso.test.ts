import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

/**
 * §5.3 — bloqueio de horario e ausencia. Bloqueio NAO e agendamento: nao tem
 * paciente, e por isso vive em tabela propria.
 *
 * O ponto do desenho e o que o bloqueio NAO faz: ele nao impede o INSERT de um
 * agendamento em cima dele. Quem decide encaixar sobre o almoco e a recepcao,
 * com a pessoa na frente. O que existe e sched.is_blocked, que a tela consulta
 * para AVISAR — a diferenca entre software que ajuda e software que atrapalha.
 *
 * O harness sempre faz ROLLBACK, entao cada cenario monta o bloqueio de base
 * DENTRO da mesma transacao: sem isso nao haveria com o que colidir e o teste
 * passaria a toa.
 */
const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const INSERT_BLOCK_SQL = `
  INSERT INTO sched.block
    (tenant_id, id, professional_id, clinic_id, starts_at, ends_at, kind, motivo, created_by)
  VALUES ($1, gen_random_uuid(), $2::uuid, $3, $4::timestamptz, $5::timestamptz,
          $6::sched.block_kind, $7, app.current_user_id())`;

interface Bloqueio {
  inicio: string;
  fim: string;
  kind?: string;
  motivo?: string;
  profissional?: string | null;
  clinica?: string;
}

function bloquear(c: Client, b: Bloqueio) {
  return c.query(INSERT_BLOCK_SQL, [
    F.TENANT_A,
    b.profissional === undefined ? F.PROF_A_ANA : b.profissional,
    b.clinica ?? F.CLINIC_A_SP,
    b.inicio,
    b.fim,
    b.kind ?? 'almoco',
    b.motivo ?? 'Almoco',
  ]);
}

/** Almoco de base e a ausencia que o sobrepoe parcialmente. */
const ALMOCO = { inicio: '2026-09-02T12:00:00Z', fim: '2026-09-02T14:00:00Z' };
const CONGRESSO = {
  inicio: '2026-09-02T13:00:00Z',
  fim: '2026-09-02T15:00:00Z',
  kind: 'ausencia',
  motivo: 'Congresso',
};

describe('sched.block', () => {
  let api: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
  });

  it('bloqueia um periodo do profissional', async () => {
    const linhas = await comoAtor(api, ANA, async (c) => {
      const r = await bloquear(c, ALMOCO);
      return r.rowCount;
    });
    expect(linhas).toBe(1);
  });

  it('recusa dois bloqueios sobrepostos do mesmo profissional', async () => {
    const erro = await comoAtor(api, ANA, async (c) => {
      await bloquear(c, ALMOCO);
      return erroPg(() => bloquear(c, CONGRESSO));
    });
    expect(erro.code).toBe('23P01');
    expect(erro.message).toMatch(/ex_block_sem_sobreposicao/);
  });

  it('bloqueio da unidade inteira nao colide com outro: feriado nao tem profissional', async () => {
    // A restricao de exclusao e parcial (WHERE professional_id IS NOT NULL): dois
    // feriados no mesmo periodo sao dado administrativo, nao conflito de agenda.
    const linhas = await comoAtor(api, ANA, async (c) => {
      await bloquear(c, { ...ALMOCO, profissional: null, kind: 'feriado', motivo: 'Feriado' });
      const r = await bloquear(c, { ...CONGRESSO, profissional: null, kind: 'feriado', motivo: 'Ponte' });
      return r.rowCount;
    });
    expect(linhas).toBe(1);
  });

  it('bloqueio NAO impede encaixe — a decisao e da recepcao, com a pessoa na frente', async () => {
    const resultado = await comoAtor(api, ANA, async (c) => {
      await bloquear(c, ALMOCO);

      // O agendamento em cima do almoco PASSA: nenhuma restricao o barra.
      const agendado = await c.query(
        `INSERT INTO sched.appointment
           (tenant_id, id, patient_id, professional_id, clinic_id,
            starts_at, ends_at, appointment_date, encaixe, created_by)
         VALUES ($1, gen_random_uuid(), $2, $3, $4,
                 $5::timestamptz, $6::timestamptz,
                 app.local_date($5::timestamptz,
                                (SELECT timezone FROM app.clinic WHERE id = $4)),
                 true, app.current_user_id())`,
        [
          F.TENANT_A,
          F.PATIENT_A_JOANA,
          F.PROF_A_ANA,
          F.CLINIC_A_SP,
          '2026-09-02T12:30:00Z',
          '2026-09-02T13:00:00Z',
        ],
      );

      // E o aviso continua disponivel para a tela desenhar.
      const { rows } = await c.query<{ conflita: boolean }>(
        `SELECT sched.is_blocked($1::uuid, $2::timestamptz, $3::timestamptz) AS conflita`,
        [F.PROF_A_ANA, '2026-09-02T12:30:00Z', '2026-09-02T13:00:00Z'],
      );
      return { agendado: agendado.rowCount, conflita: rows[0]?.conflita };
    });

    expect(resultado).toEqual({ agendado: 1, conflita: true });
  });

  it('is_blocked e falso fora do periodo bloqueado', async () => {
    // Sem este caso o aviso poderia estar preso em `true` e o teste anterior
    // continuaria verde — aviso que sempre acende nao e aviso, e ruido.
    const conflita = await comoAtor(api, ANA, async (c) => {
      await bloquear(c, ALMOCO);
      const { rows } = await c.query<{ conflita: boolean }>(
        `SELECT sched.is_blocked($1::uuid, $2::timestamptz, $3::timestamptz) AS conflita`,
        [F.PROF_A_ANA, '2026-09-02T14:00:00Z', '2026-09-02T14:30:00Z'],
      );
      return rows[0]?.conflita;
    });
    expect(conflita).toBe(false);
  });

  it('bloqueio da unidade inteira avisa para QUALQUER profissional', async () => {
    const conflita = await comoAtor(api, ANA, async (c) => {
      await bloquear(c, { ...ALMOCO, profissional: null, kind: 'feriado', motivo: 'Feriado' });
      const { rows } = await c.query<{ conflita: boolean }>(
        `SELECT sched.is_blocked($1::uuid, $2::timestamptz, $3::timestamptz) AS conflita`,
        [F.PROF_A_BRUNO, '2026-09-02T12:30:00Z', '2026-09-02T13:00:00Z'],
      );
      return rows[0]?.conflita;
    });
    expect(conflita).toBe(true);
  });

  it('recusa fim antes do inicio e bloqueio de duracao zero', async () => {
    // Igual a sched.appointment: a coluna gerada `periodo` recusa o intervalo
    // invertido (22000) antes do CHECK, e o CHECK morde a duracao zero (23514).
    const invertido = await comoAtor(api, ANA, (c) =>
      erroPg(() => bloquear(c, { inicio: '2026-09-02T15:00:00Z', fim: '2026-09-02T14:00:00Z' })),
    );
    expect(invertido.code).toBe('22000');

    const zero = await comoAtor(api, ANA, (c) =>
      erroPg(() => bloquear(c, { inicio: '2026-09-02T15:00:00Z', fim: '2026-09-02T15:00:00Z' })),
    );
    expect(zero.code).toBe('23514');
    expect(zero.message).toMatch(/violates check constraint/);
  });
});
