### Task 6: CRUD de contrato e paciente_convenio no packages/tiss

**Arquivos**
- Criar: `packages/tiss/src/contrato.ts`
- Criar: `packages/tiss/src/contrato.int.test.ts`
- Criar: `packages/tiss/src/paciente-convenio.ts`
- Criar: `packages/tiss/src/paciente-convenio.int.test.ts`
- Criar: `packages/tiss/src/test-support.ts`
- Modificar: `packages/tiss/src/index.ts`

**Passos**

- [ ] Criar o helper de seed em `packages/tiss/src/test-support.ts`:

```typescript
// packages/tiss/src/test-support.ts
import { Pool } from 'pg';
import { uuidv7 } from '@cadencia/kernel';

export interface SementeTiss {
  tenantId: string;
  clinicId: string;
  userId: string;
  operadoraId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

export async function semearTiss(): Promise<SementeTiss> {
  const s: SementeTiss = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    operadoraId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Tiss Contrato', '66ABC77801DE99')`,
      [s.tenantId, `tc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Tiss Contrato', '6666666', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin Tiss Contrato')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
       VALUES ($1, $2, '555555', 'Operadora Seed', '88ABC99900DE11', $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}
```

- [ ] Escrever o teste que falha em `packages/tiss/src/contrato.int.test.ts`:

```typescript
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
```

- [ ] Rodar o teste e confirmar que falha porque o modulo `./contrato` nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/contrato.int.test.ts 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./contrato` nao encontrado.

- [ ] Implementar `packages/tiss/src/contrato.ts`:

```typescript
// packages/tiss/src/contrato.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ContratoFailure =
  | { kind: 'contrato_nao_encontrado' }
  | { kind: 'contrato_duplicado' }
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'clinica_nao_encontrada' }
  | { kind: 'vigencia_invalida' }
  | { kind: 'ja_desativado' };

export interface CreateContratoInput {
  readonly operadoraId: string;
  readonly clinicId: string;
  readonly codigoPrestadorNaOperadora: string;
  readonly tipoAcomodacao?: '1' | '2' | '3';
  readonly abrangencia?: 'nacional' | 'estadual' | 'grupo_estadual' | 'municipal';
  readonly vigenciaInicio: string;
  readonly vigenciaFim?: string;
  readonly tabelaPrecosRef?: string;
  readonly observacao?: string;
}

export interface ContratoRow {
  readonly id: string;
  readonly operadoraId: string;
  readonly clinicId: string;
  readonly codigoPrestadorNaOperadora: string;
  readonly tipoAcomodacao: string;
  readonly abrangencia: string;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly tabelaPrecosRef: string | null;
  readonly observacao: string | null;
  readonly active: boolean;
}

export interface UpdateContratoInput {
  readonly id: string;
  readonly codigoPrestadorNaOperadora?: string;
  readonly tipoAcomodacao?: '1' | '2' | '3';
  readonly abrangencia?: 'nacional' | 'estadual' | 'grupo_estadual' | 'municipal';
  readonly vigenciaFim?: string | null;
  readonly tabelaPrecosRef?: string | null;
  readonly observacao?: string | null;
}

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

export async function createContrato(
  tx: TxClient,
  i: CreateContratoInput,
  createdBy: string,
): Promise<Result<ContratoRow, ContratoFailure>> {
  if (i.vigenciaFim !== undefined && i.vigenciaFim < i.vigenciaInicio) {
    return err({ kind: 'vigencia_invalida' });
  }

  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO tiss.contrato
         (tenant_id, id, operadora_id, clinic_id, codigo_prestador_na_operadora,
          tipo_acomodacao, abrangencia, vigencia_inicio, vigencia_fim,
          tabela_precos_ref, observacao, created_by)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4,
               $5, $6, $7::date, $8::date,
               $9, $10, $11)`,
      [id, i.operadoraId, i.clinicId, i.codigoPrestadorNaOperadora,
       i.tipoAcomodacao ?? '1', i.abrangencia ?? 'nacional',
       i.vigenciaInicio, i.vigenciaFim ?? null,
       i.tabelaPrecosRef ?? null, i.observacao ?? null, createdBy]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && msg.includes('operadora_id')) {
      return err({ kind: 'contrato_duplicado' });
    }
    if (sqlState === '23503') {
      if (msg.includes('operadora')) {
        return err({ kind: 'operadora_nao_encontrada' });
      }
      if (msg.includes('clinic')) {
        return err({ kind: 'clinica_nao_encontrada' });
      }
    }
    throw e;
  }

  return ok({
    id,
    operadoraId: i.operadoraId,
    clinicId: i.clinicId,
    codigoPrestadorNaOperadora: i.codigoPrestadorNaOperadora,
    tipoAcomodacao: i.tipoAcomodacao ?? '1',
    abrangencia: i.abrangencia ?? 'nacional',
    vigenciaInicio: i.vigenciaInicio,
    vigenciaFim: i.vigenciaFim ?? null,
    tabelaPrecosRef: i.tabelaPrecosRef ?? null,
    observacao: i.observacao ?? null,
    active: true,
  });
}

export async function updateContrato(
  tx: TxClient,
  i: UpdateContratoInput,
): Promise<Result<ContratoRow, ContratoFailure>> {
  const { rows } = await tx.query<{
    id: string; operadora_id: string; clinic_id: string;
    codigo_prestador_na_operadora: string; tipo_acomodacao: string;
    abrangencia: string; vigencia_inicio: string; vigencia_fim: string | null;
    tabela_precos_ref: string | null; observacao: string | null; active: boolean;
  }>(
    `SELECT id::text, operadora_id::text, clinic_id::text,
            codigo_prestador_na_operadora, tipo_acomodacao, abrangencia,
            vigencia_inicio::text, vigencia_fim::text,
            tabela_precos_ref, observacao, active
       FROM tiss.contrato WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'contrato_nao_encontrado' });

  const codigoPrestadorNaOperadora = i.codigoPrestadorNaOperadora ?? existing.codigo_prestador_na_operadora;
  const tipoAcomodacao = i.tipoAcomodacao ?? existing.tipo_acomodacao;
  const abrangencia = i.abrangencia ?? existing.abrangencia;
  const vigenciaFim = i.vigenciaFim !== undefined ? i.vigenciaFim : existing.vigencia_fim;
  const tabelaPrecosRef = i.tabelaPrecosRef !== undefined ? i.tabelaPrecosRef : existing.tabela_precos_ref;
  const observacao = i.observacao !== undefined ? i.observacao : existing.observacao;

  await tx.query(
    `UPDATE tiss.contrato
        SET codigo_prestador_na_operadora = $2,
            tipo_acomodacao = $3, abrangencia = $4,
            vigencia_fim = $5::date, tabela_precos_ref = $6,
            observacao = $7
      WHERE id = $1`,
    [i.id, codigoPrestadorNaOperadora, tipoAcomodacao, abrangencia,
     vigenciaFim, tabelaPrecosRef, observacao]);

  return ok({
    id: existing.id,
    operadoraId: existing.operadora_id,
    clinicId: existing.clinic_id,
    codigoPrestadorNaOperadora,
    tipoAcomodacao,
    abrangencia,
    vigenciaInicio: existing.vigencia_inicio,
    vigenciaFim,
    tabelaPrecosRef,
    observacao,
    active: existing.active,
  });
}

export async function deactivateContrato(
  tx: TxClient,
  contratoId: string,
): Promise<Result<{ id: string }, ContratoFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM tiss.contrato WHERE id = $1`, [contratoId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'contrato_nao_encontrado' });
  if (!existing.active) return err({ kind: 'ja_desativado' });

  await tx.query(
    `UPDATE tiss.contrato SET active = false WHERE id = $1`,
    [contratoId]);

  return ok({ id: contratoId });
}

export async function listContratos(
  tx: TxClient,
  onlyActive: boolean = true,
): Promise<ContratoRow[]> {
  const whereActive = onlyActive ? 'AND c.active = true' : '';
  const { rows } = await tx.query<{
    id: string; operadora_id: string; clinic_id: string;
    codigo_prestador_na_operadora: string; tipo_acomodacao: string;
    abrangencia: string; vigencia_inicio: string; vigencia_fim: string | null;
    tabela_precos_ref: string | null; observacao: string | null; active: boolean;
  }>(
    `SELECT c.id::text, c.operadora_id::text, c.clinic_id::text,
            c.codigo_prestador_na_operadora, c.tipo_acomodacao, c.abrangencia,
            c.vigencia_inicio::text, c.vigencia_fim::text,
            c.tabela_precos_ref, c.observacao, c.active
       FROM tiss.contrato c
      WHERE 1=1 ${whereActive}
      ORDER BY c.created_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    operadoraId: r.operadora_id,
    clinicId: r.clinic_id,
    codigoPrestadorNaOperadora: r.codigo_prestador_na_operadora,
    tipoAcomodacao: r.tipo_acomodacao,
    abrangencia: r.abrangencia,
    vigenciaInicio: r.vigencia_inicio,
    vigenciaFim: r.vigencia_fim,
    tabelaPrecosRef: r.tabela_precos_ref,
    observacao: r.observacao,
    active: r.active,
  }));
}
```

- [ ] Rodar o teste de contrato e confirmar que todos passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/contrato.int.test.ts
```

Saida esperada: todos os testes de contrato passam.

- [ ] Escrever o teste que falha em `packages/tiss/src/paciente-convenio.int.test.ts`:

```typescript
// packages/tiss/src/paciente-convenio.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import {
  createPacienteConvenio, updatePacienteConvenio,
  deactivatePacienteConvenio, listPacienteConvenios,
  type CreatePacienteConvenioInput,
} from './paciente-convenio';

interface SementePC {
  tenantId: string; clinicId: string; userId: string;
  operadoraId: string; patientId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearPC(): Promise<SementePC> {
  const s: SementePC = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    operadoraId: uuidv7(), patientId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Tiss PacConv', '88ABC99012DE33')`,
      [s.tenantId, `pc-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Tiss PacConv', '8888888', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Admin PacConv')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'admin_clinico')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO tiss.operadora
         (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
       VALUES ($1, $2, '888888', 'Operadora PacConv', '99ABC00011DE22', $3)`,
      [s.tenantId, s.operadoraId, s.userId]);
    await c.query(
      `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
       VALUES ($1, $2, 'Paciente Convenio Teste', 'completo')`,
      [s.tenantId, s.patientId]);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await admin.end();
  }
  return s;
}

let s: SementePC;
let actor: Actor;

beforeAll(async () => {
  s = await semearPC();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});

afterAll(async () => { await closePools(); });

describe('createPacienteConvenio — vincula paciente a operadora', () => {
  it('cria vinculo titular com todos os campos', async () => {
    const input: CreatePacienteConvenioInput = {
      patientId: s.patientId,
      operadoraId: s.operadoraId,
      numeroCarteira: '00112233445566',
      validade: '2027-12-31',
      nomePlano: 'Plano Essencial',
      tipoBeneficiario: 'T',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.numeroCarteira).toBe('00112233445566');
    expect(r.value.tipoBeneficiario).toBe('T');
    expect(r.value.active).toBe(true);
  });

  it('cria vinculo dependente com dados do titular', async () => {
    const patientDep = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Dependente Teste', 'completo')`,
        [patientDep]));

    const input: CreatePacienteConvenioInput = {
      patientId: patientDep,
      operadoraId: s.operadoraId,
      numeroCarteira: '99887766554433',
      tipoBeneficiario: 'D',
      titularNome: 'Paciente Convenio Teste',
      titularCarteira: '00112233445566',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tipoBeneficiario).toBe('D');
    expect(r.value.titularNome).toBe('Paciente Convenio Teste');
  });

  it('recusa dependente sem nome do titular', async () => {
    const patientDep2 = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Dep Sem Titular', 'completo')`,
        [patientDep2]));

    const input: CreatePacienteConvenioInput = {
      patientId: patientDep2,
      operadoraId: s.operadoraId,
      numeroCarteira: '77665544332211',
      tipoBeneficiario: 'D',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('dependente_sem_titular');
  });

  it('recusa carteirinha duplicada na mesma operadora', async () => {
    const input: CreatePacienteConvenioInput = {
      patientId: s.patientId,
      operadoraId: s.operadoraId,
      numeroCarteira: '00112233445566',
    };
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, input, s.userId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('carteira_duplicada');
  });
});

describe('updatePacienteConvenio — atualiza vinculo', () => {
  let pcId = '';

  beforeAll(async () => {
    const patientUpd = uuidv7();
    const opUpd = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Pac Para Update Conv', 'completo')`,
        [patientUpd]));
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '999999', 'Op Para Update Conv', '11ABC22233DE99', $2)`,
        [opUpd, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, {
        patientId: patientUpd,
        operadoraId: opUpd,
        numeroCarteira: '55443322110099',
      }, s.userId));
    if (r.ok) pcId = r.value.id;
  });

  it('atualiza validade e nome do plano', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updatePacienteConvenio(tx, {
        id: pcId,
        validade: '2028-06-30',
        nomePlano: 'Plano Premium',
      }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.validade).toBe('2028-06-30');
    expect(r.value.nomePlano).toBe('Plano Premium');
  });

  it('retorna erro para vinculo inexistente', async () => {
    const r = await withTenantTx(actor, (tx) =>
      updatePacienteConvenio(tx, { id: uuidv7(), nomePlano: 'Fantasma' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('vinculo_nao_encontrado');
  });
});

describe('deactivatePacienteConvenio — desativa vinculo', () => {
  let pcId = '';

  beforeAll(async () => {
    const patientDeact = uuidv7();
    const opDeact = uuidv7();
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO clin.patient (tenant_id, id, full_name, cadastro_status)
         VALUES (app.require_tenant_id(), $1, 'Pac Para Deact Conv', 'completo')`,
        [patientDeact]));
    await withTenantTx(actor, (tx) =>
      tx.query(
        `INSERT INTO tiss.operadora
           (tenant_id, id, registro_ans, razao_social, cnpj, created_by)
         VALUES (app.require_tenant_id(), $1, '123456', 'Op Para Deact Conv', '44ABC55566DE77', $2)`,
        [opDeact, s.userId]));
    const r = await withTenantTx(actor, (tx) =>
      createPacienteConvenio(tx, {
        patientId: patientDeact,
        operadoraId: opDeact,
        numeroCarteira: '66554433221100',
      }, s.userId));
    if (r.ok) pcId = r.value.id;
  });

  it('desativa vinculo ativo', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivatePacienteConvenio(tx, pcId));
    expect(r.ok).toBe(true);
  });

  it('recusa desativar vinculo ja desativado', async () => {
    const r = await withTenantTx(actor, (tx) =>
      deactivatePacienteConvenio(tx, pcId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('ja_desativado');
  });
});

describe('listPacienteConvenios — lista convenios do paciente', () => {
  it('lista somente ativos por padrao', async () => {
    const lista = await withTenantTx(actor, (tx) =>
      listPacienteConvenios(tx, s.patientId));
    expect(lista.length).toBeGreaterThanOrEqual(1);
    for (const item of lista) {
      expect(item.active).toBe(true);
    }
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo `./paciente-convenio` nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/paciente-convenio.int.test.ts 2>&1 | head -20
```

Saida esperada: erro de importacao — modulo `./paciente-convenio` nao encontrado.

- [ ] Implementar `packages/tiss/src/paciente-convenio.ts`:

```typescript
// packages/tiss/src/paciente-convenio.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type PacienteConvenioFailure =
  | { kind: 'vinculo_nao_encontrado' }
  | { kind: 'carteira_duplicada' }
  | { kind: 'operadora_nao_encontrada' }
  | { kind: 'paciente_nao_encontrado' }
  | { kind: 'dependente_sem_titular' }
  | { kind: 'ja_desativado' };

export interface CreatePacienteConvenioInput {
  readonly patientId: string;
  readonly operadoraId: string;
  readonly numeroCarteira: string;
  readonly validade?: string;
  readonly nomePlano?: string;
  readonly tipoBeneficiario?: 'T' | 'D';
  readonly titularNome?: string;
  readonly titularCarteira?: string;
}

export interface PacienteConvenioRow {
  readonly id: string;
  readonly patientId: string;
  readonly operadoraId: string;
  readonly numeroCarteira: string;
  readonly validade: string | null;
  readonly nomePlano: string | null;
  readonly tipoBeneficiario: string;
  readonly titularNome: string | null;
  readonly titularCarteira: string | null;
  readonly active: boolean;
}

export interface UpdatePacienteConvenioInput {
  readonly id: string;
  readonly numeroCarteira?: string;
  readonly validade?: string | null;
  readonly nomePlano?: string | null;
  readonly tipoBeneficiario?: 'T' | 'D';
  readonly titularNome?: string | null;
  readonly titularCarteira?: string | null;
}

// ---------------------------------------------------------------------------
// Operacoes
// ---------------------------------------------------------------------------

export async function createPacienteConvenio(
  tx: TxClient,
  i: CreatePacienteConvenioInput,
  createdBy: string,
): Promise<Result<PacienteConvenioRow, PacienteConvenioFailure>> {
  const tipo = i.tipoBeneficiario ?? 'T';

  if (tipo === 'D' && (i.titularNome === undefined || i.titularNome === null)) {
    return err({ kind: 'dependente_sem_titular' });
  }

  const id = uuidv7();

  try {
    await tx.query(
      `INSERT INTO tiss.paciente_convenio
         (tenant_id, id, patient_id, operadora_id, numero_carteira,
          validade, nome_plano, tipo_beneficiario,
          titular_nome, titular_carteira, created_by)
       VALUES (app.require_tenant_id(), $1, $2, $3, $4,
               $5::date, $6, $7,
               $8, $9, $10)`,
      [id, i.patientId, i.operadoraId, i.numeroCarteira,
       i.validade ?? null, i.nomePlano ?? null, tipo,
       i.titularNome ?? null, i.titularCarteira ?? null, createdBy]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && msg.includes('numero_carteira')) {
      return err({ kind: 'carteira_duplicada' });
    }
    if (sqlState === '23503') {
      if (msg.includes('operadora')) {
        return err({ kind: 'operadora_nao_encontrada' });
      }
      if (msg.includes('patient')) {
        return err({ kind: 'paciente_nao_encontrado' });
      }
    }
    throw e;
  }

  return ok({
    id,
    patientId: i.patientId,
    operadoraId: i.operadoraId,
    numeroCarteira: i.numeroCarteira,
    validade: i.validade ?? null,
    nomePlano: i.nomePlano ?? null,
    tipoBeneficiario: tipo,
    titularNome: i.titularNome ?? null,
    titularCarteira: i.titularCarteira ?? null,
    active: true,
  });
}

export async function updatePacienteConvenio(
  tx: TxClient,
  i: UpdatePacienteConvenioInput,
): Promise<Result<PacienteConvenioRow, PacienteConvenioFailure>> {
  const { rows } = await tx.query<{
    id: string; patient_id: string; operadora_id: string;
    numero_carteira: string; validade: string | null;
    nome_plano: string | null; tipo_beneficiario: string;
    titular_nome: string | null; titular_carteira: string | null;
    active: boolean;
  }>(
    `SELECT id::text, patient_id::text, operadora_id::text,
            numero_carteira, validade::text, nome_plano, tipo_beneficiario,
            titular_nome, titular_carteira, active
       FROM tiss.paciente_convenio WHERE id = $1`, [i.id]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'vinculo_nao_encontrado' });

  const numeroCarteira = i.numeroCarteira ?? existing.numero_carteira;
  const validade = i.validade !== undefined ? i.validade : existing.validade;
  const nomePlano = i.nomePlano !== undefined ? i.nomePlano : existing.nome_plano;
  const tipoBeneficiario = i.tipoBeneficiario ?? existing.tipo_beneficiario;
  const titularNome = i.titularNome !== undefined ? i.titularNome : existing.titular_nome;
  const titularCarteira = i.titularCarteira !== undefined ? i.titularCarteira : existing.titular_carteira;

  try {
    await tx.query(
      `UPDATE tiss.paciente_convenio
          SET numero_carteira = $2, validade = $3::date, nome_plano = $4,
              tipo_beneficiario = $5, titular_nome = $6, titular_carteira = $7
        WHERE id = $1`,
      [i.id, numeroCarteira, validade, nomePlano,
       tipoBeneficiario, titularNome, titularCarteira]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    const sqlState = (e as { code?: string }).code;
    if (sqlState === '23505' && msg.includes('numero_carteira')) {
      return err({ kind: 'carteira_duplicada' });
    }
    throw e;
  }

  return ok({
    id: existing.id,
    patientId: existing.patient_id,
    operadoraId: existing.operadora_id,
    numeroCarteira,
    validade,
    nomePlano,
    tipoBeneficiario,
    titularNome,
    titularCarteira,
    active: existing.active,
  });
}

export async function deactivatePacienteConvenio(
  tx: TxClient,
  pcId: string,
): Promise<Result<{ id: string }, PacienteConvenioFailure>> {
  const { rows } = await tx.query<{ active: boolean }>(
    `SELECT active FROM tiss.paciente_convenio WHERE id = $1`, [pcId]);
  const existing = rows[0];
  if (!existing) return err({ kind: 'vinculo_nao_encontrado' });
  if (!existing.active) return err({ kind: 'ja_desativado' });

  await tx.query(
    `UPDATE tiss.paciente_convenio SET active = false WHERE id = $1`,
    [pcId]);

  return ok({ id: pcId });
}

export async function listPacienteConvenios(
  tx: TxClient,
  patientId: string,
  onlyActive: boolean = true,
): Promise<PacienteConvenioRow[]> {
  const whereActive = onlyActive ? 'AND pc.active = true' : '';
  const { rows } = await tx.query<{
    id: string; patient_id: string; operadora_id: string;
    numero_carteira: string; validade: string | null;
    nome_plano: string | null; tipo_beneficiario: string;
    titular_nome: string | null; titular_carteira: string | null;
    active: boolean;
  }>(
    `SELECT pc.id::text, pc.patient_id::text, pc.operadora_id::text,
            pc.numero_carteira, pc.validade::text, pc.nome_plano,
            pc.tipo_beneficiario, pc.titular_nome, pc.titular_carteira,
            pc.active
       FROM tiss.paciente_convenio pc
      WHERE pc.patient_id = $1 ${whereActive}
      ORDER BY pc.created_at DESC`,
    [patientId]);
  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient_id,
    operadoraId: r.operadora_id,
    numeroCarteira: r.numero_carteira,
    validade: r.validade,
    nomePlano: r.nome_plano,
    tipoBeneficiario: r.tipo_beneficiario,
    titularNome: r.titular_nome,
    titularCarteira: r.titular_carteira,
    active: r.active,
  }));
}
```

- [ ] Rodar o teste de paciente-convenio e confirmar que todos passam:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run src/paciente-convenio.int.test.ts
```

Saida esperada: todos os testes de paciente-convenio passam.

- [ ] Atualizar `packages/tiss/src/index.ts` para exportar todos os modulos:

```typescript
export {
  createOperadora,
  updateOperadora,
  deactivateOperadora,
  listOperadoras,
  type CreateOperadoraInput,
  type UpdateOperadoraInput,
  type OperadoraRow,
  type OperadoraFailure,
} from './operadora';

export {
  createContrato,
  updateContrato,
  deactivateContrato,
  listContratos,
  type CreateContratoInput,
  type UpdateContratoInput,
  type ContratoRow,
  type ContratoFailure,
} from './contrato';

export {
  createPacienteConvenio,
  updatePacienteConvenio,
  deactivatePacienteConvenio,
  listPacienteConvenios,
  type CreatePacienteConvenioInput,
  type UpdatePacienteConvenioInput,
  type PacienteConvenioRow,
  type PacienteConvenioFailure,
} from './paciente-convenio';
```

- [ ] Rodar todos os testes do pacote tiss de uma vez:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm --filter @cadencia/tiss exec vitest run
```

Saida esperada: todos os testes passam.

- [ ] Commitar:

```
feat(tiss): add contrato and paciente_convenio CRUD with integration tests
```

---