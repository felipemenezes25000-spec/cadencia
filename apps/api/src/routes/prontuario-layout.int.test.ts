import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '@cadencia/db';
import { buildApp } from '../app';
import { auth, semearSessao, type SementeSessao } from '../test-support';

let medico: SementeSessao;
let outro: SementeSessao;
let recepcao: SementeSessao;

interface ItemDoLayout {
  sectionId: string; code: string; label: string;
  ordinal: number; visible: boolean; collapsed: boolean; personalizado: boolean;
}

async function layoutDe(s: SementeSessao): Promise<ItemDoLayout[]> {
  const app = await buildApp();
  const r = await app.inject({
    method: 'GET', url: '/v1/configuracoes/prontuario/layout', ...auth(s) });
  await app.close();
  return (r.json() as { itens: ItemDoLayout[] }).itens;
}

/** Instancia o template para o tenant ter secoes de prontuario. */
async function instanciarTemplate(s: SementeSessao): Promise<void> {
  const app = await buildApp();
  await app.inject({
    method: 'POST', url: '/v1/configuracoes/prontuario/instanciar',
    payload: { templateCode: 'evolucao_livre' }, ...auth(s) });
  await app.close();
}

beforeAll(async () => {
  medico = await semearSessao({ role: 'profissional' });
  outro = await semearSessao({ role: 'profissional' });
  recepcao = await semearSessao({ role: 'recepcao' });
  await instanciarTemplate(medico);
  await instanciarTemplate(recepcao);
});

afterAll(async () => { await closePools(); });

describe('layout do prontuario por profissional', () => {
  it('quem nunca mexeu cai no padrao da clinica', async () => {
    const itens = await layoutDe(medico);
    expect(itens.length).toBeGreaterThan(0);
    // `personalizado: false` e o que distingue "aceitei o padrao" de "escolhi
    // exatamente esta ordem". Sem isso a tela nao sabe se pode reordenar o
    // padrao da clinica sem avisar.
    expect(itens.every((x) => !x.personalizado)).toBe(true);
    expect(itens.every((x) => x.visible)).toBe(true);
  });

  it('salva a ordem e o que fica escondido', async () => {
    const antes = await layoutDe(medico);
    // Inverte a ordem e esconde a primeira secao.
    const invertido = [...antes].reverse().map((x, i) => ({
      sectionId: x.sectionId, ordinal: i + 1,
      visible: x.sectionId !== antes[0]!.sectionId,
      collapsed: false,
    }));

    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/configuracoes/prontuario/layout', ...auth(medico),
      payload: { itens: invertido },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { salvos: number }).salvos).toBe(invertido.length);
    await app.close();

    const depois = await layoutDe(medico);
    expect(depois[0]?.sectionId).toBe(antes[antes.length - 1]?.sectionId);
    expect(depois.every((x) => x.personalizado)).toBe(true);
    expect(depois.find((x) => x.sectionId === antes[0]!.sectionId)?.visible).toBe(false);
  });

  it('a secao escondida some da FICHA, nao so da configuracao', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/prontuario', ...auth(medico) });
    const secoes = (r.json() as { secoes: { sectionId: string }[] }).secoes;
    await app.close();

    const escondida = (await layoutDe(medico)).find((x) => !x.visible);
    expect(escondida).toBeDefined();
    // Esconder na configuracao e continuar aparecendo na consulta seria o pior
    // dos mundos: o medico acha que arrumou e a tela ignora.
    expect(secoes.some((s) => s.sectionId === escondida!.sectionId)).toBe(false);
  });

  it('a ficha respeita a ORDEM escolhida, nao a da clinica', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/prontuario', ...auth(medico) });
    const secoes = (r.json() as { secoes: { sectionId: string }[] }).secoes;
    await app.close();

    const visiveis = (await layoutDe(medico)).filter((x) => x.visible);
    expect(secoes.map((s) => s.sectionId)).toEqual(visiveis.map((x) => x.sectionId));
  });

  it('outro profissional continua no padrao', async () => {
    const doOutro = await layoutDe(outro);
    // `semearSessao` cria um tenant por sessao, entao isto prova o isolamento
    // por TENANT. O escopo por PROFISSIONAL e verificado direto na tabela no
    // teste seguinte — as duas garantias sao diferentes e ambas importam.
    expect(doOutro.every((x) => !x.personalizado)).toBe(true);
  });

  it('as linhas gravadas carregam o professional_id de quem salvou', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env['DATABASE_URL_ADMIN'], max: 1 });
    try {
      const { rows } = await pool.query<{ n: string; iguais: string }>(
        `SELECT count(*)::text AS n,
                count(*) FILTER (WHERE professional_id = $2)::text AS iguais
           FROM clin.record_layout_item WHERE tenant_id = $1`,
        [medico.tenantId, medico.professionalId]);
      // Se o layout fosse gravado por CLINICA em vez de por profissional, um
      // medico arrumaria a propria tela e mudaria a do colega — e ninguem
      // entenderia por que a ficha mudou sozinha.
      expect(Number(rows[0]!.n)).toBeGreaterThan(0);
      expect(rows[0]!.iguais).toBe(rows[0]!.n);
    } finally {
      await pool.end();
    }
  });

  it('lista vazia volta ao padrao da clinica', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'PUT', url: '/v1/configuracoes/prontuario/layout', ...auth(medico),
      payload: { itens: [] },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { salvos: number }).salvos).toBe(0);
    await app.close();

    const depois = await layoutDe(medico);
    // Apagar a personalizacao devolve TODAS as secoes, na ordem da clinica —
    // inclusive a que estava escondida. E o unico caminho de volta: reenviar a
    // ordem da clinica gravaria um layout identico ao padrao e CONGELARIA o
    // medico nele, sem receber mudanca futura nenhuma.
    expect(depois.every((x) => !x.personalizado)).toBe(true);
    expect(depois.every((x) => x.visible)).toBe(true);
  });

  it('recepcao nao alcanca o layout — nem para ler', async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: 'GET', url: '/v1/configuracoes/prontuario/layout', ...auth(recepcao) });
    // A rota exige `encounter.read`, que a recepcao nao tem. O guard barra
    // antes de qualquer consulta — nao ha layout a arrumar para quem nao
    // atende, e a rota PUT fica inalcancavel pelo mesmo motivo.
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
