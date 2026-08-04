import type { Queryable } from './session';

/**
 * Declarado aqui, e nao importado de @cadencia/authz: authn e authz sao irmaos
 * em L0 e import entre irmaos e proibido sem excecao (§2.2 regra 2). O teste
 * `membership.int.test.ts` compara esta lista com o CHECK de app.membership,
 * que e o que impede as duas divergirem em silencio.
 */
export const MEMBERSHIP_ROLES = [
  'admin_clinico', 'diretor_tecnico', 'profissional', 'recepcao', 'financeiro',
] as const;
export type Role = (typeof MEMBERSHIP_ROLES)[number];

export interface MembershipRow {
  tenantId: string;
  clinicId: string;
  role: Role;
}

/**
 * Le os vinculos VIGENTES do usuario. Precisa rodar dentro de withTenantTx: a
 * policy de app.membership ja filtra por tenant e por dono do vinculo, e o
 * parametro `tenantId` serve so para o chamador estreitar ainda mais.
 */
export async function resolveMemberships(
  db: Queryable, userId: string, tenantId?: string,
): Promise<MembershipRow[]> {
  const { rows } = await db.query(
    `SELECT m.tenant_id, m.clinic_id, m.role
       FROM app.membership m
      WHERE m.user_id = $1
        AND m.revoked_at IS NULL
        AND ($2::uuid IS NULL OR m.tenant_id = $2::uuid)
      ORDER BY m.clinic_id, m.role`,
    [userId, tenantId ?? null],
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id as string,
    clinicId: r.clinic_id as string,
    role: r.role as Role,
  }));
}
