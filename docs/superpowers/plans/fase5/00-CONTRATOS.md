# Fase 5 — Contratos Reconciliados

> Gerado por reconciliacao dos 10 blocos paralelos da Fase 5.
> Cada bloco foi escrito cego aos demais. Este arquivo unifica contratos,
> resolve colisoes e documenta a ordem de execucao.

---

## 1. Ordem Final dos Blocos (por dependencia)

| Ordem | Bloco | Conteudo | Migrations | Depende de |
|-------|-------|----------|------------|------------|
| 1 | 01-demonstrativo-modelo | Tabelas demonstrativo/demonstrativo_item, importDemonstrativo (ref) | 0123, 0124 | - (Fase 4) |
| 2 | 03-glosa-modelo | Tabelas glosa, recurso_glosa, recurso_glosa_item, resolveRecurso (ref) | 0125, 0126 | Bloco 01 (demonstrativo_item FK) |
| 3 | 02-demonstrativo-parser | parseDemonstrativoXml, importDemonstrativo (canonico) | - | Bloco 01 (schema) |
| 4 | 04-recurso-glosa-dominio | Ciclo de vida do recurso: create, add, remove, ready, submit, resolve | - | Bloco 03 (tabelas recurso_glosa, glosa) |
| 5 | 05-recurso-xml-serializer | serializeRecursoGlosa, computeRecursoGlosaHash | - | Bloco 04 (tipos) |
| 6 | 06-tiss-soap | createTissSoapTransport, migration SOAP colunas | 0127 | Bloco 05 (serializer) |
| 7 | 08-api-rbac | Rotas API demonstrativo, glosa, recurso; 6 acoes RBAC | - | Blocos 02, 04, 06 |
| 8 | 07-retornos-glosas-telas | Telas ConveniosRetornos, ConveniosGlosas, ConveniosRecursos | - | Bloco 08 (API) |
| 9 | 09-desempenho-glosas | matview rpt.mv_glosas, fator glosas em compute-variation | 0128, 0129 | Bloco 03 (tiss.glosa) |
| 10 | 10-invariantes-dod | Invariantes RLS/DDL, registry, e2e completo | - | Todos |

---

## 2. Mapa de Migrations

| Numero | Arquivo | Bloco | Conteudo |
|--------|---------|-------|----------|
| 0123 | `0123_tiss_demonstrativo.sql` | 01 | Enum `tiss.demonstrativo_kind`, tabela `tiss.demonstrativo` com RLS |
| 0124 | `0124_tiss_demonstrativo_item.sql` | 01 | Tabela `tiss.demonstrativo_item` com RLS, FK composta |
| 0125 | `0125_tiss_glosa.sql` | 03 | Enum `tiss.glosa_status`, tabela `tiss.glosa` com RLS |
| 0126 | `0126_tiss_recurso_glosa.sql` | 03 | Enum `tiss.recurso_glosa_status` (7 valores), tabelas `tiss.recurso_glosa`, `tiss.recurso_glosa_item`, `tiss.recurso_number_counter`, funcao `tiss.next_recurso_number()` |
| 0127 | `0127_tiss_contrato_soap.sql` | 06 | Colunas SOAP em `tiss.contrato` |
| 0128 | `0128_rpt_mv_glosas.sql` | 09 | Matview `rpt.mv_glosas`, funcao `rpt.refresh_mv_glosas()` |
| 0129 | `0129_app_rpt_glosas.sql` | 09 | View `app_rpt.glosas` (security_barrier) |

**Nenhuma colisao de numero de migration.** Sequencia 0123-0129 sem lacuna.

---

## 3. Tabela Unificada de Contratos

### 3.1 Funcoes de dominio

| Funcao | Arquivo canonico | Assinatura | Bloco dono |
|--------|-----------------|-----------|------------|
| `importDemonstrativo` | `packages/tiss/src/demonstrativo/import-demonstrativo.ts` | `(tx, input: ImportDemonstrativoInput, importedBy: string) => Result<ImportDemonstrativoResult, ImportDemonstrativoFailure>` | **02** |
| `parseDemonstrativoXml` | `packages/tiss/src/demonstrativo/parse-demonstrativo.ts` | `(xml: Uint8Array) => ParsedDemonstrativo` | 02 |
| `decodeIso8859` | `packages/tiss/src/demonstrativo/parse-demonstrativo.ts` | `(bytes: Uint8Array) => string` | 02 |
| `createRecursoGlosa` | `packages/tiss/src/recurso-glosa/create-recurso.ts` | `(tx, i: CreateRecursoGlosaInput) => Result<CreatedRecurso, CreateRecursoFailure>` | **04** |
| `addGlosaToRecurso` | `packages/tiss/src/recurso-glosa/add-glosa.ts` | `(tx, recursoId, glosaId, justificativa, valorRecursadoCents) => Result<AddedGlosaItem, AddGlosaFailure>` | 04 |
| `removeGlosaFromRecurso` | `packages/tiss/src/recurso-glosa/remove-glosa.ts` | `(tx, recursoId, glosaId) => Result<RemovedGlosaItem, RemoveGlosaFailure>` | 04 |
| `markRecursoReady` | `packages/tiss/src/recurso-glosa/mark-recurso-ready.ts` | `(tx, recursoId) => Result<RecursoReadyResult, MarkReadyFailure>` | 04 |
| `submitRecurso` | `packages/tiss/src/recurso-glosa/submit-recurso.ts` | `(tx, recursoId, transport) => Result<RecursoSentResult, SubmitRecursoFailure>` | 04 |
| `resolveRecurso` | `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts` | `(tx, recursoId, input: ResolveRecursoInput, resolvedBy: string) => Result<RecursoResolvedResult, ResolveRecursoFailure>` | **04** |
| `serializeRecursoGlosa` | `packages/tiss/src/serializer/serialize-recurso-glosa.ts` | `(input: RecursoGlosaInput) => Uint8Array` | 05 |
| `computeRecursoGlosaHash` | `packages/tiss/src/serializer/compute-tiss-hash.ts` | `(xml: Uint8Array) => string` | 05 |
| `createTissSoapTransport` | `packages/tiss/src/transport/tiss-soap/index.ts` | `(opts: TissSoapOptions) => TissTransport` | 06 |

### 3.2 Tipos canonicos

| Tipo | Arquivo | Bloco |
|------|---------|-------|
| `ImportDemonstrativoInput` | `packages/tiss/src/demonstrativo/import-demonstrativo.ts` | 02 |
| `ImportDemonstrativoResult` | `packages/tiss/src/demonstrativo/import-demonstrativo.ts` | 02 |
| `ImportDemonstrativoFailure` | `packages/tiss/src/demonstrativo/import-demonstrativo.ts` | 02 |
| `ParsedDemonstrativo` | `packages/tiss/src/demonstrativo/parse-demonstrativo.ts` | 02 |
| `RecursoStatus` | `packages/tiss/src/recurso-glosa/types.ts` | 04 |
| `CreateRecursoGlosaInput` | `packages/tiss/src/recurso-glosa/types.ts` | 04 |
| `ResolveRecursoInput` | `packages/tiss/src/recurso-glosa/types.ts` | 04 |
| `RecursoGlosaInput` | `packages/tiss/src/serializer/types.ts` | 05 |
| `ItemRecursoGlosaInput` | `packages/tiss/src/serializer/types.ts` | 05 |
| `ContratadoRecursoInput` | `packages/tiss/src/serializer/types.ts` | 05 |
| `TissSoapOptions` | `packages/tiss/src/transport/tiss-soap/index.ts` | 06 |

### 3.3 Enums SQL

| Enum | Valores | Migration | Bloco |
|------|---------|-----------|-------|
| `tiss.demonstrativo_kind` | `analise`, `pagamento` | 0123 | 01 |
| `tiss.glosa_status` | `pendente`, `aceita`, `contestada`, `revertida` | 0125 | 03 |
| `tiss.recurso_glosa_status` | `rascunho`, `pronto`, `enviado`, `indeterminado`, `deferido`, `indeferido`, `parcial` | 0126 | 03 |

### 3.4 Tabelas SQL

| Tabela | Colunas-chave | Migration | Bloco |
|--------|---------------|-----------|-------|
| `tiss.demonstrativo` | id, operadora_id, lote_id, protocolo_operadora, kind, data_processamento, data_pagamento, xml_storage_key, total_apresentado_cents, total_processado_cents, total_liberado_cents, total_glosa_cents, imported_at, imported_by | 0123 | 01 |
| `tiss.demonstrativo_item` | id, demonstrativo_id, guia_id, numero_guia_prestador, valor_apresentado_cents, valor_processado_cents, valor_liberado_cents, valor_glosa_cents, glosa_codigo, glosa_descricao | 0124 | 01 |
| `tiss.glosa` | id, demonstrativo_item_id, guia_id, encounter_version_id, codigo_glosa, descricao_glosa, valor_glosado_cents, status, resolved_at, resolved_by, created_at | 0125 | 03 |
| `tiss.recurso_glosa` | id, operadora_id, numero_recurso, status, justificativa_geral, encounter_version_id, item_count, total_recursado_cents, xml_storage_key, protocolo_operadora, sent_at, created_by, created_at | 0126 | 03 |
| `tiss.recurso_glosa_item` | id, recurso_id, glosa_id, justificativa_item, valor_recursado_cents | 0126 | 03 |
| `tiss.recurso_number_counter` | tenant_id, operadora_id, next_value | 0126 | 03 |

### 3.5 RBAC actions (bloco 08)

| Acao | Escopo |
|------|--------|
| `tiss:demonstrativo:import` | Importar demonstrativo TISS |
| `tiss:demonstrativo:read` | Ler demonstrativos |
| `tiss:glosa:read` | Ler glosas |
| `tiss:recurso:create` | Criar recurso de glosa |
| `tiss:recurso:submit` | Enviar recurso a operadora |
| `tiss:recurso:resolve` | Resolver recurso (deferido/indeferido/parcial) |

---

## 4. Colisoes Encontradas e Correcoes Aplicadas

### Colisao C1: importDemonstrativo — Bloco 01 vs Bloco 02

**Tipo:** funcao duplicada com assinaturas incompativeis

- Bloco 01: `packages/tiss/src/import-demonstrativo.ts` — entrada pre-parseada, resultado com `loteRetornado`
- Bloco 02: `packages/tiss/src/demonstrativo/import-demonstrativo.ts` — entrada XML `Uint8Array`, resultado com `matchedCount`, `totalGlosaCents`

**Vencedor:** Bloco 02 (parser-based, mais completo). Bloco 01 mantido como referencia de logica.

**Correcao:** Nota de reconciliacao adicionada ao Bloco 01 Task 6. Export publico em `index.ts` vem do bloco 02.

### Colisao C2: Nomes de coluna no INSERT de importDemonstrativo — Bloco 02 vs schema do Bloco 01

**Tipo:** nomes de coluna divergentes no INSERT

| Bloco 02 usava | Schema canonico (Bloco 01) |
|----------------|---------------------------|
| `numero_protocolo` | `protocolo_operadora` |
| `numero_demonstrativo` | (nao existe na tabela) |
| `tipo` | `kind` (com cast `::tiss.demonstrativo_kind`) |
| `registro_ans` | (nao existe na tabela) |
| `valor_total_informado_cents` | `total_apresentado_cents` |
| `valor_total_processado_cents` | `total_processado_cents` |
| `valor_total_glosa_cents` | `total_glosa_cents` |
| (ausente) | `operadora_id` (NOT NULL) |
| (ausente) | `xml_storage_key` (NOT NULL) |
| (ausente) | `total_liberado_cents` (NOT NULL) |
| `numero_guia_operadora` | (nao existe na tabela) |
| `valor_informado_cents` | `valor_apresentado_cents` |
| `glosas` (jsonb) | `glosa_codigo` + `glosa_descricao` (par varchar/text) |

**Vencedor:** Bloco 01 (migration owner define schema).

**Correcao:** INSERT e tipos do Bloco 02 Task 11 reescritos com nomes canonicos. `ImportDemonstrativoInput` expandido com `operadoraId` e `xmlStorageKey`. Glosa armazenada como primeiro par codigo+descricao (detalhe completo no XML original). Testes do Task 12 atualizados com colunas corretas.

### Colisao C3: resolveRecurso — Bloco 03 vs Bloco 04

**Tipo:** funcao duplicada em caminhos diferentes

- Bloco 03: `packages/tiss/src/resolve-recurso.ts` — standalone
- Bloco 04: `packages/tiss/src/recurso-glosa/recurso-lifecycle.ts` — dentro do lifecycle completo

**Vencedor:** Bloco 04 (dono do dominio, lifecycle mais rico).

**Correcao:** Nota de reconciliacao adicionada ao Bloco 03 Task 17.

### Colisao C4: RecursoStatus enum — 6 vs 7 valores

**Tipo:** enum SQL e TS com cardinalidades diferentes

- Bloco 03 SQL: 6 valores (sem `indeterminado`)
- Bloco 04 TS: 7 valores (com `indeterminado` para timeout SOAP)

**Vencedor:** Bloco 04 (precisa de `indeterminado` para tratamento de timeout no bloco 06).

**Correcao:** `indeterminado` adicionado ao enum `tiss.recurso_glosa_status` no Bloco 03 migration 0126. CHECK constraint de `sent_at` atualizado para incluir `indeterminado`.

### Colisao C5: Nome do enum SQL — `tiss.recurso_status` vs `tiss.recurso_glosa_status`

**Tipo:** cast SQL referenciando enum com nome errado

- Bloco 03 cria: `tiss.recurso_glosa_status`
- Bloco 04 referenciava: `tiss.recurso_status` em 8 casts SQL

**Vencedor:** Bloco 03 (migration owner define o nome).

**Correcao:** Todas as 8 ocorrencias de `tiss.recurso_status` no Bloco 04 substituidas por `tiss.recurso_glosa_status`.

### Colisao C6: Colunas ausentes em `tiss.recurso_glosa` — `item_count`, `total_recursado_cents`

**Tipo:** colunas usadas pelo Bloco 04 mas ausentes na migration do Bloco 03

- Bloco 04 faz INSERT/SELECT/UPDATE de `item_count` e `total_recursado_cents` em `tiss.recurso_glosa`
- Bloco 03 migration 0126 nao criava essas colunas

**Vencedor:** Bloco 04 (consumidor principal, precisa dos contadores denormalizados).

**Correcao:** Colunas `item_count integer NOT NULL DEFAULT 0` e `total_recursado_cents bigint NOT NULL DEFAULT 0` adicionadas a tabela `tiss.recurso_glosa` no Bloco 03 migration 0126.

### Colisao C7: Nome de coluna `justificativa` vs `justificativa_item`

**Tipo:** nome de coluna divergente em SQL INSERT/SELECT

- Bloco 03 migration cria: `justificativa_item` em `tiss.recurso_glosa_item`
- Bloco 04 referenciava: `justificativa` em INSERTs e SELECTs

**Vencedor:** Bloco 03 (migration owner).

**Correcao:** Todas as referencias SQL no Bloco 04 atualizadas: coluna `justificativa` -> `justificativa_item` em INSERTs (2 ocorrencias), SELECT (1 ocorrencia), e result type interface (1 ocorrencia).

### Colisao C8: Tabela fantasma `tiss.retorno_glosa`

**Tipo:** referencia a tabela inexistente

- Bloco 09 referenciava: `tiss.retorno_glosa` (em matview, GRANT, testes, queries)
- Tabela real: `tiss.glosa` (criada pelo Bloco 03 migration 0125)
- Nenhum bloco cria `tiss.retorno_glosa`

**Vencedor:** Bloco 03 (cria `tiss.glosa`).

**Correcao:** Todas as 10 ocorrencias de `tiss.retorno_glosa` no Bloco 09 substituidas por `tiss.glosa`.

### Colisao C9: Colunas ausentes no INSERT de `tiss.glosa` (teste Bloco 09)

**Tipo:** helper de teste omitia colunas NOT NULL

- Helper `criarGlosaAceita` do Bloco 09 inseriu `tiss.glosa` sem `demonstrativo_item_id`, `encounter_version_id`, `descricao_glosa` (todos NOT NULL no schema do Bloco 03)

**Vencedor:** Bloco 03 (schema canonico).

**Correcao:** Helper `criarGlosaAceita` no Bloco 09 reescrito para criar a cadeia completa: lote -> demonstrativo -> demonstrativo_item -> glosa com todos os campos NOT NULL preenchidos.

### Colisao C10: Colunas ausentes no INSERT de `tiss.recurso_glosa` (Bloco 04)

**Tipo:** INSERT omitia `encounter_version_id` e `numero_recurso` (NOT NULL)

- Bloco 04 `createRecursoGlosa` inseriu `tiss.recurso_glosa` sem `encounter_version_id` e `numero_recurso`
- Ambas colunas sao NOT NULL no schema do Bloco 03

**Vencedor:** Bloco 03 (schema canonico).

**Correcao:** `createRecursoGlosa` no Bloco 04 atualizado para: (a) derivar `encounter_version_id` da cadeia glosa -> guia -> encounter_version; (b) gerar `numero_recurso` via `tiss.next_recurso_number()`.

---

## 5. Suposicoes Erradas sobre Fases 0-4

| Bloco | Suposicao | Realidade | Impacto |
|-------|-----------|-----------|---------|
| 09 | Tabela `tiss.retorno_glosa` existe | A tabela correta e `tiss.glosa` (criada na propria Fase 5, Bloco 03) | **Critico** — corrigido (C8) |
| 02 | `tiss.demonstrativo` tem colunas `numero_protocolo`, `tipo`, `registro_ans`, `numero_demonstrativo` | Schema canonico usa `protocolo_operadora`, `kind`, sem `registro_ans`/`numero_demonstrativo` | **Critico** — corrigido (C2) |
| 04 | `tiss.recurso_glosa` nao requer `encounter_version_id` nem `numero_recurso` | Ambas sao NOT NULL no schema canonico (Bloco 03) | **Critico** — corrigido (C10) |
| 04 | Enum se chama `tiss.recurso_status` | Nome real: `tiss.recurso_glosa_status` (Bloco 03) | **Critico** — corrigido (C5) |
| 09 | `tiss.glosa` tem colunas `guia_id`, `valor_glosado_cents`, `codigo_glosa`, `status` apenas | Tabela tambem requer `demonstrativo_item_id`, `encounter_version_id`, `descricao_glosa` NOT NULL | **Medio** — corrigido (C9) |
| 02 | `tiss.demonstrativo_item` tem `glosas jsonb` | Schema usa par `glosa_codigo varchar(4)` + `glosa_descricao text` | **Medio** — corrigido (C2) |
| 06 | `TransportFactory` aceita opts generico | Existente usa `TissArquivoOptions` tipado | **Baixo** — compativel via overload |

**Suposicoes CONFIRMADAS (corretas):**
- `receiveLoteReturn(tx, loteId)` retorna `Result<LoteReturnedResult, LoteLifecycleFailure>` com falhas `lote_nao_encontrado` e `transicao_invalida`
- `TissTransport` interface com `submitRecursoGlosa`, `submitBatch`, `fetchDemonstrativo`
- `XmlBuilder` com metodo `optionalTag`
- `encodeIso8859(input: string): EncodeResult`
- `TENANT_SCHEMAS` inclui `tiss`
- `computeTissHash` exportado de `compute-tiss-hash.ts`
- `tiss.lote_status` enum com valores corretos
- `compute-variation.ts` tem placeholder `const glosasCents = 0` pronto para substituicao

---

## 6. Colisoes de Migration

**Nenhuma colisao de numero.** A sequencia 0123-0129 e continua e sem sobreposicao:

```
0123 (bloco 01) -> 0124 (bloco 01) -> 0125 (bloco 03) -> 0126 (bloco 03)
  -> 0127 (bloco 06) -> 0128 (bloco 09) -> 0129 (bloco 09)
```
