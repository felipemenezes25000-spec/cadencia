import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../../app';
import { semearSessao, auth, type SementeSessao } from '../../test-support';

let medico: SementeSessao;
let recepcao: SementeSessao;
let versionId: string;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

const PROC = {
  codigoTabela: '22', codigoProcedimento: '40304361',
  descricao: 'Hemograma completo', quantidade: 2, valorCentavos: 4500,
};

beforeAll(async () => {
  medico = await semearSessao({ role: 'profissional' });
  recepcao = await semearSessao({ role: 'recepcao' });

  const pool = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, razao_social, registro_ans, cnpj, tiss_version,
          transport_mode, active, created_by)
       VALUES ($1, $2, 'Meridiano SADT', '339679', '11111111000190', '4.03.00',
               'arquivo', true, $3)`,
      [medico.tenantId, uuidv7(), medico.userId]);

    versionId = uuidv7();
    await c.query(
      `INSERT INTO clin.encounter_version
         (tenant_id, id, encounter_id, version_no, kind, author_user_id,
          author_professional_id, content_hash, serializer_version)
       VALUES ($1, $2, $3, 1, 'original', $4, $5,
               decode(repeat('00', 32), 'hex'), 'test-v1')`,
      [medico.tenantId, versionId, medico.encounterId, medico.userId,
       medico.professionalId]);
    await c.query(
      `UPDATE clin.encounter SET head_version_id = $1, version_count = 1
        WHERE id = $2`, [versionId, medico.encounterId]);

    await c.query(
      `INSERT INTO clin.encounter_billing
         (tenant_id, id, encounter_id, operadora_nome, registro_ans,
          numero_carteira, atendimento_rn, cnes, cnpj_contratado,
          conselho_profissional, numero_conselho, uf_conselho, cbos,
          indicacao_acidente, regime_atendimento, tipo_consulta,
          data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos,
          created_by)
       VALUES ($1, $2, $3, 'Meridiano SADT', '339679',
               'CART123', false, '2077502', '11111111000190',
               '06', '999888', 'SP', '225125',
               '9', '01', '1',
               (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
               '22', '10101012', 15000, $4)`,
      [medico.tenantId, uuidv7(), medico.encounterId, medico.userId]);

    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
});

afterAll(async () => { await closePools(); });

describe('emissao de guia SP/SADT', () => {
  it('cria a guia com os itens e devolve o total derivado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/guias-sadt', ...auth(medico),
      payload: {
        encounterId: medico.encounterId,
        caraterAtendimento: '1', tipoAtendimento: '04',
        indicacaoClinica: 'Investigacao de anemia',
        procedimentos: [PROC],
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { valorTotalCentavos: number; numeroGuiaPrestador: string };
    // 2 x 45,00 = 90,00. O total não é recebido do cliente: é somado dos itens,
    // porque guia que diverge dos próprios itens é a glosa mais boba.
    expect(body.valorTotalCentavos).toBe(9000);
    expect(body.numeroGuiaPrestador).toBeTruthy();
    await app.close();
  });

  it('a guia aparece na lista do atendimento com os procedimentos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/atendimentos/${medico.encounterId}/guias-sadt`,
      ...auth(medico) });
    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      valorTotalCentavos: number;
      procedimentos: { codigoProcedimento: string; quantidade: number }[] }[] }).itens;
    expect(itens.length).toBeGreaterThanOrEqual(1);
    expect(itens[0]!.valorTotalCentavos).toBe(9000);
    expect(itens[0]!.procedimentos[0]).toMatchObject({
      codigoProcedimento: '40304361', quantidade: 2 });
    await app.close();
  });

  it('a recepcao NAO pode emitir guia de exame', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/guias-sadt', ...auth(recepcao),
      payload: {
        encounterId: recepcao.encounterId,
        caraterAtendimento: '1', tipoAtendimento: '04',
        procedimentos: [PROC],
      },
    });
    // Pedido de exame em nome de um médico que não pediu é o começo de uma
    // glosa por procedimento não justificado — quando não de coisa pior.
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it('guia sem procedimento e recusada na borda', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/guias-sadt', ...auth(medico),
      payload: {
        encounterId: medico.encounterId,
        caraterAtendimento: '1', tipoAtendimento: '04', procedimentos: [],
      },
    });
    // Guia vazia é ACEITA pela operadora e não paga nada.
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('tipo de atendimento fora do dominio da ANS e recusado', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/guias-sadt', ...auth(medico),
      payload: {
        encounterId: medico.encounterId,
        caraterAtendimento: '1',
        // `dm_tipoAtendimento` = {01,02,03,04,08,09,10,13,23}. '05' parece
        // plausível e não existe — recusar aqui evita o lote inteiro voltar.
        tipoAtendimento: '05',
        procedimentos: [PROC],
      },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('atendimento particular nao gera guia', async () => {
    const semConvenio = await semearSessao({ role: 'profissional' });
    const pool = new Pool({ connectionString: adminUrl(), max: 1 });
    try {
      const v = uuidv7();
      await pool.query(
        `INSERT INTO clin.encounter_version
           (tenant_id, id, encounter_id, version_no, kind, author_user_id,
            author_professional_id, content_hash, serializer_version)
         VALUES ($1,$2,$3,1,'original',$4,$5,decode(repeat('00',32),'hex'),'test-v1')`,
        [semConvenio.tenantId, v, semConvenio.encounterId, semConvenio.userId,
         semConvenio.professionalId]);
      await pool.query(
        `UPDATE clin.encounter SET head_version_id=$1, version_count=1 WHERE id=$2`,
        [v, semConvenio.encounterId]);
      await pool.query(
        `INSERT INTO clin.encounter_billing
           (tenant_id, id, encounter_id, operadora_nome, registro_ans,
            numero_carteira, atendimento_rn, cnes, cnpj_contratado,
            conselho_profissional, numero_conselho, uf_conselho, cbos,
            indicacao_acidente, regime_atendimento, tipo_consulta,
            data_atendimento, codigo_tabela, codigo_procedimento, valor_centavos,
            created_by)
         VALUES ($1,$2,$3,NULL,NULL,NULL,false,'2077502','11111111000190',
                 '06','999888','SP','225125','9','01','1',
                 (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date,
                 '22','10101012',15000,$4)`,
        [semConvenio.tenantId, uuidv7(), semConvenio.encounterId, semConvenio.userId]);
    } finally {
      await pool.end();
    }

    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/tiss/guias-sadt', ...auth(semConvenio),
      payload: {
        encounterId: semConvenio.encounterId,
        caraterAtendimento: '1', tipoAtendimento: '04', procedimentos: [PROC],
      },
    });
    // Emitir criaria uma guia que nunca será enviada e ficaria pendente para
    // sempre na lista de faturamento.
    expect(r.statusCode).toBe(422);
    expect((r.json() as { erro: string }).erro)
      .toBe('atendimento_particular_nao_gera_guia');
    await app.close();
  });
});
