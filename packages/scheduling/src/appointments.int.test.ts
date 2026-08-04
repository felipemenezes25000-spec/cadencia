import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createAppointment, moveAppointment, setStatus } from './appointments';
import { semearAgenda, type SementeAgenda } from './test-support';

let s: SementeAgenda; let actor: Actor; let apptId = '';

beforeAll(async () => {
  s = await semearAgenda();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('agendar', () => {
  it('usa a duracao do procedimento quando o fim nao e informado', async () => {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: '2026-10-05T13:00:00Z' }));
    expect(r.ok).toBe(true);
    if (r.ok) { apptId = r.value.appointmentId; expect(r.value.endsAt).toBe('2026-10-05T13:30:00.000Z'); }
  });

  it('recusa conflito e diz que a saida e o encaixe', async () => {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: '2026-10-05T13:15:00Z' }));
    expect(r).toEqual({ ok: false, error: { kind: 'horario_ocupado', encaixePossivel: true } });
  });

  it('encaixa quando a recepcao pede explicitamente', async () => {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: '2026-10-05T13:15:00Z', encaixe: true }));
    expect(r.ok).toBe(true);
  });

  it('avisa que ha bloqueio sem impedir — a decisao e de quem esta com a pessoa na frente', async () => {
    const r = await withTenantTx(actor, (tx) => createAppointment(tx, {
      patientId: s.patientId, professionalId: s.professionalId, clinicId: s.clinicId,
      procedureId: s.procedureId, startsAt: '2026-10-06T15:10:00Z', encaixe: true }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.avisos).toEqual(['horario_bloqueado']);
  });

  it('mover mantem a duracao e recalcula a data no fuso da clinica', async () => {
    const r = await withTenantTx(actor, (tx) => moveAppointment(tx, {
      appointmentId: apptId, startsAt: '2026-10-07T02:30:00Z' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.appointmentDate).toBe('2026-10-06');
  });

  it('mudar status carimba o instante correspondente', async () => {
    const r = await withTenantTx(actor, (tx) => setStatus(tx, {
      appointmentId: apptId, status: 'confirmado' }));
    expect(r.ok).toBe(true);
    const { rows } = await withTenantTx(actor, (tx) => tx.query<{ confirmed_at: string | null }>(
      `SELECT confirmed_at FROM sched.appointment WHERE id = $1`, [apptId]));
    expect(rows[0]?.confirmed_at).not.toBeNull();
  });
});
