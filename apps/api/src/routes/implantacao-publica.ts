import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rota } from '../guard';

const MigrationStatusSchema = z.enum([
  'planejada','extraindo','validando','importando','reconciliando','concluida','falhou','cancelada',
]);
const SourceKindSchema = z.enum(['database','api','csv','xml','json','fhir','other']);
const EvidenceTypeSchema = z.enum([
  'backup_restore','disaster_recovery','security_test','migration_reconciliation',
  'training','go_live','interoperability_homologation','availability_report','other',
]);
const EvidenceStatusSchema = z.enum(['ok','warning','failed']);
const IntegrationStageSchema = z.enum(['not_configured','sandbox','homologated','production']);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

interface MigrationRow {
  id: string;
  source_system: string;
  source_version: string | null;
  source_kind: z.infer<typeof SourceKindSchema>;
  status: z.infer<typeof MigrationStatusSchema>;
  source_snapshot_sha256: string | null;
  recebidos: string;
  validos: string;
  importados: string;
  conciliados: string;
  rejeitados: string;
  report: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

function migrationDto(row: MigrationRow) {
  return {
    id: row.id,
    sourceSystem: row.source_system,
    sourceVersion: row.source_version,
    sourceKind: row.source_kind,
    status: row.status,
    sourceSnapshotSha256: row.source_snapshot_sha256,
    recebidos: Number(row.recebidos),
    validos: Number(row.validos),
    importados: Number(row.importados),
    conciliados: Number(row.conciliados),
    rejeitados: Number(row.rejeitados),
    report: row.report,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function integrationStage(name: 'CADENCIA_RNDS_STATUS' | 'CADENCIA_ESUS_APS_STATUS'):
  z.infer<typeof IntegrationStageSchema> {
  const parsed = IntegrationStageSchema.safeParse(process.env[name]);
  return parsed.success ? parsed.data : 'not_configured';
}

export async function implantacaoPublicaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/v1/implantacao/readiness', rota('clinic.read', async (tx, ctx) => {
    const contexto = await tx.query<{
      municipio_ibge: string | null; uf: string | null; cnes: string | null; unidade: string;
    }>(`SELECT t.municipio_ibge,t.uf,c.cnes,c.nome unidade
          FROM app.tenant t JOIN app.clinic c ON c.tenant_id=t.id
         WHERE t.id=app.current_tenant_id() AND c.id=$1`, [ctx.actor.clinicId]);
    const unidade = contexto.rows[0];
    if (!unidade) throw Object.assign(new Error('unidade_nao_encontrada'), { statusCode: 404, dominio: 'unidade_nao_encontrada' });

    const profissionais = await tx.query<{ total: number; completos: number }>(
      `SELECT COUNT(DISTINCT p.id)::int total,
              COUNT(DISTINCT p.id) FILTER (WHERE s.cns IS NOT NULL AND s.cbo IS NOT NULL)::int completos
         FROM app.professional p
         JOIN app.membership m ON m.tenant_id=p.tenant_id AND m.user_id=p.user_id
                              AND m.clinic_id=$1 AND m.revoked_at IS NULL
         LEFT JOIN LATERAL (
           SELECT cns,cbo FROM app.professional_sus_link x
            WHERE x.tenant_id=p.tenant_id AND x.clinic_id=$1
              AND x.professional_id=p.id AND x.ativo
            ORDER BY x.valid_from DESC LIMIT 1
         ) s ON true
        WHERE p.inactivated_at IS NULL`, [ctx.actor.clinicId]);

    const equipes = await tx.query<{ total: number; com_ine: number }>(
      `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE ine IS NOT NULL)::int com_ine
         FROM app.sus_team WHERE clinic_id=$1 AND ativo`, [ctx.actor.clinicId]);
    const cidadaos = await tx.query<{ total: number; com_cns: number }>(
      `SELECT COUNT(*)::int total,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM clin.patient_identifier i
                 WHERE i.patient_id=s.patient_id AND i.kind='CNS'
              ))::int com_cns
         FROM clin.patient_sus_profile s WHERE s.clinic_id=$1`, [ctx.actor.clinicId]);
    const ciap = await tx.query<{ n: number }>('SELECT COUNT(*)::int n FROM ref.ciap2_term');
    const sigtap = await tx.query<{ n: number }>('SELECT COUNT(*)::int n FROM ref.sigtap_procedure');
    const migracao = await tx.query<{ status: z.infer<typeof MigrationStatusSchema>; updated_at: string }>(
      `SELECT status,updated_at FROM app.public_migration_job
        WHERE clinic_id=$1 ORDER BY created_at DESC LIMIT 1`, [ctx.actor.clinicId]);
    const restore = await tx.query<{ happened_at: string | null }>(
      `SELECT MAX(happened_at)::text happened_at FROM app.public_operation_evidence
        WHERE clinic_id=$1 AND evidence_type='backup_restore' AND status='ok'`, [ctx.actor.clinicId]);

    const totalProf = profissionais.rows[0]?.total ?? 0;
    const completosProf = profissionais.rows[0]?.completos ?? 0;
    const totalEquipes = equipes.rows[0]?.total ?? 0;
    const equipesComIne = equipes.rows[0]?.com_ine ?? 0;
    const totalCidadaos = cidadaos.rows[0]?.total ?? 0;
    const cidadaosComCns = cidadaos.rows[0]?.com_cns ?? 0;
    const ultimaMigracao = migracao.rows[0] ?? null;
    const rnds = integrationStage('CADENCIA_RNDS_STATUS');
    const esus = integrationStage('CADENCIA_ESUS_APS_STATUS');

    const checks = [
      {
        id: 'identificacao_municipio', rotulo: 'Município IBGE e UF',
        status: unidade.municipio_ibge && unidade.uf ? 'ok' : 'blocked',
        detalhe: unidade.municipio_ibge && unidade.uf ? `${unidade.municipio_ibge}/${unidade.uf}` : 'Identificação municipal incompleta.',
      },
      {
        id: 'cnes', rotulo: 'CNES da unidade', status: unidade.cnes ? 'ok' : 'blocked',
        detalhe: unidade.cnes ?? 'CNES não informado.',
      },
      {
        id: 'profissionais', rotulo: 'Profissionais CNS/CBO',
        status: totalProf > 0 && completosProf === totalProf ? 'ok' : 'blocked',
        detalhe: `${completosProf}/${totalProf} profissionais ativos com vínculo SUS completo.`,
      },
      {
        id: 'equipes', rotulo: 'Equipes INE',
        status: totalEquipes === 0 || equipesComIne < totalEquipes ? 'warning' : 'ok',
        detalhe: `${equipesComIne}/${totalEquipes} equipes ativas com INE.`,
      },
      {
        id: 'cidadaos', rotulo: 'Cidadãos com CNS',
        status: totalCidadaos === 0 || cidadaosComCns < totalCidadaos ? 'warning' : 'ok',
        detalhe: `${cidadaosComCns}/${totalCidadaos} cidadãos territorializados com CNS.`,
      },
      {
        id: 'terminologias', rotulo: 'CIAP-2 e SIGTAP oficiais',
        status: (ciap.rows[0]?.n ?? 0) > 0 && (sigtap.rows[0]?.n ?? 0) > 0 ? 'ok' : 'warning',
        detalhe: `CIAP-2: ${ciap.rows[0]?.n ?? 0}; SIGTAP: ${sigtap.rows[0]?.n ?? 0}.`,
      },
      {
        id: 'migracao', rotulo: 'Migração e reconciliação',
        status: ultimaMigracao?.status === 'concluida' ? 'ok' : ultimaMigracao?.status === 'falhou' ? 'blocked' : 'warning',
        detalhe: ultimaMigracao ? `Última execução: ${ultimaMigracao.status}.` : 'Nenhuma migração registrada para a unidade.',
      },
      {
        id: 'restore', rotulo: 'Teste de restauração',
        status: restore.rows[0]?.happened_at ? 'ok' : 'warning',
        detalhe: restore.rows[0]?.happened_at ? `Última evidência: ${restore.rows[0].happened_at}.` : 'Sem evidência operacional de restore registrada.',
      },
      {
        id: 'rnds', rotulo: 'RNDS',
        status: rnds === 'production' || rnds === 'homologated' ? 'ok' : 'blocked',
        detalhe: `Estado declarado: ${rnds}. Homologação externa continua obrigatória.`,
      },
      {
        id: 'esus_aps', rotulo: 'e-SUS APS/SIAPS',
        status: esus === 'production' || esus === 'homologated' ? 'ok' : 'warning',
        detalhe: `Estado declarado: ${esus}. O layout vigente deve ser validado no go-live.`,
      },
    ] as const;

    return {
      unidade: { nome: unidade.unidade, municipioIbge: unidade.municipio_ibge, uf: unidade.uf, cnes: unidade.cnes },
      prontoParaGoLive: checks.every((c) => c.status !== 'blocked'),
      checks,
      observacao: 'O painel registra prontidão técnica. Credenciamento/homologação RNDS, aceite do município e evidências contratuais são externos ao código.',
    };
  }));

  r.get('/v1/implantacao/migracoes', rota('clinic.read', async (tx, ctx) => {
    const { rows } = await tx.query<MigrationRow>(
      `SELECT id,source_system,source_version,source_kind,status,source_snapshot_sha256,
              recebidos::text,validos::text,importados::text,conciliados::text,rejeitados::text,
              report,created_at::text,started_at::text,completed_at::text,updated_at::text
         FROM app.public_migration_job WHERE clinic_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [ctx.actor.clinicId]);
    return { itens: rows.map(migrationDto) };
  }));

  r.post('/v1/implantacao/migracoes', {
    schema: { body: z.object({
      sourceSystem: z.string().min(2).max(160), sourceVersion: z.string().max(120).optional(),
      sourceKind: SourceKindSchema, sourceSnapshotSha256: Sha256Schema.optional(),
    }) },
  }, rota('tenant.write', async (tx, ctx, req, reply) => {
    const body = req.body as { sourceSystem: string; sourceVersion?: string; sourceKind: z.infer<typeof SourceKindSchema>; sourceSnapshotSha256?: string };
    const { rows } = await tx.query<MigrationRow>(
      `INSERT INTO app.public_migration_job(
         clinic_id,source_system,source_version,source_kind,source_snapshot_sha256,created_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,source_system,source_version,source_kind,status,source_snapshot_sha256,
                 recebidos::text,validos::text,importados::text,conciliados::text,rejeitados::text,
                 report,created_at::text,started_at::text,completed_at::text,updated_at::text`,
      [ctx.actor.clinicId, body.sourceSystem, body.sourceVersion ?? null, body.sourceKind,
        body.sourceSnapshotSha256 ?? null, ctx.actor.userId]);
    void reply.code(201);
    return migrationDto(rows[0]!);
  }));

  r.patch('/v1/implantacao/migracoes/:id', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        status: MigrationStatusSchema,
        recebidos: z.number().int().nonnegative().optional(), validos: z.number().int().nonnegative().optional(),
        importados: z.number().int().nonnegative().optional(), conciliados: z.number().int().nonnegative().optional(),
        rejeitados: z.number().int().nonnegative().optional(), report: z.record(z.string(), z.unknown()).optional(),
      }),
    },
  }, rota('tenant.write', async (tx, ctx, req) => {
    const params = req.params as { id: string };
    const body = req.body as {
      status: z.infer<typeof MigrationStatusSchema>; recebidos?: number; validos?: number;
      importados?: number; conciliados?: number; rejeitados?: number; report?: Record<string, unknown>;
    };
    const { rows } = await tx.query<MigrationRow>(
      `UPDATE app.public_migration_job SET
         status=$3::app.public_migration_status,
         recebidos=COALESCE($4,recebidos), validos=COALESCE($5,validos),
         importados=COALESCE($6,importados), conciliados=COALESCE($7,conciliados),
         rejeitados=COALESCE($8,rejeitados), report=COALESCE($9::jsonb,report),
         started_at=CASE WHEN $3 IN ('extraindo','validando','importando','reconciliando') AND started_at IS NULL
                         THEN clock_timestamp() ELSE started_at END,
         completed_at=CASE WHEN $3 IN ('concluida','falhou','cancelada') THEN clock_timestamp() ELSE completed_at END,
         updated_at=clock_timestamp()
       WHERE tenant_id=app.current_tenant_id() AND clinic_id=$1 AND id=$2
       RETURNING id,source_system,source_version,source_kind,status,source_snapshot_sha256,
                 recebidos::text,validos::text,importados::text,conciliados::text,rejeitados::text,
                 report,created_at::text,started_at::text,completed_at::text,updated_at::text`,
      [ctx.actor.clinicId, params.id, body.status, body.recebidos ?? null, body.validos ?? null,
        body.importados ?? null, body.conciliados ?? null, body.rejeitados ?? null,
        body.report === undefined ? null : JSON.stringify(body.report)]);
    if (!rows[0]) throw Object.assign(new Error('migracao_nao_encontrada'), { statusCode: 404, dominio: 'migracao_nao_encontrada' });
    return migrationDto(rows[0]);
  }));

  r.get('/v1/implantacao/evidencias', rota('clinic.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      id: string; evidence_type: z.infer<typeof EvidenceTypeSchema>; status: z.infer<typeof EvidenceStatusSchema>;
      happened_at: string; summary: string; artifact_uri: string | null; artifact_sha256: string | null;
      metadata: Record<string, unknown>;
    }>(`SELECT id,evidence_type,status,happened_at::text,summary,artifact_uri,artifact_sha256,metadata
          FROM app.public_operation_evidence WHERE clinic_id=$1 ORDER BY happened_at DESC LIMIT 100`,
      [ctx.actor.clinicId]);
    return { itens: rows.map((x) => ({
      id: x.id, evidenceType: x.evidence_type, status: x.status, happenedAt: x.happened_at,
      summary: x.summary, artifactUri: x.artifact_uri, artifactSha256: x.artifact_sha256, metadata: x.metadata,
    })) };
  }));

  r.post('/v1/implantacao/evidencias', {
    schema: { body: z.object({
      evidenceType: EvidenceTypeSchema, status: EvidenceStatusSchema, happenedAt: z.string().datetime({ offset: true }),
      summary: z.string().min(3).max(1000), artifactUri: z.string().max(1000).optional(),
      artifactSha256: Sha256Schema.optional(), metadata: z.record(z.string(), z.unknown()).optional(),
    }) },
  }, rota('tenant.write', async (tx, ctx, req, reply) => {
    const body = req.body as {
      evidenceType: z.infer<typeof EvidenceTypeSchema>; status: z.infer<typeof EvidenceStatusSchema>; happenedAt: string;
      summary: string; artifactUri?: string; artifactSha256?: string; metadata?: Record<string, unknown>;
    };
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO app.public_operation_evidence(
         clinic_id,evidence_type,status,happened_at,summary,artifact_uri,artifact_sha256,metadata,created_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING id`,
      [ctx.actor.clinicId, body.evidenceType, body.status, body.happenedAt, body.summary,
        body.artifactUri ?? null, body.artifactSha256 ?? null, JSON.stringify(body.metadata ?? {}), ctx.actor.userId]);
    void reply.code(201);
    return { id: rows[0]!.id };
  }));

  r.get('/v1/implantacao/interoperabilidade', rota('clinic.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      target: string; status: string; total: number;
    }>(`SELECT target::text,status::text,COUNT(*)::int total
          FROM app.public_interop_delivery WHERE clinic_id=$1
         GROUP BY target,status ORDER BY target,status`, [ctx.actor.clinicId]);
    return {
      rndsStage: integrationStage('CADENCIA_RNDS_STATUS'),
      esusApsStage: integrationStage('CADENCIA_ESUS_APS_STATUS'),
      entregas: rows,
    };
  }));

  r.get('/v1/implantacao/operacao', rota('clinic.read', async (tx, ctx) => {
    const { rows } = await tx.query<{
      sla_mensal_percentual: string; rpo_minutos: number; rto_minutos: number;
      retencao_prontuario_anos: number; residencia_dados_pais: string; intervalo_teste_restore_dias: number;
    }>(`SELECT sla_mensal_percentual::text,rpo_minutos,rto_minutos,retencao_prontuario_anos,
               residencia_dados_pais,intervalo_teste_restore_dias
          FROM app.public_operation_profile WHERE clinic_id=$1`, [ctx.actor.clinicId]);
    const x = rows[0];
    return x ? {
      slaMensalPercentual: Number(x.sla_mensal_percentual), rpoMinutos: x.rpo_minutos, rtoMinutos: x.rto_minutos,
      retencaoProntuarioAnos: x.retencao_prontuario_anos, residenciaDadosPais: x.residencia_dados_pais,
      intervaloTesteRestoreDias: x.intervalo_teste_restore_dias,
    } : {
      slaMensalPercentual: 99.9, rpoMinutos: 15, rtoMinutos: 240,
      retencaoProntuarioAnos: 20, residenciaDadosPais: 'BR', intervaloTesteRestoreDias: 90,
    };
  }));

  r.put('/v1/implantacao/operacao', {
    schema: { body: z.object({
      slaMensalPercentual: z.number().min(90).max(100), rpoMinutos: z.number().int().min(0).max(1440),
      rtoMinutos: z.number().int().min(1).max(10080), retencaoProntuarioAnos: z.number().int().min(1).max(100),
      residenciaDadosPais: z.string().regex(/^[A-Z]{2}$/), intervaloTesteRestoreDias: z.number().int().min(1).max(365),
    }) },
  }, rota('tenant.write', async (tx, ctx, req) => {
    const body = req.body as {
      slaMensalPercentual: number; rpoMinutos: number; rtoMinutos: number; retencaoProntuarioAnos: number;
      residenciaDadosPais: string; intervaloTesteRestoreDias: number;
    };
    await tx.query(
      `INSERT INTO app.public_operation_profile(
         clinic_id,sla_mensal_percentual,rpo_minutos,rto_minutos,retencao_prontuario_anos,
         residencia_dados_pais,intervalo_teste_restore_dias)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(tenant_id,clinic_id) DO UPDATE SET
         sla_mensal_percentual=EXCLUDED.sla_mensal_percentual,rpo_minutos=EXCLUDED.rpo_minutos,
         rto_minutos=EXCLUDED.rto_minutos,retencao_prontuario_anos=EXCLUDED.retencao_prontuario_anos,
         residencia_dados_pais=EXCLUDED.residencia_dados_pais,
         intervalo_teste_restore_dias=EXCLUDED.intervalo_teste_restore_dias,updated_at=clock_timestamp()`,
      [ctx.actor.clinicId, body.slaMensalPercentual, body.rpoMinutos, body.rtoMinutos,
        body.retencaoProntuarioAnos, body.residenciaDadosPais, body.intervaloTesteRestoreDias]);
    return { atualizado: true as const };
  }));
}
