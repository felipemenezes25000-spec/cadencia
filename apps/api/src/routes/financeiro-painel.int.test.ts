import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { closePools } from '@cadencia/db';
import { uuidv7 } from '@cadencia/kernel';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let s: SementeSessao;
let metodoPix = '';
let categoriaConsulta = '';

async function semearCaixa(t: SementeSessao): Promise<void> {
  const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
  try {
    metodoPix = uuidv7();
    categoriaConsulta = uuidv7();
    const categoriaAluguel = uuidv7();

    await a.query(
      `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
       VALUES ($1, $2, 'pix', 'Pix')`, [t.tenantId, metodoPix]);
    await a.query(
      `INSERT INTO fin.category (tenant_id, id, name, kind)
       VALUES ($1, $2, 'Consultas', 'receita'), ($1, $3, 'Aluguel', 'despesa')`,
      [t.tenantId, categoriaConsulta, categoriaAluguel]);

    const lancar = async (
      kind: 'receita' | 'despesa', valor: number, status: 'pago' | 'pendente',
      categoria: string, quandoDias: number, descricao: string,
    ) => {
      await a.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, patient_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id,
            paid_at, due_date, status, idempotency_key)
         VALUES ($1,$2,$3::fin.entry_kind,$4,$5,$6,$7,$8,$9,$10,
                 CASE WHEN $11::text = 'pago'
                      THEN clock_timestamp() + make_interval(days => $12::int) END,
                 (app.local_date(clock_timestamp(),'America/Sao_Paulo') + $12::int),
                 $11::fin.entry_status, $13)`,
        [t.tenantId, uuidv7(), kind, categoria, kind === 'receita' ? t.patientId : null,
         t.professionalId, t.clinicId, descricao, valor, metodoPix,
         status, quandoDias, `painel-${uuidv7()}`]);
    };

    await lancar('receita', 30000, 'pago', categoriaConsulta, 0, 'Consulta hoje');
    await lancar('receita', 20000, 'pago', categoriaConsulta, -1, 'Consulta ontem');
    await lancar('despesa', 15000, 'pago', categoriaAluguel, -2, 'Aluguel');
    // Vencida ha 10 dias e ainda pendente: e a linha que a tela precisa gritar.
    await lancar('receita', 45000, 'pendente', categoriaConsulta, -10, 'Particular atrasado');
    await lancar('despesa', 8000, 'pendente', categoriaAluguel, 5, 'Energia a vencer');
  } finally {
    await a.end();
  }
}

beforeAll(async () => {
  s = await semearSessao({ role: 'financeiro' });
  await semearCaixa(s);
});
afterAll(async () => { await closePools(); });

describe('painel financeiro', () => {
  it('GET /v1/financeiro/caixa soma receita, despesa e saldo do periodo', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/financeiro/caixa', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      lancamentos: { descricao: string; kind: string; categoryName: string }[];
      totalReceita: number; totalDespesa: number; saldo: number;
      contas: unknown[];
    };

    // So os PAGOS entram no caixa: pendente e promessa, nao dinheiro.
    expect(d.totalReceita).toBe(50000);
    expect(d.totalDespesa).toBe(15000);
    expect(d.saldo).toBe(35000);
    expect(d.lancamentos.find((l) => l.descricao === 'Particular atrasado')).toBeUndefined();
    expect(d.lancamentos.find((l) => l.descricao === 'Consulta hoje')?.categoryName)
      .toBe('Consultas');

    await app.close();
  });

  it('GET /v1/financeiro/a-receber traz os pendentes com dias de atraso', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/financeiro/a-receber', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      total: number;
      entradas: { description: string; daysPastDue: number; patientName: string }[];
    };

    expect(d.total).toBe(45000);
    const atrasado = d.entradas.find((e) => e.description === 'Particular atrasado');
    expect(atrasado).toBeDefined();
    // O atraso e calculado no banco, contra a data local da clinica: derivar no
    // cliente daria um numero diferente por fuso do navegador.
    expect(atrasado?.daysPastDue).toBe(10);
    expect(atrasado?.patientName).toBe(s.patientNome);

    await app.close();
  });

  it('GET /v1/financeiro/visao devolve resumo, categorias e alertas', async () => {
    const app = await buildApp();
    const r = await app.inject({ method: 'GET', url: '/v1/financeiro/visao', ...auth(s) });

    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      resumoMes: { receitaTotal: number; despesaTotal: number; saldo: number; pendente: number };
      topCategorias: { nome: string; total: number; percentual: number }[];
      alertas: { tipo: string; severidade: string }[];
      receitaVsDespesa: { mes: string }[];
      saldoProjetado: { dia: string; saldo: number }[];
    };

    expect(d.resumoMes.receitaTotal).toBe(50000);
    expect(d.resumoMes.despesaTotal).toBe(15000);
    expect(d.resumoMes.saldo).toBe(35000);
    expect(d.resumoMes.pendente).toBe(45000);

    expect(d.topCategorias[0]?.nome).toBe('Consultas');
    expect(d.topCategorias[0]?.percentual).toBe(100);

    // Um recebimento vencido ha 10 dias tem que virar alerta: e o unico numero
    // desta tela que pede acao de alguem hoje.
    expect(d.alertas.some((a) => a.tipo === 'a_receber_vencido' && a.severidade === 'danger'))
      .toBe(true);

    expect(d.receitaVsDespesa.length).toBeGreaterThan(0);
    expect(d.saldoProjetado.length).toBeGreaterThan(0);

    await app.close();
  });

  it('nao enxerga o caixa de outro tenant', async () => {
    const app = await buildApp();
    const outro = await semearSessao({ role: 'financeiro' });
    const r = await app.inject({ method: 'GET', url: '/v1/financeiro/caixa', ...auth(outro) });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { totalReceita: number }).totalReceita).toBe(0);
    await app.close();
  });
});

describe('a pagar', () => {
  it('GET /v1/payables devolve NOME de fornecedor e categoria, nao so o id', async () => {
    const app = await buildApp();
    const t = await semearSessao({ role: 'financeiro' });
    const a = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });

    const metodo = uuidv7();
    const categoria = uuidv7();
    const fornecedor = uuidv7();
    try {
      await a.query(
        `INSERT INTO fin.payment_method (tenant_id, id, kind, name)
         VALUES ($1,$2,'pix','Pix')`, [t.tenantId, metodo]);
      await a.query(
        `INSERT INTO fin.category (tenant_id, id, name, kind)
         VALUES ($1,$2,'Aluguel','despesa')`, [t.tenantId, categoria]);
      await a.query(
        `INSERT INTO fin.supplier (tenant_id, id, name)
         VALUES ($1,$2,'Imobiliaria Central')`, [t.tenantId, fornecedor]);
      await a.query(
        `INSERT INTO fin.entry
           (tenant_id, id, kind, category_id, supplier_id, professional_id, clinic_id,
            description, amount_cents, payment_method_id, due_date, status,
            idempotency_key)
         VALUES ($1,$2,'despesa',$3,$4,$5,$6,'Aluguel de agosto',850000,$7,
                 (app.local_date(clock_timestamp(),'America/Sao_Paulo') + 5),'pendente',$8)`,
        [t.tenantId, uuidv7(), categoria, fornecedor, t.professionalId, t.clinicId,
         metodo, `ap-${uuidv7()}`]);
    } finally {
      await a.end();
    }

    const r = await app.inject({ method: 'GET', url: '/v1/payables', ...auth(t) });
    expect(r.statusCode).toBe(200);
    const item = (r.json() as {
      itens: { description: string; supplierName: string | null;
               categoryName: string | null }[] }).itens
      .find((x) => x.description === 'Aluguel de agosto');

    // A tela A Pagar mostra "de quem e a conta". Devolver so o uuid obrigaria o
    // front a fazer N consultas ou a exibir o id, que nao diz nada.
    expect(item?.supplierName).toBe('Imobiliaria Central');
    expect(item?.categoryName).toBe('Aluguel');

    await app.close();
  });
});
