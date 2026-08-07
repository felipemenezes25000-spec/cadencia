// packages/tiss/src/project-guia.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { isOk, isErr, uuidv7 } from '@cadencia/kernel';
import { projectGuiaConsulta } from './project-guia';
import {
  semearProjecaoIncompleta,
  semearProjecaoParticular,
  semearProjecaoTiss,
  type TissSemente,
  type TissSementeIncompleta,
  type TissSementeParticular,
} from './test-support';

let sp: TissSementeParticular;
let actorParticular: Actor;
let st: TissSemente;
let actorConvenio: Actor;
let si: TissSementeIncompleta;
let actorIncompleto: Actor;

beforeAll(async () => {
  sp = await semearProjecaoParticular();
  actorParticular = {
    kind: 'user', tenantId: sp.tenantId, userId: sp.userId,
    clinicId: sp.clinicId, requestId: uuidv7(),
  };
  st = await semearProjecaoTiss();
  actorConvenio = {
    kind: 'user', tenantId: st.tenantId, userId: st.userId,
    clinicId: st.clinicId, requestId: uuidv7(),
  };
  si = await semearProjecaoIncompleta();
  actorIncompleto = {
    kind: 'user', tenantId: si.tenantId, userId: si.userId,
    clinicId: si.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

// --- Helper: finalizar atendimento ---
async function finalizarEncounter(
  actor: Actor, encounterId: string, fieldQueixaId: string, texto: string, hashByte: string,
): Promise<{ versionId: string; versionNo: number }> {
  return withTenantTx(actor, async (tx) => {
    const { rows } = await tx.query<{ version_id: string; version_no: number }>(
      `SELECT * FROM clin.finalize_encounter(
          p_encounter_id => $1,
          p_kind => 'original',
          p_payload => $2::jsonb,
          p_content_hash => decode($3, 'hex'),
          p_serializer_version => 'jcs-1',
          p_supersedes_version_id => NULL,
          p_justificativa => NULL,
          p_incompleto => false)`,
      [
        encounterId,
        JSON.stringify({
          fields: [{
            field_id: fieldQueixaId, code: 'queixa', label: 'Queixa principal',
            field_generation: 1, section_instance: 1, ordinal: 0,
            value_text: texto,
          }],
          diagnoses: [], observations: [], findings: [], procedures: [], ai: [],
        }),
        hashByte.repeat(32),
      ],
    );
    const row = rows[0]!;
    return { versionId: row.version_id, versionNo: row.version_no };
  });
}

describe('projectGuiaConsulta — atendimento particular', () => {
  it('retorna ok com kind skipped quando encounter_billing nao tem registro_ans', async () => {
    const { versionId } = await finalizarEncounter(
      actorParticular, sp.encounterId, sp.fieldQueixaId, 'dor de cabeca ha 2 dias', 'aa',
    );
    const result = await withTenantTx(actorParticular, async (tx) => {
      return projectGuiaConsulta(tx, sp.encounterId, versionId);
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.kind).toBe('skipped');
    }
  });
});

describe('projectGuiaConsulta — atendimento com convenio', () => {
  let versionId: string;

  beforeAll(async () => {
    const r = await finalizarEncounter(
      actorConvenio, st.encounterId, st.fieldQueixaId, 'dor lombar ha 5 dias', 'bb',
    );
    versionId = r.versionId;
  });

  it('insere guia completa em tiss.encounter_guia_consulta', async () => {
    const result = await withTenantTx(actorConvenio, async (tx) => {
      return projectGuiaConsulta(tx, st.encounterId, versionId);
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.kind).toBe('projected');
    if (result.value.kind !== 'projected') return;
    expect(result.value.status).toBe('completa');
    expect(result.value.guiaId).toBeTruthy();
    expect(result.value.numeroGuia).toBeTruthy();
  });

  it('a guia persistida tem os dados corretos do encounter_billing', async () => {
    const guia = await withTenantTx(actorConvenio, async (tx) => {
      const { rows } = await tx.query<{
        registro_ans: string; numero_carteira: string; cnes: string;
        conselho_profissional: string; numero_conselho: string; uf_conselho: string;
        cbos: string; codigo_tabela: string; codigo_procedimento: string;
        tipo_consulta: string; status: string; live: boolean;
        codigo_prestador_na_operadora: string | null;
      }>(
        `SELECT registro_ans, numero_carteira, cnes, conselho_profissional,
                numero_conselho, uf_conselho, cbos, codigo_tabela,
                codigo_procedimento, tipo_consulta, status, live,
                codigo_prestador_na_operadora
           FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [st.encounterId],
      );
      return rows[0];
    });

    expect(guia).toBeDefined();
    expect(guia!.registro_ans).toBe('326305');
    expect(guia!.numero_carteira).toBe('1234567890123456');
    expect(guia!.cnes).toBe('2233445');
    expect(guia!.conselho_profissional).toBe('06');
    expect(guia!.numero_conselho).toBe('654321');
    expect(guia!.uf_conselho).toBe('RJ');
    expect(guia!.cbos).toBe('225125');
    expect(guia!.codigo_tabela).toBe('22');
    expect(guia!.codigo_procedimento).toBe('10101012');
    expect(guia!.tipo_consulta).toBe('1');
    expect(guia!.status).toBe('completa');
    expect(guia!.live).toBe(true);
    expect(guia!.codigo_prestador_na_operadora).toBe('PREST001');
  });

  it('o numero_guia_prestador e unico por tenant e auto-incrementado', async () => {
    const guia = await withTenantTx(actorConvenio, async (tx) => {
      const { rows } = await tx.query<{ numero_guia_prestador: string }>(
        `SELECT numero_guia_prestador FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [st.encounterId],
      );
      return rows[0];
    });
    expect(guia).toBeDefined();
    const num = parseInt(guia!.numero_guia_prestador, 10);
    expect(num).toBeGreaterThan(0);
  });

  it('a finalizacao emitiu ENCOUNTER_FINALIZED no outbox', async () => {
    const evento = await withTenantTx(actorConvenio, async (tx) => {
      const { rows } = await tx.query<{ event_type: string; payload: Record<string, unknown> }>(
        `SELECT event_type, payload FROM app.outbox
          WHERE aggregate_id = $1 AND event_type = 'ENCOUNTER_FINALIZED'
          ORDER BY created_at DESC LIMIT 1`,
        [st.encounterId],
      );
      return rows[0];
    });
    expect(evento).toBeDefined();
    expect(evento!.event_type).toBe('ENCOUNTER_FINALIZED');
    expect(evento!.payload).toHaveProperty('encounterId', st.encounterId);
    expect(evento!.payload).toHaveProperty('patientId', st.patientId);
  });
});

describe('projectGuiaConsulta — dados incompletos', () => {
  let versionId: string;

  beforeAll(async () => {
    const r = await finalizarEncounter(
      actorIncompleto, si.encounterId, si.fieldQueixaId, 'tosse persistente', 'cc',
    );
    versionId = r.versionId;
  });

  it('retorna err com lista de campos ausentes quando operadora nao cadastrada', async () => {
    const result = await withTenantTx(actorIncompleto, async (tx) => {
      return projectGuiaConsulta(tx, si.encounterId, versionId);
    });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.kind).toBe('dados_obrigatorios_ausentes');
    if (result.error.kind !== 'dados_obrigatorios_ausentes') return;
    expect(result.error.missingFields).toContain('operadora_nao_cadastrada');
  });

  it('a finalizacao NAO falha mesmo com projecao incompleta — o atendimento esta selado', async () => {
    const enc = await withTenantTx(actorIncompleto, async (tx) => {
      const { rows } = await tx.query<{ status: string; version_count: number }>(
        `SELECT status::text AS status, version_count FROM clin.encounter WHERE id = $1`,
        [si.encounterId],
      );
      return rows[0];
    });
    expect(enc).toBeDefined();
    expect(enc!.status).toBe('finalizado');
    expect(enc!.version_count).toBe(1);
  });
});
