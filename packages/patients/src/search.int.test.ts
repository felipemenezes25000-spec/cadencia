import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { searchPatients } from './search';
import { semearPacientes, type SementePacientes } from './test-support';

let s: SementePacientes;
let actor: Actor;

beforeAll(async () => {
  s = await semearPacientes();
  actor = {
    kind: 'user',
    tenantId: s.tenantId,
    userId: s.userId,
    clinicId: s.clinicId,
    requestId: uuidv7(),
  };
});
afterAll(async () => {
  await closePools();
});

describe('busca de paciente', () => {
  it('acha por prefixo sem acento e sem caixa', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'maria sou' }));
    expect(r.map((p) => p.displayName)).toEqual(['MARIA SOUSA', 'Maria Souza Lima']);
  });

  it('destaca o nome social — Decreto 8.727/2016 vale em TODA exibicao', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'joana' }));
    expect(r[0]?.displayName).toBe('Joana Prado');
    expect(r[0]?.legalName).toBe('Joao Prado');
    expect(r[0]?.hasSocialName).toBe(true);
  });

  it('acha por digitos de CPF e por telefone, sem exigir formatacao', async () => {
    const porCpf = await withTenantTx(actor, (tx) =>
      searchPatients(tx, { termo: '111.444.777-35' }));
    expect(porCpf[0]?.patientId).toBe(s.patientMariaId);
    const porFone = await withTenantTx(actor, (tx) =>
      searchPatients(tx, { termo: '11987654321' }));
    expect(porFone[0]?.patientId).toBe(s.patientMariaId);
  });

  it('ordena em portugues: Álvaro antes de Ana', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'a' }));
    const nomes = r.map((p) => p.displayName);
    expect(nomes.indexOf('Álvaro Neto')).toBeLessThan(nomes.indexOf('Ana Lima'));
  });

  it('marca o cadastro preliminar — e o sinal que a fila do dia mostra', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'preliminar' }));
    expect(r[0]?.cadastroStatus).toBe('preliminar');
  });

  it('nao devolve paciente unificado em outro nem inativado', async () => {
    const r = await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'duplicata' }));
    expect(r).toEqual([]);
  });

  it('a busca por nome e evento auditavel — ver o nome ja e acesso a dado pessoal', async () => {
    await withTenantTx(actor, (tx) => searchPatients(tx, { termo: 'maria sou' }));
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event WHERE event_type = 'PATIENT_SEARCH'`));
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
