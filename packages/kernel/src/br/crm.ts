import { ValidationError } from '../errors';
import { err, ok, type Result } from '../result';

export type Uf =
  | 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO'
  | 'MA' | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI'
  | 'RJ' | 'RN' | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO';

export const UFS: readonly Uf[] = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

/**
 * CRM. NÃO existe dígito verificador nacional para registro de conselho: a
 * identidade é o par (numero, UF), e a validação real é a consulta ao CFM.
 * Aqui garantimos só forma e UF existente — inventar DV rejeitaria médico
 * legítimo, e o número do conselho vai na guia TISS e no documento assinado.
 */
export interface Crm {
  readonly numero: string;
  readonly uf: Uf;
}

const CRM_PATTERN = /^(?:CRM\s*[-/]?\s*([A-Z]{2})\s*[-/]?\s*(\d{1,7})|(\d{1,7})\s*[-/]\s*([A-Z]{2}))$/;

export function parseCrm(input: string): Result<Crm, ValidationError> {
  const normalized = input.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = CRM_PATTERN.exec(normalized);

  if (match === null) {
    return err(new ValidationError('crm.formato_invalido', 'CRM fora do formato CRM/UF numero'));
  }

  const uf = (match[1] ?? match[4] ?? '') as Uf;
  const numero = (match[2] ?? match[3] ?? '').replace(/^0+(?=\d)/, '');

  if (!UFS.includes(uf)) {
    return err(new ValidationError('crm.uf_invalida', 'UF do conselho nao existe', { uf }));
  }

  return ok({ numero, uf });
}

export function formatCrm(crm: Crm): string {
  return `CRM/${crm.uf} ${crm.numero}`;
}
