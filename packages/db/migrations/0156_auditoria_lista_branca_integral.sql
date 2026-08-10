-- 0156_auditoria_lista_branca_integral.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao.
--
-- SEGUNDA correcao da 0154, e a licao completa.
--
-- 0155 devolveu as 75 chaves que 0154 tinha apagado, mas reconstruiu a funcao a
-- partir dos LITERAIS que eu extrai do arquivo — nao do corpo dela. O que se
-- perdeu na segunda vez nao foi uma chave: foi a GUARDA
--
--     AND jsonb_typeof(p_meta) = 'object'
--
-- que existe para recusar meta em forma de ARRAY. Sem ela, `jsonb_object_keys`
-- recebe um array e levanta erro em vez de devolver falso — e um `meta` como
-- `["J45","I10"]`, que e exatamente o formato em que codigo clinico vazaria
-- para a trilha, deixava de ser barrado pelo CHECK.
--
-- Esta migration copia o corpo INTEGRAL de 0139 e acrescenta uma unica linha.
-- Nada foi digitado de novo.

CREATE OR REPLACE FUNCTION audit.meta_keys_ok(p_meta jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT p_meta IS NOT NULL
     AND jsonb_typeof(p_meta) = 'object'
     AND NOT EXISTS (
           SELECT 1
             FROM jsonb_object_keys(p_meta) AS k(key)
            WHERE k.key NOT IN (
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
$fn$;
