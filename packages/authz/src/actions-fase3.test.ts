import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY, type Role } from './actions';
import { can } from './can';

const sujeito = (role: Role) => ({
  userId: 'u', tenantId: 't', memberships: [{ clinicId: 'c', role }], mfaAt: null,
});
const sujeitoMfa = (role: Role) => ({
  userId: 'u', tenantId: 't', memberships: [{ clinicId: 'c', role }], mfaAt: new Date(),
});

describe('acoes da Fase 3', () => {
  it('o catalogo cobre finance.settings, finance.repasse, inventory.read, inventory.write e report.read', () => {
    for (const chave of [
      'finance.settings', 'finance.repasse',
      'inventory.read', 'inventory.write',
      'report.read',
    ]) {
      expect(ACTION_BY_KEY.has(chave), `falta ${chave}`).toBe(true);
    }
  });

  it('finance.settings e acessivel por admin_clinico e financeiro', () => {
    for (const role of ['admin_clinico', 'financeiro'] as const) {
      expect(can(sujeito(role), 'finance.settings', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('finance.settings NAO e acessivel por profissional, recepcao ou diretor_tecnico', () => {
    for (const role of ['profissional', 'recepcao', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'finance.settings', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('finance.repasse e acessivel por admin_clinico e financeiro (com MFA)', () => {
    for (const role of ['admin_clinico', 'financeiro'] as const) {
      expect(can(sujeitoMfa(role), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('finance.repasse exige MFA', () => {
    const d = can(sujeito('admin_clinico'), 'finance.repasse', { clinicId: 'c' });
    expect(d).toEqual({ allowed: false, reason: 'mfa_exigida' });
  });

  it('finance.repasse NAO e acessivel por profissional, recepcao ou diretor_tecnico', () => {
    for (const role of ['profissional', 'recepcao', 'diretor_tecnico'] as const) {
      expect(can(sujeitoMfa(role), 'finance.repasse', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('inventory.read e acessivel por todos os papeis', () => {
    for (const role of ['admin_clinico', 'financeiro', 'recepcao', 'profissional', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'inventory.read', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('inventory.write e acessivel por admin_clinico e financeiro', () => {
    for (const role of ['admin_clinico', 'financeiro'] as const) {
      expect(can(sujeito(role), 'inventory.write', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('inventory.write NAO e acessivel por profissional, recepcao ou diretor_tecnico', () => {
    for (const role of ['profissional', 'recepcao', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'inventory.write', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('report.read e acessivel por admin_clinico, financeiro e diretor_tecnico', () => {
    for (const role of ['admin_clinico', 'financeiro', 'diretor_tecnico'] as const) {
      expect(can(sujeito(role), 'report.read', { clinicId: 'c' }).allowed).toBe(true);
    }
  });

  it('report.read NAO e acessivel por profissional ou recepcao', () => {
    for (const role of ['profissional', 'recepcao'] as const) {
      expect(can(sujeito(role), 'report.read', { clinicId: 'c' }).allowed).toBe(false);
    }
  });

  it('nenhuma chave duplicada no catalogo apos a Fase 3', () => {
    const chaves = ACTIONS.map((a) => a.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
