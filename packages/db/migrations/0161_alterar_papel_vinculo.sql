-- Migration 0161: SECURITY DEFINER function to change a membership's role.
-- Bypasses RLS on app.membership (which restricts reads to own rows).

CREATE FUNCTION app.alterar_papel_vinculo(
  p_clinic_id uuid,
  p_user_id   uuid,
  p_novo_role text
)
RETURNS TABLE (r_membership_id uuid, r_antigo_role text)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  WITH old AS (
    SELECT id, role
      FROM app.membership
     WHERE clinic_id  = p_clinic_id
       AND user_id    = p_user_id
       AND tenant_id  = app.current_tenant_id()
       AND revoked_at IS NULL
    FOR UPDATE
  )
  UPDATE app.membership m
     SET role = p_novo_role
    FROM old
   WHERE m.id = old.id
  RETURNING old.id AS r_membership_id, old.role AS r_antigo_role;
$$;

ALTER FUNCTION app.alterar_papel_vinculo(uuid, uuid, text) OWNER TO id_equipe;
REVOKE ALL ON FUNCTION app.alterar_papel_vinculo(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.alterar_papel_vinculo(uuid, uuid, text) TO app_rw;
