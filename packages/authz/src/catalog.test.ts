import { describe, expect, it } from 'vitest';
import { ACTIONS, type ActionDef } from './actions';
import { catalogRows, catalogChecksum } from './catalog';

describe('catalogo derivado de actions.ts', () => {
  it('gera uma linha por acao, com os papeis ordenados', () => {
    const rows = catalogRows(ACTIONS);
    expect(rows.length).toBe(ACTIONS.length);
    const patientRead = rows.find((r) => r.key === 'patient.read')!;
    expect(patientRead.roles).toEqual([...patientRead.roles].sort());
    expect(patientRead.requiresMfa).toBe(false);
    expect(rows.find((r) => r.key === 'membership.grant')!.requiresMfa).toBe(true);
  });

  it('as linhas saem ordenadas por chave, para o checksum nao depender da ordem do arquivo', () => {
    const keys = catalogRows(ACTIONS).map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('o checksum muda quando uma acao muda de papel', () => {
    const base = catalogChecksum(catalogRows(ACTIONS));
    const alterado: readonly ActionDef[] = [
      ...ACTIONS.filter((a) => a.key !== 'patient.read'),
      { key: 'patient.read', description: 'Ler cadastro de paciente',
        roles: ['admin_clinico'] as const },
    ];
    expect(catalogChecksum(catalogRows(alterado))).not.toBe(base);
  });

  it('o checksum NAO muda quando so a ordem das acoes no arquivo muda', () => {
    const base = catalogChecksum(catalogRows(ACTIONS));
    const invertido = catalogChecksum(catalogRows([...ACTIONS].reverse()));
    expect(invertido).toBe(base);
  });
});
