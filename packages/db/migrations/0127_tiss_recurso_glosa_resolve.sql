-- 0127_tiss_recurso_glosa_resolve.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Adiciona colunas para resolucao do recurso de glosa:
-- - resolved_at em recurso_glosa (quando a operadora respondeu)
-- - resultado em recurso_glosa_item (deferido/indeferido por item)
-- - GRANT UPDATE em recurso_glosa_item para app_rw
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

-- ---------------------------------------------------------------------------
-- 1. resolved_at em recurso_glosa
-- ---------------------------------------------------------------------------
ALTER TABLE tiss.recurso_glosa
  ADD COLUMN resolved_at timestamptz(3);

-- Backfill: registros que ja estao em status final recebem resolved_at = sent_at
UPDATE tiss.recurso_glosa
   SET resolved_at = COALESCE(sent_at, clock_timestamp())
 WHERE status IN ('deferido', 'indeferido', 'parcial')
   AND resolved_at IS NULL;

-- resolved_at obrigatorio quando status final, ausente nos demais
ALTER TABLE tiss.recurso_glosa
  ADD CONSTRAINT ck_recurso_glosa_resolved_at CHECK (
    (status IN ('deferido', 'indeferido', 'parcial') AND resolved_at IS NOT NULL)
    OR (status NOT IN ('deferido', 'indeferido', 'parcial') AND resolved_at IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 2. resultado em recurso_glosa_item (por item: deferido ou indeferido)
-- ---------------------------------------------------------------------------
ALTER TABLE tiss.recurso_glosa_item
  ADD COLUMN resultado text;

-- ---------------------------------------------------------------------------
-- 3. GRANT UPDATE em recurso_glosa_item para app_rw
-- ---------------------------------------------------------------------------
GRANT UPDATE (resultado) ON tiss.recurso_glosa_item TO app_rw;
