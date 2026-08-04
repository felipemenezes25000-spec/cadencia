import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createMinimalPatient, completePatient, dataDebt } from './create';
import { semearPacientes, type SementePacientes } from './test-support';

let s: SementePacientes; let actor: Actor; let novo = '';

beforeAll(async () => {
  s = await semearPacientes();
  actor = { kind: 'user', tenantId: s.tenantId, userId: s.userId, clinicId: s.clinicId,
            requestId: uuidv7() };
});
afterAll(async () => { await closePools(); });

describe('cadastro minimo viavel', () => {
  it('nome + telefone bastam, e o cadastro nasce preliminar', async () => {
    const r = await withTenantTx(actor, (tx) => createMinimalPatient(tx, {
      fullName: 'Maria Sou Nova', phonePrimary: '11991234567' }));
    expect(r.ok).toBe(true);
    if (r.ok) { novo = r.value.patientId; expect(r.value.cadastroStatus).toBe('preliminar'); }
  });

  it('nome + e-mail tambem bastam — o canal e um, nao os dois', async () => {
    const r = await withTenantTx(actor, (tx) => createMinimalPatient(tx, {
      fullName: 'So Email', email: 'so@example.test' }));
    expect(r.ok).toBe(true);
  });

  it('recusa cadastro sem nenhum canal — sem canal nao ha como confirmar', async () => {
    const r = await withTenantTx(actor, (tx) => createMinimalPatient(tx, { fullName: 'Sem Canal' }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_obrigatorio' } });
  });

  it('recusa CPF invalido em vez de aceitar 000.000.000-00', async () => {
    const r = await withTenantTx(actor, (tx) => createMinimalPatient(tx, {
      fullName: 'CPF Falso', phonePrimary: '11999999999', cpf: '00000000000' }));
    expect(r).toEqual({ ok: false, error: { kind: 'cpf_invalido' } });
  });

  it('lista a divida de dados — e a barra "N dados pendentes" do Perfil', async () => {
    const r = await withTenantTx(actor, (tx) => dataDebt(tx, novo));
    expect(r).toEqual({ patientId: novo, pendentes: ['birth_date', 'cpf', 'sex_at_birth'] });
  });

  it('completar o cadastro paga a divida e muda o status', async () => {
    const r = await withTenantTx(actor, (tx) => completePatient(tx, {
      patientId: novo, birthDate: '1990-05-20', sexAtBirth: 'F', cpf: '11144477735' }));
    expect(r).toEqual({ ok: false, error: { kind: 'cpf_duplicado' } });

    const r2 = await withTenantTx(actor, (tx) => completePatient(tx, {
      patientId: novo, birthDate: '1990-05-20', sexAtBirth: 'F', cpf: '52998224725' }));
    expect(r2.ok).toBe(true);

    const debt = await withTenantTx(actor, (tx) => dataDebt(tx, novo));
    expect(debt.pendentes).toEqual([]);
  });
});
