-- 0169_drug_seed.sql
-- Seed inicial do bulário com medicamentos comuns
-- Forward-only: não existe down migration.

INSERT INTO drug.medicamento (registro_anvisa, nome, principio_ativo, classe_terapeutica, concentracao, forma_farmaceutica, fabricante)
VALUES
  ('10230039000106', 'Tylenol 500mg', 'Paracetamol', 'Analgésico e Antitérmico', '500mg', 'Comprimido', 'Johnson & Johnson do Brasil Ltda'),
  ('10230039000298', 'Tylenol 750mg', 'Paracetamol', 'Analgésico e Antitérmico', '750mg', 'Comprimido', 'Johnson & Johnson do Brasil Ltda'),
  ('10230039000379', 'Tylenol Gotas 200mg/mL', 'Paracetamol', 'Analgésico e Antitérmico', '200mg/mL', 'Solução oral (gotas)', 'Johnson & Johnson do Brasil Ltda'),
  ('10230039100102', 'Advil 600mg', 'Ibuprofeno', 'Anti-inflamatório não esteroideo', '600mg', 'Comprimido revestido', 'Pfizer Brasil Ltda'),
  ('10230039100285', 'Advil 400mg', 'Ibuprofeno', 'Anti-inflamatório não esteroideo', '400mg', 'Comprimido revestido', 'Pfizer Brasil Ltda'),
  ('10230039100366', 'Advil Suspensão Pediátrica 100mg/5mL', 'Ibuprofeno', 'Anti-inflamatório não esteroideo', '100mg/5mL', 'Suspensão oral', 'Pfizer Brasil Ltda'),
  ('10230039200100', 'Amoxil 500mg', 'Amoxicilina', 'Antibiótico - Penicilina', '500mg', 'Cápsula', 'GlaxoSmithKline Brasil Ltda'),
  ('10230039200283', 'Amoxil 875mg', 'Amoxicilina', 'Antibiótico - Penicilina', '875mg', 'Comprimido revestido', 'GlaxoSmithKline Brasil Ltda'),
  ('10230039200364', 'Amoxil Suspensão 250mg/5mL', 'Amoxicilina', 'Antibiótico - Penicilina', '250mg/5mL', 'Pó para suspensão oral', 'GlaxoSmithKline Brasil Ltda'),
  ('10230039300108', 'Nimesulida 100mg', 'Nimesulida', 'Anti-inflamatório não esteroideo', '100mg', 'Comprimido', 'Medley Farmacêutica Ltda'),
  ('10230039400102', 'Omeprazol 20mg', 'Omeprazol', 'Inibidor da bomba de prótons', '20mg', 'Cápsula gastrorresistente', 'AstraZeneca do Brasil Ltda'),
  ('10230039500106', 'Metformina 500mg', 'Cloridrato de Metformina', 'Antidiabético oral', '500mg', 'Comprimido', 'Merck S.A.'),
  ('10230039500289', 'Metformina 850mg', 'Cloridrato de Metformina', 'Antidiabético oral', '850mg', 'Comprimido', 'Merck S.A.'),
  ('10230039600100', 'Losartana 50mg', 'Losartana Potássica', 'Antihipertensivo', '50mg', 'Comprimido revestido', 'Novartis Biociências S.A.'),
  ('10230039700104', 'Dipirona 500mg', 'Dipirona Sódica', 'Analgésico e Antitérmico', '500mg', 'Comprimido', 'Sanofi-Aventis Farmacêutica Ltda'),
  ('10230039800108', 'Azitromicina 500mg', 'Azitromicina', 'Antibiótico - Macrolídeo', '500mg', 'Comprimido revestido', 'Pfizer Brasil Ltda'),
  ('10230039900102', 'Cetirizina 10mg', 'Dicloridrato de Cetirizina', 'Antialérgico', '10mg', 'Comprimido', 'UCB Biopharma S.A.'),
  ('10230040000106', 'Pantoprazol 40mg', 'Pantoprazol', 'Inibidor da bomba de prótons', '40mg', 'Comprimido revestido gastrorresistente', 'AstraZeneca do Brasil Ltda')
ON CONFLICT (registro_anvisa) DO NOTHING;

-- Inserir bulas de exemplo
DO $$
DECLARE
  med_paracetamol uuid;
  med_ibuprofeno uuid;
  med_amoxicilina uuid;
BEGIN
  SELECT id INTO med_paracetamol FROM drug.medicamento WHERE registro_anvisa = '10230039000106';
  IF med_paracetamol IS NOT NULL THEN
    INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao) VALUES
      (med_paracetamol, 'paciente',
       'TYLENOL 500 mg\n\nCOMPOSIÇÃO: Cada comprimido contém 500 mg de paracetamol.\n\nINDICAÇÕES: Analgésico e antitérmico. Indicado para redução da febre e alívio temporário de dores leves a moderadas.\n\nMODO DE USAR: Adultos e crianças acima de 12 anos: 1 a 2 comprimidos, 3 a 4 vezes ao dia. Não exceder 8 comprimidos em 24 horas.\n\nCONTRAINDICAÇÕES: Não use este medicamento se você é alérgico ao paracetamol.\n\nVENDA SEM PRESCRIÇÃO MÉDICA.',
       'Versão 3.0', '2024-01-15')
    ON CONFLICT DO NOTHING;

    INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao) VALUES
      (med_paracetamol, 'profissional',
       'TYLENOL 500 mg - BULA DO PROFISSIONAL DE SAÚDE\n\nCOMPOSIÇÃO: Cada comprimido contém 500 mg de paracetamol.\n\nFARMACOLOGIA: O paracetamol é um analgésico e antitérmico que age inibindo a síntese de prostaglandinas.\n\nPOSOLOGIA: Adultos: 500 a 1000 mg, 3 a 4 vezes ao dia. Dose máxima diária: 4000 mg.\n\nCONTRAINDICAÇÕES: Hipersensibilidade ao paracetamol. Insuficiência hepática grave.\n\nVENDA: Isento de prescrição médica.',
       'Versão 3.0', '2024-01-15')
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT id INTO med_ibuprofeno FROM drug.medicamento WHERE registro_anvisa = '10230039100102';
  IF med_ibuprofeno IS NOT NULL THEN
    INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao) VALUES
      (med_ibuprofeno, 'paciente',
       'ADVIL 600 mg\n\nCOMPOSIÇÃO: Cada comprimido revestido contém 600 mg de ibuprofeno.\n\nINDICAÇÕES: Indicado para o tratamento de dores e febre.\n\nMODO DE USAR: adultos e crianças acima de 12 anos: 1 comprimido, 3 a 4 vezes ao dia. Não exceder 4 comprimidos em 24 horas.\n\nCONTRAINDICAÇÕES: Não use se você é alérgico ao ibuprofeno.\n\nVENDA SEM PRESCRIÇÃO MÉDICA.',
       'Versão 2.0', '2024-03-10')
    ON CONFLICT DO NOTHING;

    INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao) VALUES
      (med_ibuprofeno, 'profissional',
       'ADVIL 600 mg - BULA DO PROFISSIONAL DE SAÚDE\n\nCOMPOSIÇÃO: Cada comprimido revestido contém 600 mg de ibuprofeno.\n\nFARMACOLOGIA: O ibuprofeno é um AINE que atua inibindo as enzimas COX-1 e COX-2.\n\nPOSOLOGIA: A dose inicial recomendada é de 600 mg, 3 a 4 vezes ao dia. Dose máxima diária: 2400 mg.\n\nCONTRAINDICAÇÕES: Hipersensibilidade ao ibuprofeno, úlcera péptica ativa, insuficiência cardíaca grave.\n\nVENDA: Isento de prescrição médica.',
       'Versão 2.0', '2024-03-10')
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT id INTO med_amoxicilina FROM drug.medicamento WHERE registro_anvisa = '10230039200100';
  IF med_amoxicilina IS NOT NULL THEN
    INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao) VALUES
      (med_amoxicilina, 'paciente',
       'AMOXIL 500 mg\n\nCOMPOSIÇÃO: Cada cápsula contém 500 mg de amoxicilina.\n\nINDICAÇÕES: Antibiótico da classe das penicilinas. Indicado para tratamento de infecções bacterianas.\n\nMODO DE USAR: Adultos e crianças acima de 12 anos: 1 cápsula de 8 em 8 horas. Manter tratamento por pelo menos 48-72 horas após os sintomas.\n\nCONTRAINDICAÇÕES: Não use se você é alérgico à amoxicilina ou a outras penicilinas.\n\nVENDA SOB PRESCRIÇÃO MÉDICA.',
       'Versão 4.0', '2024-02-20')
    ON CONFLICT DO NOTHING;

    INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao) VALUES
      (med_amoxicilina, 'profissional',
       'AMOXIL 500 mg - BULA DO PROFISSIONAL DE SAÚDE\n\nCOMPOSIÇÃO: Cada cápsula contém 500 mg de amoxicilina.\n\nFARMACOLOGIA: A amoxicilina é uma penicilina semisintética que inibe a síntese da parede celular bacteriana.\n\nESPECTRO: Streptococcus spp., Staphylococcus spp., H. influenzae, E. coli, P. mirabilis.\n\nPOSOLOGIA: Adultos: 250 a 500 mg de 8 em 8 horas, ou 500 a 875 mg de 12 em 12 horas.\n\nCONTRAINDICAÇÕES: Hipersensibilidade às penicilinas ou cefalosporinas.\n\nVENDA SOB PRESCRIÇÃO MÉDICA.',
       'Versão 4.0', '2024-02-20')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
