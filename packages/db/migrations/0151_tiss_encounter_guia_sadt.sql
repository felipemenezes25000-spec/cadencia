-- 0151_tiss_encounter_guia_sadt.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- Guia SP/SADT — servico profissional e servico auxiliar de diagnostico e
-- terapia. E a guia de exame, procedimento e terapia: tudo que nao e consulta
-- simples nem internacao. Numa clinica e a guia que mais fatura.
--
-- POR QUE UMA SEGUNDA TABELA, e nao colunas novas na guia de consulta:
-- SP/SADT tem N procedimentos por guia; consulta tem exatamente um. Enfiar as
-- duas na mesma tabela obrigaria a deixar `codigo_procedimento` anulavel, e
-- perder-se-ia a garantia de que consulta SEMPRE tem procedimento. Alem disso
-- o XSD as trata como tipos distintos, num `choice` que proibe lote misto.
--
-- Sem coluna de CID, pelo mesmo motivo da guia de consulta: item 32 do
-- Componente Organizacional PROIBE a operadora de exigir CID na guia.
--
-- INVARIANTE: nenhuma leitura do relogio de quem executa neste schema.

CREATE TABLE tiss.encounter_guia_sadt (
  tenant_id                     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id                            uuid NOT NULL,
  encounter_id                  uuid NOT NULL,
  encounter_version_id          uuid NOT NULL,
  operadora_id                  uuid NOT NULL,
  registro_ans                  char(6) NOT NULL,
  numero_guia_prestador         varchar(20) NOT NULL,
  numero_guia_operadora         varchar(20),
  guia_principal                varchar(20),
  numero_carteira               varchar(20) NOT NULL,
  atendimento_rn                boolean NOT NULL,

  -- Autorizacao previa. Existe quando o procedimento exigiu senha da operadora;
  -- a data so faz sentido junto da senha, dai o CHECK conjunto no fim.
  data_autorizacao              date,
  senha_autorizacao             varchar(20),
  data_validade_senha           date,

  -- Solicitante e executante sao prestadores DIFERENTES no caso comum: o medico
  -- pede o exame, o laboratorio executa. Guardar so um perderia metade da guia.
  sol_codigo_prestador          varchar(14),
  sol_cpf_contratado            varchar(11),
  sol_cnpj_contratado           varchar(14)
    CHECK (sol_cnpj_contratado ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  sol_nome_contratado           varchar(70) NOT NULL,
  sol_conselho_profissional     varchar(2) NOT NULL,
  sol_numero_conselho           varchar(15) NOT NULL,
  sol_uf_conselho               char(2) NOT NULL,
  sol_cbos                      varchar(6) NOT NULL,
  data_solicitacao              date,
  carater_atendimento           char(1) NOT NULL CHECK (carater_atendimento IN ('1','2')),
  indicacao_clinica             varchar(500),

  exe_codigo_prestador          varchar(14),
  exe_cpf_contratado            varchar(11),
  exe_cnpj_contratado           varchar(14)
    CHECK (exe_cnpj_contratado ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  exe_cnes                      char(7) NOT NULL,

  tipo_atendimento              char(2) NOT NULL,
  indicacao_acidente            char(1) NOT NULL,
  tipo_consulta                 char(1),
  regime_atendimento            char(2) NOT NULL,
  saude_ocupacional             char(2),
  observacao                    varchar(500),

  live                          boolean NOT NULL DEFAULT true,
  created_by                    uuid NOT NULL,
  created_at                    timestamptz(3) NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, id),
  -- O numero da guia e unico no universo do prestador, atravessando os dois
  -- tipos. Como a unicidade nao pode cruzar tabelas, o gerador em
  -- `numero-guia.ts` usa faixas distintas por tipo.
  UNIQUE (tenant_id, numero_guia_prestador),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, encounter_id)
    REFERENCES clin.encounter(tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_version_id)
    REFERENCES clin.encounter_version(tenant_id, id),
  FOREIGN KEY (tenant_id, operadora_id)
    REFERENCES tiss.operadora(tenant_id, id),

  CHECK (num_nonnulls(sol_codigo_prestador, sol_cpf_contratado, sol_cnpj_contratado) = 1),
  CHECK (num_nonnulls(exe_codigo_prestador, exe_cpf_contratado, exe_cnpj_contratado) = 1),
  -- Senha sem data de autorizacao e data sem senha sao guias que a operadora
  -- devolve. Barrar aqui evita descobrir no retorno do lote.
  CHECK ((senha_autorizacao IS NULL) = (data_autorizacao IS NULL))
);

ALTER TABLE tiss.encounter_guia_sadt OWNER TO app_owner;

-- Um atendimento pode gerar VARIAS guias SP/SADT vivas — tres exames pedidos na
-- mesma consulta viram tres guias. Por isso nao ha indice unico por encounter,
-- ao contrario da guia de consulta.
CREATE INDEX ix_guia_sadt_encounter
  ON tiss.encounter_guia_sadt (tenant_id, encounter_id)
  WHERE live;

CREATE INDEX ix_guia_sadt_operadora
  ON tiss.encounter_guia_sadt (tenant_id, operadora_id, created_at DESC)
  WHERE live;

-- Itens executados. Tabela filha porque a guia tem N procedimentos; e a razao
-- de SP/SADT nao caber na tabela de consulta.
CREATE TABLE tiss.encounter_guia_sadt_item (
  tenant_id             uuid NOT NULL DEFAULT app.require_tenant_id(),
  guia_id               uuid NOT NULL,
  sequencial_item       smallint NOT NULL CHECK (sequencial_item BETWEEN 1 AND 9999),
  data_execucao         date NOT NULL,
  hora_inicial          time,
  hora_final            time,
  codigo_tabela         char(2) NOT NULL CHECK (codigo_tabela <> '18'),
  codigo_procedimento   varchar(10) NOT NULL,
  descricao_procedimento varchar(100) NOT NULL,
  quantidade_executada  smallint NOT NULL CHECK (quantidade_executada > 0),
  via_acesso            char(1),
  tecnica_utilizada     char(1),
  -- `st_decimal3-2` no XSD: 1.00 e o neutro, 0.50 e a reducao de segundo
  -- procedimento na mesma via de acesso.
  reducao_acrescimo     numeric(3,2) NOT NULL DEFAULT 1.00
    CHECK (reducao_acrescimo > 0 AND reducao_acrescimo <= 9.99),
  valor_unitario        numeric(12,2) NOT NULL CHECK (valor_unitario >= 0),

  PRIMARY KEY (guia_id, sequencial_item),
  UNIQUE (tenant_id, guia_id, sequencial_item),

  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, guia_id)
    REFERENCES tiss.encounter_guia_sadt(tenant_id, id),

  -- Hora final sem hora inicial nao diz nada; o par so vale junto.
  CHECK ((hora_inicial IS NULL) = (hora_final IS NULL))
);

ALTER TABLE tiss.encounter_guia_sadt_item OWNER TO app_owner;

-- SEM coluna de valor total: ele e DERIVADO de unitario x quantidade x fator.
-- Guardar o total abriria espaco para ele divergir dos proprios itens, que e o
-- motivo de glosa mais bobo e mais frequente que existe.
CREATE INDEX ix_guia_sadt_item_guia
  ON tiss.encounter_guia_sadt_item (tenant_id, guia_id, sequencial_item);

-- RLS
ALTER TABLE tiss.encounter_guia_sadt ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.encounter_guia_sadt FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.encounter_guia_sadt
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

ALTER TABLE tiss.encounter_guia_sadt_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiss.encounter_guia_sadt_item FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tiss.encounter_guia_sadt_item
  AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- GRANTs
GRANT SELECT, INSERT ON tiss.encounter_guia_sadt TO app_rw;
GRANT UPDATE (live) ON tiss.encounter_guia_sadt TO app_rw;
GRANT SELECT ON tiss.encounter_guia_sadt TO rpt_owner;

GRANT SELECT, INSERT ON tiss.encounter_guia_sadt_item TO app_rw;
GRANT SELECT ON tiss.encounter_guia_sadt_item TO rpt_owner;
