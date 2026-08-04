import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { comoAtor, erroPg, openClient, type IsoActor } from './harness';
import * as F from './fixtures';

/**
 * §5.4 — QUEBRA-VIDRO ASSISTENCIAL.
 *
 * O botao cinza com cadeado comunica "seu produto esta quebrado". O caminho
 * legitimo grava justificativa obrigatoria, prazo e evento de auditoria — e nao
 * e excecao a policy: e uma linha em clin.record_share, que a policy RESTRICTIVE
 * ja consulta. Por ser linha comum, ela expira sozinha, sem job.
 *
 * Nada aqui sobrevive ao ROLLBACK do harness: o seed global e visto por todas as
 * suites, e um compartilhamento a mais nele mudaria a contagem que a suite 05
 * afirma sobre o escopo clinico.
 */
const ANA_ADMIN: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const BRUNO_PROFISSIONAL: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_BRUNO,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const CARLA_RECEPCAO: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_CARLA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

/** Texto livre real, com mais de 20 caracteres. Nunca pode aparecer na trilha. */
const JUSTIFICATIVA =
  'paciente inconsciente no pronto atendimento, sem acompanhante';

async function quebraVidro(
  c: Client,
  patientId: string,
  justificativa = JUSTIFICATIVA,
  horas = 4,
): Promise<string> {
  const { rows } = await c.query<{ share_id: string }>(
    `SELECT clin.break_glass($1, $2, $3) AS share_id`,
    [patientId, justificativa, horas],
  );
  return rows[0]!.share_id;
}

async function enxergaProntuario(c: Client, patientId: string): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT 1 FROM clin.encounter WHERE patient_id = $1`,
    [patientId],
  );
  return rows.length > 0;
}

describe('quebra-vidro assistencial', () => {
  let api: Client;
  let admin: Client;

  beforeAll(async () => {
    api = await openClient(inject('isoApiUrl'));
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await api.end();
    await admin.end();
  });

  it('recusa justificativa curta — a exigencia e estrutural, nao de UI', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, BRUNO_PROFISSIONAL, (c) =>
        quebraVidro(c, F.PATIENT_A_RECEM_NASCIDO, 'urgente'),
      ),
    );
    expect(erro.code).toBe('22023');
    expect(erro.message).toMatch(/justificativa/);
  });

  it('recusa prazo fora da faixa de 1 a 72 horas', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, BRUNO_PROFISSIONAL, (c) =>
        quebraVidro(c, F.PATIENT_A_RECEM_NASCIDO, JUSTIFICATIVA, 240),
      ),
    );
    expect(erro.code).toBe('22023');
    expect(erro.message).toMatch(/prazo/);
  });

  it('recusa quem nao e profissional — quebra-vidro e ato assistencial', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, CARLA_RECEPCAO, (c) =>
        quebraVidro(c, F.PATIENT_A_RECEM_NASCIDO),
      ),
    );
    expect(erro.code).toBe('42501');
  });

  it('concede acesso com prazo, marca a linha e devolve o id do compartilhamento', async () => {
    await comoAtor(api, BRUNO_PROFISSIONAL, async (c) => {
      const shareId = await quebraVidro(c, F.PATIENT_A_RECEM_NASCIDO);
      expect(shareId).toMatch(/^[0-9a-f-]{36}$/);

      const { rows } = await c.query<{
        break_glass: boolean;
        reason: string;
        horas_de_prazo: string;
        grantee_professional_id: string;
      }>(
        `SELECT break_glass, reason, grantee_professional_id,
                round(extract(epoch FROM (expires_at - granted_at)) / 3600)::text
                  AS horas_de_prazo
           FROM clin.record_share WHERE id = $1`,
        [shareId],
      );
      expect(rows[0]?.break_glass).toBe(true);
      expect(rows[0]?.grantee_professional_id).toBe(F.PROF_A_BRUNO);
      expect(rows[0]?.horas_de_prazo).toBe('4');
      // A justificativa fica no dominio, sob RLS — nunca na trilha.
      expect(rows[0]?.reason).toBe(JUSTIFICATIVA);
    });
  });

  it('recusa compartilhamento marcado como quebra-vidro sem prazo', async () => {
    // app_rw tem INSERT direto em clin.record_share desde a Fase 0 (concessao
    // manual). O CHECK e o que impede alguem contornar a funcao e gravar um
    // quebra-vidro eterno pela porta dos fundos.
    const erro = await erroPg(() =>
      comoAtor(api, ANA_ADMIN, (c) =>
        c.query(
          `INSERT INTO clin.record_share
             (tenant_id, id, patient_id, grantee_professional_id,
              granted_by_professional_id, reason, break_glass)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, true)`,
          [
            F.TENANT_A,
            F.PATIENT_A_RECEM_NASCIDO,
            F.PROF_A_BRUNO,
            F.PROF_A_ANA,
            JUSTIFICATIVA,
          ],
        ),
      ),
    );
    expect(erro.code).toBe('23514');
    expect(erro.message).toMatch(/quebra_vidro_tem_prazo/);
  });

  it('depois do quebra-vidro o profissional passa a enxergar o prontuario', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      // O seed compartilha Joana com Bruno. Revogar dentro da transacao e o que
      // faz a afirmacao ter conteudo: sem isto o teste passaria pelo seed.
      await c.query(
        'UPDATE clin.record_share SET revoked_at = clock_timestamp() WHERE id = $1',
        [F.SHARE_A_JOANA_PARA_BRUNO],
      );
      await c.query(`SELECT set_config('app.user_id', $1, TRUE)`, [F.USER_A_BRUNO]);

      expect(
        await enxergaProntuario(c, F.PATIENT_A_JOANA),
        'sem o quebra-vidro a RLS precisa esconder o atendimento',
      ).toBe(false);

      await quebraVidro(c, F.PATIENT_A_JOANA);

      expect(await enxergaProntuario(c, F.PATIENT_A_JOANA)).toBe(true);
    });
  });

  it('prazo vencido fecha o acesso sozinho, sem ninguem revogar nada', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      await c.query(
        'UPDATE clin.record_share SET revoked_at = clock_timestamp() WHERE id = $1',
        [F.SHARE_A_JOANA_PARA_BRUNO],
      );
      await c.query(`SELECT set_config('app.user_id', $1, TRUE)`, [F.USER_A_BRUNO]);

      const shareId = await quebraVidro(c, F.PATIENT_A_JOANA);
      expect(await enxergaProntuario(c, F.PATIENT_A_JOANA)).toBe(true);

      // Ninguem revoga: o relogio passa. revoked_at continua NULL de proposito.
      await c.query(
        `UPDATE clin.record_share
            SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
        [shareId],
      );

      expect(await enxergaProntuario(c, F.PATIENT_A_JOANA)).toBe(false);
    });
  });

  it('grava evento de auditoria RECORD_BREAK_GLASS com o prazo, sem dado clinico', async () => {
    await comoAtor(api, BRUNO_PROFISSIONAL, async (c) => {
      const shareId = await quebraVidro(c, F.PATIENT_A_RECEM_NASCIDO);

      const { rows } = await c.query<{
        outcome: string;
        entity_schema: string;
        entity_table: string;
        entity_id: string;
        meta: Record<string, unknown>;
      }>(
        `SELECT outcome, entity_schema, entity_table, entity_id, meta FROM audit.event
          WHERE event_type = 'RECORD_BREAK_GLASS' ORDER BY id DESC LIMIT 1`,
      );

      expect(rows[0]?.outcome).toBe('sucesso');
      expect(rows[0]?.entity_schema).toBe('clin');
      expect(rows[0]?.entity_table).toBe('record_share');
      // entity_id e REFERENCIA, nunca conteudo (NGS1.07.06).
      expect(rows[0]?.entity_id).toBe(shareId);
      expect(rows[0]?.meta).toEqual({ horas: 4 });
      expect(JSON.stringify(rows[0])).not.toContain('inconsciente');
    });
  });

  it('toda policy que consulta record_share tambem consulta expires_at', async () => {
    // Varredura do catalogo, nao lista escrita a mao: policy nova que esquecer o
    // prazo transforma o quebra-vidro em concessao permanente naquela tabela.
    const { rows } = await admin.query<{ rel: string; polname: string; expr: string }>(
      `SELECT n.nspname || '.' || c.relname AS rel, p.polname,
              pg_get_expr(p.polqual, p.polrelid) AS expr
         FROM pg_policy p
         JOIN pg_class c     ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE pg_get_expr(p.polqual, p.polrelid) LIKE '%record_share%'
        ORDER BY 1, 2`,
    );

    expect(rows.length).toBeGreaterThanOrEqual(7);
    for (const linha of rows) {
      expect(
        linha.expr,
        `${linha.rel} / ${linha.polname} consulta record_share sem olhar expires_at`,
      ).toContain('expires_at');
    }
  });
});
