# Production readiness

Este documento é o gate operacional para permitir **dados reais de pacientes**. Código existente não equivale a evidência operacional: itens que dependem de AWS, auditoria, contrato ou decisão regulatória permanecem NO-GO até existir prova verificável.

## Gate de release

Produção só recebe um SHA quando todas as condições abaixo forem verdadeiras:

| Evidência | Como provar | Bloqueia deploy |
|---|---|---:|
| CI do mesmo SHA | workflow `ci` concluído com sucesso | Sim |
| Smoke E2E em homologação | `release-gate` verde para o mesmo SHA | Sim |
| Teste de capacidade | job `carga` do `release-gate` verde | Sim |
| Restore recente | `agendado` verde há no máximo 35 dias | Sim |
| Infra validada | `infra` verde e `terraform plan` revisado antes do apply | Sim |
| Storage durável | produção com `STORAGE_DRIVER=s3` e `STORAGE_KMS_KEY_ID` | Sim, fail-closed no processo |
| Security scanning | `security` sem achado bloqueante aceito | Sim para high/critical conhecidos |
| Pentest externo | relatório + tratamento dos high/critical | **Sim antes do primeiro paciente real** |
| Responsável de segurança | pessoa/função formalmente nomeada | **Sim antes do primeiro paciente real** |
| Política de segurança | `docs/politica-seguranca-informacao.md` aprovada pela organização | **Sim antes do primeiro paciente real** |
| Requisitos regulatórios do escopo vendido | lista VERIFICAR de `docs/certificacao-sbis.md` e `docs/funcionalidades-reguladas.md` fechada por responsável competente | **Sim quando aplicável** |

O workflow `deploy-production` verifica automaticamente CI, release gate e restore antes de obter credenciais AWS. Ele não substitui pentest, aprovação organizacional ou avaliação regulatória.

## GitHub Environment `staging`

Configure:

- Variable `STAGING_WEB_URL`: origem HTTPS do frontend de homologação.
- Variable `STAGING_API_URL`: origem HTTPS da API de homologação.
- Secret `STAGING_E2E_EMAIL`: conta sintética exclusiva de smoke.
- Secret `STAGING_E2E_PASSWORD`: senha dessa conta.

Homologação não deve usar paciente real. Os dados precisam ser sintéticos e descartáveis.

## GitHub Environment `production`

Proteja o environment com aprovação manual e restrinja deployment à branch `main`. Configure as variables produzidas pelo Terraform:

- `AWS_PRODUCTION_ROLE_ARN`
- `ECR_REPOSITORY_URI`
- `ECS_CLUSTER`
- `ECS_API_SERVICE`
- `ECS_WORKER_SERVICE`
- `ECS_API_CONTAINER`
- `ECS_WORKER_CONTAINER`
- `ECS_MIGRATION_TASK_DEFINITION`
- `ECS_MIGRATION_CONTAINER`
- `ECS_PRIVATE_SUBNETS`
- `ECS_SECURITY_GROUPS`
- `PRODUCTION_API_URL`

A role deve confiar no OIDC do GitHub apenas para este repositório/environment e conceder o mínimo necessário para ECR/ECS. Segredos de aplicação pertencem ao Secrets Manager e às task definitions, nunca ao workflow como texto.

## Restore drill

O workflow `agendado` já executa restauração de snapshot em rede isolada, valida invariantes e publica relatório. Antes do primeiro GO, execute-o manualmente e guarde um resultado PASS. Depois disso, o deploy recusa evidência com mais de 35 dias.

## Critério GO / NO-GO

**GO** significa: todos os gates técnicos automatizados verdes, Terraform aplicado na conta correta, alarmes confirmados, restore PASS recente, pentest sem high/critical aberto, política/processos aprovados e requisitos regulatórios aplicáveis fechados.

Qualquer ausência de evidência é **NO-GO**, não “provavelmente funciona”. Demo e homologação continuam permitidas apenas com dados sintéticos.
