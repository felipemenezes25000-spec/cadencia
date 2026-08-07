// packages/tiss/src/contrato.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { semearTiss, type SementeTiss } from './test-support';
import {
  createContrato, updateContrato, deactivateContrato, listContratos,
  type CreateContratoInput,
} from './contrato';

let s: SementeTiss;
let actor: Actor;

beforeAll(async () => {
  s = await semearTiss();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createContrato — cria contrato operadora x prestador', () => {
  it('cria contrato com todos os campos', async () => {
    const input: CreateContratoInput = {
      operadoraId: s.operadoraId,
      clinicId: s.clinicId,
      codigoPrestadorNaOperadora: '900123',
      vigenciaInicio: '2026-01-01',
      tabelaPrecosRef: 'TUSS 2026.01',
    };
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.codigoPrestadorNaOperadora).toBe('900123');
    expect(r.value.vigenciaInicio).toBe('2026-01-01');
    expect(r.value.active).toBe(true);
  });

  it('recusa contrato duplicado para mesma operadora e clinica', async () => {
    const input: CreateContratoInput = {
      operadoraId: s.operadoraId,
      clinicId: s.clinicId,
      codigoPrestadorNaOperadora: '900999',
      vigenciaInicio: '2026-06-01',
    };
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('contrato_duplicado');
  });

  it('recusa contrato com operadora inexistente', async () => {
    const input: CreateContratoInput = {
      operadoraId: uuidv7(),
      clinicId: s.clinicId,
      codigoPrestadorNaOperadora: '800456',
      vigenciaInicio: '2026-01-01',
    };
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('operadora_nao_encontrada');
  });

  it('recusa vigencia_fim anterior a vigencia_inicio', async () => {
    const input: CreateContratoInput = {
      operadoraId: s.operadoraId,
      clinicId: s.clinicId,
      codigoPrestadorNaOperadora: '700789',
      vigenciaInicio: '2026-06-01',
      vigenciaFim: '2026-01-01',
    };
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('vigencia_invalida');
  });
});

describe('updateContrato — atualiza contrato', () => {
  let contratoId = '';

  beforeAll(async () => {
    // Criar nova operadora para ter contrato unico
    const opId = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '666666', 'Op Para Contrato Update', '22ABC33344DE55', $2)`,
        [opId, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, {
        operadoraId: opId,
        clinicId: s.clinicId,
        codigoPrestadorNaOperadora: '600111',
        vigenciaInicio: '2026-01-01',
      }, s.userId));
    if (r.ok) contratoId = r.value.id;
  });

  it('atualiza tabela de precos e observacao', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateContrato(tx, {
        id: contratoId,
        tabelaPrecosRef: 'TUSS 2026.07',
        observacao: 'Tabela negociada com desconto',
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tabelaPrecosRef).toBe('TUSS 2026.07');
    expect(r.value.observacao).toBe('Tabela negociada com desconto');
  });

  it('retorna erro para contrato inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updateContrato(tx, { id: uuidv7(), observacao: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('contrato_nao_encontrado');
  });
});

describe('deactivateContrato — desativa contrato', () => {
  let contratoId = '';

  beforeAll(async () => {
    const opId = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '777777', 'Op Para Contrato Deactivate', '33ABC44455DE66', $2)`,
        [opId, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createContrato(tx, {
        operadoraId: opId,
        clinicId: s.clinicId,
        codigoPrestadorNaOperadora: '500222',
        vigenciaInicio: '2026-01-01',
      }, s.userId));
    if (r.ok) contratoId = r.value.id;
  });

  it('desativa contrato ativo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateContrato(tx, contratoId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar contrato ja desativado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivateContrato(tx, contratoId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativado');
  });
});

describe('listContratos — lista contratos do tenant', () => {
  it('lista somente ativos por padrao', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listContratos(tx));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });
});
