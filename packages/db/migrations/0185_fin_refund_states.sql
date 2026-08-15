-- 0185_fin_refund_states.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Um estorno que depende de PSP nao pode virar `estornado` antes da confirmacao
-- externa. Estes estados distinguem pedido aceito pela Cadencia de dinheiro
-- efetivamente devolvido e de timeout cujo resultado ainda e desconhecido.

ALTER TYPE fin.entry_status ADD VALUE IF NOT EXISTS 'estorno_pendente';
ALTER TYPE fin.entry_status ADD VALUE IF NOT EXISTS 'estorno_indeterminado';
