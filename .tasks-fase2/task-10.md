### Task 10: `resolveConversation` — achar ou criar conversa por telefone

Implementa a funcao de dominio que encontra uma conversa ativa pelo telefone do contato ou cria uma nova. Quando cria, faz lookup do paciente pelo `phone_primary` — mas para numero desconhecido (sem match), o `patient_id` fica NULL (privacidade).

**Arquivos**

- Criar `packages/messaging/src/messaging.ts`
- Criar `packages/messaging/src/messaging.int.test.ts`
- Modificar `packages/messaging/src/index.ts`

---

- [ ] **Passo 1 — teste que falha: resolveConversation cria conversa e vincula paciente por telefone**

Criar `packages/messaging/src/messaging.int.test.ts`:

```ts
// packages/messaging/src/messaging.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { resolveConversation } from './messaging';
import { semearMensageria, type SementeMensageria } from './test-support';

let s: SementeMensageria;
let actor: Actor;

beforeAll(async () => {
  s = await semearMensageria();
  actor = {
    kind: 'user', tenantId: s.tenantId, userId: s.userId,
    clinicId: s.clinicId, requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('resolveConversation', () => {
  it('cria conversa nova e vincula paciente pelo telefone', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.conversationId).toBeTruthy();
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('retorna conversa existente sem criar duplicata', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: s.patientPhone,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(false);
  });

  it('cria conversa com patient_id NULL para numero desconhecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511888880000',
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(true);
    expect(r.value.patientId).toBeNull();
  });

  it('usa patient_id explicito quando fornecido', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: s.channelIdentityId,
      remotePhone: '+5511777770000',
      patientId: s.patientId,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.patientId).toBe(s.patientId);
  });

  it('recusa canal inexistente', async () => {
    const r = await withTenantTx(actor, (tx) => resolveConversation(tx, {
      channelIdentityId: uuidv7(),
      remotePhone: '+5511999990001',
    }));
    expect(r).toEqual({ ok: false, error: { kind: 'canal_nao_encontrado' } });
  });
});
```

Rodar:

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: falha — modulo `./messaging` nao existe.

---

- [ ] **Passo 2 — implementar resolveConversation**

Criar `packages/messaging/src/messaging.ts`:

```ts
// packages/messaging/src/messaging.ts
import { err, ok, uuidv7, type Result } from '@cadencia/kernel';
import type { TxClient } from '@cadencia/db';

// ---------------------------------------------------------------------------
// Tipos de falha
// ---------------------------------------------------------------------------

export type MessagingFailure =
  | { kind: 'canal_nao_encontrado' }
  | { kind: 'conversa_nao_encontrada' }
  | { kind: 'canal_inativo' };

// ---------------------------------------------------------------------------
// resolveConversation
// ---------------------------------------------------------------------------

export interface ResolveConversationInput {
  readonly channelIdentityId: string;
  readonly remotePhone: string;
  readonly patientId?: string;
}

export interface ResolvedConversation {
  readonly conversationId: string;
  readonly created: boolean;
  readonly patientId: string | null;
}

export async function resolveConversation(
  tx: TxClient, i: ResolveConversationInput,
): Promise<Result<ResolvedConversation, MessagingFailure>> {
  // 1. Verificar que a identidade de canal existe.
  const ci = await tx.query<{ id: string }>(
    `SELECT id FROM msg.channel_identity WHERE id = $1`,
    [i.channelIdentityId]);
  if (ci.rows.length === 0) return err({ kind: 'canal_nao_encontrado' });

  // 2. Buscar conversa ativa pelo telefone.
  const existente = await tx.query<{ id: string; patient_id: string | null }>(
    `SELECT id, patient_id FROM msg.conversation
      WHERE channel_identity_id = $1
        AND remote_phone = $2
        AND status = 'active'`,
    [i.channelIdentityId, i.remotePhone]);

  if (existente.rows.length > 0) {
    const conv = existente.rows[0]!;
    return ok({
      conversationId: conv.id,
      created: false,
      patientId: conv.patient_id,
    });
  }

  // 3. Criar conversa nova.
  let patientId: string | null = i.patientId ?? null;

  // Se patientId nao foi fornecido, tenta lookup pelo telefone do paciente.
  if (patientId === null) {
    const paciente = await tx.query<{ id: string }>(
      `SELECT id FROM clin.patient
        WHERE phone_primary = $1
        LIMIT 1`,
      [i.remotePhone]);
    if (paciente.rows.length > 0) {
      patientId = paciente.rows[0]!.id;
    }
  }

  const conversationId = uuidv7();
  await tx.query(
    `INSERT INTO msg.conversation
       (id, channel_identity_id, patient_id, remote_phone, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [conversationId, i.channelIdentityId, patientId, i.remotePhone]);

  return ok({ conversationId, created: true, patientId });
}
```

---

- [ ] **Passo 3 — reexportar pelo barrel**

Modificar `packages/messaging/src/index.ts`:

```ts
// packages/messaging/src/index.ts
export {
  resolveConversation,
  type ResolveConversationInput, type ResolvedConversation,
  type MessagingFailure,
} from './messaging';
```

---

- [ ] **Passo 4 — rodar e confirmar que os testes passam**

```bash
pnpm vitest run packages/messaging/src/messaging.int.test.ts
```

Saida esperada: 5 testes passando.

---

- [ ] **Passo 5 — commitar**

```bash
git add packages/messaging/src/messaging.ts packages/messaging/src/messaging.int.test.ts packages/messaging/src/index.ts
git commit -m "feat(messaging): resolveConversation finds or creates conversation by phone

Looks up patient by phone_primary for auto-linking. Unknown numbers
get patient_id=NULL for privacy. Returns existing active conversation
when one already exists for the same channel+phone pair.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---