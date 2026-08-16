# Runbook de produção

## Objetivos operacionais

Estes são alvos iniciais, não promessas contratuais: disponibilidade mensal da API de 99,9%; RPO de até 15 minutos; RTO de até 120 minutos; nenhuma perda tolerada de registro clínico já confirmado por uma resposta de sucesso. Ajuste os SLOs depois de medir tráfego real.

## Sinais mínimos

A baseline Terraform habilita Container Insights, logs de API/worker/migration, alarmes de 5xx e saúde do ALB e alarmes de CPU/espaço do RDS. Todo 500 inesperado da API deve produzir log estruturado com `requestId`; o cliente recebe o mesmo identificador sem mensagem interna do banco.

Antes do GO, confirme que o tópico de alarmes possui pelo menos um assinante operacional e teste a rota de notificação. Alarme sem destinatário não conta como observabilidade.

## Incidente de aplicação

1. Identifique SHA e task definition em produção.
2. Correlacione horário/requestId com logs CloudWatch.
3. Se o erro nasceu no release atual, use `rollback-production` para voltar API e worker às revisões anteriores conhecidas.
4. **Não reverta migrations forward-only.** Corrija schema por nova migration quando necessário.
5. Faça smoke `/health` e valide os fluxos afetados.
6. Registre causa, impacto, janela, tenants potencialmente afetados e ações preventivas.

## Suspeita de quebra de isolamento ou acesso indevido

1. Trate como incidente de segurança, não como bug comum.
2. Suspenda o caminho afetado quando necessário para impedir nova exposição.
3. Preserve logs/auditoria; não apague evidência para “limpar” o ambiente.
4. Delimite tenants, usuários, recursos e intervalo de tempo afetados.
5. Acione responsável de segurança/DPO e o processo jurídico de incidente/LGPD aplicável.
6. Só reabra o fluxo depois de teste de regressão que reproduza e impeça a falha.

## Banco indisponível ou integridade incerta

Não promova nova versão durante incidente de banco. Se a integridade estiver incerta, priorize preservação e diagnóstico antes de aceitar novas escritas. O restore drill é a prova periódica de que o caminho de recuperação funciona; recuperação real deve usar snapshot/PITR apropriado e validar os invariantes antes de devolver tráfego.

## Storage de anexos

Em produção, API e worker recusam boot sem S3 + KMS. Se houver erro S3/KMS, não troque temporariamente para filesystem: em Fargate ele é efêmero. Corrija IAM, KMS, rede ou serviço e valide leitura/escrita de um objeto sintético.

## Rollback

O deploy automático guarda as task definitions anteriores e tenta rollback quando a promoção falha. Para intervenção manual, `rollback-production` exige explicitamente as revisões de API e worker. A imagem é imutável e identificada pelo SHA, então a revisão anterior deve apontar para exatamente o artefato já validado.
