import { describe, expect, it } from 'vitest';
import { formatCrm, parseCrm } from './crm';
import { isErr, isOk } from '../result';

describe('CRM', () => {
  it('aceita as formas que o cadastro recebe e devolve numero e UF separados', () => {
    for (const entrada of ['CRM/SP 123456', 'CRM-SP 123456', 'crm/sp 123456', '123456/SP']) {
      const resultado = parseCrm(entrada);
      expect(isOk(resultado), entrada).toBe(true);
      expect(isOk(resultado) && resultado.value).toEqual({ numero: '123456', uf: 'SP' });
    }
  });

  it('remove zeros a esquerda: 0012345 e 12345 sao o mesmo registro e nao podem virar dois profissionais', () => {
    const resultado = parseCrm('CRM/RJ 0012345');
    expect(isOk(resultado) && resultado.value.numero).toBe('12345');
  });

  it('recusa UF que nao existe', () => {
    const resultado = parseCrm('CRM/XX 123456');
    expect(isErr(resultado)).toBe(true);
    expect(isErr(resultado) && resultado.error.code).toBe('crm.uf_invalida');
  });

  it('recusa numero com letra e numero longo demais', () => {
    expect(isErr(parseCrm('CRM/SP ABC123'))).toBe(true);
    expect(isErr(parseCrm('CRM/SP 12345678'))).toBe(true);
    const resultado = parseCrm('CRM/SP ABC123');
    expect(isErr(resultado) && resultado.error.code).toBe('crm.formato_invalido');
  });

  it('nao inventa digito verificador: registro de conselho nao tem DV nacional, e rejeitar medico legitimo seria pior', () => {
    expect(isOk(parseCrm('CRM/AC 1'))).toBe(true);
    expect(isOk(parseCrm('CRM/SP 9999999'))).toBe(true);
  });

  it('formata no padrao usado em documento assinado', () => {
    expect(formatCrm({ numero: '123456', uf: 'SP' })).toBe('CRM/SP 123456');
  });
});
