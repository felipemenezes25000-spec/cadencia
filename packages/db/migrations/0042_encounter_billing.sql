-- 0042_encounter_billing.sql
-- Forward-only: nao existe down migration. Para desfazer, escreva a proxima.
-- Este arquivo roda dentro de UMA transacao. Nada de CREATE INDEX CONCURRENTLY.
--
-- §3.9 e §8 — os ~14 campos da guia de consulta TISS, capturados NO ATENDIMENTO
-- desde a Fase 1, com o modulo tiss ainda inexistente. Custa dias agora e meses
-- depois: a guia e PROJECAO do atendimento, e nao da para projetar o que nao foi
-- capturado. A tabela mora em clin, nao em tiss, exatamente porque o schema tiss
-- ainda nao tem dono: a Fase 4 cria tiss.encounter_guia_consulta LENDO daqui.
--
-- Sem coluna de CID: item 32 do Componente Organizacional PROIBE a operadora de
-- exigir CID na guia. Coluna que nao existe nao pode ser preenchida por engano.
--
-- Os tipos sao IDENTICOS aos de app.professional (conselho, numero, uf, cbos) e
-- aos de app.clinic (cnes): projecao nao pode precisar converter nada.

CREATE TABLE clin.encounter_billing (
  tenant_id     uuid NOT NULL DEFAULT app.require_tenant_id(),
  id            uuid NOT NULL,
  encounter_id  uuid NOT NULL,
  -- Convenio. NULL em atendimento particular: a captura e obrigatoria so quando
  -- ha operadora, e por isso o CHECK e condicional.
  operadora_nome    text,
  registro_ans      char(6) CHECK (registro_ans IS NULL OR registro_ans ~ '^[0-9]{6}$'),
  numero_carteira   varchar(20),
  atendimento_rn    boolean NOT NULL DEFAULT false,
  -- Prestador. SEM DEFAULT '9999999': dado falso vira lote glosado.
  cnes              char(7) NOT NULL CHECK (cnes ~ '^[0-9]{7}$'),
  cnpj_contratado   varchar(14) CHECK (cnpj_contratado IS NULL
                      OR cnpj_contratado ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  cpf_contratado    varchar(11) CHECK (cpf_contratado IS NULL OR cpf_contratado ~ '^[0-9]{11}$'),
  codigo_prestador_na_operadora varchar(14),
  -- Profissional executante, congelado no momento do atendimento.
  conselho_profissional varchar(2) NOT NULL,
  numero_conselho       varchar(15) NOT NULL,
  uf_conselho           char(2) NOT NULL CHECK (uf_conselho ~ '^[A-Z]{2}$'),
  cbos                  varchar(6) NOT NULL,
  -- Atendimento.
  indicacao_acidente char(1) NOT NULL DEFAULT '9' CHECK (indicacao_acidente IN ('0','1','2','9')),
  regime_atendimento char(2) NOT NULL DEFAULT '01',
  tipo_consulta      char(1) NOT NULL CHECK (tipo_consulta IN ('1','2','3','4')),
  saude_ocupacional  char(1),
  data_atendimento   date NOT NULL,   -- = clin.encounter.occurred_date (fuso da clinica)
  -- Procedimento cobrado.
  codigo_tabela       char(2) NOT NULL CHECK (codigo_tabela <> '18'),
  codigo_procedimento varchar(10) NOT NULL,
  valor_centavos      bigint NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0),
  observacao          varchar(500),
  created_by uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id), UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, encounter_id),
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clin.encounter(tenant_id, id),
  -- Ou o codigo do prestador na operadora, ou CPF, ou CNPJ. Exatamente um.
  CHECK (registro_ans IS NULL
         OR num_nonnulls(codigo_prestador_na_operadora, cpf_contratado, cnpj_contratado) = 1),
  -- Convenio exige carteirinha; particular nao tem nem uma coisa nem outra.
  CHECK ((registro_ans IS NULL) = (numero_carteira IS NULL)));
ALTER TABLE clin.encounter_billing OWNER TO app_owner;

CREATE INDEX ix_billing_a_faturar
  ON clin.encounter_billing (tenant_id, data_atendimento DESC)
  WHERE registro_ans IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON clin.encounter_billing TO app_rw;

ALTER TABLE clin.encounter_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE clin.encounter_billing FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clin.encounter_billing AS PERMISSIVE FOR ALL TO app_rw
  USING      (tenant_id = app.current_tenant_id() AND app.is_member())
  WITH CHECK (tenant_id = app.require_tenant_id() AND app.is_member());

-- A tabela nao tem patient_id nem version_id, entao os invariantes 4 e 5 nao a
-- alcancam. Mas ela e faturamento, e recepcao/financeiro precisam ver: o escopo
-- correto e por papel, nao por profissional.
CREATE POLICY escopo_faturamento ON clin.encounter_billing
AS RESTRICTIVE FOR SELECT TO app_rw
  USING ( app.clinical_scope_all()
          OR app.current_professional_id() IS NULL
          OR EXISTS (SELECT 1 FROM clin.encounter e
                      WHERE (e.tenant_id, e.id)
                            = (clin.encounter_billing.tenant_id, clin.encounter_billing.encounter_id)
                        AND e.professional_id = app.current_professional_id()) );
