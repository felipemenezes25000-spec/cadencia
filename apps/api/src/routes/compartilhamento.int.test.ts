import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, semearColega, type SementeSessao } from '../test-support';

let dono: SementeSessao;
let colega: SementeSessao;

/**
 * Dois profissionais no MESMO tenant e na mesma unidade. É a única montagem que
 * exercita a política RESTRICTIVE `clinical_scope`: entre tenants a RLS já
 * separa por outro caminho, e o teste passaria sem provar nada.
 */
beforeAll(async () => {
  dono = await semearSessao({ role: 'profissional' });
  colega = await semearColega(dono);
});

afterAll(async () => { await closePools(); });

describe('compartilhamento de prontuario', () => {
  it('sem compartilhamento, o colega NAO ve o atendimento', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/atendimentos/${dono.encounterId}/contexto`,
      ...auth(colega) });
    // Política RESTRICTIVE clinical_scope. É 404 e não 403 de propósito:
    // confirmar que o atendimento existe já diz ao colega qual paciente o outro
    // médico está atendendo.
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('o dono compartilha e o colega passa a ver', async () => {
    const app = await buildApp();
    const post = await app.inject({
      method: 'POST', url: '/v1/compartilhamentos',
      payload: {
        patientId: dono.patientId,
        granteeProfessionalId: colega.professionalId,
        reason: 'discussao de caso com o cardiologista',
      },
      ...auth(dono) });
    expect(post.statusCode).toBe(201);

    const r = await app.inject({
      method: 'GET', url: `/v1/atendimentos/${dono.encounterId}/contexto`,
      ...auth(colega) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('compartilhar exige MOTIVO — acesso a prontuario alheio se justifica', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'POST', url: '/v1/compartilhamentos',
      payload: {
        patientId: dono.patientId,
        granteeProfessionalId: colega.professionalId,
        reason: '  ',
      },
      ...auth(dono) });
    // `reason` é NOT NULL no banco. Aceitar branco cumpriria a coluna e
    // esvaziaria a auditoria: "por que este médico viu este paciente?" é
    // exatamente a pergunta que o CFM faz.
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('lista quem tem acesso, com quem concedeu e por que', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${dono.patientId}/compartilhamentos`,
      ...auth(dono) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      shareId: string; granteeNome: string; concedidoPor: string;
      motivo: string; expiraEm: string | null }[] }).itens;
    expect(itens).toHaveLength(1);
    expect(itens[0]?.motivo).toContain('cardiologista');
    expect(itens[0]?.granteeNome).toBeTruthy();
    await app.close();
  });

  it('revogar tira o acesso na hora', async () => {
    const app = await buildApp();
    const lista = await app.inject({
      method: 'GET', url: `/v1/pacientes/${dono.patientId}/compartilhamentos`,
      ...auth(dono) });
    const id = (lista.json() as { itens: { shareId: string }[] }).itens[0]?.shareId;

    const del = await app.inject({
      method: 'DELETE', url: `/v1/compartilhamentos/${id}`, ...auth(dono) });
    expect(del.statusCode).toBe(204);

    const r = await app.inject({
      method: 'GET', url: `/v1/atendimentos/${dono.encounterId}/contexto`,
      ...auth(colega) });
    // Revogação que só vale no próximo login é revogação que não vale.
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('recepcao nao compartilha prontuario', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({
      method: 'POST', url: '/v1/compartilhamentos',
      payload: {
        patientId: recepcao.patientId,
        granteeProfessionalId: recepcao.professionalId,
        reason: 'motivo qualquer',
      },
      ...auth(recepcao) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
