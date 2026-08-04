import { afterEach, describe, expect, it } from 'vitest';
import { auditPool, businessPool, closePools } from './pool';

afterEach(async () => {
  await closePools();
});

describe('pools do banco', () => {
  it('o pool de negocio e o de auditoria sao objetos distintos', () => {
    expect(auditPool()).not.toBe(businessPool());
  });

  it('cada chamada devolve o mesmo pool, sem abrir conexao nova por requisicao', () => {
    expect(businessPool()).toBe(businessPool());
    expect(auditPool()).toBe(auditPool());
  });

  it('o pool de auditoria para em duas conexoes: a terceira espera', async () => {
    const pool = auditPool();
    const c1 = await pool.connect();
    const c2 = await pool.connect();

    let terceiraChegou = false;
    const terceira = pool.connect().then((c) => {
      terceiraChegou = true;
      return c;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(terceiraChegou, 'a terceira conexao nao pode ser concedida com max = 2').toBe(false);

    c1.release();
    const c3 = await terceira;
    expect(terceiraChegou).toBe(true);

    c3.release();
    c2.release();
  });

  it('os dois pools se identificam separadamente no pg_stat_activity', async () => {
    const negocio = await businessPool().connect();
    const auditoria = await auditPool().connect();
    try {
      const r = await negocio.query<{ application_name: string }>(
        `SELECT DISTINCT application_name FROM pg_stat_activity
          WHERE application_name IN ('cadencia-business', 'cadencia-audit')
          ORDER BY application_name`,
      );
      expect(r.rows.map((x) => x.application_name)).toEqual([
        'cadencia-audit',
        'cadencia-business',
      ]);
    } finally {
      negocio.release();
      auditoria.release();
    }
  });

  it('recusa subir sem DATABASE_URL, em vez de conectar em localhost por acidente', async () => {
    await closePools();
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => businessPool()).toThrowError(/variavel de ambiente ausente: DATABASE_URL/);
    } finally {
      process.env.DATABASE_URL = original;
    }
  });
});
