-- 0165_com_schema_plano_assinatura.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao.
--
-- Schema `com` (comercial): billing do zero - planos, assinaturas.
-- E dominio administrativo interno. Sem RLS — lido por jobs (BYPASSRLS)
-- e API de admin. A clinica nao le estas tabelas diretamente.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Schema
-- ---------------------------------------------------------------------------
CREATE SCHEMA com AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA com TO app_rw, app_support;

-- ---------------------------------------------------------------------------
-- 1. Plano
-- ---------------------------------------------------------------------------
CREATE TABLE com.plano (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                        text NOT NULL UNIQUE,           -- 'basico', 'profissional', 'enterprise'
  nome                        text NOT NULL,
  valor_por_profissional_cents int NOT NULL,                  -- em centavos: 14900 = R$ 149,00
  periodicidade               text NOT NULL CHECK (periodicidade IN ('mensal','anual')),
  features                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo                       boolean NOT NULL DEFAULT true,
  created_at                  timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE com.plano OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON com.plano TO app_rw;

GRANT USAGE ON SCHEMA com TO app_rw, app_support, jobs;
GRANT SELECT ON com.plano TO jobs;

-- Seed inicial de planos (via migration — nao editavel pela clinica)
INSERT INTO com.plano (id, slug, nome, valor_por_profissional_cents, periodicidade, features)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'basico',      'Básico',       8900,  'mensal', '["agenda","prontuario","financeiro"]'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'profissional','Profissional',14900,  'mensal', '["agenda","prontuario","financeiro","tiss","whatsapp"]'::jsonb),
  ('00000000-0000-0000-0000-000000000003', 'enterprise',  'Enterprise',  24900,  'mensal', '["*"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Assinatura
-- ---------------------------------------------------------------------------
CREATE TABLE com.assinatura (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES app.tenant(id),
  plano_id            uuid NOT NULL REFERENCES com.plano(id),
  status              text NOT NULL DEFAULT 'trial'
                        CHECK (status IN ('trial','ativa','suspensa','cancelada')),
  data_inicio         date NOT NULL DEFAULT CURRENT_DATE,
  data_fim            date,                                  -- NULL = indefinida
  gateway_client_id   text,                                  -- ID do cliente no Asaas
  trial_termino_em    date NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '14 days'),
  motivo_suspensao    text,
  created_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at          timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id)
);
ALTER TABLE com.assinatura OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE ON com.assinatura TO app_rw;
GRANT SELECT ON com.assinatura TO jobs;

-- Index para jobs que buscam assinaturas por status
CREATE INDEX ix_assinatura_status ON com.assinatura (status)
  WHERE status IN ('trial', 'ativa');

-- Index para jobs que verificam trial prestes a vencer
CREATE INDEX ix_assinatura_trial_termino ON com.assinatura (trial_termino_em)
  WHERE status = 'trial';

COMMIT;
