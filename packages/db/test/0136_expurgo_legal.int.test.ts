import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '../src/index';

/**
 * O expurgo legal é a única exceção ao append-only clínico. Estes testes existem
 * para provar que ela é ESTREITA: o que garante o produto não é a funcionalidade
 * de apagar, é a impossibilidade de apagar errado.
 */
let admin: Pool;
let tenantId = '';
let clinicId = '';
let userId = '';
let profId = '';
let patientId = '';
let sectionId = '';
let fieldId = '';

/** Um atendimento finalizado com N anos de idade, e o id do valor gravado. */
async function semearAtendimento(anos: number): Promise<{
  encounterId: string; versionId: string; valorId: string; finalizedAt: string;
}> {
  const { rows: enc } = await admin.query<{ id: string }>(
    `INSERT INTO clin.encounter
       (tenant_id, id, patient_id, professional_id, clinic_id,
        occurred_at, occurred_date, status)
     VALUES ($1, gen_random_uuid(), $2, $3, $4,
             clock_timestamp() - make_interval(years => $5::int),
             (current_date - make_interval(years => $5::int))::date, 'rascunho')
     RETURNING id`,
    [tenantId, patientId, profId, clinicId, anos]);
  const encounterId = enc[0]!.id;

  const { rows: v } = await admin.query<{ id: string; finalized_at: string }>(
    `INSERT INTO clin.encounter_version
       (tenant_id, id, encounter_id, version_no, kind, author_user_id,
        author_professional_id, content_hash, prev_hash, serializer_version,
        finalized_at)
     VALUES ($1, gen_random_uuid(), $2, 1, 'original', $4, $3,
             sha256('x'::bytea), NULL, 'jcs-1', clock_timestamp())
     RETURNING id, finalized_at`,
    [tenantId, encounterId, profId, userId]);
  const versionId = v[0]!.id;
  const finalizedAt = v[0]!.finalized_at;

  const { rows: fv } = await admin.query<{ id: string }>(
    `INSERT INTO clin.encounter_field_value
       (tenant_id, id, version_id, finalized_at, field_id, field_generation,
        label_snapshot, section_instance, ordinal, value_text)
     VALUES ($1, gen_random_uuid(), $2, $3, $4, 1, 'Evolucao', 1, 0,
             'conteudo clinico sensivel')
     RETURNING id`,
    [tenantId, versionId, finalizedAt, fieldId]);

  await admin.query(
    `UPDATE clin.encounter SET status = 'finalizado', head_version_id = $2,
            version_count = 1 WHERE tenant_id = $1 AND id = $3`,
    [tenantId, versionId, encounterId]);

  return { encounterId, versionId, valorId: fv[0]!.id, finalizedAt };
}

beforeAll(async () => {
  admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 2 });
  const { rows: t } = await admin.query<{ id: string }>(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
     VALUES (gen_random_uuid(), 'purga-' || substr(gen_random_uuid()::text,1,12),
             'Clinica Purga', '11222333000181')
     RETURNING id`);
  tenantId = t[0]!.id;
  const { rows: c } = await admin.query<{ id: string }>(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone)
     VALUES ($1, gen_random_uuid(), 'Unidade', 'America/Sao_Paulo') RETURNING id`,
    [tenantId]);
  clinicId = c[0]!.id;
  const { rows: u } = await admin.query<{ id: string }>(
    `INSERT INTO id."user" (id, email, full_name)
     VALUES (gen_random_uuid(), 'purga-' || substr(gen_random_uuid()::text,1,12)
             || '@teste.local', 'Dr Purga') RETURNING id`);
  userId = u[0]!.id;
  const { rows: p } = await admin.query<{ id: string }>(
    `INSERT INTO app.professional
       (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho)
     VALUES ($1, gen_random_uuid(), $2, '06', '112233', 'SP') RETURNING id`,
    [tenantId, userId]);
  profId = p[0]!.id;
  const { rows: pa } = await admin.query<{ id: string }>(
    `INSERT INTO clin.patient (tenant_id, id, full_name)
     VALUES ($1, gen_random_uuid(), 'Paciente Antigo') RETURNING id`, [tenantId]);
  patientId = pa[0]!.id;
  const { rows: s } = await admin.query<{ id: string }>(
    `INSERT INTO clin.record_section (tenant_id, id, code, label, ordinal)
     VALUES ($1, gen_random_uuid(), 'evolucao', 'Evolucao', 0) RETURNING id`,
    [tenantId]);
  sectionId = s[0]!.id;
  const { rows: f } = await admin.query<{ id: string }>(
    `INSERT INTO clin.record_field
       (tenant_id, id, section_id, code, label, kind, ordinal)
     VALUES ($1, gen_random_uuid(), $2, 'evolucao', 'Evolucao', 'texto_longo', 0)
     RETURNING id`, [tenantId, sectionId]);
  fieldId = f[0]!.id;
});

afterAll(async () => { await admin.end(); await closePools(); });

describe('expurgo legal §3.10', () => {
  it('NAO expurga o que esta dentro da guarda de 20 anos', async () => {
    const recente = await semearAtendimento(3);
    const { rows } = await admin.query<{ valores_expurgados: string }>(
      `SELECT valores_expurgados FROM clin.purge_expired($1)`, [tenantId]);

    expect(Number(rows[0]!.valores_expurgados)).toBe(0);

    const { rows: v } = await admin.query<{ value_text: string | null }>(
      `SELECT value_text FROM clin.encounter_field_value WHERE id = $1`,
      [recente.valorId]);
    // O conteúdo continua lá. Apagar dentro do prazo é o erro que não tem
    // desfazer, e a janela é calculada no banco justamente para nenhum chamador
    // conseguir encurtar.
    expect(v[0]!.value_text).toBe('conteudo clinico sensivel');
  });

  it('expurga o que passou do prazo, destruindo o conteudo e deixando a linha', async () => {
    const antigo = await semearAtendimento(25);
    const { rows } = await admin.query<{
      valores_expurgados: string; corte: string }>(
      `SELECT valores_expurgados, corte FROM clin.purge_expired($1)`, [tenantId]);

    expect(Number(rows[0]!.valores_expurgados)).toBe(1);

    const { rows: v } = await admin.query<{
      value_text: string | null; purged_at: string | null; label_snapshot: string }>(
      `SELECT value_text, purged_at, label_snapshot
         FROM clin.encounter_field_value WHERE id = $1`, [antigo.valorId]);
    expect(v[0]!.value_text).toBeNull();
    expect(v[0]!.purged_at).not.toBeNull();
    // A LINHA sobrevive: quem consulta depois vê que existiu um valor e quando
    // ele foi destruído. Apagar a linha quebraria a cadeia e apagaria a prova de
    // que o expurgo foi feito dentro da lei.
    expect(v[0]!.label_snapshot).toBe('Evolucao');
  });

  it('a versao clinica em si continua intocavel', async () => {
    const antigo = await semearAtendimento(30);
    await admin.query(`SELECT clin.purge_expired($1)`, [tenantId]);

    await expect(admin.query(
      `UPDATE clin.encounter_version SET version_no = 99 WHERE id = $1`,
      [antigo.versionId])).rejects.toThrow(/append-only/i);
    await expect(admin.query(
      `DELETE FROM clin.encounter_version WHERE id = $1`,
      [antigo.versionId])).rejects.toThrow(/append-only/i);
  });

  it('sem o GUC, nem o superusuario expurga', async () => {
    const antigo = await semearAtendimento(28);
    await expect(admin.query(
      `UPDATE clin.encounter_field_value
          SET value_text = NULL, purged_at = clock_timestamp()
        WHERE id = $1`, [antigo.valorId])).rejects.toThrow(/append-only/i);
  });

  it('marcar como expurgado SEM destruir o conteudo e recusado', async () => {
    const antigo = await semearAtendimento(27);
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.expurgo_legal','on',true)`);
      // Este é o ataque que importa: fingir conformidade. Se passasse, a
      // auditoria acreditaria que o dado sumiu enquanto ele continua legível.
      await expect(c.query(
        `UPDATE clin.encounter_field_value SET purged_at = clock_timestamp()
          WHERE id = $1`, [antigo.valorId]))
        .rejects.toThrow(/expurgo incompleto/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('aproveitar a janela do expurgo para alterar outro campo e recusado', async () => {
    const antigo = await semearAtendimento(26);
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.expurgo_legal','on',true)`);
      await expect(c.query(
        `UPDATE clin.encounter_field_value
            SET value_text = NULL, purged_at = clock_timestamp(),
                label_snapshot = 'rotulo trocado'
          WHERE id = $1`, [antigo.valorId]))
        .rejects.toThrow(/nao pode alterar nenhum outro campo/i);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('expurgar duas vezes nao mexe no carimbo original', async () => {
    const antigo = await semearAtendimento(24);
    await admin.query(`SELECT clin.purge_expired($1)`, [tenantId]);
    const { rows: a } = await admin.query<{ purged_at: string }>(
      `SELECT purged_at FROM clin.encounter_field_value WHERE id = $1`,
      [antigo.valorId]);

    await admin.query(`SELECT clin.purge_expired($1)`, [tenantId]);
    const { rows: b } = await admin.query<{ purged_at: string }>(
      `SELECT purged_at FROM clin.encounter_field_value WHERE id = $1`,
      [antigo.valorId]);

    // A data do expurgo é o que a clínica apresenta se questionada. Reescrever a
    // cada rodada do job faria parecer que o dado sobreviveu até ontem.
    expect(b[0]!.purged_at).toEqual(a[0]!.purged_at);
  });
});
