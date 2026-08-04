-- 0025_ref_observation_code.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.6 — sinais vitais e categoricos usam catalogo global, nunca texto livre.
-- Alinhado ao BR-Core. Sem RLS, como ref.cid10_term e ref.tuss_term.

CREATE TABLE ref.observation_code (
  code          text PRIMARY KEY,
  display       text NOT NULL,
  unit          text,
  value_kind    text NOT NULL CHECK (value_kind IN ('numeric','coded','text')),
  min_plausible numeric,
  max_plausible numeric,
  CHECK (min_plausible IS NULL OR max_plausible IS NULL OR min_plausible < max_plausible));
ALTER TABLE ref.observation_code OWNER TO app_owner;
COMMENT ON TABLE ref.observation_code IS 'global-reference';

GRANT SELECT ON ref.observation_code TO app_rw, clin_writer;

-- 'PA' NAO existe como codigo: e um campo COMPOSTO que produz DUAS observacoes.
-- Gravar 'PA' = '120/80' como texto destroi a serie e impede qualquer grafico.
INSERT INTO ref.observation_code (code, display, unit, value_kind, min_plausible, max_plausible)
VALUES
  ('PESO',    'Peso corporal',              'kg',     'numeric',  0.2,  400),
  ('ALTURA',  'Altura',                     'cm',     'numeric',  20,   260),
  ('IMC',     'Indice de massa corporal',   'kg/m2',  'numeric',  5,    150),
  ('PA_SIS',  'Pressao arterial sistolica', 'mmHg',   'numeric',  40,   300),
  ('PA_DIA',  'Pressao arterial diastolica','mmHg',   'numeric',  20,   200),
  ('FC',      'Frequencia cardiaca',        'bpm',    'numeric',  20,   300),
  ('FR',      'Frequencia respiratoria',    'irpm',   'numeric',  4,    80),
  ('TAX',     'Temperatura axilar',         'Cel',    'numeric',  28,   45),
  ('SPO2',    'Saturacao periferica de O2', '%',      'numeric',  40,   100),
  ('GLIC',    'Glicemia capilar',           'mg/dL',  'numeric',  10,   900),
  ('PC',      'Perimetro cefalico',         'cm',     'numeric',  20,   70),
  ('CA',      'Circunferencia abdominal',   'cm',     'numeric',  20,   250);
