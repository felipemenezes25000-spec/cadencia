import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appPool, closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createAppointment } from './appointments';
import { checkIn } from './check-in';
import { semearAgenda, type SementeAgenda } from './test-support';

let s: SementeAgenda; let actor: Actor; let apptId = '';

beforeAll(async () => {
  s = await semearAgenda();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
  await appPool().query(
    `UPDATE clin.patient SET cadastro_status='preliminar', birth_date=NULL WHERE id=$1`,
    [s.patientId]);
  const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
    patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
    procedureId: s.procedureId, startsAt: '2026-11-20T13:00:00Z' }));
  if (r.ok) apptId = r.value.appointmentId;
});
afterAll(async () => { await closePools(); });

describe('check-in', () => {
  it('marca aguardando e devolve a divida de dados a cobrar no balcao', async () => {
    const r = await withTenantTx(actor, (tx) => checkIn(tx, { appointmentId: apptId }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('aguardando');
      expect(r.value.pendentes).toEqual(['birth_date', 'cpf', 'sex_at_birth']);
    }
  });

  it('o check-in NAO bloqueia por cadastro preliminar — quem bloqueia e a finalizacao', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ status: string }>(
      `SELECT status::text AS status FROM sched.appointment WHERE id = $1`, [apptId]));
    expect(rows[0]?.status).toBe('aguardando');
  });

  it('grava evento de auditoria do check-in', async () => {
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.event
        WHERE event_type = 'APPOINTMENT_CHECKIN' AND entity_id = $1`, [apptId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
