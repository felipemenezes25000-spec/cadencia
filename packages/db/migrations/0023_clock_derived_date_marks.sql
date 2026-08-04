-- 0023_clock_derived_date_marks.sql
-- Invariante 8 (§3.13): nenhum `::date` sobre timestamptz fora de app.local_date().
-- audit.ensure_partitions deriva LIMITE DE PARTICAO do relogio — decisao de
-- armazenamento, nao data de evento clinico. A excecao e declarada aqui, em migration
-- revisada com CODEOWNERS, e nunca numa allowlist dentro de arquivo de teste.
--
-- Quem for escrever funcao nova com esta marca, leia antes: se o `date` derivado
-- aparece em guia, prontuario, recibo ou relatorio, a marca esta errada e a resposta
-- e app.local_date(timestamptz, text) com o fuso da UNIDADE.
COMMENT ON FUNCTION audit.ensure_partitions(int) IS 'clock-derived-date';
