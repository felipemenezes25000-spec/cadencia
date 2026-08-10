-- 0154_auditoria_chave_recorrencia.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao.
--
-- `audit.meta_keys_ok` e LISTA BRANCA: chave que nao esta nela derruba a linha
-- no CHECK `meta_sem_pii`. A trilha do agendamento recorrente precisa registrar
-- QUANTAS ocorrencias a serie gerou — sem isso, "criou uma recorrencia" na
-- auditoria nao distingue duas sessoes de cinquenta.
--
-- `ocorrencias` e um contador, nao um dado do paciente: nao ha PII possivel num
-- inteiro. O nome e especifico de proposito — `total` seria generico demais e
-- serviria de porta para qualquer coisa entrar na trilha no futuro.
CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT p_meta IS NULL OR NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_meta) AS k
     WHERE k NOT IN (
       'encaixe',
       'motivo',
       'origem',
       'canal',
       'tipo',
       'status',
       'quantidade',
       'guia_status',
       'guia_count',
       'numero_lote',
       'item_count',
       'total_recursado_cents',
       'total_resultados',
       'deferidos',
       'valores_expurgados',
       'anexos_expurgados',
       'corte_retencao',
       'ocorrencias'
     )
  );
$function$;
