import { ACTION_BY_KEY, type ActionDef, type Role } from './actions';

export type DenyReason = 'acao_desconhecida' | 'sem_vinculo' | 'papel_insuficiente' | 'mfa_exigida';

/**
 * O sujeito da autorizacao. `memberships` vem de resolveMemberships (Task 36B),
 * que le o vinculo dentro do banco. Papel NUNCA vem do cliente (§10 item 3).
 */
export interface AuthzSubject {
  userId: string;
  tenantId: string;
  memberships: readonly { clinicId: string; role: Role }[];
  mfaAt: Date | null;
}

export type Decision =
  | { allowed: true; action: ActionDef }
  | { allowed: false; reason: DenyReason };

export function can(
  subject: AuthzSubject, actionKey: string, target: { clinicId: string },
): Decision {
  const action = ACTION_BY_KEY.get(actionKey);
  // Fail-closed: chave fora do catalogo e negada. Rota nova nasce fechada.
  if (!action) return { allowed: false, reason: 'acao_desconhecida' };

  const naClinica = subject.memberships.filter((m) => m.clinicId === target.clinicId);
  if (naClinica.length === 0) return { allowed: false, reason: 'sem_vinculo' };

  const temPapel = naClinica.some((m) => action.roles.includes(m.role));
  if (!temPapel) return { allowed: false, reason: 'papel_insuficiente' };

  if (action.requiresMfa === true && subject.mfaAt === null) {
    return { allowed: false, reason: 'mfa_exigida' };
  }
  return { allowed: true, action };
}

export function assertCan(
  subject: AuthzSubject, actionKey: string, target: { clinicId: string },
): ActionDef {
  const d = can(subject, actionKey, target);
  if (!d.allowed) throw new Error(`authz negou ${actionKey}: ${d.reason}`);
  return d.action;
}
