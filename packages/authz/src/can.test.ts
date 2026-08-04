import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_KEY } from './actions';
import { can, assertCan, type AuthzSubject } from './can';

const CLINICA_SP = '01890a5d-ac96-774b-bcce-b302099a8057';
const CLINICA_MANAUS = '01890a5d-ac96-774b-bcce-b302099a8058';

function sujeito(
  memberships: AuthzSubject['memberships'], mfaAt: Date | null = new Date(),
): AuthzSubject {
  return {
    userId: '01890a5d-ac96-774b-bcce-b302099a8000',
    tenantId: '01890a5d-ac96-774b-bcce-b302099a8001',
    memberships, mfaAt,
  };
}

describe('catalogo de acoes', () => {
  it('nao tem chave duplicada', () => {
    expect(ACTION_BY_KEY.size).toBe(ACTIONS.length);
  });

  it('toda acao declara ao menos um papel: acao sem papel seria letra morta', () => {
    for (const a of ACTIONS) expect(a.roles.length).toBeGreaterThan(0);
  });

  it('toda chave segue o formato dominio.verbo', () => {
    for (const a of ACTIONS) expect(a.key).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });
});

describe('can', () => {
  it('FAIL-CLOSED: acao que nao existe no catalogo e negada ate para o admin', () => {
    // O caso real: alguem escreve requireAction('financeiro.exportar_tudo') numa
    // rota nova e esquece de cadastrar a acao. Sem esta regra, a rota nasce aberta.
    const admin = sujeito([{ clinicId: CLINICA_SP, role: 'admin_clinico' }]);
    const d = can(admin, 'financeiro.exportar_tudo', { clinicId: CLINICA_SP });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('acao_desconhecida');
  });

  it('admin_clinico le paciente na clinica em que tem vinculo', () => {
    const admin = sujeito([{ clinicId: CLINICA_SP, role: 'admin_clinico' }]);
    expect(can(admin, 'patient.read', { clinicId: CLINICA_SP }).allowed).toBe(true);
  });

  it('papel de uma unidade nao vale na outra: admin em SP e recepcao em Manaus', () => {
    const medica = sujeito([
      { clinicId: CLINICA_SP, role: 'admin_clinico' },
      { clinicId: CLINICA_MANAUS, role: 'recepcao' },
    ]);
    expect(can(medica, 'membership.grant', { clinicId: CLINICA_SP }).allowed).toBe(true);
    const emManaus = can(medica, 'membership.grant', { clinicId: CLINICA_MANAUS });
    expect(emManaus.allowed).toBe(false);
    if (emManaus.allowed) return;
    expect(emManaus.reason).toBe('papel_insuficiente');
  });

  it('sem vinculo na clinica alvo e negado antes de olhar papel', () => {
    const medica = sujeito([{ clinicId: CLINICA_SP, role: 'admin_clinico' }]);
    const d = can(medica, 'patient.read', { clinicId: CLINICA_MANAUS });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('sem_vinculo');
  });

  it('acao marcada com requiresMfa exige segundo fator na sessao', () => {
    const semMfa = sujeito([{ clinicId: CLINICA_SP, role: 'admin_clinico' }], null);
    const d = can(semMfa, 'membership.grant', { clinicId: CLINICA_SP });
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.reason).toBe('mfa_exigida');
  });

  it('sujeito sem nenhum vinculo e negado em tudo', () => {
    const ninguem = sujeito([]);
    for (const a of ACTIONS) {
      expect(can(ninguem, a.key, { clinicId: CLINICA_SP }).allowed).toBe(false);
    }
  });

  it('assertCan lanca com a chave e o motivo quando nega', () => {
    const recepcao = sujeito([{ clinicId: CLINICA_SP, role: 'recepcao' }]);
    expect(() => assertCan(recepcao, 'membership.grant', { clinicId: CLINICA_SP }))
      .toThrow(/membership\.grant.*papel_insuficiente/);
  });
});
