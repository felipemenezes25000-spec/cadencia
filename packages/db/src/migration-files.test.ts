import { describe, expect, it } from 'vitest';
import {
  assertForwardOnly,
  checksumOf,
  isMigrationName,
  nextMigrationName,
  type MigrationFile,
} from './migration-files';

function fake(version: string, name: string, sql: string): MigrationFile {
  return { version, name, sql, checksum: checksumOf(sql) };
}

describe('nomeacao de migration', () => {
  it('aceita apenas quatro digitos seguidos de snake_case e extensao .sql', () => {
    expect(isMigrationName('0001_roles.sql')).toBe(true);
    expect(isMigrationName('0002_transaction_context.sql')).toBe(true);
    expect(isMigrationName('1_roles.sql')).toBe(false);
    expect(isMigrationName('0001-roles.sql')).toBe(false);
    expect(isMigrationName('0001_Roles.sql')).toBe(false);
    expect(isMigrationName('README.md')).toBe(false);
  });

  it('a primeira migration do repositorio e a 0001', () => {
    expect(nextMigrationName([], 'roles')).toBe('0001_roles.sql');
  });

  it('numera a proxima a partir da maior existente, ignorando arquivos estranhos', () => {
    const existing = ['0001_roles.sql', 'README.md', '0002_transaction_context.sql'];
    expect(nextMigrationName(existing, 'patient')).toBe('0003_patient.sql');
  });

  it('recusa nome com espaco ou maiuscula em vez de gerar arquivo invisivel para o runner', () => {
    expect(() => nextMigrationName([], 'Papeis Do Banco')).toThrowError(
      /nome de migration invalido/,
    );
  });
});

describe('forward-only', () => {
  it('devolve so as migrations ainda nao aplicadas, na ordem dos arquivos', () => {
    const files = [
      fake('0001', '0001_roles.sql', 'CREATE ROLE a;'),
      fake('0002', '0002_transaction_context.sql', 'CREATE SCHEMA app;'),
      fake('0003', '0003_patient.sql', 'CREATE TABLE t();'),
    ];
    const applied = new Map([['0001', checksumOf('CREATE ROLE a;')]]);

    const pending = assertForwardOnly(files, applied);

    expect(pending.map((m) => m.name)).toEqual([
      '0002_transaction_context.sql',
      '0003_patient.sql',
    ]);
  });

  it('recusa migration ja aplicada que foi editada depois', () => {
    const files = [fake('0001', '0001_roles.sql', 'CREATE ROLE a; -- editado')];
    const applied = new Map([['0001', checksumOf('CREATE ROLE a;')]]);

    expect(() => assertForwardOnly(files, applied)).toThrowError(
      /0001_roles\.sql foi alterada depois de aplicada/,
    );
  });

  it('recusa arquivo novo com numero menor que uma migration ja aplicada', () => {
    const files = [
      fake('0001', '0001_roles.sql', 'CREATE ROLE a;'),
      fake('0002', '0002_intruso.sql', 'CREATE SCHEMA x;'),
      fake('0003', '0003_transaction_context.sql', 'CREATE SCHEMA app;'),
    ];
    const applied = new Map([
      ['0001', checksumOf('CREATE ROLE a;')],
      ['0003', checksumOf('CREATE SCHEMA app;')],
    ]);

    expect(() => assertForwardOnly(files, applied)).toThrowError(
      /0002_intruso\.sql e anterior a 0003 ja aplicada/,
    );
  });

  it('recusa migration que sumiu do repositorio mas consta como aplicada', () => {
    const files = [fake('0001', '0001_roles.sql', 'CREATE ROLE a;')];
    const applied = new Map([
      ['0001', checksumOf('CREATE ROLE a;')],
      ['0002', 'deadbeef'],
    ]);

    expect(() => assertForwardOnly(files, applied)).toThrowError(
      /aplicadas e ausentes do repositorio: 0002/,
    );
  });
});
