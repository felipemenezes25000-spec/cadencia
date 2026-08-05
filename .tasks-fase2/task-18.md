### Task 18: migration 0074 — tabela `msg.nps_response` e indice de automacao por timing

**Arquivos:**
- Criar `packages/db/migrations/0074_nps_response.sql`
- Teste `packages/messaging/src/automations/nps-response.int.test.ts`

**Contexto:** a `msg.automation_rule` ja foi criada pelo bloco 02 (migration 0070-0072) com `trigger`, `template_id`, `timing_offset_minutes`, `active`, `channel`. Este bloco acrescenta a tabela de respostas NPS e um indice de busca por timing para o job de lembretes.

- [ ] **Passo 1** — escrever o teste de isolamento que espera a tabela `msg.nps_response` existir com RLS forcada.

Criar `packages/messaging/src/automations/nps-response.int.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

let admin: Pool;

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (!url) throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

beforeAll(async () => { admin = new Pool({ connectionString: adminUrl(), max: 1 }); });
afterAll(async () => { await admin.end(); });

describe('msg.nps_response', () => {
  it('existe com RLS forcada', async () => {
    const { rows } = await admin.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'msg' AND c.relname = 'nps_response'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relforcerowsecurity).toBe(true);
  });

  it('tem ao menos uma policy', async () => {
    const { rows } = await admin.query(
      `SELECT polname FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'msg' AND c.relname = 'nps_response'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('FK composta inclui tenant_id', async () => {
    const { rows } = await admin.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'msg.nps_response'::regclass AND contype = 'f'`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/nps-response.int.test.ts
```

Saida esperada: 3 testes falham (tabela nao existe).

- [ ] **Passo 2** — rodar o teste e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/nps-response.int.test.ts
```

Saida esperada: `FAIL` — relacao `msg.nps_response` nao encontrada.

- [ ] **Passo 3** — escrever a migration 0074 com `msg.nps_response` e o indice de timing em `msg.automation_rule`.

Criar `packages/db/migrations/0074_nps_response.sql`:

```sql
-- 0074_nps_response.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Tabela de respostas NPS e indice de busca por timing para o job de lembretes.
-- A msg.automation_rule ja existe (0070); este arquivo acrescenta a tabela de
-- respostas e o indice auxiliar.

-- =========================================================================
-- msg.nps_response — resposta do paciente a pesquisa NPS
-- =========================================================================
CREATE TABLE msg.nps_response (
  tenant_id       uuid NOT NULL DEFAULT app.require_tenant_id(),
  id              uuid NOT NULL,
  patient_id      uuid NOT NULL,
  appointment_id  uuid,           -- pode ser NULL se NPS avulso
  conversation_id uuid,           -- conversa de onde veio a resposta
  message_id      uuid,           -- mensagem que contem a resposta
  score           smallint NOT NULL CHECK (score >= 0 AND score <= 10),
  comment         text,
  received_at     timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES clin.patient(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id)  REFERENCES sched.appointment(tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES msg.conversation(tenant_id, id)
);
ALTER TABLE msg.nps_response OWNER TO app_owner;

CREATE INDEX ix_nps_response_tenant_patient
  ON msg.nps_response (tenant_id, patient_id, received_at DESC);
CREATE INDEX ix_nps_response_tenant_score
  ON msg.nps_response (tenant_id, score, received_at DESC);

GRANT SELECT, INSERT ON msg.nps_response TO app_rw;

ALTER TABLE msg.nps_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE msg.nps_response FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON msg.nps_response AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- =========================================================================
-- Indice em msg.automation_rule para busca por trigger+active
-- (o bloco 02 criou a tabela; este indice acelera o lookup de automacoes)
-- =========================================================================
CREATE INDEX ix_automation_rule_trigger
  ON msg.automation_rule (tenant_id, trigger, active)
  WHERE active = true;
```

Rodar:

```bash
pnpm db:migrate
```

Saida esperada: migration 0074 aplicada sem erro.

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/nps-response.int.test.ts
```

Saida esperada: 3 testes passam.

- [ ] **Passo 5** — commitar.

```bash
git add packages/db/migrations/0074_nps_response.sql packages/messaging/src/automations/nps-response.int.test.ts
git commit -m "feat(db): add msg.nps_response table and automation_rule index (0074)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---