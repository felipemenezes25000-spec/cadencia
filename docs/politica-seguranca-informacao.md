# Política de Segurança da Informação — Cadência

**Status: minuta técnica.** Antes de dados reais, a organização deve aprovar esta política, nomear responsável, definir contatos e registrar data/versão de vigência. Um commit não substitui essa aprovação.

## Princípios

O acesso segue menor privilégio, necessidade de conhecer e segregação de funções. Dados de saúde recebem proteção reforçada. Produção e demonstração são ambientes separados; demo/homologação usam apenas dados sintéticos. Credenciais e segredos não pertencem ao repositório.

## Identidade e acesso

Acesso humano privilegiado exige conta individual e MFA. Contas compartilhadas são proibidas. Permissões devem ser revisadas periodicamente e removidas quando a função deixa de exigir acesso. Break-glass deve ser excepcional, auditado e revisado posteriormente.

No banco, aplicação, jobs e migrations mantêm papéis distintos. A credencial administrativa de migration não pode estar disponível ao runtime normal da API. A role do worker com BYPASSRLS não deve servir requisições de usuário.

## Criptografia e segredos

Tráfego externo de produção usa TLS. RDS e objetos S3 usam criptografia em repouso; anexos usam SSE-KMS. Workloads AWS usam IAM roles/OIDC em vez de access keys estáticas sempre que possível. Segredos de aplicação ficam no Secrets Manager e devem ser rotacionados após suspeita de exposição.

## Mudanças e releases

Código de produção precisa passar pelos gates automatizados definidos em `docs/production-readiness.md`. Imagens são identificadas por SHA. Migrations são forward-only. Deploy precisa ter caminho de rollback de aplicação, sem retroceder schema destrutivamente.

## Vulnerabilidades

CodeQL e auditoria de dependências rodam no repositório, e Dependabot acompanha atualizações. Antes do primeiro paciente real deve existir pentest independente; high/critical sem mitigação aceita formalmente bloqueiam GO. Vulnerabilidades reportadas seguem `SECURITY.md`.

## Logs, auditoria e privacidade

Logs operacionais não devem registrar conteúdo clínico, tokens, senhas ou payloads sensíveis. A trilha de auditoria clínica/segurança é distinta de logs de aplicação e não deve ser desativada para facilitar diagnóstico. Acesso a evidência de incidente deve ser restrito.

## Backup, continuidade e incidentes

Restore drill é mensal e deve respeitar RPO/RTO definidos. O runbook em `docs/runbook-producao.md` governa incidentes. Falhas com potencial exposição de dado pessoal exigem avaliação do responsável de segurança/DPO e das obrigações legais de comunicação.

## Terceiros e provedores

Provedores que tratem dados ou participem de fluxo clínico devem passar por avaliação contratual, de segurança, privacidade, residência/transferência de dados e requisitos regulatórios aplicáveis. Funcionalidade não deve ser publicada só porque o adapter técnico existe.

## Revisão

Revisar ao menos anualmente e sempre após incidente relevante, mudança material de arquitetura, alteração regulatória importante ou mudança de fornecedores críticos.
