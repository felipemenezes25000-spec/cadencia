-- 0150_tiss_version_larga.sql
--
-- `tiss_version` era varchar(5), suficiente para '3.05' e nada mais.
--
-- O componente de comunicacao vigente do padrao TISS e o 04.03.00 — sete
-- caracteres. A coluna estreita nao truncava em silencio: o Postgres RECUSA o
-- INSERT com 22001 (string_data_right_truncation). Na pratica, a clinica que
-- fosse cadastrar uma operadora ja migrada para a versao nova via a operacao
-- falhar com erro de banco, sem explicacao no produto.
--
-- Dez caracteres cobrem 'NN.NN.NN' com folga para o formato nao mudar de ideia.
-- Nao ha DEFAULT novo: a versao de cada operadora e negociada com ela, e um
-- palpite aqui viraria lote recusado no lado da operadora.
ALTER TABLE tiss.operadora ALTER COLUMN tiss_version TYPE varchar(10);
ALTER TABLE tiss.lote      ALTER COLUMN tiss_version TYPE varchar(10);

COMMENT ON COLUMN tiss.operadora.tiss_version IS
  'Versao do componente de comunicacao TISS acordada com esta operadora, ex.: 04.03.00. Durante a coexistencia definida pela ANS, operadoras diferentes ficam em versoes diferentes.';

COMMENT ON COLUMN tiss.lote.tiss_version IS
  'Versao TISS com que ESTE lote foi serializado. Copiada da operadora na criacao e imutavel depois: um lote reenviado precisa sair identico ao que a operadora recebeu, mesmo que a operadora ja tenha migrado.';
