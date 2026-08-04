-- 0041_patient_collation.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §10 item 19 — regra vinculante: toda coluna cuja ordenacao seja apresentada a
-- um humano recebe COLLATE "pt-BR-x-icu" explicito, e o indice que a serve carrega
-- a mesma collation. Ordenar sem collation nao e um bug que aparece em teste:
-- aparece como um paciente "sumido" da lista para a recepcionista.
--
-- display_name e GERADA e ja aplica o Decreto 8.727/2016 (nome social em TODA
-- exibicao). A listagem ordena por ela; a busca continua em search_name, que e
-- unaccent(lower(...)) e imune ao locale.

ALTER TABLE clin.patient
  ADD COLUMN display_name text COLLATE "pt-BR-x-icu"
    GENERATED ALWAYS AS (coalesce(nome_social, full_name)) STORED;

CREATE INDEX ix_patient_ordem
  ON clin.patient (tenant_id, display_name COLLATE "pt-BR-x-icu", id)
  WHERE inactivated_at IS NULL AND merged_into_id IS NULL;

COMMENT ON COLUMN clin.patient.display_name IS
  'Nome de exibicao com collation pt-BR. Decreto 8.727/2016: nome social vence.';
