import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { InMemoryStorageAdapter } from '@cadencia/storage';
import { expurgarRetencao } from './expurgo-retencao';

let admin: Pool;
let tenantId = '';
let patientId = '';
let userId = '';
let chaveAntiga = '';
let chaveRecente = '';
let anexoAntigoId = '';

beforeAll(async () => {
  admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 2 });
  const { rows: t } = await admin.query<{ id: string }>(
    `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
     VALUES (gen_random_uuid(), 'exp-' || substr(gen_random_uuid()::text,1,12),
             'Clinica Expurgo', '11222333000181') RETURNING id`);
  tenantId = t[0]!.id;
  // A unidade é obrigatória: o corte de retenção sai do FUSO dela, e tenant sem
  // clínica devolve corte nulo e não expurga nada.
  await admin.query(
    `INSERT INTO app.clinic (tenant_id, id, nome, timezone)
     VALUES ($1, gen_random_uuid(), 'Unidade', 'America/Sao_Paulo')`,
    [tenantId]);
  const { rows: u } = await admin.query<{ id: string }>(
    `INSERT INTO id."user" (id, email, full_name)
     VALUES (gen_random_uuid(), 'exp-' || substr(gen_random_uuid()::text,1,12)
             || '@teste.local', 'Dr Expurgo') RETURNING id`);
  userId = u[0]!.id;
  const { rows: pa } = await admin.query<{ id: string }>(
    `INSERT INTO clin.patient (tenant_id, id, full_name)
     VALUES ($1, gen_random_uuid(), 'Paciente') RETURNING id`, [tenantId]);
  patientId = pa[0]!.id;

  // Dois anexos: um fora da guarda de 20 anos, outro dentro.
  const inserir = async (anos: number): Promise<{ id: string; key: string }> => {
    const { rows } = await admin.query<{ id: string; storage_key: string }>(
      `INSERT INTO clin.attachment
         (tenant_id, id, patient_id, kind, storage_key, original_name,
          content_type, size_bytes, sha256, dek_ref, occurred_date, created_by)
       VALUES ($1, gen_random_uuid(), $2, 'resultado_exame', gen_random_uuid(),
               'exame.pdf', 'application/pdf', 10, sha256('x'::bytea), 'sem-kms',
               (current_date - make_interval(years => $3::int))::date, $4)
       RETURNING id, storage_key`,
      [tenantId, patientId, anos, userId]);
    return { id: rows[0]!.id, key: rows[0]!.storage_key };
  };
  const antigo = await inserir(25);
  const recente = await inserir(2);
  anexoAntigoId = antigo.id;
  chaveAntiga = antigo.key;
  chaveRecente = recente.key;
});

afterAll(async () => { await admin.end(); await closePools(); });

describe('job de expurgo por retencao', () => {
  it('apaga o OBJETO do que foi expurgado e preserva o que esta no prazo', async () => {
    const armazem = new InMemoryStorageAdapter();
    await armazem.put(`anexos/${chaveAntiga}`, new Uint8Array([1, 2, 3]), 'application/pdf');
    await armazem.put(`anexos/${chaveRecente}`, new Uint8Array([4, 5, 6]), 'application/pdf');

    const r = await expurgarRetencao({ tenantIds: [tenantId] }, armazem);

    expect(r.anexosExpurgados).toBe(1);
    expect(r.objetosApagados).toBe(1);

    // O carimbo no banco sem apagar o arquivo seria conformidade de fachada: a
    // linha diz que sumiu e o PDF continua no disco.
    expect(await armazem.get(`anexos/${chaveAntiga}`)).toBeNull();
    // E o que está dentro da guarda continua intacto — inclusive o objeto.
    expect(await armazem.get(`anexos/${chaveRecente}`)).not.toBeNull();

    const { rows } = await admin.query<{ purged_at: string | null }>(
      `SELECT purged_at FROM clin.attachment WHERE id = $1`, [anexoAntigoId]);
    expect(rows[0]!.purged_at).not.toBeNull();
  });

  it('rodar de novo nao acha nada e nao explode', async () => {
    const armazem = new InMemoryStorageAdapter();
    const r = await expurgarRetencao({ tenantIds: [tenantId] }, armazem);
    // Job diário roda todo dia sobre o mesmo acervo. Segunda passada tem que ser
    // no-op silencioso, não erro.
    expect(r.anexosExpurgados).toBe(0);
    expect(r.falhas).toBe(0);
  });

  it('falha ao apagar objeto NAO derruba o job — o carimbo ja esta gravado', async () => {
    const antigo = await admin.query<{ storage_key: string }>(
      `INSERT INTO clin.attachment
         (tenant_id, id, patient_id, kind, storage_key, original_name,
          content_type, size_bytes, sha256, dek_ref, occurred_date, created_by)
       VALUES ($1, gen_random_uuid(), $2, 'imagem', gen_random_uuid(),
               'foto.jpg', 'image/jpeg', 10, sha256('y'::bytea), 'sem-kms',
               (current_date - make_interval(years => 30))::date, $3)
       RETURNING storage_key`, [tenantId, patientId, userId]);

    const quebrado = new InMemoryStorageAdapter();
    // eslint-disable-next-line @typescript-eslint/require-await
    quebrado.delete = async () => { throw new Error('disco fora do ar'); };

    const r = await expurgarRetencao({ tenantIds: [tenantId] }, quebrado);

    // O banco já comitou o expurgo. Estourar aqui faria o job reprocessar para
    // sempre um tenant cujo carimbo já está gravado — e o objeto órfão é lixo
    // recuperável, enquanto reverter o carimbo apagaria a prova do expurgo.
    expect(r.anexosExpurgados).toBe(1);
    expect(r.objetosApagados).toBe(0);
    expect(r.falhas).toBe(1);
    expect(antigo.rows[0]!.storage_key).toBeTruthy();
  });
});
