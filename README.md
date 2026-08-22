# Cadência PEC Público

Prontuário Eletrônico do Cidadão e plataforma de operação clínica para redes públicas de saúde.

O projeto mantém o núcleo clínico do Cadência — prontuário versionado, autosave, documentos, prescrições, anexos, auditoria, RLS, agenda, mensageria, teleconsulta e estoque — e passa a modelar a operação como **ente público → unidade CNES → equipe → profissional → cidadão**.

## Escopo público/SUS

- identificação do ente por município IBGE/UF e da unidade por CNES;
- equipes com INE;
- vínculo profissional com CNS, CBO, equipe e carga horária;
- cidadão com CPF/CNS e perfil territorial da APS;
- regulação e encaminhamentos entre unidades;
- terminologias CID-10, CID-11, CIAP-2 e SIGTAP versionadas pela data do evento;
- prontuário longitudinal, documentos clínicos e assinatura digital;
- agenda, fila, teleconsulta, anexos e comunicação;
- trilha de auditoria e isolamento multi-tenant por RLS;
- contratos explícitos para RNDS e e-SUS APS.

## Interoperabilidade

`packages/integrations` define as fronteiras `RndsGateway` e `EsusApsGateway`. Em ambiente sem credenciais oficiais, os adapters retornam **not_configured**: o sistema nunca simula transmissão bem-sucedida para RNDS/e-SUS.

CIAP-2 e SIGTAP possuem tabelas e APIs de consulta, mas **não são preenchidos com dados inventados**. A carga deve ser feita a partir das fontes oficiais, preservando competência e vigência.

## Arquitetura

```text
Web Next.js
   ↓
API Fastify
   ↓
PostgreSQL 18 + RLS
   ↓
Worker pg-boss / outbox

Domínio público
ente/município → unidade CNES → equipe INE → profissional CNS/CBO → cidadão CNS/CPF
                                      ↓
                            atendimento / regulação
                                      ↓
                         RNDS / e-SUS APS (adapters)
```

O banco continua usando `tenant` e `clinic` como nomes técnicos para compatibilidade e isolamento. Na camada de domínio e interface, eles correspondem a **ente público** e **unidade de saúde**.

## Desenvolvimento

Requisitos: Node.js 24+, pnpm 10.28.2, PostgreSQL 18 e Docker para o ambiente local.

```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm authz:seed
pnpm --filter @cadencia/api dev
pnpm --filter @cadencia/web dev
```

Validações principais:

```bash
pnpm typecheck
pnpm test
pnpm test:web
pnpm test:int
pnpm test:iso
pnpm arch:check
pnpm build:web
```

## Segurança clínica

- registros finalizados são imutáveis; correções geram nova versão;
- dados pessoais usam `no-store`;
- `tenant_id` + RLS forçada impedem vazamento entre entes;
- ações sensíveis passam por autorização e, quando definido, MFA;
- integrações externas usam contratos e idempotência, sem sucesso fictício;
- credenciais e certificados não pertencem ao repositório.
