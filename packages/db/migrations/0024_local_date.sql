-- 0024_local_date.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §10 item 10: o fuso pertence a CLINICA, e nenhuma derivacao diaria usa
-- timestamptz::date. Esta e a UNICA funcao autorizada a converter instante em
-- data, e o invariante 8 (inv08-ddl-lint.ts) ja a isenta pelo nome.
--
-- IMMUTABLE e uma promessa forte: a conversao AT TIME ZONE depende da base de
-- fusos do sistema, que muda quando o Brasil mexe no horario de verao. Aceitamos
-- porque (a) o valor e gravado na ESCRITA, nunca recalculado na leitura, e
-- (b) sem IMMUTABLE nao existe coluna gerada nem indice sobre a data do evento.
-- Quem reindexar apos atualizacao de tzdata precisa de REINDEX; esta linha e o
-- aviso.

CREATE FUNCTION app.local_date(p_at timestamptz, p_timezone text) RETURNS date
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT (p_at AT TIME ZONE p_timezone)::date
$$;

ALTER FUNCTION app.local_date(timestamptz, text) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION app.local_date(timestamptz, text) TO app_rw, clin_writer;

COMMENT ON FUNCTION app.local_date(timestamptz, text) IS
  'clock-derived-date';
