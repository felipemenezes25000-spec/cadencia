import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createAppointment, setStatus } from './appointments';
import { dayCounters, dayQueue } from './day';
import { semearAgenda, type SementeAgenda } from './test-support';

let s: SementeAgenda; let actor: Actor; const ids: string[] = [];
const DIA = '2026-11-10';
/** Agendamentos em OUTRAS datas do mesmo tenant. Veja `semearRuido`. */
const RUIDO_MINIMO = 2000;

interface NoDoPlano {
  readonly 'Node Type': string;
  readonly 'Actual Rows'?: number;
  readonly Plans?: readonly NoDoPlano[];
}
interface PlanoRaiz {
  readonly Plan: NoDoPlano;
  readonly 'Execution Time': number;
}

/** Soma as linhas que os nós de varredura realmente leram. */
function linhasVarridas(no: NoDoPlano): number {
  const proprias = no['Node Type'].includes('Scan') ? (no['Actual Rows'] ?? 0) : 0;
  return (no.Plans ?? []).reduce((acc, filho) => acc + linhasVarridas(filho), proprias);
}

/**
 * Sem ruído o teste de plano não afirma nada: numa tabela vazia qualquer plano
 * custa zero e o planejador nem tem estatística. Estes agendamentos ficam em
 * OUTRAS datas — são o que um Seq Scan teria de varrer para chegar aos cinco do
 * dia. `encaixe` = true os isenta da restrição de exclusão por sobreposição.
 */
async function semearRuido(): Promise<void> {
  const admin = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    await admin.query(
      `INSERT INTO sched.appointment
         (tenant_id, id, patient_id, professional_id, clinic_id, starts_at, ends_at,
          appointment_date, encaixe, created_by)
       SELECT $1, gen_random_uuid(), $2, $3, $4, g.ts, g.ts + interval '30 min',
              app.local_date(g.ts, 'America/Sao_Paulo'), true, $5
         FROM generate_series(timestamptz '2026-11-11T12:00:00Z',
                              timestamptz '2027-01-20T12:00:00Z',
                              interval '50 min') AS g(ts)`,
      [s.tenantId, s.patientId, s.professionalId, s.clinicId, s.userId]);
    await admin.query('ANALYZE sched.appointment');
  } finally { await admin.end(); }
}

beforeAll(async () => {
  s = await semearAgenda();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  for (const h of ['13:00', '14:00', '15:00', '16:00', '17:00']) {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: `${DIA}T${h}:00Z` }));
    if (r.ok) ids.push(r.value.appointmentId);
  }
  await withTenantTx(actor, (tx) => setStatus(tx, { appointmentId: ids[1]!, status: 'confirmado' }));
  await withTenantTx(actor, (tx) => setStatus(tx, { appointmentId: ids[2]!, status: 'aguardando' }));
  await withTenantTx(actor, (tx) => setStatus(tx, { appointmentId: ids[3]!, status: 'atendido' }));
  await withTenantTx(actor, (tx) => setStatus(tx, { appointmentId: ids[4]!, status: 'faltou' }));
  await semearRuido();
});
afterAll(async () => { await closePools(); });

describe('o dia', () => {
  it('conta os cinco estados que a faixa de Hoje mostra', async () => {
    const r = await withTenantTx(actor, (tx) => dayCounters(tx, { clinicId: s.clinicId, dia: DIA }));
    expect(r).toEqual({
      agendados: 5, confirmados: 1, aguardando: 1, atendidos: 1, faltas: 1 });
  });

  it('a fila sai em ordem de horario, com os sinais que a linha mostra', async () => {
    const r = await withTenantTx(actor, (tx) => dayQueue(tx, { clinicId: s.clinicId, dia: DIA }));
    expect(r).toHaveLength(5);
    expect(r[0]?.status).toBe('agendado');
    expect(r[0]?.cadastroPreliminar).toBe(false);
    expect(r[0]?.primeiraVez).toBe(true);
    expect(r[0]?.displayName).toBe('Maria Souza Lima');
    // A fila mostra COM QUEM o paciente vai ser atendido. Sem o nome, a linha
    // exibe o uuid do profissional — que não diz nada para a recepção.
    expect(r[0]?.professionalNome).toBeTruthy();
    expect(r[0]?.professionalNome).not.toMatch(/^[0-9a-f]{8}-/);
  });

  it('filtrar por status devolve so aquele grupo — cada numero da faixa e um filtro', async () => {
    const r = await withTenantTx(actor, (tx) =>
      dayQueue(tx, { clinicId: s.clinicId, dia: DIA, status: 'aguardando' }));
    expect(r).toHaveLength(1);
    expect(r[0]?.appointmentId).toBe(ids[2]);
  });

  it('o plano dos contadores nao tem Seq Scan e le so o dia — indice parcial, alvo < 20 ms',
    async () => {
      const { plano, total } = await withTenantTx(actor, async (tx) => {
        const t = await tx.query<{ n: string }>(`SELECT count(*) AS n FROM sched.appointment`);
        const { rows } = await tx.query<{ 'QUERY PLAN': readonly PlanoRaiz[] }>(
          `EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS OFF)
           SELECT count(*) FILTER (WHERE status <> 'cancelado') AS agendados
             FROM sched.appointment
            WHERE tenant_id = app.current_tenant_id() AND clinic_id = $1
              AND appointment_date = $2::date AND status <> 'cancelado'`,
          [s.clinicId, DIA]);
        return { plano: rows[0]?.['QUERY PLAN']?.[0], total: Number(t.rows[0]?.n ?? 0) };
      });
      if (plano === undefined) throw new Error('EXPLAIN nao devolveu plano');

      // Sem esta guarda as duas afirmações abaixo passariam numa tabela vazia
      // sem dizer nada sobre o dia cheio de uma clínica de verdade.
      expect(total).toBeGreaterThan(RUIDO_MINIMO);

      expect(JSON.stringify(plano)).not.toContain('"Seq Scan"');
      // O que sobrevive a escala: as linhas lidas são proporcionais ao FILTRO
      // (os cinco do dia), não ao tamanho da tabela.
      expect(linhasVarridas(plano.Plan)).toBeLessThan(50);
      expect(plano['Execution Time']).toBeLessThan(20);
    });
});
