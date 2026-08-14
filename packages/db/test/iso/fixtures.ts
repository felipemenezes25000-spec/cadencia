/**
 * Identificadores fixos da suite de isolamento.
 * São UUIDs válidos com o formato de um UUIDv7 (versão 7, variante 10xx) para que
 * nenhuma coluna precise de tratamento especial. São literais de propósito:
 * um teste de isolamento tem que ser reproduzível byte a byte.
 */
export const TENANT_A = '01930000-0000-7000-8000-0000000000a0';
export const TENANT_B = '01930000-0000-7000-8000-0000000000b0';

export const CLINIC_A_SP = '01930000-0000-7000-8000-0000000000a1';
export const CLINIC_A_MANAUS = '01930000-0000-7000-8000-0000000000a2';
export const CLINIC_B_RIO_BRANCO = '01930000-0000-7000-8000-0000000000b1';

export const USER_A_ANA = '01930000-0000-7000-8000-0000000000a3';
export const USER_A_BRUNO = '01930000-0000-7000-8000-0000000000a4';
export const USER_A_CARLA = '01930000-0000-7000-8000-0000000000a5';
export const USER_B_DIEGO = '01930000-0000-7000-8000-0000000000b2';

export const PROF_A_ANA = '01930000-0000-7000-8000-0000000000a6';
export const PROF_A_BRUNO = '01930000-0000-7000-8000-0000000000a7';
export const PROF_B_DIEGO = '01930000-0000-7000-8000-0000000000b3';

export const MEMBERSHIP_ANA_SP = '01930000-0000-7000-8000-0000000000c1';
export const MEMBERSHIP_ANA_MANAUS = '01930000-0000-7000-8000-0000000000c2';
export const MEMBERSHIP_BRUNO_SP = '01930000-0000-7000-8000-0000000000c3';
export const MEMBERSHIP_CARLA_SP = '01930000-0000-7000-8000-0000000000c4';
export const MEMBERSHIP_DIEGO_RB = '01930000-0000-7000-8000-0000000000c5';

export const PATIENT_A_JOANA = '01930000-0000-7000-8000-0000000000a8';
export const PATIENT_A_RECEM_NASCIDO = '01930000-0000-7000-8000-0000000000a9';
export const PATIENT_B_MARCOS = '01930000-0000-7000-8000-0000000000b4';

export const PID_A_JOANA_CPF = '01930000-0000-7000-8000-0000000000aa';
export const PID_A_RN_SEM_DOCUMENTO = '01930000-0000-7000-8000-0000000000ab';
export const PID_B_MARCOS_CPF = '01930000-0000-7000-8000-0000000000b5';

export const SHARE_A_JOANA_PARA_BRUNO = '01930000-0000-7000-8000-0000000000ac';
export const SHARE_B_MARCOS_PARA_DIEGO = '01930000-0000-7000-8000-0000000000ad';

/** Definição de prontuário: uma seção e um campo vivos em cada tenant. */
export const SECTION_A_SINAIS_VITAIS = '01930000-0000-7000-8000-0000000000ae';
export const FIELD_A_PESO = '01930000-0000-7000-8000-0000000000af';
export const SECTION_B_SINAIS_VITAIS = '01930000-0000-7000-8000-0000000000b6';
export const FIELD_B_PESO = '01930000-0000-7000-8000-0000000000b7';

/** Campo composto: 'PA' é um campo com DOIS componentes em cada tenant. */
export const FIELD_A_PA = '01930000-0000-7000-8000-0000000000b8';
export const FIELD_B_PA = '01930000-0000-7000-8000-0000000000b9';
export const COMPONENT_A_PA_SIS = '01930000-0000-7000-8000-0000000000ba';
export const COMPONENT_A_PA_DIA = '01930000-0000-7000-8000-0000000000bb';
export const COMPONENT_B_PA_SIS = '01930000-0000-7000-8000-0000000000bc';
export const COMPONENT_B_PA_DIA = '01930000-0000-7000-8000-0000000000bd';

/** Layout do prontuário: cada tenant tem um profissional com ordem própria. */
export const LAYOUT_A_ANA_SINAIS_VITAIS = '01930000-0000-7000-8000-0000000000be';
export const LAYOUT_B_DIEGO_SINAIS_VITAIS = '01930000-0000-7000-8000-0000000000bf';

/** Atendimento: o agregado clínico, um em cada tenant. */
export const ENCOUNTER_A_JOANA = '01930000-0000-7000-8000-0000000000c6';
export const ENCOUNTER_B_MARCOS = '01930000-0000-7000-8000-0000000000c7';

/** Versão original já finalizada de cada atendimento do seed. */
export const VERSION_A_JOANA_ORIGINAL = '01930000-0000-7000-8000-0000000000c8';
export const VERSION_B_MARCOS_ORIGINAL = '01930000-0000-7000-8000-0000000000c9';

/** Um valor de campo ('Peso') gravado na versão original de cada tenant. */
export const FIELD_VALUE_A_JOANA_PESO = '01930000-0000-7000-8000-0000000000ca';
export const FIELD_VALUE_B_MARCOS_PESO = '01930000-0000-7000-8000-0000000000cb';

/**
 * Linhas de primeira classe promovidas para fora do EAV: uma de cada tipo em cada
 * tenant, penduradas na versão original do atendimento daquele tenant.
 */
export const DIAGNOSIS_A_JOANA = '01930000-0000-7000-8000-0000000000cc';
export const DIAGNOSIS_B_MARCOS = '01930000-0000-7000-8000-0000000000cd';
export const OBSERVATION_A_JOANA_PESO = '01930000-0000-7000-8000-0000000000ce';
export const OBSERVATION_B_MARCOS_PESO = '01930000-0000-7000-8000-0000000000cf';
export const FINDING_A_JOANA = '01930000-0000-7000-8000-0000000000d0';
export const FINDING_B_MARCOS = '01930000-0000-7000-8000-0000000000d1';
export const PROCEDURE_A_JOANA = '01930000-0000-7000-8000-0000000000d2';
export const PROCEDURE_B_MARCOS = '01930000-0000-7000-8000-0000000000d3';

/** Apoio por IA registrado no prontuário: uma linha em cada tenant. */
export const AI_ASSISTANCE_A_JOANA = '01930000-0000-7000-8000-0000000000d4';
export const AI_ASSISTANCE_B_MARCOS = '01930000-0000-7000-8000-0000000000d5';

/**
 * Campos da guia de consulta capturados no atendimento: um por tenant.
 * Aurora atende por convênio (tem registro_ans e carteirinha); Boreal atende
 * particular (não tem nem uma coisa nem outra).
 */
export const BILLING_A_JOANA = '01930000-0000-7000-8000-0000000000d6';
export const BILLING_B_MARCOS = '01930000-0000-7000-8000-0000000000d7';

/** Assinatura digital: uma linha em cada tenant. */
export const SIGNATURE_A_JOANA = '01930000-0000-7000-8000-0000000000d8';
export const SIGNATURE_B_MARCOS = '01930000-0000-7000-8000-0000000000d9';

/** Pendência de assinatura: uma linha em cada tenant. */
export const SIGNATURE_PENDING_A = '01930000-0000-7000-8000-0000000000da';
export const SIGNATURE_PENDING_B = '01930000-0000-7000-8000-0000000000db';

/** Documento clínico nato-digital: uma linha em cada tenant. */
export const DOCUMENT_A_JOANA = '01930000-0000-7000-8000-0000000000dc';
export const DOCUMENT_B_MARCOS = '01930000-0000-7000-8000-0000000000dd';

/** Anexo clínico: uma linha em cada tenant. */
export const ATTACHMENT_A_JOANA = '01930000-0000-7000-8000-0000000000de';
export const ATTACHMENT_B_MARCOS = '01930000-0000-7000-8000-0000000000df';

/** Exportação de prontuário: uma linha em cada tenant. */
export const RECORD_EXPORT_A_JOANA = '01930000-0000-7000-8000-0000000000e0';
export const RECORD_EXPORT_B_MARCOS = '01930000-0000-7000-8000-0000000000e1';

/** Prescrição: uma linha em cada tenant. */
export const PRESCRIPTION_A_JOANA = '01930000-0000-7000-8000-0000000000e2';
export const PRESCRIPTION_B_MARCOS = '01930000-0000-7000-8000-0000000000e3';
export const PRESCRIPTION_ITEM_A = '01930000-0000-7000-8000-0000000000e4';
export const PRESCRIPTION_ITEM_B = '01930000-0000-7000-8000-0000000000e5';

/** Outbox: um evento transacional em cada tenant. */
export const OUTBOX_A = '01930000-0000-7000-8000-0000000000e6';
export const OUTBOX_B = '01930000-0000-7000-8000-0000000000e7';

/** Categoria de lançamento financeiro: uma em cada tenant. */
export const CATEGORY_A = '01930000-0000-7000-8000-0000000000e8';
export const CATEGORY_B = '01930000-0000-7000-8000-0000000000e9';

/** Método de pagamento: um em cada tenant. */
export const PAYMENT_METHOD_A = '01930000-0000-7000-8000-0000000000ea';
export const PAYMENT_METHOD_B = '01930000-0000-7000-8000-0000000000eb';

/** Lançamento financeiro: um em cada tenant. */
export const ENTRY_A = '01930000-0000-7000-8000-0000000000ec';
export const ENTRY_B = '01930000-0000-7000-8000-0000000000ed';

/** Recibo: um em cada tenant. */
export const RECEIPT_A = '01930000-0000-7000-8000-0000000000ee';
export const RECEIPT_B = '01930000-0000-7000-8000-0000000000ef';

/** Link de pagamento: um em cada tenant. */
export const PAYMENT_LINK_A = '01930000-0000-7000-8000-0000000000f0';
export const PAYMENT_LINK_B = '01930000-0000-7000-8000-0000000000f1';

/** Log de conciliação: um em cada tenant. */
export const RECONCILIATION_LOG_A = '01930000-0000-7000-8000-0000000000f2';
export const RECONCILIATION_LOG_B = '01930000-0000-7000-8000-0000000000f3';

/** Evento bruto de webhook do PSP: um em cada tenant. */
export const WEBHOOK_EVENT_A = '01930000-0000-7000-8000-0000000000f4';
export const WEBHOOK_EVENT_B = '01930000-0000-7000-8000-0000000000f5';

/** Operadora de plano de saúde: uma em cada tenant. */
export const OPERADORA_A = '01930000-0000-7000-8000-000000000f01';
export const OPERADORA_B = '01930000-0000-7000-8000-000000000f02';

/** Contrato operadora x prestador: um em cada tenant. */
export const CONTRATO_A = '01930000-0000-7000-8000-000000000f03';
export const CONTRATO_B = '01930000-0000-7000-8000-000000000f04';

/** Vínculo paciente x convênio (carteirinha): um em cada tenant. */
export const PACIENTE_CONVENIO_A = '01930000-0000-7000-8000-000000000f05';
export const PACIENTE_CONVENIO_B = '01930000-0000-7000-8000-000000000f06';

/** Guia de consulta TISS: uma em cada tenant. */
export const GUIA_CONSULTA_A = '01930000-0000-7000-8000-0000000000f8';
export const GUIA_CONSULTA_B = '01930000-0000-7000-8000-0000000000f9';

/** Ajuste de faturamento: um em cada tenant. */
export const GUIA_AJUSTE_A = '01930000-0000-7000-8000-0000000000fa';
export const GUIA_AJUSTE_B = '01930000-0000-7000-8000-0000000000fb';

/** Pendência de reprojeção TISS: uma em cada tenant. */
export const GUIA_PENDENCIA_A = '01930000-0000-7000-8000-0000000000fc';
export const GUIA_PENDENCIA_B = '01930000-0000-7000-8000-0000000000fd';

/** Procedimento da agenda: um em cada tenant. */
export const SCHED_PROCEDURE_A = '01930000-0000-7000-8000-000000001001';
export const SCHED_PROCEDURE_B = '01930000-0000-7000-8000-000000001002';

/** Agendamento: um em cada tenant. */
export const SCHED_APPOINTMENT_A = '01930000-0000-7000-8000-000000001003';
export const SCHED_APPOINTMENT_B = '01930000-0000-7000-8000-000000001004';

/** Bloqueio de agenda: um em cada tenant. */
export const SCHED_BLOCK_A = '01930000-0000-7000-8000-000000001005';
export const SCHED_BLOCK_B = '01930000-0000-7000-8000-000000001006';

/** Recorrência de agendamento: uma em cada tenant. */
export const SCHED_RECURRENCE_A = '01930000-0000-7000-8000-000000001007';
export const SCHED_RECURRENCE_B = '01930000-0000-7000-8000-000000001008';

/** Lista de espera: uma em cada tenant. */
export const SCHED_WAITLIST_A = '01930000-0000-7000-8000-000000001009';
export const SCHED_WAITLIST_B = '01930000-0000-7000-8000-00000000100a';

/** Canal de mensageria: um em cada tenant. */
export const CHANNEL_A = '01930000-0000-7000-8000-000000001011';
export const CHANNEL_B = '01930000-0000-7000-8000-000000001012';

/** Template de mensagem: um em cada tenant. */
export const MSG_TEMPLATE_A = '01930000-0000-7000-8000-000000001013';
export const MSG_TEMPLATE_B = '01930000-0000-7000-8000-000000001014';

/** Conversa: uma em cada tenant. */
export const CONVERSATION_A = '01930000-0000-7000-8000-000000001015';
export const CONVERSATION_B = '01930000-0000-7000-8000-000000001016';

/** Mensagem: uma em cada tenant. */
export const MESSAGE_A = '01930000-0000-7000-8000-000000001017';
export const MESSAGE_B = '01930000-0000-7000-8000-000000001018';

/** Evento de entrada (webhook): um em cada tenant. */
export const INBOUND_EVENT_A = '01930000-0000-7000-8000-000000001019';
export const INBOUND_EVENT_B = '01930000-0000-7000-8000-00000000101a';

/** Regra de automação: uma em cada tenant. */
export const AUTOMATION_RULE_A = '01930000-0000-7000-8000-00000000101b';
export const AUTOMATION_RULE_B = '01930000-0000-7000-8000-00000000101c';

/** Resposta NPS: uma em cada tenant. */
export const NPS_RESPONSE_A = '01930000-0000-7000-8000-00000000101d';
export const NPS_RESPONSE_B = '01930000-0000-7000-8000-00000000101e';

/** Lembrete enviado: um em cada tenant. */
export const SENT_REMINDER_A = '01930000-0000-7000-8000-00000000101f';
export const SENT_REMINDER_B = '01930000-0000-7000-8000-000000001020';

/** Centro de custo: um em cada tenant. */
export const COST_CENTER_A = '01930000-0000-7000-8000-000000001031';
export const COST_CENTER_B = '01930000-0000-7000-8000-000000001032';

/** Fornecedor financeiro: um em cada tenant. */
export const FIN_SUPPLIER_A = '01930000-0000-7000-8000-000000001033';
export const FIN_SUPPLIER_B = '01930000-0000-7000-8000-000000001034';

/** Segunda conta bancária (para transferências): uma em cada tenant. */
export const BANK_ACCOUNT_2_A = '01930000-0000-7000-8000-000000001035';
export const BANK_ACCOUNT_2_B = '01930000-0000-7000-8000-000000001036';

/** Lançamentos extras para transferência: débito e crédito em cada tenant. */
export const ENTRY_XFER_DEBIT_A = '01930000-0000-7000-8000-000000001037';
export const ENTRY_XFER_DEBIT_B = '01930000-0000-7000-8000-000000001038';
export const ENTRY_XFER_CREDIT_A = '01930000-0000-7000-8000-000000001039';
export const ENTRY_XFER_CREDIT_B = '01930000-0000-7000-8000-00000000103a';

/** Plano de parcelamento: um em cada tenant. */
export const INSTALLMENT_PLAN_A = '01930000-0000-7000-8000-00000000103b';
export const INSTALLMENT_PLAN_B = '01930000-0000-7000-8000-00000000103c';

/** Template de lançamento recorrente: um em cada tenant. */
export const RECURRING_TEMPLATE_A = '01930000-0000-7000-8000-00000000103d';
export const RECURRING_TEMPLATE_B = '01930000-0000-7000-8000-00000000103e';

/** Transferência entre contas: uma em cada tenant. */
export const TRANSFER_A = '01930000-0000-7000-8000-00000000103f';
export const TRANSFER_B = '01930000-0000-7000-8000-000000001040';

/** Regra de repasse: uma em cada tenant. */
export const SPLIT_RULE_A = '01930000-0000-7000-8000-000000001041';
export const SPLIT_RULE_B = '01930000-0000-7000-8000-000000001042';

/** Divisão de lançamento: uma em cada tenant. */
export const SPLIT_A = '01930000-0000-7000-8000-000000001043';
export const SPLIT_B = '01930000-0000-7000-8000-000000001044';

/** Extrato de repasse: um em cada tenant. */
export const REPASSE_STATEMENT_A = '01930000-0000-7000-8000-000000001045';
export const REPASSE_STATEMENT_B = '01930000-0000-7000-8000-000000001046';

/** Fornecedor de estoque: um em cada tenant. */
export const INV_SUPPLIER_A = '01930000-0000-7000-8000-000000001051';
export const INV_SUPPLIER_B = '01930000-0000-7000-8000-000000001052';

/** Produto de estoque: um em cada tenant. */
export const PRODUCT_A = '01930000-0000-7000-8000-000000001053';
export const PRODUCT_B = '01930000-0000-7000-8000-000000001054';

/** Movimentação de estoque: uma em cada tenant. */
export const STOCK_MOVEMENT_A = '01930000-0000-7000-8000-000000001055';
export const STOCK_MOVEMENT_B = '01930000-0000-7000-8000-000000001056';

/** Alerta de estoque: um em cada tenant. */
export const STOCK_ALERT_A = '01930000-0000-7000-8000-000000001057';
export const STOCK_ALERT_B = '01930000-0000-7000-8000-000000001058';

/** Lote TISS: um em cada tenant. */
export const LOTE_A = '01930000-0000-7000-8000-000000001061';
export const LOTE_B = '01930000-0000-7000-8000-000000001062';

/** Junção lote x guia: uma em cada tenant. */
export const LOTE_GUIA_A = '01930000-0000-7000-8000-000000001063';
export const LOTE_GUIA_B = '01930000-0000-7000-8000-000000001064';

/* ── Fase 4, blocos 07-09: retorno, glosa, recurso e SP/SADT ──────────────
 *
 * Estas nove tabelas entraram sem linha do tenant B, e o canário de
 * 04-t1-t2-isolamento existe exatamente para pegar isso: sem dado do tenant B,
 * o teste T1 ("o tenant A nao le nenhuma linha do tenant B") passa por
 * VACUIDADE — não há o que vazar, então nada vaza, e o isolamento da tabela
 * nunca chega a ser exercitado. São dados de faturamento e de contestação de
 * glosa, com valor e vínculo a paciente: a tabela mais sensível é a que mais
 * precisa da prova.
 */

/** Demonstrativo de retorno da operadora: um em cada tenant. */
export const DEMONSTRATIVO_A = '01930000-0000-7000-8000-000000001065';
export const DEMONSTRATIVO_B = '01930000-0000-7000-8000-000000001066';

/** Item do demonstrativo: um em cada tenant. */
export const DEMONSTRATIVO_ITEM_A = '01930000-0000-7000-8000-000000001067';
export const DEMONSTRATIVO_ITEM_B = '01930000-0000-7000-8000-000000001068';

/** Glosa: uma em cada tenant. */
export const GLOSA_A = '01930000-0000-7000-8000-000000001069';
export const GLOSA_B = '01930000-0000-7000-8000-00000000106a';

/** Recurso de glosa: um em cada tenant. */
export const RECURSO_GLOSA_A = '01930000-0000-7000-8000-00000000106b';
export const RECURSO_GLOSA_B = '01930000-0000-7000-8000-00000000106c';

/** Item do recurso de glosa: um em cada tenant. */
export const RECURSO_GLOSA_ITEM_A = '01930000-0000-7000-8000-00000000106d';
export const RECURSO_GLOSA_ITEM_B = '01930000-0000-7000-8000-00000000106e';

/** Guia SP/SADT: uma em cada tenant. */
export const GUIA_SADT_A = '01930000-0000-7000-8000-00000000106f';
export const GUIA_SADT_B = '01930000-0000-7000-8000-000000001070';

/**
 * Lote SÓ de SP/SADT: um em cada tenant.
 *
 * Separado do lote de consulta de propósito. No XSD, `guiasTISS` é um `choice`:
 * um lote não mistura consulta com SP/SADT, e a operadora recusa o arquivo
 * inteiro se misturar. O banco não impede — a regra vive no serializador —
 * então o seed segue a regra do domínio em vez do mínimo que o banco aceita.
 */
export const LOTE_SADT_A = '01930000-0000-7000-8000-000000001071';
export const LOTE_SADT_B = '01930000-0000-7000-8000-000000001072';

/** Configuracao operacional (migration 0174): uma linha do tenant B por tabela. */
export const NOTIFICATION_B = '01930000-0000-7000-8000-000000001081';
export const CHANNEL_CONFIG_B = '01930000-0000-7000-8000-000000001082';

/** Teleconsulta e calendar_sync (migrations 0178/0179): uma linha por tenant. */
export const TELECONSULTA_A = '01930000-0000-7000-8000-000000001091';
export const TELECONSULTA_B = '01930000-0000-7000-8000-000000001092';
export const CALENDAR_SYNC_A = '01930000-0000-7000-8000-000000001093';
export const CALENDAR_SYNC_B = '01930000-0000-7000-8000-000000001094';

/** CPF válido (dígitos verificadores corretos) usado nos DOIS tenants de propósito. */
export const CPF_VALIDO = '52998224725';

export const REQUEST_ID = '01930000-0000-7000-8000-0000000000ff';

/** CNPJ alfanumérico da IN RFB 2.229/2024: 12 alfanuméricos + 2 dígitos. */
export const CNPJ_A = '12ABC345678901';
export const CNPJ_B = '98XYZ765432109';
