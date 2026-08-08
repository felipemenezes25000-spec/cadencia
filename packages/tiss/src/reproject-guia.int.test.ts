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

const semearTiss = semearRetificacaoTiss;

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

describe('reprojectGuiaOnAmend — com lote enviado', () => {
  it('retificacao com guia em lote enviado cria pendencia em vez de reprojetar', async () => {
    // Novo tenant para teste isolado
    const s3 = await semearTiss();
    const actor3: Actor = {
      kind: 'user', tenantId: s3.tenantId, userId: s3.userId,
      clinicId: s3.clinicId, requestId: uuidv7(),
    };

    // 1) Projetar a guia original
    const projecao = await withTenantTx(actor3, async (tx) => {
      return projectGuiaConsulta(tx, s3.encounterId, s3.versionId);
    });
    expect(projecao.ok).toBe(true);

    // 2) Buscar a guia projetada
    const guia = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s3.encounterId],
      );
      return rows[0];
    });
    expect(guia).toBeDefined();

    // 3) Criar lote com status 'enviado' e associar a guia.
    // Usa admin porque precisa de acesso irrestrito para montar cenario.
    const adminPool = (await import('pg')).default;
    const adminConn = new adminPool.Pool({
      connectionString: process.env['DATABASE_URL_ADMIN'], max: 1,
    });
    const adminClient = await adminConn.connect();
    try {
      const loteId = uuidv7();
      await adminClient.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, created_by)
         VALUES ($1, $2, $3, '000001', 'enviado', '4.01', 1, 25000, $4)`,
        [s3.tenantId, loteId, s3.operadoraId, s3.userId],
      );
      await adminClient.query(
        `INSERT INTO tiss.lote_guia
           (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, 1)`,
        [s3.tenantId, loteId, guia!.id],
      );
    } finally {
      adminClient.release();
      await adminConn.end();
    }

    // 4) Retificar o atendimento
    const retificacao = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao de valor com guia ja enviada em lote',
            p_incompleto => false)`,
        [s3.encounterId, 'cc'.repeat(32), s3.versionId],
      );
      return rows[0];
    });
    expect(retificacao?.version_no).toBe(2);

    // 5) Chamar o handler de reprojecao
    const resultado = await withTenantTx(actor3, async (tx) => {
      return reprojectGuiaOnAmend(tx, s3.encounterId, retificacao!.version_id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('pendencia_created');
      if (resultado.value.action === 'pendencia_created') {
        expect(resultado.value.guiaId).toBe(guia!.id);
        expect(resultado.value.pendenciaId).toBeDefined();
      }
    }

    // 6) Verificar que a guia original continua live=true (NAO foi marcada false)
    const guiaDepois = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{ live: boolean }>(
        `SELECT live FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guia!.id],
      );
      return rows[0];
    });
    expect(guiaDepois?.live).toBe(true);

    // 7) Verificar que a pendencia foi criada corretamente
    const pendencia = await withTenantTx(actor3, async (tx) => {
      const { rows } = await tx.query<{
        guia_id: string; encounter_version_id: string;
        tipo: string; resolved_at: string | null;
      }>(
        `SELECT guia_id, encounter_version_id, tipo, resolved_at
           FROM tiss.guia_pendencia
          WHERE guia_id = $1
            AND resolved_at IS NULL`,
        [guia!.id],
      );
      return rows[0];
    });
    expect(pendencia).toBeDefined();
    expect(pendencia?.guia_id).toBe(guia!.id);
    expect(pendencia?.encounter_version_id).toBe(retificacao!.version_id);
    expect(pendencia?.tipo).toBe('reprojecao_pos_envio');
    expect(pendencia?.resolved_at).toBeNull();
  });

  it('retificacao com guia em lote rascunho (nao enviado) reprojeta normalmente', async () => {
    // Novo tenant
    const s4 = await semearTiss();
    const actor4: Actor = {
      kind: 'user', tenantId: s4.tenantId, userId: s4.userId,
      clinicId: s4.clinicId, requestId: uuidv7(),
    };

    // 1) Projetar guia
    const projecao = await withTenantTx(actor4, async (tx) => {
      return projectGuiaConsulta(tx, s4.encounterId, s4.versionId);
    });
    expect(projecao.ok).toBe(true);

    // 2) Buscar guia
    const guia = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s4.encounterId],
      );
      return rows[0];
    });
    expect(guia).toBeDefined();

    // 3) Criar lote RASCUNHO (nao enviado) e associar a guia
    const adminPool = (await import('pg')).default;
    const adminConn = new adminPool.Pool({
      connectionString: process.env['DATABASE_URL_ADMIN'], max: 1,
    });
    const adminClient = await adminConn.connect();
    try {
      const loteId = uuidv7();
      await adminClient.query(
        `INSERT INTO tiss.lote
           (tenant_id, id, operadora_id, numero_lote, status, tiss_version,
            guia_count, total_value_cents, created_by)
         VALUES ($1, $2, $3, '000001', 'rascunho', '4.01', 1, 25000, $4)`,
        [s4.tenantId, loteId, s4.operadoraId, s4.userId],
      );
      await adminClient.query(
        `INSERT INTO tiss.lote_guia
           (tenant_id, lote_id, guia_id, sequencial_item)
         VALUES ($1, $2, $3, 1)`,
        [s4.tenantId, loteId, guia!.id],
      );
    } finally {
      adminClient.release();
      await adminConn.end();
    }

    // 4) Retificar
    const retificacao = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ version_id: string; version_no: number }>(
        `SELECT * FROM clin.finalize_encounter(
            p_encounter_id => $1,
            p_kind => 'retificacao',
            p_payload => '{"fields":[],"diagnoses":[],"observations":[],"findings":[],"procedures":[]}'::jsonb,
            p_content_hash => decode($2, 'hex'),
            p_serializer_version => 'jcs-1',
            p_supersedes_version_id => $3,
            p_justificativa => 'Correcao de valor com guia em lote rascunho — reprojeta',
            p_incompleto => false)`,
        [s4.encounterId, 'dd'.repeat(32), s4.versionId],
      );
      return rows[0];
    });
    expect(retificacao?.version_no).toBe(2);

    // 5) Handler deve REPROJETAR (lote rascunho = nao enviado)
    const resultado = await withTenantTx(actor4, async (tx) => {
      return reprojectGuiaOnAmend(tx, s4.encounterId, retificacao!.version_id);
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.value.action).toBe('reprojected');
    }

    // 6) Guia antiga marcada live=false
    const guiaAntigaDepois = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ live: boolean }>(
        `SELECT live FROM tiss.encounter_guia_consulta WHERE id = $1`,
        [guia!.id],
      );
      return rows[0];
    });
    expect(guiaAntigaDepois?.live).toBe(false);

    // 7) Nova guia viva vinculada a nova versao
    const guiaNova = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{
        id: string; encounter_version_id: string;
      }>(
        `SELECT id, encounter_version_id
           FROM tiss.encounter_guia_consulta
          WHERE encounter_id = $1 AND live = true`,
        [s4.encounterId],
      );
      return rows[0];
    });
    expect(guiaNova).toBeDefined();
    expect(guiaNova?.encounter_version_id).toBe(retificacao!.version_id);

    // 8) Nenhuma pendencia criada
    const pendencias = await withTenantTx(actor4, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM tiss.guia_pendencia
          WHERE guia_id = $1 AND resolved_at IS NULL`,
        [guia!.id],
      );
      return rows;
    });
    expect(pendencias).toHaveLength(0);
  });
});
