-- 0115_tiss_encounter_guia_consulta.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- S3.9 — guia de consulta TISS. Projecao do atendimento, append-only, com
-- autoria e vinculo a versao. Sem coluna de CID: item 32 do Componente
-- Organizacional PROIBE a operadora de exigir CID na guia.
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

CREATE TABLE tiss.encounter_guia_consulta (
  tenant_id                     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                            uuid NOT NULL,
  encounter_id                  uuid NOT NULL,
  encounter_version_id          uuid NOT NULL,
  operadora_id                  uuid NOT NULL,
  registro_ans                  char(6) NOT NULL,
  numero_guia_prestador         varchar(20) NOT NULL,
  numero_guia_operadora         varchar(20),
  numero_carteira               varchar(20) NOT NULL,
  atendimento_rn                boolean NOT NULL,
  codigo_prestador_na_operadora varchar(14),
  cpf_contratado                varchar(11),
  cnpj_contratado               varchar(14)
    CHECK (cnpj_contratado ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  cnes                          char(7) NOT NULL,
  conselho_profissional         varchar(2) NOT NULL,
  numero_conselho               varchar(15) NOT NULL,
  uf_conselho                   char(2) NOT NULL,
  cbos                          varchar(6) NOT NULL,
  indicacao_acidente            char(1) NOT NULL,
  regime_atendimento            char(2) NOT NULL,
  saude_ocupacional             char(1),
  cobertura_especial            char(1),
  data_atendimento              date NOT NULL,
  tipo_consulta                 char(1) NOT NULL,
  codigo_tabela                 char(2) NOT NULL CHECK (codigo_tabela <> '18'),
  codigo_procedimento           varchar(10) NOT NULL,
  valor_procedimento            numeric(12,2) NOT NULL CHECK (valor_procedimento >= 0),
  observacao                    varchar(500),
  live                          boolean NOT NULL DEFAULT true,
  created_by                    uuid NOT NULL,
  created_at                    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, numero_guia_prestador),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, encounter_id)
    REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_version_id)
    REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id),

  CHECK (num_nonnulls(codigo_prestador_na_operadora, cpf_contratado, cnpj_contratado) = 1)
);

ALTER TABLE tiss.encounter_guia_consulta OWNER TO app_owner;

-- Indice unico parcial: no maximo uma guia VIVA por atendimento.
CREATE UNIQUE INDEX ux_guia_live
  ON tiss.encounter_guia_consulta (tenant_id, encounter_id)
  WHERE live;

-- Indice para busca por data de atendimento (faturamento a enviar).
CREATE INDEX ix_guia_consulta_data
  ON tiss.encounter_guia_consulta (tenant_id, data_atendimento DESC)
  WHERE live;

-- RLS
ALTER TABLE tiss.encounter_guia_consulta ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.encounter_guia_consulta FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.encounter_guia_consulta
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- GRANTs
GRANT SELECT, INSERT ON tiss.encounter_guia_consulta TO app_rw;
GRANT UPDATE (live) ON tiss.encounter_guia_consulta TO app_rw;
GRANT SELECT ON tiss.encounter_guia_consulta TO rpt_owner;
