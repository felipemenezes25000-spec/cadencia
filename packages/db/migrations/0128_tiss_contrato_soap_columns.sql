-- 0128_tiss_contrato_soap_columns.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Fase 5 bloco 06: colunas de credencial SOAP no contrato prestador x operadora.
-- Quando os tres campos estao preenchidos, o transport tiss-soap fica disponivel.
-- Quando todos sao NULL, o prestador continua usando tiss-arquivo.
-- Nenhuma leitura do relogio de quem executa neste schema — invariante de CI.

ALTER TABLE tiss.contrato
  ADD COLUMN soap_endpoint_url       text,
  ADD COLUMN soap_username           text,
  ADD COLUMN soap_password_encrypted text;

-- Invariante: se um campo SOAP existe, todos devem existir.
ALTER TABLE tiss.contrato
  ADD CONSTRAINT chk_soap_all_or_none
  CHECK (
    (soap_endpoint_url IS NULL AND soap_username IS NULL AND soap_password_encrypted IS NULL)
    OR
    (soap_endpoint_url IS NOT NULL AND soap_username IS NOT NULL AND soap_password_encrypted IS NOT NULL)
  );

COMMENT ON COLUMN tiss.contrato.soap_endpoint_url
  IS 'URL do webservice TISS da operadora (WSDL nao parseado — endpoint fixo por XSD)';
COMMENT ON COLUMN tiss.contrato.soap_username
  IS 'Usuario para HTTP Basic Auth no webservice TISS';
COMMENT ON COLUMN tiss.contrato.soap_password_encrypted
  IS 'Senha criptografada (AES-256-GCM) para HTTP Basic Auth no webservice TISS';
