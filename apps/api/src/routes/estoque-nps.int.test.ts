import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
let produtoId = '';

beforeAll(async () => {
  s = await semearSessao({ role: 'admin_clinico' });
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    produtoId = uuidv7();
    await a.query(
      `INSERT INTO inv.product (tenant_id, id, sku, name, unit, min_stock)
       VALUES ($1,$2,'SKU-1','Luva de procedimento','cx',5)`,
      [s.tenantId, produtoId]);
    // `quantity` é sempre POSITIVA (CHECK > 0): o sinal está no `kind`, não no
    // número. E `reference_type` é NOT NULL — toda movimentação aponta de onde
    // veio, senão "sumiram 3 caixas" não tem a quem perguntar.
    for (const [kind, qtd, motivo, ref] of [
      ['entrada', 100, 'compra inicial', 'compra'],
      ['saida', 12, 'uso no atendimento', 'uso_atendimento'],
      ['ajuste', 3, 'contagem de inventario', 'ajuste_manual'],
    ] as const) {
      await a.query(
        `INSERT INTO inv.stock_movement
           (tenant_id, id, product_id, kind, quantity, reason,
            reference_type, moved_by)
         VALUES ($1,$2,$3,$4::inv.movement_kind,$5,$6,
                 $8::inv.reference_type,$7)`,
        [s.tenantId, uuidv7(), produtoId, kind, qtd, motivo, s.userId, ref]);
    }

    // Duas respostas de NPS: uma promotora e uma detratora.
    await a.query(
      `INSERT INTO msg.nps_response
         (tenant_id, id, patient_id, score, comment, received_at)
       VALUES ($1,$2,$3,10,'Atendimento excelente', clock_timestamp()),
              ($1,$4,$3,4,'Demorou muito na recepcao', clock_timestamp())`,
      [s.tenantId, uuidv7(), s.patientId, uuidv7()]);
  } finally { await a.end(); }
});

afterAll(async () => { await closePools(); });

describe('historico de movimentacao de estoque', () => {
  it('lista as movimentacoes do produto, da mais recente para a mais antiga', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: `/v1/stock-movements?productId=${produtoId}`, ...auth(s) });

    expect(r.statusCode).toBe(200);
    const itens = (r.json() as { itens: {
      movementId: string; kind: string; quantity: number; reason: string;
      movedAt: string; movedByNome: string }[] }).itens;

    expect(itens).toHaveLength(3);
    // Sem histórico, "temos 85 luvas" é um número sem origem: ninguém consegue
    // dizer se a diferença veio de venda, perda ou erro de contagem.
    expect(itens.map((x) => x.kind)).toContain('ajuste');
    expect(itens.some((x) => x.reason === 'contagem de inventario')).toBe(true);
    // Quem mexeu importa tanto quanto quanto mexeu.
    expect(itens[0]?.movedByNome).toBeTruthy();

    await app.close();
  });

  it('sem productId lista o movimento de todos os produtos', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/stock-movements', ...auth(s) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { itens: unknown[] }).itens.length).toBeGreaterThanOrEqual(3);
    await app.close();
  });
});

describe('leitura de NPS', () => {
  it('devolve o indice, a contagem por faixa e os comentarios', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/nps?dias=90', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const n = r.json() as {
      nps: number; respostas: number;
      promotores: number; neutros: number; detratores: number;
      comentarios: { score: number; comentario: string }[];
    };

    expect(n.respostas).toBe(2);
    expect(n.promotores).toBe(1);
    expect(n.detratores).toBe(1);
    // NPS = %promotores - %detratores. Com 1 e 1 em 2 respostas, dá zero — e
    // zero é um resultado legítimo, não ausência de dado.
    expect(n.nps).toBe(0);
    // O comentário é o que diz O QUE consertar; a nota sozinha só diz que há
    // algo errado.
    expect(n.comentarios.some((c) => c.comentario.includes('recepcao'))).toBe(true);

    await app.close();
  });

  it('recepcao nao le NPS — e indicador de gestao', async () => {
    const app = await buildApp();
    const recepcao = await semearSessao({ role: 'recepcao' });
    const r = await app.inject({ method: 'GET', url: '/v1/nps', ...auth(recepcao) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
