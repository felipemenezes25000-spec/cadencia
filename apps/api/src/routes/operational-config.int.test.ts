import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, jobsPool } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { Pool } from 'pg';
import { buildApp } from '../app';
import { auth, semearColega, semearSessao, type SementeSessao } from '../test-support';

let admin: SementeSessao;
let outroTenant: SementeSessao;
let recepcao: SementeSessao;

beforeAll(async () => {
  admin = await semearSessao({ role: 'admin_clinico' });
  outroTenant = await semearSessao({ role: 'admin_clinico' });
  recepcao = await semearColega(admin, { role: 'recepcao' });
});

afterAll(async () => { await closePools(); });

describe('configuracao operacional persistida', () => {
  it('lista tenant e clinica reais do contexto', async () => {
    const app = await buildApp();
    const tenant = await app.inject({
      method: 'GET', url: '/v1/tenants/current', ...auth(admin),
    });
    const clinicas = await app.inject({
      method: 'GET', url: '/v1/clinics', ...auth(admin),
    });

    expect(tenant.statusCode).toBe(200);
    expect(tenant.json()).toMatchObject({ id: admin.tenantId, nome: 'Clinica Sessao' });
    expect(clinicas.statusCode).toBe(200);
    expect(clinicas.json()).toMatchObject({
      itens: [{ id: admin.clinicId, nome: 'Unidade Sessao', principal: true }],
    });
    await app.close();
  });

  it('cria canal e volta a lista-lo sem atravessar tenant', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST', url: '/v1/channels', ...auth(admin),
      payload: { channel: 'whatsapp', rateLimitPerMinute: 80 },
    });
    expect(created.statusCode).toBe(201);

    const own = await app.inject({ method: 'GET', url: '/v1/channels', ...auth(admin) });
    const other = await app.inject({ method: 'GET', url: '/v1/channels', ...auth(outroTenant) });
    expect(own.json()).toMatchObject({
      itens: [{ channel: 'whatsapp', status: 'pending_verification', rateLimitPerMinute: 80 }],
    });
    expect(other.json()).toEqual({ itens: [] });
    await app.close();
  });

  it('lista e marca notificacao somente para o usuario destinatario', async () => {
    const notificationId = uuidv7();
    await jobsPool().query(
      `INSERT INTO app.notification
         (tenant_id, id, user_id, clinic_id, kind, title, body, data)
       VALUES ($1, $2, $3, $4, 'appointment_attention', 'Paciente aguardando',
               'A fila precisa de atenção.', '{"appointmentId":"a1"}'::jsonb)`,
      [admin.tenantId, notificationId, admin.userId, admin.clinicId],
    );

    const app = await buildApp();
    const listed = await app.inject({
      method: 'GET', url: '/v1/notifications?unreadOnly=true', ...auth(admin),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      unreadCount: 1,
      itens: [{ id: notificationId, title: 'Paciente aguardando', readAt: null }],
    });

    const marked = await app.inject({
      method: 'PUT', url: `/v1/notifications/${notificationId}/read`, ...auth(admin),
    });
    expect(marked.json()).toEqual({ ok: true });

    const after = await app.inject({ method: 'GET', url: '/v1/notifications', ...auth(admin) });
    expect(after.json()).toMatchObject({ unreadCount: 0, itens: [{ id: notificationId }] });
    await app.close();
  });

  it('salva e relê overrides de permissão por clínica', async () => {
    const app = await buildApp();
    const saved = await app.inject({
      method: 'PUT', url: `/v1/clinics/${admin.clinicId}/permissions`, ...auth(admin),
      payload: { overrides: [{ action: 'patient.read', role: 'recepcao', permitido: false }] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ saved: 1 });

    const listed = await app.inject({
      method: 'GET', url: `/v1/permissions?clinicId=${admin.clinicId}`, ...auth(admin),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      overrides: {
        recepcao: [{ action: 'patient.read', role: 'recepcao', permitido: false }],
      },
    });
    await app.close();
  });

  it('aplica override negado na próxima autorização da rota', async () => {
    const app = await buildApp();
    const saved = await app.inject({
      method: 'PUT', url: `/v1/clinics/${admin.clinicId}/permissions`, ...auth(admin),
      payload: { overrides: [{ action: 'patient.read', role: 'recepcao', permitido: false }] },
    });
    expect(saved.statusCode).toBe(200);
    const denied = await app.inject({
      method: 'GET', url: `/v1/pacientes/${admin.patientId}`, ...auth(recepcao),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      erro: 'sem_permissao', acao: 'patient.read', motivo: 'papel_insuficiente',
    });
    await app.close();
  });

  it('aplica override permitido fora do papel padrão', async () => {
    const app = await buildApp();
    const saved = await app.inject({
      method: 'PUT', url: `/v1/clinics/${admin.clinicId}/permissions`, ...auth(admin),
      payload: { overrides: [{ action: 'tenant.read', role: 'recepcao', permitido: true }] },
    });
    expect(saved.statusCode).toBe(200);
    const allowed = await app.inject({
      method: 'GET', url: '/v1/tenants/current', ...auth(recepcao),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ id: admin.tenantId });
    await app.close();
  });

  it('pagina notificações sem perder nem repetir itens', async () => {
    const newestId = uuidv7();
    const olderId = uuidv7();
    await jobsPool().query(
      `INSERT INTO app.notification
         (tenant_id, id, user_id, clinic_id, kind, title, body, data, created_at)
       VALUES
         ($1, $2, $3, $4, 'message_received', 'Página mais nova', 'Primeira página', '{}'::jsonb,
          clock_timestamp() + interval '2 seconds'),
         ($1, $5, $3, $4, 'message_received', 'Página seguinte', 'Segunda página', '{}'::jsonb,
          clock_timestamp() + interval '1 second')`,
      [admin.tenantId, newestId, admin.userId, admin.clinicId, olderId],
    );
    const app = await buildApp();
    const firstPage = await app.inject({
      method: 'GET', url: '/v1/notifications?limit=1', ...auth(admin),
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json()).toMatchObject({
      itens: [{ id: newestId }], nextCursor: newestId,
    });
    const secondPage = await app.inject({
      method: 'GET', url: `/v1/notifications?limit=1&cursor=${newestId}`, ...auth(admin),
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json()).toMatchObject({ itens: [{ id: olderId }] });
    expect((secondPage.json() as { itens: Array<{ id: string }> }).itens[0]?.id)
      .not.toBe(newestId);
    await app.close();
  });

  it('não autoriza uma clínica usando o vínculo administrativo de outra', async () => {
    const outraClinicaId = uuidv7();
    await jobsPool().query(
      `INSERT INTO app.clinic (tenant_id, id, nome, timezone)
       VALUES ($1, $2, 'Unidade sem vínculo', 'America/Sao_Paulo')`,
      [admin.tenantId, outraClinicaId],
    );
    const app = await buildApp();
    const response = await app.inject({
      method: 'PUT', url: `/v1/clinics/${outraClinicaId}/permissions`, ...auth(admin),
      payload: { overrides: [{ action: 'patient.read', role: 'recepcao', permitido: false }] },
    });
    expect(response.statusCode).toBe(403);
    const adminPool = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      const persisted = await adminPool.query(
        `SELECT 1 FROM app.permission_override
          WHERE tenant_id = $1 AND clinic_id = $2`,
        [admin.tenantId, outraClinicaId],
      );
      expect(persisted.rowCount).toBe(0);
    } finally {
      await adminPool.end();
    }
    await app.close();
  });
});
