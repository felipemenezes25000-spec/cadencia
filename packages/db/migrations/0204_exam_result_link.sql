-- 0204_exam_result_link.sql
-- Forward-only: resultado de exame passa a poder apontar para o pedido que o
-- originou. O vínculo é clínico/auditável e não pode ser reescrito depois.

ALTER TABLE clin.attachment
  ADD COLUMN request_document_id uuid;

ALTER TABLE clin.attachment
  ADD CONSTRAINT fk_attachment_exam_request
  FOREIGN KEY (tenant_id, request_document_id)
  REFERENCES clin.document (tenant_id, id);

CREATE INDEX ix_attachment_exam_request
  ON clin.attachment (tenant_id, request_document_id, created_at DESC)
  WHERE request_document_id IS NOT NULL AND purged_at IS NULL;

CREATE TRIGGER no_mutate_exam_request
  BEFORE UPDATE OF request_document_id ON clin.attachment
  FOR EACH ROW EXECUTE FUNCTION clin.deny_mutation();

COMMENT ON COLUMN clin.attachment.request_document_id IS
  'Pedido de exame (clin.document kind=pedido_exame) que originou este resultado; imutavel apos INSERT.';
