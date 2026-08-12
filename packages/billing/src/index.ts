/**
 * @cadencia/billing
 *
 * Modulo de billing: planos, assinaturas, faturas e verificacao de limites
 * de funcionalidades por plano.
 */

import type { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Plano {
  id: string;
  slug: string;
  nome: string;
  valorPorProfissionalCents: number;
  periodicidade: 'mensal' | 'anual';
  features: string[];
  ativo: boolean;
  createdAt: string;
}

export interface Assinatura {
  id: string;
  tenantId: string;
  planoId: string;
  status: 'trial' | 'ativa' | 'suspensa' | 'cancelada';
  dataInicio: string;
  dataFim: string | null;
  gatewayClientId: string | null;
  trialTerminoEm: string;
  motivoSuspensao: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined
  plano: Plano;
}

export interface Fatura {
  id: string;
  tenantId: string;
  assinaturaId: string;
  valorCents: number;
  status: 'pendente' | 'paga' | 'vencida' | 'cancelada';
  dataVencimento: string;
  dataPagamento: string | null;
  linkPagamento: string | null;
  createdAt: string;
}

export interface SubscriptionCreate {
  planoId: string;
  gatewayClientId?: string;
}

export interface FeatureCheckResult {
  allowed: boolean;
  reason?: string;
  reasonText?: string;
  currentCount?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Plan queries
// ---------------------------------------------------------------------------

/**
 * Lista todos os planos ativos disponiveis para contratacao.
 */
export async function listPlans(pool: Pool): Promise<Plano[]> {
  const { rows } = await pool.query<{
    id: string; slug: string; nome: string;
    valor_por_profissional_cents: number; periodicidade: string;
    features: string[]; ativo: boolean; created_at: string;
  }>(
    `SELECT id, slug, nome, valor_por_profissional_cents, periodicidade,
            features, ativo, created_at
       FROM com.plano
      WHERE ativo = true
   ORDER BY valor_por_profissional_cents ASC`,
  );
  return rows.map(mapPlano);
}

/**
 * Busca um plano pelo ID.
 */
export async function getPlan(pool: Pool, planId: string): Promise<Plano | null> {
  const { rows } = await pool.query<{
    id: string; slug: string; nome: string;
    valor_por_profissional_cents: number; periodicidade: string;
    features: string[]; ativo: boolean; created_at: string;
  }>(
    `SELECT id, slug, nome, valor_por_profissional_cents, periodicidade,
            features, ativo, created_at
       FROM com.plano
      WHERE id = $1`,
    [planId],
  );
  return rows[0] ? mapPlano(rows[0]) : null;
}

/**
 * Busca um plano pelo slug.
 */
export async function getPlanBySlug(pool: Pool, slug: string): Promise<Plano | null> {
  const { rows } = await pool.query<{
    id: string; slug: string; nome: string;
    valor_por_profissional_cents: number; periodicidade: string;
    features: string[]; ativo: boolean; created_at: string;
  }>(
    `SELECT id, slug, nome, valor_por_profissional_cents, periodicidade,
            features, ativo, created_at
       FROM com.plano
      WHERE slug = $1`,
    [slug],
  );
  return rows[0] ? mapPlano(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Subscription queries
// ---------------------------------------------------------------------------

/**
 * Busca a assinatura ativa de um tenant (JOIN com plano).
 */
export async function getSubscription(
  pool: Pool,
  tenantId: string,
): Promise<Assinatura | null> {
  const { rows } = await pool.query<{
    id: string; tenant_id: string; plano_id: string; status: string;
    data_inicio: string; data_fim: string | null; gateway_client_id: string | null;
    trial_termino_em: string; motivo_suspensao: string | null;
    created_at: string; updated_at: string;
    // Plano fields
    plano_slug: string; plano_nome: string;
    plano_valor: number; plano_periodicidade: string;
    plano_features: string[]; plano_ativo: boolean; plano_created_at: string;
  }>(
    `SELECT s.id, s.tenant_id, s.plano_id, s.status,
            s.data_inicio, s.data_fim, s.gateway_client_id,
            s.trial_termino_em, s.motivo_suspensao,
            s.created_at, s.updated_at,
            p.slug AS plano_slug, p.nome AS plano_nome,
            p.valor_por_profissional_cents AS plano_valor,
            p.periodicidade AS plano_periodicidade,
            p.features AS plano_features, p.ativo AS plano_ativo,
            p.created_at AS plano_created_at
       FROM com.assinatura s
       JOIN com.plano p ON p.id = s.plano_id
      WHERE s.tenant_id = $1`,
    [tenantId],
  );
  if (!rows[0]) return null;
  return mapAssinatura(rows[0]);
}

/**
 * Cria ou atualiza assinatura de um tenant (upsert).
 * Usado para migrar de trial para plano pago ou trocar de plano.
 */
export async function createSubscription(
  pool: Pool,
  tenantId: string,
  planoId: string,
  gatewayClientId?: string,
): Promise<Assinatura> {
  await pool.query(
    `INSERT INTO com.assinatura (tenant_id, plano_id, status, gateway_client_id)
          VALUES ($1, $2, 'ativa', $3)
     ON CONFLICT (tenant_id) DO UPDATE
          SET plano_id = EXCLUDED.plano_id,
              status = CASE WHEN com.assinatura.status = 'trial'
                            THEN 'ativa' ELSE com.assinatura.status END,
              gateway_client_id = COALESCE(EXCLUDED.gateway_client_id, com.assinatura.gateway_client_id),
              data_fim = NULL,
              updated_at = clock_timestamp()
      RETURNING *`,
    [tenantId, planoId, gatewayClientId ?? null],
  );
  // Re-fetch com JOIN do plano
  const refreshed = await pool.query(
    `SELECT s.id, s.tenant_id, s.plano_id, s.status,
            s.data_inicio, s.data_fim, s.gateway_client_id,
            s.trial_termino_em, s.motivo_suspensao,
            s.created_at, s.updated_at,
            p.slug AS plano_slug, p.nome AS plano_nome,
            p.valor_por_profissional_cents AS plano_valor,
            p.periodicidade AS plano_periodicidade,
            p.features AS plano_features, p.ativo AS plano_ativo,
            p.created_at AS plano_created_at
       FROM com.assinatura s
       JOIN com.plano p ON p.id = s.plano_id
      WHERE s.tenant_id = $1`,
    [tenantId],
  );
  return mapAssinatura(refreshed.rows[0]!);
}

/**
 * Suspende uma assinatura (falha no pagamento, etc).
 */
export async function suspendSubscription(
  pool: Pool,
  tenantId: string,
  motivo: string,
): Promise<void> {
  await pool.query(
    `UPDATE com.assinatura
        SET status = 'suspensa', motivo_suspensao = $2, updated_at = clock_timestamp()
      WHERE tenant_id = $1 AND status IN ('trial', 'ativa')`,
    [tenantId, motivo],
  );
}

/**
 * Cancela uma assinatura (termino voluntario).
 */
export async function cancelSubscription(
  pool: Pool,
  tenantId: string,
): Promise<void> {
  await pool.query(
    `UPDATE com.assinatura
        SET status = 'cancelada', data_fim = CURRENT_DATE, updated_at = clock_timestamp()
      WHERE tenant_id = $1 AND status IN ('trial', 'ativa', 'suspensa')`,
    [tenantId],
  );
}

/**
 * Reativa uma assinatura suspensa.
 */
export async function reactivateSubscription(
  pool: Pool,
  tenantId: string,
): Promise<Assinatura | null> {
  await pool.query(
    `UPDATE com.assinatura
        SET status = 'ativa', motivo_suspensao = NULL, data_fim = NULL,
            updated_at = clock_timestamp()
      WHERE tenant_id = $1 AND status = 'suspensa'`,
    [tenantId],
  );
  return getSubscription(pool, tenantId);
}

// ---------------------------------------------------------------------------
// Invoice queries
// ---------------------------------------------------------------------------

/**
 * Lista faturas de um tenant.
 */
export async function listInvoices(
  pool: Pool,
  tenantId: string,
  limit = 20,
  offset = 0,
): Promise<{ itens: Fatura[]; total: number }> {
  const [faturasResult, countResult] = await Promise.all([
    pool.query<{
      id: string; tenant_id: string; assinatura_id: string;
      valor_cents: number; status: string;
      data_vencimento: string; data_pagamento: string | null;
      link_pagamento: string | null; created_at: string;
    }>(
      `SELECT id, tenant_id, assinatura_id, valor_cents, status,
              data_vencimento, data_pagamento, link_pagamento, created_at
         FROM com.fatura
        WHERE tenant_id = $1
     ORDER BY data_vencimento DESC
        LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM com.fatura WHERE tenant_id = $1`,
      [tenantId],
    ),
  ]);

  return {
    itens: faturasResult.rows.map(mapFatura),
    total: parseInt(countResult.rows[0]!.count, 10),
  };
}

/**
 * Busca uma fatura pelo ID.
 */
export async function getInvoice(
  pool: Pool,
  faturaId: string,
): Promise<Fatura | null> {
  const { rows } = await pool.query<{
    id: string; tenant_id: string; assinatura_id: string;
    valor_cents: number; status: string;
    data_vencimento: string; data_pagamento: string | null;
    link_pagamento: string | null; created_at: string;
  }>(
    `SELECT id, tenant_id, assinatura_id, valor_cents, status,
            data_vencimento, data_pagamento, link_pagamento, created_at
       FROM com.fatura
      WHERE id = $1`,
    [faturaId],
  );
  return rows[0] ? mapFatura(rows[0]) : null;
}

/**
 * Cria uma fatura (geralmente chamado por um job/worker).
 */
export async function createInvoice(
  pool: Pool,
  tenantId: string,
  assinaturaId: string,
  valorCents: number,
  dataVencimento: string,
  linkPagamento?: string,
): Promise<Fatura> {
  const { rows } = await pool.query<{
    id: string; tenant_id: string; assinatura_id: string;
    valor_cents: number; status: string;
    data_vencimento: string; data_pagamento: string | null;
    link_pagamento: string | null; created_at: string;
  }>(
    `INSERT INTO com.fatura
         (tenant_id, assinatura_id, valor_cents, status, data_vencimento, link_pagamento)
     VALUES ($1, $2, $3, 'pendente', $4, $5)
     RETURNING *`,
    [tenantId, assinaturaId, valorCents, dataVencimento, linkPagamento ?? null],
  );
  return mapFatura(rows[0]!);
}

/**
 * Marca fatura como paga.
 */
export async function markInvoicePaid(
  pool: Pool,
  faturaId: string,
  dataPagamento: string,
): Promise<void> {
  await pool.query(
    `UPDATE com.fatura
        SET status = 'paga', data_pagamento = $2
      WHERE id = $1`,
    [faturaId, dataPagamento],
  );
}

/**
 * Marca fatura como vencida (job de cobranca).
 */
export async function markInvoiceOverdue(
  pool: Pool,
  faturaId: string,
): Promise<void> {
  await pool.query(
    `UPDATE com.fatura
        SET status = 'vencida'
      WHERE id = $1 AND status = 'pendente'`,
    [faturaId],
  );
}

// ---------------------------------------------------------------------------
// Feature limits
// ---------------------------------------------------------------------------

/**
 * Verifica se uma funcionalidade esta liberada para o plano do tenant.
 * - Se features = ["*"], tudo esta liberado.
 * - Se features inclui o nome da funcionalidade, esta liberada.
 * - Senao, bloqueado.
 */
export async function checkFeatureLimit(
  pool: Pool,
  tenantId: string,
  feature: string,
): Promise<FeatureCheckResult> {
  const { rows } = await pool.query<{
    features: string[];
  }>(
    `SELECT p.features
       FROM com.assinatura s
       JOIN com.plano p ON p.id = s.plano_id
      WHERE s.tenant_id = $1
        AND s.status IN ('trial', 'ativa')
        AND p.ativo = true`,
    [tenantId],
  );

  if (!rows[0]) {
    return { allowed: false, reason: 'sem_assinatura' };
  }

  const features = rows[0].features as string[];

  // wildcard = todas as features liberadas
  if (features.includes('*')) {
    return { allowed: true };
  }

  if (features.includes(feature)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `feature_nao_inclusa`,
    reasonText: `A funcionalidade "${feature}" nao esta inclusa no seu plano atual.`,
  };
}

/**
 * Conta profissionais ativos do tenant para calculo de valor.
 */
export async function countProfessionals(
  pool: Pool,
  tenantId: string,
): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM app.professional
      WHERE tenant_id = $1 AND inactivated_at IS NULL`,
    [tenantId],
  );
  return parseInt(rows[0]!.count, 10);
}

/**
 * Calcula valor mensal da assinatura baseado no plano e numero de profissionais.
 */
export async function calculateSubscriptionValue(
  pool: Pool,
  tenantId: string,
): Promise<{ valorCents: number; profissionais: number } | null> {
  const [assinatura, profissionais] = await Promise.all([
    getSubscription(pool, tenantId),
    countProfessionals(pool, tenantId),
  ]);

  if (!assinatura?.plano) return null;

  const valorCents = assinatura.plano.valorPorProfissionalCents * profissionais;

  return { valorCents, profissionais };
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapPlano(row: {
  id: string; slug: string; nome: string;
  valor_por_profissional_cents: number; periodicidade: string;
  features: string[]; ativo: boolean; created_at: string;
}): Plano {
  return {
    id: row.id,
    slug: row.slug,
    nome: row.nome,
    valorPorProfissionalCents: row.valor_por_profissional_cents,
    periodicidade: row.periodicidade as 'mensal' | 'anual',
    features: row.features,
    ativo: row.ativo,
    createdAt: row.created_at,
  };
}

function mapAssinatura(row: {
  id: string; tenant_id: string; plano_id: string; status: string;
  data_inicio: string; data_fim: string | null; gateway_client_id: string | null;
  trial_termino_em: string; motivo_suspensao: string | null;
  created_at: string; updated_at: string;
  plano_slug: string; plano_nome: string;
  plano_valor: number; plano_periodicidade: string;
  plano_features: string[]; plano_ativo: boolean; plano_created_at: string;
}): Assinatura {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    planoId: row.plano_id,
    status: row.status as Assinatura['status'],
    dataInicio: row.data_inicio,
    dataFim: row.data_fim,
    gatewayClientId: row.gateway_client_id,
    trialTerminoEm: row.trial_termino_em,
    motivoSuspensao: row.motivo_suspensao,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    plano: {
      id: row.plano_id,
      slug: row.plano_slug,
      nome: row.plano_nome,
      valorPorProfissionalCents: row.plano_valor,
      periodicidade: row.plano_periodicidade as 'mensal' | 'anual',
      features: row.plano_features,
      ativo: row.plano_ativo,
      createdAt: row.plano_created_at,
    },
  };
}

function mapFatura(row: {
  id: string; tenant_id: string; assinatura_id: string;
  valor_cents: number; status: string;
  data_vencimento: string; data_pagamento: string | null;
  link_pagamento: string | null; created_at: string;
}): Fatura {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    assinaturaId: row.assinatura_id,
    valorCents: row.valor_cents,
    status: row.status as Fatura['status'],
    dataVencimento: row.data_vencimento,
    dataPagamento: row.data_pagamento,
    linkPagamento: row.link_pagamento,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Utility: format currency
// ---------------------------------------------------------------------------

/**
 * Formata valor em centavos para string BRL.
 */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}
