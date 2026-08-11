import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
beforeAll(async () => { s = await semearSessao({ role: 'recepcao' }); });
afterAll(async () => { await closePools(); });

function auth(s: SementeSessao) {
  return {
    cookies: { '__Host-cadencia_sid': s.token, '__Host-cadencia_csrf': s.csrf },
    headers: { 'x-clinic-id': s.clinicId, 'x-csrf-token': s.csrf },
  };
}

describe('rotas de pacientes', () => {
  it('GET /v1/pacientes busca por termo e devolve os campos da combobox', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/pacientes?termo=pacient', ...auth(s) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { itens: { displayName: string; cadastroStatus: string }[] };
    expect(body.itens[0]).toHaveProperty('displayName');
    expect(body.itens[0]).toHaveProperty('cadastroStatus');
    await app.close();
  });

  it('POST /v1/pacientes cria o cadastro minimo e devolve 201', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/pacientes', ...auth(s),
      payload: { fullName: 'Novo Paciente', phonePrimary: '11991234567' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ cadastroStatus: 'preliminar' });
    await app.close();
  });

  it('POST sem canal devolve 422 com o erro de dominio nomeado', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/pacientes', ...auth(s),
      payload: { fullName: 'Sem Canal' } });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ erro: 'canal_obrigatorio' });
    await app.close();
  });

  it('GET /v1/pacientes/existe responde o TERCEIRO ESTADO sem conteudo', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/pacientes/existe?kind=CPF&value=11144477735', ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json() as object)).toEqual(['existe']);
    await app.close();
  });

  it('GET /v1/pacientes/:id/prontuario e clinico: recepcao recebe 403', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/pacientes/${s.patientId}/prontuario`, ...auth(s) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  describe('contato', () => {
    let contatoPatientId: string;

    it('cria paciente para testes de contato', async () => {
      const app = await buildApp();
      const r = await app.inject({ method: 'POST', url: '/v1/pacientes', ...auth(s),
        payload: { fullName: 'Paciente Contato', phonePrimary: '11991234567', email: 'contato@teste.com' } });
      expect(r.statusCode).toBe(201);
      contatoPatientId = (r.json() as { patientId: string }).patientId;
      await app.close();
    });

    it('atualiza telefone primario', async () => {
      const app = await buildApp();
      const r = await app.inject({ method: 'PATCH',
        url: `/v1/pacientes/${contatoPatientId}/contato`, ...auth(s),
        payload: { phonePrimary: '21999887766' } });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ patientId: contatoPatientId });

      const get = await app.inject({ method: 'GET',
        url: `/v1/pacientes/${contatoPatientId}`, ...auth(s) });
      expect((get.json() as { phonePrimary: string }).phonePrimary).toBe('21999887766');
      await app.close();
    });

    it('atualiza email', async () => {
      const app = await buildApp();
      const r = await app.inject({ method: 'PATCH',
        url: `/v1/pacientes/${contatoPatientId}/contato`, ...auth(s),
        payload: { email: 'novo@email.com' } });
      expect(r.statusCode).toBe(200);

      const get = await app.inject({ method: 'GET',
        url: `/v1/pacientes/${contatoPatientId}`, ...auth(s) });
      expect((get.json() as { email: string }).email).toBe('novo@email.com');
      await app.close();
    });

    it('rejeita remover ambos telefone e email', async () => {
      const app = await buildApp();
      const r = await app.inject({ method: 'PATCH',
        url: `/v1/pacientes/${contatoPatientId}/contato`, ...auth(s),
        payload: { phonePrimary: null, email: null } });
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ erro: 'canal_obrigatorio' });
      await app.close();
    });

    it('atualiza contato de emergencia', async () => {
      const app = await buildApp();
      const r = await app.inject({ method: 'PATCH',
        url: `/v1/pacientes/${contatoPatientId}/contato`, ...auth(s),
        payload: { emergencyContactName: 'Maria da Silva', emergencyContactPhone: '11912345678' } });
      expect(r.statusCode).toBe(200);

      const get = await app.inject({ method: 'GET',
        url: `/v1/pacientes/${contatoPatientId}`, ...auth(s) });
      const body = get.json() as { emergencyContactName: string; emergencyContactPhone: string };
      expect(body.emergencyContactName).toBe('Maria da Silva');
      expect(body.emergencyContactPhone).toBe('11912345678');
      await app.close();
    });

    it('rejeita telefone invalido com menos de 10 digitos', async () => {
      const app = await buildApp();
      const r = await app.inject({ method: 'PATCH',
        url: `/v1/pacientes/${contatoPatientId}/contato`, ...auth(s),
        payload: { phonePrimary: '123' } });
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ erro: 'telefone_invalido' });
      await app.close();
    });

    it('GET /v1/pacientes/:id retorna campos de contato expandidos', async () => {
      const app = await buildApp();
      const get = await app.inject({ method: 'GET',
        url: `/v1/pacientes/${contatoPatientId}`, ...auth(s) });
      expect(get.statusCode).toBe(200);
      const body = get.json() as Record<string, unknown>;
      expect(body).toHaveProperty('phoneSecondary');
      expect(body).toHaveProperty('emergencyContactName');
      expect(body).toHaveProperty('emergencyContactPhone');
      await app.close();
    });
  });

  it('POST sem cabecalho CSRF e recusado com 403', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/v1/pacientes',
      cookies: { '__Host-cadencia_sid': s.token },
      headers: { 'x-clinic-id': s.clinicId },
      payload: { fullName: 'Teste CSRF', phonePrimary: '11991234567' } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ erro: 'csrf_invalido' });
    await app.close();
  });
});
