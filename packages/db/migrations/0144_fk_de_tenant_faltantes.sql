-- 0144_fk_de_tenant_faltantes.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Oito tabelas com `tenant_id` nao tinham FK NENHUMA — nem para `app.tenant`,
-- nem para um pai que a tivesse. Sao todas raiz do proprio agregado: conta
-- bancaria, categoria, centro de custo, metodo de pagamento, contador de recibo,
-- fornecedor (fin e inv) e evento de webhook.
--
-- A consequencia apareceu como teste instavel, e nao como incidente: apagado o
-- tenant, a conta bancaria sobrevivia. Na proxima vez que um tenant nascesse com
-- o mesmo id — o que so acontece em teste, com id fixo —, o gatilho
-- `fin.provision_default_bank_account` tentava criar "Caixa Geral" de novo e
-- esbarrava em `bank_account_tenant_id_name_key`.
--
-- Em producao o efeito seria pior e mais silencioso: linha de dado financeiro
-- que a RLS nunca mais alcanca, porque `app.current_tenant_id()` jamais vai
-- apontar para um tenant que nao existe. Dado invisivel que continua ocupando o
-- indice unico e reaparece como conflito inexplicavel.

-- ── limpeza dos orfaos ──────────────────────────────────────────────────────
-- So o que aponta para tenant inexistente. Linha assim nao pertence a ninguem:
-- nao ha politica de RLS que a devolva e nao ha quem responda por ela.
DELETE FROM fin.bank_account x
 WHERE NOT EXISTS (SELECT 1 FROM app.tenant t WHERE t.id = x.tenant_id);
DELETE FROM fin.category x
 WHERE NOT EXISTS (SELECT 1 FROM app.tenant t WHERE t.id = x.tenant_id);
DELETE FROM fin.cost_center x
 WHERE NOT EXISTS (SELECT 1 FROM app.tenant t WHERE t.id = x.tenant_id);
DELETE FROM fin.payment_method x
 WHERE NOT EXISTS (SELECT 1 FROM app.tenant t WHERE t.id = x.tenant_id);
DELETE FROM fin.receipt_counter x
 WHERE NOT EXISTS (SELECT 1 FROM app.tenant t WHERE t.id = x.tenant_id);
DELETE FROM fin.supplier x
 WHERE NOT EXISTS (SELECT 1 FROM app.tenant t WHERE t.id = x.tenant_id);
DELETE FROM fin.webhook_event x
 WHERE NOT EXISTS (SELECT 1 FROM app.tenant t WHERE t.id = x.tenant_id);
DELETE FROM inv.supplier x
 WHERE NOT EXISTS (SELECT 1 FROM app.tenant t WHERE t.id = x.tenant_id);

-- ── a amarra ────────────────────────────────────────────────────────────────
ALTER TABLE fin.bank_account
  ADD CONSTRAINT bank_account_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id);
ALTER TABLE fin.category
  ADD CONSTRAINT category_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id);
ALTER TABLE fin.cost_center
  ADD CONSTRAINT cost_center_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id);
ALTER TABLE fin.payment_method
  ADD CONSTRAINT payment_method_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id);
ALTER TABLE fin.receipt_counter
  ADD CONSTRAINT receipt_counter_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id);
ALTER TABLE fin.supplier
  ADD CONSTRAINT supplier_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id);
ALTER TABLE fin.webhook_event
  ADD CONSTRAINT webhook_event_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id);
ALTER TABLE inv.supplier
  ADD CONSTRAINT supplier_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id);
