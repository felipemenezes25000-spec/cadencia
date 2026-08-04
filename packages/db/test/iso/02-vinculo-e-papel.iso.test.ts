import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import { erroPg, openClient, PREAMBULO_SQL } from './harness';

const T = {
  tenant: '01930000-0000-7000-8000-00000000f201',
  outroTenant: '01930000-0000-7000-8000-00000000f202',
  clinicaSp: '01930000-0000-7000-8000-00000000f203',
  clinicaManaus: '01930000-0000-7000-8000-00000000f204',
  clinicaAlheia: '01930000-0000-7000-8000-00000000f205',
  userAna: '01930000-0000-7000-8000-00000000f206',
  userCarla: '01930000-0000-7000-8000-00000000f207',
  membershipAdminSp: '01930000-0000-7000-8000-00000000f208',
  membershipProfManaus: '01930000-0000-7000-8000-00000000f209',
  membershipRecepSp: '01930000-0000-7000-8000-00000000f20a',
  profAna: '01930000-0000-7000-8000-00000000f20b',
  request: '01930000-0000-7000-8000-00000000f2ff',
};

/**
 * Monta o cenario real: Ana e admin_clinico em Sao Paulo e profissional em Manaus.
 * UMA instrucao por chamada: o driver `pg` recusa varias instrucoes numa unica query
 * com parametros — devolve 42601 "cannot insert multiple commands into a prepared
 * statement", e nenhuma assercao chegaria a rodar.
 */
async function montarCenario(c: Client): Promise<void> {
  await c.query(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj) VALUES
       ($1, 'rede-f2',  'Rede Aurora Ltda',    '12ABC345678901'),
       ($2, 'outra-f2', 'Clinica Boreal Ltda', '98XYZ765432109')`,
    [T.tenant, T.outroTenant],
  );
  await c.query(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone) VALUES
       ($1, $3, 'Aurora Paulista',   'America/Sao_Paulo'),
       ($1, $4, 'Aurora Manaus',     'America/Manaus'),
       ($2, $5, 'Boreal Rio Branco', 'America/Rio_Branco')`,
    [T.tenant, T.outroTenant, T.clinicaSp, T.clinicaManaus, T.clinicaAlheia],
  );
  await c.query(
    `INSERT INTO id."user" (id, email, full_name) VALUES
       ($1, 'ana@aurora.test',   'Ana Ribeiro'),
       ($2, 'carla@aurora.test', 'Carla Nogueira')`,
    [T.userAna, T.userCarla],
  );
  await c.query(
    `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role) VALUES
       ($1, $2, $5, $7, 'admin_clinico'),
       ($1, $3, $5, $8, 'profissional'),
       ($1, $4, $6, $7, 'recepcao')`,
    [T.tenant, T.membershipAdminSp, T.membershipProfManaus, T.membershipRecepSp,
     T.userAna, T.userCarla, T.clinicaSp, T.clinicaManaus],
  );
  await c.query(
    `INSERT INTO app.professional
       (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
     VALUES ($1, $2, $3, '06', '123456', 'SP', '225125')`,
    [T.tenant, T.profAna, T.userAna],
  );
}

describe('vinculo e papel resolvidos dentro do banco', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = await openClient(inject('isoAdminUrl'));
  });

  afterAll(async () => {
    await admin.end();
  });

  /** BEGIN, monta o cenario, aplica preambulo do usuario, roda, ROLLBACK. */
  async function comCenario<R>(
    userId: string,
    clinicId: string,
    fn: (c: Client) => Promise<R>,
  ): Promise<R> {
    await admin.query('BEGIN');
    try {
      await montarCenario(admin);
      await admin.query(PREAMBULO_SQL, [
        T.tenant, userId, clinicId, 'user', T.request,
      ]);
      return await fn(admin);
    } finally {
      await admin.query('ROLLBACK');
    }
  }

  it('a mesma medica e admin_clinico em Sao Paulo e apenas profissional em Manaus', async () => {
    await comCenario(T.userAna, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ sp: boolean; manaus: boolean }>(
        `SELECT app.has_role_in($1, ARRAY['admin_clinico']) AS sp,
                app.has_role_in($2, ARRAY['admin_clinico']) AS manaus`,
        [T.clinicaSp, T.clinicaManaus],
      );
      expect(rows[0]).toEqual({ sp: true, manaus: false });
    });
  });

  it('app.is_member() e verdadeiro para quem tem vinculo vigente no tenant', async () => {
    await comCenario(T.userAna, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ m: boolean }>('SELECT app.is_member() AS m');
      expect(rows[0]!.m).toBe(true);
    });
  });

  it('vinculo revogado deixa de valer no mesmo instante', async () => {
    await comCenario(T.userCarla, T.clinicaSp, async (c) => {
      await c.query(
        `UPDATE app.membership SET revoked_at = clock_timestamp() WHERE id = $1`,
        [T.membershipRecepSp],
      );
      const { rows } = await c.query<{ m: boolean }>('SELECT app.is_member() AS m');
      expect(rows[0]!.m).toBe(false);
    });
  });

  it('usuario sem vinculo nenhum no tenant nao e membro', async () => {
    await admin.query('BEGIN');
    try {
      await montarCenario(admin);
      await admin.query(PREAMBULO_SQL, [
        T.outroTenant, T.userAna, T.clinicaAlheia, 'user', T.request,
      ]);
      const { rows } = await admin.query<{ m: boolean }>('SELECT app.is_member() AS m');
      expect(rows[0]!.m).toBe(false);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('o ator de sistema e membro sem ter user_id, porque worker e outbox precisam gravar', async () => {
    await admin.query('BEGIN');
    try {
      await montarCenario(admin);
      await admin.query(PREAMBULO_SQL, [T.tenant, '', '', 'system', T.request]);
      const { rows } = await admin.query<{ m: boolean; u: string | null }>(
        'SELECT app.is_member() AS m, app.current_user_id() AS u',
      );
      expect(rows[0]).toEqual({ m: true, u: null });
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('o ator anonimo do agendamento online nao e membro', async () => {
    await admin.query('BEGIN');
    try {
      await montarCenario(admin);
      await admin.query(PREAMBULO_SQL, [T.tenant, '', '', 'anon', T.request]);
      const { rows } = await admin.query<{ m: boolean }>('SELECT app.is_member() AS m');
      expect(rows[0]!.m).toBe(false);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it('app.clinical_scope_all() e verdadeiro para admin_clinico e falso para recepcao', async () => {
    await comCenario(T.userAna, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ s: boolean }>(
        'SELECT app.clinical_scope_all() AS s',
      );
      expect(rows[0]!.s).toBe(true);
    });
    await comCenario(T.userCarla, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ s: boolean }>(
        'SELECT app.clinical_scope_all() AS s',
      );
      expect(rows[0]!.s).toBe(false);
    });
  });

  it('app.current_professional_id() deriva do vinculo, nunca do cliente', async () => {
    await comCenario(T.userAna, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ p: string | null }>(
        'SELECT app.current_professional_id() AS p',
      );
      expect(rows[0]!.p).toBe(T.profAna);
    });
    await comCenario(T.userCarla, T.clinicaSp, async (c) => {
      const { rows } = await c.query<{ p: string | null }>(
        'SELECT app.current_professional_id() AS p',
      );
      expect(rows[0]!.p).toBeNull(); // recepcao nao e profissional
    });
  });

  it('recusa papel que nao esta no catalogo do banco', async () => {
    const erro = await erroPg(async () => {
      await admin.query('BEGIN');
      try {
        await montarCenario(admin);
        await admin.query(
          `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
           VALUES ($1, $2, $3, $4, 'superusuario')`,
          [T.tenant, '01930000-0000-7000-8000-00000000f2aa', T.userCarla, T.clinicaManaus],
        );
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(erro.code).toBe('23514');
  });

  it('vinculo nao aponta para clinica de outro tenant: e erro de integridade, nao leitura vazia', async () => {
    const erro = await erroPg(async () => {
      await admin.query('BEGIN');
      try {
        await montarCenario(admin);
        await admin.query(
          `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
           VALUES ($1, $2, $3, $4, 'profissional')`,
          [T.tenant, '01930000-0000-7000-8000-00000000f2ab', T.userAna, T.clinicaAlheia],
        );
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(erro.code).toBe('23503');
  });

  it('o mesmo papel na mesma clinica nao pode ser concedido duas vezes enquanto vigente', async () => {
    const erro = await erroPg(async () => {
      await admin.query('BEGIN');
      try {
        await montarCenario(admin);
        await admin.query(
          `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
           VALUES ($1, $2, $3, $4, 'admin_clinico')`,
          [T.tenant, '01930000-0000-7000-8000-00000000f2ac', T.userAna, T.clinicaSp],
        );
      } finally {
        await admin.query('ROLLBACK');
      }
    });
    expect(erro.code).toBe('23505');
  });

  it('id.user e global e declarada como referencia global, sem tenant_id', async () => {
    const { rows } = await admin.query<{ comentario: string | null; cols: number }>(
      `SELECT obj_description('id.user'::regclass, 'pg_class') AS comentario,
              (SELECT count(*)::int FROM pg_attribute a
                WHERE a.attrelid = 'id.user'::regclass
                  AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS cols`,
    );
    expect(rows[0]!.comentario).toBe('global-reference');
    expect(rows[0]!.cols).toBe(0);
  });
});
