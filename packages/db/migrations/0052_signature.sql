-- 0052_signature.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.11 e §10 item 7 — a assinatura. Porque assinamos o hash de uma serializacao
-- canonica NOSSA (JCS/RFC 8785, com canonical_version gravado ao lado) e
-- guardamos os bytes canonicos + PKCS#7 destacado + carimbo + material LTV,
-- qualquer verificador ICP-Brasil valida o documento daqui a 20 anos sem nos e
-- sem o PSC.

CREATE TABLE clin.signature (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  subject_kind  text NOT NULL CHECK (subject_kind IN
                  ('encounter_version','document','prescription')),
  subject_id    uuid NOT NULL,
  -- Os BYTES EXATOS que geraram o hash, no S3. Sem eles nao se verifica nada.
  canonical_key uuid NOT NULL,
  canonical_version text NOT NULL,
  hash_alg      text NOT NULL DEFAULT 'SHA-256',
  hash          bytea NOT NULL CHECK (octet_length(hash) = 32),
  policy_oid    text NOT NULL,
  standard      text NOT NULL CHECK (standard IN ('AD_RT','AD_RA')),  -- AD_RB NAO EXISTE
  psc           text NOT NULL,
  signer_user_id uuid NOT NULL,
  signer_cpf    varchar(11) NOT NULL CHECK (signer_cpf ~ '^[0-9]{11}$'),
  cert_serial   text NOT NULL,
  cert_not_after timestamptz(3) NOT NULL,
  pkcs7         bytea NOT NULL,
  timestamp_token bytea NOT NULL,      -- ACT credenciada: OBRIGATORIO
  ltv_material_key uuid NOT NULL,      -- cadeia + LCR/OCSP do instante da assinatura
  verified_status text NOT NULL CHECK (verified_status IN
                    ('valida','invalida','indeterminada')),
  verified_at   timestamptz(3) NOT NULL,
  retimestamped_at timestamptz(3),
  signed_at     timestamptz(3) NOT NULL,
  created_at    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (signer_user_id) REFERENCES id."user"(id));
ALTER TABLE clin.signature OWNER TO app_owner;

CREATE INDEX ix_signature_subject ON clin.signature (tenant_id, subject_kind, subject_id);
-- Job trimestral (§3.11): "documentos cuja verificabilidade expira nos proximos
-- 12 meses" -> re-carimbo. Sem este indice o job vira full scan do acervo.
CREATE INDEX ix_signature_expira ON clin.signature (cert_not_after)
  WHERE retimestamped_at IS NULL;

REVOKE ALL ON clin.signature FROM PUBLIC, app_rw;
GRANT SELECT, INSERT ON clin.signature TO app_rw;
GRANT UPDATE (verified_status, verified_at, retimestamped_at) ON clin.signature TO app_rw;

CREATE TRIGGER no_mutate BEFORE DELETE ON clin.signature
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();
CREATE TRIGGER no_mutate_update BEFORE UPDATE OF
  tenant_id, id, subject_kind, subject_id, canonical_key, canonical_version,
  hash_alg, hash, policy_oid, standard, psc, signer_user_id, signer_cpf,
  cert_serial, pkcs7, timestamp_token, ltv_material_key, signed_at
  ON clin.signature FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

ALTER TABLE clin.signature ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.signature FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.signature AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());
