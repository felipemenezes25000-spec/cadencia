### Task 23: migration 0075 — funcao SQL `msg.compute_send_at` e teste de integracao do lembrete no fuso correto

**Arquivos:**
- Criar `packages/db/migrations/0075_compute_send_at.sql`
- Teste `packages/messaging/src/automations/reminder-timezone.int.test.ts`

**Contexto:** o teste obrigatorio do enunciado: lembrete de 24h para consulta as 8h no fuso da clinica (America/Sao_Paulo) deve ser enviado as 8h do dia anterior, nao as 5h UTC. Este teste de integracao valida a funcao SQL e o fluxo completo. A funcao SQL `msg.compute_send_at` espelha a logica de `computeReminderInstant` no banco, para que o job de lembrete possa calcular o instante de envio diretamente na query.

- [ ] **Passo 1** — escrever o teste de integracao.

Criar `packages/messaging/src/automations/reminder-timezone.int.test.ts`:

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

describe('msg.compute_send_at — fuso da clinica', () => {
  it('lembrete 24h antes: consulta 8h SP sai 8h dia anterior SP, nao 5h UTC', async () => {
    // Consulta as 8h em America/Sao_Paulo = 11:00 UTC
    // Offset -1440 min (24h antes)
    // Esperado: 8h dia anterior SP = 11:00 UTC dia anterior
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', -1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-06T11:00:00Z');
  });

  it('lembrete 2h antes: consulta 8h SP sai 6h SP (9h UTC)', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', -120)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-07T09:00:00Z');
  });

  it('pos-consulta 24h depois: offset positivo funciona', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', 1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-08T11:00:00Z');
  });

  it('NPS 7 dias depois', async () => {
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-10-07T11:00:00Z'::timestamptz, 'America/Sao_Paulo', 10080)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    expect(rows[0]!.send_at).toBe('2026-10-14T11:00:00Z');
  });

  it('confirma que 24h antes NAO e simplesmente subtrair 1440 min do UTC', async () => {
    // Demonstra o ERRO que teriamos se subtraissemos diretamente do UTC.
    // Consulta as 8h em SP (UTC-3) = 11:00 UTC.
    // Subtrair 1440 min do UTC: 11:00 - 24h = 11:00 dia anterior (coincidencia ERRADA).
    // Mas para um fuso com DST, o resultado seria diferente.
    // Testamos com America/New_York para provar a diferenca:
    // Consulta 2026-03-09 09:00 EDT (UTC-4) = 13:00 UTC
    // 24h antes local = 2026-03-08 09:00 EST (UTC-5) = 14:00 UTC
    // Se fosse subtracao pura: 13:00 - 24h = 13:00 dia anterior (ERRADO)
    const { rows } = await admin.query<{ send_at: string }>(
      `SELECT to_char(
         msg.compute_send_at('2026-03-09T13:00:00Z'::timestamptz, 'America/New_York', -1440)
           AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS"Z"'
       ) AS send_at`);
    // 2026-03-08 09:00 EST = 14:00 UTC, NAO 13:00 UTC
    expect(rows[0]!.send_at).toBe('2026-03-08T14:00:00Z');
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timezone.int.test.ts
```

Saida esperada: testes falham (funcao `msg.compute_send_at` nao existe).

- [ ] **Passo 2** — rodar e confirmar a falha.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timezone.int.test.ts
```

Saida esperada: `FAIL` — funcao `msg.compute_send_at` nao existe.

- [ ] **Passo 3** — escrever a migration 0075.

Criar `packages/db/migrations/0075_compute_send_at.sql`:

```sql
-- 0075_compute_send_at.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Funcao SQL que calcula o instante UTC de envio de automacao respeitando o
-- fuso da clinica. O offset e aplicado no horario LOCAL, nao no UTC.
--
-- Algoritmo:
-- 1. Converte o instante de referencia para o fuso da clinica.
-- 2. Aplica o offset em minutos no horario local.
-- 3. O Postgres converte de volta para timestamptz automaticamente.
--
-- Isso garante que o lembrete de 24h antes de uma consulta as 8h em
-- America/Sao_Paulo sai as 8h do dia anterior em horario local, e NAO
-- as 5h UTC (que seria o resultado de subtrair 1440 min do instante UTC).

CREATE FUNCTION msg.compute_send_at(
  p_reference_at  timestamptz,
  p_timezone      text,
  p_offset_minutes int
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  -- O truque: converter para o fuso local, somar o intervalo no espaco local,
  -- e converter de volta. O Postgres faz a conversao de volta corretamente,
  -- incluindo transicoes de horario de verao.
  SELECT ((p_reference_at AT TIME ZONE p_timezone)
          + make_interval(mins => p_offset_minutes))
         AT TIME ZONE p_timezone
$$;

ALTER FUNCTION msg.compute_send_at(timestamptz, text, int) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION msg.compute_send_at(timestamptz, text, int) TO app_rw;
```

Rodar:

```bash
pnpm db:migrate
```

Saida esperada: migration 0075 aplicada sem erro.

- [ ] **Passo 4** — rodar o teste e confirmar que passa.

```bash
pnpm vitest run packages/messaging/src/automations/reminder-timezone.int.test.ts
```

Saida esperada: 5 testes passam.

- [ ] **Passo 5** — exportar os modulos de automacao no indice do pacote e commitar.

Modificar `packages/messaging/src/index.ts`:

```ts
export {
  computeReminderInstant,
} from './automations/reminder-timing';

export {
  handleAppointmentCreated,
  type AppointmentCreatedPayload,
  type AutomationRule,
  type AutomationTrigger,
  type ConfirmationOutboxEntry,
} from './automations/confirmation';

export {
  scheduleReminders,
  type ReminderOutboxEntry,
} from './automations/reminder';

export {
  handleEncounterFinalized,
  scheduleNps,
  type EncounterFinalizedPayload,
  type PostEncounterOutboxEntry,
  type NpsOutboxEntry,
} from './automations/post-encounter';
```

Commitar:

```bash
git add packages/db/migrations/0075_compute_send_at.sql \
  packages/messaging/src/automations/reminder-timezone.int.test.ts \
  packages/messaging/src/index.ts
git commit -m "feat(messaging): SQL compute_send_at and timezone integration test (0075)

The reminder for an 8 AM appointment in America/Sao_Paulo fires at
8 AM the previous day in local time, not 5 AM UTC.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

## Parte III — Financeiro