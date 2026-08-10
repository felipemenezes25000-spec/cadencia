-- 0155_auditoria_lista_branca_restaurada.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao.
--
-- CORRIGE A MIGRATION 0154.
--
-- 0154 acrescentou a chave 'ocorrencias' a lista branca de audit.meta_keys_ok
-- reescrevendo a funcao inteira — a partir de uma leitura PARCIAL da definicao
-- vigente. As 75 chaves anteriores viraram 18, e todo audit.log cuja meta
-- usasse qualquer uma das outras passou a violar o CHECK meta_sem_pii.
--
-- O sintoma foi amplo e enganoso: 156 testes de integracao quebraram devolvendo
-- 500 em rotas que nada tinham a ver com auditoria — porque a trilha e gravada
-- na MESMA transacao da operacao, e derrubar a trilha derruba a operacao.
--
-- LICAO QUE A LISTA PASSA A CARREGAR: CREATE OR REPLACE de uma lista branca
-- exige a lista COMPLETA em maos. Reconstruir de memoria, ou de um trecho do
-- que se leu, apaga em silencio o que nao se viu.
--
-- A lista abaixo e a de 0139, integral, mais 'ocorrencias' — contador de
-- agendamentos gerados por uma serie recorrente, inteiro, sem PII possivel.
CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT p_meta IS NULL OR NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_meta) AS k
     WHERE k NOT IN (
       'object',
       'reason',
       'route',
       'method',
       'status_code',
       'duration_ms',
       'use_case',
       'record_count',
       'version_no',
       'kind',
       'role',
       'grant_id',
       'horas',
       'geradas',
       'puladas',
       'freq',
       'encaixe',
       'pendencias',
       'status',
       'ticket',
       'export_id',
       'batch_id',
       'job_name',
       'seal_date',
       'error_code',
       'mfa_method',
       'device_id',
       'standard',
       'verificacao',
       'motivo',
       'paginas',
       'qualidade',
       'ms',
       'provedor',
       'itens',
       'assinatura_valida',
       'acao',
       'amount_cents',
       'payment_method',
       'receipt_number',
       'frequency',
       'total_installments',
       'generated_entries',
       'template_id',
       'supplier_name',
       'from_account',
       'to_account',
       'transfer_id',
       'professional_id',
       'percentage',
       'priority',
       'period_start',
       'period_end',
       'total_entries',
       'total_professional_share',
       'product_name',
       'quantity',
       'movement_kind',
       'reference_type',
       'threshold',
       'current_stock',
       'sku',
       'numero_guia',
       'operadora_nome',
       'registro_ans',
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
