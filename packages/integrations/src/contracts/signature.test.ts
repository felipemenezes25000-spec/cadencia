import { describe, expect, it } from 'vitest';
import { SIGNATURE_POLICIES, isSignaturePolicy } from './signature';

describe('politica de assinatura', () => {
  it('so existem AD-RT e AD-RA — AD-RB foi REMOVIDO do tipo, nao deixado como opcao', () => {
    expect(SIGNATURE_POLICIES).toEqual(['AD_RT_CAdES_2.4', 'AD_RA_CAdES_2.4']);
  });

  it('recusa AD-RB em runtime tambem, nao so no compilador', () => {
    expect(isSignaturePolicy('AD_RB_CAdES_2.4')).toBe(false);
    expect(isSignaturePolicy('AD_RT_CAdES_2.4')).toBe(true);
  });
});
