-- 0183_drug_bulas_corrigidas.sql
-- Forward-only: nao existe down migration.
--
-- DOIS PROBLEMAS NO BULARIO, um de sintaxe e um de cobertura.
--
-- 1. AS QUEBRAS DE LINHA NUNCA EXISTIRAM.
--    A 0169 escreveu o conteudo das bulas como '...COMPOSICAO:\n\nINDICACOES...'
--    em string de aspas simples. No PostgreSQL, com `standard_conforming_strings`
--    ligado — que e o default desde a 9.1 e o que este banco usa — a barra
--    invertida dentro de aspas simples NAO e escape: `'a\nb'` sao os quatro
--    caracteres `a`, `\`, `n`, `b`. Para escape seria preciso `E'a\nb'`.
--    A tela do Bulario renderiza com `whitespace-pre-wrap`, ou seja, respeita a
--    quebra que vier do banco. Como nao vinha nenhuma, as bulas de Tylenol,
--    Advil e Amoxil apareciam como um paragrafo unico e corrido, com `\n\n`
--    visivel no meio do texto. A 0177 (Losartana) ja tinha feito certo, com
--    dollar-quoting e quebra de linha de verdade — por isso so tres das quatro
--    bulas existentes estavam quebradas.
--
-- 2. QUINZE DOS DEZOITO MEDICAMENTOS NAO TINHAM BULA NENHUMA.
--    A 0169 semeou 18 medicamentos e bula para 3. A 0177 somou Losartana. Uma
--    busca no Bulario devolvia o cartao do medicamento, o clique abria o modal,
--    e o modal dizia "Bula nao disponivel" em 14 dos 18 casos. Pior no lado
--    profissional, que e justamente o que o medico abre: existia para 3.
--
-- Esta migration reescreve as tres bulas quebradas e completa as versoes
-- paciente e profissional dos 18 medicamentos semeados.
--
-- SOBRE A AUTORIDADE DESTE TEXTO: continua valendo o que a 0177 estabeleceu —
-- este conteudo e assistencial, serve para o produto ter bulario navegavel, e
-- NAO substitui a bula registrada. Toda bula daqui fecha remetendo ao Bulario
-- Eletronico da Anvisa, que e a fonte regulatoria vigente. Quando existir o
-- carregador da base oficial da Anvisa, ele sobrescreve tudo isto: a busca ja
-- ordena por `data_publicacao DESC`, entao a bula oficial ganha sozinha.

-- ── 1. Remover o que a 0169 gravou com barra-n literal ────────────────────
-- `strpos` e nao `LIKE` DE PROPOSITO. Em LIKE a barra invertida e o caractere
-- de escape padrao, entao o padrao `%\n%` NAO procura `\` seguido de `n`: ele
-- procura um `n` escapado, ou seja, casa qualquer texto que contenha a letra
-- `n` — o que aqui significaria apagar todas as bulas do banco, inclusive as
-- que a 0177 gravou corretamente. `strpos` compara bytes, sem linguagem de
-- padrao no meio. `E'\\n'` e a sequencia de dois caracteres `\` + `n`.
DELETE FROM drug.bula WHERE strpos(conteudo, E'\\n') > 0;

-- ── 2. Bulas de paciente ──────────────────────────────────────────────────
INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao)
SELECT m.id, 'paciente', v.conteudo, 'Versão assistencial 1.0', CURRENT_DATE
FROM (VALUES
  ('10230039000106', $$TYLENOL 500 mg (paracetamol)

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: alívio temporário de dores leves a moderadas e redução da febre.

COMO USAR: adultos e maiores de 12 anos, 1 a 2 comprimidos a cada 4 a 6 horas. Não passe de 8 comprimidos em 24 horas nem use por mais de 10 dias seguidos sem orientação.

QUANDO NÃO DEVO USAR: se você tem alergia ao paracetamol ou doença grave do fígado.

ADVERTÊNCIAS: paracetamol está presente em muitos medicamentos para gripe e dor. Somar dois deles é a forma mais comum de intoxicação do fígado. Não use com bebida alcoólica. Procure atendimento se surgir pele ou olhos amarelados, urina escura ou dor no lado direito da barriga.

VENDA SEM PRESCRIÇÃO MÉDICA.$$),

  ('10230039000298', $$TYLENOL 750 mg (paracetamol)

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: alívio temporário de dores leves a moderadas e redução da febre.

COMO USAR: adultos e maiores de 12 anos, 1 comprimido a cada 6 a 8 horas. Não passe de 5 comprimidos em 24 horas.

QUANDO NÃO DEVO USAR: se você tem alergia ao paracetamol ou doença grave do fígado.

ADVERTÊNCIAS: esta apresentação é mais concentrada. Não a combine com outro produto que contenha paracetamol, inclusive antigripais. Não use com bebida alcoólica.

VENDA SEM PRESCRIÇÃO MÉDICA.$$),

  ('10230039000379', $$TYLENOL GOTAS 200 mg/mL (paracetamol)

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: febre e dor em crianças.

COMO USAR: a dose é calculada pelo PESO da criança, não pela idade — o profissional que acompanha a criança informa quantas gotas. A referência usual é 1 gota por quilo, a cada 6 horas, respeitando o máximo de 35 gotas por dose.

QUANDO NÃO DEVO USAR: alergia ao paracetamol ou doença grave do fígado.

ADVERTÊNCIAS: use sempre o conta-gotas da embalagem; conta-gotas de outro remédio entrega volume diferente. Confira se algum antigripal em uso já contém paracetamol. Anote o horário de cada dose.

VENDA SEM PRESCRIÇÃO MÉDICA.$$),

  ('10230039100102', $$ADVIL 600 mg (ibuprofeno)

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: dor, febre e inflamação.

COMO USAR: adultos, 1 comprimido a cada 6 a 8 horas, sempre após alimentação. Não passe de 4 comprimidos em 24 horas.

QUANDO NÃO DEVO USAR: alergia ao ibuprofeno ou a outros anti-inflamatórios, úlcera ativa, sangramento digestivo, insuficiência cardíaca ou renal grave. Não use a partir do sexto mês de gravidez.

ADVERTÊNCIAS: avise seu médico se usa anticoagulante, corticoide ou remédio para pressão. Pare e procure atendimento em caso de dor no estômago, fezes escuras ou vômito com sangue.

VENDA SEM PRESCRIÇÃO MÉDICA.$$),

  ('10230039100285', $$ADVIL 400 mg (ibuprofeno)

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: dor, febre e inflamação.

COMO USAR: adultos e maiores de 12 anos, 1 comprimido a cada 6 a 8 horas, após alimentação. Não passe de 3 comprimidos em 24 horas sem orientação.

QUANDO NÃO DEVO USAR: alergia ao ibuprofeno ou a outros anti-inflamatórios, úlcera ativa, sangramento digestivo, insuficiência cardíaca ou renal grave.

ADVERTÊNCIAS: use pelo menor tempo possível. Beba água ao longo do dia. Avise se usa anticoagulante ou remédio para pressão.

VENDA SEM PRESCRIÇÃO MÉDICA.$$),

  ('10230039100366', $$ADVIL SUSPENSÃO PEDIÁTRICA 100 mg/5 mL (ibuprofeno)

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: febre e dor em crianças acima de 6 meses.

COMO USAR: a dose é calculada pelo PESO da criança e informada pelo profissional. A referência usual é 5 a 10 mg por quilo a cada 6 a 8 horas. Agite o frasco antes de cada uso e meça com a seringa que acompanha a embalagem.

QUANDO NÃO DEVO USAR: menores de 6 meses, alergia a anti-inflamatórios, catapora, desidratação ou vômito persistente.

ADVERTÊNCIAS: criança desidratada tem risco renal maior com este medicamento — ofereça líquido. Não alterne com outro anti-inflamatório sem orientação.

VENDA SEM PRESCRIÇÃO MÉDICA.$$),

  ('10230039200100', $$AMOXIL 500 mg (amoxicilina)

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: infecções causadas por bactérias sensíveis à amoxicilina.

COMO USAR: adultos, 1 cápsula de 8 em 8 horas, pelo número de dias que o profissional indicou.

QUANDO NÃO DEVO USAR: alergia à amoxicilina, a penicilinas ou a cefalosporinas.

ADVERTÊNCIAS: TERMINE A CAIXA INTEIRA, mesmo que melhore antes. Parar cedo seleciona bactéria resistente e a infecção volta mais difícil de tratar. Procure atendimento imediato em caso de placas na pele, inchaço de lábios ou falta de ar. Este medicamento pode reduzir o efeito do anticoncepcional.

VENDA SOB PRESCRIÇÃO MÉDICA.$$),

  ('10230039200283', $$AMOXIL 875 mg (amoxicilina)

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: infecções causadas por bactérias sensíveis à amoxicilina.

COMO USAR: adultos, 1 comprimido de 12 em 12 horas, pelo período indicado.

QUANDO NÃO DEVO USAR: alergia à amoxicilina, a penicilinas ou a cefalosporinas.

ADVERTÊNCIAS: complete todo o tratamento. Diarreia leve é comum; diarreia com sangue ou muito intensa exige atendimento. Este medicamento pode reduzir o efeito do anticoncepcional.

VENDA SOB PRESCRIÇÃO MÉDICA.$$),

  ('10230039200364', $$AMOXIL SUSPENSÃO 250 mg/5 mL (amoxicilina)

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: infecções bacterianas em crianças.

COMO USAR: a dose vem do PESO da criança e é informada pelo profissional. Agite bem antes de cada dose e meça com a seringa da embalagem.

CONSERVAÇÃO: depois de preparada, a suspensão fica na geladeira e vale 14 dias. Passado esse prazo, descarte mesmo que tenha sobrado.

QUANDO NÃO DEVO USAR: alergia a penicilinas ou cefalosporinas.

ADVERTÊNCIAS: complete todos os dias prescritos. Procure atendimento em caso de manchas na pele ou inchaço no rosto.

VENDA SOB PRESCRIÇÃO MÉDICA.$$),

  ('10230039300108', $$NIMESULIDA 100 mg

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: dor e inflamação de curta duração.

COMO USAR: adultos, 1 comprimido de 12 em 12 horas, após alimentação, por no máximo 15 dias.

QUANDO NÃO DEVO USAR: menores de 12 anos, gravidez, doença do fígado, úlcera ativa ou uso de outro anti-inflamatório.

ADVERTÊNCIAS: este medicamento exige atenção com o fígado. Interrompa e procure atendimento se aparecer pele ou olhos amarelados, urina escura, náusea persistente ou cansaço fora do comum. Não use com bebida alcoólica.

VENDA SOB PRESCRIÇÃO MÉDICA.$$),

  ('10230039400102', $$OMEPRAZOL 20 mg

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: refluxo, azia persistente, úlcera e proteção do estômago durante o uso de anti-inflamatórios.

COMO USAR: 1 cápsula por dia, EM JEJUM, 30 a 60 minutos antes do café da manhã. Engula inteira, sem abrir nem mastigar.

QUANDO NÃO DEVO USAR: alergia ao omeprazol.

ADVERTÊNCIAS: tomar junto ou depois da refeição reduz muito o efeito — o horário faz parte do tratamento. Uso prolongado sem acompanhamento pode afetar a absorção de vitamina B12, magnésio e cálcio. Avise se usa clopidogrel.

VENDA SOB PRESCRIÇÃO MÉDICA.$$),

  ('10230039500106', $$METFORMINA 500 mg

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: controle da glicose no diabetes tipo 2.

COMO USAR: 1 comprimido durante ou logo após a refeição, na frequência que o profissional indicou. Tomar em jejum aumenta o enjoo.

QUANDO NÃO DEVO USAR: doença renal grave ou acidose.

ADVERTÊNCIAS: enjoo e intestino solto nas primeiras semanas são esperados e costumam passar. AVISE ANTES de qualquer exame com contraste iodado ou cirurgia — a metformina é suspensa nesses casos. Procure atendimento em caso de respiração ofegante, dor muscular intensa ou muito cansaço.

VENDA SOB PRESCRIÇÃO MÉDICA.$$),

  ('10230039500289', $$METFORMINA 850 mg

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: controle da glicose no diabetes tipo 2.

COMO USAR: 1 comprimido durante ou logo após a refeição, na frequência indicada. Não parta nem triture sem orientação.

QUANDO NÃO DEVO USAR: doença renal grave ou acidose.

ADVERTÊNCIAS: avise antes de exame com contraste iodado ou cirurgia. Evite excesso de álcool. Mantenha os exames de função renal em dia.

VENDA SOB PRESCRIÇÃO MÉDICA.$$),

  ('10230039700104', $$DIPIRONA 500 mg

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: dor e febre.

COMO USAR: adultos e maiores de 15 anos, 1 a 2 comprimidos até 4 vezes ao dia.

QUANDO NÃO DEVO USAR: alergia à dipirona, alterações da medula óssea ou deficiência de G6PD.

ADVERTÊNCIAS: raramente a dipirona reduz as células de defesa. PARE e procure atendimento em caso de febre com dor de garganta, feridas na boca ou infecção que não melhora. Pode deixar a urina avermelhada, o que é inofensivo.

VENDA SEM PRESCRIÇÃO MÉDICA.$$),

  ('10230039800108', $$AZITROMICINA 500 mg

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: infecções respiratórias, de pele e algumas infecções sexualmente transmissíveis.

COMO USAR: 1 comprimido por dia, no mesmo horário, geralmente por 3 a 5 dias.

QUANDO NÃO DEVO USAR: alergia à azitromicina ou a outros macrolídeos, doença grave do fígado.

ADVERTÊNCIAS: o tratamento é curto, mas o efeito continua depois da última dose — não estranhe. Não tome junto com antiácido de alumínio ou magnésio; separe por 2 horas. Avise se usa remédio para arritmia.

VENDA SOB PRESCRIÇÃO MÉDICA.$$),

  ('10230039900102', $$CETIRIZINA 10 mg

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: rinite alérgica e urticária.

COMO USAR: adultos e maiores de 12 anos, 1 comprimido por dia, de preferência à noite.

QUANDO NÃO DEVO USAR: alergia à cetirizina ou à hidroxizina; doença renal grave sem ajuste de dose.

ADVERTÊNCIAS: pode dar sono. Avalie como você reage antes de dirigir ou operar máquina. Evite álcool.

VENDA SEM PRESCRIÇÃO MÉDICA.$$),

  ('10230040000106', $$PANTOPRAZOL 40 mg

BULA DO PACIENTE

PARA QUE ESTE MEDICAMENTO É INDICADO: refluxo, esofagite e úlcera.

COMO USAR: 1 comprimido por dia, EM JEJUM, antes do café da manhã. Engula inteiro, sem partir nem mastigar — a capa protege o remédio do ácido do estômago.

QUANDO NÃO DEVO USAR: alergia ao pantoprazol.

ADVERTÊNCIAS: o horário em jejum faz parte do tratamento. Uso prolongado sem acompanhamento pode afetar magnésio e vitamina B12. Azia que não melhora em 15 dias merece reavaliação.

VENDA SOB PRESCRIÇÃO MÉDICA.$$)
) AS v(registro, conteudo)
JOIN drug.medicamento AS m ON m.registro_anvisa = v.registro
WHERE NOT EXISTS (
  SELECT 1 FROM drug.bula AS b
   WHERE b.medicamento_id = m.id AND b.tipo = 'paciente'
);

-- ── 3. Bulas profissionais ────────────────────────────────────────────────
-- Esta e a metade que o medico abre e que praticamente nao existia: das 18
-- apresentacoes semeadas, 3 tinham versao profissional, e as 3 estavam com a
-- quebra de linha quebrada.
INSERT INTO drug.bula (medicamento_id, tipo, conteudo, versao, data_publicacao)
SELECT m.id, 'profissional', v.conteudo, 'Versão assistencial 1.0', CURRENT_DATE
FROM (VALUES
  ('10230039000106', $$TYLENOL 500 mg (paracetamol) — BULA PROFISSIONAL

CLASSE: analgésico e antitérmico de ação central.

POSOLOGIA: 500 a 1000 mg VO a cada 4-6 h. Máximo 4 g/dia em adulto hígido; 3 g/dia em hepatopata, etilista, desnutrido ou idoso de baixo peso.

FARMACOCINÉTICA: pico em 30-60 min. Metabolismo hepático; a via CYP2E1 gera NAPQI, conjugado pela glutationa. Depleção de glutationa é o mecanismo da hepatotoxicidade.

CONTRAINDICAÇÕES: hipersensibilidade ao paracetamol; insuficiência hepática grave.

INTERAÇÕES: varfarina (aumento do INR com uso continuado); indutores enzimáticos e etanol crônico (maior formação de NAPQI).

ATENÇÃO: a intoxicação mais frequente é por SOMA de apresentações — o paciente associa antigripal e analgésico sem saber que ambos contêm paracetamol. Antídoto: N-acetilcisteína, guiada pelo nomograma de Rumack-Matthew.

INSUFICIÊNCIA RENAL: espaçar para 8 h se ClCr < 30 mL/min.$$),

  ('10230039000298', $$TYLENOL 750 mg (paracetamol) — BULA PROFISSIONAL

CLASSE: analgésico e antitérmico de ação central.

POSOLOGIA: 750 mg VO a cada 6-8 h. Máximo 4 g/dia (5 comprimidos); reduzir para 3 g/dia em hepatopata, etilista ou idoso.

OBSERVAÇÃO DE PRESCRIÇÃO: a apresentação de 750 mg estreita a margem entre dose habitual e teto diário. Ao prescrever, explicite o intervalo mínimo e o número máximo de comprimidos em 24 h.

CONTRAINDICAÇÕES: hipersensibilidade; insuficiência hepática grave.

INTERAÇÕES: varfarina, indutores do CYP2E1, etanol crônico.

INSUFICIÊNCIA RENAL: espaçar para 8 h se ClCr < 30 mL/min.$$),

  ('10230039000379', $$TYLENOL GOTAS 200 mg/mL (paracetamol) — BULA PROFISSIONAL

CLASSE: analgésico e antitérmico pediátrico.

POSOLOGIA: 10 a 15 mg/kg/dose a cada 4-6 h; máximo 5 doses/24 h e 75 mg/kg/dia. Nesta concentração, 1 gota ≈ 5 mg, o que aproxima a regra prática de 1 gota/kg/dose. Teto de 35 gotas por dose.

ATENÇÃO À CONCENTRAÇÃO: coexistem no mercado apresentações de 100 mg/mL e 200 mg/mL. Prescrever "gotas" sem fixar a concentração é causa conhecida de erro de dose por fator 2. Registre mg/kg e a concentração no receituário.

CONTRAINDICAÇÕES: hipersensibilidade; hepatopatia grave.

ANTÍDOTO: N-acetilcisteína.$$),

  ('10230039100102', $$ADVIL 600 mg (ibuprofeno) — BULA PROFISSIONAL

CLASSE: AINE derivado do ácido propiônico; inibição não seletiva de COX-1 e COX-2.

POSOLOGIA: 600 mg VO a cada 6-8 h com alimento. Máximo 2400 mg/dia. Usar a menor dose eficaz pelo menor tempo.

CONTRAINDICAÇÕES: hipersensibilidade a AINE, asma induzida por AINE, úlcera péptica ativa, sangramento digestivo, DRC com ClCr < 30, insuficiência cardíaca grave, pós-operatório de revascularização miocárdica, terceiro trimestre de gestação (fechamento do canal arterial).

INTERAÇÕES: anticoagulantes e antiagregantes (sangramento); IECA/BRA + diurético (a "tríplice whammy" precipita lesão renal aguda); lítio e metotrexato (elevação sérica); anti-hipertensivos (perda de controle pressórico).

MONITORAMENTO: função renal e pressão arterial em uso prolongado; considerar gastroproteção em paciente com fator de risco digestivo.$$),

  ('10230039100285', $$ADVIL 400 mg (ibuprofeno) — BULA PROFISSIONAL

CLASSE: AINE não seletivo.

POSOLOGIA: 400 mg VO a cada 6-8 h com alimento. Máximo 1200 mg/dia sem supervisão. O efeito analgésico satura em torno de 400 mg/dose; acima disso ganha-se ação anti-inflamatória, não analgesia.

CONTRAINDICAÇÕES: as mesmas da apresentação de 600 mg.

INTERAÇÕES: anticoagulantes, IECA/BRA com diurético, lítio, metotrexato, anti-hipertensivos.

MONITORAMENTO: pressão arterial e função renal se o uso passar de dias.$$),

  ('10230039100366', $$ADVIL SUSPENSÃO PEDIÁTRICA 100 mg/5 mL (ibuprofeno) — BULA PROFISSIONAL

CLASSE: AINE não seletivo, apresentação pediátrica.

POSOLOGIA: 5 a 10 mg/kg/dose a cada 6-8 h. Máximo 40 mg/kg/dia. Não indicado abaixo de 6 meses.

CONTRAINDICAÇÕES: menores de 6 meses, desidratação, varicela (associação com fasciíte necrosante), hipersensibilidade a AINE, doença renal.

ATENÇÃO: criança com vômito, diarreia ou baixa ingesta tem perfusão renal dependente de prostaglandina — o AINE nesse cenário precipita lesão renal aguda. Hidratar antes de manter a prescrição.

PRESCRIÇÃO: registre mg/kg/dose e a concentração; a suspensão existe em mais de uma concentração.$$),

  ('10230039200100', $$AMOXIL 500 mg (amoxicilina) — BULA PROFISSIONAL

CLASSE: aminopenicilina; inibe a transpeptidação da parede celular.

ESPECTRO: S. pyogenes, S. pneumoniae (sensível), E. faecalis, H. influenzae não produtor de betalactamase, E. coli e P. mirabilis sensíveis, H. pylori em esquema combinado. NÃO cobre produtores de betalactamase — nesse caso, associação com clavulanato.

POSOLOGIA: 500 mg VO a cada 8 h. Faringoamigdalite estreptocócica: 10 dias. Profilaxia de endocardite: 2 g em dose única, 30-60 min antes do procedimento.

CONTRAINDICAÇÕES: hipersensibilidade a betalactâmicos. Reatividade cruzada com cefalosporinas é baixa e concentrada nas de primeira geração.

INTERAÇÕES: metotrexato (redução da depuração); alopurinol (mais exantema).

ATENÇÃO: exantema após amoxicilina em mononucleose é reação farmacológica, não alergia — rotular o paciente como alérgico a penicilina indevidamente encarece e piora todo tratamento futuro.

INSUFICIÊNCIA RENAL: ajustar intervalo se ClCr < 30 mL/min.$$),

  ('10230039200283', $$AMOXIL 875 mg (amoxicilina) — BULA PROFISSIONAL

CLASSE: aminopenicilina.

POSOLOGIA: 875 mg VO a cada 12 h. O esquema de 12/12 h favorece adesão com eficácia equivalente ao de 8/8 h nas indicações usuais de via aérea.

ESPECTRO E CONTRAINDICAÇÕES: idênticos aos da apresentação de 500 mg.

INSUFICIÊNCIA RENAL: evitar a apresentação de 875 mg se ClCr < 30 mL/min; migrar para dose menor com intervalo ajustado.

ATENÇÃO: diarreia associada a C. difficile pode surgir semanas após o término do curso.$$),

  ('10230039200364', $$AMOXIL SUSPENSÃO 250 mg/5 mL (amoxicilina) — BULA PROFISSIONAL

CLASSE: aminopenicilina, apresentação pediátrica.

POSOLOGIA: 45 a 50 mg/kg/dia divididos em 2 a 3 tomadas. Otite média aguda em região de pneumococo com sensibilidade reduzida: 80 a 90 mg/kg/dia.

ESTABILIDADE: após reconstituição, 14 dias sob refrigeração. Registre a data de preparo no frasco.

CONTRAINDICAÇÕES: hipersensibilidade a betalactâmicos.

PRESCRIÇÃO: registre mg/kg/dia e a concentração — 250 mg/5 mL e 400 mg/5 mL coexistem.$$),

  ('10230039300108', $$NIMESULIDA 100 mg — BULA PROFISSIONAL

CLASSE: AINE sulfonanilida, com relativa preferência por COX-2.

POSOLOGIA: 100 mg VO a cada 12 h, após alimento. DURAÇÃO MÁXIMA DE 15 DIAS — restrição regulatória motivada por hepatotoxicidade.

CONTRAINDICAÇÕES: menores de 12 anos, gestação, hepatopatia, uso concomitante de hepatotóxicos, úlcera ativa, DRC avançada.

HEPATOTOXICIDADE: a nimesulida tem sinal de lesão hepática idiossincrática que motivou restrição em várias agências. Orientar suspensão imediata diante de icterícia, colúria, náusea persistente ou astenia, e reavaliar antes de renovar a prescrição.

INTERAÇÕES: anticoagulantes, IECA/BRA com diurético, lítio, metotrexato.$$),

  ('10230039400102', $$OMEPRAZOL 20 mg — BULA PROFISSIONAL

CLASSE: inibidor da bomba de prótons (H+/K+-ATPase).

POSOLOGIA: 20 mg/dia em jejum, 30-60 min antes da primeira refeição. DRGE: 4 a 8 semanas. Erradicação de H. pylori: 20 mg 12/12 h em esquema combinado. Profilaxia de úlcera por AINE em paciente de risco: 20 mg/dia.

FARMACODINÂMICA: bloqueia a bomba ativada. Sem estímulo alimentar subsequente, boa parte das bombas permanece inativa e o efeito cai — a instrução de jejum é farmacológica, não conveniência.

INTERAÇÕES: clopidogrel (inibição do CYP2C19 reduz a ativação do pró-fármaco; pantoprazol é a alternativa de menor interação); atazanavir, itraconazol e cetoconazol (absorção pH-dependente); metotrexato em dose alta.

USO PROLONGADO: hipomagnesemia, deficiência de B12, maior risco de fratura e de infecção entérica. Reavaliar indicação periodicamente e planejar desmame.$$),

  ('10230039500106', $$METFORMINA 500 mg — BULA PROFISSIONAL

CLASSE: biguanida. Reduz gliconeogênese hepática e melhora sensibilidade periférica à insulina. Não causa hipoglicemia em monoterapia.

POSOLOGIA: iniciar 500 mg 1x/dia com refeição e titular semanalmente até 1500-2000 mg/dia divididos. Escalonar reduz intolerância digestiva.

CONTRAINDICAÇÕES: TFG < 30 mL/min/1,73 m²; acidose metabólica aguda; hipóxia tecidual.

FUNÇÃO RENAL: TFG 30-45 — não iniciar; se em uso, reduzir dose e monitorar. TFG ≥ 45 — manter com controle periódico.

SUSPENSÃO TEMPORÁRIA: antes de contraste iodado intravascular em paciente com TFG < 60, e antes de cirurgia de grande porte. Reintroduzir 48 h depois, com função renal reavaliada.

ACIDOSE LÁCTICA: rara e grave. Suspeitar diante de mal-estar, mialgia, dispneia e dor abdominal, sobretudo com desidratação ou sepse.

OUTROS: monitorar B12 em uso prolongado.$$),

  ('10230039500289', $$METFORMINA 850 mg — BULA PROFISSIONAL

CLASSE: biguanida.

POSOLOGIA: 850 mg 1 a 2x/dia com refeição; máximo usual 2550 mg/dia. Alcançar 850 mg 2x/dia partindo de 500 mg reduz abandono por intolerância digestiva.

CONTRAINDICAÇÕES E MONITORAMENTO: idênticos aos da apresentação de 500 mg — TFG < 30 contraindica; suspender antes de contraste iodado e cirurgia de grande porte.

OBSERVAÇÃO: em intolerância digestiva persistente, a formulação de liberação prolongada costuma ser mais bem tolerada que o fracionamento.$$),

  ('10230039700104', $$DIPIRONA 500 mg — BULA PROFISSIONAL

CLASSE: pirazolona; analgésico e antitérmico não opioide, com ação espasmolítica.

POSOLOGIA: 500 a 1000 mg VO até 4x/dia. Máximo 4 g/dia.

CONTRAINDICAÇÕES: hipersensibilidade a pirazolonas, discrasias sanguíneas, deficiência de G6PD, porfiria hepática aguda, gestação no terceiro trimestre.

AGRANULOCITOSE: reação idiossincrática rara, imunomediada, sem relação com dose ou tempo de uso. Orientar suspensão imediata e hemograma diante de febre, odinofagia, úlcera oral ou infecção inesperada.

HIPOTENSÃO: infusão intravenosa rápida causa queda pressórica; administrar lentamente.

OBSERVAÇÃO: metabólito ácido rubazônico pode dar cromatúria avermelhada — achado benigno, mas motivo frequente de alarme.$$),

  ('10230039800108', $$AZITROMICINA 500 mg — BULA PROFISSIONAL

CLASSE: macrolídeo azalídeo; inibe a subunidade ribossômica 50S.

POSOLOGIA: 500 mg/dia por 3 dias, ou 500 mg no dia 1 seguidos de 250 mg do dia 2 ao 5. Clamídia urogenital: 1 g em dose única.

FARMACOCINÉTICA: meia-vida tecidual longa, com concentração intracelular elevada. A ação persiste após o fim da tomada — daí o curso curto.

CONTRAINDICAÇÕES: hipersensibilidade a macrolídeos; colestase prévia associada à azitromicina.

QT: prolonga o intervalo QT. Cautela com antiarrítmicos, antipsicóticos, fluoroquinolonas, ondansetrona, e em hipocalemia ou hipomagnesemia.

INTERAÇÕES: antiácidos com alumínio ou magnésio reduzem o pico — separar 2 h.

RESISTÊNCIA: pneumococo com resistência relevante a macrolídeo em várias regiões; considerar o perfil local antes de usar em monoterapia para pneumonia.$$),

  ('10230039900102', $$CETIRIZINA 10 mg — BULA PROFISSIONAL

CLASSE: anti-histamínico H1 de segunda geração, metabólito ativo da hidroxizina.

POSOLOGIA: 10 mg/dia. Idosos e ClCr 30-49 mL/min: 5 mg/dia. ClCr 10-29: 5 mg em dias alternados.

CONTRAINDICAÇÕES: hipersensibilidade à cetirizina, à levocetirizina ou à hidroxizina; DRC terminal.

SEDAÇÃO: atravessa a barreira hematoencefálica mais que fexofenadina e loratadina — é a mais sedativa das de segunda geração. Considerar isso para motorista profissional e operador de máquina.

INTERAÇÕES: potencializa depressores do SNC e álcool.

OBSERVAÇÃO: suspender 3 a 7 dias antes de teste cutâneo de alergia, sob risco de falso-negativo.$$),

  ('10230040000106', $$PANTOPRAZOL 40 mg — BULA PROFISSIONAL

CLASSE: inibidor da bomba de prótons.

POSOLOGIA: 40 mg/dia em jejum, 30-60 min antes da primeira refeição. Esofagite erosiva: 8 semanas, com possibilidade de mais 8 na ausência de cicatrização.

VANTAGEM DE PERFIL: entre os IBP, é o de menor inibição do CYP2C19 — preferido no paciente em uso de clopidogrel.

CONTRAINDICAÇÕES: hipersensibilidade a benzimidazóis substituídos.

APRESENTAÇÃO: comprimido com revestimento entérico; partir ou triturar destrói a proteção e inativa o fármaco no estômago.

USO PROLONGADO: hipomagnesemia, deficiência de B12, nefrite intersticial aguda, maior risco de infecção entérica. Reavaliar indicação e planejar desmame.$$)
) AS v(registro, conteudo)
JOIN drug.medicamento AS m ON m.registro_anvisa = v.registro
WHERE NOT EXISTS (
  SELECT 1 FROM drug.bula AS b
   WHERE b.medicamento_id = m.id AND b.tipo = 'profissional'
);
