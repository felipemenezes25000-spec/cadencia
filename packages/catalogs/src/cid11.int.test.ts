import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { loadCid11Release, resolveCid11At } from './cid11';

/**
 * Os códigos aqui são SINTÉTICOS ('ZZ...'), fora de qualquer faixa real da
 * CID-11. O catálogo de verdade vem da OMS pelo script de ingestão; inventar
 * código de CID em fixture criaria uma segunda fonte de verdade que ninguém
 * lembraria de conferir — e um dia alguém procuraria por ele em produção.
 */
const URI = 'http://id.who.int/icd/entity/999000001';
const CODIGOS = ['ZZ00', 'ZZ01'];

function adminUrl(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL_ADMIN ausente');
  return url;
}

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: adminUrl(), max: 2 });
  await pool.query(
    `DELETE FROM ref.cid11_term WHERE codigo = ANY($1::varchar[])`, [CODIGOS]);
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM ref.cid11_term WHERE codigo = ANY($1::varchar[])`, [CODIGOS]);
  await pool.end();
});

describe('catalogo CID-11', () => {
  it('resolve pela DATA DO EVENTO, nao pela data de hoje', async () => {
    // Dois releases do mesmo código, com descrições diferentes. É o cenário que
    // a coluna `vigencia` existe para atender: o atendimento de 2027 tem de
    // continuar lendo a descrição de 2027 quando for consultado em 2028.
    await loadCid11Release(pool, {
      competencia: '202701', vigenciaFrom: '2027-01-01', vigenciaTo: '2028-01-01',
      rows: [{ uri: URI, codigo: 'ZZ00', descricao: 'Descricao do release de 2027', capitulo: '01' }],
    });
    await loadCid11Release(pool, {
      competencia: '202801', vigenciaFrom: '2028-01-01', vigenciaTo: null,
      rows: [{ uri: URI, codigo: 'ZZ00', descricao: 'Descricao revisada em 2028', capitulo: '01' }],
    });

    const em2027 = await resolveCid11At(pool, 'ZZ00', '2027-06-15');
    expect(em2027.ok).toBe(true);
    if (em2027.ok) {
      expect(em2027.value.display).toBe('Descricao do release de 2027');
      expect(em2027.value.terminologyVersion).toBe('202701');
      expect(em2027.value.system).toBe('CID11');
      // A URI é a mesma nos dois releases: é ela que prova que se trata da
      // MESMA entidade, mesmo com a descrição reescrita.
      expect(em2027.value.uri).toBe(URI);
    }

    const em2028 = await resolveCid11At(pool, 'ZZ00', '2028-06-15');
    expect(em2028.ok && em2028.value.display).toBe('Descricao revisada em 2028');
  });

  it('codigo fora da vigencia nao resolve — nao cai no release mais proximo', async () => {
    // Devolver "o mais próximo" poria no prontuário um termo que não existia na
    // data do atendimento, e a perícia leria isso como registro adulterado.
    const antes = await resolveCid11At(pool, 'ZZ00', '2026-12-31');
    expect(antes.ok).toBe(false);
    if (!antes.ok) expect(antes.error).toBe('codigo_inexistente_na_data');
  });

  it('vigencia sobreposta derruba a carga inteira', async () => {
    // Meia carga é pior que nenhuma: a busca passaria a devolver um catálogo
    // pela metade sem nada na tela indicando isso.
    await expect(loadCid11Release(pool, {
      competencia: '202702', vigenciaFrom: '2027-06-01', vigenciaTo: null,
      rows: [
        { uri: URI, codigo: 'ZZ01', descricao: 'Termo que entraria', capitulo: '01' },
        { uri: URI, codigo: 'ZZ00', descricao: 'Sobrepoe 2027', capitulo: '01' },
      ],
    })).rejects.toMatchObject({ code: '23P01' });

    // O primeiro termo do lote NÃO pode ter sobrevivido ao ROLLBACK.
    const orfao = await resolveCid11At(pool, 'ZZ01', '2027-07-01');
    expect(orfao.ok).toBe(false);
  });

  it('CID-10 e CID-11 sao tabelas independentes — nada vaza de uma para a outra', async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM ref.cid10_term WHERE codigo = 'ZZ00'`);
    expect(rows[0]!.n).toBe(0);
  });
});
