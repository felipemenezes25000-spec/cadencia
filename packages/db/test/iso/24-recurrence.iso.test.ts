import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

/**
 * §5.3 — recorrencia MATERIALIZADA, horizonte de 120 dias.
 *
 * Regra calculada em runtime significa recalcular a serie toda vez que a agenda
 * abre — e significa que arrastar UMA ocorrencia quebra a regra. Materializada,
 * cada ocorrencia e uma linha comum que se move, cancela e encaixa.
 *
 * O harness sempre faz ROLLBACK, entao o cenario de colisao monta a serie de base
 * DENTRO da mesma transacao: sem isso a segunda serie nao teria com o que colidir
 * e o teste passaria a toa.
 */
const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

/** Segunda-feira, 10h em Sao Paulo (UTC-3). */
const PRIMEIRA = '2026-09-07T13:00:00Z';

interface Serie {
  recurrence_id: string;
  geradas: number;
  puladas: number;
}

function materializar(c: Client, horizonteDias: number) {
  return c.query<Serie>(
    `SELECT * FROM sched.materialize_recurrence(
        p_patient_id      => $1,
        p_professional_id => $2,
        p_clinic_id       => $3,
        p_first_starts_at => $4::timestamptz,
        p_duracao_min     => 30,
        p_freq            => 'semanal',
        p_intervalo       => 1,
        p_horizonte_dias  => $5,
        p_procedure_id    => NULL)`,
    [F.PATIENT_A_JOANA, F.PROF_A_ANA, F.CLINIC_A_SP, PRIMEIRA, horizonteDias],
  );
}

describe('sched.materialize_recurrence', () => {
  let api: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
  });

  it('gera as ocorrencias ate o horizonte de 120 dias, e nao alem', async () => {
    const serie = await comoAtor(api, ANA, async (c) => {
      const { rows } = await materializar(c, 120);
      return rows[0];
    });
    // 120 dias / 7 = 17 semanas completas + a primeira.
    expect(serie?.geradas).toBe(18);
    expect(serie?.puladas).toBe(0);
  });

  it('para a serie no horizonte: a ultima ocorrencia cabe nele e a seguinte nao', async () => {
    // Sem este caso, uma serie de 19 ou de 17 ocorrencias passaria pela contagem
    // se o passo estivesse errado — o que amarra o horizonte e a DATA do fim.
    const limites = await comoAtor(api, ANA, async (c) => {
      const { rows: serie } = await materializar(c, 120);
      const { rows } = await c.query<{
        comeca_na_primeira: boolean;
        termina_em_119_dias: boolean;
        alem_do_horizonte: string;
        ate: string;
      }>(
        `SELECT min(a.starts_at) = $2::timestamptz                        AS comeca_na_primeira,
                max(a.starts_at) = $2::timestamptz + interval '119 days'  AS termina_em_119_dias,
                count(*) FILTER (
                  WHERE a.starts_at > $2::timestamptz + interval '120 days')::text
                                                                          AS alem_do_horizonte,
                (SELECT r.horizonte_ate::text FROM sched.recurrence r WHERE r.id = $1) AS ate
           FROM sched.appointment a
          WHERE a.recurrence_id = $1`,
        [serie[0]?.recurrence_id, PRIMEIRA],
      );
      return rows[0];
    });

    // 2026-09-07 + 17 semanas = +119 dias; a de numero 19 cairia em +126 dias,
    // depois do horizonte — que em Sao Paulo termina em 2027-01-05.
    expect(limites).toEqual({
      comeca_na_primeira: true,
      termina_em_119_dias: true,
      alem_do_horizonte: '0',
      ate: '2027-01-05',
    });
  });

  it('cada ocorrencia e um agendamento comum, movivel e cancelavel', async () => {
    const resultado = await comoAtor(api, ANA, async (c) => {
      const { rows: serie } = await materializar(c, 120);
      const id = serie[0]?.recurrence_id;

      const { rows: contagem } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM sched.appointment WHERE recurrence_id = $1`,
        [id],
      );

      // Arrastar UMA ocorrencia para outro horario nao pede nada da serie: e um
      // UPDATE comum. Com regra calculada em runtime, este movimento nao existe.
      const movida = await c.query(
        `UPDATE sched.appointment
            SET starts_at = starts_at + interval '2 hours',
                ends_at   = ends_at   + interval '2 hours'
          WHERE recurrence_id = $1 AND starts_at = $2::timestamptz`,
        [id, PRIMEIRA],
      );

      // Cancelar outra idem: status e carimbo, sem tocar na serie.
      const cancelada = await c.query(
        `UPDATE sched.appointment
            SET status = 'cancelado', cancelled_at = clock_timestamp(),
                cancel_reason = 'Paciente viajou'
          WHERE recurrence_id = $1 AND starts_at = $2::timestamptz + interval '7 days'`,
        [id, PRIMEIRA],
      );

      const { rows: vivas } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM sched.appointment
          WHERE recurrence_id = $1 AND status <> 'cancelado'`,
        [id],
      );

      return {
        total: Number(contagem[0]?.n),
        movida: movida.rowCount,
        cancelada: cancelada.rowCount,
        vivas: Number(vivas[0]?.n),
      };
    });

    expect(resultado).toEqual({ total: 18, movida: 1, cancelada: 1, vivas: 17 });
  });

  it('recusa horizonte maior que 120 dias — a serie infinita e o que trava a agenda', async () => {
    const erro = await comoAtor(api, ANA, (c) => erroPg(() => materializar(c, 400)));
    expect(erro.code).toBe('22023');
    expect(erro.message).toMatch(/horizonte/);
  });

  it('recusa horizonte menor que 1 dia', async () => {
    const erro = await comoAtor(api, ANA, (c) => erroPg(() => materializar(c, 0)));
    expect(erro.code).toBe('22023');
    expect(erro.message).toMatch(/horizonte/);
  });

  it('pula a ocorrencia que colidiria, em vez de abortar a serie inteira', async () => {
    // Horizonte 30: 2026-09-07, 14, 21, 28 e 10-05 — cinco ocorrencias. A segunda
    // serie repete os cinco horarios do MESMO profissional, entao todas colidem.
    const resultado = await comoAtor(api, ANA, async (c) => {
      const { rows: primeira } = await materializar(c, 30);
      const { rows: segunda } = await materializar(c, 30);
      const { rows: contagem } = await c.query<{ ocorrencias: string; series: string }>(
        `SELECT (SELECT count(*) FROM sched.appointment WHERE recurrence_id = $1) AS ocorrencias,
                (SELECT count(*) FROM sched.recurrence  WHERE id            = $1) AS series`,
        [segunda[0]?.recurrence_id],
      );
      return {
        primeira: primeira[0],
        segunda: segunda[0],
        ocorrencias: Number(contagem[0]?.ocorrencias),
        series: Number(contagem[0]?.series),
      };
    });

    expect(resultado.primeira?.geradas).toBe(5);
    expect(resultado.primeira?.puladas).toBe(0);
    expect(resultado.segunda?.geradas).toBe(0);
    expect(resultado.segunda?.puladas).toBe(5);
    expect(resultado.ocorrencias).toBe(0);
    // A serie que pulou tudo continua existindo: a recepcionista resolve as
    // puladas depois, na tela, e para isso a linha da serie tem que estar la.
    expect(resultado.series).toBe(1);
  });

  it('a serie fica registrada com o que a gerou, para a tela poder explicar', async () => {
    const serie = await comoAtor(api, ANA, async (c) => {
      const { rows } = await materializar(c, 120);
      const { rows: linhas } = await c.query<{
        freq: string;
        intervalo: number;
        duracao_min: number;
        patient_id: string;
        professional_id: string;
      }>(
        `SELECT freq, intervalo, duracao_min, patient_id, professional_id
           FROM sched.recurrence WHERE id = $1`,
        [rows[0]?.recurrence_id],
      );
      return linhas[0];
    });

    expect(serie).toEqual({
      freq: 'semanal',
      intervalo: 1,
      duracao_min: 30,
      patient_id: F.PATIENT_A_JOANA,
      professional_id: F.PROF_A_ANA,
    });
  });
});
