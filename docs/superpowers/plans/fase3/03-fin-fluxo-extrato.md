### Task 13: Migration 0092 — tabela `fin.transfer` e audit keys unificadas [RECONCILIADO]

**Arquivos**

- Criar `packages/db/migrations/0092_fin_transfer.sql`
- Teste `packages/db/src/invariants/bank-account.int.test.ts`

**Por que:** [RECONCILIADO] A tabela `fin.bank_account` e a coluna `bank_account_id` em `fin.entry` ja sao criadas pelo Bloco 01 (migrations 0086-0087). Esta migration cria apenas `fin.transfer` e atualiza `audit.meta_keys_ok` com a uniao de todas as chaves (Bloco 02 + Bloco 03). O saldo e DERIVADO (`SUM(amount_cents)` sobre entries vinculadas), nunca campo atualizado.

- [ ] Criar o arquivo de migration `packages/db/migrations/0092_fin_transfer.sql` com o conteudo completo:

```sql
-- 0092_fin_transfer.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- [RECONCILIADO] fin.bank_account e bank_account_id em fin.entry ja existem
-- desde as migrations 0086 e 0087 (Bloco 01). Esta migration so cria
-- fin.transfer e atualiza audit.meta_keys_ok com as chaves de transferencia.

-- ---------------------------------------------------------------------------
-- 1. Tabela de transferencia entre contas
-- ---------------------------------------------------------------------------
CREATE TABLE fin.transfer (
  tenant_id             uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                    uuid NOT NULL,
  from_bank_account_id  uuid NOT NULL,
  to_bank_account_id    uuid NOT NULL,
  amount_cents          bigint NOT NULL CHECK (amount_cents > 0),
  transferred_at        timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  description           text NOT NULL COLLATE "pt-BR-x-icu",
  debit_entry_id        uuid NOT NULL,
  credit_entry_id       uuid NOT NULL,
  created_by            uuid,
  created_at            timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, from_bank_account_id)
    REFERENCES fin.bank_account(tenant_id, id),
  FOREIGN KEY (tenant_id, to_bank_account_id)
    REFERENCES fin.bank_account(tenant_id, id),
  FOREIGN KEY (tenant_id, debit_entry_id)
    REFERENCES fin.entry(tenant_id, id),
  FOREIGN KEY (tenant_id, credit_entry_id)
    REFERENCES fin.entry(tenant_id, id),
  CHECK (from_bank_account_id <> to_bank_account_id)
);
ALTER TABLE fin.transfer OWNER TO app_owner;
GRANT SELECT, INSERT ON fin.transfer TO app_rw;

ALTER TABLE fin.transfer ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin.transfer FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fin.transfer AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- ---------------------------------------------------------------------------
-- 2. Whitelist de chaves de auditoria — MERGE de Bloco 02 (0091) + transferencia
-- [RECONCILIADO] Esta versao inclui TODAS as chaves de 0091 (recorrencia/
-- parcelamento/fornecedor) mais as novas de transferencia. Como e CREATE OR
-- REPLACE, a ultima migration a rodar (0092) prevalece — por isso deve ter
-- a uniao de tudo.
-- ---------------------------------------------------------------------------
SET ROLE audit_owner;

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
              'reason',
              'route',
              'method',
              'status_code',
              'duration_ms',
              'use_case',
              'record_count',
              'version_no',
              'kind',
              'role',
              'grant_id',
              'horas',
              'geradas',
              'puladas',
              'freq',
              'encaixe',
              'pendencias',
              'status',
              'ticket',
              'export_id',
              'batch_id',
              'job_name',
              'seal_date',
              'error_code',
              'mfa_method',
              'device_id',
              'standard',
              'verificacao',
              'motivo',
              'paginas',
              'qualidade',
              'ms',
              'provedor',
              'itens',
              'assinatura_valida',
              'acao',
              'amount_cents',
              'payment_method',
              'receipt_number',
              'frequency',
              'total_installments',
              'generated_entries',
              'template_id',
              'supplier_name',
              'from_account',
              'to_account',
              'transfer_id'
            )
         );
$$;

RESET ROLE;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0092 aplicada com sucesso.

- [ ] Criar o arquivo de teste `packages/db/src/invariants/bank-account.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';

interface SementeConta {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  bankAccountCaixaId: string;
  bankAccountBancoId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearConta(): Promise<SementeConta> {
  const s: SementeConta = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(),
    bankAccountCaixaId: uuidv7(), bankAccountBancoId: uuidv7(),
    paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Conta', '11ABC22301DE44')`,
      [s.tenantId, `ba-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade BA', '1112233', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario BA')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '999888', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
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

let s: SementeConta;
let actor: Actor;

beforeAll(async () => {
  s = await semearConta();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  await withTenantTx(actor, async (tx) => {
    await tx.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES (app.require_tenant_id(), $1, 'Caixa Interno', 'caixa'),
              (app.require_tenant_id(), $2, 'Banco do Brasil', 'banco')`,
      [s.bankAccountCaixaId, s.bankAccountBancoId]);
    await tx.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES (app.require_tenant_id(), $1, 'dinheiro', 'Dinheiro')`,
      [s.paymentMethodId]);
  });
});

afterAll(async () => { await closePools(); });

describe('schema fin.bank_account — RLS e constraints', () => {
  it('insere e le conta bancaria com RLS ativa', async () => {
    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ name: string; kind: string }>(
        `SELECT name, kind FROM fin.bank_account WHERE id = $1`,
        [s.bankAccountCaixaId]));
    expect(rows[0]).toEqual({ name: 'Caixa Interno', kind: 'caixa' });
  });

  it('rejeita nome duplicado no mesmo tenant', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
           VALUES (app.require_tenant_id(), $1, 'Caixa Interno', 'caixa')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });

  it('rejeita kind invalido', async () => {
    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
           VALUES (app.require_tenant_id(), $1, 'Invalido', 'poupanca')`,
          [uuidv7()])),
    ).rejects.toThrow();
  });
});

describe('schema fin.transfer — constraints', () => {
  it('rejeita transferencia para a mesma conta', async () => {
    const debitId = uuidv7();
    const creditId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, paid_at)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Debito teste', 10000, $4, 'pago', $5, $6, clock_timestamp()),
                (app.require_tenant_id(), $7, 'receita', $2, $3,
                 'Credito teste', 10000, $4, 'pago', $8, $9, clock_timestamp())`,
        [debitId, s.professionalId, s.clinicId, s.paymentMethodId,
         `deb-${debitId}`, s.bankAccountCaixaId,
         creditId, `cre-${creditId}`, s.bankAccountCaixaId]);
    });

    await expect(
      withTenantTx(actor, (tx) =>
        tx.query(
          `INSERT INTO fin.transfer
             (tenant_id, id, from_bank_account_id, to_bank_account_id,
              amount_cents, description, debit_entry_id, credit_entry_id,
              created_by)
           VALUES (app.require_tenant_id(), $1, $2, $2,
                   10000, 'Mesma conta', $3, $4, app.current_user_id())`,
          [uuidv7(), s.bankAccountCaixaId, debitId, creditId])),
    ).rejects.toThrow();
  });

  it('insere transferencia valida entre contas', async () => {
    const debitId = uuidv7();
    const creditId = uuidv7();
    const transferId = uuidv7();

    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, paid_at)
         VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
                 'Transferencia saida', 5000, $4, 'pago', $5, $6, clock_timestamp()),
                (app.require_tenant_id(), $7, 'receita', $2, $3,
                 'Transferencia entrada', 5000, $4, 'pago', $8, $9, clock_timestamp())`,
        [debitId, s.professionalId, s.clinicId, s.paymentMethodId,
         `deb-${debitId}`, s.bankAccountCaixaId,
         creditId, `cre-${creditId}`, s.bankAccountBancoId]);

      await tx.query(
        `INSERT INTO fin.transfer
           (tenant_id, id, from_bank_account_id, to_bank_account_id,
            amount_cents, description, debit_entry_id, credit_entry_id,
            created_by)
         VALUES (app.require_tenant_id(), $1, $2, $3,
                 5000, 'Deposito', $4, $5, app.current_user_id())`,
        [transferId, s.bankAccountCaixaId, s.bankAccountBancoId,
         debitId, creditId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ amount_cents: string; description: string }>(
        `SELECT amount_cents::text, description FROM fin.transfer WHERE id = $1`,
        [transferId]));
    expect(rows[0]).toEqual({ amount_cents: '5000', description: 'Deposito' });
  });
});

describe('fin.entry — bank_account_id e nullable e funcional', () => {
  it('aceita lancamento sem bank_account_id (retrocompativel)', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Sem conta', 3000, $4, 'pendente', $5)`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `nobank-${entryId}`]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string | null }>(
        `SELECT bank_account_id::text FROM fin.entry WHERE id = $1`,
        [entryId]));
    expect(rows[0]?.bank_account_id).toBeNull();
  });

  it('aceita lancamento com bank_account_id', async () => {
    const entryId = uuidv7();
    await withTenantTx(actor, async (tx) => {
      await tx.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, professional_id, clinic_id, description,
            amount_cents, payment_method_id, status, idempotency_key,
            bank_account_id, paid_at)
         VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
                 'Com conta', 4000, $4, 'pago', $5, $6, clock_timestamp())`,
        [entryId, s.professionalId, s.clinicId, s.paymentMethodId,
         `withbank-${entryId}`, s.bankAccountCaixaId]);
    });

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ bank_account_id: string }>(
        `SELECT bank_account_id::text FROM fin.entry WHERE id = $1`,
        [entryId]));
    expect(rows[0]?.bank_account_id).toBe(s.bankAccountCaixaId);
  });
});
```

- [ ] Rodar o teste e confirmar que passa:

```bash
pnpm vitest run packages/db/src/invariants/bank-account.int.test.ts
```

Saida esperada: todos os testes passam (8 testes).

- [ ] Commitar:

```bash
git add packages/db/migrations/0092_fin_transfer.sql \
       packages/db/src/invariants/bank-account.int.test.ts
git commit -m "feat(db): add fin.bank_account table and bank_account_id on fin.entry (0092)"
```

---

### Task 14: Domain — `createTransfer` em `packages/payments`

**Arquivos**

- Criar `packages/payments/src/transfer.ts`
- Modificar `packages/payments/src/index.ts`
- Teste `packages/payments/src/transfer.int.test.ts`

**Por que:** Transferencia entre contas gera DOIS `fin.entry` vinculados (um debito na conta de origem e um credito na conta de destino) e um registro em `fin.transfer`. O saldo nunca e atualizado diretamente — permanece derivado.

- [ ] Criar o teste `packages/payments/src/transfer.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { createTransfer, type CreateTransferInput } from './transfer';
import { Pool } from 'pg';

interface SementeTransfer {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  bankAccountCaixaId: string;
  bankAccountBancoId: string;
  paymentMethodId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearTransfer(): Promise<SementeTransfer> {
  const s: SementeTransfer = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(),
    bankAccountCaixaId: uuidv7(), bankAccountBancoId: uuidv7(),
    paymentMethodId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Transfer', '44ABC55601DE77')`,
      [s.tenantId, `tf-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade TF', '4455667', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario TF')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '777666', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Caixa TF', 'caixa'),
              ($1, $3, 'Banco TF', 'banco')`,
      [s.tenantId, s.bankAccountCaixaId, s.bankAccountBancoId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro TF')`,
      [s.tenantId, s.paymentMethodId]);
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

let s: SementeTransfer;
let actor: Actor;

beforeAll(async () => {
  s = await semearTransfer();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('createTransfer — transferencia entre contas', () => {
  it('cria transferencia e gera dois entries vinculados', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: s.bankAccountBancoId,
      amountCents: 15000,
      description: 'Deposito bancario',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.transferId).toBeDefined();
    expect(r.value.debitEntryId).toBeDefined();
    expect(r.value.creditEntryId).toBeDefined();

    // Verificar que os dois entries existem
    const { rows: entries } = await withTenantTx(actor, (tx) =>
      tx.query<{ id: string; kind: string; bank_account_id: string; amount_cents: string }>(
        `SELECT id, kind::text, bank_account_id::text, amount_cents::text
           FROM fin.entry
          WHERE id IN ($1, $2) ORDER BY kind`,
        [r.value.debitEntryId, r.value.creditEntryId]));

    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.kind === 'despesa');
    const credit = entries.find((e) => e.kind === 'receita');

    expect(debit).toBeDefined();
    expect(debit!.bank_account_id).toBe(s.bankAccountCaixaId);
    expect(debit!.amount_cents).toBe('15000');

    expect(credit).toBeDefined();
    expect(credit!.bank_account_id).toBe(s.bankAccountBancoId);
    expect(credit!.amount_cents).toBe('15000');

    // Verificar que o transfer existe
    const { rows: transfers } = await withTenantTx(actor, (tx) =>
      tx.query<{ from_bank_account_id: string; to_bank_account_id: string }>(
        `SELECT from_bank_account_id::text, to_bank_account_id::text
           FROM fin.transfer WHERE id = $1`,
        [r.value.transferId]));
    expect(transfers[0]?.from_bank_account_id).toBe(s.bankAccountCaixaId);
    expect(transfers[0]?.to_bank_account_id).toBe(s.bankAccountBancoId);
  });

  it('rejeita conta de origem inexistente', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: uuidv7(),
      toBankAccountId: s.bankAccountBancoId,
      amountCents: 5000,
      description: 'Conta fantasma',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_origem_nao_encontrada');
  });

  it('rejeita conta de destino inexistente', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: uuidv7(),
      amountCents: 5000,
      description: 'Conta destino fantasma',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('conta_destino_nao_encontrada');
  });

  it('rejeita transferencia para a mesma conta', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: s.bankAccountCaixaId,
      amountCents: 5000,
      description: 'Mesma conta',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('mesma_conta');
  });

  it('grava evento de auditoria TRANSFER_CREATE', async () => {
    const input: CreateTransferInput = {
      fromBankAccountId: s.bankAccountCaixaId,
      toBankAccountId: s.bankAccountBancoId,
      amountCents: 8000,
      description: 'Auditoria transferencia',
      clinicId: s.clinicId,
      professionalId: s.professionalId,
    };

    const r = await withTenantTx(actor, (tx) => createTransfer(tx, input));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { rows } = await withTenantTx(actor, (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM audit.event
          WHERE event_type = 'TRANSFER_CREATE' AND entity_id = $1`,
        [r.value.transferId]));
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
```

- [ ] Rodar o teste e confirmar que FALHA (funcao ainda nao existe):

```bash
pnpm vitest run packages/payments/src/transfer.int.test.ts
```

Saida esperada: erro de compilacao — modulo `./transfer` nao encontrado.

- [ ] Criar o arquivo `packages/payments/src/transfer.ts`:

```typescript
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

export type TransferFailure =
  | { kind: 'conta_origem_nao_encontrada' }
  | { kind: 'conta_destino_nao_encontrada' }
  | { kind: 'mesma_conta' };

export interface CreateTransferInput {
  readonly fromBankAccountId: string;
  readonly toBankAccountId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly clinicId: string;
  readonly professionalId: string;
}

export interface TransferCreated {
  readonly transferId: string;
  readonly debitEntryId: string;
  readonly creditEntryId: string;
}

/**
 * Cria transferencia entre contas bancarias. Gera DOIS fin.entry vinculados:
 * - Um debito (kind='despesa') na conta de origem
 * - Um credito (kind='receita') na conta de destino
 *
 * O saldo de cada conta e DERIVADO de SUM(amount_cents) sobre entries da conta,
 * nunca e campo atualizado. Transferencia e a unica operacao que cria entries
 * sem patient_id e sem appointment_id.
 */
export async function createTransfer(
  tx: TxClient,
  i: CreateTransferInput,
): Promise<Result<TransferCreated, TransferFailure>> {
  if (i.fromBankAccountId === i.toBankAccountId) {
    return err({ kind: 'mesma_conta' });
  }

  // Verificar que a conta de origem existe
  const { rows: fromRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.bank_account WHERE id = $1`,
    [i.fromBankAccountId]);
  if (fromRows.length === 0) {
    return err({ kind: 'conta_origem_nao_encontrada' });
  }

  // Verificar que a conta de destino existe
  const { rows: toRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.bank_account WHERE id = $1`,
    [i.toBankAccountId]);
  if (toRows.length === 0) {
    return err({ kind: 'conta_destino_nao_encontrada' });
  }

  // Resolver metodo de pagamento 'transferencia_interna' (auto-provisiona)
  const { rows: pmRows } = await tx.query<{ id: string }>(
    `SELECT id FROM fin.payment_method
      WHERE kind = 'dinheiro'::fin.payment_method_kind LIMIT 1`);

  let paymentMethodId: string;
  if (pmRows.length > 0) {
    paymentMethodId = pmRows[0]!.id;
  } else {
    const newPmId = uuidv7();
    await tx.query(
      `INSERT INTO fin.payment_method (id, kind, name)
       VALUES ($1, 'dinheiro'::fin.payment_method_kind, 'Transferencia Interna')`,
      [newPmId]);
    paymentMethodId = newPmId;
  }

  const debitEntryId = uuidv7();
  const creditEntryId = uuidv7();
  const transferId = uuidv7();

  // Entry de debito na conta de origem (kind='despesa')
  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, professional_id, clinic_id, description,
        amount_cents, payment_method_id, status, idempotency_key,
        bank_account_id, paid_at, created_by)
     VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
             $4, $5, $6, 'pago', $7, $8, clock_timestamp(),
             app.current_user_id())`,
    [debitEntryId, i.professionalId, i.clinicId,
     i.description, i.amountCents, paymentMethodId,
     `transfer-deb:${transferId}`, i.fromBankAccountId]);

  // Entry de credito na conta de destino (kind='receita')
  await tx.query(
    `INSERT INTO fin.entry
       (tenant_id, id, kind, professional_id, clinic_id, description,
        amount_cents, payment_method_id, status, idempotency_key,
        bank_account_id, paid_at, created_by)
     VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
             $4, $5, $6, 'pago', $7, $8, clock_timestamp(),
             app.current_user_id())`,
    [creditEntryId, i.professionalId, i.clinicId,
     i.description, i.amountCents, paymentMethodId,
     `transfer-cre:${transferId}`, i.toBankAccountId]);

  // Registro da transferencia
  await tx.query(
    `INSERT INTO fin.transfer
       (tenant_id, id, from_bank_account_id, to_bank_account_id,
        amount_cents, description, debit_entry_id, credit_entry_id,
        created_by)
     VALUES (app.require_tenant_id(), $1, $2, $3,
             $4, $5, $6, $7, app.current_user_id())`,
    [transferId, i.fromBankAccountId, i.toBankAccountId,
     i.amountCents, i.description, debitEntryId, creditEntryId]);

  // Auditoria
  await tx.query(
    `SELECT audit.log('TRANSFER_CREATE', 'fin', 'transfer', $1, 'sucesso',
                      jsonb_build_object('amount_cents', $2::bigint,
                                         'from_account', $3::text,
                                         'to_account', $4::text,
                                         'transfer_id', $5::text), $6)`,
    [transferId, i.amountCents, i.fromBankAccountId,
     i.toBankAccountId, transferId, i.clinicId]);

  return ok({ transferId, debitEntryId, creditEntryId });
}
```

- [ ] Modificar `packages/payments/src/index.ts` para exportar `createTransfer`:

```typescript
export {
  recordPayment, cancelPayment, refundPayment,
  type CancelPaymentInput, type PaymentFailure, type RecordPaymentInput,
  type RecordedPayment, type RefundPaymentInput,
} from './record-payment';
export {
  materializeRollup, detectDivergence, refreshDailyRollup,
  type DivergenceRow, type RollupResult,
} from './rollup';
export { createPaymentLink, type CreatePaymentLinkInput, type PaymentLinkCreated } from './create-payment-link';
export { processPaymentWebhook, type WebhookPayload, type WebhookProcessed } from './process-webhook';
export { reconcileSettlements, type ReconcileInput, type ReconcileResult } from './reconcile';
export {
  createTransfer,
  type CreateTransferInput, type TransferCreated, type TransferFailure,
} from './transfer';
```

- [ ] Rodar o teste e confirmar que PASSA:

```bash
pnpm vitest run packages/payments/src/transfer.int.test.ts
```

Saida esperada: 4 testes passam.

- [ ] Commitar:

```bash
git add packages/payments/src/transfer.ts \
       packages/payments/src/transfer.int.test.ts \
       packages/payments/src/index.ts
git commit -m "feat(payments): add createTransfer domain function"
```

---

### Task 15: Domain — `getCashFlowProjection` em `packages/payments`

**Arquivos**

- Criar `packages/payments/src/cash-flow.ts`
- Modificar `packages/payments/src/index.ts`
- Teste `packages/payments/src/cash-flow.int.test.ts`

**Por que:** Fluxo de caixa projetado combina entries com paid_at (realizado) + entries com due_date futuro e status=pendente (projetado), agrupado por semana, com linha de saldo acumulado. Usa window function para calcular o acumulado.

- [ ] Criar o teste `packages/payments/src/cash-flow.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { getCashFlowProjection, type CashFlowInput } from './cash-flow';
import { Pool } from 'pg';

interface SementeCashFlow {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearCashFlow(): Promise<SementeCashFlow> {
  const s: SementeCashFlow = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica CF', '55ABC66701DE88')`,
      [s.tenantId, `cf-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade CF', '5566778', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario CF')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '555444', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix CF')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Caixa CF', 'caixa')`,
      [s.tenantId, s.bankAccountId]);
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

let s: SementeCashFlow;
let actor: Actor;

beforeAll(async () => {
  s = await semearCashFlow();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear lancamentos: um pago (realizado) e um pendente (projetado)
  await withTenantTx(actor, async (tx) => {
    // Receita paga ontem
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Consulta paga', 25000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '1 day')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `cf-paid-${uuidv7()}`, s.bankAccountId]);

    // Despesa paga ontem
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
               'Material', 5000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '1 day')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `cf-exp-${uuidv7()}`, s.bankAccountId]);

    // Receita pendente com vencimento em 10 dias (projetada)
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, due_date)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Retorno futuro', 18000, $4, 'pendente', $5, $6,
               current_date + 10)`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `cf-fut-${uuidv7()}`, s.bankAccountId]);
  });
});

afterAll(async () => { await closePools(); });

describe('getCashFlowProjection — fluxo de caixa projetado', () => {
  it('retorna semanas com realizado e projetado', async () => {
    const input: CashFlowInput = {
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 14 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 28 * 24 * 3600_000).toISOString().slice(0, 10),
      bankAccountId: s.bankAccountId,
    };

    const r = await withTenantTx(actor, (tx) => getCashFlowProjection(tx, input));

    expect(r.weeks.length).toBeGreaterThan(0);

    // Pelo menos uma semana deve ter receita realizada
    const temRealizado = r.weeks.some((w) => w.realizedInCents > 0 || w.realizedOutCents > 0);
    expect(temRealizado).toBe(true);

    // Pelo menos uma semana deve ter receita projetada
    const temProjetado = r.weeks.some((w) => w.projectedInCents > 0);
    expect(temProjetado).toBe(true);

    // Toda semana tem saldo acumulado
    for (const w of r.weeks) {
      expect(typeof w.cumulativeBalanceCents).toBe('number');
    }
  });

  it('retorna array vazio se nao ha lancamentos no periodo', async () => {
    const input: CashFlowInput = {
      clinicId: s.clinicId,
      fromDate: '2020-01-01',
      toDate: '2020-01-31',
    };

    const r = await withTenantTx(actor, (tx) => getCashFlowProjection(tx, input));
    expect(r.weeks).toHaveLength(0);
  });
});
```

- [ ] Rodar o teste e confirmar que FALHA:

```bash
pnpm vitest run packages/payments/src/cash-flow.int.test.ts
```

Saida esperada: erro de compilacao — modulo `./cash-flow` nao encontrado.

- [ ] Criar o arquivo `packages/payments/src/cash-flow.ts`:

```typescript
import type { TxClient } from '@cadencia/db';

export interface CashFlowInput {
  readonly clinicId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly bankAccountId?: string;
}

export interface CashFlowWeek {
  readonly weekStart: string;
  readonly realizedInCents: number;
  readonly realizedOutCents: number;
  readonly projectedInCents: number;
  readonly projectedOutCents: number;
  readonly netCents: number;
  readonly cumulativeBalanceCents: number;
}

export interface CashFlowProjection {
  readonly weeks: readonly CashFlowWeek[];
}

/**
 * Fluxo de caixa projetado. Combina:
 * - Entries com paid_at (realizado): receitas e despesas efetivamente pagas
 * - Entries com due_date futuro e status=pendente (projetado): receitas e despesas previstas
 *
 * Agrupado por semana (date_trunc('week', data)) com saldo acumulado via window function.
 * O filtro por bank_account_id e opcional: se ausente, mostra todos os lancamentos da clinica.
 */
export async function getCashFlowProjection(
  tx: TxClient,
  i: CashFlowInput,
): Promise<CashFlowProjection> {
  const bankFilter = i.bankAccountId !== undefined
    ? `AND e.bank_account_id = $4`
    : '';
  const params: unknown[] = [i.clinicId, i.fromDate, i.toDate];
  if (i.bankAccountId !== undefined) {
    params.push(i.bankAccountId);
  }

  const { rows } = await tx.query<{
    week_start: string;
    realized_in_cents: string;
    realized_out_cents: string;
    projected_in_cents: string;
    projected_out_cents: string;
    net_cents: string;
    cumulative_balance_cents: string;
  }>(
    `WITH base AS (
       -- Realizado: entries com paid_at no periodo
       SELECT
         date_trunc('week', e.paid_at)::date AS week_start,
         CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE 0 END AS realized_in,
         CASE WHEN e.kind = 'despesa' THEN e.amount_cents ELSE 0 END AS realized_out,
         0::bigint AS projected_in,
         0::bigint AS projected_out
       FROM fin.entry e
       WHERE e.clinic_id = $1
         AND e.paid_at IS NOT NULL
         AND e.paid_at >= $2::date
         AND e.paid_at < ($3::date + 1)
         AND e.status IN ('pago')
         ${bankFilter}

       UNION ALL

       -- Projetado: entries pendentes com due_date no periodo
       SELECT
         date_trunc('week', e.due_date)::date AS week_start,
         0::bigint AS realized_in,
         0::bigint AS realized_out,
         CASE WHEN e.kind = 'receita' THEN e.amount_cents ELSE 0 END AS projected_in,
         CASE WHEN e.kind = 'despesa' THEN e.amount_cents ELSE 0 END AS projected_out
       FROM fin.entry e
       WHERE e.clinic_id = $1
         AND e.status = 'pendente'
         AND e.due_date IS NOT NULL
         AND e.due_date >= $2::date
         AND e.due_date <= $3::date
         ${bankFilter}
     ),
     weekly AS (
       SELECT
         week_start,
         SUM(realized_in)::bigint AS realized_in_cents,
         SUM(realized_out)::bigint AS realized_out_cents,
         SUM(projected_in)::bigint AS projected_in_cents,
         SUM(projected_out)::bigint AS projected_out_cents,
         (SUM(realized_in) - SUM(realized_out)
          + SUM(projected_in) - SUM(projected_out))::bigint AS net_cents
       FROM base
       GROUP BY week_start
     )
     SELECT
       to_char(week_start, 'YYYY-MM-DD') AS week_start,
       realized_in_cents::text,
       realized_out_cents::text,
       projected_in_cents::text,
       projected_out_cents::text,
       net_cents::text,
       SUM(net_cents) OVER (ORDER BY week_start
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::text
         AS cumulative_balance_cents
     FROM weekly
     ORDER BY week_start`,
    params,
  );

  const weeks: CashFlowWeek[] = rows.map((r) => ({
    weekStart: r.week_start,
    realizedInCents: Number(r.realized_in_cents),
    realizedOutCents: Number(r.realized_out_cents),
    projectedInCents: Number(r.projected_in_cents),
    projectedOutCents: Number(r.projected_out_cents),
    netCents: Number(r.net_cents),
    cumulativeBalanceCents: Number(r.cumulative_balance_cents),
  }));

  return { weeks };
}
```

- [ ] Modificar `packages/payments/src/index.ts` para exportar `getCashFlowProjection`:

```typescript
export {
  recordPayment, cancelPayment, refundPayment,
  type CancelPaymentInput, type PaymentFailure, type RecordPaymentInput,
  type RecordedPayment, type RefundPaymentInput,
} from './record-payment';
export {
  materializeRollup, detectDivergence, refreshDailyRollup,
  type DivergenceRow, type RollupResult,
} from './rollup';
export { createPaymentLink, type CreatePaymentLinkInput, type PaymentLinkCreated } from './create-payment-link';
export { processPaymentWebhook, type WebhookPayload, type WebhookProcessed } from './process-webhook';
export { reconcileSettlements, type ReconcileInput, type ReconcileResult } from './reconcile';
export {
  createTransfer,
  type CreateTransferInput, type TransferCreated, type TransferFailure,
} from './transfer';
export {
  getCashFlowProjection,
  type CashFlowInput, type CashFlowProjection, type CashFlowWeek,
} from './cash-flow';
```

- [ ] Rodar o teste e confirmar que PASSA:

```bash
pnpm vitest run packages/payments/src/cash-flow.int.test.ts
```

Saida esperada: 2 testes passam.

- [ ] Commitar:

```bash
git add packages/payments/src/cash-flow.ts \
       packages/payments/src/cash-flow.int.test.ts \
       packages/payments/src/index.ts
git commit -m "feat(payments): add getCashFlowProjection domain function"
```

---

### Task 16: Domain — `getBankStatement` em `packages/payments`

**Arquivos**

- Criar `packages/payments/src/bank-statement.ts`
- Modificar `packages/payments/src/index.ts`
- Teste `packages/payments/src/bank-statement.int.test.ts`

**Por que:** Extrato por conta e uma query ordenada por data com saldo corrente via window function. O saldo da conta e DERIVADO (SUM sobre entries da conta), nunca campo atualizado.

- [ ] Criar o teste `packages/payments/src/bank-statement.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { getBankStatement, type BankStatementInput } from './bank-statement';
import { Pool } from 'pg';

interface SementeStatement {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
  otherAccountId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearStatement(): Promise<SementeStatement> {
  const s: SementeStatement = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(), otherAccountId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Extrato', '66ABC77801DE99')`,
      [s.tenantId, `st-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Extrato', '6677889', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario Ext')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '333222', 'RJ', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'dinheiro', 'Dinheiro Ext')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Caixa Extrato', 'caixa'),
              ($1, $3, 'Outra Conta', 'banco')`,
      [s.tenantId, s.bankAccountId, s.otherAccountId]);
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

let s: SementeStatement;
let actor: Actor;

beforeAll(async () => {
  s = await semearStatement();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear lancamentos na conta: 3 entries em sequencia
  await withTenantTx(actor, async (tx) => {
    // Receita 1 - paga ha 3 dias
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Consulta A', 30000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '3 days')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `st-1-${uuidv7()}`, s.bankAccountId]);

    // Despesa - paga ha 2 dias
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'despesa', $2, $3,
               'Material escritorio', 8000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '2 days')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `st-2-${uuidv7()}`, s.bankAccountId]);

    // Receita 2 - paga ha 1 dia
    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES (app.require_tenant_id(), $1, 'receita', $2, $3,
               'Consulta B', 20000, $4, 'pago', $5, $6,
               clock_timestamp() - interval '1 day')`,
      [uuidv7(), s.professionalId, s.clinicId, s.paymentMethodId,
       `st-3-${uuidv7()}`, s.bankAccountId]);
  });
});

afterAll(async () => { await closePools(); });

describe('getBankStatement — extrato por conta', () => {
  it('retorna linhas ordenadas por data com saldo corrente', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.bankAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));

    expect(r.lines.length).toBe(3);

    // Primeira linha: +30000 -> saldo = 30000
    expect(r.lines[0]!.amountCents).toBe(30000);
    expect(r.lines[0]!.kind).toBe('receita');
    expect(r.lines[0]!.runningBalanceCents).toBe(30000);

    // Segunda linha: -8000 -> saldo = 22000
    expect(r.lines[1]!.amountCents).toBe(8000);
    expect(r.lines[1]!.kind).toBe('despesa');
    expect(r.lines[1]!.runningBalanceCents).toBe(22000);

    // Terceira linha: +20000 -> saldo = 42000
    expect(r.lines[2]!.amountCents).toBe(20000);
    expect(r.lines[2]!.kind).toBe('receita');
    expect(r.lines[2]!.runningBalanceCents).toBe(42000);
  });

  it('retorna totalBalance igual ao ultimo saldo corrente', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.bankAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));
    expect(r.totalBalanceCents).toBe(42000);
  });

  it('retorna array vazio para conta sem lancamentos no periodo', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.otherAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));
    expect(r.lines).toHaveLength(0);
    expect(r.totalBalanceCents).toBe(0);
  });
});
```

- [ ] Rodar o teste e confirmar que FALHA:

```bash
pnpm vitest run packages/payments/src/bank-statement.int.test.ts
```

Saida esperada: erro de compilacao — modulo `./bank-statement` nao encontrado.

- [ ] Criar o arquivo `packages/payments/src/bank-statement.ts`:

```typescript
import type { TxClient } from '@cadencia/db';

export interface BankStatementInput {
  readonly bankAccountId: string;
  readonly clinicId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface StatementLine {
  readonly entryId: string;
  readonly kind: string;
  readonly description: string;
  readonly amountCents: number;
  readonly paidAt: string;
  readonly runningBalanceCents: number;
}

export interface BankStatement {
  readonly lines: readonly StatementLine[];
  readonly totalBalanceCents: number;
}

/**
 * Extrato por conta bancaria. Retorna linhas ordenadas por data de pagamento
 * com saldo corrente via window function. O saldo e DERIVADO — nunca campo
 * atualizado. Receitas somam, despesas subtraem.
 *
 * O saldo corrente (running balance) e calculado com:
 *   SUM(CASE WHEN kind='receita' THEN amount_cents ELSE -amount_cents END)
 *   OVER (ORDER BY paid_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
 *
 * A ordenacao inclui id para desempate determinista.
 */
export async function getBankStatement(
  tx: TxClient,
  i: BankStatementInput,
): Promise<BankStatement> {
  const limit = i.limit ?? 500;
  const params: unknown[] = [i.bankAccountId, i.clinicId, i.fromDate, i.toDate, limit + 1];

  let cursorFilter = '';
  if (i.cursor !== undefined) {
    cursorFilter = `AND e.paid_at > $6`;
    params.push(i.cursor);
  }

  const { rows } = await tx.query<{
    entry_id: string;
    kind: string;
    description: string;
    amount_cents: string;
    paid_at: string;
    running_balance_cents: string;
  }>(
    `SELECT
       e.id AS entry_id,
       e.kind::text,
       e.description,
       e.amount_cents::text,
       to_char(e.paid_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS paid_at,
       SUM(
         CASE WHEN e.kind = 'receita' THEN e.amount_cents
              ELSE -e.amount_cents END
       ) OVER (
         ORDER BY e.paid_at, e.id
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       )::text AS running_balance_cents
     FROM fin.entry e
     WHERE e.bank_account_id = $1
       AND e.clinic_id = $2
       AND e.paid_at IS NOT NULL
       AND e.paid_at >= $3::date
       AND e.paid_at < ($4::date + 1)
       AND e.status = 'pago'
       ${cursorFilter}
     ORDER BY e.paid_at, e.id
     LIMIT $5`,
    params,
  );

  const lines: StatementLine[] = rows.slice(0, limit).map((r) => ({
    entryId: r.entry_id,
    kind: r.kind,
    description: r.description,
    amountCents: Number(r.amount_cents),
    paidAt: r.paid_at,
    runningBalanceCents: Number(r.running_balance_cents),
  }));

  const totalBalanceCents = lines.length > 0
    ? lines[lines.length - 1]!.runningBalanceCents
    : 0;

  return { lines, totalBalanceCents };
}
```

- [ ] Modificar `packages/payments/src/index.ts` para exportar `getBankStatement`:

```typescript
export {
  recordPayment, cancelPayment, refundPayment,
  type CancelPaymentInput, type PaymentFailure, type RecordPaymentInput,
  type RecordedPayment, type RefundPaymentInput,
} from './record-payment';
export {
  materializeRollup, detectDivergence, refreshDailyRollup,
  type DivergenceRow, type RollupResult,
} from './rollup';
export { createPaymentLink, type CreatePaymentLinkInput, type PaymentLinkCreated } from './create-payment-link';
export { processPaymentWebhook, type WebhookPayload, type WebhookProcessed } from './process-webhook';
export { reconcileSettlements, type ReconcileInput, type ReconcileResult } from './reconcile';
export {
  createTransfer,
  type CreateTransferInput, type TransferCreated, type TransferFailure,
} from './transfer';
export {
  getCashFlowProjection,
  type CashFlowInput, type CashFlowProjection, type CashFlowWeek,
} from './cash-flow';
export {
  getBankStatement,
  type BankStatementInput, type BankStatement, type StatementLine,
} from './bank-statement';
```

- [ ] Rodar o teste e confirmar que PASSA:

```bash
pnpm vitest run packages/payments/src/bank-statement.int.test.ts
```

Saida esperada: 3 testes passam.

- [ ] Commitar:

```bash
git add packages/payments/src/bank-statement.ts \
       packages/payments/src/bank-statement.int.test.ts \
       packages/payments/src/index.ts
git commit -m "feat(payments): add getBankStatement domain function"
```

---

### Task 17: Migration 0093 — indice para latencia do painel financeiro e acoes de authz

**Arquivos**

- Criar `packages/db/migrations/0093_fin_statement_index.sql`
- Modificar `packages/authz/src/actions.ts`
- Teste `packages/payments/src/fin-latency.int.test.ts`

**Por que:** O alvo de latencia do painel financeiro do mes (rollup) e < 1 ms com ~240 linhas (Apendice A). O extrato por conta precisa de indice cobrindo `(bank_account_id, paid_at)` para nao cair em seq scan. Alem disso, as acoes de authz `payment.transfer` e `bank_account.write` precisam existir no catalogo para que as rotas da Task seguinte possam usar `assertCan`.

- [ ] Criar o arquivo de migration `packages/db/migrations/0093_fin_statement_index.sql`:

```sql
-- 0093_fin_statement_index.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Indice para extrato por conta e fluxo de caixa projetado. O alvo de latencia
-- do painel financeiro do mes e < 1 ms (~240 linhas, Apendice A).

-- ---------------------------------------------------------------------------
-- 1. Indice para extrato por conta: (bank_account_id, paid_at) com INCLUDE
-- ---------------------------------------------------------------------------
CREATE INDEX ix_entry_bank_statement
  ON fin.entry (tenant_id, bank_account_id, paid_at)
  INCLUDE (kind, amount_cents, description, status, id)
  WHERE bank_account_id IS NOT NULL AND paid_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Indice para fluxo de caixa projetado: entries pendentes com due_date
-- ---------------------------------------------------------------------------
CREATE INDEX ix_entry_projected_cashflow
  ON fin.entry (tenant_id, clinic_id, due_date)
  INCLUDE (kind, amount_cents, bank_account_id, status)
  WHERE status = 'pendente' AND due_date IS NOT NULL;
```

- [ ] Rodar a migration:

```bash
pnpm db:migrate
```

Saida esperada: migration 0093 aplicada com sucesso.

- [ ] [RECONCILIADO] Modificar `packages/authz/src/actions.ts` para adicionar TODAS as acoes da Fase 3 (uniao de Bloco 03 + Bloco 09). O Bloco 09 (Task 51) NAO deve modificar este arquivo novamente — o catalogo unificado e aplicado aqui:

```typescript
/**
 * FONTE UNICA do catalogo de acoes. Este arquivo e o unico lugar onde uma acao
 * nasce. O comando `pnpm authz:seed` regenera a tabela ref.action e o arquivo
 * packages/authz/actions.lock.json a partir daqui -- nunca o contrario.
 *
 * O que este catalogo NAO faz: filtrar linha. Isso e do RLS (§3.3). Aqui so se
 * decide o que a ROTA permite, olhando papel no vinculo.
 */
export const ROLES = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
] as const;
export type Role = (typeof ROLES)[number];

export interface ActionDef {
  readonly key: string;
  readonly description: string;
  readonly roles: readonly Role[];
  readonly requiresMfa?: boolean;
}

export const ACTIONS = [
  { key: 'patient.read', description: 'Ler cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'patient.write', description: 'Criar ou editar cadastro de paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'clinic.read', description: 'Ler dados da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'clinic.write', description: 'Editar dados da unidade',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.read', description: 'Listar vinculos da unidade',
    roles: ['admin_clinico', 'diretor_tecnico'] },
  { key: 'membership.grant', description: 'Conceder vinculo a um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'membership.revoke', description: 'Revogar vinculo de um usuario',
    roles: ['admin_clinico'], requiresMfa: true },
  { key: 'catalog.read', description: 'Consultar terminologia (CID-10, TUSS)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'audit.read', description: 'Ler a trilha de auditoria do tenant',
    roles: ['admin_clinico', 'diretor_tecnico'], requiresMfa: true },
  // ── Fase 1 · Agenda ──────────────────────────────────────────────────────
  { key: 'appointment.read', description: 'Ler a agenda da unidade',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.write', description: 'Agendar, mover e cancelar',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'appointment.checkin', description: 'Fazer check-in do paciente',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'waitlist.write', description: 'Gerir a lista de espera',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  // ── Fase 1 · Prontuario ──────────────────────────────────────────────────
  { key: 'encounter.read', description: 'Ler prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.write', description: 'Escrever rascunho de atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'encounter.finalize', description: 'Finalizar atendimento',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'encounter.amend', description: 'Retificar, adendar, transferir ou anular',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'record.template.write', description: 'Configurar secoes e campos do prontuario',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  { key: 'record.export', description: 'Exportar prontuario integral (ECF.18)',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.break_glass', description: 'Quebra-vidro assistencial',
    roles: ['diretor_tecnico', 'profissional'], requiresMfa: true },
  { key: 'record.share', description: 'Compartilhar prontuario com outro profissional',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional'] },
  // ── Fase 1 · Documentos e prescricao ─────────────────────────────────────
  { key: 'document.issue', description: 'Emitir atestado, pedido, relatorio ou declaracao',
    roles: ['diretor_tecnico', 'profissional'] },
  { key: 'prescription.write', description: 'Prescrever',
    roles: ['diretor_tecnico', 'profissional'] },
  // ── Fase 2 · Mensageria ──────────────────────────────────────────────────
  { key: 'messaging.conversation.read', description: 'Ler conversas do tenant',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.read', description: 'Ler mensagens de uma conversa',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao'] },
  { key: 'messaging.message.write', description: 'Enviar mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.read', description: 'Listar templates de mensagem',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao'] },
  { key: 'messaging.template.write', description: 'Criar ou editar templates',
    roles: ['admin_clinico'] },
  { key: 'messaging.automation.write', description: 'Configurar regras de automacao',
    roles: ['admin_clinico'] },
  // ── Fase 2 · Pagamento ───────────────────────────────────────────────────
  { key: 'payment.read', description: 'Listar pagamentos',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.write', description: 'Registrar pagamento no atendimento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  { key: 'payment.refund', description: 'Estornar pagamento',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.link.write', description: 'Criar link de pagamento',
    roles: ['admin_clinico', 'diretor_tecnico', 'recepcao', 'financeiro'] },
  // ── Fase 3 · Contas bancarias e transferencias (Bloco 03) ────────────────
  { key: 'bank_account.read', description: 'Listar contas bancarias',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'bank_account.write', description: 'Criar ou editar contas bancarias',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'payment.transfer', description: 'Criar transferencia entre contas',
    roles: ['admin_clinico', 'financeiro'] },
  // ── Fase 3 · Financeiro completo (Bloco 09) ────────────────────────────
  { key: 'finance.settings', description: 'Configurar contas bancarias, centros de custo, regras de split e recorrencia',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.write', description: 'Lancar despesa e cadastrar fornecedor',
    roles: ['admin_clinico', 'financeiro'] },
  { key: 'finance.repasse', description: 'Gerar, visualizar e pagar repasse a profissionais',
    roles: ['admin_clinico', 'financeiro'], requiresMfa: true },
  // ── Fase 3 · Estoque (Bloco 09) ────────────────────────────────────────
  { key: 'inventory.read', description: 'Consultar produtos e alertas de estoque',
    roles: ['admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro'] },
  { key: 'inventory.write', description: 'Cadastrar produto e registrar movimentacao',
    roles: ['admin_clinico', 'financeiro'] },
  // ── Fase 3 · Relatorios (Bloco 09) ─────────────────────────────────────
  { key: 'report.read', description: 'Acessar painel de desempenho e exportar relatorios',
    roles: ['admin_clinico', 'diretor_tecnico', 'financeiro'] },
] as const satisfies readonly ActionDef[];

export type ActionKey = (typeof ACTIONS)[number]['key'];

export const ACTION_BY_KEY: ReadonlyMap<string, ActionDef> =
  new Map(ACTIONS.map((a) => [a.key, a as ActionDef] as const));
```

- [ ] Criar o teste de latencia `packages/payments/src/fin-latency.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { getBankStatement, type BankStatementInput } from './bank-statement';
import { getCashFlowProjection, type CashFlowInput } from './cash-flow';
import { Pool } from 'pg';

interface SementeLatencia {
  tenantId: string;
  clinicId: string;
  userId: string;
  professionalId: string;
  paymentMethodId: string;
  bankAccountId: string;
}

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL_ADMIN ausente');
  }
  return url;
}

async function semearLatencia(): Promise<SementeLatencia> {
  const s: SementeLatencia = {
    tenantId: uuidv7(), clinicId: uuidv7(), userId: uuidv7(),
    professionalId: uuidv7(), paymentMethodId: uuidv7(),
    bankAccountId: uuidv7(),
  };
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO app.tenant (id, slug, razao_social, cnpj)
       VALUES ($1, $2, 'Clinica Latencia', '77ABC88901DE00')`,
      [s.tenantId, `lat-${s.tenantId}`]);
    await c.query(
      `INSERT INTO app.clinic (tenant_id, id, nome, cnes, timezone)
       VALUES ($1, $2, 'Unidade Lat', '7788990', 'America/Sao_Paulo')`,
      [s.tenantId, s.clinicId]);
    await c.query(
      `INSERT INTO id."user" (id, email, full_name) VALUES ($1, $2, 'Usuario Lat')`,
      [s.userId, `${s.userId}@example.test`]);
    await c.query(
      `INSERT INTO app.membership (tenant_id, id, user_id, clinic_id, role)
       VALUES ($1, gen_random_uuid(), $2, $3, 'financeiro')`,
      [s.tenantId, s.userId, s.clinicId]);
    await c.query(
      `INSERT INTO app.professional
         (tenant_id, id, user_id, conselho_profissional, numero_conselho, uf_conselho, cbos)
       VALUES ($1, $2, $3, '06', '111000', 'SP', '225125')`,
      [s.tenantId, s.professionalId, s.userId]);
    await c.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix Lat')`,
      [s.tenantId, s.paymentMethodId]);
    await c.query(
      `INSERT INTO fin.bank_account (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Caixa Lat', 'caixa')`,
      [s.tenantId, s.bankAccountId]);
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

let s: SementeLatencia;
let actor: Actor;

beforeAll(async () => {
  s = await semearLatencia();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };

  // Semear ~240 lancamentos para simular um mes de clinica
  await withTenantTx(actor, async (tx) => {
    const values: string[] = [];
    const params: unknown[] = [s.professionalId, s.clinicId, s.paymentMethodId, s.bankAccountId];
    let idx = 5;

    for (let day = 1; day <= 30; day++) {
      for (let i = 0; i < 8; i++) {
        const entryId = uuidv7();
        const kind = i % 4 === 0 ? 'despesa' : 'receita';
        const amount = kind === 'receita' ? 25000 : 5000;
        values.push(
          `(app.require_tenant_id(), $${idx}, '${kind}'::fin.entry_kind, $1, $2,
           'Lancamento ${day}-${i}', ${amount}, $3, 'pago',
           $${idx + 1}, $4, clock_timestamp() - interval '${30 - day} days')`);
        params.push(entryId, `lat-${entryId}`);
        idx += 2;
      }
    }

    await tx.query(
      `INSERT INTO fin.entry
         (tenant_id, id, kind, professional_id, clinic_id, description,
          amount_cents, payment_method_id, status, idempotency_key,
          bank_account_id, paid_at)
       VALUES ${values.join(',\n')}`,
      params);
  });
});

afterAll(async () => { await closePools(); });

describe('latencia — painel financeiro e extrato', () => {
  it('extrato de 240 lancamentos executa em menos de 50ms', async () => {
    const input: BankStatementInput = {
      bankAccountId: s.bankAccountId,
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 31 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
    };

    const inicio = performance.now();
    const r = await withTenantTx(actor, (tx) => getBankStatement(tx, input));
    const duracao = performance.now() - inicio;

    expect(r.lines.length).toBe(240);
    // A transacao inteira (preambulo + query + commit) deve ficar abaixo de 50ms.
    // O alvo real e < 1ms para o rollup; o extrato com window function e mais pesado
    // mas 50ms e conservador.
    expect(duracao).toBeLessThan(50);
  });

  it('fluxo de caixa projetado de 30 dias executa em menos de 50ms', async () => {
    const input: CashFlowInput = {
      clinicId: s.clinicId,
      fromDate: new Date(Date.now() - 31 * 24 * 3600_000).toISOString().slice(0, 10),
      toDate: new Date(Date.now() + 1 * 24 * 3600_000).toISOString().slice(0, 10),
      bankAccountId: s.bankAccountId,
    };

    const inicio = performance.now();
    const r = await withTenantTx(actor, (tx) => getCashFlowProjection(tx, input));
    const duracao = performance.now() - inicio;

    expect(r.weeks.length).toBeGreaterThan(0);
    expect(duracao).toBeLessThan(50);
  });

  it('acoes de authz bank_account.read, bank_account.write e payment.transfer existem', async () => {
    const { ACTION_BY_KEY } = await import('@cadencia/authz');
    expect(ACTION_BY_KEY.get('bank_account.read')).toBeDefined();
    expect(ACTION_BY_KEY.get('bank_account.write')).toBeDefined();
    expect(ACTION_BY_KEY.get('payment.transfer')).toBeDefined();
    expect(ACTION_BY_KEY.get('bank_account.write')!.roles).toContain('financeiro');
    expect(ACTION_BY_KEY.get('payment.transfer')!.roles).toContain('financeiro');
  });
});
```

- [ ] Rodar os testes e confirmar que passam:

```bash
pnpm vitest run packages/payments/src/fin-latency.int.test.ts
```

Saida esperada: 3 testes passam.

- [ ] Commitar:

```bash
git add packages/db/migrations/0093_fin_statement_index.sql \
       packages/authz/src/actions.ts \
       packages/payments/src/fin-latency.int.test.ts
git commit -m "feat(db): add statement/cashflow indexes (0093) and authz actions for bank accounts"
```
