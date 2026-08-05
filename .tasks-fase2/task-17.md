### Task 17: testes de integracao de `msg.channel_identity` e WABA onboarding

**Arquivos**
- Criar `packages/db/migrations/0073_msg_channel_identity.sql`
- Teste `packages/db/test/0073_msg_channel_identity.test.ts`

- [ ] **Teste que falha** — criar `packages/db/test/0073_msg_channel_identity.test.ts`:

```ts
// packages/db/test/0073_msg_channel_identity.test.ts
import { describe, expect, it } from 'vitest';
import { withTenantTx } from '../src/tx';
import { testPool, TEST_TENANT_ID, TEST_USER_ID } from './helpers';

const actor = { tenantId: TEST_TENANT_ID, userId: TEST_USER_ID, role: 'admin' as const };

describe('msg.channel_identity', () => {
  it('a tabela msg.channel_identity existe no schema msg', async () => {
    const result = await testPool().query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'msg' AND table_name = 'channel_identity'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('insere identidade de canal com tenant_id e RLS permite leitura do mesmo tenant', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone, waba_ref,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica Teste',
          '+5511987654321', 'waba-123', 'prov-ref-1', 'verified',
          $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID]);

      const result = await tx.query(
        'SELECT channel, display_name, phone, status FROM msg.channel_identity WHERE tenant_id = $1',
        [TEST_TENANT_ID],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        channel: 'whatsapp',
        display_name: 'Clinica Teste',
        phone: '+5511987654321',
        status: 'verified',
      });
    });
  });

  it('RLS impede leitura de canal de OUTRO tenant', async () => {
    const outroTenant = { tenantId: '00000000-0000-0000-0000-000000000099', userId: TEST_USER_ID, role: 'admin' as const };
    await withTenantTx(actor, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Outra Clinica',
          '+5511911111111', 'prov-ref-2', 'verified', $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID]);
    });

    await withTenantTx(outroTenant, async (tx) => {
      const result = await tx.query(
        'SELECT * FROM msg.channel_identity WHERE tenant_id = $1',
        [TEST_TENANT_ID],
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  it('constraint unique (tenant_id, channel, phone) impede duplicata', async () => {
    await withTenantTx(actor, async (tx) => {
      await tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica A',
          '+5511922222222', 'prov-ref-3', 'verified', $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID]);

      await expect(tx.query(`
        INSERT INTO msg.channel_identity (
          tenant_id, id, channel, display_name, phone,
          provider_ref, status, created_by
        ) VALUES (
          $1, gen_random_uuid(), 'whatsapp', 'Clinica A Duplicada',
          '+5511922222222', 'prov-ref-4', 'verified', $2
        )
      `, [TEST_TENANT_ID, TEST_USER_ID])).rejects.toThrow(/unique|duplicate/i);
    });
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
pnpm vitest run packages/db/test/0073_msg_channel_identity.test.ts
# ESPERADO: falha — schema msg e tabela channel_identity nao existem
```

- [ ] **Implementar** — criar `packages/db/migrations/0073_msg_channel_identity.sql`:

```sql
-- 0073_msg_channel_identity.sql
-- Schema msg para mensageria. Tabela channel_identity: identidade de canal
-- por tenant (numero WhatsApp, telefone SMS, email).
-- Cada clinica registra o proprio numero — nunca compartilhado.

BEGIN;

CREATE SCHEMA IF NOT EXISTS msg;

CREATE TABLE msg.channel_identity (
  tenant_id  uuid        NOT NULL,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  channel    text        NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  display_name text      NOT NULL,
  phone      text        NOT NULL,          -- E164
  waba_ref   text,                          -- WABA ID da Meta, opcional
  provider_ref text      NOT NULL,          -- referencia do provedor
  status     text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'verified', 'rejected', 'suspended')),
  created_by uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (tenant_id, id),
  CONSTRAINT uq_channel_identity_phone UNIQUE (tenant_id, channel, phone)
);

-- RLS: isolamento multi-tenant
ALTER TABLE msg.channel_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.channel_identity FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON msg.channel_identity
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

COMMENT ON TABLE msg.channel_identity IS
  '§7.3 — identidade de canal por tenant. O numero e PROPRIO da clinica.';

COMMIT;
```

- [ ] Rodar as migrations:

```bash
pnpm db:migrate
# ESPERADO: migration 0073 aplicada com sucesso
```

- [ ] Rodar e confirmar que passa:

```bash
pnpm vitest run packages/db/test/0073_msg_channel_identity.test.ts
# ESPERADO: 4 testes passam
```

- [ ] Rodar suite de isolamento para confirmar que a nova tabela esta coberta:

```bash
pnpm test:iso
# ESPERADO: msg.channel_identity aparece e passa
```

- [ ] Commitar:

```bash
git add packages/db/migrations/0073_msg_channel_identity.sql packages/db/test/0073_msg_channel_identity.test.ts
git commit -m "feat(db): add msg schema and channel_identity table with RLS

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```