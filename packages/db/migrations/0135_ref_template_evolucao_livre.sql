-- 0135_ref_template_evolucao_livre.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §4.1 — o catalogo de templates (0026) nasceu com `consulta_geral`, que e um
-- prontuario ESTRUTURADO: cada achado num campo proprio. Ele e o certo para quem
-- quer relatorio por variavel.
--
-- Falta o outro modelo, que e o que a maioria dos consultorios de fato usa: a
-- EVOLUCAO NARRATIVA. O medico escreve em prosa, num editor de texto, e a
-- estrutura vem depois — do CID que ele marca e dos sinais vitais, nao de dez
-- caixinhas que ele preenche com o paciente esperando.
--
-- Sao dois modelos, nao um substituindo o outro. Por isso e template novo com
-- code proprio, e nao `consulta_geral` versao 2: uma clinica que ja usa o
-- estruturado nao pode ver seus campos sumirem porque publicamos uma versao.

INSERT INTO ref.record_template (id, code, version, name, specialty, is_current, spec) VALUES
('0198f2a0-0000-7000-8000-000000000002', 'evolucao_livre', 1,
 'Evolucao livre', NULL, true, $json${
  "sections": [
    {"code":"evolucao","label":"Evolucao","fields":[
      {"code":"evolucao","label":"Evolucao clinica","kind":"texto_longo"}]},
    {"code":"antecedentes","label":"Antecedentes","fields":[
      {"code":"alergias","label":"Alergias","kind":"texto_curto"}]},
    {"code":"sinais_vitais","label":"Sinais vitais","fields":[
      {"code":"peso","label":"Peso","kind":"numerico","observation_code":"PESO","unit":"kg"},
      {"code":"altura","label":"Altura","kind":"numerico","observation_code":"ALTURA","unit":"cm"},
      {"code":"pa","label":"Pressao arterial","kind":"composto",
       "components":[{"observation_code":"PA_SIS","label":"Sistolica","unit":"mmHg"},
                     {"observation_code":"PA_DIA","label":"Diastolica","unit":"mmHg"}]}]},
    {"code":"hipoteses","label":"Hipoteses diagnosticas","fields":[
      {"code":"cid","label":"CID-10","kind":"busca_tabela","source":"CID10"}]}
  ]}$json$::jsonb);

-- `alergias` repete o code do `consulta_geral` DE PROPOSITO. A barra lateral do
-- atendimento le alergia por code, e um paciente que trocou de clinica dentro do
-- mesmo tenant nao pode perder a alergia porque a clinica adotou outro template.
-- O code e o contrato semantico; o template e so quem o instala.
