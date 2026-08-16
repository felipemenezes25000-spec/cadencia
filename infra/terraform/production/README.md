# Produção AWS

Baseline da topologia de produção do Cadência: ALB/WAF → ECS Fargate (API + worker) → RDS Multi-AZ, com objetos em S3/KMS, logs CloudWatch e alarmes SNS.

## O que é pré-requisito

A rede é deliberadamente entrada do módulo: VPC, subnets públicas/privadas e security groups precisam existir antes. Também é necessário um certificado ACM para o listener HTTPS e um backend remoto S3 para o state do Terraform. Não use state local para produção.

Os security groups devem permitir somente: Internet → ALB:443; ALB → ECS:3001; ECS → RDS:5432; ECS → HTTPS:443 para AWS/provedores necessários. RDS não recebe IP público.

## Secrets

`api_secrets`, `worker_secrets` e `migration_secrets` são mapas `NOME_ENV => ARN do Secrets Manager`. O task execution role recebe apenas `GetSecretValue` nesses ARNs. O runtime usa IAM Task Role para S3/KMS, sem access key estática.

A task de migration é separada porque `DATABASE_URL_ADMIN` não deve existir na API nem no worker. As credenciais `api` e `jobs` continuam separadas, conforme o desenho de privilégios do banco.

## Bootstrap

1. Crie backend remoto do Terraform e a role OIDC usada pelo GitHub Environment `production`.
2. Preencha `terraform.tfvars` fora do repositório com IDs/ARNs da conta e os mapas de secrets.
3. `terraform init -backend-config=...`
4. `terraform plan -out=tfplan`
5. Revise o plano e `terraform apply tfplan`.
6. Copie os outputs para as variables do GitHub Environment `production` usando os mesmos nomes documentados em `docs/production-readiness.md`.
7. Execute `agendado` manualmente e obtenha um restore drill verde.
8. Execute `release-gate` na `main`.
9. Só então execute `deploy-production`.

`bootstrap_image` é apenas a imagem inicial necessária para o primeiro `terraform apply`. Depois disso, o workflow de deploy registra revisões imutáveis com tag igual ao SHA e o Terraform ignora mudanças de `task_definition` nos services para não desfazer releases.
