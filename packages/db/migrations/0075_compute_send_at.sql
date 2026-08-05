-- 0075_compute_send_at.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
--
-- Funcao SQL que calcula o instante UTC de envio de automacao respeitando o
-- fuso da clinica. O offset e aplicado no horario LOCAL, nao no UTC.
--
-- Algoritmo:
-- 1. Converte o instante de referencia para o fuso da clinica.
-- 2. Aplica o offset em minutos no horario local.
-- 3. O Postgres converte de volta para timestamptz automaticamente.
--
-- Isso garante que o lembrete de 24h antes de uma consulta as 8h em
-- America/Sao_Paulo sai as 8h do dia anterior em horario local, e NAO
-- as 5h UTC (que seria o resultado de subtrair 1440 min do instante UTC).

CREATE FUNCTION msg.compute_send_at(
  p_reference_at  timestamptz,
  p_timezone      text,
  p_offset_minutes int
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  -- O truque: converter para o fuso local, somar o intervalo no espaco local,
  -- e converter de volta. O Postgres faz a conversao de volta corretamente,
  -- incluindo transicoes de horario de verao.
  SELECT ((p_reference_at AT TIME ZONE p_timezone)
          + make_interval(mins => p_offset_minutes))
         AT TIME ZONE p_timezone
$$;

ALTER FUNCTION msg.compute_send_at(timestamptz, text, int) OWNER TO app_owner;
GRANT EXECUTE ON FUNCTION msg.compute_send_at(timestamptz, text, int) TO app_rw;
