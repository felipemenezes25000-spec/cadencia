import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';
import {
  aplicarPreambulo,
  comoAtor,
  erroPg,
  openClient,
  semContexto,
  type IsoActor,
} from './harness';
import * as F from './fixtures';

/**
 * §5.4 — O TERCEIRO ESTADO.
 *
 * A RLS so sabe devolver conjunto vazio, e "nao existe" nao e a mesma coisa que
 * "existe e voce nao tem acesso". Sem distinguir, o plantonista busca o CPF,
 * recebe "nao encontrado", cria cadastro novo e prescreve sem ver a alergia que
 * estava no primeiro prontuario.
 *
 * Os cenarios que precisam de paciente OCULTO nascem DENTRO da transacao e morrem
 * no ROLLBACK do harness: o seed global e visto por todas as suites, e um paciente
 * a mais nele mudaria a contagem que a suite 05 afirma sobre o escopo clinico.
 */
const ANA_ADMIN: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_A,
  userId: F.USER_A_ANA,
  clinicId: F.CLINIC_A_SP,
  requestId: F.REQUEST_ID,
};

const DIEGO_NO_TENANT_B: IsoActor = {
  kind: 'user',
  tenantId: F.TENANT_B,
  userId: F.USER_B_DIEGO,
  clinicId: F.CLINIC_B_RIO_BRANCO,
  requestId: F.REQUEST_ID,
};

/** Ids e valores locais a esta suite: nada disto sobrevive ao ROLLBACK. */
const PACIENTE_OCULTO = '01930000-0000-7000-8000-00000000e301';
const PID_OCULTO = '01930000-0000-7000-8000-00000000e302';
/** CPF valido (digitos verificadores corretos) que NAO esta no seed de tenant nenhum. */
const CPF_OCULTO = '39053344705';
/** CPF valido que nao pertence a paciente nenhum, em tenant nenhum. */
const CPF_INEXISTENTE = '15350946056';

async function cadastraPacienteOculto(c: Client): Promise<void> {
  await c.query(
    `INSERT INTO clin.patient (tenant_id, id, full_name) VALUES ($1, $2, $3)`,
    [F.TENANT_A, PACIENTE_OCULTO, 'Helena Vasques de Andrade'],
  );
  await c.query(
    `INSERT INTO clin.patient_identifier (tenant_id, id, patient_id, kind, value)
     VALUES ($1, $2, $3, 'CPF', $4)`,
    [F.TENANT_A, PID_OCULTO, PACIENTE_OCULTO, CPF_OCULTO],
  );
}

async function existe(c: Client, kind: string, valor: string): Promise<boolean> {
  const { rows } = await c.query<{ existe: boolean }>(
    `SELECT clin.patient_exists_by_identifier($1, $2) AS existe`,
    [kind, valor],
  );
  return rows[0]!.existe;
}

describe('o terceiro estado — existe e voce nao tem acesso', () => {
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

  it('responde SIM para paciente do proprio tenant', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      expect(await existe(c, 'CPF', F.CPF_VALIDO)).toBe(true);
    });
  });

  it('devolve apenas booleano — nenhuma coluna de conteudo na assinatura', async () => {
    const { rows } = await admin.query<{ t: string }>(
      `SELECT pg_get_function_result(p.oid) AS t FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'clin' AND p.proname = 'patient_exists_by_identifier'`,
    );
    expect(rows[0]?.t).toBe('boolean');
  });

  it('responde SIM mesmo quando a RLS esconde a linha de quem pergunta', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      await cadastraPacienteOculto(c);

      // Bruno e profissional SEM compartilhamento para esta paciente: a policy
      // RESTRICTIVE de escopo clinico apaga a linha da vista dele.
      await c.query(`SELECT set_config('app.user_id', $1, TRUE)`, [F.USER_A_BRUNO]);

      const { rows: direto } = await c.query(
        `SELECT 1 FROM clin.patient_identifier WHERE value = $1`,
        [CPF_OCULTO],
      );
      expect(direto, 'a RLS precisa esconder a linha, senao o teste nao diz nada')
        .toEqual([]);

      // E este e o terceiro estado: a linha esta invisivel e mesmo assim a
      // resposta e SIM. Sem isto, Bruno cadastra a paciente de novo.
      expect(await existe(c, 'CPF', CPF_OCULTO)).toBe(true);
    });
  });

  it('responde NAO para identificador que so existe em OUTRO tenant', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      await cadastraPacienteOculto(c);
      expect(await existe(c, 'CPF', CPF_OCULTO)).toBe(true);

      // Mesma transacao, contexto do tenant B: a funcao e SECURITY DEFINER e
      // escapa da RLS, entao o filtro por tenant tem que ser dela mesma.
      await aplicarPreambulo(c, DIEGO_NO_TENANT_B);
      expect(await existe(c, 'CPF', CPF_OCULTO)).toBe(false);
    });
  });

  it('cada consulta gera evento de auditoria com o desfecho e sem o valor consultado', async () => {
    await comoAtor(api, ANA_ADMIN, async (c) => {
      expect(await existe(c, 'CPF', F.CPF_VALIDO)).toBe(true);
      expect(await existe(c, 'CPF', CPF_INEXISTENTE)).toBe(false);

      const { rows } = await c.query<{
        outcome: string;
        entity_table: string;
        entity_id: string | null;
        meta: Record<string, unknown>;
      }>(
        `SELECT outcome, entity_table, entity_id, meta FROM audit.event
          WHERE event_type = 'PATIENT_EXISTENCE_PROBE' ORDER BY id`,
      );

      expect(rows.map((r) => r.outcome)).toEqual(['sucesso', 'negado']);
      expect(rows.map((r) => r.entity_table)).toEqual([
        'patient_identifier',
        'patient_identifier',
      ]);
      // entity_id e REFERENCIA, nunca conteudo (NGS1.07.06): consultar existencia
      // por CPF nao tem entidade a referenciar, e inventar uma seria vazamento.
      expect(rows.map((r) => r.entity_id)).toEqual([null, null]);
      expect(rows.map((r) => r.meta)).toEqual([{ kind: 'CPF' }, { kind: 'CPF' }]);
      // A trilha diz QUE alguem perguntou, nunca POR QUEM perguntou.
      expect(JSON.stringify(rows)).not.toContain(F.CPF_VALIDO);
      expect(JSON.stringify(rows)).not.toContain(CPF_INEXISTENTE);
    });
  });

  it('recusa tipo de identificador fora do catalogo', async () => {
    const erro = await erroPg(() =>
      comoAtor(api, ANA_ADMIN, (c) => existe(c, 'TITULO_ELEITOR', '123456789012')),
    );
    expect(erro.code).toBe('22023');
  });

  it('sem contexto de tenant, recusa em vez de responder', async () => {
    const erro = await erroPg(() =>
      semContexto(api, (c) => existe(c, 'CPF', F.CPF_VALIDO)),
    );
    expect(erro.code).toBe('42501');
  });
});
