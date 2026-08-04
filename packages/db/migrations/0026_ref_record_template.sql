-- 0026_ref_record_template.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.1 — catalogo de templates GLOBAL e VERSIONADO. Cada secao do tenant registra
-- de qual template e de qual versao veio (clin.record_section.template_id).
-- Sem isso, melhorar a anamnese pediatrica com 300 clinicas ativas vira um script
-- que adivinha correspondencia por code.

CREATE TABLE ref.record_template (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  version    int  NOT NULL CHECK (version >= 1),
  name       text NOT NULL,
  specialty  text,
  is_current boolean NOT NULL DEFAULT false,
  -- spec descreve secoes e campos; e lida UMA vez, na instanciacao para o tenant.
  -- Nunca e lida em runtime de atendimento: quem manda ali e clin.record_field.
  spec       jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (code, version));
ALTER TABLE ref.record_template OWNER TO app_owner;
COMMENT ON TABLE ref.record_template IS 'global-reference';

CREATE UNIQUE INDEX ux_record_template_current
  ON ref.record_template (code) WHERE is_current;

GRANT SELECT ON ref.record_template TO app_rw, clin_writer;

INSERT INTO ref.record_template (id, code, version, name, specialty, is_current, spec) VALUES
('0198f2a0-0000-7000-8000-000000000001', 'consulta_geral', 1,
 'Consulta geral', NULL, true, $json${
  "sections": [
    {"code":"queixa","label":"Queixa principal","fields":[
      {"code":"queixa","label":"Queixa principal","kind":"texto_longo"}]},
    {"code":"hma","label":"Historia da molestia atual","fields":[
      {"code":"hma","label":"HMA","kind":"texto_longo"}]},
    {"code":"antecedentes","label":"Antecedentes","fields":[
      {"code":"comorbidades","label":"Comorbidades","kind":"multipla_escolha",
       "options":["Hipertensao","Diabetes","Dislipidemia","Asma","Tireoidopatia","Nenhuma"]},
      {"code":"alergias","label":"Alergias","kind":"texto_curto"},
      {"code":"tabagismo","label":"Tabagismo","kind":"lista_unica",
       "options":["Nunca fumou","Ex-tabagista","Tabagista"]}]},
    {"code":"sinais_vitais","label":"Sinais vitais","fields":[
      {"code":"peso","label":"Peso","kind":"numerico","observation_code":"PESO","unit":"kg"},
      {"code":"altura","label":"Altura","kind":"numerico","observation_code":"ALTURA","unit":"cm"},
      {"code":"imc","label":"IMC","kind":"imc","observation_code":"IMC","unit":"kg/m2"},
      {"code":"pa","label":"Pressao arterial","kind":"composto",
       "components":[{"observation_code":"PA_SIS","label":"Sistolica","unit":"mmHg"},
                     {"observation_code":"PA_DIA","label":"Diastolica","unit":"mmHg"}]},
      {"code":"fc","label":"Frequencia cardiaca","kind":"numerico","observation_code":"FC","unit":"bpm"}]},
    {"code":"exame_fisico","label":"Exame fisico","fields":[
      {"code":"exame_fisico","label":"Exame fisico","kind":"texto_longo"}]},
    {"code":"hipoteses","label":"Hipoteses diagnosticas","fields":[
      {"code":"cid","label":"CID-10","kind":"busca_tabela","source":"CID10"}]},
    {"code":"conduta","label":"Conduta","fields":[
      {"code":"conduta","label":"Conduta","kind":"texto_longo"},
      {"code":"retorno","label":"Retorno em","kind":"data"}]}
  ]}$json$::jsonb);
