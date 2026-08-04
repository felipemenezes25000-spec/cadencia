/**
 * Identificadores fixos da suite de isolamento.
 * Sao UUIDs validos com o formato de um UUIDv7 (versao 7, variante 10xx) para que
 * nenhuma coluna precise de tratamento especial. Sao literais de proposito:
 * um teste de isolamento tem que ser reproduzivel byte a byte.
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

/** Definicao de prontuario: uma secao e um campo vivos em cada tenant. */
export const SECTION_A_SINAIS_VITAIS = '01930000-0000-7000-8000-0000000000ae';
export const FIELD_A_PESO = '01930000-0000-7000-8000-0000000000af';
export const SECTION_B_SINAIS_VITAIS = '01930000-0000-7000-8000-0000000000b6';
export const FIELD_B_PESO = '01930000-0000-7000-8000-0000000000b7';

/** Campo composto: 'PA' e um campo com DOIS componentes em cada tenant. */
export const FIELD_A_PA = '01930000-0000-7000-8000-0000000000b8';
export const FIELD_B_PA = '01930000-0000-7000-8000-0000000000b9';
export const COMPONENT_A_PA_SIS = '01930000-0000-7000-8000-0000000000ba';
export const COMPONENT_A_PA_DIA = '01930000-0000-7000-8000-0000000000bb';
export const COMPONENT_B_PA_SIS = '01930000-0000-7000-8000-0000000000bc';
export const COMPONENT_B_PA_DIA = '01930000-0000-7000-8000-0000000000bd';

/** Layout do prontuario: cada tenant tem um profissional com ordem propria. */
export const LAYOUT_A_ANA_SINAIS_VITAIS = '01930000-0000-7000-8000-0000000000be';
export const LAYOUT_B_DIEGO_SINAIS_VITAIS = '01930000-0000-7000-8000-0000000000bf';

/** Atendimento: o agregado clinico, um em cada tenant. */
export const ENCOUNTER_A_JOANA = '01930000-0000-7000-8000-0000000000c6';
export const ENCOUNTER_B_MARCOS = '01930000-0000-7000-8000-0000000000c7';

/** Versao original ja finalizada de cada atendimento do seed. */
export const VERSION_A_JOANA_ORIGINAL = '01930000-0000-7000-8000-0000000000c8';
export const VERSION_B_MARCOS_ORIGINAL = '01930000-0000-7000-8000-0000000000c9';

/** Um valor de campo ('Peso') gravado na versao original de cada tenant. */
export const FIELD_VALUE_A_JOANA_PESO = '01930000-0000-7000-8000-0000000000ca';
export const FIELD_VALUE_B_MARCOS_PESO = '01930000-0000-7000-8000-0000000000cb';

/**
 * Linhas de primeira classe promovidas para fora do EAV: uma de cada tipo em cada
 * tenant, penduradas na versao original do atendimento daquele tenant.
 */
export const DIAGNOSIS_A_JOANA = '01930000-0000-7000-8000-0000000000cc';
export const DIAGNOSIS_B_MARCOS = '01930000-0000-7000-8000-0000000000cd';
export const OBSERVATION_A_JOANA_PESO = '01930000-0000-7000-8000-0000000000ce';
export const OBSERVATION_B_MARCOS_PESO = '01930000-0000-7000-8000-0000000000cf';
export const FINDING_A_JOANA = '01930000-0000-7000-8000-0000000000d0';
export const FINDING_B_MARCOS = '01930000-0000-7000-8000-0000000000d1';
export const PROCEDURE_A_JOANA = '01930000-0000-7000-8000-0000000000d2';
export const PROCEDURE_B_MARCOS = '01930000-0000-7000-8000-0000000000d3';

/** Apoio por IA registrado no prontuario: uma linha em cada tenant. */
export const AI_ASSISTANCE_A_JOANA = '01930000-0000-7000-8000-0000000000d4';
export const AI_ASSISTANCE_B_MARCOS = '01930000-0000-7000-8000-0000000000d5';

/**
 * Campos da guia de consulta capturados no atendimento: um por tenant.
 * Aurora atende por convenio (tem registro_ans e carteirinha); Boreal atende
 * particular (nao tem nem uma coisa nem outra).
 */
export const BILLING_A_JOANA = '01930000-0000-7000-8000-0000000000d6';
export const BILLING_B_MARCOS = '01930000-0000-7000-8000-0000000000d7';

/** Assinatura digital: uma linha em cada tenant. */
export const SIGNATURE_A_JOANA = '01930000-0000-7000-8000-0000000000d8';
export const SIGNATURE_B_MARCOS = '01930000-0000-7000-8000-0000000000d9';

/** Pendencia de assinatura: uma linha em cada tenant. */
export const SIGNATURE_PENDING_A = '01930000-0000-7000-8000-0000000000da';
export const SIGNATURE_PENDING_B = '01930000-0000-7000-8000-0000000000db';

/** Documento clinico nato-digital: uma linha em cada tenant. */
export const DOCUMENT_A_JOANA = '01930000-0000-7000-8000-0000000000dc';
export const DOCUMENT_B_MARCOS = '01930000-0000-7000-8000-0000000000dd';

/** Anexo clinico: uma linha em cada tenant. */
export const ATTACHMENT_A_JOANA = '01930000-0000-7000-8000-0000000000de';
export const ATTACHMENT_B_MARCOS = '01930000-0000-7000-8000-0000000000df';

/** Exportacao de prontuario: uma linha em cada tenant. */
export const RECORD_EXPORT_A_JOANA = '01930000-0000-7000-8000-0000000000e0';
export const RECORD_EXPORT_B_MARCOS = '01930000-0000-7000-8000-0000000000e1';

/** Prescricao: uma linha em cada tenant. */
export const PRESCRIPTION_A_JOANA = '01930000-0000-7000-8000-0000000000e2';
export const PRESCRIPTION_B_MARCOS = '01930000-0000-7000-8000-0000000000e3';
export const PRESCRIPTION_ITEM_A = '01930000-0000-7000-8000-0000000000e4';
export const PRESCRIPTION_ITEM_B = '01930000-0000-7000-8000-0000000000e5';

/** CPF valido (digitos verificadores corretos) usado nos DOIS tenants de proposito. */
export const CPF_VALIDO = '52998224725';

export const REQUEST_ID = '01930000-0000-7000-8000-0000000000ff';

/** CNPJ alfanumerico da IN RFB 2.229/2024: 12 alfanumericos + 2 digitos. */
export const CNPJ_A = '12ABC345678901';
export const CNPJ_B = '98XYZ765432109';
