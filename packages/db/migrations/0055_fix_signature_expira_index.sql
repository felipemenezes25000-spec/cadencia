-- 0055_fix_signature_expira_index.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Corrige ix_signature_expira (0052): todo indice de tabela multi-tenant DEVE
-- comecar por tenant_id, senao o invariante 8 (DDL lint) reprova.

DROP INDEX clin.ix_signature_expira;
CREATE INDEX ix_signature_expira ON clin.signature (tenant_id, cert_not_after)
  WHERE retimestamped_at IS NULL;
