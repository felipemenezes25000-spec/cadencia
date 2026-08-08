// packages/tiss/src/reproject-guia.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { semearRetificacaoTiss, type TissSementeRetificacao } from './test-support';
import { reprojectGuiaOnAmend } from './reproject-guia';
import { projectGuiaConsulta } from './project-guia';

let s: TissSementeRetificacao;
let actor: Actor;

beforeAll(async () => {
  s = await semearRetificacaoTiss();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('outbox ENCOUNTER_AMENDED na retificacao', () => {
  it('finalize_encounter com kind=retificacao enfileira ENCOUNTER_AMENDED no outbox', async () => {
    // Retificar o atendimento (version_no 2, superando a versao 1)
    const retificacao = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao do procedimento cobrado na guia de consulta',
            p_incompleto => false)`,
        [s.encounterId, 'aa'.repeat(32), s.versionId],
      );
      return rows[0];
    });
    expect(retificacao?.version_no).toBe(2);

    // Verificar que o outbox tem um evento ENCOUNTER_AMENDED
    const outbox = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        event_type: string; aggregate_id: string;
        payload: { kind: string; versionNo: number; encounterId: string };
      }>(
        `SELECT event_type, aggregate_id, payload
           FROM app.outbox
          WHERE event_type = 'ENCOUNTER_AMENDED'
            AND aggregate_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(outbox).toBeDefined();
    expect(outbox?.event_type).toBe('ENCOUNTER_AMENDED');
    expect(outbox?.payload.kind).toBe('retificacao');
    expect(outbox?.payload.versionNo).toBe(2);
    expect(outbox?.payload.encounterId).toBe(s.encounterId);
  });

  it('finalize_encounter com kind=original NAO enfileira ENCOUNTER_AMENDED', async () => {
    // O atendimento original ja foi finalizado no seed; nao da para
    // finalizar outro como 'original'. Em vez disso, verificamos que
    // so existe o evento da retificacao do teste anterior (o seed nao
    // cria outbox ENCOUNTER_AMENDED para finalizacao original).
    const depois = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ cnt: string }>(
        `SELECT count(*) AS cnt FROM app.outbox
          WHERE event_type = 'ENCOUNTER_AMENDED'
            AND aggregate_id = $1`,
        [s.encounterId],
      );
      return Number(rows[0]?.cnt ?? 0);
    });
    // So deve haver o evento da retificacao do teste anterior, nenhum do original
    expect(depois).toBe(1);
  });
});

describe('reprojectGuiaOnAmend — sem lote', () => {
  it('retificacao sem lote reprojeta: guia antiga live=false, nova guia criada', async () => {
    // 1) Projetar a guia original (usando o projectGuiaConsulta do bloco 04)
    const projecao = await withTenantTx(actor, async (tx) => {
      return projectGuiaConsulta(tx, s.encounterId, s.versionId);
    });
    expect(projecao.ok).toBe(true);

    // 2) Buscar a guia original
    const guiaOriginal = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ id: string; live: boolean }>(
        `SELECT id, live FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(guiaOriginal).toBeDefined();
    expect(guiaOriginal?.live).toBe(true);

    // 3) Fazer a retificacao (ja feita no teste anterior — version_no=2 ja existe).
    // Buscar o version_id da retificacao
    const retificacaoVersion = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM clin.encounter_version
          WHERE encounter_id = $1 AND version_no = 2`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(retificacaoVersion).toBeDefined();

    // 4) Chamar o handler de reprojecao
    const resultado = await withTenantTx(actor, async (tx) => {
      return reprojectGuiaOnAmend(tx, s.encounterId, retificacaoVersion!.id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('reprojected');
    }

    // 5) Verificar que a guia antiga ficou live=false
    const guiaAntigaDepois = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{ live: boolean }>(
        `SELECT live FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guiaOriginal!.id],
      );
      return rows[0];
    });
    expect(guiaAntigaDepois?.live).toBe(false);

    // 6) Verificar que existe uma nova guia live=true vinculada a versao da retificacao
    const guiaNova = await withTenantTx(actor, async (tx) => {
      const { rows } = await tx.query<{
        id: string; live: boolean; encounter_version_id: string;
      }>(
        `SELECT id, live, encounter_version_id
           FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s.encounterId],
      );
      return rows[0];
    });
    expect(guiaNova).toBeDefined();
    expect(guiaNova?.live).toBe(true);
    expect(guiaNova?.encounter_version_id).toBe(retificacaoVersion!.id);
    expect(guiaNova?.id).not.toBe(guiaOriginal!.id);
  });

  it('retificacao sem guia existente retorna no_guia', async () => {
    // Criar um atendimento sem guia projetada e retificar
    const s2 = await semearRetificacaoTiss();
    const actor2: Actor = {
      kind: 'user', tenantId: s2.tenantId, userId: s2.userId,
      clinicId: s2.clinicId, requestId: uuidv7(),
    };

    // Retificar (criar versao 2)
    const retificacao = await withTenantTx(actor2, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao de diagnostico sem guia associada',
            p_incompleto => false)`,
        [s2.encounterId, 'bb'.repeat(32), s2.versionId],
      );
      return rows[0];
    });

    // Chamar o handler — nao deve haver guia para reprojetar
    const resultado = await withTenantTx(actor2, async (tx) => {
      return reprojectGuiaOnAmend(tx, s2.encounterId, retificacao!.version_id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('no_guia');
    }
  });
});
