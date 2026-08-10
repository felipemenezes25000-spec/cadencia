# Fase 3 — Contratos Reconciliados

> Gerado automaticamente pela reconciliacao dos 12 blocos paralelos.
> Data: 2026-08-07

---

## 1. Ordem Final dos Blocos

| Ordem | Bloco | Arquivo | Escopo | Migrations |
|-------|-------|---------|--------|------------|
| 1 | 01 | `01-fin-contas-centro.md` | fin.bank_account, fin.cost_center, ALTER fin.entry | 0086-0088 |
| 2 | 02 | `02-fin-a-pagar-recorrente.md` | fin.supplier, fin.installment_plan, fin.recurring_template | 0089-0091 |
| 3 | 03 | `03-fin-fluxo-extrato.md` | fin.transfer, audit keys unificadas, indices, authz unificado | 0092-0093 |
| 4 | 04 | `04-fin-repasse.md` | fin.split_rule, fin.split, fin.repasse_statement, fin.calculate_splits | 0094-0097 |
| 5 | 05 | `05-estoque.md` | schema inv, inv.supplier, inv.product, inv.stock_movement | 0098-0100 |
| 6 | 06 | `06-rpt-matviews.md` | schema app_rpt, matviews, security barrier views | 0101-0105 |
| 7 | 07 | `07-desempenho-variacoes.md` | rpt.variation_snapshot, app_rpt.variation_snapshot | 0106 |
| 8 | 08 | `08-desempenho-explorar-visoes.md` | packages/reports query builder | (sem migrations) |
| 9 | 09 | `09-api-routes.md` | Rotas API L3 (finance, inventory, reports) | (sem migrations) |
| 10 | 10 | `10-telas-financeiro.md` | Telas React financeiro | (sem migrations) |
| 11 | 11 | `11-telas-desempenho.md` | Telas React desempenho | (sem migrations) |
| 12 | 12 | `12-integracao-gate.md` | FASE_ATUAL=3, gate de integracao | (sem migrations) |

**Regra de dependencia**: nenhum bloco depende de um bloco posterior. Modelo antes de consumidor; matviews antes de desempenho; API antes de telas.

---

## 2. Mapa de Migrations 0086+

| Migration | Bloco | Conteudo |
|-----------|-------|----------|
| 0086 | 01 | `CREATE TABLE fin.bank_account` (enum bank_account_type), `CREATE TABLE fin.cost_center` |
| 0087 | 01 | `ALTER TABLE fin.entry ADD COLUMN bank_account_id, cost_center_id`; FKs compostas; trigger seed |
| 0088 | 01 | Trigger seed de "Caixa Geral" para novos tenants |
| 0089 | 02 | `CREATE TABLE fin.supplier`; `ALTER TABLE fin.entry ADD COLUMN supplier_id` |
| 0090 | 02 | `CREATE TABLE fin.installment_plan`; `ALTER TABLE fin.entry ADD COLUMN installment_plan_id` |
| 0091 | 02 | `CREATE TYPE fin.recurrence_frequency`; `CREATE TABLE fin.recurring_template`; `ALTER TABLE fin.entry ADD COLUMN recurring_template_id`; audit.meta_keys_ok (recorrencia/parcelamento) |
| 0092 | 03 | **[RECONCILIADO]** `CREATE TABLE fin.transfer` apenas; audit.meta_keys_ok MERGED (0091 + transfer keys). NAO cria fin.bank_account nem bank_account_id (ja existem de 0086-0087) |
| 0093 | 03 | Indices ix_entry_bank_statement e ix_entry_projected_cashflow |
| 0094 | 04 | `CREATE TYPE fin.split_status`; `CREATE TABLE fin.split_rule`, `CREATE TABLE fin.split`; trigger trg_check_split_sum |
| 0095 | 04 | `CREATE TYPE fin.repasse_statement_status`; `CREATE TABLE fin.repasse_statement`; `CREATE FUNCTION fin.calculate_splits` (SECURITY DEFINER) |
| 0096 | 04 | Indices de desempenho para splits |
| 0097 | 04 | audit.meta_keys_ok (repasse keys) |
| 0098 | 05 | `CREATE SCHEMA inv`; `CREATE TYPE inv.unit_kind`; `CREATE TABLE inv.supplier`, `inv.product` |
| 0099 | 05 | `CREATE TABLE inv.stock_movement`; trigger de atualizacao de current_stock |
| 0100 | 05 | Registrar 'inv' em TENANT_SCHEMAS; audit.meta_keys_ok (inventory keys) |
| 0101 | 06 | `CREATE SCHEMA IF NOT EXISTS app_rpt`; role rpt_owner com BYPASSRLS; GRANTs; `CREATE TABLE rpt.refresh_log` |
| 0102 | 06 | Matview rpt.mv_atendimentos + view app_rpt.atendimentos |
| 0103 | 06 | Matview rpt.mv_financeiro + view app_rpt.financeiro |
| 0104 | 06 | Matview rpt.mv_pacientes + view app_rpt.pacientes |
| 0105 | 06 | Matview rpt.mv_mensagens + view app_rpt.mensagens |
| 0106 | 07 | **[RECONCILIADO]** `CREATE TABLE rpt.variation_snapshot`; `CREATE VIEW app_rpt.variation_snapshot`. NAO cria schema app_rpt (ja existe de 0101) |

---

## 3. Tabela de Contratos Unificados

### 3.1 Tabelas novas

| Tabela | Schema | Definido por | Consumido por | Migration |
|--------|--------|-------------|---------------|-----------|
| fin.bank_account | fin | Bloco 01 | Bloco 01, 02, 03, 04, 06, 09, 10 | 0086 |
| fin.cost_center | fin | Bloco 01 | Bloco 01, 02, 09, 10 | 0086 |
| fin.supplier | fin | Bloco 02 | Bloco 02, 09, 10 | 0089 |
| fin.installment_plan | fin | Bloco 02 | Bloco 02, 09, 10 | 0090 |
| fin.recurring_template | fin | Bloco 02 | Bloco 02, 09, 10 | 0091 |
| fin.transfer | fin | Bloco 03 | Bloco 03, 09, 10 | 0092 |
| fin.split_rule | fin | Bloco 04 | Bloco 04, 09, 10 | 0094 |
| fin.split | fin | Bloco 04 | Bloco 04, 09, 10 | 0094 |
| fin.repasse_statement | fin | Bloco 04 | Bloco 04, 09, 10 | 0095 |
| inv.supplier | inv | Bloco 05 | Bloco 05, 09, 10 | 0098 |
| inv.product | inv | Bloco 05 | Bloco 05, 09, 10 | 0098 |
| inv.stock_movement | inv | Bloco 05 | Bloco 05, 09, 10 | 0099 |
| rpt.refresh_log | rpt | Bloco 06 | Bloco 06, 07, 08 | 0101 |
| rpt.variation_snapshot | rpt | Bloco 07 | Bloco 07, 08, 11 | 0106 |

### 3.2 Colunas adicionadas a fin.entry

| Coluna | Tipo | Nullable | FK composta | Definido por | Migration |
|--------|------|----------|-------------|-------------|-----------|
| bank_account_id | uuid | sim | (tenant_id, bank_account_id) -> fin.bank_account(tenant_id, id) | Bloco 01 | 0087 |
| cost_center_id | uuid | sim | (tenant_id, cost_center_id) -> fin.cost_center(tenant_id, id) | Bloco 01 | 0087 |
| supplier_id | uuid | sim | (tenant_id, supplier_id) -> fin.supplier(tenant_id, id) | Bloco 02 | 0089 |
| installment_plan_id | uuid | sim | (tenant_id, installment_plan_id) -> fin.installment_plan(tenant_id, id) | Bloco 02 | 0090 |
| recurring_template_id | uuid | sim | (tenant_id, recurring_template_id) -> fin.recurring_template(tenant_id, id) | Bloco 02 | 0091 |

Todas as FKs sao compostas `(tenant_id, col_id)` conforme padrao do projeto. Nenhuma colisao de nomes.

### 3.3 Domain functions (packages/payments)

| Funcao | Arquivo | Definido por | Assinatura |
|--------|---------|-------------|------------|
| createBankAccount | bank-account.ts | Bloco 01 | `(tx, input) -> Result<BankAccountCreated, BankAccountFailure>` |
| createCostCenter | cost-center.ts | Bloco 01 | `(tx, input) -> Result<CostCenterCreated, CostCenterFailure>` |
| createInstallmentPlan | installment-plan.ts | Bloco 02 | `(tx, input) -> Result<InstallmentPlanCreated, InstallmentFailure>` |
| createRecurringTemplate | recurring.ts | Bloco 02 | `(tx, input) -> Result<RecurringTemplateCreated, RecurringFailure>` |
| materializeRecurringEntries | materialize-recurring.ts | Bloco 02 | `(pool) -> Promise<MaterializeResult>` |
| createTransfer | transfer.ts | Bloco 03 | `(tx, input) -> Result<TransferCreated, TransferFailure>` |
| getCashFlowProjection | cash-flow.ts | Bloco 03 | `(tx, input) -> Promise<CashFlowProjection>` |
| getBankStatement | bank-statement.ts | Bloco 03 | `(tx, input) -> Promise<BankStatement>` |
| createSplitRule | split-rule.ts | Bloco 04 | `(tx, input) -> Result<SplitRuleCreated, SplitRuleFailure>` |
| calculateSplits | split-rule.ts | Bloco 04 | `(tx, tenantId, entryId) -> Result<CalculateSplitsResult, CalculateSplitsFailure>` |
| closeRepassePeriod | repasse.ts | Bloco 04 | `(tx, input) -> Result<CloseRepasseResult, CloseRepasseFailure>` |
| payRepasse | repasse.ts | Bloco 04 | `(tx, input) -> Result<PayRepasseResult, PayRepasseFailure>` |

### 3.4 Domain functions (packages/inventory)

| Funcao | Arquivo | Definido por | Assinatura |
|--------|---------|-------------|------------|
| createProduct | product.ts | Bloco 05 | `(tx, input) -> Result<ProductCreated, ProductFailure>` |
| recordMovement | movement.ts | Bloco 05 | `(tx, input) -> Result<MovementRecorded, MovementFailure>` |
| getLowStockAlerts | alerts.ts | Bloco 05 | `(tx, clinicId) -> Promise<LowStockAlert[]>` |

### 3.5 Domain functions (packages/reports)

| Funcao | Arquivo | Definido por | Assinatura |
|--------|---------|-------------|------------|
| buildQuery | query-builder.ts | Bloco 08 | `(view, filters, sorts, limit, offset) -> { sql: string, params: unknown[] }` |
| computeVariation | variation.ts | Bloco 07 | `(tx, input) -> Promise<VariationResult>` |

### 3.6 Acoes de authz unificadas (Fase 3)

| Chave | Descricao | Roles | MFA | Definido por |
|-------|-----------|-------|-----|-------------|
| bank_account.read | Listar contas bancarias | admin_clinico, financeiro | nao | Bloco 03 |
| bank_account.write | Criar ou editar contas bancarias | admin_clinico, financeiro | nao | Bloco 03 |
| payment.transfer | Criar transferencia entre contas | admin_clinico, financeiro | nao | Bloco 03 |
| finance.settings | Configurar contas, centros de custo, split, recorrencia | admin_clinico, financeiro | nao | Bloco 09 |
| finance.write | Lancar despesa e cadastrar fornecedor | admin_clinico, financeiro | nao | Bloco 09 |
| finance.repasse | Gerar, visualizar e pagar repasse | admin_clinico, financeiro | sim | Bloco 09 |
| inventory.read | Consultar produtos e alertas de estoque | admin_clinico, diretor_tecnico, profissional, recepcao, financeiro | nao | Bloco 09 |
| inventory.write | Cadastrar produto e registrar movimentacao | admin_clinico, financeiro | nao | Bloco 09 |
| report.read | Acessar painel de desempenho e exportar relatorios | admin_clinico, diretor_tecnico, financeiro | nao | Bloco 09 |

Todas as 9 acoes sao adicionadas ao catalogo em uma unica edicao de `packages/authz/src/actions.ts` (Task 17, Bloco 03). O Bloco 09 (Task 51) so cria o teste.

### 3.7 Schemas novos

| Schema | Owner | Definido por | Migration |
|--------|-------|-------------|-----------|
| inv | app_owner | Bloco 05 | 0098 |
| app_rpt | rpt_owner | Bloco 06 | 0101 |

TENANT_SCHEMAS atualizado pelo Bloco 05 (migration 0100): adiciona 'inv'.

---

## 4. Colisoes Encontradas e Correcoes Aplicadas

### Colisao 1: `CREATE TABLE fin.bank_account` duplicada
- **Bloco 01** (0086): enum `fin.bank_account_type` ('corrente', 'poupanca'), colunas account_type, initial_balance_cents, is_default
- **Bloco 03** (0092): `kind text CHECK (...)` ('caixa', 'banco', 'carteira_digital'), sem is_default, sem initial_balance_cents
- **Vencedor**: Bloco 01 (range anterior, schema mais completo)
- **Correcao**: Removido CREATE TABLE fin.bank_account de 0092. Arquivo renomeado para `0092_fin_transfer.sql`.

### Colisao 2: `ALTER TABLE fin.entry ADD COLUMN bank_account_id` duplicada
- **Bloco 01** (0087) e **Bloco 03** (0092) adicionam a mesma coluna
- **Vencedor**: Bloco 01 (anterior)
- **Correcao**: Removido ALTER TABLE de 0092.

### Colisao 3: `audit.meta_keys_ok()` sobrescrita
- **Bloco 02** (0091): adiciona frequency, total_installments, generated_entries, template_id, supplier_name
- **Bloco 03** (0092): adiciona from_account, to_account, transfer_id mas PERDE as chaves de 0091
- **Correcao**: Versao em 0092 agora contem a UNIAO de todas as chaves (0091 + 0092).

### Colisao 4: `CREATE SCHEMA app_rpt` duplicada
- **Bloco 06** (0101): `CREATE SCHEMA IF NOT EXISTS app_rpt`
- **Bloco 07** (0106): `CREATE SCHEMA app_rpt` (sem IF NOT EXISTS — falharia em runtime)
- **Correcao**: Removido CREATE SCHEMA app_rpt de 0106. Comentario indica que ja existe de 0101.

### Colisao 5: Acoes de authz em dois blocos
- **Bloco 03** (Task 17): bank_account.read, bank_account.write, payment.transfer
- **Bloco 09** (Task 51): finance.settings, finance.write, finance.repasse, inventory.read, inventory.write, report.read
- As chaves nao conflitam entre si, mas ambos editam `actions.ts`
- **Correcao**: Todas as 9 acoes sao adicionadas pelo Bloco 03 (Task 17). Bloco 09 (Task 51) marcado como SKIP para edicao de actions.ts — so cria o teste.

### Nao-colisao confirmada: `fin.supplier` vs `inv.supplier`
- Bloco 02 cria `fin.supplier` (fornecedor financeiro para contas a pagar)
- Bloco 05 cria `inv.supplier` (fornecedor de estoque)
- Schemas diferentes, entidades distintas. Coexistem sem conflito.

---

## 5. Premissas Verificadas Contra Codigo Existente

| Premissa | Status | Detalhe |
|----------|--------|---------|
| `RecordPaymentInput` nao tem bankAccountId | Correto | Bloco 01 planeja adicionar como opcional (retrocompativel) |
| `RecordPaymentInput` nao tem costCenterId | Correto | Bloco 01 planeja adicionar como opcional (retrocompativel) |
| `TENANT_SCHEMAS` nao tem 'inv' | Correto | Bloco 05 planeja adicionar |
| `actions.ts` nao tem acoes Fase 3 | Correto | Todas adicionadas pelo catalogo unificado |
| fin.entry tem 14 colunas (antes dos ALTERs) | Correto | Verificado em 0077_fin_entry_receipt.sql |
| FKs compostas com (tenant_id, id) em todas as tabelas | Correto | Padrao mantido em todos os blocos |
| `allocate()` existe em @cadencia/kernel | Assumido correto | Bloco 02 usa para parcelamento lossless |
| `withTenantTx(actor, fn)` e o padrao de transacao | Correto | Verificado em packages/db |

---

## 6. Arquivos Editados nesta Reconciliacao

| Arquivo | Edicao |
|---------|--------|
| `03-fin-fluxo-extrato.md` | Migration 0092 renomeada, removido CREATE TABLE fin.bank_account e ADD COLUMN bank_account_id; audit.meta_keys_ok unificada; authz unificado com todas as 9 acoes da Fase 3 |
| `07-desempenho-variacoes.md` | Migration 0106 removido CREATE SCHEMA app_rpt (ja existe de 0101) |
| `09-api-routes.md` | Task 51 marcada como RECONCILIADO — edicao de actions.ts delegada ao Bloco 03 |
