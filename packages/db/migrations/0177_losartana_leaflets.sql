-- 0177_losartana_leaflets.sql
-- Completa as versões paciente e profissional do medicamento exibido no Bulário.
-- Forward-only: não existe down migration.

INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao)
SELECT
  medicamento.id,
  'paciente',
  $$LOSARTANA POTÁSSICA 50 mg

BULA DO PACIENTE

COMPOSIÇÃO: cada comprimido revestido contém losartana potássica equivalente a 50 mg de losartana.

PARA QUE ESTE MEDICAMENTO É INDICADO: tratamento da hipertensão arterial e proteção renal em pacientes selecionados, conforme prescrição médica.

COMO USAR: use somente na dose, no horário e pelo período definidos pelo profissional que acompanha você. Não interrompa o tratamento por conta própria.

QUANDO NÃO DEVO USAR: não use em caso de alergia à losartana ou aos componentes da fórmula. Este medicamento é contraindicado durante a gravidez; informe imediatamente ao profissional de saúde caso esteja grávida ou suspeite de gravidez.

ADVERTÊNCIAS: informe todos os medicamentos em uso e seu histórico de doença renal, hepática ou alterações de potássio. Procure atendimento em caso de sinais de reação alérgica, desmaio ou mal-estar importante.

VENDA SOB PRESCRIÇÃO MÉDICA.

Consulte sempre a versão regulatória vigente no Bulário Eletrônico da Anvisa.$$,
  'Versão assistencial 1.0',
  CURRENT_DATE
FROM drug.medicamento AS medicamento
WHERE medicamento.registro_anvisa = '10230039600100'
  AND NOT EXISTS (
    SELECT 1
    FROM drug.bula AS bula
    WHERE bula.medicamento_id = medicamento.id
      AND bula.tipo = 'paciente'
  );

INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao)
SELECT
  medicamento.id,
  'profissional',
  $$LOSARTANA POTÁSSICA 50 mg

BULA DO PROFISSIONAL DE SAÚDE

APRESENTAÇÃO E COMPOSIÇÃO: comprimido revestido contendo losartana potássica equivalente a 50 mg de losartana.

CLASSE TERAPÊUTICA: antagonista do receptor da angiotensina II.

INDICAÇÕES: tratamento da hipertensão arterial e situações clínicas previstas na prescrição e na bula regulatória vigente.

USO CLÍNICO: individualize a posologia conforme indicação, resposta terapêutica, função renal, potássio sérico, comorbidades e medicamentos concomitantes. Não utilize este resumo para substituir a bula regulatória ou protocolos institucionais.

CONTRAINDICAÇÕES E PRECAUÇÕES: hipersensibilidade aos componentes; contraindicado na gestação. Avalie risco de hipotensão, alteração da função renal e hipercalemia, especialmente em pacientes com depleção de volume, doença renal ou uso concomitante de medicamentos que elevem o potássio.

INTERAÇÕES: revise medicamentos concomitantes, em especial outros agentes do sistema renina-angiotensina, diuréticos poupadores de potássio, suplementos de potássio e anti-inflamatórios não esteroidais.

VENDA SOB PRESCRIÇÃO MÉDICA.

Consulte sempre a versão regulatória vigente no Bulário Eletrônico da Anvisa.$$,
  'Versão assistencial 1.0',
  CURRENT_DATE
FROM drug.medicamento AS medicamento
WHERE medicamento.registro_anvisa = '10230039600100'
  AND NOT EXISTS (
    SELECT 1
    FROM drug.bula AS bula
    WHERE bula.medicamento_id = medicamento.id
      AND bula.tipo = 'profissional'
  );
