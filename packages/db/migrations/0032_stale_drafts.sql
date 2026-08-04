-- 0032_stale_drafts.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.4 — a politica do rascunho orfao. Rascunho parado ha 7 dias e
-- auto-finalizado como versao kind='original' com incompleto = true.
--
-- Esta funcao APENAS LISTA, e roda com o papel `jobs`, o unico com BYPASSRLS:
-- varrer todos os tenants e exatamente o que a RLS impede a aplicacao de fazer.
-- A finalizacao acontece depois, tenant a tenant, dentro de withTenantTx.

CREATE FUNCTION clin.stale_drafts(p_limite interval DEFAULT interval '7 days')
RETURNS TABLE (
  tenant_id       uuid,
  encounter_id    uuid,
  professional_id uuid,
  clinic_id       uuid,
  updated_at      timestamptz(3))
LANGUAGE sql STABLE AS $$
  SELECT d.tenant_id, d.encounter_id, e.professional_id, e.clinic_id, d.updated_at
    FROM clin.encounter_draft d
    JOIN clin.encounter e ON (e.tenant_id, e.id) = (d.tenant_id, d.encounter_id)
   WHERE e.status = 'rascunho'
     AND d.updated_at < clock_timestamp() - p_limite
   ORDER BY d.updated_at
$$;

ALTER FUNCTION clin.stale_drafts(interval) OWNER TO app_owner;
REVOKE ALL ON FUNCTION clin.stale_drafts(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clin.stale_drafts(interval) TO jobs;

-- BYPASSRLS ignora POLICY, nao ignora GRANT. A funcao e SECURITY INVOKER de
-- proposito — e o BYPASSRLS de `jobs` que faz a varredura enxergar todos os
-- tenants — e por isso `jobs` precisa do schema e da leitura das duas tabelas,
-- senao a varredura morre em 42501 antes de a policy sequer ser avaliada.
-- SELECT apenas: quem escreve e clin.finalize_encounter, tenant a tenant.
GRANT USAGE  ON SCHEMA clin TO jobs;
GRANT SELECT ON clin.encounter       TO jobs;
GRANT SELECT ON clin.encounter_draft TO jobs;
