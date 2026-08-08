# Fase 4 -- Reconciliacao de Contratos entre Blocos

> Gerado automaticamente pela reconciliacao dos 11 blocos do plano da Fase 4.
> Data: 2026-08-07

---

## 1. Ordem final dos blocos (por dependencia)

| Ordem | Bloco | Titulo | Depende de |
|-------|-------|--------|------------|
| 1 | 01 | operadora-contrato | (nenhum) |
| 2 | 02 | tuss-carga | (nenhum) |
| 3 | 03 | guia-modelo | 01 |
| 4 | 04 | guia-projecao | 01, 03 |
| 5 | 05 | reprojecao-amend | 03, 04 |
| 6 | 06 | lote | 01, 03 |
| 7 | 07 | xml-serializer | 03 |
| 8 | 08 | tiss-transport | 07 |
| 9 | 10 | api-rbac | 01, 03, 06 |
| 10 | 09 | convenios-telas | 10 |
| 11 | 11 | invariantes-dod | TODOS |

Blocos 01 e 02 podem ser executados em paralelo (sem dependencia mutua).
Blocos 06 e 07 podem ser executados em paralelo apos 03.

---

## 2. Mapa de migrations (0110 em diante)

| Migration | Tabela / Objeto | Bloco |
|-----------|----------------|-------|
| 0110 | `tiss.operadora` | 01 |
| 0111 | `tiss.contrato` | 01 |
| 0112 | `tiss.paciente_convenio` | 01 |
| 0113 | `ref.tuss_staging`, `ref.tuss_load_log` | 02 |
| 0114 | `tiss.encounter_guia_consulta` | 03 |
| 0115 | `tiss.guia_ajuste` | 03 |
| 0116 | `tiss.guia_counter` | 03 |
| 0117 | projecao encounter -> guia (procedure/trigger) | 04 |
| 0118 | `tiss.guia_pendencia` + outbox `ENCOUNTER_AMENDED` | 05 |
| 0119 | `tiss.lote`, `tiss.lote_guia` | 06 |
| 0120 | `tiss.lote_number_counter` | 06 |
| -- | Blocos 07-11 nao criam migrations | -- |

**Colisoes de migration: 0 (zero).** Cada bloco opera em sua faixa atribuida.

---

## 3. Tabela de contratos unificados

### 3.1 DDL -- tiss.operadora (definida pelo Bloco 01, migration 0110)

Coluna canonica conforme DDL do Bloco 01 (com emendas da reconciliacao):

| Coluna | Tipo | Origem |
|--------|------|--------|
| `tenant_id` | uuid NOT NULL | Bloco 01 |
| `id` | uuid NOT NULL | Bloco 01 |
| `registro_ans` | char(6) NOT NULL | Bloco 01 |
| `razao_social` | text NOT NULL COLLATE "pt-BR-x-icu" | Bloco 01 |
| `nome_fantasia` | text | Bloco 01 |
| `cnpj` | varchar(14) NOT NULL | Bloco 01 |
| `telefone` | text | Bloco 01 |
| `email` | text | Bloco 01 |
| `portal_url` | text | Bloco 01 |
| `portal_login` | text | Bloco 01 |
| `portal_obs` | text | Bloco 01 |
| `tiss_version` | varchar(5) NOT NULL DEFAULT '3.05' | Adicionado na reconciliacao (usado por Blocos 06, 10) |
| `transport_mode` | text NOT NULL DEFAULT 'arquivo' CHECK IN ('arquivo','webservice') | Adicionado na reconciliacao (usado por Bloco 10) |
| `active` | boolean NOT NULL DEFAULT true | Bloco 01 |
| `created_at` | timestamptz(3) NOT NULL DEFAULT clock_timestamp() | Bloco 01 |
| `created_by` | uuid NOT NULL | Bloco 01 |

### 3.2 DDL -- tiss.contrato (definida pelo Bloco 01, migration 0111)

| Coluna canonica | Nota |
|----------------|------|
| `tenant_id` | uuid NOT NULL |
| `id` | uuid NOT NULL |
| `operadora_id` | uuid NOT NULL (FK) |
| `clinic_id` | uuid NOT NULL (FK) -- Blocos 04 e 05 omitiam |
| `codigo_prestador_na_operadora` | varchar(14) NOT NULL |
| `tipo_acomodacao` | char(1) NOT NULL DEFAULT '1' |
| `abrangencia` | text NOT NULL DEFAULT 'nacional' |
| `vigencia_inicio` | date NOT NULL |

**CNES NAO e coluna de tiss.contrato.** O CNES e atributo de `app.clinic`. Blocos 04 e 05 inseriam `cnes` no contrato por engano.

### 3.3 DDL -- tiss.paciente_convenio (definida pelo Bloco 01, migration 0112)

| Coluna canonica | Nota |
|----------------|------|
| `nome_plano` | Bloco 05 usava `plano` -- corrigido para `nome_plano` |

### 3.4 Funcoes e tipos exportados

| Nome | Assinatura | Arquivo | Define | Consome |
|------|-----------|---------|--------|---------|
| `createOperadora` | `(tx, input) => Result<{id}, DomainError>` | `packages/tiss/src/operadora.ts` | Bloco 01 | Bloco 10 |
| `updateOperadora` | `(tx, input) => Result<{id}, DomainError>` | `packages/tiss/src/operadora.ts` | Bloco 01 | Bloco 10 |
| `listOperadoras` | `(tx) => Result<Operadora[], DomainError>` | `packages/tiss/src/operadora.ts` | Bloco 01 | Bloco 10 |
| `createContrato` | `(tx, input) => Result<{id}, DomainError>` | `packages/tiss/src/contrato.ts` | Bloco 01 | Bloco 10 |
| `linkPacienteConvenio` | `(tx, input) => Result<{id}, DomainError>` | `packages/tiss/src/paciente-convenio.ts` | Bloco 01 | Bloco 10 |
| `loadTussCompetenciaSafe` | `(pool, data, opts) => Result<LoadResult, E>` | `packages/tiss/src/tuss-loader.ts` | Bloco 02 | (standalone) |
| `createEncounterGuia` | `(tx, encounterId) => Result<GuiaId, E>` | `packages/tiss/src/guia-consulta.ts` | Bloco 03 | Bloco 04 |
| `adjustGuia` | `(tx, guiaId, ajuste) => Result<void, E>` | `packages/tiss/src/guia-ajuste.ts` | Bloco 03 | Bloco 10 |
| `projectGuiaConsulta` | `(tx, encounterId, encounterVersionId) => Result<void, E>` | `packages/tiss/src/project-guia.ts` | Bloco 04 | Bloco 05 |
| `reprojectGuiaOnAmend` | `(tx, encounterId) => Result<void, E>` | `packages/tiss/src/reproject-guia.ts` | Bloco 05 | worker (outbox) |
| `createLote` | `(tx, input) => Result<{id, numeroLote}, E>` | `packages/tiss/src/lote.ts` | Bloco 06 | Bloco 10 |
| `addGuiaToLote` | `(tx, loteId, guiaId) => Result<void, E>` | `packages/tiss/src/lote.ts` | Bloco 06 | Bloco 10 |
| `removeGuiaFromLote` | `(tx, loteId, guiaId) => Result<void, E>` | `packages/tiss/src/lote.ts` | Bloco 06 | Bloco 10 |
| `markLoteReady` | `(tx, loteId) => Result<void, E>` | `packages/tiss/src/lote.ts` | Bloco 06 | Bloco 10 |
| `markLoteSent` | `(tx, loteId, receipt) => Result<void, E>` | `packages/tiss/src/lote.ts` | Bloco 06 | Bloco 10 |
| `receiveLoteReturn` | `(tx, loteId, retorno) => Result<void, E>` | `packages/tiss/src/lote.ts` | Bloco 06 | Bloco 10 |
| `cancelLote` | `(tx, loteId) => Result<void, E>` | `packages/tiss/src/lote.ts` | Bloco 06 | Bloco 10 |
| `serializeLoteConsulta` | `(lote: LoteConsultaInput) => Uint8Array` | `packages/tiss/src/xml-serializer.ts` | Bloco 07 | Bloco 08, 10 |
| `XmlBuilder` | `class { el, attr, text, build }` | `packages/tiss/src/xml-builder.ts` | Bloco 07 | Bloco 07 (interno) |
| `encodeIso8859` | `(str: string) => Uint8Array` | `packages/tiss/src/encoding.ts` | Bloco 07 | Bloco 07 (interno) |
| `computeTissHash` | `(xmlBytes: Uint8Array) => string` | `packages/tiss/src/tiss-hash.ts` | Bloco 07 | Bloco 07 (interno) |
| `TissArquivoTransport` | `implements TissTransport` | `packages/tiss/src/tiss-arquivo-transport.ts` | Bloco 08 | Bloco 10 |
| `StorageAdapter` | `interface { put, get, exists, delete }` | `packages/storage/src/index.ts` | Bloco 08 | Bloco 08 |
| `semearTiss` | `(pool) => TissSemente` | `packages/tiss/src/test-support.ts` | Bloco 01 (base), Bloco 04 (expandido) | Blocos 04, 05, 06 |

### 3.5 Acoes RBAC unificadas (notacao DOT, conforme codebase)

| Chave | Descricao | Roles | Define |
|-------|-----------|-------|--------|
| `tiss.operadora.read` | Listar operadoras de convenio | admin_clinico, diretor_tecnico, financeiro, recepcao | Bloco 01 |
| `tiss.operadora.write` | Criar ou editar operadora | admin_clinico, financeiro | Bloco 01 |
| `tiss.contrato.read` | Listar contratos com operadoras | admin_clinico, diretor_tecnico, financeiro | Bloco 01 |
| `tiss.contrato.write` | Criar ou editar contrato | admin_clinico, financeiro | Bloco 01 |
| `tiss.paciente_convenio.read` | Listar convenios do paciente | admin_clinico, diretor_tecnico, profissional, recepcao, financeiro | Bloco 01 |
| `tiss.paciente_convenio.write` | Vincular paciente a convenio | admin_clinico, recepcao | Bloco 01 |
| `tiss.guia.read` | Visualizar guias TISS | admin_clinico, diretor_tecnico, profissional, recepcao, financeiro | Bloco 10 |
| `tiss.guia.adjust` | Ajustar codigo na guia | admin_clinico, financeiro | Bloco 10 |
| `tiss.lote.manage` | Criar, montar e cancelar lotes | admin_clinico, recepcao, financeiro | Bloco 10 |
| `tiss.lote.send` | Enviar lote para operadora | admin_clinico, financeiro | Bloco 10 |

**Decisao:** `tiss.operadora.manage` do Bloco 10 foi desmembrado em `tiss.operadora.read` + `tiss.operadora.write` (padrao do codebase). Rotas GET usam `.read`, rotas POST/PUT/DELETE usam `.write`.

### 3.6 Fixtures unificados

| Constante | UUID | Define |
|-----------|------|--------|
| `OPERADORA_A` | `01930000-0000-7000-8000-000000000f01` | Bloco 01 |
| `OPERADORA_B` | `01930000-0000-7000-8000-000000000f02` | Bloco 01 |
| `CONTRATO_A` | `01930000-0000-7000-8000-000000000f03` | Bloco 01 |
| `CONTRATO_B` | `01930000-0000-7000-8000-000000000f04` | Bloco 01 |
| `PACIENTE_CONVENIO_A` | `01930000-0000-7000-8000-000000000f05` | Bloco 01 |
| `GUIA_CONSULTA_A` | `01930000-0000-7000-8000-0000000000f8` | Bloco 03 |
| `GUIA_CONSULTA_B` | `01930000-0000-7000-8000-0000000000f9` | Bloco 03 |
| `GUIA_AJUSTE_A` | `01930000-0000-7000-8000-0000000000fa` | Bloco 03 |
| `GUIA_AJUSTE_B` | `01930000-0000-7000-8000-0000000000fb` | Bloco 03 |
| `LOTE_A` | (definido pelo Bloco 06) | Bloco 06 |
| `LOTE_B` | (definido pelo Bloco 06) | Bloco 06 |

### 3.7 Eventos de dominio

| Evento | Define | Consome |
|--------|--------|---------|
| `ENCOUNTER_AMENDED` | Bloco 05 (Task 28) -- NAO existe nas Fases 0-3, sera criado | Bloco 05 (reprojecao) |

### 3.8 Arquivos de teste ISO

| Numero | Arquivo | Bloco |
|--------|---------|-------|
| 31 | `31-guia-consulta.iso.test.ts` | 03 |
| 32 | `32-guia-ajuste.iso.test.ts` | 03 |
| 33 | `33-guia-counter.iso.test.ts` | 03 |
| 34 | `34-guia-pendencia.iso.test.ts` | 05 (renumerado de 32 para 34) |

---

## 4. Colisoes encontradas e resolucao

### 4.1 Colisoes de contrato (interfaces incompativeis)

| # | Colisao | Blocos | Vencedor | Resolucao |
|---|---------|--------|----------|-----------|
| C1 | Fixture `OPERADORA_A` UUID: `...f01` vs `...f6` | 01 vs 03 | 01 | Bloco 03 corrigido para `...f01` |
| C2 | Fixture `OPERADORA_B` UUID: `...f02` vs `...f7` | 01 vs 03 | 01 | Bloco 03 corrigido para `...f02` |
| C3 | Coluna `nome` vs `razao_social` em tiss.operadora | 04, 05, 06, 10 vs 01 | 01 (DDL) | Blocos 04, 06 corrigidos nos seeds; Bloco 10 documentado (correcao sistematica pendente, ver 4.3) |
| C4 | Coluna `ativa` vs `active` em tiss.operadora | 04 vs 01 | 01 (DDL) | Bloco 04 corrigido |
| C5 | Coluna `cnes` em tiss.contrato (nao existe) | 04 vs 01 | 01 (DDL) | Bloco 04 corrigido para usar `clinic_id` |
| C6 | Coluna `plano` vs `nome_plano` em paciente_convenio | 05 vs 01 | 01 (DDL) | Bloco 05 corrigido |
| C7 | Coluna `tiss_version` ausente no DDL de tiss.operadora | 06, 10 vs 01 | Todos | Bloco 01 emendado: adicionou `tiss_version` |
| C8 | Coluna `transport_mode` ausente no DDL de tiss.operadora | 10 vs 01 | Todos | Bloco 01 emendado: adicionou `transport_mode` |
| C9 | Authz colon notation (`tiss:x:y`) vs dot notation (`tiss.x.y`) | 10, 11 vs codebase | Codebase (dot) | Blocos 10 e 11 corrigidos: 51+ ocorrencias de `:` -> `.` |
| C10 | `tiss.operadora.manage` vs `tiss.operadora.read`/`.write` | 10 vs 01 | 01 (read/write split) | Bloco 10 corrigido: removeu `.manage` da definicao de acoes, nota de reconciliacao adicionada |
| C11 | Fixture `F.GUIA_A`/`F.GUIA_B` vs `F.GUIA_CONSULTA_A`/`F.GUIA_CONSULTA_B` | 06 vs 03 | 03 (quem define) | Bloco 06 corrigido |
| C12 | Teste ISO `32-guia-ajuste` vs `32-guia-pendencia` | 03 vs 05 | Ambos (renumeracao) | Bloco 05 renumerado para `34-guia-pendencia` |
| C13 | `test-support.ts` criado 3 vezes (Criar vs Acrescentar) | 01, 04, 05 | 01 (cria), 04 e 05 (acrescentam) | Blocos 04 e 05 corrigidos: "Criar" -> "Acrescentar/Modificar" |
| C14 | Referencia de bloco errada: "bloco 02" para operadora | 03 | 01 (quem define) | Bloco 03 corrigido: "bloco 02" -> "bloco 01" |
| C15 | `clinic_id` ausente em seed de tiss.contrato | 04, 05 | 01 (DDL: NOT NULL) | Blocos 04 e 05 corrigidos |

### 4.2 Colisoes de migration

**Nenhuma colisao.** Cada bloco opera em sua faixa atribuida (0110-0112, 0113, 0114-0116, 0117, 0118, 0119-0120). O Bloco 06 declarou 0121 no enunciado mas nao a utiliza.

### 4.3 Correcoes pendentes (a fazer na implementacao)

| # | Descricao | Blocos afetados |
|---|-----------|----------------|
| P1 | Bloco 10: todas as queries SQL que referenciam `tiss.operadora.nome` devem usar `razao_social`. Sao ~15 ocorrencias em INSERTs, SELECTs e UPDATEs. O DTO/API pode manter `nome` como campo JSON, mas o SQL deve usar a coluna real. | 10 |
| P2 | Bloco 10: rotas que ainda usam `tiss.operadora.manage` no `rota()` precisam ser desmembradas: GET -> `tiss.operadora.read`, POST/PUT/DELETE -> `tiss.operadora.write`. | 10 |
| P3 | Bloco 04: 6 ocorrencias de `operadora_nome` na projecao consulta fazem `SELECT nome` da operadora -- deve ser `SELECT razao_social AS operadora_nome`. | 04 |
| P4 | Bloco 06: a coluna `tiss_version` no DDL de tiss.lote (migration 0119) deve ser compativel com o tipo `varchar(5)` definido no Bloco 01. | 06 |
| P5 | Bloco 05: o `test-support.ts` expandido precisa importar/reexportar as interfaces do Bloco 01 para manter compatibilidade com testes ja escritos. | 05 |

---

## 5. Resumo das correcoes aplicadas nos arquivos

### Bloco 01 (`01-operadora-contrato.md`)
- Adicionadas colunas `tiss_version` e `transport_mode` ao DDL de `tiss.operadora`

### Bloco 03 (`03-guia-modelo.md`)
- Fixture `OPERADORA_A`: `...f6` -> `...f01`
- Fixture `OPERADORA_B`: `...f7` -> `...f02`
- Referencia de bloco: "bloco 02, migration 0110" -> "bloco 01, migration 0110"
- Comentario de fixture: "criada pelo bloco 02" -> "criada pelo bloco 01"

### Bloco 04 (`04-guia-projecao.md`)
- Seed de tiss.operadora: `nome, ativa` -> `razao_social, active` (3 ocorrencias)
- Seed de tiss.contrato: removeu `cnes`, adicionou `clinic_id` e `s.clinicId` nos params (3 ocorrencias)
- `test-support.ts`: "Criar" -> "Modificar" (criado pelo Bloco 01, expandido aqui)

### Bloco 05 (`05-reprojecao-amend.md`)
- Seed de tiss.paciente_convenio: `plano` -> `nome_plano`
- Seed de tiss.contrato: adicionou `clinic_id` e `s.clinicId` nos params
- Teste ISO: `32-guia-pendencia` -> `34-guia-pendencia` (evita colisao com Bloco 03)
- `test-support.ts`: "Criar" -> "Acrescentar" (criado pelo Bloco 01, expandido pelo Bloco 04)

### Bloco 06 (`06-lote.md`)
- Fixture: `F.GUIA_A` -> `F.GUIA_CONSULTA_A` (todas ocorrencias)
- Fixture: `F.GUIA_B` -> `F.GUIA_CONSULTA_B` (todas ocorrencias)
- Seed de tiss.operadora: `nome` -> `razao_social` (4 ocorrencias)

### Bloco 10 (`10-api-rbac.md`)
- Authz actions: `tiss:operadora:manage` -> `tiss.operadora.manage` (dot notation)
- Authz actions: `tiss:guia:read` -> `tiss.guia.read` (dot notation)
- Authz actions: `tiss:guia:adjust` -> `tiss.guia.adjust` (dot notation)
- Authz actions: `tiss:lote:manage` -> `tiss.lote.manage` (dot notation)
- Authz actions: `tiss:lote:send` -> `tiss.lote.send` (dot notation)
- Total: 51 substituicoes de `:` para `.` na notacao de acoes
- Removeu `tiss.operadora.manage` da definicao de acoes (substituido por `.read`/`.write` do Bloco 01)
- Adicionou nota de reconciliacao sobre o desmembramento

### Bloco 11 (`11-invariantes-dod.md`)
- Authz actions: todas 5 acoes corrigidas de colon para dot notation
- Total: 19 substituicoes

### Blocos NAO alterados
- **Bloco 02** (`02-tuss-carga.md`): nenhuma colisao detectada
- **Bloco 07** (`07-xml-serializer.md`): nenhuma colisao detectada
- **Bloco 08** (`08-tiss-transport.md`): nenhuma colisao detectada
- **Bloco 09** (`09-convenios-telas.md`): nenhuma colisao detectada (consome API, nao define contratos)
