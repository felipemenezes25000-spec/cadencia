import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

/**
 * §5.3 — lista de espera como painel lateral fixo da Agenda, com arrastar para o
 * vao. A ordem dos candidatos e regra de NEGOCIO e mora no banco, nao na tela:
 * duas telas com criterios diferentes e como a recepcao perde a confianca na fila.
 *
 * O harness sempre faz ROLLBACK, entao cada cenario monta a fila que ele mesmo
 * consulta DENTRO da sua transacao: sem isso o teste de ordem passaria a toa,
 * lendo uma fila vazia.
 */
const ANA: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

/** Terca-feira, 10h em Sao Paulo (UTC-3) — dentro da janela de setembro. */
const VAO_DE_SETEMBRO = '2026-09-08T13:00:00Z';
/** Mesmo horario, tres meses depois — fora da janela de setembro. */
const VAO_DE_DEZEMBRO = '2026-12-01T13:00:00Z';

interface Candidato {
  waitlist_id: string;
  patient_id: string;
  prioridade: string;
  esperando_desde: Date;
}

/**
 * Entra na fila. `professionalId` NULL significa "qualquer profissional serve".
 * `esperaDias` recua o carimbo de entrada para que a ordem do resultado nao possa
 * ser confundida com a ordem fisica de insercao.
 */
function entrarNaFila(
  c: Client,
  entrada: {
    patientId: string;
    professionalId: string | null;
    prioridade: string;
    esperaDias?: number;
    janelaDe?: string | null;
    janelaAte?: string | null;
  },
) {
  return c.query(
    `INSERT INTO sched.waitlist
       (tenant_id, id, patient_id, professional_id, clinic_id, prioridade,
        janela_de, janela_ate, created_at, created_by)
     VALUES ($1, gen_random_uuid(), $2, $3, $4, $5::sched.waitlist_priority,
             $6::date, $7::date,
             clock_timestamp() - make_interval(days => $8), app.current_user_id())`,
    [
      F.TENANT_A,
      entrada.patientId,
      entrada.professionalId,
      F.CLINIC_A_SP,
      entrada.prioridade,
      entrada.janelaDe ?? null,
      entrada.janelaAte ?? null,
      entrada.esperaDias ?? 0,
    ],
  );
}

function candidatos(c: Client, at: string) {
  return c.query<Candidato>(
    `SELECT waitlist_id, patient_id, prioridade::text AS prioridade, esperando_desde
       FROM sched.waitlist_candidates($1, $2::timestamptz)`,
    [F.PROF_A_ANA, at],
  );
}

describe('sched.waitlist', () => {
  let api: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
  });

  afterAll(async () => {
    await api.end();
  });

  it('entra na fila com prioridade e janela desejada', async () => {
    const r = await comoAtor(api, ANA, (c) =>
      entrarNaFila(c, {
        patientId: F.PATIENT_A_JOANA,
        professionalId: F.PROF_A_ANA,
        prioridade: 'alta',
        janelaDe: '2026-09-01',
        janelaAte: '2026-09-30',
      }),
    );
    expect(r.rowCount).toBe(1);
  });

  it('candidatos para um vao saem ordenados por prioridade e depois por espera', async () => {
    const fila = await comoAtor(api, ANA, async (c) => {
      // Insercao deliberadamente fora de ordem: se a funcao devolvesse a ordem
      // fisica da tabela, o resultado esperado seria exatamente o inverso deste.
      // O recem-nascido espera ha 10 dias, mais que todo mundo, mas em prioridade
      // 'normal' — e por isso sai por ultimo.
      await entrarNaFila(c, {
        patientId: F.PATIENT_A_RECEM_NASCIDO,
        professionalId: null,
        prioridade: 'normal',
        esperaDias: 10,
      });
      await entrarNaFila(c, {
        patientId: F.PATIENT_A_RECEM_NASCIDO,
        professionalId: F.PROF_A_ANA,
        prioridade: 'alta',
        esperaDias: 1,
      });
      await entrarNaFila(c, {
        patientId: F.PATIENT_A_JOANA,
        professionalId: F.PROF_A_ANA,
        prioridade: 'alta',
        esperaDias: 5,
      });
      const { rows } = await candidatos(c, VAO_DE_SETEMBRO);
      return rows;
    });

    expect(
      fila.map((l) => [l.patient_id, l.prioridade]),
    ).toEqual([
      // 'alta' antes de 'normal'; dentro de 'alta', quem espera ha 5 dias antes
      // de quem espera ha 1.
      [F.PATIENT_A_JOANA, 'alta'],
      [F.PATIENT_A_RECEM_NASCIDO, 'alta'],
      [F.PATIENT_A_RECEM_NASCIDO, 'normal'],
    ]);
  });

  it('nao devolve candidato fora da janela desejada', async () => {
    const fila = await comoAtor(api, ANA, async (c) => {
      await entrarNaFila(c, {
        patientId: F.PATIENT_A_JOANA,
        professionalId: F.PROF_A_ANA,
        prioridade: 'alta',
        janelaDe: '2026-09-01',
        janelaAte: '2026-09-30',
      });
      const dentro = await candidatos(c, VAO_DE_SETEMBRO);
      const fora = await candidatos(c, VAO_DE_DEZEMBRO);
      return { dentro: dentro.rowCount, fora: fora.rowCount };
    });

    // A mesma linha aparece no vao de setembro e some no de dezembro: sem o par,
    // um `0` poderia significar apenas que a fila estava vazia.
    expect(fila).toEqual({ dentro: 1, fora: 0 });
  });

  it('quem ja saiu da fila nao volta como candidato', async () => {
    const fila = await comoAtor(api, ANA, async (c) => {
      await entrarNaFila(c, {
        patientId: F.PATIENT_A_JOANA,
        professionalId: F.PROF_A_ANA,
        prioridade: 'urgente',
      });
      const antes = await candidatos(c, VAO_DE_SETEMBRO);
      await c.query(
        `UPDATE sched.waitlist
            SET closed_at = clock_timestamp(), close_reason = 'Agendou por telefone'
          WHERE patient_id = $1`,
        [F.PATIENT_A_JOANA],
      );
      const depois = await candidatos(c, VAO_DE_SETEMBRO);
      return { antes: antes.rowCount, depois: depois.rowCount };
    });

    expect(fila).toEqual({ antes: 1, depois: 0 });
  });

  it('so ha UMA entrada ativa por paciente e profissional', async () => {
    const erro = await comoAtor(api, ANA, async (c) => {
      await entrarNaFila(c, {
        patientId: F.PATIENT_A_JOANA,
        professionalId: F.PROF_A_ANA,
        prioridade: 'alta',
      });
      return erroPg(() =>
        entrarNaFila(c, {
          patientId: F.PATIENT_A_JOANA,
          professionalId: F.PROF_A_ANA,
          prioridade: 'normal',
        }),
      );
    });

    expect(erro.code).toBe('23505');
    expect(erro.message).toMatch(/ux_waitlist_ativa/);
  });

  it("'qualquer profissional' e UMA entrada, e nao uma por profissional", async () => {
    // O coalesce do indice parcial e o que segura isto: sem ele, professional_id
    // NULL escaparia da unicidade e o paciente entraria N vezes na mesma fila.
    const erro = await comoAtor(api, ANA, async (c) => {
      await entrarNaFila(c, {
        patientId: F.PATIENT_A_JOANA,
        professionalId: null,
        prioridade: 'normal',
      });
      return erroPg(() =>
        entrarNaFila(c, {
          patientId: F.PATIENT_A_JOANA,
          professionalId: null,
          prioridade: 'urgente',
        }),
      );
    });

    expect(erro.code).toBe('23505');
    expect(erro.message).toMatch(/ux_waitlist_ativa/);
  });

  it('a fila do tenant A nao enxerga nem aceita linha do tenant B', async () => {
    const erro = await comoAtor(api, ANA, (c) =>
      erroPg(() =>
        c.query(
          `INSERT INTO sched.waitlist
             (tenant_id, id, patient_id, professional_id, clinic_id, prioridade, created_by)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, 'alta', app.current_user_id())`,
          [F.TENANT_B, F.PATIENT_B_MARCOS, F.PROF_B_DIEGO, F.CLINIC_B_RIO_BRANCO],
        ),
      ),
    );
    // 42501 = a WITH CHECK da policy barra a escrita cruzada antes da FK.
    expect(erro.code).toBe('42501');
  });
});
