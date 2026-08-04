import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY, type Role } from './actions';
import { can } from './can';

const sujeito = (role: Role) => ({
  userId: 'u', tenantId: 't', memberships: [{ clinicId: 'c', role }], mfaAt: null,
});

describe('acoes da Fase 1', () => {
  it('o catalogo cobre agenda, prontuario, documentos, prescricao e exportacao', () => {
    for (const chave of [
      'appointment.read', 'appointment.write', 'appointment.checkin',
      'encounter.read', 'encounter.write', 'encounter.finalize', 'encounter.amend',
      'record.export', 'record.break_glass',
      'document.issue', 'prescription.write',
    ]) {
      expect(ACTION_BY_KEY.has(chave), `falta ${chave}`).toBe(true);
    }
  });

  it('perfil administrativo NUNCA alcanca rota clinica', () => {
    for (const chave of ['encounter.read', 'encounter.write', 'encounter.finalize',
                         'encounter.amend', 'document.issue', 'prescription.write',
                         'record.break_glass']) {
      for (const role of ['recepcao', 'financeiro'] as const) {
        const d = can(sujeito(role), chave, { clinicId: 'c' });
        expect(d.allowed, `${role} alcancou ${chave}`).toBe(false);
      }
    }
  });

  it('recepcao agenda e faz check-in, mas nao finaliza atendimento', () => {
    expect(can(sujeito('recepcao'), 'appointment.write', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('recepcao'), 'appointment.checkin', { clinicId: 'c' }).allowed).toBe(true);
    expect(can(sujeito('recepcao'), 'encounter.finalize', { clinicId: 'c' }).allowed).toBe(false);
  });

  it('quebra-vidro exige MFA — e ato excepcional, nao gesto de rotina', () => {
    const d = can(sujeito('profissional'), 'record.break_glass', { clinicId: 'c' });
    expect(d).toEqual({ allowed: false, reason: 'mfa_exigida' });
  });

  it('nenhuma chave duplicada no catalogo', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
