import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;

beforeAll(async () => {
  s = await semearSessao({ role: 'profissional' });
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    // Nascimento e sexo do paciente: a tela mostra IDADE, e idade so existe se
    // houver data. Sem isso o cabecalho do prontuario fica mudo.
    await a.query(
      `UPDATE clin.patient SET birth_date = date '1985-03-12', sex_at_birth = 'F'
        WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.patientId]);

    // Uma prescricao anterior — a fonte honesta de "medicamentos em uso" e o que
    // foi de fato prescrito, nao um campo de texto que ninguem mantem.
    const prescId = uuidv7();
    const canceladaId = uuidv7();
    await a.query(
      `INSERT INTO clin.prescription
         (tenant_id, id, patient_id, professional_id, clinic_id, encounter_id,
          issued_date, provider, provider_prescription_id, patient_link_url,
          validation_code, cancelled_at, cancel_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6, current_date - 20, 'memed','mp-1',
               'https://memed.test/1','V1', NULL, NULL, $8),
              ($1,$7,$3,$4,$5,$6, current_date - 10, 'memed','mp-2',
               'https://memed.test/2','V2', clock_timestamp(), 'erro de digitacao', $8)`,
      [s.tenantId, prescId, s.patientId, s.professionalId, s.clinicId, s.encounterId,
       canceladaId, s.userId]);
    await a.query(
      `INSERT INTO clin.prescription_item
         (tenant_id, id, prescription_id, ordinal, nome, principio_ativo,
          concentracao, forma, quantidade, posologia, eh_controlado)
       VALUES ($1,$2,$3,1,'Losartana 50mg','Losartana potassica','50 mg',
               'comprimido',30,'1 comprimido pela manha', false),
              ($1,$4,$5,1,'Amoxicilina 500mg','Amoxicilina','500 mg',
               'capsula',21,'1 capsula de 8/8h', false)`,
      [s.tenantId, uuidv7(), prescId, uuidv7(), canceladaId]);
  } finally {
    await a.end();
  }
});
afterAll(async () => { await closePools(); });

describe('contexto do atendimento', () => {
  it('devolve paciente, medicamentos em uso e historico em UMA volta', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/atendimentos/${s.encounterId}/contexto`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    const c = r.json() as {
      paciente: { patientId: string; nome: string; nascimento: string | null;
                  sexo: string | null; convenio: string | null };
      alergias: string[];
      medicamentos: { nome: string; posologia: string }[];
      ultimosAtendimentos: { data: string; procedimento: string | null }[];
      procedimentoNome: string | null;
      inicio: string;
    };

    expect(c.paciente.patientId).toBe(s.patientId);
    expect(c.paciente.nome).toBe(s.patientNome);
    // Data pura, sem hora: a tela calcula idade. Mandar timestamptz faria a
    // virada de fuso mudar a idade de quem nasceu dia 1o.
    expect(c.paciente.nascimento).toBe('1985-03-12');
    expect(c.paciente.sexo).toBe('F');

    // Uma prescricao viva e uma cancelada. So a viva conta: mostrar medicamento
    // de receita cancelada como "em uso" e pior do que nao mostrar nada — o
    // medico prescreve interacao contra um remedio que o paciente nao toma.
    expect(c.medicamentos).toHaveLength(1);
    expect(c.medicamentos[0]?.nome).toBe('Losartana 50mg');
    expect(c.medicamentos[0]?.posologia).toBe('1 comprimido pela manha');

    // Alergias vem do campo estruturado do prontuario. Nao ha nenhuma aqui, e
    // vazio e a resposta certa — nao ausencia da chave.
    expect(c.alergias).toEqual([]);

    expect(typeof c.inicio).toBe('string');
    await app.close();
  });

  it('valor sugerido volta como NUMERO, nao como string', async () => {
    const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      await a.query(
        `UPDATE sched.procedure SET valor_centavos = 25000
          WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.procedureId]);
      await a.query(
        `UPDATE sched.appointment SET procedure_id = $3
          WHERE tenant_id = $1 AND id = $2`,
        [s.tenantId, s.appointmentId, s.procedureId]);
      // O valor sugerido so existe se o encontro souber de qual agendamento veio.
      await a.query(
        `UPDATE clin.encounter SET appointment_id = $3
          WHERE tenant_id = $1 AND id = $2`,
        [s.tenantId, s.encounterId, s.appointmentId]);
    } finally { await a.end(); }

    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/atendimentos/${s.encounterId}/contexto`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    // `valor_centavos` e bigint, e node-postgres devolve bigint como STRING para
    // nao perder precisao. Sem conversao explicita o schema de resposta rejeita
    // e a rota devolve 500 — falha que so aparece quando o procedimento tem
    // preco, e nao quando ele e nulo.
    const c = r.json() as { valorSugeridoCentavos: unknown };
    expect(c.valorSugeridoCentavos).toBe(25000);

    await app.close();
  });

  it('atendimento de outro tenant devolve 404, nao 200 vazio', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'profissional' });
    const r = await app.inject({
      method: 'GET', url: `/v1/atendimentos/${s.encounterId}/contexto`, ...auth(outro) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('recepcao nao le contexto clinico', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'GET', url: `/v1/atendimentos/${recepcao.encounterId}/contexto`, ...auth(recepcao) });
    // Medicamento em uso e dado clinico. Quem agenda nao precisa dele para
    // agendar, e prontuario aberto por padrao e vazamento por padrao.
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
