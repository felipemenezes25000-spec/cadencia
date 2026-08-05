# 00-CONTRATOS — Reconciliacao dos 10 blocos da Fase 2

Gerado pela reconciliacao automatica. Cada bloco foi escrito em paralelo
e cego aos demais. Este documento unifica a ordem, os contratos e as
migrations, e registra todas as colisoes encontradas e corrigidas.

---

## 1. Ordem final dos blocos (por dependencia)

```
01-events-outbox          (fundacao: EventType, app.outbox)
  |
02-messaging-modelo       (msg schema, channel_identity, conversation, message)
  |
  +---> 03-whatsapp-provider  (MessagingProvider contrato + fake + WhatsApp adapter)
  |
  +---> 05-pagamentos-modelo  (fin enums, fin.entry, fin.receipt, fin.daily_rollup)
  |         |
  |         +---> 06-payment-link-conciliacao  (PaymentProvider contrato + fake + payment_link)
  |
  +---> 04-automacoes         (nps_response, computeReminderInstant, handlers)
  |
  +----------+----------+
             |
         07-api-worker        (rotas API, webhooks, workers — composicao L3)
             |
     +-------+-------+
     |               |
08-telas-conversas  09-telas-financeiro
     |               |
     +-------+-------+
             |
     10-integracao-gate       (FASE_ATUAL=2, TENANT_SCHEMAS+=msg, providers)
```

**Ordem linear de execucao:**
01 -> 02 -> 03 -> 05 -> 04 -> 06 -> 07 -> 08 -> 09 -> 10

---

## 2. Mapa de migrations (0068+)

| Migration | Bloco | Conteudo                                             | Status     |
|-----------|-------|------------------------------------------------------|------------|
| 0068      | 01    | `app.outbox` (tabela unica para TODOS os eventos)    | OK         |
| 0069      | 01    | `app.enqueue_event()` funcao SQL                     | OK         |
| 0070      | 02    | CREATE SCHEMA msg + `msg.channel_identity` + `msg.template` | CORRIGIDO: phone_number->phone, status ampliado |
| 0071      | 02    | `msg.conversation` + `msg.message` + `msg.inbound_event` | OK         |
| 0072      | 02    | `msg.automation_rule`                                | OK         |
| ~~0073~~  | ~~03~~ | ~~msg.channel_identity~~                             | **REMOVIDA**: duplicata de 0070 |
| 0073      | 04    | `msg.nps_response` (renumerada de 0074)              | RENUMERADA |
| 0074      | 04    | `msg.compute_send_at` funcao (renumerada de 0075)    | RENUMERADA |
| 0075      | 05    | `fin.entry_kind` enum + `fin.category` + `fin.payment_method` (renumerada de 0076) | RENUMERADA |
| 0076      | 05    | `fin.entry` + `fin.receipt` + `fin.receipt_counter` (renumerada de 0077)  | RENUMERADA |
| 0077      | 05    | `fin.daily_rollup` tabela (renumerada de 0078)       | RENUMERADA |
| 0078      | 06    | `fin.payment_link` + `fin.reconciliation_log` (renumerada de 0079) | RENUMERADA |
| 0079      | 06    | `fin.refresh_daily_rollup` **FUNCAO SOMENTE** (renumerada de 0080) | CORRIGIDO: sem CREATE TABLE, usa amount_cents e created_at::date |

> **Nota sobre renumeracao**: com a remocao da migration 0073 duplicata,
> todas as migrations subsequentes descem um numero. Os blocos originais
> ainda referenciam os numeros antigos; a renumeracao deve ser aplicada
> ao gerar os arquivos SQL finais.

### Migrations PENDENTES (nao definidas em nenhum bloco)

| Tabela             | Referenciada por | Precisa de migration |
|--------------------|------------------|----------------------|
| `fin.webhook_event`| Bloco 07 Task 40 | Sim — 0080+          |
| `msg.sent_reminder`| Bloco 07 Task 41 | Sim — 0080+          |

---

## 3. Tabela de contratos unificados

### 3.1 Tipos de evento (packages/events)

```ts
type EventType =
  | 'APPOINTMENT_CONFIRMED'   // Bloco 01 (NAO "APPOINTMENT_CREATED")
  | 'APPOINTMENT_REMINDER_DUE'
  | 'ENCOUNTER_FINALIZED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_LINK_CREATED'
  | 'INBOUND_MESSAGE_RECEIVED';
```

### 3.2 Outbox

Tabela UNICA: `app.outbox` (migration 0068).
**NAO existem** `msg.outbox_event` nem `fin.outbox_event`.
Bloco 07 corrigido para usar `app.outbox`.

### 3.3 MessagingProvider (packages/integrations)

Definido pelo Bloco 03. Interface `MessagingProvider extends Provider`.
Metodos: `send`, `verifyWebhook`, `parseInbound`, `health`.
Fake: `createFakeMessagingProvider({ modo })` com modos: ok, timeout, bloqueado.

### 3.4 PaymentProvider (packages/integrations)

Definido pelo **Bloco 06** (vence sobre Bloco 05).

```ts
type PaymentStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded';

interface PaymentSnapshot {
  providerPaymentId: string;
  status: PaymentStatus;
  feeCents: number | null;    // Bloco 06 (NAO metadata do Bloco 05)
  method: string | null;      // Bloco 06
  paidAt: Rfc3339 | null;
}

interface Settlement {
  providerPaymentId: string;
  settledAt: Rfc3339;
  amountCents: number;
  feeCents: number;
  originalPaidAt: Rfc3339;    // Bloco 06
}

// createPaymentLink tem idempotencyKey (Bloco 06)
```

Fake: `createFakePaymentProvider({ modo })` com modos: ok, indisponivel, timeout, rejeitado.
Metodo `simularPago(providerPaymentId)` para testes.

### 3.5 msg.channel_identity (schema)

Definida pela migration 0070 (Bloco 02). Coluna e `phone` (text), NAO `phone_number`.
Coluna e `channel` (text), NAO `channel_kind`.
Status: `provisioning | active | suspended | blocked | verified`.
Inclui `waba_ref` (adicionado da reconciliacao com Bloco 03).

### 3.6 fin.entry (schema)

Definida pela migration 0077 (Bloco 05). **NAO existe `fin.payment`** — Bloco 07 corrigido.
Colunas relevantes: `amount_cents bigint`, `external_ref text`, `idempotency_key text`,
`category_id uuid`, `payment_method_id uuid`, `status fin.entry_status`, `paid_at timestamptz`,
`due_date date`, `created_at timestamptz`, `created_by uuid`.
**NAO tem `occurred_date`** — usa `created_at::date` para competencia.

### 3.7 fin.daily_rollup (schema)

Definida pela migration 0078 (Bloco 05). Coluna e `amount_cents bigint`,
**NAO** `amount numeric(14,2)`.
Funcao `fin.refresh_daily_rollup` na migration 0080 (Bloco 06, corrigida).

### 3.8 fin.receipt (schema)

Definida pela migration 0077 (Bloco 05). **EXISTE** — Bloco 07 pode referencia-la.

### 3.9 nav.ts / FASE_ATUAL

Responsavel UNICO: Bloco 10, Task 55.
`FASE_ATUAL = 2`, Conversas `disponivelNaFase: 2`, Financeiro `disponivelNaFase: 2`.
Blocos 08 e 09 NAO alteram nav.ts.

### 3.10 TENANT_SCHEMAS

Responsavel: Bloco 10, Task 59.
`['app', 'clin', 'fin', 'tiss', 'audit', 'sched', 'msg']` — adiciona `msg`.

### 3.11 Providers registry (apps/api/src/providers.ts)

Responsavel: Bloco 10, Task 59.
`{ signature, prescription, messaging, payment }`.

### 3.12 integrations barrel (packages/integrations/src/index.ts)

Responsavel: Bloco 06, Task 35.
Re-exporta: common, signature, signature-fake, prescription, prescription-fake,
messaging, messaging-fake, payment, payment-fake, conformance.

### 3.13 LinhaDaFila (apps/web/src/telas/Hoje.tsx)

Versao unificada (Blocos 09 + 10):

```ts
interface LinhaDaFila {
  // ... campos base da Fase 1 ...
  readonly valorSugeridoCentavos?: number;   // Bloco 09
  readonly mensagensNaoLidas: number;         // Bloco 10
  readonly pagamentoPendente: boolean;        // Bloco 10
}
```

### 3.14 Regras de camada

VERIFICADAS CORRETAS — nenhuma violacao encontrada:
- messaging NAO importa scheduling nem payments
- payments NAO importa messaging
- composicao (cross-domain) apenas em L3 (API/worker)

---

## 4. Lista de colisoes encontradas e correcoes aplicadas

### 4.1 Colisoes de migration (2 encontradas, 2 corrigidas)

| # | Colisao | Resolucao |
|---|---------|-----------|
| M1 | `msg.channel_identity` criada em Bloco 02 (0070) E Bloco 03 (0073) | Migration 0073 REMOVIDA. Bloco 02 vence. |
| M2 | `fin.daily_rollup` criada em Bloco 05 (0078) E Bloco 06 (0080) | CREATE TABLE removido de 0080. Bloco 05 vence para a tabela; 0080 contem somente a funcao. |

### 4.2 Colisoes de contrato/tipo (14 encontradas, 14 corrigidas)

| # | Colisao | Resolucao |
|---|---------|-----------|
| C1 | PaymentProvider: Bloco 05 vs Bloco 06 (assinaturas diferentes) | Bloco 06 vence (idempotencyKey, refund). Bloco 05 marcado SUPERSEDED. |
| C2 | PaymentStatus: 7 valores (B05) vs 5 valores (B06) | Bloco 06 vence (pending/paid/expired/cancelled/refunded). |
| C3 | PaymentSnapshot: metadata (B05) vs feeCents/method (B06) | Bloco 06 vence. |
| C4 | Settlement: B06 adiciona originalPaidAt | Bloco 06 vence. |
| C5 | createFakePaymentProvider: versoes diferentes | Bloco 06 vence (4 modos, simularPago). |
| C6 | msg.channel_identity.phone_number (B02) vs phone (B03/07/08) | Padronizado para `phone` (B02 corrigido). |
| C7 | msg.channel_identity.channel (B02) vs channel_kind (B07) | Padronizado para `channel` (B02 vence, B07 anotado). |
| C8 | msg.channel_identity.status: valores diferentes B02 vs B03/07 | Unificado: provisioning/active/suspended/blocked/verified. |
| C9 | msg.template.name (B02) vs slug (B07) | Padronizado para `name` (B02 vence, B07 anotado). |
| C10 | FASE_ATUAL=2 em tres blocos (B08, B09, B10) | Bloco 10 vence. Removido de B08 e B09. |
| C11 | Financeiro disponivelNaFase: B08=3, B09=2, B10=2 | Bloco 10 vence. Removido de B09. |
| C12 | integrations barrel reescrito por B03, B05, B06 | Bloco 06 vence (unifica todos). |
| C13 | fin.daily_rollup.amount_cents (B05) vs amount numeric (B06) | Bloco 05 vence (bigint cents). Funcao B06 corrigida. |
| C14 | LinhaDaFila: B09 vs B10 (campos diferentes) | Unificados: valorSugeridoCentavos (B09) + mensagensNaoLidas/pagamentoPendente (B10). |

### 4.3 Premissas erradas sobre Fase 0/1 (8 encontradas, 5 corrigidas, 3 pendentes)

| # | Erro | Resolucao | Status |
|---|------|-----------|--------|
| A1 | B07 usa `msg.outbox_event` (nao existe) | Corrigido: usar `app.outbox` (B01, 0068) | CORRIGIDO (anotacao) |
| A2 | B07 usa `fin.outbox_event` (nao existe) | Corrigido: usar `app.outbox` (B01, 0068) | CORRIGIDO (anotacao) |
| A3 | B07 usa `fin.payment` (nao existe) | Corrigido: usar `fin.entry` (B05, 0077) | CORRIGIDO (anotacao) |
| A4 | B04 diz `APPOINTMENT_CREATED` | Corrigido: `APPOINTMENT_CONFIRMED` (B01) | CORRIGIDO (inline) |
| A5 | B06 usa `occurred_date` em fin.entry (nao existe) | Corrigido: usar `created_at::date` (B05) | CORRIGIDO (inline) |
| A6 | B07 usa `msg.sent_reminder` (nao existe) | Precisa nova migration | **PENDENTE** |
| A7 | B07 usa `fin.webhook_event` (nao existe) | Precisa nova migration | **PENDENTE** |
| A8 | B07 usa `channel_kind`/`slug` (colunas erradas) | Corrigido: `channel`/`name` (B02) | CORRIGIDO (anotacao) |

---

## 5. Itens pendentes

1. **Migration para `msg.sent_reminder`** — tabela usada pelo worker
   reminder-scheduler (Bloco 07 Task 41) mas nao definida em nenhuma
   migration. Deve ser adicionada como 0080+ ou incorporada ao Bloco 04.

2. **Migration para `fin.webhook_event`** — tabela usada pelo webhook de
   pagamento (Bloco 07 Task 40) mas nao definida. Deve ser adicionada
   como 0080+ ou incorporada ao Bloco 06.

3. **Renumeracao de migrations** — com a remocao da 0073 duplicata, as
   migrations 0074-0080 precisam ser renumeradas (0073-0079) ao gerar
   os arquivos SQL finais.

4. **Code-level fixes em Bloco 07** — as correcoes de tabelas fantasma
   e colunas erradas foram anotadas no cabecalho do arquivo, mas os
   snippets de codigo no corpo do Bloco 07 ainda contem as referencias
   antigas. Ao implementar, aplicar as substituicoes documentadas.

---

## 6. Resumo

| Metrica                        | Valor |
|--------------------------------|-------|
| Colisoes de migration          | 2     |
| Colisoes de contrato/tipo      | 14    |
| Premissas erradas sobre F0/F1  | 8     |
| Violacoes de camada            | 0     |
| Total de colisoes encontradas  | 24    |
| Correcoes aplicadas em disco   | 21    |
| Itens pendentes                | 3     |
